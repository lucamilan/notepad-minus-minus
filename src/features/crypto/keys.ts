/**
 * Chiavi della cifratura a riposo (F7), solo Web Crypto.
 *
 * Gerarchia:
 * - una chiave dati (DEK) AES-256-GCM casuale cifra note e dati di servizio;
 * - la DEK è salvata solo cifrata ("wrapped") con una chiave derivata dalla passphrase (KEK):
 *   PBKDF2-SHA-256, PBKDF2_ITERATIONS iterazioni, salt casuale di 16 byte, passphrase
 *   normalizzata NFC e codificata UTF-8;
 * - la KEK non è estraibile e serve solo a wrapKey/unwrapKey; la DEK in uso è sbloccata come
 *   non estraibile (encrypt/decrypt) e vive solo in memoria, dentro il codec.
 *
 * Cambiare passphrase ricifra solo la DEK con una KEK nuova (salt nuovo): è un'unica scrittura
 * nello store `meta`, istantanea e sicura anche con più schede aperte, perché la DEK e quindi
 * le note non cambiano. Il prezzo: la DEK non ruota, quindi chi aveva sia una vecchia copia
 * del database sia la vecchia passphrase può ancora leggerla. Non c'è recupero: senza la
 * passphrase la DEK non si ricava.
 */

/** Iterazioni usate per creare (o ricifrare) il portachiavi. */
export const PBKDF2_ITERATIONS = 600_000;
/**
 * Limiti accettati leggendo un portachiavi: il minimo resta anche se un giorno si crea con
 * più iterazioni; il massimo evita che un record manomesso blocchi la scheda per ore.
 */
export const MIN_PBKDF2_ITERATIONS = 600_000;
export const MAX_PBKDF2_ITERATIONS = 10_000_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
/** 32 byte di chiave più 16 di tag GCM. */
export const WRAPPED_KEY_BYTES = 48;
const KEYRING_VERSION = 1;
const WRAP_AAD = new TextEncoder().encode('keyring\u0000v1');

/**
 * Una chiave AES-256-GCM cifrata con una KEK derivata da una passphrase: la usano il
 * portachiavi (additional data `keyring\0v1`) e il file di esportazione (`export\0v1`, F8).
 */
export interface WrappedKey {
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: Uint8Array<ArrayBuffer> };
  wrap: { iv: Uint8Array<ArrayBuffer>; key: Uint8Array<ArrayBuffer> };
}

export interface Keyring extends WrappedKey {
  version: 1;
}

/**
 * Opzioni solo per i test: con 600.000 iterazioni ogni derivazione costa mezzo secondo.
 * L'app non le passa mai, e un portachiavi salvato con meno iterazioni del minimo viene
 * rifiutato in ogni caso (il minimo non si legge dai dati).
 */
export interface KdfTestOptions {
  iterations?: number;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Passphrase errata');
    this.name = 'WrongPassphraseError';
  }
}

export class InvalidKeyringError extends Error {
  constructor(reason: string) {
    super(`Portachiavi non valido: ${reason}`);
    this.name = 'InvalidKeyringError';
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function tag(value: unknown): string {
  return Object.prototype.toString.call(value);
}

/**
 * Byte salvati in IndexedDB come Uint8Array o ArrayBuffer, copiati in un Uint8Array nuovo.
 * Si confronta il tag e non instanceof: i valori clonati possono venire da un altro realm.
 */
export function bytesOf(value: unknown, length?: number): Uint8Array<ArrayBuffer> | undefined {
  let bytes: Uint8Array<ArrayBuffer>;
  if (tag(value) === '[object Uint8Array]') bytes = new Uint8Array(value as Uint8Array);
  else if (tag(value) === '[object ArrayBuffer]') bytes = new Uint8Array(value as ArrayBuffer);
  else return undefined;
  return length === undefined || bytes.length === length ? bytes : undefined;
}

/** Controlla forma e parametri del portachiavi letto dallo store `meta`. */
export function parseKeyring(value: unknown, options: { minIterations?: number } = {}): Keyring {
  const minIterations = options.minIterations ?? MIN_PBKDF2_ITERATIONS;
  if (typeof value !== 'object' || value === null) throw new InvalidKeyringError('assente');
  const v = value as Record<string, unknown>;
  if (v['version'] !== KEYRING_VERSION) throw new InvalidKeyringError('versione');
  const kdf = v['kdf'] as Record<string, unknown> | null | undefined;
  const wrap = v['wrap'] as Record<string, unknown> | null | undefined;
  if (typeof kdf !== 'object' || kdf === null || typeof wrap !== 'object' || wrap === null) {
    throw new InvalidKeyringError('campi mancanti');
  }
  if (kdf['name'] !== 'PBKDF2' || kdf['hash'] !== 'SHA-256') {
    throw new InvalidKeyringError('derivazione');
  }
  const iterations = kdf['iterations'];
  if (!validIterations(iterations, minIterations)) throw new InvalidKeyringError('iterazioni');
  const salt = bytesOf(kdf['salt'], SALT_BYTES);
  const iv = bytesOf(wrap['iv'], IV_BYTES);
  const key = bytesOf(wrap['key'], WRAPPED_KEY_BYTES);
  if (!salt || !iv || !key) throw new InvalidKeyringError('lunghezze');
  return {
    version: KEYRING_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
    wrap: { iv, key },
  };
}

/** Iterazioni accettate leggendo dati salvati o importati: intero tra il minimo e il massimo. */
export function validIterations(
  value: unknown,
  minIterations: number = MIN_PBKDF2_ITERATIONS,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minIterations &&
    value <= MAX_PBKDF2_ITERATIONS
  );
}

async function deriveKek(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Cifra `key` (estraibile) con una KEK nuova derivata da `passphrase`: salt e IV nuovi.
 * `aad` distingue l'uso (portachiavi o file di esportazione), così una chiave cifrata per un
 * uso non si apre nell'altro.
 */
export async function wrapKeyWithPassphrase(
  key: CryptoKey,
  passphrase: string,
  iterations: number,
  aad: Uint8Array<ArrayBuffer>,
): Promise<WrappedKey> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = await deriveKek(passphrase, salt, iterations);
  const wrapped = await crypto.subtle.wrapKey('raw', key, kek, {
    name: 'AES-GCM',
    iv,
    additionalData: aad,
  });
  return {
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
    wrap: { iv, key: new Uint8Array(wrapped) },
  };
}

/**
 * Chiave AES-256-GCM (encrypt/decrypt) cifrata da wrapKeyWithPassphrase. Una KEK sbagliata
 * fa fallire l'autenticazione GCM di unwrapKey: WrongPassphraseError.
 */
export async function unwrapKeyWithPassphrase(
  wrapped: WrappedKey,
  passphrase: string,
  aad: Uint8Array<ArrayBuffer>,
  extractable: boolean,
): Promise<CryptoKey> {
  const kek = await deriveKek(passphrase, wrapped.kdf.salt, wrapped.kdf.iterations);
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      wrapped.wrap.key,
      kek,
      { name: 'AES-GCM', iv: wrapped.wrap.iv, additionalData: aad },
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new WrongPassphraseError();
  }
}

async function wrapDataKey(
  dataKey: CryptoKey,
  passphrase: string,
  iterations: number,
): Promise<Keyring> {
  const wrapped = await wrapKeyWithPassphrase(dataKey, passphrase, iterations, WRAP_AAD);
  return { version: KEYRING_VERSION, ...wrapped };
}

function unwrapDataKey(
  keyring: Keyring,
  passphrase: string,
  extractable: boolean,
): Promise<CryptoKey> {
  return unwrapKeyWithPassphrase(keyring, passphrase, WRAP_AAD, extractable);
}

/**
 * Nuovo portachiavi con una DEK casuale. La DEK nasce estraibile solo per essere cifrata;
 * quella restituita per l'uso è la copia appena cifrata, sbloccata come non estraibile.
 */
export async function createKeyring(
  passphrase: string,
  options: KdfTestOptions = {},
): Promise<{ keyring: Keyring; key: CryptoKey }> {
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const keyring = await wrapDataKey(
    await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']),
    passphrase,
    iterations,
  );
  return { keyring, key: await unwrapDataKey(keyring, passphrase, false) };
}

/** DEK non estraibile per cifrare e decifrare; WrongPassphraseError se la passphrase è errata. */
export function unlockKeyring(keyring: Keyring, passphrase: string): Promise<CryptoKey> {
  return unwrapDataKey(keyring, passphrase, false);
}

/**
 * Cambio passphrase: la DEK si sblocca (estraibile solo per il tempo di ricifrarla) con la
 * passphrase attuale e si ricifra con una KEK nuova, con salt e IV nuovi. Le note non cambiano.
 */
export async function rewrapKeyring(
  keyring: Keyring,
  current: string,
  next: string,
  options: KdfTestOptions = {},
): Promise<Keyring> {
  const dataKey = await unwrapDataKey(keyring, current, true);
  return wrapDataKey(dataKey, next, options.iterations ?? PBKDF2_ITERATIONS);
}

/** Lunghezza minima della passphrase, in caratteri (code point, non unità UTF-16). */
export const PASSPHRASE_MIN_LENGTH = 12;

export function passphraseLength(passphrase: string): number {
  return Array.from(passphrase.normalize('NFC')).length;
}
