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
import { sameNote, sortNotes, type Note } from './note';
import type { NoteList } from './repository';
import {
  currentLockEpoch,
  forgetStored,
  getRepository,
  markStored,
  notesState,
  removeNote,
  replaceNote,
  storedVersion,
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
  | { locked: true }
  /** Importazione di molte note (F8): le altre schede rileggono tutto l'archivio. */
  | { reloadAll: true };

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

/** Oltre questo numero di note cambiate un'importazione chiede di rileggere tutto. */
export const RELOAD_ALL_THRESHOLD = 50;

/**
 * Note scritte o eliminate da un'importazione (F8): unendo, poche si annunciano una per una,
 * come i salvataggi; molte, o sostituendo, con un solo `{ reloadAll: true }`. Mai contenuto.
 */
export function announceImported(
  written: readonly { id: string; modifiedAt: number }[],
  removed: readonly string[],
  replaced: boolean,
): void {
  // Sostituendo una nota può tornare a una versione più vecchia, che i messaggi singoli
  // farebbero ignorare: si chiede sempre di rileggere tutto.
  if (replaced || written.length + removed.length > RELOAD_ALL_THRESHOLD) {
    post({ reloadAll: true });
    return;
  }
  for (const id of removed) post({ id, deleted: true });
  for (const { id, modifiedAt } of written) post({ id, modifiedAt });
}

/**
 * Dopo un'importazione riuscita in questa scheda: le note scritte o eliminate non hanno più
 * avvisi né salvataggi trattenuti, tornano a potersi salvare e l'editor di quelle riscritte si
 * ricrea con il testo nuovo. Le modifiche in coda le ha già tolte chi importa, prima di scrivere.
 */
export function settleImported(written: readonly string[], removed: readonly string[]): void {
  batch(() => {
    for (const id of [...written, ...removed]) {
      if (changedElsewhere.value.has(id)) mark(id, null);
    }
    for (const id of written) {
      allowSaving(id);
      bumpRevision(id);
    }
  });
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
  if (v['savedViews'] === true || v['locked'] === true || v['reloadAll'] === true) return true;
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
  if ('reloadAll' in message) {
    await reloadAll();
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
    markStored([fresh]);
    replaceNote(fresh);
  } catch (error) {
    console.error(error);
  }
}

/** Nota aperta nella scheda attiva, con modifiche non ancora salvate qui o già in avviso. */
function isBusy(id: string): boolean {
  return tabsState.value.active === id || isPendingSave(id) || changedElsewhere.value.has(id);
}

/**
 * Note che un'importazione in questa scheda non deve toccare: modifiche non salvate (anche
 * trattenute) o un avviso aperto per un cambio in un'altra scheda. Restano "in conflitto".
 */
export function hasLocalConflict(id: string): boolean {
  return isPendingSave(id) || changedElsewhere.value.has(id);
}

/**
 * Una nota occupata qui (attiva o con modifiche non salvate o trattenute) è cambiata
 * nell'archivio per mano di un'altra scheda? Con modifiche locali la copia in memoria è
 * diversa dall'archivio comunque: conta solo se la versione salvata non è più quella che
 * questa scheda conosce (storedVersion). Senza modifiche locali ogni differenza conta.
 */
function changedElsewhereThan(local: Note, stored: Note): boolean {
  if (!isPendingSave(local.id)) return true;
  const known = storedVersion(local.id);
  return known === undefined ? stored.modifiedAt > local.modifiedAt : stored.modifiedAt !== known;
}

/**
 * "Rileggi tutto" (importazione in un'altra scheda, F8): l'archivio è la verità. Ogni nota
 * salvata diversa dalla copia in memoria si adotta, anche se più vecchia (una sostituzione
 * può riportare una versione precedente); le note occupate qui ricevono invece l'avviso e i
 * loro salvataggi restano trattenuti. Contano come eliminate solo le note che c'erano già
 * prima della lettura: una nota creata qui nel frattempo non è ancora nell'archivio.
 */
async function reloadAll(): Promise<void> {
  const epoch = currentLockEpoch();
  const before = notesState.value;
  if (before.status !== 'ready') return;
  const known = new Set(before.notes.map((note) => note.id));
  let stored: NoteList;
  try {
    stored = await getRepository().list();
  } catch (error) {
    console.error(error);
    return;
  }
  const state = notesState.value;
  if (currentLockEpoch() !== epoch || state.status !== 'ready') return;
  const fresh = new Map(stored.notes.map((note) => [note.id, note]));
  const unreadable = new Set(stored.unreadable);
  const next: Note[] = [];
  const adopted: Note[] = [];
  const toClose: string[] = [];
  batch(() => {
    for (const local of state.notes) {
      const latest = fresh.get(local.id);
      fresh.delete(local.id);
      if (!latest) {
        // Creata durante la lettura, o diventata illeggibile: non vuol dire eliminata.
        if (!known.has(local.id) || unreadable.has(local.id)) next.push(local);
        else if (isBusy(local.id)) {
          mark(local.id, 'deleted');
          next.push(local);
        } else toClose.push(local.id);
      } else if (sameNote(local, latest)) {
        next.push(local);
      } else if (isBusy(local.id)) {
        if (changedElsewhereThan(local, latest)) mark(local.id, 'modified');
        next.push(local);
      } else {
        allowSaving(local.id);
        adopted.push(latest);
        bumpRevision(local.id);
        next.push(latest);
      }
    }
    // Note nuove, mai viste qui.
    for (const note of fresh.values()) {
      allowSaving(note.id);
      adopted.push(note);
      next.push(note);
    }
    markStored(adopted);
    forgetStored(toClose);
    for (const id of toClose) closeTab(id);
    notesState.value = { ...state, notes: sortNotes(next) };
  });
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
      markStored([fresh]);
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
