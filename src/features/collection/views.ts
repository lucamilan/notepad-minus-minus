import type { Note } from '../notes/note';
import { noteInfo, tagLabel } from './tags';

export type ViewId = 'all' | 'recent' | 'open' | 'pinned' | 'untagged';

export const RECENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface ViewDefinition {
  id: ViewId;
  label: string;
  test: (note: Note, now: number) => boolean;
}

/** Viste automatiche della raccolta (decisione del Senior). */
export const VIEWS: readonly ViewDefinition[] = [
  { id: 'all', label: 'Tutte', test: () => true },
  {
    id: 'recent',
    label: 'Recenti',
    test: (note, now) => now - note.modifiedAt < RECENT_DAYS * DAY_MS,
  },
  { id: 'open', label: 'Attività aperte', test: (note) => noteInfo(note).openTasks > 0 },
  { id: 'pinned', label: 'Fissate', test: (note) => note.pinned },
  { id: 'untagged', label: 'Senza tag', test: (note) => noteInfo(note).tags.length === 0 },
];

export function viewDefinition(id: ViewId): ViewDefinition {
  return VIEWS.find((view) => view.id === id) ?? (VIEWS[0] as ViewDefinition);
}

export function isViewId(value: unknown): value is ViewId {
  return VIEWS.some((view) => view.id === value);
}

/** Filtro della raccolta: una vista più tag che la nota deve avere tutti. */
export interface CollectionFilter {
  view: ViewId;
  tags: readonly string[];
}

export const NO_FILTER: CollectionFilter = { view: 'all', tags: [] };

export function matchesFilter(note: Note, filter: CollectionFilter, now: number): boolean {
  if (!viewDefinition(filter.view).test(note, now)) return false;
  const { tags } = noteInfo(note);
  return filter.tags.every((tag) => tags.includes(tag));
}

export function isFiltered(filter: CollectionFilter): boolean {
  return filter.view !== 'all' || filter.tags.length > 0;
}

export function sameFilter(a: CollectionFilter, b: CollectionFilter): boolean {
  return (
    a.view === b.view &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag) => b.tags.includes(tag))
  );
}

export function withTagToggled(filter: CollectionFilter, tag: string): CollectionFilter {
  return filter.tags.includes(tag)
    ? { ...filter, tags: filter.tags.filter((t) => t !== tag) }
    : { ...filter, tags: [...filter.tags, tag] };
}

/** Nome proposto salvando il filtro come vista, es. "Acme · attività aperte". */
export function suggestViewName(filter: CollectionFilter): string {
  const parts = filter.tags.map(tagLabel);
  if (filter.view !== 'all') parts.push(viewDefinition(filter.view).label.toLowerCase());
  const name = parts.join(' · ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Vista salvata dall'utente. Contiene nomi di tag, quindi dati delle note: in F7 va cifrata. */
export interface SavedView extends CollectionFilter {
  name: string;
}

export const SAVED_VIEWS_META_KEY = 'savedViews';
const VALID_TAG = /^\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)?$/u;
export const SAVED_VIEW_NAME_MAX = 60;

export function parseSavedViews(value: unknown): SavedView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): SavedView[] => {
    if (typeof item !== 'object' || item === null) return [];
    const v = item as Record<string, unknown>;
    const tags = v['tags'];
    if (
      typeof v['name'] !== 'string' ||
      !isViewId(v['view']) ||
      !Array.isArray(tags) ||
      !tags.every((t): t is string => typeof t === 'string')
    ) {
      return [];
    }
    const name = v['name'].trim().slice(0, SAVED_VIEW_NAME_MAX);
    if (!name) return [];
    const valid = [...new Set(tags.map((t) => t.toLowerCase()).filter((t) => VALID_TAG.test(t)))];
    return [{ name, view: v['view'], tags: valid }];
  });
}
