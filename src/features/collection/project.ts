import type { Note } from '../notes/note';
import { categoryOf, noteInfo } from './tags';
import type { CollectionFilter } from './views';

/**
 * Modalità progetto: si sceglie un tag `#progetto/nome` e l'app mostra solo le sue note
 * (raccolta, schede, ricerca, pagina senza schede). Le altre schede restano aperte, messe da
 * parte, e tornano uscendo. Vive solo in memoria, come il filtro: contiene un nome di tag.
 */
export interface ActiveProject {
  tag: string;
  /** Filtro e scheda attiva di prima di entrare, ripristinati all'uscita. */
  previousFilter: CollectionFilter;
  previousActive: string | null;
}

export function isProjectTag(tag: string): boolean {
  return categoryOf(tag) === 'progetto';
}

export function inProject(note: Note, tag: string): boolean {
  return noteInfo(note).tags.includes(tag);
}

export function projectNotes(notes: readonly Note[], tag: string): Note[] {
  return notes.filter((note) => inProject(note, tag));
}

/** Il filtro della raccolta visto da fuori: nel progetto vale anche il suo tag (viste salvate). */
export function withProjectTag(filter: CollectionFilter, tag: string): CollectionFilter {
  return filter.tags.includes(tag) ? filter : { ...filter, tags: [tag, ...filter.tags] };
}

/** Dentro il progetto il suo tag è implicito: non si ripete nel filtro. */
export function withoutProjectTag(filter: CollectionFilter, tag: string): CollectionFilter {
  return filter.tags.includes(tag)
    ? { ...filter, tags: filter.tags.filter((t) => t !== tag) }
    : filter;
}
