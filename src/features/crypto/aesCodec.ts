import { CorruptNoteError, type NoteCodec, type StoredNote } from '../notes/codec';
import { isNote, type Note } from '../notes/note';
import { bytesOf } from './keys';

/**
 * Codec "aesgcm-v1": ogni record è `{ iv, data }`, con IV casuale di 12 byte per record e
 * `data` = AES-256-GCM del JSON della nota senza id. L'additional data lega il ciphertext al
 * suo posto: `note\0<id>\0aesgcm-v1` per le note, `meta\0<chiave>\0aesgcm-v1` per i dati di
 * servizio, così un record copiato su un altro id (o un'altra chiave) non si decifra.
 * Il testo in chiaro non si registra mai nei log, nemmeno negli errori.
 */
export const AES_FORMAT = 'aesgcm-v1';
const IV_BYTES = 12;

export interface AesCodec extends NoteCodec {
  /** Al blocco: il codec dimentica la chiave e ogni operazione successiva fallisce. */
  forget(): void;
}

export class VaultLockedError extends Error {
  constructor() {
    super('Note bloccate');
    this.name = 'VaultLockedError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function noteAad(id: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`note\u0000${id}\u0000${AES_FORMAT}`);
}

function metaAad(key: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`meta\u0000${key}\u0000${AES_FORMAT}`);
}

interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

function parseSealed(
  value: unknown,
): { iv: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer> } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const iv = bytesOf(v['iv'], IV_BYTES);
  const data = bytesOf(v['data']);
  return iv && data ? { iv, data } : undefined;
}

export function createAesCodec(key: CryptoKey): AesCodec {
  // L'unico riferimento alla chiave: lo azzera forget() al blocco.
  let current: CryptoKey | null = key;

  const requireKey = (): CryptoKey => {
    if (!current) throw new VaultLockedError();
    return current;
  };

  async function seal(plaintext: string, aad: Uint8Array<ArrayBuffer>): Promise<Sealed> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      requireKey(),
      encoder.encode(plaintext),
    );
    return { iv, data };
  }

  /** undefined se forma, chiave o additional data non tornano (manomissione compresa). */
  async function open(value: unknown, aad: Uint8Array<ArrayBuffer>): Promise<unknown> {
    const sealed = parseSealed(value);
    if (!sealed) return undefined;
    const usable = requireKey();
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.iv, additionalData: aad },
        usable,
        sealed.data,
      );
      return JSON.parse(decoder.decode(plain)) as unknown;
    } catch {
      return undefined;
    }
  }

  return {
    format: AES_FORMAT,
    async encode(note: Note): Promise<StoredNote> {
      const { id, ...rest } = note;
      return { id, format: AES_FORMAT, payload: await seal(JSON.stringify(rest), noteAad(id)) };
    },
    async decode(stored: StoredNote): Promise<Note> {
      if (stored.format !== AES_FORMAT) throw new CorruptNoteError(stored.id, 'formato');
      const opened = await open(stored.payload, noteAad(stored.id));
      if (typeof opened !== 'object' || opened === null || Array.isArray(opened)) {
        throw new CorruptNoteError(stored.id, 'non decifrabile');
      }
      const note: unknown = { ...opened, id: stored.id };
      if (!isNote(note)) throw new CorruptNoteError(stored.id, 'campi mancanti');
      return note;
    },
    async encodeMeta(metaKey, value) {
      const json = JSON.stringify(value);
      if (json === undefined) throw new TypeError(`Valore di "${metaKey}" non serializzabile`);
      return { format: AES_FORMAT, ...(await seal(json, metaAad(metaKey))) };
    },
    async decodeMeta(metaKey, stored) {
      const v = stored as Record<string, unknown> | null;
      if (typeof v !== 'object' || v === null || v['format'] !== AES_FORMAT) {
        throw new CorruptNoteError(metaKey, 'formato');
      }
      const opened = await open(v, metaAad(metaKey));
      if (opened === undefined) throw new CorruptNoteError(metaKey, 'non decifrabile');
      return opened;
    },
    forget() {
      current = null;
    },
  };
}
