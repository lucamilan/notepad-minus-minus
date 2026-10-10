import type { IDBPDatabase } from 'idb';
import type { NoteCodec } from './codec';
import type { NotepadSchema } from './database';
import { createNote, SAMPLE_NOTE_TEXT, sortNotes, type Note } from './note';

export interface NoteList {
  notes: Note[];
  /** Id dei record che non si riescono a decodificare: restano intatti nell'archivio. */
  unreadable: string[];
}

export interface NoteRepository {
  list(): Promise<NoteList>;
  get(id: string): Promise<Note | undefined>;
  put(note: Note): Promise<void>;
  /** Tutto o niente: se un record non si salva, nessuno viene salvato. */
  putMany(notes: readonly Note[]): Promise<void>;
  delete(id: string): Promise<void>;
  /** Salva `note` solo se l'archivio è vuoto, in modo atomico anche con più schede aperte. */
  addIfEmpty(note: Note): Promise<boolean>;
}

export function createNoteRepository(
  db: IDBPDatabase<NotepadSchema>,
  codec: NoteCodec,
): NoteRepository {
  return {
    async list() {
      const stored = await db.getAll('notes');
      const results = await Promise.allSettled(stored.map((s) => codec.decode(s)));
      const notes: Note[] = [];
      const unreadable: string[] = [];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') notes.push(result.value);
        else unreadable.push(stored[i]?.id ?? '?');
      });
      return { notes: sortNotes(notes), unreadable };
    },
    async get(id) {
      const stored = await db.get('notes', id);
      return stored ? codec.decode(stored) : undefined;
    },
    async put(note) {
      await db.put('notes', await codec.encode(note));
    },
    async putMany(notes) {
      // Si codifica prima di aprire la transazione: IndexedDB la chiude se si aspetta altro.
      const encoded = await Promise.all(notes.map((n) => codec.encode(n)));
      const tx = db.transaction('notes', 'readwrite');
      const pending: Promise<unknown>[] = [tx.done];
      try {
        // Un record non valido può far lanciare put() subito, prima di qualsiasi await:
        // in quel caso le scritture già accodate vanno annullate esplicitamente.
        for (const record of encoded) pending.push(tx.store.put(record));
        await Promise.all(pending);
      } catch (error) {
        // Le richieste annullate rifiutano con AbortError: l'errore utile è quello originale.
        for (const p of pending) p.catch(() => undefined);
        try {
          tx.abort();
        } catch {
          // La transazione era già stata annullata dal browser.
        }
        throw error;
      }
    },
    async delete(id) {
      await db.delete('notes', id);
    },
    async addIfEmpty(note) {
      const encoded = await codec.encode(note);
      // Le transazioni readwrite sullo stesso store sono serializzate dal browser:
      // contare e scrivere nella stessa transazione evita doppioni tra schede.
      const tx = db.transaction('notes', 'readwrite');
      const empty = (await tx.store.count()) === 0;
      if (empty) await tx.store.put(encoded);
      await tx.done;
      return empty;
    },
  };
}

/**
 * Note all'avvio: se l'archivio è vuoto (primo avvio, o eliminata l'ultima nota) crea e
 * salva la nota di esempio, così c'è sempre almeno una nota, come nella v1.
 */
export async function loadNotesEnsuringOne(
  repo: NoteRepository,
  now: () => number = Date.now,
): Promise<NoteList> {
  const current = await repo.list();
  if (current.notes.length > 0 || current.unreadable.length > 0) return current;
  await repo.addIfEmpty(createNote(SAMPLE_NOTE_TEXT, now()));
  return repo.list();
}
