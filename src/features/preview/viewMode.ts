import { effect, signal } from '@preact/signals';

/**
 * Solo testo (sorgente), testo con il Markdown formattato dal vivo, testo e anteprima
 * affiancati, solo anteprima.
 */
export type ViewMode = 'edit' | 'live' | 'split' | 'preview';

export const VIEW_MODES: readonly ViewMode[] = ['edit', 'live', 'split', 'preview'];
const STORAGE_KEY = 'notepad:view-mode';
const DEFAULT_MODE: ViewMode = 'split';

function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODES.includes(value as ViewMode);
}

// Una preferenza dell'interfaccia, non un dato delle note: può stare in localStorage.
export function loadViewMode(storage: Pick<Storage, 'getItem'> | undefined): ViewMode {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return isViewMode(stored) ? stored : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const viewMode = signal<ViewMode>(loadViewMode(safeLocalStorage()));

/** Modalità successiva per Ctrl+E: Modifica → Dal vivo → Affiancata → Anteprima → Modifica. */
export function nextViewMode(mode: ViewMode): ViewMode {
  return VIEW_MODES[(VIEW_MODES.indexOf(mode) + 1) % VIEW_MODES.length] ?? DEFAULT_MODE;
}

/** Per scrivere serve l'editor: dalla sola anteprima si passa all'affiancata. */
export function ensureEditorVisible(): void {
  if (viewMode.value === 'preview') viewMode.value = 'split';
}

export function startViewModeSync(): () => void {
  return effect(() => {
    const mode = viewMode.value;
    try {
      safeLocalStorage()?.setItem(STORAGE_KEY, mode);
    } catch {
      // La scelta vale solo per questa sessione.
    }
  });
}
