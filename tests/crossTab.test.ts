import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteNote, togglePinned } from '../src/features/collection/actions';
import {
  editNote,
  flushSaves,
  resetAutosaveForTests,
  saveStatus,
} from '../src/features/notes/autosave';
import { plainCodec } from '../src/features/notes/codec';
import {
  changedElsewhere,
  keepThisVersion,
  loadLatestVersion,
  startCrossTabSync,
} from '../src/features/notes/crossTab';
import { openNotepadDb } from '../src/features/notes/database';
import { createNote, type Note } from '../src/features/notes/note';
import { createNoteRepository, type NoteRepository } from '../src/features/notes/repository';
import { initNotes, notesState, resetNotesStoreForTests } from '../src/features/notes/store';
import { openTab } from '../src/features/tabs/actions';
import { tabsState } from '../src/features/tabs/tabs';

const CHANNEL = 'notepad-minus-minus';

let repo: NoteRepository;
let active: Note;
let other: Note;
let stop: () => void;
/** L'"altra scheda": scrive nell'archivio e avvisa sul canale, come farebbe l'app. */
let otherTab: BroadcastChannel;
let received: unknown[];

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetNotesStoreForTests();
  resetAutosaveForTests();
  repo = createNoteRepository(await openNotepadDb(), plainCodec);
  active = createNote('# Attiva\nqui', 1000);
  other = createNote('# Altra\nlà', 900);
  await repo.putMany([active, other]);
  await initNotes(() => Promise.resolve(repo));
  openTab(active.id);
  received = [];
  otherTab = new BroadcastChannel(CHANNEL);
  otherTab.onmessage = (e: MessageEvent<unknown>) => received.push(e.data);
  stop = startCrossTabSync();
});

afterEach(() => {
  stop();
  otherTab.close();
  changedElsewhere.value = new Map();
  resetAutosaveForTests();
  resetNotesStoreForTests();
});

function inMemory(id: string): Note | undefined {
  const state = notesState.value;
  return state.status === 'ready' ? state.notes.find((n) => n.id === id) : undefined;
}

async function writeElsewhere(note: Note): Promise<void> {
  await repo.put(note);
  otherTab.postMessage({ id: note.id, modifiedAt: note.modifiedAt });
}

describe('avviso tra schede', () => {
  it('manda solo id e data di modifica dopo un salvataggio', async () => {
    editNote(active.id, '# Attiva\nmodificata');
    await flushSaves();
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(Object.keys(received[0] as object).sort()).toEqual(['id', 'modifiedAt']);
  });

  it('una nota non aperta qui si rilegge in silenzio', async () => {
    await writeElsewhere({ ...other, text: '# Altra\naggiornata', modifiedAt: 5000 });
    await vi.waitFor(() => expect(inMemory(other.id)?.text).toBe('# Altra\naggiornata'));
    expect(changedElsewhere.value.size).toBe(0);
  });

  it('con modifiche locali in coda trattiene il salvataggio finché non si sceglie', async () => {
    editNote(active.id, '# Attiva\nlocale');
    await writeElsewhere({ ...active, text: '# Attiva\naltrove', modifiedAt: Date.now() + 1000 });
    await vi.waitFor(() => expect(changedElsewhere.value.get(active.id)).toBe('modified'));

    // Il salvataggio automatico non deve scrivere sopra la versione dell'altra scheda.
    await flushSaves();
    expect((await repo.get(active.id))?.text).toBe('# Attiva\naltrove');
    expect(saveStatus.value.state).toBe('held');

    await loadLatestVersion(active.id);
    expect(inMemory(active.id)?.text).toBe('# Attiva\naltrove');
    expect(saveStatus.value.state).toBe('saved');
    await flushSaves();
    expect((await repo.get(active.id))?.text).toBe('# Attiva\naltrove');
  });

  it('"Tieni questa versione" riscrive la copia locale e avvisa le altre schede', async () => {
    editNote(active.id, '# Attiva\nlocale');
    await writeElsewhere({ ...active, text: '# Attiva\naltrove', modifiedAt: Date.now() + 1000 });
    await vi.waitFor(() => expect(changedElsewhere.value.has(active.id)).toBe(true));

    keepThisVersion(active.id);
    await flushSaves();
    expect((await repo.get(active.id))?.text).toBe('# Attiva\nlocale');
    expect(changedElsewhere.value.size).toBe(0);
    await vi.waitFor(() => expect(received.some((m) => (m as Note).id === active.id)).toBe(true));
  });

  it('la nota attiva eliminata altrove resta finché non si sceglie, senza tornare nell’archivio', async () => {
    editNote(active.id, '# Attiva\nancora qui');
    await repo.delete(active.id);
    otherTab.postMessage({ id: active.id, deleted: true });
    await vi.waitFor(() => expect(changedElsewhere.value.get(active.id)).toBe('deleted'));
    await flushSaves();
    expect(await repo.get(active.id)).toBeUndefined();

    await loadLatestVersion(active.id); // "Chiudi la nota"
    expect(inMemory(active.id)).toBeUndefined();
    expect(tabsState.value.open).not.toContain(active.id);
    expect(saveStatus.value.state).toBe('saved');
  });

  it('una nota eliminata qui e tenuta in un’altra scheda torna e si salva di nuovo', async () => {
    expect(await deleteNote(other.id)).toBe(true);
    expect(inMemory(other.id)).toBeUndefined();

    await writeElsewhere({ ...other, text: '# Altra\ntenuta', modifiedAt: Date.now() + 1000 });
    await vi.waitFor(() => expect(inMemory(other.id)?.text).toBe('# Altra\ntenuta'));

    editNote(other.id, '# Altra\nmodificata qui');
    await flushSaves();
    expect((await repo.get(other.id))?.text).toBe('# Altra\nmodificata qui');
    expect(saveStatus.value.state).toBe('saved');
  });

  it('fissare una nota cambia la data di modifica, così le altre schede la rileggono', async () => {
    togglePinned(other.id, 7000);
    expect(inMemory(other.id)).toMatchObject({ pinned: true, modifiedAt: 7000 });
    await flushSaves();
    expect(await repo.get(other.id)).toMatchObject({ pinned: true });
    await vi.waitFor(() => expect(received).toContainEqual({ id: other.id, modifiedAt: 7000 }));
  });

  it('ignora messaggi malformati', async () => {
    otherTab.postMessage({ id: 42 });
    otherTab.postMessage({ id: other.id, modifiedAt: Infinity });
    otherTab.postMessage('testo');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(inMemory(other.id)?.text).toBe('# Altra\nlà');
  });
});

describe('elimina nota', () => {
  it('se l’archivio rifiuta, la nota resta e torna a salvarsi', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(repo, 'delete').mockRejectedValueOnce(new Error('disco'));
    editNote(other.id, '# Altra\nin coda');
    expect(await deleteNote(other.id)).toBe(false);
    expect(inMemory(other.id)).toBeDefined();
    await flushSaves();
    expect((await repo.get(other.id))?.text).toBe('# Altra\nin coda');
    vi.restoreAllMocks();
  });
});
