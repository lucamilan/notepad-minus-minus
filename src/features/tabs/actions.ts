import { batch, signal } from '@preact/signals';
import { announce } from '../../lib/announce';
import { inProject } from '../collection/project';
import { activeProject, collectionFilter } from '../collection/state';
import { matchesFilter, NO_FILTER, type CollectionFilter } from '../collection/views';
import { discardPendingSave } from '../notes/autosave';
import { announceSaved, changedElsewhere } from '../notes/crossTab';
import {
  copyText,
  createNote,
  NEW_NOTE_TEXT,
  NEW_NOTE_TITLE_RANGE,
  type Note,
} from '../notes/note';
import {
  addNote,
  currentLockEpoch,
  getRepository,
  markStored,
  notesState,
  removeNote,
} from '../notes/store';
import { ensureEditorVisible } from '../preview/viewMode';
import {
  hiddenTabIds,
  TABS_META_KEY,
  tabsToSave,
  tabsState,
  visibleTabs,
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

/** Al blocco: richieste ed errori in sospeso riguardano note che escono dalla memoria. */
export function resetTabActionsForLock(): void {
  editorFocusRequest.value = null;
  actionError.value = null;
}

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

/**
 * Schede mostrate adesso: tutte, o in modalità progetto quelle delle sue note più l'attiva
 * (vedi `visibleTabs`). Chiusure e cambi di scheda si muovono solo tra queste.
 */
export function shownTabs(): string[] {
  const project = activeProject.value;
  const state = notesState.value;
  if (!project || state.status !== 'ready') return tabsState.value.open;
  const ids = new Set(
    state.notes.filter((note) => inProject(note, project.tag)).map((note) => note.id),
  );
  return visibleTabs(tabsState.value, (id) => ids.has(id));
}

export function openTab(id: string): void {
  commit(withOpened(tabsState.value, id));
}

/** Rende attiva una scheda già aperta, o nessuna (entrando in un progetto senza sue schede). */
export function activateTab(id: string | null): void {
  const state = tabsState.value;
  if (state.active === id || (id !== null && !state.open.includes(id))) return;
  commit({ open: state.open, active: id });
}

export function closeTab(id: string): void {
  commit(withClosed(tabsState.value, id, shownTabs()));
}

/** Chiude più schede con un solo salvataggio dello stato (importazione, F8). */
export function closeTabs(ids: Iterable<string>): void {
  const visible = shownTabs();
  let next = tabsState.value;
  for (const id of ids) next = withClosed(next, id, visible);
  commit(next);
}

/** Secondo clic di un doppio clic: non deve creare un'altra nota. */
export function isRepeatedClick(e: MouseEvent): boolean {
  return e.detail > 1;
}

export function focusTabs(): void {
  tabFocusRequest.value++;
}

/**
 * Chiude tutte le schede visibili con un solo salvataggio dello stato. Le note restano
 * nell'archivio e le modifiche in coda continuano a salvarsi; le schede nascoste delle note
 * illeggibili restano nello stato salvato (vedi `tabsToSave`). Restano aperte le note cambiate
 * in un'altra scheda del browser: il loro avviso aspetta ancora la scelta della versione. In un
 * progetto chiude solo le sue schede: quelle messe da parte restano.
 */
export function closeAllTabs(): void {
  const waiting = changedElsewhere.value;
  closeTabs(shownTabs().filter((id) => !waiting.has(id)));
}

/** Schede che "Chiudi le schede non fissate" chiuderebbe: tutte tranne fissate e in attesa. */
export function unpinnedTabIds(): string[] {
  const state = notesState.value;
  if (state.status !== 'ready') return [];
  const pinned = new Set(state.notes.filter((note) => note.pinned).map((note) => note.id));
  const waiting = changedElsewhere.value;
  return shownTabs().filter((id) => !pinned.has(id) && !waiting.has(id));
}

/** Come "Chiudi tutte", ma restano aperte anche le note fissate. */
export function closeUnpinnedTabs(): void {
  closeTabs(unpinnedTabIds());
}

export function closeActiveTab(): void {
  const { active } = tabsState.value;
  if (active !== null) closeTab(active);
}

/** Passa a un'altra scheda restando a scrivere: l'editor della nuova scheda prende il focus. */
export function cycleTabKeepingEditorFocus(delta: number): void {
  const next = withCycled(tabsState.value, delta, shownTabs());
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
  // Con un filtro attivo la nota nasce già con quei tag (e fissata, nella vista Fissate); in un
  // progetto anche con il suo tag, per primo.
  const filter = collectionFilter.value;
  const project = activeProject.value?.tag;
  const tags = project ? [project, ...filter.tags.filter((tag) => tag !== project)] : filter.tags;
  const tagLine = tags.map((tag) => `#${tag}`).join(' ');
  const note = {
    ...createNote(
      tagLine
        ? `${NEW_NOTE_TEXT}${tagLine}
`
        : NEW_NOTE_TEXT,
      now,
    ),
    pinned: filter.view === 'pinned',
  };
  await openNewNote(note, { ...NEW_NOTE_TITLE_RANGE }, now);
}

/**
 * Duplica la nota: il testo in memoria (modifiche non ancora salvate comprese) con " (copia)"
 * in fondo al titolo (`copyText`), id e date nuovi, non fissata. Si apre in una scheda nuova
 * col cursore all'inizio, come una nota nuova (stesso percorso di Alt+N, compreso
 * l'annullamento se il salvataggio fallisce).
 */
export async function duplicateNote(id: string, now: number = Date.now()): Promise<void> {
  const state = notesState.value;
  if (state.status !== 'ready') return;
  const source = state.notes.find((note) => note.id === id);
  if (!source) return;
  if (await openNewNote(createNote(copyText(source.text), now), { anchor: 0, head: 0 }, now)) {
    announce('Nota duplicata');
  }
}

/**
 * Apre subito la nota in una scheda nuova e poi la scrive nell'archivio. Restituisce true se
 * la nota è stata salvata con le note ancora sbloccate; se il salvataggio fallisce la
 * creazione si annulla (scheda, memoria, coda di salvataggio e filtro tornano com'erano).
 */
async function openNewNote(
  note: Note,
  selection: { anchor: number; head: number },
  now: number,
): Promise<boolean> {
  const filter = collectionFilter.value;
  // La scheda si apre prima che l'archivio confermi: chi preme Alt+N e scrive subito
  // non perde i primi caratteri. Se il salvataggio fallisce, la creazione si annulla.
  batch(() => {
    actionError.value = null;
    ensureEditorVisible();
    addNote(note);
    // Una vista che non la mostrerebbe (es. Attività aperte) lascia il posto a Tutte; se
    // nemmeno i tag del filtro la mostrano (una copia senza quei tag), si tolgono anche quelli.
    if (!matchesFilter(note, filter, now)) {
      const allWithTags: CollectionFilter = { view: 'all', tags: filter.tags };
      collectionFilter.value = matchesFilter(note, allWithTags, now) ? allWithTags : NO_FILTER;
    }
    editorFocusRequest.value = { id: note.id, selection };
    openTab(note.id);
  });
  const epoch = currentLockEpoch();
  try {
    await getRepository().put(note);
    if (currentLockEpoch() !== epoch) return false;
    markStored([note]);
    // Le altre schede del browser la rileggono dall'archivio (solo id e data, mai il testo).
    announceSaved(note);
    return true;
  } catch (error) {
    console.error(error);
    // Archivio chiuso (c'è già il messaggio) o note bloccate nel frattempo.
    if (notesState.value.status !== 'ready' || currentLockEpoch() !== epoch) return false;
    batch(() => {
      collectionFilter.value = filter;
      closeTab(note.id);
      removeNote(note.id);
      discardPendingSave(note.id);
      actionError.value =
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? 'Spazio di archiviazione esaurito: la nuova nota non è stata creata.'
          : 'Non è stato possibile creare la nota. Ricarica la pagina e riprova.';
    });
    return false;
  }
}
