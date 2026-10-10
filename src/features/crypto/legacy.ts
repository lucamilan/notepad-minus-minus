import { signal } from '@preact/signals';
import { openDB, type IDBPDatabase } from 'idb';
import { SAVED_VIEWS_META_KEY } from '../collection/views';
import { plainCodec, type NoteCodec, type StoredNote } from '../notes/codec';
import { deleteDatabase, LEGACY_DB_NAME, type NotepadSchema } from '../notes/database';
import type { Note } from '../notes/note';
import { TABS_META_KEY } from '../tabs/tabs';
import { bytesOf } from './keys';

/**
 * Migrazione dal database in chiaro di F2–F6 (`notepad-minus-minus`, record "plain-v1") a
 * quello cifrato. Gira dopo la creazione della passphrase e dopo ogni sblocco.
 *
 * 1. Il vecchio database si apre con la versione successiva (un aggiornamento che non cambia
 *    nulla): le schede di F2–F6 ancora aperte ricevono `versionchange`, salvano la loro coda
 *    e chiudono la connessione; solo allora l'apertura riesce, quindi nessuna scrittura arriva
 *    dopo la lettura. Se resta bloccata troppo a lungo si rinuncia e si riprova al prossimo
 *    sblocco, senza eliminare nulla.
 * 2. Le note lette si cifrano: per un id già presente nel database cifrato vince la copia con
 *    `modifiedAt` più recente. Gli id importati (con la data importata) restano, cifrati, in
 *    `meta.legacyImported`: una nota eliminata dopo l'importazione non ricompare se il vecchio
 *    database sopravvive (chiusura tra scrittura ed eliminazione, record illeggibili).
 * 3. Il vecchio database si elimina. Se un record non si legge resta, e le impostazioni
 *    offrono di eliminarlo (`legacyLeftover`).
 */
export const LEGACY_IMPORTED_META_KEY = 'legacyImported';
export const LEGACY_BLOCKED_TIMEOUT_MS = 10_000;

/** Record illeggibili rimasti nel vecchio database in chiaro (0: nessuno, o già eliminato). */
export const legacyLeftover = signal(0);

/** Il database esiste? Senza indexedDB.databases() lo si apre senza versione e si guarda. */
export async function databaseExists(name: string): Promise<boolean> {
  return (await databaseVersion(name)) !== undefined;
}

/** Versione del database, undefined se non esiste (o è vuoto, senza store `notes`). */
async function databaseVersion(name: string): Promise<number | undefined> {
  if (typeof indexedDB.databases === 'function') {
    try {
      const list = await indexedDB.databases();
      return list.find((info) => info.name === name)?.version;
    } catch {
      // Si prova nell'altro modo.
    }
  }
  const db = await openDB(name);
  const exists = db.objectStoreNames.contains('notes');
  const { version } = db;
  db.close();
  // Aprirlo senza versione l'ha appena creato vuoto: si toglie.
  if (!exists) void deleteDatabase(name).catch((error: unknown) => console.error(error));
  return exists ? version : undefined;
}

/**
 * Apre `name` alla versione `version` e aspetta che le altre connessioni si chiudano. Dopo
 * `timeoutMs` rinuncia (null); se l'apertura riesce più tardi la connessione si chiude subito.
 */
async function openTakingOver(
  name: string,
  version: number,
  timeoutMs: number,
): Promise<IDBPDatabase | null> {
  const opening = openDB(name, version, {
    // Un'altra migrazione (un'altra scheda di questa versione) vuole a sua volta il database.
    blocking: () => void opening.then((db) => db.close()),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([opening, timeout]);
    if (result === null) {
      opening.then(
        (db) => db.close(),
        () => undefined,
      );
    }
    return result;
  } catch (error) {
    // Per esempio un'altra scheda l'ha appena aggiornato o eliminato: si riprova la prossima volta.
    console.warn('Vecchio archivio non aperto', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface LegacyMigration {
  migrated: number;
  unreadable: number;
  /** Altre schede non hanno lasciato il vecchio database: nulla è stato toccato. */
  blocked: boolean;
  /** Eliminazione del vecchio database, se avviata: può restare in attesa di altre schede. */
  deletion: Promise<void> | null;
}

const NOTHING: LegacyMigration = { migrated: 0, unreadable: 0, blocked: false, deletion: null };

type ImportedMap = Record<string, number>;

function parseImported(value: unknown): ImportedMap {
  const map: ImportedMap = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return map;
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at)) map[id] = at;
  }
  return map;
}

/** Stesso record di prima? Ogni scrittura cifrata ha un IV nuovo, quindi basta confrontarlo. */
function sameRecord(a: StoredNote | undefined, b: StoredNote | undefined): boolean {
  if (!a || !b) return a === b;
  const ivA = bytesOf((a.payload as Record<string, unknown> | null)?.['iv']);
  const ivB = bytesOf((b.payload as Record<string, unknown> | null)?.['iv']);
  return !!ivA && !!ivB && ivA.length === ivB.length && ivA.every((byte, i) => byte === ivB[i]);
}

export async function migrateLegacy(
  target: IDBPDatabase<NotepadSchema>,
  codec: NoteCodec,
  options: { includeMeta: boolean; blockedTimeoutMs?: number },
): Promise<LegacyMigration> {
  const version = await databaseVersion(LEGACY_DB_NAME);
  if (version === undefined) {
    legacyLeftover.value = 0;
    return NOTHING;
  }
  const legacy = await openTakingOver(
    LEGACY_DB_NAME,
    version + 1,
    options.blockedTimeoutMs ?? LEGACY_BLOCKED_TIMEOUT_MS,
  );
  if (!legacy) {
    console.warn(
      'Vecchio archivio ancora aperto in un’altra scheda: lo si cifra al prossimo sblocco',
    );
    return { ...NOTHING, blocked: true };
  }

  // Istantanea letta con le altre schede ormai chiuse.
  let stored: StoredNote[] = [];
  const meta: [string, unknown][] = [];
  const hasNotes = legacy.objectStoreNames.contains('notes');
  try {
    if (hasNotes) stored = (await legacy.getAll('notes')) as StoredNote[];
    if (hasNotes && options.includeMeta && legacy.objectStoreNames.contains('meta')) {
      for (const key of [TABS_META_KEY, SAVED_VIEWS_META_KEY]) {
        const value: unknown = await legacy.get('meta', key);
        if (value !== undefined) meta.push([key, value]);
      }
    }
  } finally {
    legacy.close();
  }

  const results = await Promise.allSettled(stored.map((record) => plainCodec.decode(record)));
  const notes: Note[] = [];
  for (const result of results) if (result.status === 'fulfilled') notes.push(result.value);
  const unreadable = results.length - notes.length;

  // Tutto ciò che richiede la crittografia si fa prima di aprire la transazione di scrittura:
  // IndexedDB la chiude se si aspetta altro.
  const importedStored = await target.get('meta', LEGACY_IMPORTED_META_KEY);
  let imported: ImportedMap = {};
  if (importedStored !== undefined) {
    try {
      imported = parseImported(await codec.decodeMeta(LEGACY_IMPORTED_META_KEY, importedStored));
    } catch (error) {
      console.error('Elenco delle note importate illeggibile', errorName(error));
    }
  }
  const writes: { record: StoredNote; before: StoredNote | undefined }[] = [];
  const nextImported: ImportedMap = { ...imported };
  for (const note of notes) {
    const already = imported[note.id];
    nextImported[note.id] = Math.max(already ?? note.modifiedAt, note.modifiedAt);
    // Importata con questa data (o più recente): forse eliminata da allora, non torna.
    if (already !== undefined && note.modifiedAt <= already) continue;
    const before = await target.get('notes', note.id);
    let toWrite: Note = note;
    if (before) {
      let current: Note | undefined;
      try {
        current = await codec.decode(before);
      } catch {
        current = undefined;
      }
      if (current && current.modifiedAt >= note.modifiedAt) continue;
      // Un record cifrato illeggibile non si sovrascrive: la copia vecchia diventa una nota nuova.
      if (!current) toWrite = { ...note, id: crypto.randomUUID() };
    }
    writes.push({
      record: await codec.encode(toWrite),
      before: toWrite === note ? before : undefined,
    });
  }
  const encodedImported = await codec.encodeMeta(LEGACY_IMPORTED_META_KEY, nextImported);
  const encodedMeta = await Promise.all(
    meta.map(async ([key, value]) => [key, await codec.encodeMeta(key, value)] as const),
  );

  let migrated = 0;
  const tx = target.transaction(['notes', 'meta'], 'readwrite');
  const notesStore = tx.objectStore('notes');
  const metaStore = tx.objectStore('meta');
  for (const { record, before } of writes) {
    // Un'altra scheda di questa versione l'ha cambiata intanto: la sua copia è più recente.
    if (!sameRecord(await notesStore.get(record.id), before)) continue;
    await notesStore.put(record);
    migrated++;
  }
  await metaStore.put(encodedImported, LEGACY_IMPORTED_META_KEY);
  for (const [key, value] of encodedMeta) {
    if ((await metaStore.getKey(key)) === undefined) await metaStore.put(value, key);
  }
  await tx.done;

  legacyLeftover.value = unreadable;
  if (unreadable > 0) {
    console.warn(
      `${unreadable} note del vecchio archivio non si possono leggere: resta conservato in chiaro`,
    );
    return { migrated, unreadable, blocked: false, deletion: null };
  }
  return { migrated, unreadable, blocked: false, deletion: deleteInBackground() };
}

/** Elimina il vecchio archivio con i record illeggibili rimasti (dalle impostazioni). */
export async function deleteLegacyLeftover(onBlocked?: () => void): Promise<void> {
  await deleteDatabase(LEGACY_DB_NAME, onBlocked);
  legacyLeftover.value = 0;
}

/** Non si aspetta: una scheda appena riaperta può tenerlo bloccato. */
function deleteInBackground(): Promise<void> {
  const deletion = deleteDatabase(LEGACY_DB_NAME);
  deletion.catch((error: unknown) => console.error('Vecchio archivio non eliminato', error));
  return deletion;
}

function errorName(error: unknown): string {
  return error instanceof Error || error instanceof DOMException ? error.name : typeof error;
}
