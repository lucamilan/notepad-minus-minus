import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import {
  discardPendingSave,
  editNote,
  flushSaves,
  hasUnsavedChanges,
  resetAutosaveForTests,
  RETRY_DELAY_MS,
  SAVE_DELAY_MS,
  saveStatus,
  startAutosaveLifecycle,
} from '../src/features/notes/autosave';
import { plainCodec } from '../src/features/notes/codec';
import { DB_NAME, DB_VERSION, openNotepadDb } from '../src/features/notes/database';
import { createNote, type Note } from '../src/features/notes/note';
import { createNoteRepository, type NoteRepository } from '../src/features/notes/repository';
import {
  addNote,
  initNotes,
  notesState,
  resetNotesStoreForTests,
} from '../src/features/notes/store';

let repo: NoteRepository;
let note: Note;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetNotesStoreForTests();
  resetAutosaveForTests();
  repo = createNoteRepository(await openNotepadDb(), plainCodec);
  note = createNote('# Prima', 1000);
  await repo.put(note);
  await initNotes(() => Promise.resolve(repo));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAutosaveForTests();
  resetNotesStoreForTests();
});

const stored = async () => (await repo.get(note.id))?.text;

describe('salvataggio continuo', () => {
  it('salva dopo una pausa di mezzo secondo, una volta sola per una raffica di tasti', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(5000);
    const putMany = vi.spyOn(repo, 'putMany');

    editNote(note.id, '# Prima r');
    vi.advanceTimersByTime(SAVE_DELAY_MS - 100);
    editNote(note.id, '# Prima ri');
    expect(saveStatus.value).toEqual({ state: 'pending' });
    vi.advanceTimersByTime(SAVE_DELAY_MS - 100);
    expect(putMany).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    vi.useRealTimers();
    await vi.waitFor(() => expect(saveStatus.value.state).toBe('saved'));
    expect(putMany).toHaveBeenCalledTimes(1);
    const saved = await repo.get(note.id);
    expect(saved).toMatchObject({ text: '# Prima ri', createdAt: 1000 });
    expect(saved?.modifiedAt).toBeGreaterThanOrEqual(5000);
  });

  it('Ctrl+S (flushSaves) salva subito e lo stato riporta l’ora', async () => {
    editNote(note.id, 'subito');
    await flushSaves();
    expect(await stored()).toBe('subito');
    expect(saveStatus.value).toMatchObject({ state: 'saved' });
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('senza modifiche non scrive nulla', async () => {
    const putMany = vi.spyOn(repo, 'putMany');
    editNote(note.id, '# Prima'); // stesso testo dell'editor appena montato
    await flushSaves();
    expect(putMany).not.toHaveBeenCalled();
    expect(saveStatus.value).toEqual({ state: 'saved', at: null });
  });

  it('le modifiche arrivate durante un salvataggio partono nel giro successivo', async () => {
    let release: () => void = () => undefined;
    const realPutMany = repo.putMany.bind(repo);
    vi.spyOn(repo, 'putMany').mockImplementationOnce(async (notes) => {
      await new Promise<void>((resolve) => (release = resolve));
      return realPutMany(notes);
    });

    editNote(note.id, 'uno');
    const first = flushSaves();
    await vi.waitFor(() => expect(saveStatus.value.state).toBe('saving'));
    editNote(note.id, 'due');
    const second = flushSaves();
    release();
    await Promise.all([first, second]);
    expect(await stored()).toBe('due');
    expect(saveStatus.value.state).toBe('saved');
  });

  it('se la scrittura fallisce lo dice, tiene le modifiche e riprova', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(repo, 'putMany').mockRejectedValueOnce(new DOMException('x', 'QuotaExceededError'));

    editNote(note.id, 'da non perdere');
    await flushSaves();
    expect(saveStatus.value).toMatchObject({ state: 'error' });
    expect(saveStatus.value.state === 'error' && saveStatus.value.message).toContain(
      'Spazio di archiviazione esaurito',
    );
    expect(hasUnsavedChanges()).toBe(true);

    // Una nuova modifica non nasconde l'errore finché il salvataggio non riesce.
    editNote(note.id, 'da non perdere!');
    expect(saveStatus.value.state).toBe('error');
    await flushSaves();
    expect(await stored()).toBe('da non perdere!');
    expect(saveStatus.value.state).toBe('saved');
  });

  it('dopo un errore riprova da solo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(repo, 'putMany').mockRejectedValueOnce(new Error('disco'));
    editNote(note.id, 'riprova');
    await flushSaves();
    expect(saveStatus.value.state).toBe('error');
    expect(saveStatus.value.state === 'error' && saveStatus.value.message).not.toContain(
      'ricarica la pagina',
    );

    vi.advanceTimersByTime(RETRY_DELAY_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(saveStatus.value.state).toBe('saved'));
    expect(await stored()).toBe('riprova');
  });

  it('una creazione annullata con salvataggio in coda non resta "non salvata"', async () => {
    await flushSaves();
    const ghost = createNote('fantasma', 1);
    // Come in createNoteInNewTab: la nota è in memoria e l'utente ci scrive subito.
    addNote(ghost);
    editNote(ghost.id, 'fantasma!');
    expect(saveStatus.value.state).toBe('pending');

    discardPendingSave(ghost.id);
    expect(saveStatus.value.state).toBe('saved');
    expect(hasUnsavedChanges()).toBe(false);
    await flushSaves();
    expect(await repo.get(ghost.id)).toBeUndefined();
  });

  it('una creazione annullata mentre la nota è già in scrittura non lascia la nota', async () => {
    const ghost = createNote('fantasma', 1);
    addNote(ghost);
    editNote(ghost.id, 'fantasma!');
    const writing = flushSaves();
    discardPendingSave(ghost.id); // la put di createNoteInNewTab è fallita nel frattempo
    await writing;
    expect(await repo.get(ghost.id)).toBeUndefined();
  });

  it('il testo in memoria segue l’editor anche prima del salvataggio', () => {
    editNote(note.id, 'in memoria');
    const state = notesState.value;
    expect(state.status === 'ready' && state.notes[0]?.text).toBe('in memoria');
  });
});

describe('ciclo di vita della pagina', () => {
  let stop: () => void;
  afterEach(() => stop());

  it('salva anche su pagehide', async () => {
    stop = startAutosaveLifecycle();
    editNote(note.id, 'chiusa');
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(async () => expect(await stored()).toBe('chiusa'));
  });

  it('se un’altra scheda aggiorna lo schema salva la coda prima di cedere l’archivio', async () => {
    resetNotesStoreForTests();
    await initNotes(async (events) =>
      createNoteRepository(await openNotepadDb(events), plainCodec),
    );
    stop = startAutosaveLifecycle();
    editNote(note.id, 'prima dell’aggiornamento');

    // La "versione nuova" in un'altra scheda: si apre solo dopo che questa ha chiuso.
    const upgraded = await openDB(DB_NAME, DB_VERSION + 1);
    const saved = (await upgraded.get('notes', note.id)) as { payload: { text: string } };
    upgraded.close();
    expect(saved.payload.text).toBe('prima dell’aggiornamento');
    expect(notesState.value.status).toBe('error');
  });

  it('salva quando la pagina viene nascosta', async () => {
    stop = startAutosaveLifecycle();
    editNote(note.id, 'nascosta');
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();
    await vi.waitFor(async () => expect(await stored()).toBe('nascosta'));
  });

  it('chiede conferma alla chiusura solo con modifiche ancora da salvare', async () => {
    stop = startAutosaveLifecycle();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);

    editNote(note.id, 'in volo');
    expect(leave()).toBe(true);
    // Intanto il salvataggio è partito.
    await vi.waitFor(async () => expect(await stored()).toBe('in volo'));
    expect(leave()).toBe(false);
  });
});
