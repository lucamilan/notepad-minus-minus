import { batch } from '@preact/signals';
import { discardPendingSave, restorePendingSave, scheduleSave } from '../notes/autosave';
import { announceDeleted } from '../notes/crossTab';
import { getRepository, notesState, removeNote, updateNote } from '../notes/store';
import { actionError, closeTab, editorFocusRequest, openTab } from '../tabs/actions';
import { collectionFilter, isNarrowScreen, savedViews, sidebarOverlayOpen } from './state';
import {
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEWS_META_KEY,
  type CollectionFilter,
  type SavedView,
} from './views';

/** Fissa o sgancia la nota: non cambia la data di modifica, ma si salva come una modifica. */
export function togglePinned(id: string): void {
  const updated = updateNote(id, (note) => ({ ...note, pinned: !note.pinned }));
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
  try {
    await getRepository().delete(id);
  } catch (error) {
    console.error(error);
    restorePendingSave(note);
    actionError.value = 'Non è stato possibile eliminare la nota. Riprova.';
    return false;
  }
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

function persistSavedViews(views: readonly SavedView[]): void {
  savedViews.value = views;
  try {
    getRepository()
      .putMeta(SAVED_VIEWS_META_KEY, views)
      .catch((error: unknown) => console.error('Viste non salvate', error));
  } catch (error) {
    console.error('Viste non salvate', error);
  }
}

export function saveCurrentView(name: string, filter: CollectionFilter): void {
  const trimmed = name.trim().slice(0, SAVED_VIEW_NAME_MAX);
  if (!trimmed) return;
  persistSavedViews([
    ...savedViews.value,
    { name: trimmed, view: filter.view, tags: [...filter.tags] },
  ]);
}

export function removeSavedView(index: number): void {
  persistSavedViews(savedViews.value.filter((_, i) => i !== index));
}

export function applyFilter(filter: CollectionFilter): void {
  collectionFilter.value = filter;
}
