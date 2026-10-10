import { batch, signal } from '@preact/signals';
import type { IDBPDatabase } from 'idb';
import { resetCollectionForLock } from '../collection/state';
import {
  drainSavesForLock,
  flushSaves,
  resetAutosaveForLock,
  scheduleSave,
} from '../notes/autosave';
import type { StoredNote } from '../notes/codec';
import { announceLocked, resetCrossTabForLock, setLockListener } from '../notes/crossTab';
import {
  deleteDatabase,
  DB_NAME,
  LEGACY_DB_NAME,
  openNotepadDb,
  type ConnectionEvents,
  type NotepadSchema,
} from '../notes/database';
import type { Note } from '../notes/note';
import { createNoteRepository } from '../notes/repository';
import {
  addNote,
  connectionEvents,
  initNotes,
  messageForError,
  MESSAGES,
  notesState,
  replaceNote,
  resetNotesForLock,
} from '../notes/store';
import { resetSearchForLock } from '../search/state';
import { resetTabActionsForLock } from '../tabs/actions';
import { createAesCodec, type AesCodec } from './aesCodec';
import {
  createKeyring,
  parseKeyring,
  PASSPHRASE_MIN_LENGTH,
  passphraseLength,
  rewrapKeyring,
  unlockKeyring,
  WrongPassphraseError,
  type KdfTestOptions,
} from './keys';
import { addKeyringIfAbsent, readKeyring, writeKeyring } from './keyringStore';
import { databaseExists, migrateLegacy } from './legacy';

/**
 * Stato della cassaforte: le note si vedono solo da sbloccate. Da bloccate in memoria non
 * c'è nulla di decifrato: né note, né schede, né viste, né la chiave (vive solo nel codec,
 * che la dimentica al blocco). La connessione al database resta aperta: non contiene chiavi.
 */
export type VaultState =
  | { status: 'opening'; message?: string }
  /** Prima passphrase da creare; `legacy`: ci sono note in chiaro di F2–F6 da cifrare. */
  | { status: 'setup'; legacy: boolean }
  | { status: 'locked'; message?: string }
  | { status: 'unlocked' }
  /** `canReset`: si può solo ricominciare da capo (dati della passphrase rovinati). */
  | { status: 'error'; message: string; canReset?: boolean };

export const vaultState = signal<VaultState>({ status: 'opening' });

export type LockReason = 'manual' | 'auto' | 'remote';

export const VAULT_MESSAGES = {
  createdElsewhere:
    'La passphrase è già stata creata in un’altra scheda: inseriscila per sbloccare.',
  auto: 'Note bloccate per inattività.',
  remote: 'Note bloccate da un’altra scheda.',
  invalidKeyring:
    'I dati della passphrase in questo browser sono rovinati: le note non si possono sbloccare.',
} as const;

let db: IDBPDatabase<NotepadSchema> | undefined;
let codec: AesCodec | undefined;
let locking: Promise<void> | null = null;
let kdfOptions: KdfTestOptions = {};
let minIterations: number | undefined;
/**
 * Note che al blocco non si sono potute salvare, già cifrate: si riprendono al prossimo
 * sblocco. In memoria non resta testo in chiaro.
 */
interface QueuedNote {
  record: StoredNote;
  /** Trattenuta per un conflitto con un'altra scheda: allo sblocco torna come nota nuova. */
  held: boolean;
}
let lockedQueue: QueuedNote[] = [];
let guardTarget: Window | undefined;

function onBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault();
  // Alcuni browser chiedono conferma solo se returnValue è impostato.
  e.returnValue = '';
}

/**
 * Chiudendo la pagina con modifiche trattenute al blocco il browser chiede conferma. Il
 * listener c'è solo finché servono: uno fisso escluderebbe la pagina dalla cache avanti/indietro.
 */
function setLockedQueue(next: QueuedNote[]): void {
  lockedQueue = next;
  if (!guardTarget) return;
  if (next.length > 0) guardTarget.addEventListener('beforeunload', onBeforeUnload);
  else guardTarget.removeEventListener('beforeunload', onBeforeUnload);
}

const SLOW_OPEN_MS = 8000;

/**
 * Solo per i test: meno iterazioni PBKDF2, anche come minimo accettato. L'app non la chiama
 * mai: in produzione valgono PBKDF2_ITERATIONS per creare e per accettare un portachiavi.
 */
export function configureVaultForTests(options: { iterations: number }): void {
  kdfOptions = { iterations: options.iterations };
  minIterations = options.iterations;
}

/** Solo per i test. */
export function resetVaultForTests(): void {
  db?.close();
  db = undefined;
  codec?.forget();
  codec = undefined;
  locking = null;
  unlocking = null;
  setLockedQueue([]);
  kdfOptions = {};
  minIterations = undefined;
  setLockListener(undefined);
  vaultState.value = { status: 'opening' };
}

/** Quante note cifrate aspettano lo sblocco per essere salvate (per i test e l'avviso). */
export function lockedQueueSize(): number {
  return lockedQueue.length;
}

function readKeyringParams() {
  return minIterations === undefined ? {} : { minIterations };
}

/**
 * Parametri PBKDF2 anche per il file di esportazione (F8): quelli di produzione, salvo che i
 * test li abbiano abbassati con configureVaultForTests.
 */
export function transferKdfParams(): { iterations?: number; minIterations?: number } {
  return { ...kdfOptions, ...readKeyringParams() };
}

/**
 * La connessione si è chiusa (aggiornamento o eliminazione da un'altra scheda, errore del
 * browser). Da sbloccate lo mostra l'area delle note; altrimenti la schermata di blocco.
 */
function connectionLost(message: string, notify: (() => void) | undefined): void {
  db = undefined;
  if (vaultState.value.status === 'unlocked') notify?.();
  else vaultState.value = { status: 'error', message };
}

/** Apre il database cifrato e decide se chiedere di creare la passphrase o di sbloccare. */
export async function startVault(): Promise<void> {
  setLockListener(() => void lockVault('remote'));
  vaultState.value = { status: 'opening' };
  const base = connectionEvents();
  const events: ConnectionEvents = {
    ...base,
    onBlocked: () => {
      if (vaultState.value.status === 'opening') {
        vaultState.value = { status: 'opening', message: MESSAGES.blocked };
      } else base.onBlocked?.();
    },
    onVersionChange: () => connectionLost(MESSAGES.reload, base.onVersionChange),
    onTerminated: () => connectionLost(MESSAGES.terminated, base.onTerminated),
  };
  const slow = setTimeout(() => {
    const state = vaultState.value;
    if (state.status === 'opening' && !state.message) {
      vaultState.value = { status: 'opening', message: MESSAGES.slow };
    }
  }, SLOW_OPEN_MS);
  try {
    const connection = await openNotepadDb(events);
    db = connection;
    const stored = await readKeyring(connection);
    if (stored === undefined) {
      vaultState.value = { status: 'setup', legacy: await databaseExists(LEGACY_DB_NAME) };
      return;
    }
    try {
      parseKeyring(stored, readKeyringParams());
    } catch (error) {
      console.error(error);
      vaultState.value = {
        status: 'error',
        message: VAULT_MESSAGES.invalidKeyring,
        canReset: true,
      };
      return;
    }
    vaultState.value = { status: 'locked' };
  } catch (error) {
    console.error(error);
    vaultState.value = { status: 'error', message: messageForError(error) };
  } finally {
    clearTimeout(slow);
  }
}

export type SetupResult = 'ok' | 'exists' | 'invalid' | 'locked' | 'error';

/**
 * Sblocco (o prima creazione) in corso: un blocco chiesto nel frattempo (Alt+L, un'altra
 * scheda, inattività) non va perso, lo si applica appena finisce di caricare.
 */
let unlocking: { lockRequested: LockReason | null } | null = null;

/** Prima passphrase: crea il portachiavi, cifra le note del vecchio archivio e apre le note. */
export async function setupVault(passphrase: string): Promise<SetupResult> {
  const connection = db;
  if (!connection || vaultState.value.status !== 'setup' || unlocking) return 'error';
  if (passphraseLength(passphrase) < PASSPHRASE_MIN_LENGTH) return 'invalid';
  unlocking = { lockRequested: null };
  try {
    const { keyring, key } = await createKeyring(passphrase, kdfOptions);
    if (vaultState.value.status !== 'setup' || db !== connection) return 'error';
    if (!(await addKeyringIfAbsent(connection, keyring))) {
      vaultState.value = { status: 'locked', message: VAULT_MESSAGES.createdElsewhere };
      return 'exists';
    }
    return await openWithKey(connection, key, 'setup');
  } catch (error) {
    console.error(error);
    return 'error';
  } finally {
    unlocking = null;
  }
}

export type UnlockResult = 'ok' | 'wrong' | 'locked' | 'error';

export async function unlockVault(passphrase: string): Promise<UnlockResult> {
  if (locking) await locking;
  const connection = db;
  if (!connection || vaultState.value.status !== 'locked' || unlocking) return 'error';
  unlocking = { lockRequested: null };
  try {
    // Si rilegge ogni volta: un'altra scheda può aver cambiato passphrase.
    const keyring = parseKeyring(await readKeyring(connection), readKeyringParams());
    const key = await unlockKeyring(keyring, passphrase);
    if (vaultState.value.status !== 'locked' || db !== connection) return 'error';
    return await openWithKey(connection, key, 'locked');
  } catch (error) {
    if (error instanceof WrongPassphraseError) return 'wrong';
    console.error(error);
    return 'error';
  } finally {
    unlocking = null;
  }
}

/**
 * Migra, carica le note e passa a "sbloccate", ma solo se nel frattempo nulla è cambiato:
 * stessa connessione, stesso stato di partenza, nessun blocco richiesto. Altrimenti ciò che
 * è stato caricato esce subito dalla memoria e la chiave si dimentica.
 */
async function openWithKey(
  connection: IDBPDatabase<NotepadSchema>,
  key: CryptoKey,
  from: 'setup' | 'locked',
): Promise<'ok' | 'locked' | 'error'> {
  const aes = createAesCodec(key);
  codec = aes;
  const stillValid = () =>
    db === connection && vaultState.value.status === from && !unlocking?.lockRequested;
  try {
    const result = await migrateLegacy(connection, aes, { includeMeta: from === 'setup' });
    if (result.migrated > 0) console.info(`${result.migrated} note del vecchio archivio cifrate`);
  } catch (error) {
    // Il vecchio archivio resta dov'è: si riprova al prossimo sblocco.
    console.error('Migrazione del vecchio archivio non riuscita', error);
  }
  if (stillValid()) {
    const repo = createNoteRepository(connection, aes);
    resetNotesForLock();
    await initNotes(() => Promise.resolve(repo));
    await resumeLockedQueue(aes);
  }
  if (stillValid()) {
    vaultState.value = { status: 'unlocked' };
    return 'ok';
  }
  // Annullato: si torna bloccati (o si resta nell'errore) senza lasciare nulla in memoria.
  const reason = unlocking?.lockRequested ?? null;
  const sameConnection = db === connection && vaultState.value.status === from;
  if (sameConnection && reason) {
    vaultState.value =
      reason === 'manual'
        ? { status: 'locked' }
        : { status: 'locked', message: VAULT_MESSAGES[reason] };
  }
  const done = finishLock(aes).finally(() => {
    if (locking === done) locking = null;
  });
  locking = done;
  await done;
  return sameConnection && reason ? 'locked' : 'error';
}

/**
 * Riprende le note che al blocco non si erano potute salvare: tornano in memoria e nella
 * coda del salvataggio continuo, che le scrive subito (con riprova ed errore visibile).
 * Diventano una nota nuova, così nessun testo va perso e nulla si sovrascrive, se erano
 * trattenute per un conflitto con un'altra scheda (la scelta non era stata fatta), se nel
 * frattempo un'altra scheda ha salvato una versione più recente o se il record è illeggibile.
 */
async function resumeLockedQueue(aes: AesCodec): Promise<void> {
  if (lockedQueue.length === 0) return;
  const state = notesState.value;
  if (state.status !== 'ready') return; // si riprova al prossimo sblocco
  const queue = lockedQueue;
  setLockedQueue([]);
  const decoded = await Promise.allSettled(queue.map((entry) => aes.decode(entry.record)));
  batch(() => {
    decoded.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error('Modifica trattenuta al blocco illeggibile', result.reason);
        return;
      }
      const note = result.value;
      const held = queue[i]?.held ?? false;
      const current = state.notes.find((n) => n.id === note.id);
      const unreadable = state.unreadable.includes(note.id);
      if (!held && !unreadable && (!current || current.modifiedAt <= note.modifiedAt)) {
        if (current) replaceNote(note);
        else addNote(note);
        scheduleSave(note);
      } else {
        const copy: Note = { ...note, id: crypto.randomUUID(), modifiedAt: Date.now() };
        addNote(copy);
        scheduleSave(copy);
      }
    });
  });
  await flushSaves();
}

/**
 * Blocca: la schermata di blocco sostituisce subito le note (editor e anteprima si
 * smontano), poi si salva quanto è in coda; ciò che non si riesce a scrivere si cifra e si
 * tiene da parte. Infine si svuota la memoria e il codec dimentica la chiave.
 * Il blocco manuale vale per tutte le schede; quello per inattività solo per questa.
 * Durante uno sblocco il blocco si annota e si applica appena lo sblocco finisce.
 */
export function lockVault(reason: LockReason = 'manual'): Promise<void> {
  if (vaultState.value.status !== 'unlocked') {
    if (unlocking) {
      unlocking.lockRequested ??= reason;
      if (reason === 'manual') announceLocked();
    }
    return locking ?? Promise.resolve();
  }
  vaultState.value =
    reason === 'manual'
      ? { status: 'locked' }
      : { status: 'locked', message: VAULT_MESSAGES[reason] };
  if (reason === 'manual') announceLocked();
  const done = finishLock(codec).finally(() => {
    if (locking === done) locking = null;
  });
  locking = done;
  return done;
}

async function finishLock(aes: AesCodec | undefined): Promise<void> {
  try {
    const left = await drainSavesForLock();
    if (left.length > 0 && aes) {
      const encoded = await Promise.all(
        left.map(async ({ note, held }) => ({ record: await aes.encode(note), held })),
      );
      const ids = new Set(encoded.map((entry) => entry.record.id));
      setLockedQueue([...lockedQueue.filter((entry) => !ids.has(entry.record.id)), ...encoded]);
    }
  } catch (error) {
    console.error('Modifiche non salvate al blocco', error);
  } finally {
    batch(() => {
      resetAutosaveForLock();
      resetCrossTabForLock();
      resetTabActionsForLock();
      resetCollectionForLock();
      resetSearchForLock();
      resetNotesForLock();
    });
    aes?.forget();
    if (codec === aes) codec = undefined;
  }
}

export type ChangeResult = 'ok' | 'wrong' | 'invalid' | 'error';

/** Ricifra la chiave dati con la nuova passphrase (vedi keys.ts): le note non cambiano. */
export async function changePassphrase(current: string, next: string): Promise<ChangeResult> {
  const connection = db;
  if (!connection || vaultState.value.status !== 'unlocked') return 'error';
  if (passphraseLength(next) < PASSPHRASE_MIN_LENGTH) return 'invalid';
  try {
    const keyring = parseKeyring(await readKeyring(connection), readKeyringParams());
    await writeKeyring(connection, await rewrapKeyring(keyring, current, next, kdfOptions));
    return 'ok';
  } catch (error) {
    if (error instanceof WrongPassphraseError) return 'wrong';
    console.error(error);
    return 'error';
  }
}

/**
 * "Ho dimenticato la passphrase": elimina il database cifrato (tutte le note) e torna alla
 * creazione della passphrase. Le altre schede chiudono la loro connessione e chiedono di
 * ricaricare; finché non lo fanno l'eliminazione aspetta (`onBlocked`).
 */
export async function resetVault(onBlocked?: () => void): Promise<boolean> {
  if (locking) await locking;
  // Mai durante uno sblocco: si eliminerebbe il database sotto le note appena aperte.
  if (unlocking) return false;
  if (vaultState.value.status !== 'locked' && vaultState.value.status !== 'error') return false;
  setLockedQueue([]);
  db?.close();
  db = undefined;
  try {
    await deleteDatabase(DB_NAME, onBlocked);
  } catch (error) {
    console.error(error);
    vaultState.value = { status: 'error', message: messageForError(error) };
    return false;
  }
  await startVault();
  return true;
}

/** Avvia la richiesta di conferma alla chiusura con modifiche trattenute (setLockedQueue). */
export function startLockedQueueGuard(target: Window = window): () => void {
  guardTarget = target;
  setLockedQueue(lockedQueue);
  return () => {
    target.removeEventListener('beforeunload', onBeforeUnload);
    if (guardTarget === target) guardTarget = undefined;
  };
}
