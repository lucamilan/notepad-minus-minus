import { batch } from '@preact/signals';
import { savedViews } from '../collection/state';
import { parseSavedViews, SAVED_VIEWS_META_KEY, type SavedView } from '../collection/views';
import { PASSPHRASE_MIN_LENGTH, passphraseLength } from '../crypto/keys';
import { transferKdfParams } from '../crypto/vault';
import { flushSaves } from '../notes/autosave';
import {
  announceImported,
  announceSavedViewsChanged,
  hasLocalConflict,
  settleImported,
} from '../notes/crossTab';
import { sameNote, sortNotes, type Note } from '../notes/note';
import {
  currentLockEpoch,
  forgetStored,
  getRepository,
  markStored,
  notesState,
  replaceNotes,
} from '../notes/store';
import { closeTabs, openTab } from '../tabs/actions';
import {
  exportFileName,
  openExport,
  readExportFile,
  sealExport,
  type ExportPayload,
  type SealedExport,
} from './format';

/**
 * Esportazione e importazione del file `.notepad` (F8). Il contenuto decifrato del file vive
 * solo nello stato del dialogo che lo usa (sparisce chiudendolo o bloccando le note): qui non
 * si tiene nulla. Ogni passo dopo un await controlla l'epoca del blocco: se le note sono state
 * bloccate nel frattempo si lascia perdere e non si rimette nulla in memoria.
 */

export const EXPORT_MIME = 'application/octet-stream';

export type ExportOutcome =
  | { status: 'ok'; blob: Blob; fileName: string; count: number; unreadable: number }
  /** Passphrase del file troppo corta. */
  | { status: 'invalid' }
  | { status: 'locked' }
  | { status: 'error' };

function errorName(error: unknown): string {
  return error instanceof Error || error instanceof DOMException ? error.name : typeof error;
}

/**
 * Salva le modifiche in coda, poi cifra tutte le note leggibili in memoria e le viste salvate
 * con `passphrase`. Le note illeggibili non si possono esportare: si contano per dirlo.
 */
export async function exportNotes(
  passphrase: string,
  now: Date = new Date(),
): Promise<ExportOutcome> {
  if (passphraseLength(passphrase) < PASSPHRASE_MIN_LENGTH) return { status: 'invalid' };
  const epoch = currentLockEpoch();
  try {
    await flushSaves();
    const state = notesState.value;
    if (state.status !== 'ready' || currentLockEpoch() !== epoch) return { status: 'locked' };
    const payload: ExportPayload = { notes: state.notes, savedViews: [...savedViews.value] };
    const text = await sealExport(payload, passphrase, transferKdfParams());
    if (currentLockEpoch() !== epoch) return { status: 'locked' };
    return {
      status: 'ok',
      blob: new Blob([text], { type: EXPORT_MIME }),
      fileName: exportFileName(now),
      count: payload.notes.length,
      unreadable: state.unreadable.length,
    };
  } catch (error) {
    // Mai il contenuto nei log: solo il tipo di errore.
    console.error('Esportazione non riuscita', errorName(error));
    return { status: 'error' };
  }
}

/** Controlla il file scelto (dimensione e forma), senza decifrarlo. */
export function readImportFile(file: Blob): Promise<SealedExport> {
  return readExportFile(file, transferKdfParams());
}

/** Decifra il file con la sua passphrase (WrongPassphraseError se è sbagliata). */
export function decryptImport(sealed: SealedExport, passphrase: string): Promise<ExportPayload> {
  return openExport(sealed, passphrase);
}

export type ImportMode = 'merge' | 'replace';

export interface ImportPlan {
  /** Note da scrivere (nuove o più recenti, o diverse sostituendo). */
  put: Note[];
  /** Note leggibili da eliminare (solo sostituendo). */
  remove: string[];
  /** Id delle note nuove. */
  added: string[];
  /** Id delle note già presenti che vengono riscritte. */
  updated: string[];
  /** Note del file già presenti uguali, o qui più recenti. */
  unchanged: number;
  /** Note del file con l'id di un record illeggibile qui: non si sovrascrive mai. */
  skipped: number;
  /**
   * Note che qui hanno modifiche non salvate (anche trattenute) o un avviso da un'altra
   * scheda: non si scrivono né si eliminano.
   */
  conflicts: string[];
}

/**
 * Cosa fa l'importazione, senza farlo. `local` sono le note salvate nell'archivio.
 * - Unisci: le note nuove si aggiungono; con lo stesso id vince la data di modifica più
 *   recente (una nota locale più recente resta com'è); quelle identiche si saltano.
 * - Sostituisci tutto: le note leggibili che non sono nel file si eliminano, quelle del file
 *   si scrivono (le identiche restano come sono).
 * In entrambi i casi i record illeggibili restano intatti e le note in conflitto (`busy`)
 * non si toccano.
 */
export function planImport(
  local: { notes: readonly Note[]; unreadable: readonly string[] },
  imported: readonly Note[],
  mode: ImportMode,
  busy: (id: string) => boolean = () => false,
): ImportPlan {
  const current = new Map(local.notes.map((note) => [note.id, note]));
  const unreadable = new Set(local.unreadable);
  const plan: ImportPlan = {
    put: [],
    remove: [],
    added: [],
    updated: [],
    unchanged: 0,
    skipped: 0,
    conflicts: [],
  };
  for (const note of imported) {
    if (unreadable.has(note.id)) {
      plan.skipped++;
      continue;
    }
    const existing = current.get(note.id);
    if (existing && sameNote(existing, note)) {
      plan.unchanged++;
    } else if (existing && mode === 'merge' && note.modifiedAt <= existing.modifiedAt) {
      plan.unchanged++;
    } else if (busy(note.id)) {
      plan.conflicts.push(note.id);
    } else if (!existing) {
      plan.put.push(note);
      plan.added.push(note.id);
    } else {
      plan.put.push(note);
      plan.updated.push(note.id);
    }
  }
  if (mode === 'replace') {
    const keep = new Set(imported.map((note) => note.id));
    for (const { id } of local.notes) {
      if (keep.has(id)) continue;
      if (busy(id)) plan.conflicts.push(id);
      else plan.remove.push(id);
    }
  }
  return plan;
}

/**
 * Anteprima per il dialogo, sulle note in memoria: quante note si eliminerebbero e quante
 * restano per un conflitto. L'esito vero lo dà applyImport, sulle versioni salvate.
 */
export function previewImport(payload: ExportPayload, mode: ImportMode): ImportPlan | null {
  const state = notesState.value;
  if (state.status !== 'ready') return null;
  return planImport(state, payload.notes, mode, hasLocalConflict);
}

/** Unione delle viste per nome: quelle esistenti restano, si aggiungono quelle con nome nuovo. */
export function mergeSavedViews(
  current: readonly SavedView[],
  imported: readonly SavedView[],
): SavedView[] {
  const names = new Set(current.map((view) => view.name));
  const added = imported.filter((view) => {
    if (names.has(view.name)) return false;
    names.add(view.name);
    return true;
  });
  return [...current, ...added];
}

export type ImportOutcome =
  | {
      status: 'ok';
      mode: ImportMode;
      added: number;
      updated: number;
      unchanged: number;
      /** Note del file con l'id di un record illeggibile qui. */
      skipped: number;
      /** Note lasciate come sono per un conflitto (modifiche qui o in un'altra scheda). */
      conflicts: number;
      /** Note eliminate (sostituendo). */
      removed: number;
      /** Note del file ora nell'archivio così come sono nel file (sostituendo). */
      replaced: number;
      /** Note illeggibili lasciate intatte. */
      unreadable: number;
    }
  | { status: 'locked' }
  | { status: 'error' };

/**
 * Applica il contenuto di un file già decifrato.
 * 1. Si salvano le modifiche in coda e si rilegge l'archivio (note e viste salvate): il piano
 *    si fa sulle versioni salvate, non sulla memoria. Le note con modifiche non salvate o con
 *    un avviso da un'altra scheda non si toccano (conflitti): le loro modifiche restano nella
 *    coda del salvataggio, quindi nulla si perde, nemmeno con un blocco durante la scrittura.
 * 2. Note e viste si cifrano, poi eliminazioni, scritture e viste vanno in un'unica
 *    transazione (`notes` + `meta`), tutto o niente; un record cambiato dopo la rilettura
 *    (un'altra scheda) non si tocca e conta come conflitto.
 * 3. Solo allora cambiano memoria e schede, e le altre schede ricevono l'avviso (senza
 *    contenuto).
 */
export async function applyImport(
  payload: ExportPayload,
  mode: ImportMode,
): Promise<ImportOutcome> {
  const epoch = currentLockEpoch();
  const stillOpen = () => currentLockEpoch() === epoch && notesState.value.status === 'ready';
  try {
    await flushSaves();
    if (!stillOpen()) return { status: 'locked' };
    const repo = getRepository();
    const snapshot = await repo.snapshot();
    const storedViews = parseSavedViews(await repo.getMeta(SAVED_VIEWS_META_KEY));
    if (!stillOpen()) return { status: 'locked' };
    const plan = planImport(snapshot, payload.notes, mode, hasLocalConflict);
    const views =
      mode === 'replace' ? payload.savedViews : mergeSavedViews(storedViews, payload.savedViews);
    const viewsChanged = JSON.stringify(views) !== JSON.stringify(storedViews);
    const { conflicts } = await repo.applyImport({
      put: plan.put,
      remove: plan.remove,
      expected: snapshot.records,
      ...(viewsChanged ? { meta: { key: SAVED_VIEWS_META_KEY, value: views } } : {}),
    });
    const late = new Set(conflicts);
    const put = plan.put.filter((note) => !late.has(note.id));
    const remove = plan.remove.filter((id) => !late.has(id));

    // L'archivio è già cambiato: le altre schede lo devono sapere anche se qui si è bloccato.
    announceImported(
      put.map(({ id, modifiedAt }) => ({ id, modifiedAt })),
      remove,
      mode === 'replace',
    );
    if (viewsChanged) announceSavedViewsChanged();
    if (!stillOpen()) return { status: 'locked' };

    batch(() => {
      closeTabs(remove);
      replaceNotes(put, remove);
      markStored(put);
      forgetStored(remove);
      settleImported(
        put.map((note) => note.id),
        remove,
      );
      if (viewsChanged) savedViews.value = views;
      if (mode === 'replace') {
        // Si apre la prima nota del file ora in memoria (fissate e più recenti prima).
        const state = notesState.value;
        const present = new Set(state.status === 'ready' ? state.notes.map((n) => n.id) : []);
        const first = sortNotes(payload.notes).find((note) => present.has(note.id));
        if (first) openTab(first.id);
      }
    });

    const conflicting = new Set([...plan.conflicts, ...late]);
    const inFile = new Set(payload.notes.map((note) => note.id));
    const fileConflicts = [...conflicting].filter((id) => inFile.has(id)).length;
    return {
      status: 'ok',
      mode,
      added: plan.added.filter((id) => !late.has(id)).length,
      updated: plan.updated.filter((id) => !late.has(id)).length,
      unchanged: plan.unchanged,
      skipped: plan.skipped,
      conflicts: conflicting.size,
      removed: remove.length,
      replaced: mode === 'replace' ? payload.notes.length - plan.skipped - fileConflicts : 0,
      unreadable: snapshot.unreadable.length,
    };
  } catch (error) {
    // Mai il contenuto nei log: solo il tipo di errore. Nulla è cambiato (tutto o niente).
    console.error('Importazione non riuscita', errorName(error));
    return stillOpen() ? { status: 'error' } : { status: 'locked' };
  }
}
