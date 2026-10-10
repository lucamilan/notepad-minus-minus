import { describe, expect, it } from 'vitest';
import { AES_FORMAT, createAesCodec, VaultLockedError } from '../src/features/crypto/aesCodec';
import {
  createKeyring,
  InvalidKeyringError,
  MIN_PBKDF2_ITERATIONS,
  parseKeyring,
  passphraseLength,
  PBKDF2_ITERATIONS,
  rewrapKeyring,
  unlockKeyring,
  WrongPassphraseError,
  type Keyring,
} from '../src/features/crypto/keys';
import { CorruptNoteError, type StoredNote } from '../src/features/notes/codec';
import { createNote } from '../src/features/notes/note';

// Poche iterazioni: 600.000 costerebbero mezzo secondo a derivazione. Il minimo vero lo
// verifica parseKeyring più sotto.
const FAST = { iterations: 1000 };
const LOW = { minIterations: FAST.iterations };
const PASSPHRASE = 'cavallo batteria graffetta corretta';

function payloadOf(stored: StoredNote): { iv: Uint8Array; data: ArrayBuffer } {
  return stored.payload as { iv: Uint8Array; data: ArrayBuffer };
}

describe('portachiavi', () => {
  it('crea una chiave dati non estraibile e la risblocca con la stessa passphrase', async () => {
    const { keyring, key } = await createKeyring(PASSPHRASE, FAST);
    expect(key.extractable).toBe(false);
    expect(key.usages.sort()).toEqual(['decrypt', 'encrypt']);
    expect(keyring.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 });
    expect(keyring.kdf.salt).toHaveLength(16);
    expect(keyring.wrap.iv).toHaveLength(12);

    const again = await unlockKeyring(parseKeyring(keyring, LOW), PASSPHRASE);
    expect(again.extractable).toBe(false);
    // La stessa chiave: ciò che cifra l'una lo decifra l'altra.
    const note = createNote('segreto', 1);
    const stored = await createAesCodec(key).encode(note);
    expect(await createAesCodec(again).decode(stored)).toEqual(note);
  });

  it('una passphrase errata fallisce con WrongPassphraseError', async () => {
    const { keyring } = await createKeyring(PASSPHRASE, FAST);
    await expect(unlockKeyring(keyring, 'cavallo batteria graffetta sbagliata')).rejects.toThrow(
      WrongPassphraseError,
    );
  });

  it('NFC e NFD della stessa passphrase sono equivalenti', async () => {
    const nfd = 'perché città più'.normalize('NFD');
    const nfc = nfd.normalize('NFC');
    expect(nfd).not.toBe(nfc);
    const { keyring } = await createKeyring(nfd, FAST);
    await expect(unlockKeyring(keyring, nfc)).resolves.toBeDefined();
    expect(passphraseLength(nfd)).toBe(passphraseLength(nfc));
  });

  it('due portachiavi della stessa passphrase hanno salt e IV diversi', async () => {
    const a = await createKeyring(PASSPHRASE, FAST);
    const b = await createKeyring(PASSPHRASE, FAST);
    expect(a.keyring.kdf.salt).not.toEqual(b.keyring.kdf.salt);
    expect(a.keyring.wrap.key).not.toEqual(b.keyring.wrap.key);
  });

  it('cambiare passphrase lascia leggibili le note e rende inutile la vecchia', async () => {
    const { keyring, key } = await createKeyring(PASSPHRASE, FAST);
    const note = createNote('scritta prima del cambio', 1);
    const stored = await createAesCodec(key).encode(note);

    const changed = await rewrapKeyring(keyring, PASSPHRASE, 'una passphrase nuova di zecca', FAST);
    expect(changed.kdf.salt).not.toEqual(keyring.kdf.salt);
    await expect(unlockKeyring(changed, PASSPHRASE)).rejects.toThrow(WrongPassphraseError);
    const newKey = await unlockKeyring(changed, 'una passphrase nuova di zecca');
    expect(newKey.extractable).toBe(false);
    expect(await createAesCodec(newKey).decode(stored)).toEqual(note);
  });

  it('il cambio richiede la passphrase attuale', async () => {
    const { keyring } = await createKeyring(PASSPHRASE, FAST);
    await expect(
      rewrapKeyring(keyring, 'non è questa', 'nuova passphrase lunga', FAST),
    ).rejects.toThrow(WrongPassphraseError);
  });

  it('la validazione rifiuta portachiavi malformati o con poche iterazioni', async () => {
    const { keyring } = await createKeyring(PASSPHRASE, FAST);
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect(MIN_PBKDF2_ITERATIONS).toBe(600_000);
    // Il minimo non si legge dai dati: 1000 iterazioni salvate non bastano.
    expect(() => parseKeyring(keyring)).toThrow(InvalidKeyringError);
    const strong: Keyring = { ...keyring, kdf: { ...keyring.kdf, iterations: PBKDF2_ITERATIONS } };
    expect(parseKeyring(strong).kdf.iterations).toBe(PBKDF2_ITERATIONS);

    const broken: unknown[] = [
      undefined,
      null,
      'keyring',
      { ...strong, version: 2 },
      { ...strong, kdf: { ...strong.kdf, hash: 'SHA-1' } },
      { ...strong, kdf: { ...strong.kdf, name: 'scrypt' } },
      { ...strong, kdf: { ...strong.kdf, iterations: 599_999 } },
      { ...strong, kdf: { ...strong.kdf, iterations: '600000' } },
      { ...strong, kdf: { ...strong.kdf, iterations: Infinity } },
      { ...strong, kdf: { ...strong.kdf, iterations: 10_000_001 } },
      { ...strong, kdf: { ...strong.kdf, salt: new Uint8Array(8) } },
      { ...strong, kdf: { ...strong.kdf, salt: [1, 2, 3] } },
      { ...strong, wrap: { ...strong.wrap, iv: new Uint8Array(16) } },
      { ...strong, wrap: { ...strong.wrap, key: new Uint8Array(32) } },
      { ...strong, wrap: null },
    ];
    for (const value of broken) expect(() => parseKeyring(value)).toThrow(InvalidKeyringError);
    // La chiave cifrata può arrivare come ArrayBuffer.
    const asBuffer = { ...strong, wrap: { ...strong.wrap, key: strong.wrap.key.buffer } };
    expect(parseKeyring(asBuffer).wrap.key).toEqual(strong.wrap.key);
  });
});

describe('codec aesgcm-v1', () => {
  async function codec() {
    return createAesCodec((await createKeyring(PASSPHRASE, FAST)).key);
  }

  it('cifra e decifra; fuori dal payload restano solo id e formato', async () => {
    const aes = await codec();
    const note = { ...createNote('# Riunione Acme\n#cliente/acme', 10), pinned: true };
    const stored = await aes.encode(note);
    expect(Object.keys(stored).sort()).toEqual(['format', 'id', 'payload']);
    expect(stored.format).toBe(AES_FORMAT);
    expect(stored.id).toBe(note.id);
    const { iv, data } = payloadOf(stored);
    expect(iv).toHaveLength(12);
    const bytes = new TextDecoder('latin1').decode(new Uint8Array(data));
    expect(bytes).not.toContain('Acme');
    expect(await aes.decode(stored)).toEqual(note);
  });

  it('usa un IV nuovo a ogni scrittura', async () => {
    const aes = await codec();
    const note = createNote('uguale', 1);
    const a = payloadOf(await aes.encode(note));
    const b = payloadOf(await aes.encode(note));
    expect(a.iv).not.toEqual(b.iv);
  });

  it('un ciphertext spostato su un altro id non si decifra (additional data)', async () => {
    const aes = await codec();
    const a = await aes.encode(createNote('di a', 1));
    const b = await aes.encode(createNote('di b', 1));
    await expect(aes.decode({ ...a, id: b.id })).rejects.toThrow(CorruptNoteError);
    await expect(aes.decode({ ...b, payload: a.payload })).rejects.toThrow(CorruptNoteError);
  });

  it('un ciphertext alterato non si decifra', async () => {
    const aes = await codec();
    const stored = await aes.encode(createNote('integro', 1));
    const { iv, data } = payloadOf(stored);
    const tampered = new Uint8Array(data.slice(0));
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    await expect(aes.decode({ ...stored, payload: { iv, data: tampered.buffer } })).rejects.toThrow(
      CorruptNoteError,
    );
    const otherIv = new Uint8Array(iv);
    otherIv[0] = (otherIv[0] ?? 0) ^ 1;
    await expect(aes.decode({ ...stored, payload: { iv: otherIv, data } })).rejects.toThrow(
      CorruptNoteError,
    );
  });

  it('rifiuta formati e forme sconosciuti, compreso plain-v1', async () => {
    const aes = await codec();
    const stored = await aes.encode(createNote('x', 1));
    for (const record of [
      {
        ...stored,
        format: 'plain-v1',
        payload: { text: 'x', createdAt: 1, modifiedAt: 1, pinned: false },
      },
      { ...stored, payload: null },
      { ...stored, payload: { iv: new Uint8Array(12) } },
      { ...stored, payload: { iv: 'abc', data: new ArrayBuffer(8) } },
    ]) {
      await expect(aes.decode(record)).rejects.toThrow(CorruptNoteError);
    }
  });

  it('con un’altra chiave non si decifra', async () => {
    const stored = await (await codec()).encode(createNote('mia', 1));
    await expect((await codec()).decode(stored)).rejects.toThrow(CorruptNoteError);
  });

  it('cifra i dati di servizio legandoli alla loro chiave', async () => {
    const aes = await codec();
    const views = [{ name: 'Acme', view: 'all', tags: ['cliente/acme'] }];
    const stored = await aes.encodeMeta('savedViews', views);
    expect(JSON.stringify(stored)).not.toContain('acme');
    expect(await aes.decodeMeta('savedViews', stored)).toEqual(views);
    await expect(aes.decodeMeta('tabs', stored)).rejects.toThrow();
    await expect(aes.decodeMeta('savedViews', views)).rejects.toThrow();
  });

  it('dopo forget() non cifra né decifra più', async () => {
    const aes = await codec();
    const stored = await aes.encode(createNote('prima del blocco', 1));
    aes.forget();
    await expect(aes.decode(stored)).rejects.toThrow(VaultLockedError);
    await expect(aes.encode(createNote('dopo', 1))).rejects.toThrow(VaultLockedError);
  });
});
