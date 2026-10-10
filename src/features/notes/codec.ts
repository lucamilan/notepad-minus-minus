import { isNote, type Note } from './note';

/**
 * Forma di una nota così come finisce in IndexedDB. In chiaro restano solo l'id (chiave)
 * e il formato; tutto il resto, date e flag compresi, sta nel payload.
 *
 * Requisiti per il codec cifrato di F7, da rispettare senza cambiare il repository:
 * - AES-GCM con IV casuale di 96 bit per record e `id` + `format` come additional data,
 *   così un ciphertext non si può spostare su un altro record;
 * - formato versionato (es. "aesgcm-v1") e decodifica che accetta anche "plain-v1",
 *   per cifrare le note salvate in chiaro nelle fasi F4–F6;
 * - l'id resta un UUID v4 casuale: mai id con timestamp, rivelerebbero la data.
 * Restano comunque visibili il numero di record e, circa, la lunghezza del testo.
 */
export interface StoredNote {
  id: string;
  format: string;
  payload: unknown;
}

export interface NoteCodec {
  readonly format: string;
  encode(note: Note): Promise<StoredNote>;
  decode(stored: StoredNote): Promise<Note>;
}

export class CorruptNoteError extends Error {
  constructor(id: string, reason: string) {
    super(`Nota ${id} illeggibile: ${reason}`);
    this.name = 'CorruptNoteError';
  }
}

export const PLAIN_FORMAT = 'plain-v1';

export const plainCodec: NoteCodec = {
  format: PLAIN_FORMAT,
  encode(note) {
    const { id, ...rest } = note;
    return Promise.resolve({ id, format: PLAIN_FORMAT, payload: rest });
  },
  decode(stored) {
    if (stored.format !== PLAIN_FORMAT) {
      return Promise.reject(new CorruptNoteError(stored.id, `formato ${stored.format}`));
    }
    const note: unknown = { ...(stored.payload as object), id: stored.id };
    if (!isNote(note)) return Promise.reject(new CorruptNoteError(stored.id, 'campi mancanti'));
    return Promise.resolve(note);
  },
};
