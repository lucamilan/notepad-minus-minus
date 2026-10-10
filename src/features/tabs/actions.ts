import { batch, signal } from '@preact/signals';
import { discardPendingSave } from '../notes/autosave';
import { createNote, NEW_NOTE_TEXT, NEW_NOTE_TITLE_RANGE } from '../notes/note';
import { addNote, getRepository, notesState, removeNote } from '../notes/store';
import {
  hiddenTabIds,
  TABS_META_KEY,
  tabsToSave,
  tabsState,
  withClosed,
  withCycled,
  withOpened,
  type TabsState,
} from './tabs';

/** Richiesta all'editor della nota `id`, appena montato, di prendere il focus (e selezionare). */
export interface EditorFocusRequest {
  id: string;
  selection?: { anchor: number; head: number };
}

export const editorFocusRequest = signal<EditorFocusRequest | null>(null);

/** Incrementato quando il focus deve tornare sulla scheda attiva (o su "Nuova nota"). */
export const tabFocusRequest = signal(0);

/** Ultimo errore di un'azione sulle note, mostrato sopra le schede. */
export const actionError = signal<string | null>(null);

function commit(next: TabsState): void {
  if (next === tabsState.value) return;
  tabsState.value = next;
  // Le transazioni readwrite sullo stesso store si eseguono nell'ordine in cui nascono:
  // l'ultimo stato vince anche con molti cambi di scheda ravvicinati.
  try {
    getRepository()
      .putMeta(TABS_META_KEY, tabsToSave(next, hiddenTabIds.current))
      .catch((error: unknown) => console.error('Schede non salvate', error));
  } catch (error) {
    // Archivio chiuso nel frattempo (aggiornamento da un'altra scheda): l'interfaccia lo segnala già.
    console.error('Schede non salvate', error);
  }
}

export function openTab(id: string): void {
  commit(withOpened(tabsState.value, id));
}

export function closeTab(id: string): void {
  commit(withClosed(tabsState.value, id));
}

/** Secondo clic di un doppio clic: non deve creare un'altra nota. */
export function isRepeatedClick(e: MouseEvent): boolean {
  return e.detail > 1;
}

export function focusTabs(): void {
  tabFocusRequest.value++;
}

export function closeActiveTab(): void {
  const { active } = tabsState.value;
  if (active !== null) closeTab(active);
}

/** Passa a un'altra scheda restando a scrivere: l'editor della nuova scheda prende il focus. */
export function cycleTabKeepingEditorFocus(delta: number): void {
  const next = withCycled(tabsState.value, delta);
  if (next.active !== null && next !== tabsState.value) {
    editorFocusRequest.value = { id: next.active };
  }
  commit(next);
}

/**
 * Crea una nota, la apre in una scheda nuova e la salva subito nell'archivio. Ogni chiamata
 * crea una nota: doppio clic e tasto tenuto premuto li filtrano i chiamanti (`isRepeatedClick`,
 * `e.repeat`), perché due Alt+N rapidi sono due note volute anche se la prima è ancora in scrittura.
 */
export async function createNoteInNewTab(now: number = Date.now()): Promise<void> {
  if (notesState.value.status !== 'ready') return;
  const note = createNote(NEW_NOTE_TEXT, now);
  // La scheda si apre prima che l'archivio confermi: chi preme Alt+N e scrive subito
  // non perde i primi caratteri. Se il salvataggio fallisce, la creazione si annulla.
  batch(() => {
    actionError.value = null;
    addNote(note);
    editorFocusRequest.value = { id: note.id, selection: { ...NEW_NOTE_TITLE_RANGE } };
    openTab(note.id);
  });
  try {
    await getRepository().put(note);
  } catch (error) {
    console.error(error);
    if (notesState.value.status !== 'ready') return; // archivio chiuso: c'è già il messaggio
    batch(() => {
      closeTab(note.id);
      removeNote(note.id);
      discardPendingSave(note.id);
      actionError.value =
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? 'Spazio di archiviazione esaurito: la nuova nota non è stata creata.'
          : 'Non è stato possibile creare la nota. Ricarica la pagina e riprova.';
    });
  }
}
