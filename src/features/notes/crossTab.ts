import { batch, signal } from '@preact/signals';
import { savedViews } from '../collection/state';
import { parseSavedViews, SAVED_VIEWS_META_KEY } from '../collection/views';
import { closeTab } from '../tabs/actions';
import { tabsState } from '../tabs/tabs';
import {
  allowSaving,
  dropPendingSave,
  holdSaves,
  isPendingSave,
  releaseSaves,
  restorePendingSave,
  setSavedListener,
} from './autosave';
import type { Note } from './note';
import {
  currentLockEpoch,
  getRepository,
  notesState,
  removeNote,
  replaceNote,
  updateNote,
} from './store';

/**
 * Avviso tra schede dello stesso browser. Viaggiano solo id e data di modifica, l'id di una
 * nota eliminata, il segnale "viste salvate cambiate" o "note bloccate" (mai testo, titoli o
 * tag): un'altra scheda sa così che la sua copia in memoria è vecchia e la rilegge dall'archivio.
 * - nota non aperta qui e senza modifiche locali: si rilegge in silenzio;
 * - nota attiva o con modifiche non ancora salvate: avviso, e i salvataggi di quella nota
 *   restano trattenuti finché non si sceglie quale versione tenere.
 */
const CHANNEL_NAME = 'notepad-minus-minus';

type Message =
  | { id: string; modifiedAt: number }
  | { id: string; deleted: true }
  | { savedViews: true }
  /** Blocco manuale: anche le altre schede si bloccano. */
  | { locked: true };

export type ElsewhereChange = 'modified' | 'deleted';

/** Note cambiate in un'altra scheda mentre qui erano aperte o modificate. */
export const changedElsewhere = signal<ReadonlyMap<string, ElsewhereChange>>(new Map());

/** Cresce quando una nota viene ricaricata: l'editor si ricrea con il testo nuovo. */
export const noteRevisions = signal<ReadonlyMap<string, number>>(new Map());

let channel: BroadcastChannel | null = null;

function post(message: Message): void {
  try {
    channel?.postMessage(message);
  } catch (error) {
    console.error(error);
  }
}

export function announceDeleted(id: string): void {
  post({ id, deleted: true });
}

export function announceSavedViewsChanged(): void {
  post({ savedViews: true });
}

export function announceLocked(): void {
  post({ locked: true });
}

let lockListener: (() => void) | undefined;

/** Chi blocca questa scheda quando un'altra si blocca a mano (vault.ts). */
export function setLockListener(listener: (() => void) | undefined): void {
  lockListener = listener;
}

/** Al blocco: gli avvisi e le revisioni riguardano note che escono dalla memoria. */
export function resetCrossTabForLock(): void {
  changedElsewhere.value = new Map();
  noteRevisions.value = new Map();
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['savedViews'] === true || v['locked'] === true) return true;
  if (typeof v['id'] !== 'string' || v['id'].length > 64) return false;
  return (
    v['deleted'] === true ||
    (typeof v['modifiedAt'] === 'number' && Number.isFinite(v['modifiedAt']))
  );
}

/** Segna (o toglie) l'avviso e trattiene (o libera) i salvataggi della nota. */
function mark(id: string, change: ElsewhereChange | null): void {
  const next = new Map(changedElsewhere.value);
  if (change) {
    next.set(id, change);
    holdSaves(id);
  } else {
    next.delete(id);
    releaseSaves(id);
  }
  changedElsewhere.value = next;
}

function bumpRevision(id: string): void {
  const next = new Map(noteRevisions.value);
  next.set(id, (next.get(id) ?? 0) + 1);
  noteRevisions.value = next;
}

function localNote(id: string): Note | undefined {
  const state = notesState.value;
  return state.status === 'ready' ? state.notes.find((n) => n.id === id) : undefined;
}

async function onMessage(message: Message): Promise<void> {
  if ('locked' in message) {
    lockListener?.();
    return;
  }
  // Bloccata (o archivio non aperto): niente da rileggere, lo farà lo sblocco.
  if (notesState.value.status !== 'ready') return;
  if ('savedViews' in message) {
    await reloadSavedViews();
    return;
  }
  const local = localNote(message.id);
  const busy = tabsState.value.active === message.id || isPendingSave(message.id);
  if ('deleted' in message) {
    if (!local) return;
    if (busy) mark(message.id, 'deleted');
    else
      batch(() => {
        closeTab(message.id);
        removeNote(message.id);
      });
    return;
  }
  if (local && local.modifiedAt >= message.modifiedAt) return;
  if (busy) {
    mark(message.id, 'modified');
    return;
  }
  await reloadNote(message.id);
}

async function reloadNote(id: string): Promise<void> {
  const epoch = currentLockEpoch();
  try {
    const fresh = await getRepository().get(id);
    if (!fresh || currentLockEpoch() !== epoch) return;
    // Nel frattempo qui la nota potrebbe essere diventata attiva o modificata.
    if (isPendingSave(id) || tabsState.value.active === id) {
      mark(id, 'modified');
      return;
    }
    allowSaving(id);
    replaceNote(fresh);
  } catch (error) {
    console.error(error);
  }
}

async function reloadSavedViews(): Promise<void> {
  try {
    const epoch = currentLockEpoch();
    const stored = await getRepository().getMeta(SAVED_VIEWS_META_KEY);
    // Bloccate nel frattempo: le viste restano fuori dalla memoria.
    if (currentLockEpoch() === epoch) savedViews.value = parseSavedViews(stored);
  } catch (error) {
    console.error(error);
  }
}

/** "Carica la versione più recente": scarta le modifiche locali non salvate e rilegge. */
export async function loadLatestVersion(id: string): Promise<void> {
  const change = changedElsewhere.value.get(id);
  const epoch = currentLockEpoch();
  const fresh = change === 'deleted' ? undefined : await getRepository().get(id);
  if (currentLockEpoch() !== epoch) return;
  batch(() => {
    // Prima si scartano le modifiche locali, poi si libera la nota: niente da riscrivere.
    dropPendingSave(id);
    mark(id, null);
    if (fresh) {
      allowSaving(id);
      replaceNote(fresh);
      bumpRevision(id);
    } else {
      closeTab(id);
      removeNote(id);
    }
  });
}

/** "Tieni questa versione": la copia di questa scheda resta e, se serve, si salva di nuovo. */
export function keepThisVersion(id: string): void {
  const change = changedElsewhere.value.get(id);
  // Nessun avviso (anche perché le note sono state bloccate nel frattempo): niente da tenere.
  if (!change || notesState.value.status !== 'ready') return;
  mark(id, null);
  // Si riscrive subito, con una data nuova: così vince anche nelle altre schede (e una nota
  // eliminata altrove torna nell'archivio solo perché si è scelto di tenerla).
  const updated = updateNote(id, (note) => ({ ...note, modifiedAt: Date.now() }));
  if (updated) restorePendingSave(updated);
}

export function startCrossTabSync(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const current = new BroadcastChannel(CHANNEL_NAME);
  channel = current;
  current.onmessage = (event: MessageEvent<unknown>) => {
    if (isMessage(event.data)) void onMessage(event.data);
  };
  setSavedListener((notes) => {
    for (const note of notes) post({ id: note.id, modifiedAt: note.modifiedAt });
  });
  return () => {
    setSavedListener(undefined);
    current.close();
    if (channel === current) channel = null;
  };
}
