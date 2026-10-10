import type { IDBPDatabase } from 'idb';
import { KEYRING_META_KEY, type NotepadSchema } from '../notes/database';
import type { Keyring } from './keys';

/**
 * Il portachiavi sta in chiaro nello store `meta` (salt, iterazioni, DEK cifrata): non passa
 * dal codec del repository, che senza chiave non potrebbe leggerlo.
 */
export function readKeyring(db: IDBPDatabase<NotepadSchema>): Promise<unknown> {
  return db.get('meta', KEYRING_META_KEY);
}

/**
 * Scrive il portachiavi solo se non c'è ancora: `add` fallisce con ConstraintError se la
 * chiave esiste, nella stessa richiesta, quindi due schede non possono crearne due.
 */
export async function addKeyringIfAbsent(
  db: IDBPDatabase<NotepadSchema>,
  keyring: Keyring,
): Promise<boolean> {
  try {
    await db.add('meta', keyring, KEYRING_META_KEY);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'ConstraintError') return false;
    if (error instanceof Error && error.name === 'ConstraintError') return false;
    throw error;
  }
}

/** Cambio passphrase: una sola scrittura, atomica. */
export async function writeKeyring(
  db: IDBPDatabase<NotepadSchema>,
  keyring: Keyring,
): Promise<void> {
  await db.put('meta', keyring, KEYRING_META_KEY);
}
