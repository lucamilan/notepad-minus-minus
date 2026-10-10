import { bodyText, noteInfo, sliceChars } from '../collection/tags';
import { RECENT_DAYS } from '../collection/views';
import { noteTitle, type Note } from '../notes/note';

/**
 * Ricerca globale senza dipendenze. Accenti e maiuscole non contano; ogni parola deve
 * comparire nel titolo, nei tag o nel testo. Filtri: `#tag` (anche solo l'inizio o la parte
 * dopo la categoria) e `is:aperte`, `is:fissate`, `is:recenti`.
 * L'"indice" è la forma normalizzata dei testi, calcolata al volo e tenuta solo in memoria.
 */

const DIACRITICS = /\p{Mn}/gu;

export function normalize(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

/** Testo normalizzato più, per ogni suo carattere, la posizione nel testo originale. */
interface Normalized {
  text: string;
  map: number[];
}

function normalizeWithMap(original: string): Normalized {
  let text = '';
  const map: number[] = [];
  let index = 0;
  for (const char of original) {
    const plain = normalize(char);
    for (let i = 0; i < plain.length; i++) map.push(index);
    text += plain;
    index += char.length;
  }
  map.push(index);
  return { text, map };
}

export type StatusFilter = 'aperte' | 'fissate' | 'recenti';
const STATUS_FILTERS: readonly StatusFilter[] = ['aperte', 'fissate', 'recenti'];

export interface ParsedQuery {
  terms: string[];
  tags: string[];
  status: StatusFilter[];
}

export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], tags: [], status: [] };
  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const lower = normalize(token);
    if (lower.startsWith('#') && lower.length > 1) parsed.tags.push(lower.slice(1));
    else if (lower.startsWith('is:') && STATUS_FILTERS.includes(lower.slice(3) as StatusFilter))
      parsed.status.push(lower.slice(3) as StatusFilter);
    else parsed.terms.push(lower);
  }
  return parsed;
}

export function isEmptyQuery(query: ParsedQuery): boolean {
  return query.terms.length + query.tags.length + query.status.length === 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function tagMatches(tag: string, filter: string): boolean {
  const plain = normalize(tag);
  return plain.startsWith(filter) || plain.includes(`/${filter}`);
}

/** Forme normalizzate di una nota: l'indice della ricerca, solo in memoria e legato alla nota. */
interface IndexEntry {
  title: string;
  tags: string;
  body: string;
}

const index = new WeakMap<Note, IndexEntry>();

function indexEntry(note: Note): IndexEntry {
  let entry = index.get(note);
  if (!entry) {
    entry = {
      title: normalize(noteTitle(note.text)),
      tags: normalize(noteInfo(note).tags.join(' ')),
      body: normalize(note.text),
    };
    index.set(note, entry);
  }
  return entry;
}

export interface SearchResult {
  note: Note;
  score: number;
}

/** Note che soddisfano la ricerca, le più pertinenti prima. */
export function searchNotes(
  notes: readonly Note[],
  query: ParsedQuery,
  now: number = Date.now(),
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const note of notes) {
    const { tags, openTasks } = noteInfo(note);
    if (!query.tags.every((filter) => tags.some((tag) => tagMatches(tag, filter)))) continue;
    if (query.status.includes('aperte') && openTasks === 0) continue;
    if (query.status.includes('fissate') && !note.pinned) continue;
    if (query.status.includes('recenti') && now - note.modifiedAt >= RECENT_DAYS * DAY_MS) continue;

    const { title, tags: tagText, body } = indexEntry(note);
    let score = 0;
    let matched = true;
    for (const term of query.terms) {
      if (title.includes(term)) score += 3;
      else if (tagText.includes(term)) score += 2;
      else if (body.includes(term)) score += 1;
      else {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (note.pinned) score += 0.5;
    // A parità di parole trovate, le note toccate da poco salgono un po'.
    score += Math.max(0, 0.4 - (now - note.modifiedAt) / (60 * DAY_MS));
    results.push({ note, score });
  }
  return results.sort((a, b) => b.score - a.score || b.note.modifiedAt - a.note.modifiedAt);
}

/** Pezzo di testo da mostrare, evidenziato (`mark`) dove corrisponde a una parola cercata. */
export interface Segment {
  text: string;
  mark: boolean;
}

export function highlight(original: string, terms: readonly string[]): Segment[] {
  if (terms.length === 0 || original === '')
    return original ? [{ text: original, mark: false }] : [];
  const { text, map } = normalizeWithMap(original);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    if (!term) continue;
    let from = text.indexOf(term);
    while (from >= 0) {
      ranges.push([map[from] ?? 0, map[from + term.length] ?? original.length]);
      from = text.indexOf(term, from + term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last) continue;
    if (start > last) segments.push({ text: original.slice(last, start), mark: false });
    segments.push({ text: original.slice(start, end), mark: true });
    last = end;
  }
  if (last < original.length) segments.push({ text: original.slice(last), mark: false });
  return segments;
}

const SNIPPET_LENGTH = 120;
const SNIPPET_LEAD = 36;

/** Frammento del testo intorno alla prima parola trovata (o l'inizio del testo). */
export function snippet(text: string, terms: readonly string[]): Segment[] {
  const body = bodyText(text);
  const { text: plain, map } = normalizeWithMap(body);
  let best = -1;
  for (const term of terms) {
    const at = term ? plain.indexOf(term) : -1;
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  if (best < 0) return highlight(sliceChars(body, 0, SNIPPET_LENGTH), []);
  const start = Math.max(0, (map[best] ?? 0) - SNIPPET_LEAD);
  const piece = sliceChars(body, start, start + SNIPPET_LENGTH);
  const segments = highlight(piece, terms);
  return start > 0 ? [{ text: '…', mark: false }, ...segments] : segments;
}
