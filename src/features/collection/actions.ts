import { batch } from '@preact/signals';
import { discardPendingSave, restorePendingSave, scheduleSave } from '../notes/autosave';
import { announceDeleted, announceSavedViewsChanged } from '../notes/crossTab';
import {
  currentLockEpoch,
  getRepository,
  notesState,
  removeNote,
  updateNote,
} from '../notes/store';
import { actionError, closeTab, editorFocusRequest, openTab } from '../tabs/actions';
import { collectionFilter, isNarrowScreen, savedViews, sidebarOverlayOpen } from './state';
import {
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

/** Apre la nota dalla raccolta o dalla ricerca e porta il focus sul testo. */
export function openNoteFromCollection(id: string): void {
  batch(() => {
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
  collectionFilter.value = filter;
}
