import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { renderMarkdown } from './markdown';

/** Pausa prima di ridisegnare l'anteprima mentre si scrive: le note lunghe restano fluide. */
export const PREVIEW_DELAY_MS = 120;

interface PreviewProps {
  text: string;
  /** Doppio clic (o Invio) per scrivere: `line` è la riga del sorgente del blocco toccato. */
  onRequestEdit: (line: number | null) => void;
  /** Prende il focus quando cambia (per esempio passando alla sola anteprima). */
  focusToken?: number | undefined;
}

function sourceLine(target: EventTarget | null): number | null {
  const block = target instanceof Element ? target.closest('[data-line]') : null;
  const line = Number(block?.getAttribute('data-line'));
  return block && Number.isInteger(line) ? line : null;
}

export function Preview({ text, onRequestEdit, focusToken }: PreviewProps) {
  const ref = useRef<HTMLElement>(null);
  const rendered = useRef(false);

  // Il primo disegno è immediato (niente lampo vuoto), poi si aspetta una pausa nella scrittura.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    if (!rendered.current) {
      rendered.current = true;
      element.replaceChildren(renderMarkdown(text));
      return undefined;
    }
    const timer = setTimeout(() => element.replaceChildren(renderMarkdown(text)), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (focusToken !== undefined) ref.current?.focus({ preventScroll: true });
  }, [focusToken]);

  return (
    <article
      ref={ref}
      class="preview"
      tabIndex={0}
      aria-label="Anteprima della nota"
      title="Doppio clic per scrivere"
      onDblClick={(e) => {
        // Il doppio clic seleziona una parola: non serve, si torna al testo.
        window.getSelection()?.removeAllRanges();
        onRequestEdit(sourceLine(e.target));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          onRequestEdit(null);
        }
      }}
    />
  );
}
