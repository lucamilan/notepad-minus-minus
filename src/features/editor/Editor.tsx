import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { editorTheme } from './editorTheme';

interface EditorProps {
  initialText: string;
  label: string;
  onChange?: (text: string) => void;
  /** L'editor prende il focus appena montato. */
  autoFocus?: boolean | undefined;
  initialSelection?: { anchor: number; head: number } | undefined;
}

// CodeMirror vive in uno shadow root: lì i suoi stili vanno in un foglio costruito
// (adoptedStyleSheets) invece che in un <style> inline, che la CSP (style-src 'self') bloccherebbe.
export function Editor({ initialText, label, onChange, autoFocus, initialSelection }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
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
      ...(initialSelection && {
        selection: EditorSelection.single(
          Math.min(initialSelection.anchor, initialText.length),
          Math.min(initialSelection.head, initialText.length),
        ),
      }),
      root: shadow,
      parent: shadow,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
        editorTheme,
      ],
    });
    onChangeRef.current?.(view.state.doc.toString());
    if (autoFocus) view.focus();

    return () => view.destroy();
    // L'editor si crea una sola volta: da lì in poi il testo lo gestisce CodeMirror.
  }, []);

  return <div class="editor-host" ref={hostRef} />;
}
