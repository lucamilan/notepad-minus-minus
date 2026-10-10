import { effect, signal } from '@preact/signals';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'notepad:theme';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

function isPreference(value: unknown): value is ThemePreference {
  return PREFERENCES.includes(value as ThemePreference);
}

// localStorage può essere assente o lanciare (finestra privata, dati del sito bloccati):
// in quel caso si torna al tema di sistema senza errori.
export function loadThemePreference(
  storage: Pick<Storage, 'getItem'> | undefined,
): ThemePreference {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  preference: ThemePreference,
): void {
  try {
    if (preference === 'system') storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, preference);
  } catch {
    // La preferenza vale solo per questa sessione.
  }
}

// "system" non imposta nulla: il CSS segue prefers-color-scheme.
export function applyThemePreference(root: HTMLElement, preference: ThemePreference): void {
  if (preference === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = preference;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const themePreference = signal<ThemePreference>(loadThemePreference(safeLocalStorage()));

export function startThemeSync(root: HTMLElement = document.documentElement): () => void {
  return effect(() => {
    const preference = themePreference.value;
    applyThemePreference(root, preference);
    saveThemePreference(safeLocalStorage(), preference);
  });
}
