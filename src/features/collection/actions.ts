import { batch } from '@preact/signals';
import { announce } from '../../lib/announce';
import { discardPendingSave, restorePendingSave, scheduleSave } from '../notes/autosave';
import { announceDeleted, announceSavedViewsChanged } from '../notes/crossTab';
import {
  currentLockEpoch,
  getRepository,
  notesState,
  removeNote,
  updateNote,
} from '../notes/store';
import {
  actionError,
  activateTab,
  closeTab,
  editorFocusRequest,
  openProjectTabs,
  openTab,
} from '../tabs/actions';
import { tabsState } from '../tabs/tabs';
import { inProject, projectNotes, withoutProjectTag } from './project';
import {
  activeProject,
  collectionFilter,
  isNarrowScreen,
  savedViews,
  sidebarOverlayOpen,
} from './state';
import { tagLabel } from './tags';
import {
  NO_FILTER,
  parseSavedViews,
  sameFilter,
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEWS_META_KEY,
  type CollectionFilter,
  type SavedView,
} from './views';

/**
 * Fissa o sgancia la nota. Conta come una modifica (data compresa): così le altre schede la
 * rileggono e non la sganciano più tardi riscrivendo la loro copia.
 */
export function togglePinned(id: string, now: number = Date.now()): void {
  const updated = updateNote(id, (note) => ({ ...note, pinned: !note.pinned, modifiedAt: now }));
  if (updated) scheduleSave(updated);
}

/**
 * Elimina la nota dall'archivio (dopo la conferma nel dialogo). Prima esce dalla coda di
 * salvataggio, così un salvataggio in volo non la riscrive; se l'eliminazione fallisce la
 * nota resta com'era e torna a salvarsi.
 */
export async function deleteNote(id: string): Promise<boolean> {
  const state = notesState.value;
  const note = state.status === 'ready' ? state.notes.find((n) => n.id === id) : undefined;
  if (!note) return false;
  discardPendingSave(id);
  const epoch = currentLockEpoch();
  try {
    await getRepository().delete(id);
  } catch (error) {
    console.error(error);
    // Bloccate nel frattempo: la nota non deve tornare in memoria (né in coda).
    if (currentLockEpoch() !== epoch) return false;
    restorePendingSave(note);
    actionError.value = 'Non è stato possibile eliminare la nota. Riprova.';
    return false;
  }
  if (currentLockEpoch() !== epoch) return true;
  batch(() => {
    closeTab(id);
    removeNote(id);
  });
  announceDeleted(id);
  return true;
}

/**
 * Apre la nota dalla raccolta o dalla ricerca e porta il focus sul testo. Una nota fuori dal
 * progetto (dalla ricerca in tutte le note) fa uscire dal progetto.
 */
export function openNoteFromCollection(id: string): void {
  const project = activeProject.value;
  const state = notesState.value;
  const note = state.status === 'ready' ? state.notes.find((n) => n.id === id) : undefined;
  batch(() => {
    if (project && note && !inProject(note, project.tag)) exitProject();
    editorFocusRequest.value = { id };
    openTab(id);
    // Su schermi stretti la raccolta copre le note: si chiude per mostrare quella scelta.
    if (isNarrowScreen()) sidebarOverlayOpen.value = false;
  });
}

/**
 * Le viste salvate si rileggono dall'archivio prima di cambiarle: un'altra scheda può averne
 * aggiunte nel frattempo. Poi le altre schede ricevono solo il segnale di rileggerle.
 */
async function updateSavedViews(change: (views: SavedView[]) => SavedView[]): Promise<void> {
  try {
    const repo = getRepository();
    const epoch = currentLockEpoch();
    const stored = await repo.getMeta(SAVED_VIEWS_META_KEY);
    // Bloccate nel frattempo: le viste (nomi di tag) non devono tornare in memoria.
    if (currentLockEpoch() !== epoch) return;
    const next = change(parseSavedViews(stored));
    savedViews.value = next;
    await repo.putMeta(SAVED_VIEWS_META_KEY, next);
    announceSavedViewsChanged();
  } catch (error) {
    console.error('Viste non salvate', error);
    if (notesState.value.status !== 'ready') return;
    actionError.value = 'Non è stato possibile salvare le viste. Riprova.';
  }
}

export function saveCurrentView(name: string, filter: CollectionFilter): Promise<void> {
  const trimmed = name.trim().slice(0, SAVED_VIEW_NAME_MAX);
  if (!trimmed) return Promise.resolve();
  const view: SavedView = { name: trimmed, view: filter.view, tags: [...filter.tags] };
  return updateSavedViews((views) => [...views, view]);
}

export function removeSavedView(target: SavedView): Promise<void> {
  return updateSavedViews((views) => {
    const index = views.findIndex((v) => v.name === target.name && sameFilter(v, target));
    return index < 0 ? views : views.filter((_, i) => i !== index);
  });
}

export function applyFilter(filter: CollectionFilter): void {
  // Nel progetto il suo tag è implicito (una vista salvata o un clic sul tag nell'anteprima).
  const project = activeProject.value;
  collectionFilter.value = project ? withoutProjectTag(filter, project.tag) : filter;
}

/**
 * Entra nel progetto `tag` (o passa a un altro): restano visibili solo le sue note e le sue
 * schede, e si riaprono quelle lasciate aperte l'ultima volta nel progetto. Se la scheda attiva
 * non è del progetto diventa attiva quella salvata, o la prima sua, o nessuna. Filtro e scheda
 * attiva di prima si ricordano dall'ingresso nel primo progetto.
 */
export function enterProject(tag: string): void {
  const state = notesState.value;
  if (state.status !== 'ready') return;
  const current = activeProject.value;
  const ids = new Set(projectNotes(state.notes, tag).map((note) => note.id));
  batch(() => {
    activeProject.value = {
      tag,
      previousFilter: current?.previousFilter ?? collectionFilter.value,
      previousActive: current?.previousActive ?? tabsState.value.active,
    };
    collectionFilter.value = NO_FILTER;
    openProjectTabs(tag, (id) => ids.has(id));
  });
  const count = ids.size;
  announce(`Progetto ${tagLabel(tag)}: ${count === 1 ? '1 nota' : `${count} note`}`);
}

/**
 * Esce dal progetto: tornano tutte le schede e il filtro di prima. La nota attiva resta quella
 * del progetto; senza, torna la scheda che era attiva prima di entrare.
 */
export function exitProject(): void {
  const project = activeProject.value;
  if (!project) return;
  batch(() => {
    activeProject.value = null;
    collectionFilter.value = project.previousFilter;
    if (tabsState.value.active === null) activateTab(project.previousActive);
  });
}
