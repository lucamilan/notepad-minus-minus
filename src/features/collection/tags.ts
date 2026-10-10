import type { Note } from '../notes/note';

/**
 * Tag scritti nel testo: `#cliente/acme`, `#progetto/portale`, `#tipo/riunione` o liberi
 * (`#personale`). Iniziano con una lettera, quindi `# Titolo` e `#123` non sono tag.
 * Si confrontano in minuscolo; dentro i blocchi di codice non contano.
 */
export const TAG_PATTERN = /(^|[\s(])#(\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)?)/gu;

export const CATEGORIES = [
  { id: 'cliente', label: 'Clienti' },
  { id: 'progetto', label: 'Progetti' },
  { id: 'tipo', label: 'Tipi' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'] | 'altri';

export const OTHER_TAGS_LABEL = 'Altri tag';

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
/** Codice in linea, anche con più apici inversi (``a`b``). */
const INLINE_CODE = /(`+).*?\1/g;

/** Il testo senza blocchi di codice recintati né codice in linea. */
function withoutCode(text: string): string {
  let fence: string | null = null;
  const kept: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line)?.[1];
      if (open) fence = open;
      else kept.push(line.replace(INLINE_CODE, ''));
      continue;
    }
    // Chiude solo una riga di soli segni, dello stesso tipo e almeno altrettanti.
    const close = FENCE_CLOSE.exec(line)?.[1];
    if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
  }
  return kept.join('\n');
}

/** Tag del testo, in minuscolo e senza doppioni, nell'ordine in cui compaiono. */
export function tagsOf(text: string): readonly string[] {
  const prose = withoutCode(text);
  return [...new Set(Array.from(prose.matchAll(TAG_PATTERN), (m) => (m[2] ?? '').toLowerCase()))];
}

export function categoryOf(tag: string): CategoryId {
  const slash = tag.indexOf('/');
  if (slash <= 0) return 'altri';
  const prefix = tag.slice(0, slash);
  return CATEGORIES.find((c) => c.id === prefix)?.id ?? 'altri';
}

/** Nome da mostrare sotto la sua categoria: `cliente/acme` → `acme`. */
export function tagLabel(tag: string): string {
  return categoryOf(tag) === 'altri' ? tag : tag.slice(tag.indexOf('/') + 1);
}

const OPEN_TASK = /^\s*(?:[-+*]|\d+[.)])\s+\[ \]\s/gm;

export function openTaskCount(text: string): number {
  return text.match(OPEN_TASK)?.length ?? 0;
}

/**
 * Testo della nota senza titolo, tag e sintassi Markdown: per l'anteprima nell'elenco e i
 * frammenti della ricerca.
 */
export function bodyText(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .slice(1)
    .map((line) => line.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, ''))
    .join(' ')
    .replace(TAG_PATTERN, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_~`>|[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Come slice, ma senza spezzare a metà un carattere fuori dal piano base (emoji). */
export function sliceChars(text: string, start: number, end: number): string {
  const isLowSurrogate = (i: number) => {
    const code = text.charCodeAt(i);
    return code >= 0xdc00 && code <= 0xdfff;
  };
  let from = Math.max(0, start);
  let to = Math.min(text.length, end);
  if (from > 0 && isLowSurrogate(from)) from--;
  if (to < text.length && isLowSurrogate(to)) to--;
  return text.slice(from, to);
}

const EXCERPT_SOURCE_MAX = 2000;
const EXCERPT_LENGTH = 90;

/** Dati ricavati dal testo di una nota, per l'elenco, le viste e i suggerimenti. */
export interface NoteInfo {
  tags: readonly string[];
  openTasks: number;
  excerpt: string;
}

/**
 * Le note sono oggetti immutabili (ogni modifica ne crea uno nuovo): i dati ricavati si
 * calcolano una volta per oggetto e restano solo in memoria, legati alla nota (WeakMap),
 * così con migliaia di note un tasto ricalcola solo la nota modificata.
 */
const infoCache = new WeakMap<Note, NoteInfo>();

export function noteInfo(note: Note): NoteInfo {
  let info = infoCache.get(note);
  if (!info) {
    info = {
      tags: tagsOf(note.text),
      openTasks: openTaskCount(note.text),
      excerpt: sliceChars(bodyText(note.text.slice(0, EXCERPT_SOURCE_MAX)), 0, EXCERPT_LENGTH),
    };
    infoCache.set(note, info);
  }
  return info;
}

/** Conteggio delle note per ogni tag. */
export function tagCounts(notes: readonly Note[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of noteInfo(note).tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}
