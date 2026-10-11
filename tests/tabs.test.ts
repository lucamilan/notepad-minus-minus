import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plainCodec } from '../src/features/notes/codec';
import { changedElsewhere } from '../src/features/notes/crossTab';
import { openNotepadDb } from '../src/features/notes/database';
import { collectionFilter } from '../src/features/collection/state';
import {
  editNote,
  flushSaves,
  isPendingSave,
  resetAutosaveForTests,
} from '../src/features/notes/autosave';
import {
  copyText,
  createNote,
  NEW_NOTE_TEXT,
  NEW_NOTE_TITLE_RANGE,
  noteTitle,
  tabTitle,
  UNTITLED,
  type Note,
} from '../src/features/notes/note';
import { createNoteRepository, type NoteRepository } from '../src/features/notes/repository';
import {
  initNotes,
  notesState,
  resetNotesStoreForTests,
  updateNoteText,
} from '../src/features/notes/store';
import { viewMode } from '../src/features/preview/viewMode';
import {
  actionError,
  closeActiveTab,
  closeAllTabs,
  closeUnpinnedTabs,
  closeTab,
  createNoteInNewTab,
  cycleTabKeepingEditorFocus,
  duplicateNote,
  editorFocusRequest,
  isRepeatedClick,
  openTab,
} from '../src/features/tabs/actions';
import { announcement, resetAnnouncement } from '../src/lib/announce';
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

  it('due creazioni rapide, la seconda prima che la prima sia salvata, creano due note', async () => {
    await initNotes(() => Promise.resolve(repo));
    await Promise.all([createNoteInNewTab(), createNoteInNewTab()]);
    expect((await repo.list()).notes).toHaveLength(3);
    expect(tabsState.value.open).toHaveLength(3);
  });

  it('il secondo clic di un doppio clic non crea un’altra nota', () => {
    expect(isRepeatedClick(new MouseEvent('click', { detail: 1 }))).toBe(false);
    expect(isRepeatedClick(new MouseEvent('click', { detail: 2 }))).toBe(true);
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

describe('chiudi tutte le schede', () => {
  let repo: NoteRepository;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetNotesStoreForTests();
    resetAutosaveForTests();
    repo = createNoteRepository(await openNotepadDb(), plainCodec);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAutosaveForTests();
    resetNotesStoreForTests();
    changedElsewhere.value = new Map();
  });

  it('"Chiudi le schede non fissate" lascia aperte le fissate e quelle in attesa di scelta', async () => {
    const pinned = { ...createNote('Fissata', 1), pinned: true };
    const [a, b, waiting] = [createNote('A', 2), createNote('B', 3), createNote('Altrove', 4)];
    await repo.putMany([pinned, a, b, waiting]);
    await repo.putMeta(TABS_META_KEY, {
      open: [a.id, pinned.id, b.id, waiting.id],
      active: b.id,
    });
    await initNotes(() => Promise.resolve(repo));
    changedElsewhere.value = new Map([[waiting.id, 'modified']]);
    const putMeta = vi.spyOn(repo, 'putMeta');

    closeUnpinnedTabs();
    expect(tabsState.value.open).toEqual([pinned.id, waiting.id]);
    expect(tabsState.value.active).not.toBeNull();
    expect(putMeta).toHaveBeenCalledTimes(1);
    expect((await repo.list()).notes).toHaveLength(4);

    // Con solo schede fissate (o in attesa) non c'è nulla da chiudere.
    closeUnpinnedTabs();
    expect(tabsState.value.open).toEqual([pinned.id, waiting.id]);
  });

  it('chiude tutte le schede con una sola scrittura e non elimina le note', async () => {
    const [a, b, c] = [createNote('A', 1), createNote('B', 2), createNote('C', 3)];
    await repo.putMany([a, b, c]);
    await repo.putMeta(TABS_META_KEY, { open: [a.id, b.id, c.id], active: b.id });
    await initNotes(() => Promise.resolve(repo));
    const putMeta = vi.spyOn(repo, 'putMeta');

    closeAllTabs();
    expect(tabsState.value).toEqual({ open: [], active: null });
    expect(putMeta).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () =>
      expect(await repo.getMeta(TABS_META_KEY)).toEqual({ open: [], active: null }),
    );
    expect((await repo.list()).notes).toHaveLength(3);
    const state = notesState.value;
    expect(state.status === 'ready' && state.notes).toHaveLength(3);

    // Senza schede aperte non c'è niente da salvare.
    closeAllTabs();
    expect(putMeta).toHaveBeenCalledTimes(1);
  });

  it('lascia aperte le note cambiate in un’altra scheda, in attesa della scelta', async () => {
    const [a, b, c] = [createNote('A', 1), createNote('B', 2), createNote('C', 3)];
    await repo.putMany([a, b, c]);
    await repo.putMeta(TABS_META_KEY, { open: [a.id, b.id, c.id], active: a.id });
    await initNotes(() => Promise.resolve(repo));
    changedElsewhere.value = new Map([[b.id, 'modified']]);

    closeAllTabs();
    expect(tabsState.value).toEqual({ open: [b.id], active: b.id });
    await vi.waitFor(async () =>
      expect(await repo.getMeta(TABS_META_KEY)).toEqual({ open: [b.id], active: b.id }),
    );
  });

  it('le modifiche in coda si salvano anche dopo aver chiuso le schede', async () => {
    const a = createNote('A', 1);
    await repo.put(a);
    await repo.putMeta(TABS_META_KEY, { open: [a.id], active: a.id });
    await initNotes(() => Promise.resolve(repo));

    editNote(a.id, 'A modificata');
    closeAllTabs();
    expect(isPendingSave(a.id)).toBe(true);
    await flushSaves();
    expect((await repo.get(a.id))?.text).toBe('A modificata');
  });

  it('le schede nascoste delle note illeggibili restano nello stato salvato', async () => {
    const a = createNote('A', 1);
    await repo.put(a);
    await openNotepadDb().then((db) =>
      db.put('notes', { id: 'rotta', format: 'futuro-v9', payload: null }),
    );
    await repo.putMeta(TABS_META_KEY, { open: [a.id, 'rotta'], active: a.id });
    await initNotes(() => Promise.resolve(repo));

    closeAllTabs();
    expect(tabsState.value).toEqual({ open: [], active: null });
    await vi.waitFor(async () =>
      expect(await repo.getMeta(TABS_META_KEY)).toEqual({ open: ['rotta'], active: null }),
    );
  });
});

describe('titolo della copia', () => {
  it('aggiunge " (copia)" in fondo alla prima riga non vuota, il resto resta uguale', () => {
    expect(copyText('# Riunione\n#cliente/acme\n- [ ] verbale')).toBe(
      '# Riunione (copia)\n#cliente/acme\n- [ ] verbale',
    );
    expect(copyText('\n\n  Titolo  \r\nsecondo')).toBe('\n\n  Titolo (copia)  \r\nsecondo');
    expect(noteTitle(copyText('# Preventivo Acme'))).toBe('Preventivo Acme (copia)');
  });

  it('una nota vuota diventa "(copia)"; un blocco di codice in cima non si rompe', () => {
    expect(copyText('')).toBe('(copia)');
    expect(copyText('  \n ')).toBe('(copia)');
    expect(copyText('```js\nx = 1\n```')).toBe('(copia)\n```js\nx = 1\n```');
  });

  it('non cambia il significato Markdown della prima riga', () => {
    // Tabella: il suffisso nell'intestazione cambierebbe il numero di colonne.
    expect(copyText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(
      '(copia)\n| a | b |\n|---|---|\n| 1 | 2 |',
    );
    expect(copyText('[x]: https://e.it\ntesto')).toBe('(copia)\n[x]: https://e.it\ntesto');
    expect(copyText('---\ntesto')).toBe('(copia)\n---\ntesto');
    expect(copyText('    codice\n')).toBe('(copia)\n    codice\n');
    // Stesso a capo della nota; l'a capo forzato (due spazi) resta.
    expect(copyText('```\r\nx\r\n```')).toBe('(copia)\r\n```\r\nx\r\n```');
    expect(copyText('Titolo  \nriga')).toBe('Titolo (copia)  \nriga');
    // Titoli setext e attività si possono allungare.
    expect(copyText('Titolo\n===')).toBe('Titolo (copia)\n===');
    expect(copyText('- [ ] da fare')).toBe('- [ ] da fare (copia)');
  });

  it('nella scheda "(copia)" resta visibile anche su un titolo lungo', () => {
    const long = '# Preventivo cliente Acme marzo 2026';
    expect(tabTitle(long)).toBe('Preventivo cliente Acme mar...');
    expect(tabTitle(copyText(long))).toBe('Preventivo cliente ... (copia)');
    expect(tabTitle(copyText('# Preventivo Acme'))).toBe('Preventivo Acme (copia)');
  });
});

describe('duplica la nota', () => {
  let repo: NoteRepository;
  let original: Note;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetNotesStoreForTests();
    resetAutosaveForTests();
    actionError.value = null;
    editorFocusRequest.value = null;
    resetAnnouncement();
    repo = createNoteRepository(await openNotepadDb(), plainCodec);
    original = { ...createNote('# Riunione\n#cliente/acme\n- [ ] verbale', 1000), pinned: true };
    await repo.put(original);
    await repo.putMeta(TABS_META_KEY, { open: [original.id], active: original.id });
    await initNotes(() => Promise.resolve(repo));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetAutosaveForTests();
    resetNotesStoreForTests();
    resetAnnouncement();
    collectionFilter.value = { view: 'all', tags: [] };
    viewMode.value = 'split';
  });

  const inMemory = (id: string) => {
    const state = notesState.value;
    return state.status === 'ready' ? state.notes.find((note) => note.id === id) : undefined;
  };

  it('copia il testo in memoria con id e date nuovi, non fissata, aperta e attiva', async () => {
    // Modifica non ancora salvata: la copia parte dal testo in memoria.
    editNote(original.id, `${original.text}\nnon ancora salvato`);
    const edited = inMemory(original.id);
    const pending = duplicateNote(original.id, 9000);
    // La scheda si apre prima che l'archivio confermi.
    const { open, active } = tabsState.value;
    expect(open).toHaveLength(2);
    expect(active).toBe(open[1]);
    expect(active).not.toBe(original.id);
    await pending;

    expect(await repo.get(active ?? '')).toEqual({
      id: active,
      text: copyText(edited?.text ?? ''),
      createdAt: 9000,
      modifiedAt: 9000,
      pinned: false,
    });
    expect(editorFocusRequest.value).toEqual({ id: active, selection: { anchor: 0, head: 0 } });
    // L'originale resta com'era.
    expect(inMemory(original.id)).toBe(edited);
    await vi.waitFor(() => expect(announcement.value).toBe('Nota duplicata'));
  });

  it('con un salvataggio in coda si salvano sia l’originale sia la copia', async () => {
    editNote(original.id, 'testo nuovo');
    expect(isPendingSave(original.id)).toBe(true);
    await duplicateNote(original.id, 9000);
    await flushSaves();
    const stored = (await repo.list()).notes;
    expect(stored).toHaveLength(2);
    expect(stored.map((note) => note.text)).toEqual(['testo nuovo', 'testo nuovo (copia)']);
    expect(stored.find((note) => note.id === original.id)?.pinned).toBe(true);
  });

  it('dalla sola anteprima passa all’affiancata; nella vista Fissate passa a Tutte', async () => {
    viewMode.value = 'preview';
    collectionFilter.value = { view: 'pinned', tags: ['cliente/acme'] };
    await duplicateNote(original.id, 9000);
    expect(viewMode.value).toBe('split');
    expect(collectionFilter.value).toEqual({ view: 'all', tags: ['cliente/acme'] });
  });

  it('se la copia non si salva lo dice e torna tutto com’era', async () => {
    collectionFilter.value = { view: 'pinned', tags: [] };
    const tabsBefore = tabsState.value;
    const notesBefore = notesState.value;
    vi.spyOn(repo, 'put').mockRejectedValueOnce(new DOMException('x', 'QuotaExceededError'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await duplicateNote(original.id);
    expect(tabsState.value).toEqual(tabsBefore);
    expect(notesState.value).toEqual(notesBefore);
    expect(collectionFilter.value).toEqual({ view: 'pinned', tags: [] });
    expect(actionError.value).toContain('Spazio di archiviazione esaurito');
    expect((await repo.list()).notes).toHaveLength(1);
    expect(announcement.value).toBe('');
  });

  it('bloccando durante la scrittura la copia non torna in memoria e non si annuncia', async () => {
    let finish: () => void = () => undefined;
    vi.spyOn(repo, 'put').mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    announcement.value = 'precedente';
    const pending = duplicateNote(original.id);
    resetNotesStoreForTests(); // come il blocco: nuova epoca, note fuori dalla memoria
    finish();
    await pending;
    expect(notesState.value).toEqual({ status: 'loading' });
    expect(tabsState.value).toEqual({ open: [], active: null });
    // announce() avrebbe svuotato subito il messaggio precedente e lo riscrive dopo 100 ms.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(announcement.value).toBe('precedente');
  });

  it('a note bloccate, o per una nota che non c’è, non fa nulla', async () => {
    await duplicateNote('inesistente');
    expect(tabsState.value.open).toEqual([original.id]);
    resetNotesStoreForTests();
    const put = vi.spyOn(repo, 'put');
    announcement.value = 'precedente';
    await duplicateNote(original.id);
    expect(put).not.toHaveBeenCalled();
    expect(tabsState.value).toEqual({ open: [], active: null });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(announcement.value).toBe('precedente');
  });

  it('se un filtro di tag nasconderebbe la copia, toglie anche i tag', async () => {
    // La nota attiva può non avere i tag del filtro: la copia, uguale, non li ha nemmeno lei.
    collectionFilter.value = { view: 'open', tags: ['progetto/sito'] };
    await duplicateNote(original.id, 9000);
    expect(collectionFilter.value).toEqual({ view: 'all', tags: [] });
  });
});
