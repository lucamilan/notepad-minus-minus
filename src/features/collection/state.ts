import { effect, signal } from '@preact/signals';
import type { ActiveProject } from './project';
import { NO_FILTER, type CollectionFilter, type SavedView } from './views';

/** Filtro attivo della raccolta: vive solo in memoria (contiene nomi di tag). */
export const collectionFilter = signal<CollectionFilter>(NO_FILTER);

/** Progetto in cui si lavora (modalità progetto), solo in memoria come il filtro. */
export const activeProject = signal<ActiveProject | null>(null);

/** Nota di cui si chiede conferma dell'eliminazione (il dialogo sta fuori dal contenuto inerte). */
export const deleteRequest = signal<string | null>(null);

/** Viste salvate, lette dall'archivio all'apertura (store `meta`, cifrate). */
export const savedViews = signal<readonly SavedView[]>([]);

/** Al blocco: filtro, viste e richieste contengono tag e id delle note. */
export function resetCollectionForLock(): void {
  collectionFilter.value = NO_FILTER;
  activeProject.value = null;
  deleteRequest.value = null;
  savedViews.value = [];
  sidebarOverlayOpen.value = false;
}

// Prima del segnale che la legge all'avvio (una const usata prima della dichiarazione lancia).
const STORAGE_KEY = 'notepad:sidebar';

/** Schermi larghi: la raccolta è una colonna che si può nascondere (Ctrl+\), scelta ricordata. */
export const sidebarPinned = signal<boolean>(loadSidebarPinned());
/** Schermi stretti: la raccolta è un pannello sopra le note, chiuso all'avvio. */
export const sidebarOverlayOpen = signal(false);

/** Larghezza sotto la quale la raccolta diventa un pannello sovrapposto (come in app.css). */
export const NARROW_QUERY = '(max-width: 1180px)';

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function loadSidebarPinned(): boolean {
  try {
    return safeLocalStorage()?.getItem(STORAGE_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

function queryNarrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
}

/** Schermo stretto: segue il media query (aggiornato da startSidebarSync). */
export const narrowScreen = signal(queryNarrow());

export function isNarrowScreen(): boolean {
  return narrowScreen.value;
}

/** La raccolta è visibile adesso? */
export function sidebarVisible(): boolean {
  return narrowScreen.value ? sidebarOverlayOpen.value : sidebarPinned.value;
}

/** Mostra o nasconde la raccolta nel modo giusto per la larghezza attuale. */
export function toggleSidebar(): void {
  if (isNarrowScreen()) sidebarOverlayOpen.value = !sidebarOverlayOpen.value;
  else sidebarPinned.value = !sidebarPinned.value;
}

export function showSidebar(): void {
  if (isNarrowScreen()) sidebarOverlayOpen.value = true;
  else sidebarPinned.value = true;
}

export function startSidebarSync(): () => void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null;
  const onChange = () => {
    narrowScreen.value = media?.matches ?? false;
    sidebarOverlayOpen.value = false;
  };
  media?.addEventListener('change', onChange);
  const stop = effect(() => {
    const pinned = sidebarPinned.value;
    try {
      if (pinned) safeLocalStorage()?.removeItem(STORAGE_KEY);
      else safeLocalStorage()?.setItem(STORAGE_KEY, 'hidden');
    } catch {
      // La scelta vale solo per questa sessione.
    }
  });
  return () => {
    stop();
    media?.removeEventListener('change', onChange);
  };
}
