import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
  markdownLanguage,
} from '@codemirror/lang-markdown';
import { HighlightStyle, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * Evidenziazione del Markdown nel testo: titoli più grandi, enfasi, codice, link. Il testo
 * resta sorgente puro; i segni (#, *, `, >, -) restano visibili ma attenuati. Colori e font
 * dalle variabili CSS della pagina, che attraversano lo shadow root (vedi editorTheme.ts).
 */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.4em', fontWeight: '600' },
  { tag: tags.heading2, fontSize: '1.22em', fontWeight: '600' },
  { tag: tags.heading3, fontSize: '1.1em', fontWeight: '600' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--muted)', textDecoration: 'underline' },
  { tag: tags.monospace, backgroundColor: 'var(--code)', borderRadius: '3px' },
  { tag: tags.quote, color: 'var(--muted)', fontStyle: 'italic' },
  // Segni del Markdown (#, *, _, `, >, -, [, ]), etichette e linee orizzontali.
  {
    tag: [tags.processingInstruction, tags.contentSeparator, tags.labelName],
    color: 'var(--muted)',
  },
]);

/**
 * Scrivendo sopra una selezione che comprende testo con stili diversi (titoli, grassetto) il
 * browser conserva lo "stile di battitura" e inserisce `<span style>` nel contenteditable: la
 * CSP (style-src) lo blocca e segnala una violazione. Qui la sostituzione la fa CodeMirror, come
 * per la battitura normale (stesso userEvent, quindi anche i suggerimenti dei tag).
 */
const replaceSelectionWithoutBrowserStyles = EditorView.domEventHandlers({
  beforeinput(event, view) {
    if (event.inputType !== 'insertText' || event.data === null || event.isComposing) return false;
    if (view.composing || view.state.selection.ranges.every((range) => range.empty)) return false;
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(event.data), {
      scrollIntoView: true,
      userEvent: 'input.type',
    });
    return true;
  },
});

/**
 * Invio dentro un elenco: nuova voce con lo stesso segno. Su una voce vuota esce
 * dall'elenco (nonTightLists: false), invece di aggiungere una riga vuota sopra la voce.
 */
export const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/**
 * Markdown (CommonMark + GFM: tabelle, barrato, attività) per l'editor. Invio continua liste,
 * attività e citazioni (su una voce vuota la toglie); Backspace subito dopo il segno di una
 * voce lo toglie (resta il rientro, un altro Backspace lo cancella).
 * Solo `markdownLanguage`, non `markdown()`: così l'HTML (lang-html) resta fuori dal bundle.
 */
export const markdownEditing: Extension = [
  new LanguageSupport(markdownLanguage),
  syntaxHighlighting(markdownHighlight),
  replaceSelectionWithoutBrowserStyles,
  Prec.high(
    keymap.of([
      { key: 'Enter', run: continueMarkup },
      { key: 'Backspace', run: deleteMarkupBackward },
    ]),
  ),
];
