import { signal } from '@preact/signals';
import { parseSavedViews, SAVED_VIEWS_META_KEY } from '../collection/views';
import { savedViews } from '../collection/state';
import {
  hiddenTabIds,
  hiddenTabs,
  parseProjectTabs,
  PROJECT_TABS_META_KEY,
  projectTabsMemory,
  restoreTabs,
  TABS_META_KEY,
  tabsState,
} from '../tabs/tabs';
import type { ConnectionEvents } from './database';
import { sortNotes, type Note } from './note';
import { loadNotesEnsuringOne, type NoteRepository } from './repository';

export type NotesState =
  | { status: 'loading'; message?: string }
  | { status: 'ready'; notes: Note[]; unreadable: string[] }
  | { status: 'error'; message: string };

export const notesState = signal<NotesState>({ status: 'loading' });

export const MESSAGES = {
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
/**
 * Cresce a ogni blocco (e sblocco). Chi riprende dopo un await (eliminazione, rilettura da
 * un'altra scheda…) confronta l'epoca: se è cambiata le note sono uscite dalla memoria e non
 * deve rimettercene.
 */
let lockEpoch = 0;

export function currentLockEpoch(): number {
  return lockEpoch;
}

/**
 * Data di modifica dell'ultima versione di ogni nota che questa scheda sa essere
 * nell'archivio (caricata, salvata o riletta da qui). Serve a "rileggi tutto" (crossTab.ts)
 * per distinguere una nota cambiata altrove da una che ha solo modifiche locali non salvate.
 */
const storedVersions = new Map<string, number>();

export function markStored(notes: readonly Note[]): void {
  for (const note of notes) storedVersions.set(note.id, note.modifiedAt);
}

export function forgetStored(ids: readonly string[]): void {
  for (const id of ids) storedVersions.delete(id);
}

export function storedVersion(id: string): number | undefined {
  return storedVersions.get(id);
}

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

/**
 * Eventi della connessione all'archivio: chi apre il database (vault.ts) li passa a
 * openNotepadDb, così salvataggi in coda e messaggi restano gestiti qui.
 */
export function connectionEvents(): ConnectionEvents {
  return {
    beforeClose: () => beforeCloseHook?.() ?? Promise.resolve(),
    onBlocked: () => (notesState.value = { status: 'loading', message: MESSAGES.blocked }),
    onVersionChange: () => fail(MESSAGES.reload),
    onTerminated: () => fail(MESSAGES.terminated),
  };
}

/**
 * Carica le note dal repository aperto da `open` (dopo lo sblocco, con il codec cifrato).
 * Una sola volta fino al prossimo blocco: chiamate successive restituiscono la stessa promessa.
 */
export function initNotes(open: Opener): Promise<void> {
  initialization ??= load(open);
  return initialization;
}

async function load(open: Opener): Promise<void> {
  const events = connectionEvents();
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
    const projectTabs = parseProjectTabs(await repo.getMeta(PROJECT_TABS_META_KEY));
    repository = repo;
    markStored(notes);
    // Le schede prima delle note: l'interfaccia "pronta" deve già sapere quale nota mostrare.
    hiddenTabIds.current = hiddenTabs(savedTabs, unreadable);
    tabsState.value = restoreTabs(
      savedTabs,
      notes.map((note) => note.id),
    );
    savedViews.value = views;
    projectTabsMemory.current = projectTabs;
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

/**
 * Molte note insieme (importazione, F8): sostituisce o aggiunge `put` e toglie `remove` con
 * un solo riordino, invece di uno per nota.
 */
export function replaceNotes(put: readonly Note[], remove: readonly string[]): void {
  const state = notesState.value;
  if (state.status !== 'ready') return;
  const gone = new Set([...remove, ...put.map((note) => note.id)]);
  const others = state.notes.filter((note) => !gone.has(note.id));
  notesState.value = { ...state, notes: sortNotes([...others, ...put]) };
}

/**
 * Al blocco: via note, schede (anche quelle dei progetti) e viste salvate dalla memoria, e il repository (che tiene il
 * codec con la chiave). Il prossimo sblocco ricarica tutto con initNotes.
 */
export function resetNotesForLock(): void {
  lockEpoch++;
  storedVersions.clear();
  repository = undefined;
  initialization = undefined;
  notesState.value = { status: 'loading' };
  tabsState.value = { open: [], active: null };
  hiddenTabIds.current = [];
  projectTabsMemory.current = new Map();
  savedViews.value = [];
}

/** Solo per i test: dimentica l'inizializzazione precedente. */
export const resetNotesStoreForTests = resetNotesForLock;
