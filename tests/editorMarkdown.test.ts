import { deleteMarkupBackward } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState, type Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { continueMarkup, markdownEditing } from '../src/features/editor/markdown';

/** Stato con il cursore dove c'è `|`. */
function stateAt(text: string): EditorState {
  const cursor = text.indexOf('|');
  return EditorState.create({
    doc: text.replace('|', ''),
    selection: { anchor: cursor },
    extensions: markdownEditing,
  });
}

function run(
  command: typeof continueMarkup,
  text: string,
): { text: string; cursor: number } | null {
  let result: Transaction | undefined;
  const handled = command({ state: stateAt(text), dispatch: (tr) => (result = tr) });
  if (!handled || !result) return null;
  return { text: result.state.doc.toString(), cursor: result.state.selection.main.head };
}

describe('Markdown nell’editor', () => {
  it('riconosce titoli, enfasi e codice', () => {
    const state = stateAt('# Titolo\n\nTesto **forte** e `codice`|');
    const names = new Set<string>();
    syntaxTree(state).iterate({ enter: (node) => void names.add(node.name) });
    expect(names).toContain('ATXHeading1');
    expect(names).toContain('StrongEmphasis');
    expect(names).toContain('InlineCode');
  });

  it('riconosce le estensioni GFM: tabelle, barrato, attività', () => {
    const state = stateAt('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~via~~\n\n- [ ] fare|');
    const names = new Set<string>();
    syntaxTree(state).iterate({ enter: (node) => void names.add(node.name) });
    expect(names).toContain('Table');
    expect(names).toContain('Strikethrough');
    expect(names).toContain('Task');
  });

  it('Invio continua elenchi puntati, numerati, attività e citazioni', () => {
    expect(run(continueMarkup, '- uno|')?.text).toBe('- uno\n- ');
    expect(run(continueMarkup, '1. uno|')?.text).toBe('1. uno\n2. ');
    expect(run(continueMarkup, '- [x] fatto|')?.text).toBe('- [x] fatto\n- [ ] ');
    expect(run(continueMarkup, '> citazione|')?.text).toBe('> citazione\n> ');
  });

  it('Invio su una voce vuota esce dall’elenco', () => {
    expect(run(continueMarkup, '- uno\n- |')?.text).toBe('- uno\n');
    expect(run(continueMarkup, '1. uno\n2. |')?.text).toBe('1. uno\n');
  });

  it('fuori dagli elenchi Invio resta un a capo normale', () => {
    expect(run(continueMarkup, 'testo|')).toBeNull();
  });

  it('Backspace subito dopo il segno lo toglie, lasciando il rientro', () => {
    expect(run(deleteMarkupBackward, '- uno\n- |')?.text).toBe('- uno\n  ');
    expect(run(deleteMarkupBackward, '> uno\n> |')?.text).toBe('> uno\n');
  });
});
