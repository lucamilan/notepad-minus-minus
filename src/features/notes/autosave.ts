import { effect, signal } from '@preact/signals';
import type { Note } from './note';
import { getRepository, setBeforeCloseHook, updateNoteText } from './store';

/**
 * Salvataggio continuo, sempre attivo: ogni modifica si salva dopo SAVE_DELAY_MS di pausa,
 * subito con Ctrl+S e quando la pagina viene nascosta o chiusa. Le note modificate si
 * scrivono insieme con putMany (tutto o niente); se la scrittura fallisce restano in coda
 * e si riprova alla modifica successiva o con Ctrl+S.
 */
export type SaveStatus =
  | { state: 'saved'; at: number | null } // at null: nulla modificato in questa sessione
  | { state: 'pending' }
  | { state: 'saving' }
  | { state: 'error'; message: string };

export const SAVE_DELAY_MS = 500;
/** Dopo un errore si riprova da soli con questa pausa, oltre che a ogni modifica o Ctrl+S. */
export const RETRY_DELAY_MS = 5000;

export const saveStatus = signal<SaveStatus>({ state: 'saved', at: null });

const pending = new Map<string, Note>();
/** Note la cui creazione è stata annullata: non vanno mai scritte (né lasciate) nell'archivio. */
const discarded = new Set<string>();
/** Id delle note nel salvataggio in corso. */
const writing = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let lastSavedAt: number | null = null;
let savedListener: ((notes: readonly Note[]) => void) | undefined;

/** Chi vuole sapere quali note sono appena finite nell'archivio (avviso tra schede). */
export function setSavedListener(listener: ((notes: readonly Note[]) => void) | undefined): void {
  savedListener = listener;
}

/** Aggiorna il testo della nota in memoria e ne programma il salvataggio. */
export function editNote(id: string, text: string): void {
  const updated = updateNoteText(id, text);
  if (updated) scheduleSave(updated);
}

export function scheduleSave(note: Note): void {
  pending.set(note.id, note);
  // Un errore resta visibile finché un salvataggio non riesce davvero.
  const { state } = saveStatus.value;
  if (state === 'saved') saveStatus.value = { state: 'pending' };
  clearTimeout(timer);
  timer = setTimeout(() => void flushSaves(), SAVE_DELAY_MS);
}

/** Una nota la cui creazione è stata annullata: esce dalla coda e non verrà più scritta. */
export function discardPendingSave(id: string): void {
  discarded.add(id);
  pending.delete(id);
  // Se era l'unica modifica in coda, lo stato non deve restare su "Modifiche non salvate".
  if (pending.size === 0 && running === null && saveStatus.value.state === 'pending') {
    clearTimeout(timer);
    timer = undefined;
    saveStatus.value = { state: 'saved', at: lastSavedAt };
  }
}

/** La nota ha modifiche in coda o in scrittura? */
export function isPendingSave(id: string): boolean {
  return pending.has(id) || writing.has(id);
}

/** Scarta le modifiche in coda di una nota (si è scelto di tenere la versione dell'archivio). */
export function dropPendingSave(id: string): void {
  pending.delete(id);
  if (pending.size === 0 && running === null && saveStatus.value.state === 'pending') {
    clearTimeout(timer);
    timer = undefined;
    saveStatus.value = { state: 'saved', at: lastSavedAt };
  }
}

/** Annulla un discardPendingSave (eliminazione fallita): la nota torna a salvarsi. */
export function restorePendingSave(note: Note): void {
  discarded.delete(note.id);
  scheduleSave(note);
}

export function hasUnsavedChanges(): boolean {
  return pending.size > 0 || running !== null;
}

/** Scrive subito tutte le modifiche in coda; si risolve quando sono nell'archivio (o fallite). */
export async function flushSaves(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  // Un salvataggio alla volta: le modifiche arrivate nel frattempo partono nel giro successivo.
  while (running) await running;
  if (pending.size === 0) return;

  const batch = [...pending.values()].filter((note) => !discarded.has(note.id));
  pending.clear();
  if (batch.length === 0) return;
  saveStatus.value = { state: 'saving' };
  for (const note of batch) writing.add(note.id);
  running = write(batch);
  try {
    await running;
  } finally {
    running = null;
    writing.clear();
  }
}

async function write(batch: Note[]): Promise<void> {
  try {
    const repo = getRepository();
    await repo.putMany(batch);
    // Creazione annullata mentre la nota era già in scrittura: la si toglie di nuovo, così non
    // ricompare al prossimo avvio dopo che l'utente ha letto "la nota non è stata creata".
    for (const note of batch) if (discarded.has(note.id)) await repo.delete(note.id);
    lastSavedAt = Date.now();
    savedListener?.(batch.filter((note) => !discarded.has(note.id)));
    saveStatus.value =
      pending.size > 0 ? { state: 'pending' } : { state: 'saved', at: lastSavedAt };
  } catch (error) {
    console.error(error);
    // Si rimettono in coda, senza scavalcare versioni più recenti arrivate nel frattempo.
    for (const note of batch) {
      if (!pending.has(note.id) && !discarded.has(note.id)) pending.set(note.id, note);
    }
    saveStatus.value = { state: 'error', message: saveErrorMessage(error) };
    timer ??= setTimeout(() => void flushSaves(), RETRY_DELAY_MS);
  }
}

function saveErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') {
    return 'Spazio di archiviazione esaurito: le ultime modifiche non sono salvate.';
  }
  // Non suggerire di ricaricare: le modifiche esistono solo in memoria e andrebbero perse.
  return 'Le ultime modifiche non sono salvate: riprovo da solo, oppure premi Ctrl+S. Prima di ricaricare la pagina copia il testo.';
}

/**
 * Salva quando la pagina viene nascosta (cambio scheda, chiusura, telefono in tasca): è
 * l'ultimo momento affidabile. Se si chiude con modifiche ancora in volo il browser chiede
 * conferma, così non si perdono gli ultimi tasti.
 */
export function startAutosaveLifecycle(target: Window = window): () => void {
  // Se un'altra scheda aggiorna lo schema, prima di cedere la connessione si salva la coda.
  setBeforeCloseHook(flushSaves);
  const onHidden = () => {
    if (target.document.visibilityState === 'hidden') void flushSaves();
  };
  const onPageHide = () => void flushSaves();
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges()) return;
    void flushSaves();
    e.preventDefault();
    // Alcuni browser chiedono conferma solo se returnValue è impostato.
    e.returnValue = '';
  };
  target.document.addEventListener('visibilitychange', onHidden);
  target.addEventListener('pagehide', onPageHide);
  // beforeunload solo finché ci sono modifiche da salvare: un listener fisso esclude la pagina
  // dalla cache avanti/indietro e cambia la chiusura delle schede in Firefox.
  const stopWatching = effect(() => {
    if (saveStatus.value.state === 'saved')
      target.removeEventListener('beforeunload', onBeforeUnload);
    else target.addEventListener('beforeunload', onBeforeUnload);
  });
  return () => {
    stopWatching();
    target.document.removeEventListener('visibilitychange', onHidden);
    target.removeEventListener('pagehide', onPageHide);
    target.removeEventListener('beforeunload', onBeforeUnload);
    setBeforeCloseHook(undefined);
  };
}

/** Solo per i test. */
export function resetAutosaveForTests(): void {
  clearTimeout(timer);
  timer = undefined;
  pending.clear();
  discarded.clear();
  writing.clear();
  running = null;
  lastSavedAt = null;
  saveStatus.value = { state: 'saved', at: null };
}
