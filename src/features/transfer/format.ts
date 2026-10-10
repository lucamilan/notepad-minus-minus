import { parseSavedViews, type SavedView } from '../collection/views';
import {
  IV_BYTES,
  MAX_PBKDF2_ITERATIONS,
  PASSPHRASE_MIN_LENGTH,
  passphraseLength,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  unwrapKeyWithPassphrase,
  validIterations,
  WRAPPED_KEY_BYTES,
  wrapKeyWithPassphrase,
  type WrappedKey,
} from '../crypto/keys';
import { isNote, type Note } from '../notes/note';

/**
 * File `.notepad` per spostare le note su un altro PC (F8). È testo JSON UTF-8:
 *
 *   { "app": "notepad-minus-minus", "kind": "export", "version": 1,
 *     "kdf":  { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<16 B>" },
 *     "wrap": { "iv": "<12 B>", "key": "<48 B>" },
 *     "data": { "iv": "<12 B>", "ciphertext": "<…>" } }
 *
 * (byte in base64). Il file ha una sua chiave AES-256-GCM casuale, cifrata come quella del
 * portachiavi (keys.ts) con una KEK da PBKDF2 sulla passphrase scelta all'esportazione, ma con
 * additional data `export\0v1`: una chiave cifrata per il portachiavi non si apre come file e
 * viceversa. La chiave dati delle note non esce mai (e non è estraibile).
 * `data` è un'unica cifratura AES-GCM (additional data `export-data\0v1`) del JSON
 * `{ notes, savedViews }`: niente date, conteggi, titoli o tag in chiaro, e numero e dimensione
 * delle singole note restano nascosti (si vede solo la dimensione totale).
 */
export const EXPORT_APP = 'notepad-minus-minus';
export const EXPORT_KIND = 'export';
export const EXPORT_VERSION = 1;
export const EXPORT_EXTENSION = '.notepad';
/** Oltre questa dimensione il file non si legge nemmeno. */
export const EXPORT_MAX_BYTES = 64 * 1024 * 1024;

const encoder = new TextEncoder();
const WRAP_AAD = encoder.encode('export\u0000v1');
const DATA_AAD = encoder.encode('export-data\u0000v1');

export interface ExportPayload {
  notes: Note[];
  savedViews: SavedView[];
}

/** Il file non è un'esportazione valida (`invalid`) o è di una versione che non si conosce. */
export class InvalidExportError extends Error {
  constructor(readonly reason: 'invalid' | 'version' | 'too-large') {
    super(`File di esportazione non valido: ${reason}`);
    this.name = 'InvalidExportError';
  }
}

export class ExportPassphraseTooShortError extends Error {
  constructor() {
    super(`La passphrase del file deve avere almeno ${PASSPHRASE_MIN_LENGTH} caratteri`);
    this.name = 'ExportPassphraseTooShortError';
  }
}

/** File letto e controllato nella forma, ancora cifrato: senza la passphrase non dice nulla. */
export interface SealedExport extends WrappedKey {
  data: { iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> };
}

/** Opzioni solo per i test (vedi KdfTestOptions in keys.ts). */
export interface ExportKdfOptions {
  iterations?: number;
  minIterations?: number;
}

// --- base64 -----------------------------------------------------------------------------

const CHUNK = 0x8000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/** Solo base64 canonico (alfabeto standard, padding corretto); undefined altrimenti. */
export function fromBase64(value: unknown, length?: number): Uint8Array<ArrayBuffer> | undefined {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !BASE64.test(value)) return undefined;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (length !== undefined && bytes.length !== length) return undefined;
  // Bit di riempimento diversi da zero darebbero più scritture per gli stessi byte: basta
  // ricodificare l'ultimo gruppo di 4 caratteri, l'unico che può averne.
  if (value.length > 0) {
    const tail = bytes.subarray((value.length / 4 - 1) * 3);
    if (toBase64(tail) !== value.slice(-4)) return undefined;
  }
  return bytes;
}

// --- forma del file ---------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Esattamente questi campi, né uno di più né uno di meno. */
function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Controlla il testo del file senza decifrarlo: campi esatti, tipi, lunghezze dei byte e
 * iterazioni nei limiti (il massimo evita che un file manomesso blocchi la scheda per ore).
 */
export function parseExportFile(text: string, options: ExportKdfOptions = {}): SealedExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidExportError('invalid');
  }
  if (!isRecord(parsed) || parsed['app'] !== EXPORT_APP || parsed['kind'] !== EXPORT_KIND) {
    throw new InvalidExportError('invalid');
  }
  if (parsed['version'] !== EXPORT_VERSION) {
    // Una versione futura (intera) si riconosce come tale; il resto è un file rovinato.
    const version = parsed['version'];
    throw new InvalidExportError(
      typeof version === 'number' && Number.isSafeInteger(version) && version > EXPORT_VERSION
        ? 'version'
        : 'invalid',
    );
  }
  if (!hasExactly(parsed, ['app', 'kind', 'version', 'kdf', 'wrap', 'data'])) {
    throw new InvalidExportError('invalid');
  }
  const { kdf, wrap, data } = parsed;
  if (
    !isRecord(kdf) ||
    !isRecord(wrap) ||
    !isRecord(data) ||
    !hasExactly(kdf, ['name', 'hash', 'iterations', 'salt']) ||
    !hasExactly(wrap, ['iv', 'key']) ||
    !hasExactly(data, ['iv', 'ciphertext']) ||
    kdf['name'] !== 'PBKDF2' ||
    kdf['hash'] !== 'SHA-256'
  ) {
    throw new InvalidExportError('invalid');
  }
  const iterations = kdf['iterations'];
  if (!validIterations(iterations, options.minIterations)) {
    throw new InvalidExportError('invalid');
  }
  const salt = fromBase64(kdf['salt'], SALT_BYTES);
  const wrapIv = fromBase64(wrap['iv'], IV_BYTES);
  const key = fromBase64(wrap['key'], WRAPPED_KEY_BYTES);
  const dataIv = fromBase64(data['iv'], IV_BYTES);
  const ciphertext = fromBase64(data['ciphertext']);
  // Almeno il tag GCM (16 byte): un ciphertext più corto non può essere autentico.
  if (!salt || !wrapIv || !key || !dataIv || !ciphertext || ciphertext.length < 16) {
    throw new InvalidExportError('invalid');
  }
  return {
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
    wrap: { iv: wrapIv, key },
    data: { iv: dataIv, ciphertext },
  };
}

/** Legge il file scelto dall'utente, rifiutando prima di leggerlo quelli troppo grandi. */
export async function readExportFile(
  file: Blob,
  options: ExportKdfOptions = {},
): Promise<SealedExport> {
  if (file.size > EXPORT_MAX_BYTES) throw new InvalidExportError('too-large');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new InvalidExportError('invalid');
  }
  return parseExportFile(text, options);
}

// --- contenuto ----------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOTE_FIELDS = ['id', 'text', 'createdAt', 'modifiedAt', 'pinned'] as const;

/** Tolleranza sull'orologio dell'altro PC per le date "nel futuro". */
export const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Solo i campi di una nota, con id UUID e date plausibili: millisecondi interi con
 * 0 ≤ createdAt ≤ modifiedAt ≤ adesso + 24 ore (date come 1e300 farebbero lanciare la
 * formattazione delle date a ogni disegno); undefined se non è una nota valida.
 */
function parseNote(value: unknown, now: number): Note | undefined {
  if (!isRecord(value) || !hasExactly(value, NOTE_FIELDS) || !isNote(value)) return undefined;
  if (!UUID.test(value.id)) return undefined;
  const { id, text, createdAt, modifiedAt, pinned } = value;
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(modifiedAt)) return undefined;
  if (createdAt < 0 || createdAt > modifiedAt || modifiedAt > now + CLOCK_SKEW_MS) {
    return undefined;
  }
  return { id, text, createdAt, modifiedAt, pinned };
}

/** Contenuto decifrato: ogni nota valida, id unici, viste salvate ripulite da parseSavedViews. */
export function parsePayload(value: unknown, now: number = Date.now()): ExportPayload {
  if (!isRecord(value) || !hasExactly(value, ['notes', 'savedViews'])) {
    throw new InvalidExportError('invalid');
  }
  const { notes, savedViews } = value;
  if (!Array.isArray(notes) || !Array.isArray(savedViews)) throw new InvalidExportError('invalid');
  const ids = new Set<string>();
  const parsed = notes.map((item: unknown) => {
    const note = parseNote(item, now);
    if (!note || ids.has(note.id)) throw new InvalidExportError('invalid');
    ids.add(note.id);
    return note;
  });
  return { notes: parsed, savedViews: parseSavedViews(savedViews) };
}

// --- cifratura ----------------------------------------------------------------------------

/**
 * Testo del file `.notepad` con `payload` cifrato. La passphrase del file deve avere almeno
 * PASSPHRASE_MIN_LENGTH caratteri anche qui, non solo nel modulo.
 */
export async function sealExport(
  payload: ExportPayload,
  passphrase: string,
  options: ExportKdfOptions = {},
): Promise<string> {
  if (passphraseLength(passphrase) < PASSPHRASE_MIN_LENGTH) {
    throw new ExportPassphraseTooShortError();
  }
  const iterations = Math.min(options.iterations ?? PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS);
  // Estraibile solo per essere cifrata; quella usata per cifrare i dati è la stessa, poi si perde.
  const fileKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const wrapped = await wrapKeyWithPassphrase(fileKey, passphrase, iterations, WRAP_AAD);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = encoder.encode(
    JSON.stringify({ notes: payload.notes, savedViews: payload.savedViews }),
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: DATA_AAD },
      fileKey,
      plaintext,
    ),
  );
  // Il JSON in chiaro non serve più: si azzerano i byte (le stringhe non si possono azzerare).
  plaintext.fill(0);
  return JSON.stringify({
    app: EXPORT_APP,
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: wrapped.kdf.iterations,
      salt: toBase64(wrapped.kdf.salt),
    },
    wrap: { iv: toBase64(wrapped.wrap.iv), key: toBase64(wrapped.wrap.key) },
    data: { iv: toBase64(iv), ciphertext: toBase64(ciphertext) },
  });
}

/**
 * Decifra un file già controllato da parseExportFile. WrongPassphraseError (keys.ts) se la
 * passphrase è sbagliata; InvalidExportError se i dati sono stati manomessi o non sono validi.
 */
export async function openExport(sealed: SealedExport, passphrase: string): Promise<ExportPayload> {
  const fileKey = await unwrapKeyWithPassphrase(sealed, passphrase, WRAP_AAD, false);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.data.iv, additionalData: DATA_AAD },
      fileKey,
      sealed.data.ciphertext,
    );
  } catch {
    throw new InvalidExportError('invalid');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    throw new InvalidExportError('invalid');
  } finally {
    new Uint8Array(plain).fill(0);
  }
  return parsePayload(value);
}

/** Nome del file: `notepad-AAAA-MM-GG.notepad`, con la data locale. */
export function exportFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `notepad-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}${EXPORT_EXTENSION}`;
}
