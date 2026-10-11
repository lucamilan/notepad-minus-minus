import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Compartment, EditorSelection, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { editorTheme } from './editorTheme';
import { markdownEditing } from './markdown';

interface EditorProps {
  initialText: string;
  label: string;
  onChange?: (text: string) => void;
  /**
   * Richiesta di prendere il focus (ed eventualmente selezionare): vale al montaggio e ogni
   * volta che arriva un oggetto nuovo, per esempio dal doppio clic sull'anteprima.
   */
  focusRequest?: EditorFocus | undefined;
  /** Estensioni aggiuntive, lette solo alla creazione (es. suggerimenti dei tag). */
  extensions?: readonly Extension[] | undefined;
  /** Numeri di riga: tolti in modalità zen. Si possono cambiare senza ricreare l'editor. */
  gutters?: boolean | undefined;
}

export interface EditorFocus {
  selection?: { anchor: number; head: number } | undefined;
}

function gutterExtensions(shown: boolean): Extension {
  return shown ? [lineNumbers(), highlightActiveLineGutter()] : [];
}

function applyFocus(view: EditorView, request: EditorFocus): void {
  const { selection } = request;
  if (selection) {
    const length = view.state.doc.length;
    view.dispatch({
      selection: EditorSelection.single(
        Math.min(selection.anchor, length),
        Math.min(selection.head, length),
      ),
      scrollIntoView: true,
    });
  }
  view.focus();
}

// CodeMirror vive in uno shadow root: lì i suoi stili vanno in un foglio costruito
// (adoptedStyleSheets) invece che in un <style> inline, che la CSP (style-src 'self') bloccherebbe.
export function Editor({
  initialText,
  label,
  onChange,
  focusRequest,
  extensions,
  gutters = true,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gutterCompartment = useRef(new Compartment()).current;
  const viewRef = useRef<EditorView | null>(null);
  const handledRef = useRef<EditorFocus | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // useLayoutEffect e non useEffect: l'editor esiste già prima del disegno, così chi scrive
  // subito dopo Alt+N o "+ Nuova nota" non perde i primi tasti.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    const view = new EditorView({
      doc: initialText,
      root: shadow,
      parent: shadow,
      extensions: [
        gutterCompartment.of(gutterExtensions(gutters)),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        markdownEditing,
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
        editorTheme,
        ...(extensions ?? []),
      ],
    });
    viewRef.current = view;
    onChangeRef.current?.(view.state.doc.toString());
    if (focusRequest) applyFocus(view, focusRequest);
    handledRef.current = focusRequest;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // L'editor si crea una sola volta: da lì in poi il testo lo gestisce CodeMirror.
  }, []);

  // Richieste successive al montaggio (l'editor era già aperto, magari nascosto).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !focusRequest || focusRequest === handledRef.current) return;
    handledRef.current = focusRequest;
    applyFocus(view, focusRequest);
  }, [focusRequest]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: gutterCompartment.reconfigure(gutterExtensions(gutters)),
    });
  }, [gutters]);

  return <div class="editor-host" ref={hostRef} />;
}
