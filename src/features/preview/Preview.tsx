import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { renderMarkdown } from './markdown';

/** Pausa prima di ridisegnare l'anteprima mentre si scrive: le note lunghe restano fluide. */
export const PREVIEW_DELAY_MS = 120;
/** Anche scrivendo senza pause, l'anteprima non resta indietro più di così. */
export const PREVIEW_MAX_WAIT_MS = 500;

interface PreviewProps {
  text: string;
  /** Doppio clic (o Invio) per scrivere: `line` è la riga del sorgente del blocco toccato. */
  onRequestEdit: (line: number | null) => void;
  /** Prende il focus quando cambia (per esempio passando alla sola anteprima). */
  focusToken?: number | undefined;
}

function sourceLine(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  // Nei blocchi di codice la riga è sul <code>: il clic sul margine del <pre> lo cerca dentro.
  const block = target.closest('[data-line]') ?? target.querySelector(':scope > [data-line]');
  const line = Number(block?.getAttribute('data-line'));
  return block && Number.isInteger(line) ? line : null;
}

export function Preview({ text, onRequestEdit, focusToken }: PreviewProps) {
  const ref = useRef<HTMLElement>(null);
  const lastRender = useRef<number | null>(null);

  // Il primo disegno è immediato (niente lampo vuoto), poi si aspetta una pausa nella scrittura.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const draw = () => {
      lastRender.current = Date.now();
      element.replaceChildren(renderMarkdown(text));
    };
    if (lastRender.current === null) {
      draw();
      return undefined;
    }
    const sinceLast = Date.now() - lastRender.current;
    const timer = setTimeout(
      draw,
      Math.max(0, Math.min(PREVIEW_DELAY_MS, PREVIEW_MAX_WAIT_MS - sinceLast)),
    );
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
      title="Doppio clic o Invio per scrivere"
      aria-keyshortcuts="Enter"
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
