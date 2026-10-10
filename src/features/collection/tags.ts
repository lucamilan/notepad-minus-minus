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

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /`[^`\n]*`/g;

/** Il testo senza blocchi di codice recintati né codice in linea. */
function withoutCode(text: string): string {
  let fence: string | null = null;
  const kept: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const marker = FENCE_LINE.exec(line)?.[1];
    if (fence === null && marker) fence = marker;
    else if (fence !== null && marker?.startsWith(fence[0] ?? '') && marker.length >= fence.length)
      fence = null;
    else if (fence === null) kept.push(line.replace(INLINE_CODE, ''));
  }
  return kept.join('\n');
}

const cache = new Map<string, readonly string[]>();
const CACHE_LIMIT = 500;

/** Tag della nota, in minuscolo e senza doppioni, nell'ordine in cui compaiono. */
export function tagsOf(text: string): readonly string[] {
  const cached = cache.get(text);
  if (cached) return cached;
  const prose = withoutCode(text);
  const tags = [
    ...new Set(Array.from(prose.matchAll(TAG_PATTERN), (m) => (m[2] ?? '').toLowerCase())),
  ];
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, tags);
  return tags;
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

/** Conteggio delle note per ogni tag. */
export function tagCounts(notes: readonly Note[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of tagsOf(note.text)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
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
