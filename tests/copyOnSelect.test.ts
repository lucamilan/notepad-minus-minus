import { EditorSelection, EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearCopyNotice,
  copyNotice,
  copyNoticeText,
  copyText,
  loadCopyOnSelect,
  selectedText,
} from '../src/features/editor/copyOnSelect';

afterEach(() => clearCopyNotice());

describe('copia alla selezione', () => {
  it('è attiva di default; si spegne solo con "off"', () => {
    expect(loadCopyOnSelect(undefined)).toBe(true);
    expect(loadCopyOnSelect({ getItem: () => null })).toBe(true);
    expect(loadCopyOnSelect({ getItem: () => 'on' })).toBe(true);
    expect(loadCopyOnSelect({ getItem: () => 'off' })).toBe(false);
    expect(
      loadCopyOnSelect({
        getItem: () => {
          throw new Error('bloccato');
        },
      }),
    ).toBe(true);
  });

  it('il testo è quello delle selezioni non vuote, una per riga', () => {
    const state = EditorState.create({
      doc: 'uno due tre',
      extensions: EditorState.allowMultipleSelections.of(true),
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.cursor(5),
        EditorSelection.range(8, 11),
      ]),
    });
    expect(selectedText(state)).toBe('uno\ntre');
    expect(selectedText(EditorState.create({ doc: 'x' }))).toBe('');
  });

  it('copia e conta i caratteri (non le unità UTF-16) e le righe', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await copyText('città 😀\nfine', { writeText });
    expect(writeText).toHaveBeenCalledWith('città 😀\nfine');
    expect(copyNotice.value).toEqual({ kind: 'copied', chars: 12, lines: 2 });
    expect(copyNoticeText({ kind: 'copied', chars: 12, lines: 2 })).toBe(
      'Copiati 12 caratteri (2 righe)',
    );
    expect(copyNoticeText({ kind: 'copied', chars: 1, lines: 1 })).toBe('Copiato 1 carattere');
  });

  it('testo vuoto o di soli spazi: niente', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await copyText('  \n ', { writeText });
    expect(writeText).not.toHaveBeenCalled();
    expect(copyNotice.value).toBeNull();
  });

  it('se gli appunti rifiutano o mancano lo dice, senza errori', async () => {
    await copyText('testo', { writeText: () => Promise.reject(new Error('negato')) });
    expect(copyNotice.value).toEqual({ kind: 'failed' });
    expect(copyNoticeText({ kind: 'failed' })).toBe('Impossibile copiare negli appunti');
    clearCopyNotice();
    await copyText('testo', undefined as unknown as Pick<Clipboard, 'writeText'>);
    expect(copyNotice.value).toEqual({ kind: 'failed' });
  });

  it('l’avviso sparisce da solo dopo qualche secondo', async () => {
    vi.useFakeTimers();
    try {
      await copyText('testo', { writeText: () => Promise.resolve() });
      expect(copyNotice.value).not.toBeNull();
      vi.advanceTimersByTime(4000);
      expect(copyNotice.value).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
