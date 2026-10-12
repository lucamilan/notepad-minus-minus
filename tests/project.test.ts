import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyFilter,
  enterProject,
  exitProject,
  openNoteFromCollection,
} from '../src/features/collection/actions';
import {
  isProjectTag,
  projectNotes,
  withoutProjectTag,
  withProjectTag,
} from '../src/features/collection/project';
import {
  activeProject,
  collectionFilter,
  resetCollectionForLock,
} from '../src/features/collection/state';
import { NO_FILTER } from '../src/features/collection/views';
import { resetAutosaveForTests } from '../src/features/notes/autosave';
import { plainCodec } from '../src/features/notes/codec';
import { openNotepadDb } from '../src/features/notes/database';
import { createNote, type Note } from '../src/features/notes/note';
import { createNoteRepository, type NoteRepository } from '../src/features/notes/repository';
import {
  initNotes,
  notesState,
  resetNotesStoreForTests,
  updateNoteText,
} from '../src/features/notes/store';
import {
  closeAllTabs,
  closeTab,
  createNoteInNewTab,
  cycleTabKeepingEditorFocus,
  openTab,
  projectTabsSaved,
  shownTabs,
} from '../src/features/tabs/actions';
import {
  parseProjectTabs,
  PROJECT_TABS_META_KEY,
  projectTabsMemory,
  TABS_META_KEY,
  tabsState,
  visibleTabs,
  withClosed,
  withCycled,
  withProjectTabs,
} from '../src/features/tabs/tabs';

describe('progetto: funzioni pure', () => {
  const s = (open: string[], active: string | null) => ({ open, active });

  it('riconosce i tag di progetto', () => {
    expect(isProjectTag('progetto/portale')).toBe(true);
    expect(isProjectTag('cliente/acme')).toBe(false);
    expect(isProjectTag('progetto')).toBe(false);
  });

  it('tiene le note con il tag del progetto (non dentro il codice)', () => {
    const a = createNote('A\n#progetto/portale', 1);
    const b = createNote('B\n#progetto/portale-2', 2);
    const c = createNote('C\n```\n#progetto/portale\n```', 3);
    expect(projectNotes([a, b, c], 'progetto/portale')).toEqual([a]);
  });

  it('aggiunge e toglie il tag del progetto dal filtro', () => {
    const filter = { view: 'open' as const, tags: ['cliente/acme'] };
    const tag = 'progetto/portale';
    expect(withProjectTag(filter, tag)).toEqual({ view: 'open', tags: [tag, 'cliente/acme'] });
    expect(withoutProjectTag(withProjectTag(filter, tag), tag)).toEqual(filter);
    expect(withoutProjectTag(filter, tag)).toBe(filter);
  });

  it('mostra solo le schede del progetto più quella attiva', () => {
    const inProject = (id: string) => id === 'a' || id === 'c';
    expect(visibleTabs(s(['a', 'b', 'c', 'd'], 'a'), inProject)).toEqual(['a', 'c']);
    expect(visibleTabs(s(['a', 'b', 'c', 'd'], 'b'), inProject)).toEqual(['a', 'b', 'c']);
    expect(visibleTabs(s(['a', 'b'], 'b'), null)).toEqual(['a', 'b']);
  });

  it('chiude e scorre restando tra le schede visibili', () => {
    const state = s(['a', 'x', 'b', 'y', 'c'], 'b');
    const visible = ['a', 'b', 'c'];
    expect(withClosed(state, 'b', visible)).toEqual(s(['a', 'x', 'y', 'c'], 'c'));
    expect(withClosed(s(['a', 'x', 'c'], 'c'), 'c', ['a', 'c'])).toEqual(s(['a', 'x'], 'a'));
    expect(withClosed(s(['x', 'c'], 'c'), 'c', ['c'])).toEqual(s(['x'], null));
    expect(withCycled(state, 1, visible).active).toBe('c');
    expect(withCycled(state, -2, visible).active).toBe('c');
  });
});

describe('schede per progetto: funzioni pure', () => {
  const s = (open: string[], active: string | null) => ({ open, active });

  it('legge solo voci valide di progetti', () => {
    const parsed = parseProjectTabs([
      { tag: 'progetto/portale', open: ['a', 'b', 'a'], active: 'b' },
      { tag: 'progetto/sito', open: ['c'], active: 'x' },
      { tag: 'cliente/acme', open: ['d'], active: 'd' },
      { tag: 'Progetto/Maiuscolo', open: ['e'], active: null },
      { tag: 'progetto/portale', open: ['z'], active: 'z' },
      { tag: 'progetto/vuoto', open: [], active: null },
      { tag: 'progetto/rotto', open: 'a', active: null },
      null,
    ]);
    expect([...parsed]).toEqual([
      ['progetto/portale', s(['a', 'b'], 'b')],
      ['progetto/sito', s(['c'], null)],
    ]);
    expect(parseProjectTabs({ 'progetto/portale': s(['a'], 'a') }).size).toBe(0);
    expect(parseProjectTabs(undefined).size).toBe(0);
  });

  it('entrando riapre le schede salvate del progetto in fondo', () => {
    const inProject = (id: string) => ['a', 'b', 'c'].includes(id);
    // La scheda attiva del progetto resta attiva.
    expect(withProjectTabs(s(['x', 'a'], 'a'), s(['b', 'a'], 'b'), inProject)).toEqual(
      s(['x', 'a', 'b'], 'a'),
    );
    // Fuori dal progetto: diventa attiva quella salvata.
    expect(withProjectTabs(s(['x'], 'x'), s(['b', 'c'], 'c'), inProject)).toEqual(
      s(['x', 'b', 'c'], 'c'),
    );
    // Note eliminate o non più del progetto non si riaprono.
    expect(withProjectTabs(s(['x'], 'x'), s(['gone', 'b'], 'gone'), inProject)).toEqual(
      s(['x', 'b'], 'b'),
    );
    // Senza voce salvata: la prima del progetto, o nessuna.
    expect(withProjectTabs(s(['x', 'c'], 'x'), undefined, inProject)).toEqual(s(['x', 'c'], 'c'));
    expect(withProjectTabs(s(['x'], 'x'), undefined, inProject)).toEqual(s(['x'], null));
    const same = s(['a'], 'a');
    expect(withProjectTabs(same, s(['a'], 'a'), inProject)).toBe(same);
  });
});

describe('modalità progetto', () => {
  let repo: NoteRepository;
  let portale: Note;
  let specifiche: Note;
  let spesa: Note;
  let altro: Note;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetNotesStoreForTests();
    resetAutosaveForTests();
    resetCollectionForLock();
    repo = createNoteRepository(await openNotepadDb(), plainCodec);
    portale = createNote('Kickoff\n#progetto/portale', 1);
    specifiche = createNote('Specifiche\n#progetto/portale #cliente/acme', 2);
    spesa = createNote('Spesa\n#personale', 3);
    altro = createNote('Altro\n#progetto/sito', 4);
    await repo.putMany([portale, specifiche, spesa, altro]);
    await repo.putMeta(TABS_META_KEY, {
      open: [spesa.id, portale.id, altro.id, specifiche.id],
      active: spesa.id,
    });
    await initNotes(() => Promise.resolve(repo));
  });

  afterEach(() => {
    resetAutosaveForTests();
    resetNotesStoreForTests();
    resetCollectionForLock();
  });

  it('entrando mostra solo le schede del progetto; uscendo tornano tutte e il filtro di prima', () => {
    const before = { view: 'recent' as const, tags: ['personale'] };
    collectionFilter.value = before;

    enterProject('progetto/portale');
    expect(activeProject.value?.tag).toBe('progetto/portale');
    expect(collectionFilter.value).toEqual(NO_FILTER);
    expect(shownTabs()).toEqual([portale.id, specifiche.id]);
    expect(tabsState.value.active).toBe(portale.id);
    // Le altre schede restano aperte, messe da parte.
    expect(tabsState.value.open).toHaveLength(4);

    exitProject();
    expect(activeProject.value).toBeNull();
    expect(collectionFilter.value).toEqual(before);
    expect(shownTabs()).toHaveLength(4);
    expect(tabsState.value.active).toBe(portale.id);
  });

  it('senza schede del progetto non ne attiva nessuna, e uscendo torna quella di prima', () => {
    closeTab(portale.id);
    closeTab(specifiche.id);
    enterProject('progetto/portale');
    expect(tabsState.value.active).toBeNull();
    expect(shownTabs()).toEqual([]);
    exitProject();
    expect(tabsState.value.active).toBe(spesa.id);
  });

  it('passando a un altro progetto si ricorda lo stato di prima del primo', () => {
    enterProject('progetto/portale');
    enterProject('progetto/sito');
    expect(shownTabs()).toEqual([altro.id]);
    closeTab(altro.id);
    exitProject();
    expect(tabsState.value.active).toBe(spesa.id);
  });

  it('chiudi tutte e le scorciatoie restano tra le schede del progetto', () => {
    enterProject('progetto/portale');
    cycleTabKeepingEditorFocus(1);
    expect(tabsState.value.active).toBe(specifiche.id);
    cycleTabKeepingEditorFocus(1);
    expect(tabsState.value.active).toBe(portale.id);
    closeAllTabs();
    expect(tabsState.value).toEqual({ open: [spesa.id, altro.id], active: null });
  });

  it('la nota attiva che perde il tag resta visibile finché non si cambia scheda', () => {
    enterProject('progetto/portale');
    updateNoteText(portale.id, 'Kickoff senza tag');
    expect(shownTabs()).toEqual([portale.id, specifiche.id]);
    openTab(specifiche.id);
    expect(shownTabs()).toEqual([specifiche.id]);
    expect(tabsState.value.open).toContain(portale.id);
  });

  it('le note nuove nascono con il tag del progetto e i tag del filtro', async () => {
    enterProject('progetto/portale');
    applyFilter({ view: 'all', tags: ['progetto/portale', 'cliente/acme'] });
    // Il tag del progetto nel filtro è implicito.
    expect(collectionFilter.value.tags).toEqual(['cliente/acme']);
    await createNoteInNewTab(10);
    const state = notesState.value;
    if (state.status !== 'ready') throw new Error('archivio non pronto');
    const created = state.notes.find((note) => note.id === tabsState.value.active);
    expect(created?.text).toContain('#progetto/portale #cliente/acme');
    expect(shownTabs()).toContain(created?.id);
  });

  it('aprire dalla ricerca una nota fuori dal progetto esce dal progetto', () => {
    enterProject('progetto/portale');
    openNoteFromCollection(spesa.id);
    expect(activeProject.value).toBeNull();
    expect(tabsState.value.active).toBe(spesa.id);
  });

  it('rientrando nel progetto si riaprono le schede lasciate lì, anche dopo la riapertura', async () => {
    enterProject('progetto/portale');
    closeTab(portale.id);
    expect(shownTabs()).toEqual([specifiche.id]);
    exitProject();
    // Fuori dal progetto si chiude tutto: rientrando la scheda del progetto torna.
    closeAllTabs();
    expect(tabsState.value.open).toEqual([]);
    enterProject('progetto/portale');
    expect(shownTabs()).toEqual([specifiche.id]);
    expect(tabsState.value.active).toBe(specifiche.id);

    await projectTabsSaved();
    expect(await repo.getMeta(PROJECT_TABS_META_KEY)).toEqual([
      { tag: 'progetto/portale', open: [specifiche.id], active: specifiche.id },
    ]);

    // Riapertura dell'archivio (ricaricamento): la voce si rilegge.
    resetNotesStoreForTests();
    resetCollectionForLock();
    expect(projectTabsMemory.current.size).toBe(0);
    await initNotes(() => Promise.resolve(repo));
    closeAllTabs();
    enterProject('progetto/portale');
    expect(shownTabs()).toEqual([specifiche.id]);
  });

  it('chiudendo tutte le schede del progetto la sua voce si toglie', async () => {
    enterProject('progetto/portale');
    closeAllTabs();
    await projectTabsSaved();
    expect(await repo.getMeta(PROJECT_TABS_META_KEY)).toEqual([]);
    exitProject();
    enterProject('progetto/portale');
    expect(shownTabs()).toEqual([]);
  });

  it('non cancella le voci degli altri progetti scritte da un’altra scheda', async () => {
    await repo.putMeta(PROJECT_TABS_META_KEY, [
      { tag: 'progetto/sito', open: [altro.id], active: altro.id },
    ]);
    enterProject('progetto/portale');
    closeTab(portale.id);
    await projectTabsSaved();
    expect(await repo.getMeta(PROJECT_TABS_META_KEY)).toEqual([
      { tag: 'progetto/sito', open: [altro.id], active: altro.id },
      { tag: 'progetto/portale', open: [specifiche.id], active: specifiche.id },
    ]);
  });

  it('al blocco il progetto esce dalla memoria', () => {
    enterProject('progetto/portale');
    resetCollectionForLock();
    expect(activeProject.value).toBeNull();
  });
});
