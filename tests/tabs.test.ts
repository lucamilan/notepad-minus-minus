import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plainCodec } from '../src/features/notes/codec';
import { openNotepadDb } from '../src/features/notes/database';
import {
  createNote,
  NEW_NOTE_TEXT,
  NEW_NOTE_TITLE_RANGE,
  noteTitle,
  tabTitle,
  UNTITLED,
} from '../src/features/notes/note';
import { createNoteRepository, type NoteRepository } from '../src/features/notes/repository';
import {
  initNotes,
  notesState,
  resetNotesStoreForTests,
  updateNoteText,
} from '../src/features/notes/store';
import {
  actionError,
  closeActiveTab,
  closeTab,
  createNoteInNewTab,
  cycleTabKeepingEditorFocus,
  editorFocusRequest,
  openTab,
} from '../src/features/tabs/actions';
import {
  hiddenTabs,
  isTabsState,
  restoreTabs,
  TABS_META_KEY,
  tabsState,
  tabsToSave,
  withClosed,
  withCycled,
  withOpened,
} from '../src/features/tabs/tabs';

describe('titolo della nota', () => {
  it('usa la prima riga non vuota senza la sintassi Markdown', () => {
    expect(noteTitle('\n\n  # Riunione *cliente*  \nresto')).toBe('Riunione cliente');
    expect(noteTitle('- [x] Chiamare **Mario**')).toBe('Chiamare Mario');
    expect(noteTitle('1. Primo punto')).toBe('Primo punto');
    expect(noteTitle('> Citazione `codice`')).toBe('Citazione codice');
    expect(noteTitle('Vedi [il sito](https://example.com) ~~ora~~')).toBe('Vedi il sito ora');
    expect(noteTitle('#hashtag non è un titolo')).toBe('#hashtag non è un titolo');
    expect(noteTitle('Riga\r\nseconda')).toBe('Riga');
  });

  it('senza testo utile usa un titolo di ripiego', () => {
    expect(noteTitle('')).toBe(UNTITLED);
    expect(noteTitle('   \n\n')).toBe(UNTITLED);
    expect(noteTitle('# ')).toBe(UNTITLED);
    expect(noteTitle('***')).toBe(UNTITLED);
  });

  it('nella scheda tronca a 27 caratteri più "..." senza spezzare le emoji', () => {
    expect(tabTitle('# Lista della spesa')).toBe('Lista della spesa');
    expect(tabTitle('a'.repeat(27))).toBe('a'.repeat(27));
    expect(tabTitle('a'.repeat(28))).toBe(`${'a'.repeat(27)}...`);
    expect(tabTitle(`${'a'.repeat(26)}😀😀`)).toBe(`${'a'.repeat(26)}😀...`);
  });

  it('la nota nuova seleziona il proprio titolo', () => {
    const { anchor, head } = NEW_NOTE_TITLE_RANGE;
    expect(NEW_NOTE_TEXT.slice(anchor, head)).toBe('Nuova nota');
  });
});

describe('stato delle schede', () => {
  const s = (open: string[], active: string | null) => ({ open, active });

  it('apre in fondo, senza doppioni, e attiva', () => {
    expect(withOpened(s(['a'], 'a'), 'b')).toEqual(s(['a', 'b'], 'b'));
    expect(withOpened(s(['a', 'b'], 'b'), 'a')).toEqual(s(['a', 'b'], 'a'));
    const same = s(['a'], 'a');
    expect(withOpened(same, 'a')).toBe(same);
  });

  it('chiudendo la scheda attiva passa alla successiva, o alla precedente se era l’ultima', () => {
    expect(withClosed(s(['a', 'b', 'c'], 'b'), 'b')).toEqual(s(['a', 'c'], 'c'));
    expect(withClosed(s(['a', 'b', 'c'], 'c'), 'c')).toEqual(s(['a', 'b'], 'b'));
    expect(withClosed(s(['a', 'b'], 'a'), 'b')).toEqual(s(['a'], 'a'));
    expect(withClosed(s(['a'], 'a'), 'a')).toEqual(s([], null));
    const same = s(['a'], 'a');
    expect(withClosed(same, 'x')).toBe(same);
  });

  it('scorre le schede in entrambe le direzioni ripartendo dall’altro capo', () => {
    expect(withCycled(s(['a', 'b', 'c'], 'c'), 1).active).toBe('a');
    expect(withCycled(s(['a', 'b', 'c'], 'a'), -1).active).toBe('c');
    const single = s(['a'], 'a');
    expect(withCycled(single, 1)).toBe(single);
    expect(withCycled(s([], null), 1)).toEqual(s([], null));
  });

  it('ripristina le schede salvate scartando le note che non esistono più', () => {
    expect(restoreTabs(s(['a', 'x', 'b', 'a'], 'b'), ['a', 'b'])).toEqual(s(['a', 'b'], 'b'));
    expect(restoreTabs(s(['a', 'x'], 'x'), ['a', 'b'])).toEqual(s(['a'], 'a'));
    // La scheda attiva salvata deve essere tra quelle aperte.
    expect(restoreTabs(s(['a'], 'b'), ['a', 'b'])).toEqual(s(['a'], 'a'));
    // Chi aveva chiuso tutte le schede le ritrova chiuse.
    expect(restoreTabs(s([], null), ['a'])).toEqual(s([], null));
  });

  it('conserva nello stato salvato le schede delle note illeggibili, senza mostrarle', () => {
    const saved = s(['a', 'x', 'y'], 'x');
    expect(hiddenTabs(saved, ['x', 'z'])).toEqual(['x']);
    expect(hiddenTabs(undefined, ['x'])).toEqual([]);
    expect(tabsToSave(s(['a', 'b'], 'b'), ['x'])).toEqual(s(['a', 'b', 'x'], 'b'));
    const plain = s(['a'], 'a');
    expect(tabsToSave(plain, [])).toBe(plain);
  });

  it('senza stato salvato valido apre la prima nota', () => {
    expect(restoreTabs(undefined, ['a', 'b'])).toEqual(s(['a'], 'a'));
    expect(restoreTabs({ open: [1], active: 'a' }, ['a'])).toEqual(s(['a'], 'a'));
    expect(restoreTabs(undefined, [])).toEqual(s([], null));
    expect(isTabsState('x')).toBe(false);
    expect(isTabsState({ open: ['a'] })).toBe(false);
  });
});

describe('schede e archivio', () => {
  let repo: NoteRepository;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetNotesStoreForTests();
    actionError.value = null;
    editorFocusRequest.value = null;
    repo = createNoteRepository(await openNotepadDb(), plainCodec);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetNotesStoreForTests();
  });

  // Le scritture delle schede partono senza await: si aspetta che arrivino nell'archivio.
  const expectSavedTabs = (expected: unknown) =>
    vi.waitFor(async () => expect(await repo.getMeta(TABS_META_KEY)).toEqual(expected));

  it('al primo avvio apre la nota di esempio', async () => {
    await initNotes(() => Promise.resolve(repo));
    const state = notesState.value;
    expect(state.status).toBe('ready');
    const id = state.status === 'ready' ? state.notes[0]?.id : undefined;
    expect(tabsState.value).toEqual({ open: [id], active: id });
  });

  it('ricorda le schede aperte e chiuderle non elimina le note', async () => {
    const [a, b, c] = [createNote('A', 1), createNote('B', 2), createNote('C', 3)];
    await repo.putMany([a, b, c]);
    await repo.putMeta(TABS_META_KEY, { open: [a.id, c.id], active: c.id });
    await initNotes(() => Promise.resolve(repo));
    expect(tabsState.value).toEqual({ open: [a.id, c.id], active: c.id });

    openTab(b.id);
    closeTab(a.id);
    await expectSavedTabs({ open: [c.id, b.id], active: b.id });
    closeActiveTab();
    closeActiveTab();
    await expectSavedTabs({ open: [], active: null });
    expect((await repo.list()).notes).toHaveLength(3);
  });

  it('una nota nuova si apre subito in fondo, chiede il focus sul titolo e si salva', async () => {
    await initNotes(() => Promise.resolve(repo));
    const before = tabsState.value.open;
    const pending = createNoteInNewTab(5000);
    // La scheda è già aperta prima che l'archivio confermi il salvataggio.
    expect(tabsState.value.open).toHaveLength(before.length + 1);
    await pending;

    const { open, active } = tabsState.value;
    expect(open.slice(0, -1)).toEqual(before);
    expect(active).toBe(open.at(-1));
    expect(await repo.get(active ?? '')).toMatchObject({ text: NEW_NOTE_TEXT, createdAt: 5000 });
    expect(editorFocusRequest.value).toEqual({ id: active, selection: NEW_NOTE_TITLE_RANGE });
    await expectSavedTabs({ open, active });
  });

  it('se la nota nuova non si salva lo dice e richiude la scheda', async () => {
    await initNotes(() => Promise.resolve(repo));
    const before = tabsState.value;
    const notesBefore = notesState.value;
    vi.spyOn(repo, 'put').mockRejectedValueOnce(new DOMException('x', 'QuotaExceededError'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await createNoteInNewTab();
    expect(tabsState.value).toEqual(before);
    expect(notesState.value).toEqual(notesBefore);
    expect(actionError.value).toContain('Spazio di archiviazione esaurito');
  });

  it('doppio clic o Alt+N ripetuto creano una sola nota', async () => {
    await initNotes(() => Promise.resolve(repo));
    await Promise.all([createNoteInNewTab(), createNoteInNewTab(), createNoteInNewTab()]);
    expect((await repo.list()).notes).toHaveLength(2);
    expect(tabsState.value.open).toHaveLength(2);
    // Finita la creazione, la successiva funziona di nuovo.
    await createNoteInNewTab();
    expect((await repo.list()).notes).toHaveLength(3);
  });

  it('le schede di note illeggibili sopravvivono ai cambi di scheda', async () => {
    const a = createNote('A', 1);
    await repo.put(a);
    await openNotepadDb().then((db) =>
      db.put('notes', { id: 'rotta', format: 'futuro-v9', payload: null }),
    );
    await repo.putMeta(TABS_META_KEY, { open: ['rotta', a.id], active: 'rotta' });
    await initNotes(() => Promise.resolve(repo));
    expect(tabsState.value).toEqual({ open: [a.id], active: a.id });

    closeTab(a.id);
    await expectSavedTabs({ open: ['rotta'], active: null });
  });

  it('il testo modificato aggiorna la nota in memoria, non l’archivio', async () => {
    await initNotes(() => Promise.resolve(repo));
    const id = tabsState.value.active ?? '';
    updateNoteText(id, '# Titolo nuovo');
    const state = notesState.value;
    expect(state.status === 'ready' && state.notes[0]?.text).toBe('# Titolo nuovo');
    expect((await repo.get(id))?.text).not.toBe('# Titolo nuovo');
  });

  it('passando a un’altra scheda da tastiera l’editor resta col focus', async () => {
    const [a, b] = [createNote('A', 1), createNote('B', 2)];
    await repo.putMany([a, b]);
    await repo.putMeta(TABS_META_KEY, { open: [a.id, b.id], active: a.id });
    await initNotes(() => Promise.resolve(repo));
    cycleTabKeepingEditorFocus(1);
    expect(tabsState.value.active).toBe(b.id);
    expect(editorFocusRequest.value).toEqual({ id: b.id });
  });
});
