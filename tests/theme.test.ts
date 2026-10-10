import { describe, expect, it } from 'vitest';
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
} from '../src/features/settings/theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const failingStorage = {
  getItem: (): string | null => {
    throw new Error('bloccato');
  },
  setItem: () => {
    throw new Error('bloccato');
  },
  removeItem: () => {
    throw new Error('bloccato');
  },
};

describe('loadThemePreference', () => {
  it('legge una preferenza salvata', () => {
    expect(loadThemePreference(memoryStorage({ 'notepad:theme': 'dark' }))).toBe('dark');
  });

  it('torna a "system" con valori sconosciuti, storage assente o che lancia', () => {
    expect(loadThemePreference(memoryStorage({ 'notepad:theme': 'blu' }))).toBe('system');
    expect(loadThemePreference(undefined)).toBe('system');
    expect(loadThemePreference(failingStorage)).toBe('system');
  });
});

describe('saveThemePreference', () => {
  it('salva chiaro e scuro, e rimuove la chiave per "system"', () => {
    const storage = memoryStorage();
    saveThemePreference(storage, 'light');
    expect(storage.data.get('notepad:theme')).toBe('light');
    saveThemePreference(storage, 'system');
    expect(storage.data.has('notepad:theme')).toBe(false);
  });

  it('non lancia se lo storage non è disponibile', () => {
    expect(() => saveThemePreference(failingStorage, 'dark')).not.toThrow();
  });
});

describe('applyThemePreference', () => {
  it('imposta data-theme solo per una scelta esplicita', () => {
    const root = document.createElement('html');
    applyThemePreference(root, 'dark');
    expect(root.dataset['theme']).toBe('dark');
    applyThemePreference(root, 'system');
    expect(root.dataset['theme']).toBeUndefined();
  });
});
