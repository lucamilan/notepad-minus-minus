import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectionFilter, deleteRequest, savedViews } from '../src/features/collection/state';
import { SAVED_VIEWS_META_KEY } from '../src/features/collection/views';
import { checkAutoLock, recordActivity } from '../src/features/crypto/autoLock';
import { createKeyring } from '../src/features/crypto/keys';
import { addKeyringIfAbsent } from '../src/features/crypto/keyringStore';
import { databaseExists } from '../src/features/crypto/legacy';
import {
  changePassphrase,
  configureVaultForTests,
  lockedQueueSize,
  lockVault,
  resetVault,
  resetVaultForTests,
  setupVault,
  startVault,
  unlockVault,
  VAULT_MESSAGES,
  vaultState,
} from '../src/features/crypto/vault';
import {
  editNote,
  hasUnsavedChanges,
  resetAutosaveForTests,
  saveStatus,
} from '../src/features/notes/autosave';
import { plainCodec } from '../src/features/notes/codec';
import { changedElsewhere, startCrossTabSync } from '../src/features/notes/crossTab';
import {
  DB_NAME,
  KEYRING_META_KEY,
  LEGACY_DB_NAME,
  openNotepadDb,
} from '../src/features/notes/database';
import { createNote, SAMPLE_NOTE_TEXT, type Note } from '../src/features/notes/note';
import { createNoteRepository } from '../src/features/notes/repository';
import { getRepository, notesState, resetNotesStoreForTests } from '../src/features/notes/store';
import { openSearch, searchRequest } from '../src/features/search/state';
import { openTab } from '../src/features/tabs/actions';
import { TABS_META_KEY, tabsState } from '../src/features/tabs/tabs';

const PASSPHRASE = 'quattro parole scelte a caso';
const ITERATIONS = 1000;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetVaultForTests();
  resetNotesStoreForTests();
  resetAutosaveForTests();
  configureVaultForTests({ iterations: ITERATIONS });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetVaultForTests();
  resetAutosaveForTests();
  resetNotesStoreForTests();
});

function notes(): Note[] {
  const state = notesState.value;
  return state.status === 'ready' ? state.notes : [];
}

/** Tutto ciò che è nel database, byte compresi, come testo: per cercarci il testo in chiaro. */
async function rawDump(name: string = DB_NAME): Promise<string> {
  const db = await openDB(name);
  const values: unknown[] = [];
  for (const store of ['notes', 'meta'] as const) {
    values.push(await db.getAll(store), await db.getAllKeys(store));
  }
  db.close();
  return JSON.stringify(values, (_key, value: unknown) => {
    const tag = Object.prototype.toString.call(value);
    if (tag === '[object ArrayBuffer]')
      return new TextDecoder('latin1').decode(value as ArrayBuffer);
    if (tag === '[object Uint8Array]') return new TextDecoder('latin1').decode(value as Uint8Array);
    return value;
  });
}

async function setUp(passphrase: string = PASSPHRASE): Promise<void> {
  await startVault();
  expect(vaultState.value.status).toBe('setup');
  expect(await setupVault(passphrase)).toBe('ok');
}

describe('creazione della passphrase', () => {
  it('scrive il portachiavi e una nota di esempio cifrata', async () => {
    await startVault();
    expect(vaultState.value).toEqual({ status: 'setup', legacy: false });
    expect(await setupVault(PASSPHRASE)).toBe('ok');

    expect(vaultState.value.status).toBe('unlocked');
    expect(notes().map((n) => n.text)).toEqual([SAMPLE_NOTE_TEXT]);
    const db = await openDB(DB_NAME);
    const keyring = (await db.get('meta', KEYRING_META_KEY)) as Record<string, unknown>;
    expect(keyring).toMatchObject({ version: 1, kdf: { iterations: ITERATIONS } });
    const records = (await db.getAll('notes')) as { format: string }[];
    expect(records.map((r) => r.format)).toEqual(['aesgcm-v1']);
    db.close();
    expect(await rawDump()).not.toContain('Nota di esempio');
  });

  it('i dati di servizio passano dal codec; il portachiavi no', async () => {
    await setUp();
    const repo = getRepository();
    await expect(repo.putMeta(KEYRING_META_KEY, {})).rejects.toThrow();
    await expect(repo.getMeta(KEYRING_META_KEY)).rejects.toThrow();
    await repo.putMeta(TABS_META_KEY, { open: [], active: null });
    const db = await openDB(DB_NAME);
    expect(await db.get('meta', TABS_META_KEY)).toMatchObject({ format: 'aesgcm-v1' });
    // Un valore che non si decifra vale undefined, senza bloccare nulla.
    await db.put(
      'meta',
      { format: 'aesgcm-v1', iv: new Uint8Array(12), data: new ArrayBuffer(32) },
      TABS_META_KEY,
    );
    db.close();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await repo.getMeta(TABS_META_KEY)).toBeUndefined();
  });

  it('se un’altra scheda l’ha già creata, rifiuta e chiede di sbloccare', async () => {
    await startVault();
    // L'"altra scheda" crea il portachiavi mentre questa mostra ancora la creazione.
    const other = await openNotepadDb();
    const { keyring } = await createKeyring('passphrase dell’altra scheda', {
      iterations: ITERATIONS,
    });
    expect(await addKeyringIfAbsent(other, keyring)).toBe(true);
    expect(await addKeyringIfAbsent(other, keyring)).toBe(false);
    other.close();

    expect(await setupVault(PASSPHRASE)).toBe('exists');
    expect(vaultState.value).toEqual({
      status: 'locked',
      message: VAULT_MESSAGES.createdElsewhere,
    });
    expect(notesState.value.status).toBe('loading');
    expect(await unlockVault(PASSPHRASE)).toBe('wrong');
    expect(await unlockVault('passphrase dell’altra scheda')).toBe('ok');
  });

  it('al riavvio con il portachiavi chiede di sbloccare', async () => {
    await setUp();
    resetVaultForTests();
    configureVaultForTests({ iterations: ITERATIONS });
    resetNotesStoreForTests();
    await startVault();
    expect(vaultState.value).toEqual({ status: 'locked' });
  });

  it('un portachiavi rovinato si segnala e permette solo di ricominciare', async () => {
    const db = await openNotepadDb();
    await db.put('meta', { version: 1, kdf: null }, KEYRING_META_KEY);
    db.close();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startVault();
    expect(vaultState.value).toMatchObject({ status: 'error', canReset: true });
    expect(await resetVault()).toBe(true);
    expect(vaultState.value).toEqual({ status: 'setup', legacy: false });
  });
});

describe('sblocco e blocco', () => {
  it('sblocca solo con la passphrase giusta', async () => {
    await setUp();
    await lockVault();
    expect(vaultState.value).toEqual({ status: 'locked' });
    expect(await unlockVault('passphrase sbagliata ma lunga')).toBe('wrong');
    expect(vaultState.value.status).toBe('locked');
    expect(notesState.value.status).toBe('loading');
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(notes().map((n) => n.text)).toEqual([SAMPLE_NOTE_TEXT]);
  });

  it('al blocco salva e toglie dalla memoria note, schede, viste, filtri e ricerca', async () => {
    await setUp();
    const [sample] = notes();
    if (!sample) throw new Error('nota mancante');
    openTab(sample.id);
    editNote(sample.id, '# Segreto\n#cliente/acme');
    savedViews.value = [{ name: 'Acme', view: 'all', tags: ['cliente/acme'] }];
    collectionFilter.value = { view: 'open', tags: ['cliente/acme'] };
    deleteRequest.value = sample.id;
    openSearch('acme');
    changedElsewhere.value = new Map([[sample.id, 'modified']]);
    expect(hasUnsavedChanges()).toBe(true);

    await lockVault();

    expect(notesState.value).toEqual({ status: 'loading' });
    expect(tabsState.value).toEqual({ open: [], active: null });
    expect(savedViews.value).toEqual([]);
    expect(collectionFilter.value).toEqual({ view: 'all', tags: [] });
    expect(deleteRequest.value).toBeNull();
    expect(searchRequest.value).toBeNull();
    expect(changedElsewhere.value.size).toBe(0);
    expect(hasUnsavedChanges()).toBe(false);
    expect(saveStatus.value).toEqual({ state: 'saved', at: null });
    expect(() => getRepository()).toThrow();
    expect(lockedQueueSize()).toBe(0);
    expect(await rawDump()).not.toContain('Segreto');

    // La modifica in coda è stata salvata prima del blocco.
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(notes().map((n) => n.text)).toEqual(['# Segreto\n#cliente/acme']);
    expect(tabsState.value.active).toBe(sample.id);
  });

  it('le modifiche che non si salvano al blocco restano cifrate e si scrivono allo sblocco', async () => {
    await setUp();
    const [sample] = notes();
    if (!sample) throw new Error('nota mancante');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const putMany = vi
      .spyOn(getRepository(), 'putMany')
      .mockRejectedValue(new DOMException('pieno', 'QuotaExceededError'));
    editNote(sample.id, 'Trattenuta al blocco');

    await lockVault();
    expect(putMany).toHaveBeenCalled();
    expect(lockedQueueSize()).toBe(1);
    expect(notesState.value.status).toBe('loading');
    expect(await rawDump()).not.toContain('Trattenuta');

    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(lockedQueueSize()).toBe(0);
    expect(notes().map((n) => n.text)).toEqual(['Trattenuta al blocco']);
    expect(saveStatus.value.state).toBe('saved');
    // Davvero nell'archivio: si blocca e si riapre.
    await lockVault();
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(notes().map((n) => n.text)).toEqual(['Trattenuta al blocco']);
  });

  it('una modifica trattenuta più vecchia di quella salvata altrove diventa una nota nuova', async () => {
    await setUp();
    const [sample] = notes();
    if (!sample) throw new Error('nota mancante');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(getRepository(), 'putMany').mockRejectedValue(new Error('disco'));
    editNote(sample.id, 'Versione di questa scheda');
    await lockVault();
    // Intanto un'altra scheda salva una versione più recente della stessa nota.
    const aes = await openOtherTabRepo();
    await aes.put({
      ...sample,
      text: 'Versione dell’altra scheda',
      modifiedAt: Date.now() + 60_000,
    });

    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(
      notes()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['Versione dell’altra scheda', 'Versione di questa scheda']);
  });

  it('un blocco manuale in un’altra scheda blocca anche questa', async () => {
    await setUp();
    const stop = startCrossTabSync();
    const other = new BroadcastChannel('notepad-minus-minus');
    other.postMessage({ locked: true });
    await vi.waitFor(() => expect(vaultState.value.status).toBe('locked'));
    expect(vaultState.value).toEqual({ status: 'locked', message: VAULT_MESSAGES.remote });
    await lockVault();
    expect(notesState.value.status).toBe('loading');
    // Già bloccata: un altro avviso non cambia nulla.
    other.postMessage({ locked: true });
    other.close();
    stop();
  });

  it('il blocco manuale avvisa le altre schede, senza contenuti', async () => {
    await setUp();
    const stop = startCrossTabSync();
    const received: unknown[] = [];
    const other = new BroadcastChannel('notepad-minus-minus');
    other.onmessage = (e: MessageEvent<unknown>) => received.push(e.data);
    await lockVault('manual');
    await vi.waitFor(() => expect(received).toEqual([{ locked: true }]));
    other.close();
    stop();
  });

  it('si blocca da sola dopo il tempo di inattività, senza avvisare le altre schede', async () => {
    await setUp();
    vi.useFakeTimers({ toFake: ['Date'] });
    recordActivity();
    vi.setSystemTime(Date.now() + 14 * 60_000);
    checkAutoLock();
    expect(vaultState.value.status).toBe('unlocked');
    vi.setSystemTime(Date.now() + 60_000);
    checkAutoLock();
    expect(vaultState.value).toEqual({ status: 'locked', message: VAULT_MESSAGES.auto });
    vi.useRealTimers();
    await lockVault();
    expect(notesState.value.status).toBe('loading');
  });
});

/** Repository cifrato di un'"altra scheda" con la stessa passphrase. */
async function openOtherTabRepo() {
  const { createAesCodec } = await import('../src/features/crypto/aesCodec');
  const { parseKeyring, unlockKeyring } = await import('../src/features/crypto/keys');
  const db = await openNotepadDb();
  const keyring = parseKeyring(await db.get('meta', KEYRING_META_KEY), {
    minIterations: ITERATIONS,
  });
  return createNoteRepository(db, createAesCodec(await unlockKeyring(keyring, PASSPHRASE)));
}

describe('cambio passphrase', () => {
  it('serve quella attuale; dopo il cambio vale solo la nuova', async () => {
    await setUp();
    expect(await changePassphrase('non è quella giusta', 'nuova passphrase lunga')).toBe('wrong');
    expect(await changePassphrase(PASSPHRASE, 'nuova passphrase lunga')).toBe('ok');
    await lockVault();
    expect(await unlockVault(PASSPHRASE)).toBe('wrong');
    expect(await unlockVault('nuova passphrase lunga')).toBe('ok');
    expect(notes().map((n) => n.text)).toEqual([SAMPLE_NOTE_TEXT]);
  });
});

describe('passphrase dimenticata', () => {
  it('elimina il database cifrato e torna alla creazione', async () => {
    await setUp();
    await lockVault();
    expect(await resetVault()).toBe(true);
    expect(vaultState.value).toEqual({ status: 'setup', legacy: false });
    const db = await openDB(DB_NAME);
    expect(await db.count('notes')).toBe(0);
    expect(await db.get('meta', KEYRING_META_KEY)).toBeUndefined();
    db.close();
    expect(await setupVault('ricomincio da capo stavolta')).toBe('ok');
    expect(notes().map((n) => n.text)).toEqual([SAMPLE_NOTE_TEXT]);
  });
});

describe('migrazione dal vecchio archivio in chiaro', () => {
  async function seedLegacy(): Promise<Note[]> {
    const db = await openNotepadDb({}, LEGACY_DB_NAME);
    const repo = createNoteRepository(db, plainCodec);
    const a = { ...createNote('# Contratto Acme\n#cliente/acme', 100), modifiedAt: 200 };
    const b = { ...createNote('Lista della spesa', 100), modifiedAt: 100 };
    await repo.putMany([a, b]);
    await repo.putMeta(TABS_META_KEY, { open: [b.id, a.id], active: a.id });
    await repo.putMeta(SAVED_VIEWS_META_KEY, [
      { name: 'Clienti', view: 'all', tags: ['cliente/acme'] },
    ]);
    db.close();
    return [a, b];
  }

  it('cifra note, schede e viste salvate, poi elimina il vecchio database', async () => {
    const [a, b] = await seedLegacy();
    await startVault();
    expect(vaultState.value).toEqual({ status: 'setup', legacy: true });
    expect(await setupVault(PASSPHRASE)).toBe('ok');

    // Le note già presenti: niente nota di esempio.
    expect(notes()).toEqual([a, b]);
    expect(tabsState.value).toEqual({ open: [b?.id, a?.id], active: a?.id });
    expect(savedViews.value).toEqual([{ name: 'Clienti', view: 'all', tags: ['cliente/acme'] }]);
    await vi.waitFor(async () => expect(await databaseExists(LEGACY_DB_NAME)).toBe(false));

    const dump = await rawDump();
    for (const secret of ['Contratto', 'Acme', 'acme', 'spesa', 'Clienti']) {
      expect(dump).not.toContain(secret);
    }
  });

  it('se una nota vecchia non si legge conserva il vecchio database', async () => {
    await seedLegacy();
    const legacy = await openDB(LEGACY_DB_NAME);
    await legacy.put('notes', { id: 'rotta', format: 'plain-v1', payload: { text: 1 } });
    legacy.close();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await startVault();
    expect(await setupVault(PASSPHRASE)).toBe('ok');
    expect(notes()).toHaveLength(2);
    expect(await databaseExists(LEGACY_DB_NAME)).toBe(true);
  });

  it('dopo uno sblocco copia le note scritte nel frattempo nel vecchio archivio', async () => {
    await setUp();
    await lockVault();
    // Una scheda rimasta alla versione precedente scrive ancora in chiaro.
    const db = await openNotepadDb({}, LEGACY_DB_NAME);
    const late = createNote('Scritta da una scheda vecchia', 300);
    await createNoteRepository(db, plainCodec).put(late);
    db.close();

    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(notes().map((n) => n.text)).toContain('Scritta da una scheda vecchia');
    await vi.waitFor(async () => expect(await databaseExists(LEGACY_DB_NAME)).toBe(false));
    expect(await rawDump()).not.toContain('scheda vecchia');
  });
});

/** Promessa da sbloccare a mano: tiene ferma un'operazione a metà. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

async function seedLegacyNotes(...items: Note[]): Promise<void> {
  const db = await openNotepadDb({}, LEGACY_DB_NAME);
  await createNoteRepository(db, plainCodec).putMany(items);
  db.close();
}

describe('migrazione con schede vecchie ancora aperte', () => {
  it('una scheda di F6 salva la sua coda al versionchange e quella scrittura viene cifrata', async () => {
    const first = createNote('# Prima della migrazione', 100);
    const late = createNote('# Scritta all’ultimo dalla scheda vecchia', 150);
    // La "scheda F6": stessa apertura dell'app di allora, con il salvataggio in coda che
    // parte quando un'altra scheda chiede il database (beforeClose).
    const old: { repo?: ReturnType<typeof createNoteRepository> } = {};
    const oldTab = await openNotepadDb(
      { beforeClose: () => old.repo?.put(late) ?? Promise.resolve() },
      LEGACY_DB_NAME,
    );
    old.repo = createNoteRepository(oldTab, plainCodec);
    await old.repo.put(first);

    await startVault();
    expect(vaultState.value).toEqual({ status: 'setup', legacy: true });
    expect(await setupVault(PASSPHRASE)).toBe('ok');
    expect(
      notes()
        .map((n) => n.text)
        .sort(),
    ).toEqual([first.text, late.text].sort());
    await vi.waitFor(async () => expect(await databaseExists(LEGACY_DB_NAME)).toBe(false));
  });

  it('se una scheda vecchia non lascia il database, non tocca nulla e riprova dopo', async () => {
    const { createAesCodec } = await import('../src/features/crypto/aesCodec');
    const { migrateLegacy } = await import('../src/features/crypto/legacy');
    await seedLegacyNotes(createNote('# Bloccata', 100));
    // Connessione che ignora versionchange: tiene bloccato l'aggiornamento.
    const stubborn = await openDB(LEGACY_DB_NAME);
    const target = await openNotepadDb();
    const aes = createAesCodec((await createKeyring(PASSPHRASE, { iterations: ITERATIONS })).key);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const blocked = await migrateLegacy(target, aes, { includeMeta: false, blockedTimeoutMs: 50 });
    expect(blocked).toMatchObject({ blocked: true, migrated: 0, deletion: null });
    expect(await target.count('notes')).toBe(0);
    expect(await databaseExists(LEGACY_DB_NAME)).toBe(true);

    stubborn.close();
    // L'apertura rimasta in sospeso finisce e si chiude da sola; la prossima volta si migra.
    await vi.waitFor(async () => {
      const again = await migrateLegacy(target, aes, { includeMeta: false });
      expect(again.migrated).toBe(1);
    });
    target.close();
  });

  it('una copia vecchia più recente di una nota già importata la sostituisce', async () => {
    const note = { ...createNote('# Versione importata', 100), modifiedAt: 200 };
    await seedLegacyNotes(note);
    await startVault();
    expect(await setupVault(PASSPHRASE)).toBe('ok');
    await vi.waitFor(async () => expect(await databaseExists(LEGACY_DB_NAME)).toBe(false));
    await lockVault();

    // Il vecchio database ricompare con una copia più recente della stessa nota.
    await seedLegacyNotes({ ...note, text: '# Versione più recente', modifiedAt: 500 });
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(notes().map((n) => n.text)).toEqual(['# Versione più recente']);
  });

  it('una nota importata ed eliminata non ricompare se il vecchio database resta', async () => {
    const { deleteNote } = await import('../src/features/collection/actions');
    const { legacyLeftover } = await import('../src/features/crypto/legacy');
    const note = createNote('# Da eliminare', 100);
    await seedLegacyNotes(note);
    const legacy = await openDB(LEGACY_DB_NAME);
    await legacy.put('notes', { id: 'rotta', format: 'plain-v1', payload: { text: 1 } });
    legacy.close();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await startVault();
    expect(await setupVault(PASSPHRASE)).toBe('ok');
    expect(legacyLeftover.value).toBe(1);
    expect(await databaseExists(LEGACY_DB_NAME)).toBe(true);
    expect(await deleteNote(note.id)).toBe(true);

    await lockVault();
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(notes().map((n) => n.text)).not.toContain('# Da eliminare');
    expect(legacyLeftover.value).toBe(1);
  });
});

describe('blocco e sblocco che si incrociano', () => {
  it('una nota trattenuta per un conflitto torna come copia, senza sovrascrivere', async () => {
    const { holdSaves } = await import('../src/features/notes/autosave');
    await setUp();
    const [sample] = notes();
    if (!sample) throw new Error('nota mancante');
    holdSaves(sample.id);
    editNote(sample.id, 'Versione trattenuta di questa scheda');
    // Intanto l'altra scheda ha salvato la sua versione (più vecchia, ma la scelta non c'è stata).
    const other = await openOtherTabRepo();
    await other.put({ ...sample, text: 'Versione dell’altra scheda', modifiedAt: 1 });

    await lockVault();
    expect(lockedQueueSize()).toBe(1);
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    expect(
      notes()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['Versione dell’altra scheda', 'Versione trattenuta di questa scheda']);
    expect(notes().find((n) => n.id === sample.id)?.text).toBe('Versione dell’altra scheda');
  });

  it('un blocco chiesto durante lo sblocco vince: si resta bloccati, senza note in memoria', async () => {
    await setUp();
    await lockVault();
    const unlocking = unlockVault(PASSPHRASE);
    void lockVault('auto');
    expect(await unlocking).toBe('locked');
    expect(vaultState.value).toEqual({ status: 'locked', message: VAULT_MESSAGES.auto });
    expect(notesState.value.status).toBe('loading');
    expect(() => getRepository()).toThrow();
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
  });

  it('“Ho dimenticato la passphrase” non agisce durante uno sblocco', async () => {
    await setUp();
    await lockVault();
    const unlocking = unlockVault(PASSPHRASE);
    expect(await resetVault()).toBe(false);
    expect(await unlocking).toBe('ok');
    expect(notes().map((n) => n.text)).toEqual([SAMPLE_NOTE_TEXT]);
  });

  it('sbloccare mentre il blocco sta ancora salvando aspetta e ritrova la modifica', async () => {
    await setUp();
    const [sample] = notes();
    if (!sample) throw new Error('nota mancante');
    const repo = getRepository();
    const original = repo.putMany.bind(repo);
    const slow = gate();
    vi.spyOn(repo, 'putMany').mockImplementationOnce(async (items) => {
      await slow.promise;
      await original(items);
    });
    editNote(sample.id, 'Salvata durante il blocco');
    const locking = lockVault();
    const unlocking = unlockVault(PASSPHRASE);
    slow.open();
    await locking;
    expect(await unlocking).toBe('ok');
    expect(notes().map((n) => n.text)).toEqual(['Salvata durante il blocco']);
    expect(lockedQueueSize()).toBe(0);
  });

  it('un’eliminazione che fallisce dopo il blocco non rimette la nota in memoria', async () => {
    const { deleteNote } = await import('../src/features/collection/actions');
    await setUp();
    const [sample] = notes();
    if (!sample) throw new Error('nota mancante');
    const slow = gate();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(getRepository(), 'delete').mockImplementationOnce(async () => {
      await slow.promise;
      throw new Error('disco');
    });
    const deleting = deleteNote(sample.id);
    await lockVault();
    slow.open();
    expect(await deleting).toBe(false);
    expect(hasUnsavedChanges()).toBe(false);
    expect(notesState.value.status).toBe('loading');
    expect(lockedQueueSize()).toBe(0);
  });

  it('la passphrase troppo corta è rifiutata anche fuori dall’interfaccia', async () => {
    await startVault();
    expect(await setupVault('corta')).toBe('invalid');
    expect(vaultState.value.status).toBe('setup');
    expect(await setupVault(PASSPHRASE)).toBe('ok');
    expect(await changePassphrase(PASSPHRASE, 'breve')).toBe('invalid');
  });
});
