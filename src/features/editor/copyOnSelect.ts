import { signal } from '@preact/signals';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { announce } from '../../lib/announce';

/**
 * Copia alla selezione, come nei terminali: il testo selezionato con il mouse (trascinando,
 * doppio o triplo clic, Maiusc+clic) va subito negli appunti e la barra di stato dice quanti
 * caratteri. Solo con il mouse: con la tastiera (Maiusc+frecce, Ctrl+A) si copia con Ctrl+C.
 */

const STORAGE_KEY = 'notepad:copy-on-select';
const NOTICE_MS = 4000;

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// Una preferenza dell'interfaccia, non un dato delle note: può stare in localStorage.
export function loadCopyOnSelect(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const copyOnSelect = signal(loadCopyOnSelect(safeLocalStorage()));

export function setCopyOnSelect(enabled: boolean): void {
  copyOnSelect.value = enabled;
  try {
    safeLocalStorage()?.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // La scelta vale solo per questa sessione.
  }
}

export type CopyNotice = { kind: 'copied'; chars: number; lines: number } | { kind: 'failed' };

/** Esito dell'ultima copia, mostrato per qualche secondo nella barra di stato. */
export const copyNotice = signal<CopyNotice | null>(null);

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function showNotice(notice: CopyNotice): void {
  clearTimeout(noticeTimer);
  copyNotice.value = notice;
  noticeTimer = setTimeout(() => (copyNotice.value = null), NOTICE_MS);
}

export function clearCopyNotice(): void {
  clearTimeout(noticeTimer);
  noticeTimer = undefined;
  copyNotice.value = null;
}

export function copyNoticeText(notice: CopyNotice): string {
  if (notice.kind === 'failed') return 'Impossibile copiare negli appunti';
  const chars = notice.chars === 1 ? '1 carattere' : `${notice.chars} caratteri`;
  const lines = notice.lines > 1 ? ` (${notice.lines} righe)` : '';
  return `${notice.chars === 1 ? 'Copiato' : 'Copiati'} ${chars}${lines}`;
}

/** Testo delle selezioni non vuote, una per riga come fa Ctrl+C di CodeMirror. */
export function selectedText(state: EditorState): string {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join(state.lineBreak);
}

/** Copia `text` negli appunti e mostra l'esito. Testo vuoto o di soli spazi: niente. */
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard as
    Clipboard | undefined,
): Promise<void> {
  if (!text.trim()) return;
  try {
    if (!clipboard) throw new Error('Appunti non disponibili');
    await clipboard.writeText(text);
  } catch {
    showNotice({ kind: 'failed' });
    return;
  }
  const notice: CopyNotice = {
    kind: 'copied',
    chars: Array.from(text).length,
    lines: text.split(/\r\n|\r|\n/).length,
  };
  showNotice(notice);
  announce(copyNoticeText(notice));
}

/**
 * Estensione dell'editor: alla fine di una selezione col mouse (mouseup, anche fuori
 * dall'editor) copia il testo selezionato. Dopo un giro di eventi, quando CodeMirror ha già
 * aggiornato la selezione; il rilascio del tasto vale ancora come gesto dell'utente.
 */
export const copyOnSelectExtension: Extension = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const doc = view.dom.ownerDocument;
    const before = view.state.selection;
    const onUp = () => {
      setTimeout(() => {
        if (!copyOnSelect.value || !view.dom.isConnected) return;
        // Solo una selezione fatta con questo clic (non una precedente, da tastiera).
        if (view.state.selection.eq(before)) return;
        void copyText(selectedText(view.state));
      }, 0);
    };
    doc.addEventListener('mouseup', onUp, { capture: true, once: true });
    return false;
  },
});
