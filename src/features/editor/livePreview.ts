import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/**
 * Anteprima dal vivo: sulle righe dove non c'è il cursore (né una selezione) i segni del
 * Markdown spariscono e il testo si vede formattato; sulla riga del cursore torna il sorgente.
 * Il documento non cambia: sono solo decorazioni. Tabelle, blocchi di codice, immagini e HTML
 * restano sorgente (con un carattere monospaziato).
 *
 * Gli elementi sono costruiti con createElement e stilizzati solo con classi (tema in
 * editorTheme.ts / livePreviewTheme): niente HTML né attributi style, per la CSP.
 */

/** Segni che spariscono fuori dalla riga del cursore (i link hanno un caso a parte). */
const HIDDEN_MARKS = new Set(['EmphasisMark', 'StrikethroughMark']);

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const bullet = document.createElement('span');
    bullet.className = 'cm-live-bullet';
    bullet.setAttribute('aria-hidden', 'true');
    bullet.textContent = '•';
    return bullet;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly label: string,
  ) {
    super();
  }

  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.label === this.label;
  }

  toDOM(): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-live-task';
    box.checked = this.checked;
    // Fuori dal giro del Tab: da tastiera si cambia il testo ("[ ]" / "[x]") sulla riga.
    box.tabIndex = -1;
    box.setAttribute('aria-label', this.label || 'Attività');
    return box;
  }

  // I clic arrivano al gestore mousedown qui sotto, che cambia il testo della nota.
  override ignoreEvent(): boolean {
    return false;
  }
}

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const rule = document.createElement('span');
    rule.className = 'cm-live-hr';
    rule.setAttribute('aria-hidden', 'true');
    return rule;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const hide = Decoration.replace({});
const quoteLine = Decoration.line({ class: 'cm-live-quote' });
const codeLine = Decoration.line({ class: 'cm-live-code' });
const tableLine = Decoration.line({ class: 'cm-live-table' });
const headingLine = (level: number) => Decoration.line({ class: `cm-live-h${level}` });

/** Numeri (da 1) delle righe toccate da una selezione: lì si vede il sorgente. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

interface PendingDecoration {
  from: number;
  to: number;
  value: Decoration;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const lineDecorations = new Map<number, Decoration>();
  const marks: PendingDecoration[] = [];

  /** Classe su ogni riga di un blocco (citazione, codice, tabella). */
  const decorateLines = (from: number, to: number, decoration: Decoration) => {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      if (!lineDecorations.has(line.from)) lineDecorations.set(line.from, decoration);
      pos = line.to + 1;
    }
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          decorateLines(node.from, node.from, headingLine(Number(heading[1])));
          return;
        }
        switch (name) {
          case 'FencedCode':
          case 'CodeBlock':
          case 'HTMLBlock':
            decorateLines(node.from, node.to, codeLine);
            return false;
          case 'Table':
            decorateLines(node.from, node.to, tableLine);
            return false;
          case 'LinkReference':
            // Definizioni "[nome]: url": restano sorgente, sono indirizzi da leggere.
            return false;
          case 'Link': {
            // Si vede solo il testo: via "[" e tutto da "]" in poi ("](url "titolo")",
            // "][nome]"). I segni interni (enfasi nel testo) si trattano nei figli.
            if (isActive(node.from)) return;
            const open = node.node.firstChild;
            const close = node.node.getChildren('LinkMark')[1];
            if (open?.name === 'LinkMark')
              marks.push({ from: open.from, to: open.to, value: hide });
            if (close && state.doc.lineAt(close.from).number === state.doc.lineAt(node.to).number) {
              marks.push({ from: close.from, to: node.to, value: hide });
            }
            return;
          }
          case 'LinkMark':
            // "<" e ">" dei link automatici: resta l'indirizzo.
            if (node.node.parent?.name === 'Autolink' && !isActive(node.from)) {
              marks.push({ from: node.from, to: node.to, value: hide });
            }
            return;
          case 'Image':
            // Le immagini restano sorgente (quelle remote non si caricano comunque).
            return false;
          case 'Blockquote':
            decorateLines(node.from, node.to, quoteLine);
            return;
          case 'HorizontalRule':
            if (!isActive(node.from)) marks.push({ from: node.from, to: node.to, value: rule });
            return;
          case 'HeaderMark': {
            // Solo "#": la sottolineatura dei titoli Setext (===, ---) resta.
            const parent = node.node.parent?.name ?? '';
            if (!parent.startsWith('ATXHeading') || isActive(node.from)) return;
            const line = state.doc.lineAt(node.from);
            // Il segno iniziale si toglie con lo spazio che segue; quello finale (## titolo ##)
            // con lo spazio che precede.
            if (node.from === line.from + (line.text.length - line.text.trimStart().length)) {
              const after = state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0;
              marks.push({ from: node.from, to: node.to + after, value: hide });
            } else {
              const before = state.sliceDoc(node.from - 1, node.from) === ' ' ? 1 : 0;
              marks.push({ from: node.from - before, to: node.to, value: hide });
            }
            return;
          }
          case 'QuoteMark':
            if (!isActive(node.from)) {
              const after = state.sliceDoc(node.to, node.to + 1) === ' ' ? 1 : 0;
              marks.push({ from: node.from, to: node.to + after, value: hide });
            }
            return;
          case 'CodeMark':
            // Solo i backtick del codice in linea: le recinzioni dei blocchi restano.
            if (node.node.parent?.name === 'InlineCode' && !isActive(node.from)) {
              marks.push({ from: node.from, to: node.to, value: hide });
            }
            return;
          case 'ListMark': {
            if (isActive(node.from)) return;
            const item = node.node.parent;
            const task = item?.getChild('Task')?.getChild('TaskMarker');
            if (task) {
              // "- [ ] " diventa una casella; il testo dell'attività ne è il nome accessibile.
              const checked = /x/i.test(state.sliceDoc(task.from, task.to));
              const line = state.doc.lineAt(task.to);
              const label = state.sliceDoc(task.to, line.to).trim();
              const end = state.sliceDoc(task.to, task.to + 1) === ' ' ? task.to + 1 : task.to;
              marks.push({
                from: node.from,
                to: end,
                value: Decoration.replace({ widget: new TaskWidget(checked, label) }),
              });
            } else if (item?.parent?.name === 'BulletList') {
              marks.push({ from: node.from, to: node.to, value: bullet });
            }
            return;
          }
          default:
            if (HIDDEN_MARKS.has(name) && !isActive(node.from)) {
              marks.push({ from: node.from, to: node.to, value: hide });
            }
        }
        return undefined;
      },
    });
  }

  // Il builder vuole le decorazioni in ordine: prima quelle di riga (larghezza zero in testa
  // alla riga), poi i segni; nessun segno attraversa un a capo.
  const all: PendingDecoration[] = [
    ...[...lineDecorations].map(([pos, value]) => ({ from: pos, to: pos, value })),
    ...marks.filter((mark) => mark.to > mark.from || mark.value !== hide),
  ];
  // A pari inizio prima il segno più lungo: quelli contenuti si scartano qui sotto.
  all.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide || b.to - a.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastEnd = -1;
  for (const { from, to, value } of all) {
    const isLine = from === to && lineDecorations.get(from) === value;
    // Decorazioni sovrapposte (casi limite del Markdown): si tiene la prima.
    if (!isLine && from < lastEnd) continue;
    builder.add(from, to, value);
    if (!isLine) lastEnd = to;
  }
  return builder.finish();
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Clic su una casella: "[ ]" ↔ "[x]" nel testo, senza spostare il cursore sulla riga. */
const toggleTaskOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('cm-live-task')) {
      return false;
    }
    event.preventDefault();
    const pos = view.posAtDOM(target);
    const line = view.state.doc.lineAt(pos);
    const match = /\[( |x|X)\]/.exec(line.text.slice(pos - line.from));
    if (!match) return true;
    const at = pos + match.index + 1;
    view.dispatch({
      changes: { from: at, to: at + 1, insert: match[1] === ' ' ? 'x' : ' ' },
      userEvent: 'input.toggle',
    });
    return true;
  },
});

const livePreviewTheme = EditorView.theme({
  // In questa modalità il testo usa il carattere del corpo; codice e tabelle restano
  // monospaziati per allineare le colonne.
  '.cm-content': { fontFamily: 'var(--f-body)' },
  '.cm-live-code, .cm-live-table': { fontFamily: 'var(--f-mono)', fontSize: '0.92em' },
  '.cm-live-code': { backgroundColor: 'var(--code)' },
  '.cm-live-quote': {
    borderLeft: '3px solid var(--accent)',
    color: 'var(--muted)',
  },
  '.cm-live-h1, .cm-live-h2, .cm-live-h3, .cm-live-h4, .cm-live-h5, .cm-live-h6': {
    fontFamily: 'var(--f-display)',
  },
  '.cm-live-h1': { paddingTop: '0.4em' },
  '.cm-live-h2': { paddingTop: '0.3em' },
  '.cm-live-bullet': { color: 'var(--muted)', paddingRight: '0.35em' },
  '.cm-live-task': {
    margin: '0 0.45em 0 0',
    verticalAlign: 'middle',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  '.cm-live-hr': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '1px solid var(--line)',
  },
});

/** Estensione della modalità "Dal vivo": si attiva e disattiva con un Compartment (Editor.tsx). */
export const livePreview: Extension = [livePreviewPlugin, toggleTaskOnClick, livePreviewTheme];
