import { signal } from '@preact/signals';
import { parseSavedViews, SAVED_VIEWS_META_KEY } from '../collection/views';
import { savedViews } from '../collection/state';
import { hiddenTabIds, hiddenTabs, restoreTabs, TABS_META_KEY, tabsState } from '../tabs/tabs';
import { plainCodec } from './codec';
import { openNotepadDb, type ConnectionEvents } from './database';
import { sortNotes, type Note } from './note';
import { createNoteRepository, loadNotesEnsuringOne, type NoteRepository } from './repository';

export type NotesState =
  | { status: 'loading'; message?: string }
  | { status: 'ready'; notes: Note[]; unreadable: string[] }
  | { status: 'error'; message: string };

export const notesState = signal<NotesState>({ status: 'loading' });

const MESSAGES = {
  reload: "Notepad−− è stato aggiornato in un'altra scheda. Ricarica questa pagina per continuare.",
  blocked:
    "Un'altra scheda di Notepad−− usa una versione precedente: chiudila o ricaricala per " +
    'completare l’aggiornamento.',
  terminated: 'Il browser ha chiuso l’archivio delle note. Ricarica la pagina per riaprirlo.',
  newerVersion:
    "In un'altra scheda è aperta una versione più recente di Notepad−−. Ricarica questa pagina.",
  slow:
    'L’archivio delle note non risponde. Chiudi le altre schede di Notepad−− e ricarica questa ' +
    'pagina; se non basta, riavvia il browser.',
  quota: 'Lo spazio di archiviazione del browser è esaurito: libera spazio e ricarica la pagina.',
  unavailable:
    'Questo browser non permette di salvare dati per il sito (succede in alcune finestre ' +
    'private o se i dati dei siti sono bloccati). Senza archivio le note non si possono aprire.',
} as const;

export function messageForError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'VersionError') return MESSAGES.newerVersion;
  if (name === 'QuotaExceededError') return MESSAGES.quota;
  return MESSAGES.unavailable;
}

let repository: NoteRepository | undefined;
let initialization: Promise<void> | undefined;

export function getRepository(): NoteRepository {
  if (!repository) throw new Error('Archivio note non ancora aperto');
  return repository;
}

type Opener = (events: ConnectionEvents) => Promise<NoteRepository>;

let beforeCloseHook: (() => Promise<void>) | undefined;

/** Lavoro da finire prima che un aggiornamento da un'altra scheda chiuda l'archivio. */
export function setBeforeCloseHook(hook: (() => Promise<void>) | undefined): void {
  beforeCloseHook = hook;
}

/** Apre l'archivio una sola volta; chiamate successive restituiscono la stessa promessa. */
export function initNotes(open: Opener = openDefault): Promise<void> {
  initialization ??= load(open);
  return initialization;
}

async function load(open: Opener): Promise<void> {
  const events: ConnectionEvents = {
    beforeClose: () => beforeCloseHook?.() ?? Promise.resolve(),
    onBlocked: () => (notesState.value = { status: 'loading', message: MESSAGES.blocked }),
    onVersionChange: () => fail(MESSAGES.reload),
    onTerminated: () => fail(MESSAGES.terminated),
  };
  // Se l'archivio non risponde (succede raramente, per esempio con un'altra scheda bloccata)
  // si spiega cosa fare invece di lasciare "Apertura delle note…" all'infinito.
  const slow = setTimeout(() => {
    if (notesState.value.status === 'loading' && !notesState.value.message) {
      notesState.value = { status: 'loading', message: MESSAGES.slow };
    }
  }, SLOW_OPEN_MS);
  try {
    const repo = await open(events);
    const { notes, unreadable } = await loadNotesEnsuringOne(repo);
    const savedTabs = await repo.getMeta(TABS_META_KEY);
    const views = parseSavedViews(await repo.getMeta(SAVED_VIEWS_META_KEY));
    repository = repo;
    // Le schede prima delle note: l'interfaccia "pronta" deve già sapere quale nota mostrare.
    hiddenTabIds.current = hiddenTabs(savedTabs, unreadable);
    tabsState.value = restoreTabs(
      savedTabs,
      notes.map((note) => note.id),
    );
    savedViews.value = views;
    notesState.value = { status: 'ready', notes, unreadable };
  } catch (error) {
    console.error(error);
    fail(messageForError(error));
  } finally {
    clearTimeout(slow);
  }
}

const SLOW_OPEN_MS = 8000;

function fail(message: string) {
  repository = undefined;
  notesState.value = { status: 'error', message };
}

async function openDefault(events: ConnectionEvents): Promise<NoteRepository> {
  return createNoteRepository(await openNotepadDb(events), plainCodec);
}

/** Aggiunge in memoria una nota appena salvata nell'archivio. */
export function addNote(note: Note): void {
  const state = notesState.value;
  if (state.status !== 'ready') return;
  notesState.value = { ...state, notes: sortNotes([...state.notes, note]) };
}

/** Toglie dalla memoria una nota (per esempio una creazione non riuscita). */
export function removeNote(id: string): void {
  const state = notesState.value;
  if (state.status !== 'ready') return;
  notesState.value = { ...state, notes: state.notes.filter((note) => note.id !== id) };
}

/**
 * Aggiorna in memoria testo e data di modifica di una nota e restituisce la nota aggiornata
 * (undefined se non è cambiato nulla). Il salvataggio nell'archivio lo fa `autosave.ts`.
 */
export function updateNoteText(
  id: string,
  text: string,
  now: number = Date.now(),
): Note | undefined {
  return updateNote(id, (current) =>
    current.text === text ? current : { ...current, text, modifiedAt: now },
  );
}

/**
 * Applica `change` alla nota in memoria e restituisce la nota aggiornata (undefined se la nota
 * non c'è o `change` la restituisce invariata).
 */
export function updateNote(id: string, change: (note: Note) => Note): Note | undefined {
  const state = notesState.value;
  if (state.status !== 'ready') return undefined;
  const index = state.notes.findIndex((note) => note.id === id);
  const current = state.notes[index];
  if (!current) return undefined;
  const updated = change(current);
  if (updated === current) return undefined;
  const notes = [...state.notes];
  notes[index] = updated;
  notesState.value = { ...state, notes };
  return updated;
}

/** Sostituisce (o aggiunge) la nota in memoria con la versione letta dall'archivio. */
export function replaceNote(note: Note): void {
  const state = notesState.value;
  if (state.status !== 'ready') return;
  const others = state.notes.filter((n) => n.id !== note.id);
  notesState.value = { ...state, notes: sortNotes([...others, note]) };
}

/** Solo per i test: dimentica l'inizializzazione precedente. */
export function resetNotesStoreForTests(): void {
  repository = undefined;
  initialization = undefined;
  notesState.value = { status: 'loading' };
  tabsState.value = { open: [], active: null };
  hiddenTabIds.current = [];
  savedViews.value = [];
}
