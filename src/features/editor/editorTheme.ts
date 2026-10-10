import { EditorView } from '@codemirror/view';

// I colori arrivano dalle variabili CSS della pagina, che attraversano lo shadow root:
// il tema chiaro/scuro dell'app vale anche per l'editor senza ricreare la vista.
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--paper)',
    color: 'var(--ink)',
  },
  // Indicatore di focus: il :focus-visible della pagina non attraversa lo shadow root.
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-gutters': { borderRightColor: 'var(--accent)', borderRightWidth: '2px' },
  '.cm-scroller': {
    fontFamily: 'var(--f-mono)',
    fontSize: '0.88rem',
    lineHeight: '1.7',
  },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 20px' },
  '.cm-gutters': {
    backgroundColor: 'var(--code)',
    color: 'var(--muted)',
    borderRight: '1px solid var(--line)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--selection)' },
  // Suggerimenti dei tag (@codemirror/autocomplete).
  '.cm-tooltip': {
    backgroundColor: 'var(--paper)',
    color: 'var(--ink)',
    border: '1px solid var(--line)',
    borderRadius: '9px',
    boxShadow: 'var(--shadow)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--f-body)',
    fontSize: '0.85rem',
    padding: '4px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 8px',
    borderRadius: '6px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--ink)',
  },
  '.cm-completionLabel::before': { content: '"#"', color: 'var(--muted)' },
  '.cm-completionDetail': {
    marginLeft: '12px',
    fontStyle: 'normal',
    fontFamily: 'var(--f-mono)',
    fontSize: '0.72rem',
    color: 'var(--muted)',
  },
});
