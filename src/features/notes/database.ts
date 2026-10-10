import {
  deleteDB,
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';
import type { StoredNote } from './codec';

/**
 * Nome specifico: tutte le pagine sotto lucamilan.github.io condividono la stessa origine,
 * quindi un nome generico come "notepad" potrebbe scontrarsi con un altro progetto.
 * Da F7 le note cifrate stanno in un database nuovo: quello di F2–F6 (`LEGACY_DB_NAME`,
 * record "plain-v1") si legge una volta per cifrarne le note e poi si elimina, così non
 * restano copie in chiaro nelle pagine del vecchio file.
 */
export const DB_NAME = 'notepad-minus-minus-cifrato';
export const LEGACY_DB_NAME = 'notepad-minus-minus';

/** Chiave del portachiavi nello store `meta`: l'unico dato di servizio che resta in chiaro. */
export const KEYRING_META_KEY = 'keyring';

export interface NotepadSchema extends DBSchema {
  notes: { key: string; value: StoredNote };
  /**
   * Dati di servizio: il portachiavi (`keyring`, in chiaro: salt, parametri e chiave dati
   * cifrata) e, cifrati dal codec, schede aperte e viste salvate.
   */
  meta: { key: string; value: unknown };
}

export type UpgradeTransaction = IDBPTransaction<
  NotepadSchema,
  StoreNames<NotepadSchema>[],
  'versionchange'
>;

/**
 * Migrazioni dello schema, una per versione e in ordine: la voce di indice i porta il
 * database dalla versione i alla i + 1. Non modificare quelle già pubblicate, si aggiunge
 * sempre una nuova voce. Dentro una migrazione si usano solo richieste IndexedDB sulla
 * transazione ricevuta, senza altri await, altrimenti la transazione si chiude.
 * Niente indici sui campi delle note: con la cifratura (F7) rivelerebbero metadati.
 */
type Migration = (db: IDBPDatabase<NotepadSchema>, tx: UpgradeTransaction) => void;

export const MIGRATIONS: readonly Migration[] = [
  (db) => {
    db.createObjectStore('notes', { keyPath: 'id' });
    db.createObjectStore('meta');
  },
];

export const DB_VERSION = MIGRATIONS.length;

export interface ConnectionEvents {
  /**
   * Un'altra scheda vuole aggiornare lo schema: ultima occasione per scrivere (per esempio
   * le modifiche in coda) prima che la connessione si chiuda. L'altra scheda aspetta.
   */
  beforeClose?: () => Promise<void>;
  /** Un'altra scheda vuole aggiornare lo schema: la connessione è già stata chiusa. */
  onVersionChange?: () => void;
  /** Un'altra scheda con lo schema vecchio impedisce l'aggiornamento di questa. */
  onBlocked?: () => void;
  /** Il browser ha chiuso la connessione (dati cancellati, errore del disco). */
  onTerminated?: () => void;
}

export function openNotepadDb(
  events: ConnectionEvents = {},
  name: string = DB_NAME,
): Promise<IDBPDatabase<NotepadSchema>> {
  const connection = openDB<NotepadSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      for (let version = oldVersion; version < DB_VERSION; version++) {
        MIGRATIONS[version]?.(db, transaction);
      }
    },
    blocked: () => events.onBlocked?.(),
    // Si chiude appena salvato quanto resta in coda, per non bloccare a lungo la scheda che
    // porta la versione nuova.
    blocking: () => {
      void connection.then(async (db) => {
        try {
          await events.beforeClose?.();
        } catch (error) {
          console.error(error);
        } finally {
          db.close();
          events.onVersionChange?.();
        }
      });
    },
    terminated: () => events.onTerminated?.(),
  });
  return connection;
}

/**
 * Elimina un database e si risolve quando è sparito. Se un'altra scheda lo tiene aperto la
 * richiesta resta in attesa finché quella non chiude la connessione: chi non può aspettare
 * non fa await e si limita a registrare il ritardo.
 */
export function deleteDatabase(name: string, onBlocked?: () => void): Promise<void> {
  return deleteDB(name, {
    blocked: () => {
      console.warn(`Eliminazione del database ${name} in attesa: è aperto in un'altra scheda`);
      onBlocked?.();
    },
  });
}
