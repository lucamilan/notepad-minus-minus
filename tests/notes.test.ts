import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorruptNoteError, plainCodec } from '../src/features/notes/codec';
import { DB_NAME, DB_VERSION, openNotepadDb } from '../src/features/notes/database';
import { createNote, isNote, SAMPLE_NOTE_TEXT, sortNotes } from '../src/features/notes/note';
import {
  requestPersistentStorage,
  requestPersistentStorageOnFirstInteraction,
} from '../src/features/notes/persistence';
import { createNoteRepository, loadNotesEnsuringOne } from '../src/features/notes/repository';
import {
  initNotes,
  messageForError,
  notesState,
  resetNotesStoreForTests,
} from '../src/features/notes/store';

beforeEach(() => {
  // Un IndexedDB nuovo e vuoto per ogni test.
  globalThis.indexedDB = new IDBFactory();
});

async function openRepo() {
  return createNoteRepository(await openNotepadDb(), plainCodec);
}

describe('note', () => {
  it('crea una nota con id univoco e date uguali', () => {
    const a = createNote('ciao', 1000);
    const b = createNote('ciao', 1000);
    expect(a).toMatchObject({ text: 'ciao', createdAt: 1000, modifiedAt: 1000, pinned: false });
    expect(a.id).not.toBe(b.id);
    expect(isNote(a)).toBe(true);
  });

  it('ordina con le fissate in cima e poi dalla più recente', () => {
    const old = { ...createNote('vecchia', 1), modifiedAt: 10 };
    const recent = { ...createNote('recente', 1), modifiedAt: 30 };
    const pinned = { ...createNote('fissata', 1), modifiedAt: 5, pinned: true };
    expect(sortNotes([old, recent, pinned]).map((n) => n.text)).toEqual([
      'fissata',
      'recente',
      'vecchia',
    ]);
  });
});

describe('plainCodec', () => {
  it('codifica e decodifica senza perdere dati, con solo id e formato fuori dal payload', async () => {
    const note = createNote('testo', 42);
    const stored = await plainCodec.encode(note);
    expect(Object.keys(stored).sort()).toEqual(['format', 'id', 'payload']);
    expect(await plainCodec.decode(stored)).toEqual(note);
  });

  it('funziona anche con i metodi staccati dall’oggetto', async () => {
    const { encode, decode } = plainCodec;
    const note = createNote('x', 1);
    expect(await decode(await encode(note))).toEqual(note);
  });

  it('rifiuta record di altro formato o incompleti', async () => {
    await expect(plainCodec.decode({ id: 'x', format: 'aes', payload: {} })).rejects.toThrow(
      CorruptNoteError,
    );
    await expect(
      plainCodec.decode({ id: 'x', format: 'plain-v1', payload: { text: 1 } }),
    ).rejects.toThrow(CorruptNoteError);
  });
});

describe('database', () => {
  it('crea lo schema alla versione corrente, senza indici sui contenuti', async () => {
    const db = await openNotepadDb();
    expect(db.name).toBe('notepad-minus-minus-cifrato');
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['meta', 'notes']);
    expect([...db.transaction('notes').store.indexNames]).toEqual([]);
    db.close();
  });

  it('riaprendo non tocca i dati già salvati', async () => {
    const repo = await openRepo();
    const note = createNote('resto qui', 1);
    await repo.put(note);
    const again = await openRepo();
    expect(await again.get(note.id)).toEqual(note);
  });

  it('chiude la propria connessione quando un’altra scheda aggiorna lo schema', async () => {
    const onVersionChange = vi.fn();
    await openNotepadDb({ onVersionChange });
    // Simula una versione futura dell'app che alza lo schema: non deve restare bloccata.
    const newer = await openDB(DB_NAME, DB_VERSION + 1);
    expect(newer.version).toBe(DB_VERSION + 1);
    expect(onVersionChange).toHaveBeenCalledOnce();
    newer.close();
  });

  it('una versione vecchia dell’app non apre un database più recente', async () => {
    const newer = await openDB(DB_NAME, DB_VERSION + 1);
    newer.close();
    await expect(openNotepadDb()).rejects.toMatchObject({ name: 'VersionError' });
  });
});

describe('repository', () => {
  it('salva, rilegge, aggiorna ed elimina', async () => {
    const repo = await openRepo();
    const note = createNote('prima', 1);
    await repo.put(note);
    expect(await repo.get(note.id)).toEqual(note);

    await repo.put({ ...note, text: 'dopo', modifiedAt: 2 });
    expect((await repo.get(note.id))?.text).toBe('dopo');

    await repo.delete(note.id);
    expect(await repo.get(note.id)).toBeUndefined();
    expect(await repo.list()).toEqual({ notes: [], unreadable: [] });
  });

  it('salva più note in una transazione e le elenca ordinate', async () => {
    const repo = await openRepo();
    const a = { ...createNote('a', 1), modifiedAt: 1 };
    const b = { ...createNote('b', 1), modifiedAt: 2 };
    await repo.putMany([a, b]);
    expect((await repo.list()).notes.map((n) => n.text)).toEqual(['b', 'a']);
  });

  it('putMany è tutto o niente', async () => {
    const repo = await openRepo();
    const valid = createNote('valida', 1);
    const invalid = { ...createNote('senza id', 1), id: undefined as unknown as string };
    await expect(repo.putMany([valid, invalid])).rejects.toBeDefined();
    expect((await repo.list()).notes).toEqual([]);
  });

  it('un record illeggibile non blocca le altre note e resta intatto', async () => {
    const repo = await openRepo();
    const good = createNote('buona', 1);
    await repo.put(good);
    const db = await openDB(DB_NAME);
    const broken = { id: 'rotta', format: 'sconosciuto', payload: 'xxx' };
    await db.put('notes', broken);

    const list = await repo.list();
    expect(list.notes).toEqual([good]);
    expect(list.unreadable).toEqual(['rotta']);
    expect(await db.get('notes', 'rotta')).toEqual(broken);
    db.close();
  });

  it('addIfEmpty scrive solo in un archivio vuoto', async () => {
    const repo = await openRepo();
    expect(await repo.addIfEmpty(createNote('prima', 1))).toBe(true);
    expect(await repo.addIfEmpty(createNote('seconda', 1))).toBe(false);
    expect((await repo.list()).notes.map((n) => n.text)).toEqual(['prima']);
  });
});

describe('loadNotesEnsuringOne', () => {
  it('al primo avvio crea e salva la nota di esempio una sola volta', async () => {
    const repo = await openRepo();
    const first = await loadNotesEnsuringOne(repo, () => 500);
    expect(first.notes).toHaveLength(1);
    expect(first.notes[0]).toMatchObject({ text: SAMPLE_NOTE_TEXT, createdAt: 500 });
    expect(await loadNotesEnsuringOne(repo)).toEqual(first);
  });

  it('con due schede aperte insieme al primo avvio crea una sola nota', async () => {
    const [tabA, tabB] = await Promise.all([openRepo(), openRepo()]);
    await Promise.all([loadNotesEnsuringOne(tabA), loadNotesEnsuringOne(tabB)]);
    expect((await tabA.list()).notes).toHaveLength(1);
  });

  it('non aggiunge nulla se ci sono già note, anche solo illeggibili', async () => {
    const repo = await openRepo();
    await repo.put(createNote('mia', 1));
    expect((await loadNotesEnsuringOne(repo)).notes.map((n) => n.text)).toEqual(['mia']);

    globalThis.indexedDB = new IDBFactory();
    const empty = await openRepo();
    const db = await openDB(DB_NAME);
    await db.put('notes', { id: 'rotta', format: '?', payload: null });
    db.close();
    expect(await loadNotesEnsuringOne(empty)).toEqual({ notes: [], unreadable: ['rotta'] });
  });
});

describe('initNotes', () => {
  afterEach(() => resetNotesStoreForTests());

  it('apre l’archivio e passa allo stato "ready"', async () => {
    await initNotes(() => openRepo());
    const state = notesState.value;
    expect(state.status).toBe('ready');
    expect(state.status === 'ready' && state.notes[0]?.text).toBe(SAMPLE_NOTE_TEXT);
  });

  it('chiamato due volte apre l’archivio una sola volta', async () => {
    const open = vi.fn(() => openRepo());
    await Promise.all([initNotes(open), initNotes(open)]);
    expect(open).toHaveBeenCalledOnce();
  });

  it('se l’apertura fallisce mostra un messaggio adatto all’errore', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await initNotes(() => Promise.reject(new DOMException('x', 'QuotaExceededError')));
    expect(notesState.value).toEqual({
      status: 'error',
      message: expect.stringContaining('spazio'),
    });
  });

  it('se l’archivio non risponde spiega cosa fare, senza arrendersi', async () => {
    vi.useFakeTimers();
    let resolveOpen: (repo: Awaited<ReturnType<typeof openRepo>>) => void = () => undefined;
    const pending = initNotes(() => new Promise((resolve) => (resolveOpen = resolve)));
    await vi.advanceTimersByTimeAsync(8000);
    expect(notesState.value).toEqual({
      status: 'loading',
      message: expect.stringContaining('non risponde'),
    });
    vi.useRealTimers();
    resolveOpen(await openRepo());
    await pending;
    expect(notesState.value.status).toBe('ready');
  });

  it('distingue versione più recente, spazio esaurito e archivio non disponibile', () => {
    expect(messageForError(new DOMException('x', 'VersionError'))).toContain('più recente');
    expect(messageForError(new DOMException('x', 'QuotaExceededError'))).toContain('spazio');
    expect(messageForError(new DOMException('x', 'SecurityError'))).toContain('non permette');
  });
});

describe('persistenza', () => {
  it('non chiede di nuovo se l’archivio è già persistente', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const result = await requestPersistentStorage({
      persisted: () => Promise.resolve(true),
      persist,
    });
    expect(result).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('chiede la persistenza e gestisce API assenti o errori', async () => {
    expect(
      await requestPersistentStorage({
        persisted: () => Promise.resolve(false),
        persist: () => Promise.resolve(true),
      }),
    ).toBe(true);
    expect(await requestPersistentStorage(undefined)).toBe(false);
    expect(
      await requestPersistentStorage({
        persisted: () => Promise.reject(new Error('no')),
        persist: () => Promise.resolve(true),
      }),
    ).toBe(false);
  });

  it('alla prima interazione chiede una sola volta e smette di ascoltare', () => {
    const persisted = vi.fn(() => Promise.resolve(false));
    vi.stubGlobal('navigator', { storage: { persisted, persist: () => Promise.resolve(true) } });
    const target = new EventTarget();
    requestPersistentStorageOnFirstInteraction(target);
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('keydown'));
    expect(persisted).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
