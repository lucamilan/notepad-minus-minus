import { describe, expect, it } from 'vitest';
import {
  bodyText,
  categoryOf,
  openTaskCount,
  sliceChars,
  tagCounts,
  tagLabel,
  tagsOf,
} from '../src/features/collection/tags';
import {
  matchesFilter,
  parseSavedViews,
  suggestViewName,
  withTagToggled,
} from '../src/features/collection/views';
import { createNote } from '../src/features/notes/note';
import {
  highlight,
  normalize,
  parseQuery,
  searchNotes,
  snippet,
} from '../src/features/search/search';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function note(text: string, daysAgo = 0, pinned = false) {
  return { ...createNote(text, NOW - daysAgo * DAY), pinned };
}

describe('tag', () => {
  it('riconosce tag con categoria e liberi, in minuscolo e senza doppioni', () => {
    expect(tagsOf('# Titolo\n#Cliente/ACME #tipo/riunione e #personale #cliente/acme')).toEqual([
      'cliente/acme',
      'tipo/riunione',
      'personale',
    ]);
  });

  it('titoli, numeri, ancore e codice non sono tag', () => {
    const text = [
      '# Titolo',
      '## Sotto',
      'issue #123 e email a#b',
      'link https://x.it/#ancora',
      '`#inline`',
      '```',
      '#nelcodice',
      '```',
      '(#tra-parentesi)',
    ].join('\n');
    expect(tagsOf(text)).toEqual(['tra-parentesi']);
  });

  it('categorie, etichette e attività aperte', () => {
    expect(categoryOf('cliente/acme')).toBe('cliente');
    expect(categoryOf('altro/x')).toBe('altri');
    expect(categoryOf('personale')).toBe('altri');
    expect(tagLabel('progetto/portale')).toBe('portale');
    expect(tagLabel('altro/x')).toBe('altro/x');
    expect(openTaskCount('- [ ] uno\n- [x] due\n* [ ] tre\n1. [ ] quattro\n[ ] non lista')).toBe(3);
  });

  it('conta le note per tag', () => {
    const counts = tagCounts([note('#a #b'), note('#a')]);
    expect([...counts]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('il testo di anteprima toglie titolo, tag, liste e sintassi', () => {
    expect(
      bodyText('# Titolo\n#cliente/acme Presenti\n- [x] fatto\n- **voce** [link](https://x.it)'),
    ).toBe('Presenti fatto voce link');
  });
});

describe('viste e filtri', () => {
  const tasks = note('# A\n#cliente/acme\n- [ ] da fare', 1);
  const old = note('# B\n#cliente/acme #tipo/riunione', 30, true);
  const plain = note('# C senza tag', 2);

  it('viste automatiche', () => {
    const pick = (view: Parameters<typeof matchesFilter>[1]['view']) =>
      [tasks, old, plain].filter((n) => matchesFilter(n, { view, tags: [] }, NOW));
    expect(pick('all')).toHaveLength(3);
    expect(pick('recent')).toEqual([tasks, plain]);
    expect(pick('open')).toEqual([tasks]);
    expect(pick('pinned')).toEqual([old]);
    expect(pick('untagged')).toEqual([plain]);
  });

  it('i tag del filtro devono esserci tutti', () => {
    const filter = { view: 'all' as const, tags: ['cliente/acme', 'tipo/riunione'] };
    expect([tasks, old, plain].filter((n) => matchesFilter(n, filter, NOW))).toEqual([old]);
    expect(withTagToggled(filter, 'tipo/riunione').tags).toEqual(['cliente/acme']);
    expect(withTagToggled({ view: 'open', tags: [] }, 'x').tags).toEqual(['x']);
  });

  it('nome proposto per la vista salvata', () => {
    expect(suggestViewName({ view: 'open', tags: ['cliente/acme'] })).toBe(
      'Acme · attività aperte',
    );
  });

  it('le viste salvate lette dall’archivio vengono validate', () => {
    expect(
      parseSavedViews([
        { name: 'Ok', view: 'open', tags: ['a'] },
        { name: 'Vista ignota', view: 'boh', tags: [] },
        { name: 3, view: 'all', tags: [] },
        { name: 'Tag strani', view: 'all', tags: [1] },
        null,
      ]),
    ).toEqual([{ name: 'Ok', view: 'open', tags: ['a'] }]);
    expect(parseSavedViews('non un elenco')).toEqual([]);
  });
});

describe('ricerca', () => {
  const kickoff = note(
    '# Kickoff portale\n#cliente/acme #tipo/riunione\nPresenti Giulia\n- [ ] mockup',
    1,
  );
  const caffe = note('Lista spesa\n#personale\n- caffè macinato', 10, true);
  const api = note('# Specifiche API\n#cliente/rossi-srl\nAutenticazione con token', 40);
  const all = [kickoff, caffe, api];
  const find = (q: string) => searchNotes(all, parseQuery(q), NOW).map((r) => r.note);

  it('accenti e maiuscole non contano', () => {
    expect(normalize('Caffè ÀÉ')).toBe('caffe ae');
    expect(find('CAFFE')).toEqual([caffe]);
  });

  it('tutte le parole devono comparire; il titolo pesa più del testo', () => {
    const portale = note('# Altro\nsi parla del portale', 0);
    expect(searchNotes([portale, kickoff], parseQuery('portale'), NOW).map((r) => r.note)).toEqual([
      kickoff,
      portale,
    ]);
    expect(find('portale giulia')).toEqual([kickoff]);
    expect(find('portale token')).toEqual([]);
  });

  it('filtri per tag (anche solo la parte dopo la categoria) e is:', () => {
    expect(find('#acme')).toEqual([kickoff]);
    expect(find('#cliente/')).toEqual([kickoff, api]);
    expect(find('#cliente is:recenti')).toEqual([kickoff]);
    expect(find('is:fissate')).toEqual([caffe]);
    expect(find('is:aperte')).toEqual([kickoff]);
  });

  it('evidenzia le parole trovate nel testo originale, accenti compresi', () => {
    expect(highlight('Caffè macinato', ['caffe'])).toEqual([
      { text: 'Caffè', mark: true },
      { text: ' macinato', mark: false },
    ]);
    expect(highlight('niente', [])).toEqual([{ text: 'niente', mark: false }]);
  });

  it('il frammento parte vicino alla parola trovata', () => {
    const long = note(`# T\n${'parola '.repeat(30)}trovata qui`);
    const segments = snippet(long.text, ['trovata']);
    expect(segments[0]).toEqual({ text: '…', mark: false });
    expect(segments.some((s) => s.mark && s.text === 'trovata')).toBe(true);
  });
});

describe('casi limite', () => {
  it('codice con più apici e recinti chiusi solo da righe di soli segni', () => {
    expect(tagsOf('``a`b`` #fuori')).toEqual(['fuori']);
    expect(tagsOf('```js\n#dentro\n```js\n#ancora-dentro\n```\n#fuori')).toEqual(['fuori']);
    expect(tagsOf('~~~\n#dentro\n```\n#ancora\n~~~\n#fuori')).toEqual(['fuori']);
  });

  it('i frammenti non spezzano le emoji', () => {
    expect(sliceChars('ab😀cd', 0, 3)).toBe('ab');
    expect(sliceChars('ab😀cd', 3, 6)).toBe('😀cd');
  });

  it('le viste salvate scartano nomi vuoti e tag non validi o doppi', () => {
    expect(
      parseSavedViews([
        { name: '  ', view: 'all', tags: [] },
        { name: ' Mia ', view: 'all', tags: ['Cliente/Acme', 'cliente/acme', '<b>', ''] },
      ]),
    ).toEqual([{ name: 'Mia', view: 'all', tags: ['cliente/acme'] }]);
  });
});
