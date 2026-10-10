import { batch, signal } from '@preact/signals';
import { closeTab } from '../tabs/actions';
import { tabsState } from '../tabs/tabs';
import { dropPendingSave, isPendingSave, restorePendingSave, setSavedListener } from './autosave';
import type { Note } from './note';
import { getRepository, notesState, removeNote, replaceNote, updateNote } from './store';

/**
 * Avviso tra schede dello stesso browser. Viaggiano solo id e data di modifica (mai testo,
 * titoli o tag): un'altra scheda sa così che la sua copia in memoria è vecchia.
 * - nota non aperta qui e senza modifiche locali: si rilegge in silenzio dall'archivio;
 * - nota attiva o con modifiche non ancora salvate: si mostra un avviso e si sceglie.
 */
const CHANNEL_NAME = 'notepad-minus-minus';

type Message = { id: string; modifiedAt: number } | { id: string; deleted: true };

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

function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || v['id'].length > 64) return false;
  return (
    v['deleted'] === true ||
    (typeof v['modifiedAt'] === 'number' && Number.isFinite(v['modifiedAt']))
  );
}

function mark(id: string, change: ElsewhereChange | null): void {
  const next = new Map(changedElsewhere.value);
  if (change) next.set(id, change);
  else next.delete(id);
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
  if (notesState.value.status !== 'ready') return;
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
  try {
    const fresh = await getRepository().get(id);
    if (!fresh) return;
    // Nel frattempo qui la nota potrebbe essere diventata attiva o modificata.
    if (isPendingSave(id) || tabsState.value.active === id) {
      mark(id, 'modified');
      return;
    }
    replaceNote(fresh);
  } catch (error) {
    console.error(error);
  }
}

/** "Carica la versione più recente": scarta le modifiche locali non salvate e rilegge. */
export async function loadLatestVersion(id: string): Promise<void> {
  const change = changedElsewhere.value.get(id);
  if (change === 'deleted') {
    batch(() => {
      dropPendingSave(id);
      closeTab(id);
      removeNote(id);
      mark(id, null);
    });
    return;
  }
  const fresh = await getRepository().get(id);
  batch(() => {
    dropPendingSave(id);
    if (fresh) replaceNote(fresh);
    bumpRevision(id);
    mark(id, null);
  });
}

/** "Tieni questa versione": la copia di questa scheda resta e, se serve, si salva di nuovo. */
export function keepThisVersion(id: string): void {
  const change = changedElsewhere.value.get(id);
  mark(id, null);
  if (!change) return;
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
