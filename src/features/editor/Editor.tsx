import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { useEffect, useRef } from 'preact/hooks';
import { editorTheme } from './editorTheme';

interface EditorProps {
  initialText: string;
  label: string;
  onChange?: (text: string) => void;
}

// CodeMirror vive in uno shadow root: lì i suoi stili vanno in un foglio costruito
// (adoptedStyleSheets) invece che in un <style> inline, che la CSP (style-src 'self') bloccherebbe.
export function Editor({ initialText, label, onChange }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    const view = new EditorView({
      doc: initialText,
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

    return () => view.destroy();
    // L'editor si crea una sola volta: da lì in poi il testo lo gestisce CodeMirror.
  }, []);

  return <div class="editor-host" ref={hostRef} />;
}
