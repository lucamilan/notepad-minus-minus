import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savedViews } from '../src/features/collection/state';
import { SAVED_VIEWS_META_KEY, type SavedView } from '../src/features/collection/views';
import {
  MAX_PBKDF2_ITERATIONS,
  PASSPHRASE_MIN_LENGTH,
  WrongPassphraseError,
} from '../src/features/crypto/keys';
import {
  configureVaultForTests,
  lockedQueueSize,
  lockVault,
  resetVaultForTests,
  setupVault,
  startVault,
  unlockVault,
} from '../src/features/crypto/vault';
import {
  editNote,
  flushSaves,
  hasUnsavedChanges,
  isPendingSave,
  resetAutosaveForTests,
} from '../src/features/notes/autosave';
import {
  changedElsewhere,
  RELOAD_ALL_THRESHOLD,
  startCrossTabSync,
} from '../src/features/notes/crossTab';
import { DB_NAME } from '../src/features/notes/database';
import { createNote, type Note } from '../src/features/notes/note';
import {
  addNote,
  getRepository,
  notesState,
  resetNotesStoreForTests,
} from '../src/features/notes/store';
import { actionError, openTab } from '../src/features/tabs/actions';
import { tabsState } from '../src/features/tabs/tabs';
import {
  applyImport,
  exportNotes,
  mergeSavedViews,
  planImport,
} from '../src/features/transfer/actions';
import {
  EXPORT_MAX_BYTES,
  exportFileName,
  ExportPassphraseTooShortError,
  fromBase64,
  InvalidExportError,
  openExport,
  parseExportFile,
  readExportFile,
  sealExport,
  toBase64,
  type ExportPayload,
} from '../src/features/transfer/format';
import { formatDateTime, formatRelative, formatTime, NO_DATE } from '../src/lib/format';

const PASSPHRASE = 'quattro parole scelte a caso';
const FILE_PASSPHRASE = 'passphrase del file per il pc di casa';
const ITERATIONS = 1000;
const KDF = { iterations: ITERATIONS, minIterations: ITERATIONS };

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetVaultForTests();
  resetNotesStoreForTests();
  resetAutosaveForTests();
  configureVaultForTests({ iterations: ITERATIONS });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetVaultForTests();
  resetAutosaveForTests();
  resetNotesStoreForTests();
});

function notes(): Note[] {
  const state = notesState.value;
  return state.status === 'ready' ? state.notes : [];
}

function note(text: string, modifiedAt: number, extra: Partial<Note> = {}): Note {
  return { ...createNote(text, Math.max(0, modifiedAt - 100)), modifiedAt, ...extra };
}

async function setUp(): Promise<void> {
  await startVault();
  expect(await setupVault(PASSPHRASE)).toBe('ok');
}

/** Note (e viste) nell'archivio sbloccato, al posto della nota di esempio. */
async function seed(list: Note[], views: SavedView[] = []): Promise<void> {
  const repo = getRepository();
  const sample = notes()[0];
  if (sample) await repo.delete(sample.id);
  await repo.putMany(list);
  await repo.putMeta(SAVED_VIEWS_META_KEY, views);
  await lockVault();
  expect(await unlockVault(PASSPHRASE)).toBe('ok');
}

function seal(payload: unknown, passphrase = FILE_PASSPHRASE): Promise<string> {
  return sealExport(payload as ExportPayload, passphrase, KDF);
}

async function open(text: string, passphrase = FILE_PASSPHRASE): Promise<ExportPayload> {
  return openExport(parseExportFile(text, KDF), passphrase);
}

function edit(text: string, change: (file: Record<string, Record<string, unknown>>) => void) {
  const file = JSON.parse(text) as Record<string, Record<string, unknown>>;
  change(file);
  return JSON.stringify(file);
}

/** Cambia un byte (il primo) di un campo base64. */
function flip(value: unknown): string {
  const bytes = fromBase64(value);
  if (!bytes) throw new Error('base64 non valido');
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return toBase64(bytes);
}

async function storedIds(): Promise<string[]> {
  const db = await openDB(DB_NAME);
  const keys = (await db.getAllKeys('notes')) as string[];
  db.close();
  return keys.sort();
}

describe('formato del file', () => {
  it('cifra e decifra note e viste salvate', async () => {
    const payload: ExportPayload = {
      notes: [note('# Uno\ntesto', 2000, { pinned: true }), note('Due', 3000)],
      savedViews: [{ name: 'Acme', view: 'open', tags: ['cliente/acme'] }],
    };
    const text = await seal(payload);
    expect(await open(text)).toEqual(payload);
    const file = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual(['app', 'kind', 'version', 'kdf', 'wrap', 'data']);
    expect(file).toMatchObject({
      app: 'notepad-minus-minus',
      kind: 'export',
      version: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS },
    });
  });

  it('nel file non c’è nulla in chiaro: testo, titoli, tag, date né conteggi', async () => {
    const secret = note('# Piano segreto\nBudget riservato #cliente/zeta', 1_700_000_123_456);
    const text = await seal({
      notes: [secret, note('Altra nota', 1_700_000_999_999)],
      savedViews: [{ name: 'Vista Zeta', view: 'all', tags: ['cliente/zeta'] }],
    });
    for (const clear of [
      'Piano',
      'segreto',
      'Budget',
      'zeta',
      'cliente',
      'Vista',
      'notes',
      'savedViews',
      secret.id,
      String(secret.modifiedAt),
      String(secret.createdAt),
      'pinned',
    ]) {
      expect(text).not.toContain(clear);
    }
    // Dimensione: dipende solo dal totale, non da quante note ci sono.
    const one = await seal({ notes: [note('x'.repeat(200), 1)], savedViews: [] });
    expect(JSON.parse(one)).not.toHaveProperty('count');
  });

  it('una passphrase sbagliata si riconosce come tale', async () => {
    const text = await seal({ notes: [], savedViews: [] });
    await expect(open(text, 'non è la passphrase giusta')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it('dati manomessi non si aprono', async () => {
    const text = await seal({ notes: [note('Testo', 10)], savedViews: [] });
    const data = edit(text, (f) => {
      f['data'] = { ...f['data'], ciphertext: flip(f['data']?.['ciphertext']) };
    });
    await expect(open(data)).rejects.toMatchObject({ reason: 'invalid' });
    const dataIv = edit(text, (f) => {
      f['data'] = { ...f['data'], iv: flip(f['data']?.['iv']) };
    });
    await expect(open(dataIv)).rejects.toBeInstanceOf(InvalidExportError);
    // Chiave cifrata o salt cambiati: GCM non distingue dalla passphrase sbagliata.
    const wrap = edit(text, (f) => {
      f['wrap'] = { ...f['wrap'], key: flip(f['wrap']?.['key']) };
    });
    await expect(open(wrap)).rejects.toBeInstanceOf(WrongPassphraseError);
    const salt = edit(text, (f) => {
      f['kdf'] = { ...f['kdf'], salt: flip(f['kdf']?.['salt']) };
    });
    await expect(open(salt)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('la chiave del portachiavi e quella del file non si scambiano (additional data diverse)', async () => {
    const a = JSON.parse(await seal({ notes: [], savedViews: [] })) as Record<string, unknown>;
    const b = JSON.parse(await seal({ notes: [note('B', 5)], savedViews: [] })) as Record<
      string,
      unknown
    >;
    // Ciphertext di un file con la chiave di un altro: non si apre.
    const mixed = JSON.stringify({ ...a, data: b['data'] });
    await expect(open(mixed)).rejects.toBeInstanceOf(InvalidExportError);
  });

  it('campi in più o in meno, tipi sbagliati e base64 non canonico si rifiutano', async () => {
    const text = await seal({ notes: [], savedViews: [] });
    const cases = [
      edit(text, (f) => {
        (f as Record<string, unknown>)['notes'] = 3;
      }),
      edit(text, (f) => {
        delete (f as Record<string, unknown>)['wrap'];
      }),
      edit(text, (f) => {
        f['kdf'] = { ...f['kdf'], extra: true };
      }),
      edit(text, (f) => {
        f['data'] = { ciphertext: f['data']?.['ciphertext'] };
      }),
      edit(text, (f) => {
        f['kdf'] = { ...f['kdf'], hash: 'SHA-1' };
      }),
      edit(text, (f) => {
        f['wrap'] = { ...f['wrap'], iv: toBase64(new Uint8Array(16)) };
      }),
      edit(text, (f) => {
        f['data'] = { ...f['data'], iv: 'non base64!' };
      }),
      edit(text, (f) => {
        // "AB==" e "AA==" sono lo stesso byte: solo la forma canonica è ammessa.
        f['kdf'] = { ...f['kdf'], salt: `${String(f['kdf']?.['salt']).slice(0, -3)}B==` };
      }),
      edit(text, (f) => {
        (f as Record<string, unknown>)['app'] = 'altro';
      }),
      'non è JSON',
      '[]',
      'null',
    ];
    for (const bad of cases) {
      expect(() => parseExportFile(bad, KDF), bad.slice(0, 80)).toThrow(InvalidExportError);
    }
  });

  it('una versione più recente si segnala come non supportata', async () => {
    const text = await seal({ notes: [], savedViews: [] });
    const future = edit(text, (f) => {
      (f as Record<string, unknown>)['version'] = 2;
    });
    expect(() => parseExportFile(future, KDF)).toThrow(
      expect.objectContaining({ reason: 'version' }) as Error,
    );
    const broken = edit(text, (f) => {
      (f as Record<string, unknown>)['version'] = '1';
    });
    expect(() => parseExportFile(broken, KDF)).toThrow(
      expect.objectContaining({ reason: 'invalid' }) as Error,
    );
  });

  it('iterazioni fuori dai limiti si rifiutano', async () => {
    const text = await seal({ notes: [], savedViews: [] });
    for (const iterations of [ITERATIONS - 1, MAX_PBKDF2_ITERATIONS + 1, 1000.5, '1000']) {
      const bad = edit(text, (f) => {
        f['kdf'] = { ...f['kdf'], iterations };
      });
      expect(() => parseExportFile(bad, KDF)).toThrow(InvalidExportError);
    }
    // Senza l'aiuto dei test il minimo è quello di produzione (600.000).
    expect(() => parseExportFile(text)).toThrow(InvalidExportError);
  });

  it('un file troppo grande si rifiuta senza leggerlo', async () => {
    const read = vi.fn();
    const huge = { size: EXPORT_MAX_BYTES + 1, arrayBuffer: read } as unknown as Blob;
    await expect(readExportFile(huge, KDF)).rejects.toMatchObject({ reason: 'too-large' });
    expect(read).not.toHaveBeenCalled();
    const garbage = new Blob([new Uint8Array([0xff, 0xfe, 0x00])]);
    await expect(readExportFile(garbage, KDF)).rejects.toMatchObject({ reason: 'invalid' });
    const good = new Blob([await seal({ notes: [], savedViews: [] })]);
    await expect(readExportFile(good, KDF)).resolves.toBeDefined();
  });

  it('id doppi, id che non sono UUID e note non valide si rifiutano', async () => {
    const a = note('A', 10);
    const bad = [
      { notes: [a, { ...a, text: 'copia' }], savedViews: [] },
      { notes: [{ ...a, id: 'non-un-uuid' }], savedViews: [] },
      { notes: [{ ...a, id: a.id.toUpperCase() }], savedViews: [] },
      { notes: [{ ...a, pinned: 'sì' }], savedViews: [] },
      { notes: [{ ...a, extra: 1 }], savedViews: [] },
      { notes: [{ id: a.id, text: 'senza date' }], savedViews: [] },
      { notes: [{ ...a, modifiedAt: null }], savedViews: [] },
      // Date manomesse: farebbero lanciare la formattazione a ogni disegno.
      { notes: [{ ...a, modifiedAt: 1e300 }], savedViews: [] },
      { notes: [{ ...a, createdAt: -1 }], savedViews: [] },
      { notes: [{ ...a, createdAt: a.modifiedAt + 1 }], savedViews: [] },
      { notes: [{ ...a, modifiedAt: a.modifiedAt + 0.5 }], savedViews: [] },
      { notes: [{ ...a, modifiedAt: Date.now() + 25 * 60 * 60 * 1000 }], savedViews: [] },
      { notes: {}, savedViews: [] },
      { notes: [] },
    ];
    for (const payload of bad) {
      await expect(open(await seal(payload)), JSON.stringify(payload)).rejects.toBeInstanceOf(
        InvalidExportError,
      );
    }
  });

  it('le viste salvate passano da parseSavedViews', async () => {
    const text = await seal({
      notes: [],
      savedViews: [
        { name: '  Acme ', view: 'all', tags: ['Cliente/Acme', '<script>'] },
        { name: 'Rotta', view: 'boh', tags: [] },
        'testo',
      ],
    });
    expect((await open(text)).savedViews).toEqual([
      { name: 'Acme', view: 'all', tags: ['cliente/acme'] },
    ]);
  });

  it('la passphrase del file deve avere almeno 12 caratteri, anche fuori dal modulo', async () => {
    await expect(seal({ notes: [], savedViews: [] }, 'corta')).rejects.toBeInstanceOf(
      ExportPassphraseTooShortError,
    );
    // Code point, non unità UTF-16: 11 emoji non bastano.
    await expect(
      seal({ notes: [], savedViews: [] }, '🔑'.repeat(PASSPHRASE_MIN_LENGTH - 1)),
    ).rejects.toBeInstanceOf(ExportPassphraseTooShortError);
    await setUp();
    expect(await exportNotes('undici car.')).toEqual({ status: 'invalid' });
  });

  it('il nome del file usa la data locale', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe('notepad-2026-01-05.notepad');
  });
});

describe('esportazione', () => {
  it('salva prima le modifiche in coda ed esporta note e viste in memoria', async () => {
    await setUp();
    const [sample] = notes();
    if (!sample) throw new Error('nota mancante');
    editNote(sample.id, '# Ultima modifica\nnon ancora salvata');
    savedViews.value = [{ name: 'Tutto', view: 'all', tags: [] }];
    const result = await exportNotes(FILE_PASSPHRASE, new Date(2026, 9, 10));
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result).toMatchObject({ fileName: 'notepad-2026-10-10.notepad', count: 1 });
    expect(result.blob.type).toBe('application/octet-stream');
    const payload = await open(await result.blob.text());
    expect(payload.notes.map((n) => n.text)).toEqual(['# Ultima modifica\nnon ancora salvata']);
    expect(payload.savedViews).toEqual([{ name: 'Tutto', view: 'all', tags: [] }]);
    // Salvata nell'archivio prima di esportare.
    expect((await getRepository().get(sample.id))?.text).toContain('Ultima modifica');
  });

  it('bloccando durante l’esportazione non restituisce nulla', async () => {
    await setUp();
    const exporting = exportNotes(FILE_PASSPHRASE);
    void lockVault();
    expect(await exporting).toEqual({ status: 'locked' });
  });
});

describe('date non valide', () => {
  it('la formattazione non lancia mai: al posto della data un trattino', () => {
    for (const bad of [1e300, -1e300, Infinity, Number.NaN, 8.64e15 + 1]) {
      expect(formatDateTime(bad)).toBe(NO_DATE);
      expect(formatTime(bad)).toBe(NO_DATE);
      expect(formatRelative(bad)).toBe(NO_DATE);
    }
    expect(formatRelative(Date.now())).toMatch(/^oggi /);
  });

  it('un file con una nota del giorno dopo (orologio avanti) si accetta', async () => {
    const tomorrow = Date.now() + 12 * 60 * 60 * 1000;
    const text = await seal({ notes: [note('Domani', tomorrow)], savedViews: [] });
    expect((await open(text)).notes).toHaveLength(1);
  });
});

describe('regole di importazione', () => {
  it('unisci: nuove aggiunte, più recenti aggiornate, identiche e più vecchie saltate', () => {
    const same = note('Uguale', 100);
    const localOlder = note('Vecchia qui', 100);
    const localNewer = note('Nuova qui', 900);
    const onlyLocal = note('Solo qui', 50);
    const fresh = note('Nuova dal file', 300);
    const plan = planImport(
      { notes: [same, localOlder, localNewer, onlyLocal], unreadable: [] },
      [
        { ...same },
        { ...localOlder, text: 'Più recente dal file', modifiedAt: 500 },
        { ...localNewer, text: 'Più vecchia dal file', modifiedAt: 200 },
        fresh,
      ],
      'merge',
    );
    expect(plan.put.map((n) => n.text)).toEqual(['Più recente dal file', 'Nuova dal file']);
    expect(plan).toMatchObject({
      added: [fresh.id],
      updated: [localOlder.id],
      unchanged: 2,
      remove: [],
      conflicts: [],
    });
  });

  it('le note occupate qui non si toccano: sono conflitti, anche sostituendo', () => {
    const busy = note('Con modifiche qui', 100);
    const busyLocalOnly = note('Avviso da un’altra scheda', 100);
    const free = note('Libera', 100);
    const isBusy = (id: string) => id === busy.id || id === busyLocalOnly.id;
    const merge = planImport(
      { notes: [busy, busyLocalOnly, free], unreadable: [] },
      [{ ...busy, text: 'Più recente', modifiedAt: 500 }],
      'merge',
      isBusy,
    );
    expect(merge).toMatchObject({ put: [], conflicts: [busy.id] });
    const replace = planImport(
      { notes: [busy, busyLocalOnly, free], unreadable: [] },
      [{ ...busy, text: 'Più vecchia', modifiedAt: 10 }],
      'replace',
      isBusy,
    );
    expect(replace).toMatchObject({ put: [], remove: [free.id] });
    expect(replace.conflicts.sort()).toEqual([busy.id, busyLocalOnly.id].sort());
  });

  it('sostituisci: elimina le leggibili assenti dal file, mai i record illeggibili', () => {
    const keep = note('Anche nel file', 100);
    const drop = note('Solo qui', 100);
    const unreadableId = crypto.randomUUID();
    const plan = planImport(
      { notes: [keep, drop], unreadable: [unreadableId] },
      [
        { ...keep, text: 'Più vecchia ma vince', modifiedAt: 10 },
        note('Nuova', 5),
        { ...note('Stesso id di un illeggibile', 5), id: unreadableId },
      ],
      'replace',
    );
    expect(plan.remove).toEqual([drop.id]);
    expect(plan.put.map((n) => n.text)).toEqual(['Più vecchia ma vince', 'Nuova']);
    expect(plan.skipped).toBe(1);
  });

  it('viste salvate: per nome, quelle esistenti restano', () => {
    expect(
      mergeSavedViews(
        [{ name: 'Acme', view: 'all', tags: ['cliente/acme'] }],
        [
          { name: 'Acme', view: 'open', tags: [] },
          { name: 'Beta', view: 'all', tags: ['progetto/beta'] },
          { name: 'Beta', view: 'pinned', tags: [] },
        ],
      ),
    ).toEqual([
      { name: 'Acme', view: 'all', tags: ['cliente/acme'] },
      { name: 'Beta', view: 'all', tags: ['progetto/beta'] },
    ]);
  });
});

/** Canale dell'"altra scheda": raccoglie ciò che questa annuncia. */
function listen() {
  const channel = new BroadcastChannel('notepad-minus-minus');
  const received: unknown[] = [];
  channel.onmessage = (e: MessageEvent<unknown>) => received.push(e.data);
  return { channel, received };
}

/** Lascia finire i messaggi e le letture in corso. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('importazione nell’archivio', () => {
  it('unisce note e viste, scrive nell’archivio e avvisa le altre schede senza contenuto', async () => {
    await setUp();
    const same = note('Uguale', 100);
    const older = note('Vecchia qui', 100);
    const newer = note('Nuova qui', 900);
    await seed([same, older, newer], [{ name: 'Acme', view: 'all', tags: ['cliente/acme'] }]);
    openTab(older.id);

    const { channel, received } = listen();
    const stop = startCrossTabSync();
    const fresh = note('Dal file', 300);
    const outcome = await applyImport(
      {
        notes: [
          same,
          { ...older, text: 'Aggiornata dal file', modifiedAt: 500 },
          { ...newer, text: 'Più vecchia', modifiedAt: 10 },
          fresh,
        ],
        savedViews: [
          { name: 'Acme', view: 'open', tags: [] },
          { name: 'Beta', view: 'all', tags: [] },
        ],
      },
      'merge',
    );
    expect(outcome).toMatchObject({
      status: 'ok',
      added: 1,
      updated: 1,
      unchanged: 2,
      conflicts: 0,
    });
    expect(
      notes()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['Aggiornata dal file', 'Dal file', 'Nuova qui', 'Uguale'].sort());
    expect(savedViews.value.map((v) => [v.name, v.view])).toEqual([
      ['Acme', 'all'],
      ['Beta', 'all'],
    ]);
    // Nell'archivio, cifrate; viste nella stessa transazione.
    expect((await getRepository().get(older.id))?.text).toBe('Aggiornata dal file');
    expect((await getRepository().get(fresh.id))?.text).toBe('Dal file');
    expect((await getRepository().getMeta(SAVED_VIEWS_META_KEY)) as SavedView[]).toHaveLength(2);
    // Le schede restano com'erano.
    expect(tabsState.value.active).toBe(older.id);

    await vi.waitFor(() => expect(received).toContainEqual({ savedViews: true }));
    await vi.waitFor(() => expect(received.length).toBeGreaterThanOrEqual(3));
    const json = JSON.stringify(received);
    expect(json).not.toContain('Dal file');
    expect(json).not.toContain('Beta');
    for (const message of received) {
      expect(Object.keys(message as object).sort()).toSatisfy(
        (keys: string[]) =>
          JSON.stringify(keys) === '["id","modifiedAt"]' ||
          JSON.stringify(keys) === '["savedViews"]',
      );
    }
    stop();
    channel.close();
  });

  it('il piano si fa sulle versioni salvate, non sulla memoria', async () => {
    await setUp();
    const shared = note('Versione vecchia in memoria', 100);
    await seed([shared]);
    // Un'altra scheda ha salvato una versione più recente; qui la memoria non lo sa ancora.
    await getRepository().put({ ...shared, text: 'Più recente altrove', modifiedAt: 900 });
    const outcome = await applyImport(
      { notes: [{ ...shared, text: 'Dal file', modifiedAt: 500 }], savedViews: [] },
      'merge',
    );
    expect(outcome).toMatchObject({ status: 'ok', updated: 0, unchanged: 1 });
    expect((await getRepository().get(shared.id))?.text).toBe('Più recente altrove');
  });

  it('note con modifiche non salvate o con un avviso restano come sono (conflitti)', async () => {
    await setUp();
    const held = note('Con avviso', 100);
    const dirty = note('Modificata qui', 100);
    const other = note('Altra', 100);
    await seed([held, dirty, other]);
    changedElsewhere.value = new Map([[held.id, 'modified']]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(getRepository(), 'putMany').mockRejectedValue(new Error('disco'));
    editNote(dirty.id, 'Modifica non salvata');

    const outcome = await applyImport(
      {
        notes: [
          { ...held, text: 'Dal file', modifiedAt: 500 },
          { ...dirty, text: 'Dal file', modifiedAt: 500 },
        ],
        savedViews: [],
      },
      'replace',
    );
    expect(outcome).toMatchObject({ status: 'ok', conflicts: 2, replaced: 0, removed: 1 });
    expect((await getRepository().get(held.id))?.text).toBe('Con avviso');
    expect((await getRepository().get(dirty.id))?.text).toBe('Modificata qui');
    expect(await getRepository().get(other.id)).toBeUndefined();
    expect(notes().find((n) => n.id === dirty.id)?.text).toBe('Modifica non salvata');
    expect(isPendingSave(dirty.id)).toBe(true);
    changedElsewhere.value = new Map();
  });

  it('un record cambiato tra la rilettura e la scrittura non si tocca', async () => {
    await setUp();
    const target = note('Prima', 100);
    await seed([target]);
    const repo = getRepository();
    const snapshot = repo.snapshot.bind(repo);
    vi.spyOn(repo, 'snapshot').mockImplementationOnce(async () => {
      const snap = await snapshot();
      // L'altra scheda salva subito dopo la rilettura.
      await repo.put({ ...target, text: 'Scritta altrove', modifiedAt: 200 });
      return snap;
    });
    const outcome = await applyImport(
      {
        notes: [{ ...target, text: 'Dal file', modifiedAt: 500 }, note('Nuova', 50)],
        savedViews: [],
      },
      'merge',
    );
    expect(outcome).toMatchObject({ status: 'ok', added: 1, updated: 0, conflicts: 1 });
    expect((await repo.get(target.id))?.text).toBe('Scritta altrove');
  });

  it('sostituisce le note leggibili, lascia intatti i record illeggibili e apre la prima importata', async () => {
    await setUp();
    const local = note('Locale', 100);
    await seed([local], [{ name: 'Vecchia', view: 'all', tags: [] }]);
    // Un record che non si decifra: deve restare com'è.
    const unreadableId = crypto.randomUUID();
    const db = await openDB(DB_NAME);
    await db.put('notes', {
      id: unreadableId,
      format: 'aesgcm-v1',
      payload: { iv: new Uint8Array(12), data: new ArrayBuffer(40) },
    });
    db.close();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await lockVault();
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    const state = notesState.value;
    expect(state.status === 'ready' && state.unreadable).toEqual([unreadableId]);

    const { channel, received } = listen();
    const stop = startCrossTabSync();
    const first = note('Prima importata', 900, { pinned: true });
    const second = note('Seconda importata', 950);
    const outcome = await applyImport(
      {
        notes: [second, first, { ...note('Collide', 5), id: unreadableId }],
        savedViews: [{ name: 'Nuova', view: 'all', tags: [] }],
      },
      'replace',
    );
    expect(outcome).toMatchObject({
      status: 'ok',
      replaced: 2,
      removed: 1,
      skipped: 1,
      unreadable: 1,
    });
    expect(notes().map((n) => n.text)).toEqual(['Prima importata', 'Seconda importata']);
    expect(await storedIds()).toEqual([first.id, second.id, unreadableId].sort());
    expect(savedViews.value.map((v) => v.name)).toEqual(['Nuova']);
    expect(tabsState.value.active).toBe(first.id);
    expect(tabsState.value.open).not.toContain(local.id);
    // Sostituendo si chiede sempre di rileggere tutto (le versioni possono tornare indietro).
    await vi.waitFor(() => expect(received).toContainEqual({ reloadAll: true }));
    expect(received.filter((m) => 'id' in (m as object))).toEqual([]);
    stop();
    channel.close();
  });

  it('tutto o niente: se una scrittura fallisce non cambiano note, viste né coda', async () => {
    await setUp();
    const a = note('A locale', 100);
    const b = note('B locale', 100);
    await seed([a, b], [{ name: 'Vecchia', view: 'all', tags: [] }]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Una modifica che non si riesce a salvare: deve restare in coda.
    const putMany = vi.spyOn(getRepository(), 'putMany').mockRejectedValue(new Error('disco'));
    editNote(a.id, 'A modificata qui');
    await flushSaves();
    const before = await storedIds();
    const store = globalThis.IDBObjectStore.prototype;
    const put = store.put.bind(store);
    let calls = 0;
    vi.spyOn(store, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      calls++;
      if (calls === 2) throw new DOMException('disco', 'DataError');
      return put.call(this, ...args) as IDBRequest<IDBValidKey>;
    });

    const outcome = await applyImport(
      {
        notes: [note('Uno', 1), note('Due', 2), note('Tre', 3)],
        savedViews: [{ name: 'Nuova', view: 'all', tags: [] }],
      },
      'replace',
    );
    expect(outcome).toEqual({ status: 'error' });
    vi.mocked(store.put).mockRestore();
    expect(await storedIds()).toEqual(before);
    expect(
      ((await getRepository().getMeta(SAVED_VIEWS_META_KEY)) as SavedView[]).map((v) => v.name),
    ).toEqual(['Vecchia']);
    expect(savedViews.value.map((v) => v.name)).toEqual(['Vecchia']);
    expect(actionError.value).toBeNull();
    expect(
      notes()
        .map((n) => n.text)
        .sort(),
    ).toEqual(['A modificata qui', 'B locale']);
    // La modifica non salvata è ancora in coda e si salva appena il disco torna.
    expect(isPendingSave(a.id)).toBe(true);
    putMany.mockRestore();
    await flushSaves();
    expect(hasUnsavedChanges()).toBe(false);
    expect((await getRepository().get(a.id))?.text).toBe('A modificata qui');
  });

  it('bloccando prima della scrittura si lascia perdere e non resta nulla in memoria', async () => {
    await setUp();
    const importing = applyImport({ notes: [note('Segreta', 10)], savedViews: [] }, 'merge');
    void lockVault();
    expect(await importing).toEqual({ status: 'locked' });
    expect(notesState.value).toEqual({ status: 'loading' });
    expect(savedViews.value).toEqual([]);
  });

  it('bloccando durante la scrittura: nulla in memoria, modifiche in coda cifrate e riprese', async () => {
    await setUp();
    const a = note('A locale', 100);
    await seed([a]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const putMany = vi.spyOn(getRepository(), 'putMany').mockRejectedValue(new Error('disco'));
    editNote(a.id, 'A modificata qui');
    const repo = getRepository();
    const write = repo.applyImport.bind(repo);
    vi.spyOn(repo, 'applyImport').mockImplementationOnce((change) => {
      const writing = write(change);
      void lockVault();
      return writing;
    });
    const imported = note('Importata', 10);
    expect(await applyImport({ notes: [imported], savedViews: [] }, 'merge')).toEqual({
      status: 'locked',
    });
    await lockVault();
    expect(notesState.value).toEqual({ status: 'loading' });
    // La modifica non salvata è stata cifrata e tenuta da parte, non persa.
    expect(lockedQueueSize()).toBe(1);
    putMany.mockRestore();
    expect(await unlockVault(PASSPHRASE)).toBe('ok');
    await flushSaves();
    expect(notes().find((n) => n.id === a.id)?.text).toBe('A modificata qui');
    // La scrittura era già nell'archivio: la nota importata c'è.
    expect(notes().find((n) => n.id === imported.id)?.text).toBe('Importata');
  });

  it('molte note unendo: un solo messaggio "rileggi tutto"', async () => {
    await setUp();
    const { channel, received } = listen();
    const stop = startCrossTabSync();
    const many = Array.from({ length: RELOAD_ALL_THRESHOLD + 1 }, (_, i) => note(`N${i}`, i + 1));
    expect(await applyImport({ notes: many, savedViews: [] }, 'merge')).toMatchObject({
      added: many.length,
    });
    await vi.waitFor(() => expect(received).toContainEqual({ reloadAll: true }));
    expect(received.filter((m) => 'id' in (m as object))).toEqual([]);
    stop();
    channel.close();
  });
});

describe('"rileggi tutto" nelle altre schede', () => {
  it('adotta le versioni salvate anche più vecchie; avviso per le note occupate', async () => {
    await setUp();
    const quiet = note('Non aperta', 500);
    const active = note('Aperta qui', 500);
    const dirty = note('Con modifiche qui', 500);
    const fresh = note('Nuova altrove', 50);
    await seed([quiet, active, dirty]);
    openTab(active.id);
    const repo = getRepository();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const putMany = vi.spyOn(repo, 'putMany').mockRejectedValue(new Error('disco'));
    editNote(dirty.id, 'Modifica non salvata');
    // L'"altra scheda" sostituisce con versioni più vecchie (scrittura diretta nell'archivio).
    await repo.put({ ...quiet, text: 'Versione più vecchia', modifiedAt: 100 });
    await repo.put({ ...active, text: 'Versione più vecchia', modifiedAt: 100 });
    await repo.put(fresh);
    const { channel } = listen();
    const stop = startCrossTabSync();
    channel.postMessage({ reloadAll: true });
    await vi.waitFor(() => expect(notes().map((n) => n.id)).toContain(fresh.id));

    expect(notes().find((n) => n.id === quiet.id)?.text).toBe('Versione più vecchia');
    expect(notes().find((n) => n.id === active.id)?.text).toBe('Aperta qui');
    expect(changedElsewhere.value.get(active.id)).toBe('modified');
    // Le sole modifiche locali non salvate non sono un cambio altrove.
    expect(changedElsewhere.value.has(dirty.id)).toBe(false);
    expect(notes().find((n) => n.id === dirty.id)?.text).toBe('Modifica non salvata');
    putMany.mockRestore();
    changedElsewhere.value = new Map();
    stop();
    channel.close();
  });

  it('una nota creata qui durante la rilettura non conta come eliminata', async () => {
    await setUp();
    const gone = note('Eliminata altrove', 100);
    const keep = note('Resta', 100);
    await seed([gone, keep]);
    const repo = getRepository();
    await repo.delete(gone.id);
    const created = note('Appena creata qui', 999);
    const list = repo.list.bind(repo);
    vi.spyOn(repo, 'list').mockImplementationOnce(async () => {
      const result = await list();
      // Creata (in memoria, scrittura non ancora arrivata) mentre si rilegge.
      addNote(created);
      openTab(created.id);
      return result;
    });
    const { channel } = listen();
    const stop = startCrossTabSync();
    channel.postMessage({ reloadAll: true });
    await vi.waitFor(() => expect(notes().map((n) => n.id)).not.toContain(gone.id));
    await settle();
    expect(notes().map((n) => n.id)).toContain(created.id);
    expect(changedElsewhere.value.has(created.id)).toBe(false);
    stop();
    channel.close();
  });
});
