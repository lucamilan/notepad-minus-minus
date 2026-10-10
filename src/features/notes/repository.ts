import type { IDBPDatabase, IDBPObjectStore } from 'idb';
import type { NoteCodec, StoredNote } from './codec';
import { KEYRING_META_KEY, type NotepadSchema } from './database';
import { createNote, SAMPLE_NOTE_TEXT, sortNotes, type Note } from './note';

export interface NoteList {
  notes: Note[];
  /** Id dei record che non si riescono a decodificare: restano intatti nell'archivio. */
  unreadable: string[];
}

export interface NoteSnapshot extends NoteList {
  records: ReadonlyMap<string, StoredNote>;
}

export interface ImportChange {
  put: readonly Note[];
  remove: readonly string[];
  expected: ReadonlyMap<string, StoredNote>;
  meta?: { key: string; value: unknown };
}

export interface NoteRepository {
  list(): Promise<NoteList>;
  get(id: string): Promise<Note | undefined>;
  put(note: Note): Promise<void>;
  /** Tutto o niente: se un record non si salva, nessuno viene salvato. */
  putMany(notes: readonly Note[]): Promise<void>;
  delete(id: string): Promise<void>;
  /** Come list(), più i record grezzi letti: l'istantanea su cui si pianifica un'importazione. */
  snapshot(): Promise<NoteSnapshot>;
  /**
   * Importazione (F8): elimina `remove`, scrive `put` e il dato di servizio `meta` in
   * un'unica transazione su `notes` e `meta`, tutto o niente. Dentro la transazione ogni
   * record da toccare si confronta con quello dell'istantanea (`expected`; assente = non
   * c'era): se è cambiato nel frattempo (un'altra scheda) non si tocca e il suo id torna tra
   * i `conflicts`. Chi chiama non deve mai passare id di record illeggibili.
   */
  applyImport(change: ImportChange): Promise<{ conflicts: string[] }>;
  /** Salva `note` solo se l'archivio è vuoto, in modo atomico anche con più schede aperte. */
  addIfEmpty(note: Note): Promise<boolean>;
  /**
   * Dati di servizio nello store `meta`, passati dal codec (quindi cifrati): un valore che
   * non si riesce a leggere vale undefined. Il portachiavi non passa da qui (keyringStore.ts).
   */
  getMeta(key: string): Promise<unknown>;
  putMeta(key: string, value: unknown): Promise<void>;
}

export function createNoteRepository(
  db: IDBPDatabase<NotepadSchema>,
  codec: NoteCodec,
): NoteRepository {
  async function snapshot(): Promise<NoteSnapshot> {
    const stored = await db.getAll('notes');
    const results = await Promise.allSettled(stored.map((s) => codec.decode(s)));
    const notes: Note[] = [];
    const unreadable: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') notes.push(result.value);
      else unreadable.push(stored[i]?.id ?? '?');
    });
    return {
      notes: sortNotes(notes),
      unreadable,
      records: new Map(stored.map((record) => [record.id, record])),
    };
  }

  return {
    async list() {
      const { notes, unreadable } = await snapshot();
      return { notes, unreadable };
    },
    snapshot,
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
      await writeAll(db, function* (store) {
        for (const record of encoded) yield store.put(record);
      });
    },
    async delete(id) {
      await db.delete('notes', id);
    },
    async applyImport({ put, remove, expected, meta }) {
      if (meta) assertNotKeyring(meta.key);
      // Tutto si codifica prima di aprire la transazione: IndexedDB la chiude se si aspetta
      // altro che le sue richieste.
      const encoded = await Promise.all(put.map((n) => codec.encode(n)));
      const encodedMeta = meta ? await codec.encodeMeta(meta.key, meta.value) : undefined;
      const tx = db.transaction(['notes', 'meta'], 'readwrite');
      const notesStore = tx.objectStore('notes');
      const pending: Promise<unknown>[] = [tx.done];
      try {
        const targets = [...remove, ...encoded.map((record) => record.id)];
        const reads = targets.map((id) => notesStore.get(id));
        pending.push(...reads);
        const current = await Promise.all(reads);
        const conflicts = new Set(
          targets.filter((id, i) => !sameRecord(current[i], expected.get(id))),
        );
        for (const id of remove) if (!conflicts.has(id)) pending.push(notesStore.delete(id));
        for (const record of encoded) {
          if (!conflicts.has(record.id)) pending.push(notesStore.put(record));
        }
        if (meta) pending.push(tx.objectStore('meta').put(encodedMeta, meta.key));
        await Promise.all(pending);
        return { conflicts: [...conflicts] };
      } catch (error) {
        for (const p of pending) p.catch(() => undefined);
        try {
          tx.abort();
        } catch {
          // La transazione era già stata annullata dal browser.
        }
        throw error;
      }
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
    async getMeta(key) {
      assertNotKeyring(key);
      const stored = await db.get('meta', key);
      if (stored === undefined) return undefined;
      try {
        return await codec.decodeMeta(key, stored);
      } catch (error) {
        // Solo chiave e tipo di errore: mai il contenuto.
        console.error(`Dato di servizio "${key}" illeggibile`, errorName(error));
        return undefined;
      }
    },
    async putMeta(key, value) {
      assertNotKeyring(key);
      const encoded = await codec.encodeMeta(key, value);
      await db.put('meta', encoded, key);
    },
  };
}

type NotesStore = IDBPObjectStore<NotepadSchema, ['notes'], 'notes', 'readwrite'>;

/**
 * Una transazione readwrite su `notes` con le richieste generate da `requests`, una alla
 * volta: tutto o niente. Un record non valido può far lanciare una richiesta subito, prima di
 * qualsiasi await: in quel caso quelle già accodate vanno annullate esplicitamente.
 */
async function writeAll(
  db: IDBPDatabase<NotepadSchema>,
  requests: (store: NotesStore) => Iterable<Promise<unknown>>,
): Promise<void> {
  const tx = db.transaction('notes', 'readwrite');
  const pending: Promise<unknown>[] = [tx.done];
  try {
    for (const request of requests(tx.store)) pending.push(request);
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
}

function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value);
}

/**
 * Stesso record grezzo (byte compresi)? Con il codec cifrato ogni scrittura ha un IV nuovo,
 * quindi un record riscritto da un'altra scheda non è mai uguale all'istantanea.
 */
export function sameRecord(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const tag = tagOf(a);
  if (tag !== tagOf(b) || typeof a !== 'object' || a === null || b === null) return false;
  if (tag === '[object ArrayBuffer]' || tag === '[object Uint8Array]') {
    const x = new Uint8Array(a as ArrayBuffer);
    const y = new Uint8Array(b as ArrayBuffer);
    return x.length === y.length && x.every((byte, i) => byte === y[i]);
  }
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameRecord(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every((key) =>
      sameRecord((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function assertNotKeyring(key: string): void {
  if (key === KEYRING_META_KEY) throw new Error('Il portachiavi non passa dal repository');
}

function errorName(error: unknown): string {
  return error instanceof Error || error instanceof DOMException ? error.name : typeof error;
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
