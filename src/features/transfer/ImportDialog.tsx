import { useEffect, useRef, useState } from 'preact/hooks';
import { WrongPassphraseError } from '../crypto/keys';
import { PassphraseInput, ShowPassphraseToggle } from '../crypto/PassphraseInput';
import { notesState } from '../notes/store';
import {
  applyImport,
  decryptImport,
  previewImport,
  readImportFile,
  type ImportMode,
  type ImportOutcome,
} from './actions';
import {
  EXPORT_EXTENSION,
  EXPORT_MAX_BYTES,
  InvalidExportError,
  type ExportPayload,
  type SealedExport,
} from './format';

type Step = 'file' | 'passphrase' | 'choice' | 'done';

export const IMPORT_MESSAGES = {
  noFile: 'Scegli un file .notepad.',
  invalid: 'Il file non è un’esportazione di Notepad−− valida.',
  version:
    'Versione non supportata: il file è stato creato da una versione più recente di Notepad−−.',
  tooLarge: `Il file è troppo grande (al massimo ${EXPORT_MAX_BYTES / 1024 / 1024} MB).`,
  wrongPassphrase: 'Passphrase del file errata',
  missingPassphrase: 'Scrivi la passphrase del file.',
  failed: 'Non è stato possibile importare le note. Non è cambiato nulla: riprova.',
} as const;

function fileError(error: unknown): string {
  if (!(error instanceof InvalidExportError)) return IMPORT_MESSAGES.invalid;
  if (error.reason === 'version') return IMPORT_MESSAGES.version;
  if (error.reason === 'too-large') return IMPORT_MESSAGES.tooLarge;
  return IMPORT_MESSAGES.invalid;
}

function notes(count: number): string {
  return count === 1 ? '1 nota' : `${count} note`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Esito mostrato (e annunciato) alla fine, con l'accordo singolare/plurale. */
export function outcomeText(outcome: Extract<ImportOutcome, { status: 'ok' }>): string {
  const parts: string[] = [];
  if (outcome.mode === 'replace') {
    parts.push(
      outcome.replaced === 1 ? 'Sostituita: 1 nota.' : `Sostituite: ${outcome.replaced} note.`,
    );
    if (outcome.removed > 0) {
      parts.push(`${plural(outcome.removed, 'nota eliminata', 'note eliminate')}.`);
    }
    if (outcome.unreadable > 0) {
      parts.push(
        `${plural(outcome.unreadable, 'nota illeggibile lasciata intatta', 'note illeggibili lasciate intatte')}.`,
      );
    }
  } else {
    parts.push(
      `${plural(outcome.added, 'aggiunta', 'aggiunte')}, ${plural(outcome.updated, 'aggiornata', 'aggiornate')}, ${plural(outcome.unchanged, 'già presente', 'già presenti')}.`,
    );
  }
  if (outcome.conflicts > 0) {
    parts.push(
      outcome.conflicts === 1
        ? '1 nota in conflitto non importata: ha modifiche non salvate qui o cambiate in un’altra scheda.'
        : `${outcome.conflicts} note in conflitto non importate: hanno modifiche non salvate qui o cambiate in un’altra scheda.`,
    );
  }
  if (outcome.skipped > 0) {
    parts.push(
      outcome.skipped === 1
        ? '1 nota non importata: qui c’è una nota con lo stesso identificativo che non si riesce a leggere.'
        : `${outcome.skipped} note non importate: qui ci sono note con lo stesso identificativo che non si riescono a leggere.`,
    );
  }
  return parts.join(' ');
}

/** Testo della conferma per Sostituisci tutto: le note che verranno davvero eliminate. */
export function removalText(count: number): string {
  if (count === 0) return 'Nessuna nota attuale verrà eliminata.';
  return count === 1
    ? 'Ho capito che 1 nota attuale verrà eliminata'
    : `Ho capito che le ${count} note attuali verranno eliminate`;
}

/**
 * Importazione in tre passi in un <dialog> modale: file, passphrase del file, riepilogo e
 * scelta (Unisci o Sostituisci tutto, quest'ultima con conferma esplicita). Il contenuto
 * decifrato resta solo nello stato di questo componente: sparisce chiudendo il dialogo o
 * bloccando le note (che smonta l'area delle note).
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [step, setStep] = useState<Step>('file');
  const [sealed, setSealed] = useState<SealedExport | null>(null);
  const [payload, setPayload] = useState<ExportPayload | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    fileRef.current?.focus();
    const onDialogClose = () => {
      // Niente file né passphrase nei campi dopo la chiusura.
      if (fileRef.current) fileRef.current.value = '';
      if (passphraseRef.current) passphraseRef.current.value = '';
      onCloseRef.current();
    };
    dialog.addEventListener('close', onDialogClose);
    return () => {
      dialog.removeEventListener('close', onDialogClose);
      if (dialog.open) dialog.close();
    };
  }, []);

  // A ogni passo il focus va sul primo controllo: autoFocus non vale in un dialogo già aperto.
  useEffect(() => {
    if (step === 'file') fileRef.current?.focus();
    else if (step === 'passphrase') passphraseRef.current?.focus();
    else if (step === 'choice') mergeRef.current?.focus();
    else closeRef.current?.focus();
  }, [step]);

  const state = notesState.value;
  const unreadableCount = state.status === 'ready' ? state.unreadable.length : 0;
  // Anteprima sulle note in memoria: quante ne elimina davvero la modalità scelta.
  const preview = payload ? previewImport(payload, mode) : null;
  const removeCount = preview?.remove.length ?? 0;
  const conflictCount = preview?.conflicts.length ?? 0;
  const needsConfirmation = mode === 'replace' && removeCount > 0;

  const chooseMode = (next: ImportMode) => {
    setMode(next);
    // La conferma vale per la scelta fatta: cambiando modalità si ridà.
    setUnderstood(false);
  };

  const onFile = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(IMPORT_MESSAGES.noFile);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSealed(await readImportFile(file));
      setStep('passphrase');
    } catch (failure) {
      setError(fileError(failure));
    } finally {
      setBusy(false);
    }
  };

  const onPassphrase = async (e: Event) => {
    e.preventDefault();
    if (busy || !sealed) return;
    if (passphrase === '') {
      setError(IMPORT_MESSAGES.missingPassphrase);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const opened = await decryptImport(sealed, passphrase);
      setPassphrase('');
      setPayload(opened);
      setSealed(null);
      setStep('choice');
    } catch (failure) {
      if (failure instanceof WrongPassphraseError) {
        setError(IMPORT_MESSAGES.wrongPassphrase);
        passphraseRef.current?.focus();
        passphraseRef.current?.select();
      } else setError(fileError(failure));
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (e: Event) => {
    e.preventDefault();
    if (busy || !payload || (needsConfirmation && !understood)) return;
    setBusy(true);
    setError(null);
    const outcome = await applyImport(payload, mode);
    setBusy(false);
    // 'locked': il dialogo sparisce con le note.
    if (outcome.status === 'locked') return;
    if (outcome.status === 'error') {
      setError(IMPORT_MESSAGES.failed);
      return;
    }
    setPayload(null);
    setDone(outcomeText(outcome));
    setStep('done');
  };

  const close = () => ref.current?.close();
  const cancel = (
    <button type="button" class="ghost" disabled={busy} onClick={close}>
      Annulla
    </button>
  );
  const errorLine = (
    <p id="import-error" class="form-error" role="alert">
      {error ?? ''}
    </p>
  );

  return (
    <dialog
      ref={ref}
      class="confirm passphrase-dialog transfer-dialog"
      aria-labelledby="import-title"
      aria-describedby="import-text"
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <h2 id="import-title">Importa note</h2>
      <p id="import-text">
        Le note arrivano da un file <code>{EXPORT_EXTENSION}</code> esportato da un altro PC e si
        aprono con la passphrase scelta all’esportazione.
      </p>
      {/* Regione viva sempre montata, vuota finché l'importazione non riesce. */}
      <p role="status" class="change-status">
        {done ?? ''}
      </p>
      {step === 'file' && (
        <form class="vault-form" onSubmit={(e) => void onFile(e)}>
          <div class="vault-field">
            <label for="import-file">File da importare</label>
            <input
              ref={fileRef}
              id="import-file"
              type="file"
              accept={EXPORT_EXTENSION}
              disabled={busy}
              aria-describedby="import-error"
              aria-invalid={error !== null}
              onChange={() => setError(null)}
            />
          </div>
          {errorLine}
          <div class="confirm-actions">
            {cancel}
            <button type="submit" class="primary" disabled={busy}>
              {busy ? 'Lettura…' : 'Avanti'}
            </button>
          </div>
        </form>
      )}
      {step === 'passphrase' && (
        <form class="vault-form" onSubmit={(e) => void onPassphrase(e)}>
          <PassphraseInput
            id="import-passphrase"
            label="Passphrase del file"
            value={passphrase}
            onInput={setPassphrase}
            autocomplete="current-password"
            shown={shown}
            busy={busy}
            inputRef={passphraseRef}
            describedBy="import-passphrase-hint import-error"
            invalid={error !== null}
          />
          <p id="import-passphrase-hint" class="hint">
            Quella scelta quando il file è stato esportato, non per forza quella delle note.
          </p>
          <ShowPassphraseToggle
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            controls="import-passphrase"
          />
          {errorLine}
          <div class="confirm-actions">
            {cancel}
            <button type="submit" class="primary" disabled={busy}>
              {busy ? 'Verifica…' : 'Apri il file'}
            </button>
          </div>
        </form>
      )}
      {step === 'choice' && payload && (
        <form class="vault-form" onSubmit={(e) => void onImport(e)}>
          <p id="import-summary" class="transfer-summary">
            Il file contiene {notes(payload.notes.length)}
            {payload.savedViews.length > 0
              ? ` e ${plural(payload.savedViews.length, 'vista salvata', 'viste salvate')}`
              : ''}
            .
          </p>
          <fieldset class="transfer-modes" aria-describedby="import-summary">
            <legend>Come importarle</legend>
            <label>
              <input
                ref={mergeRef}
                type="radio"
                name="import-mode"
                value="merge"
                checked={mode === 'merge'}
                disabled={busy}
                onChange={() => chooseMode('merge')}
              />
              <span>
                <strong>Unisci</strong>
                <span class="hint">
                  Aggiunge le note nuove. Se una nota è in entrambi, resta la versione modificata
                  più di recente. Le viste salvate con un nome nuovo si aggiungono.
                </span>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={mode === 'replace'}
                disabled={busy}
                onChange={() => chooseMode('replace')}
              />
              <span>
                <strong>Sostituisci tutto</strong>
                <span class="hint">
                  Elimina le note e le viste salvate di questo browser e le sostituisce con quelle
                  del file.
                  {unreadableCount > 0 &&
                    ` ${unreadableCount === 1 ? 'La nota illeggibile resta intatta.' : `Le ${unreadableCount} note illeggibili restano intatte.`}`}
                </span>
              </span>
            </label>
          </fieldset>
          {conflictCount > 0 && (
            <p class="hint">
              {conflictCount === 1
                ? '1 nota ha modifiche non salvate qui o cambiate in un’altra scheda: non verrà né sovrascritta né eliminata.'
                : `${conflictCount} note hanno modifiche non salvate qui o cambiate in un’altra scheda: non verranno né sovrascritte né eliminate.`}
            </p>
          )}
          {mode === 'replace' &&
            (needsConfirmation ? (
              <label class="transfer-check">
                <input
                  type="checkbox"
                  checked={understood}
                  disabled={busy}
                  onChange={(e) => setUnderstood(e.currentTarget.checked)}
                />
                <span>{removalText(removeCount)}</span>
              </label>
            ) : (
              <p class="hint">{removalText(0)}</p>
            ))}
          {errorLine}
          <div class="confirm-actions">
            {cancel}
            <button
              type="submit"
              class={mode === 'replace' ? 'danger' : 'primary'}
              disabled={busy || (needsConfirmation && !understood)}
            >
              {busy ? 'Importazione…' : mode === 'replace' ? 'Sostituisci tutto' : 'Importa'}
            </button>
          </div>
        </form>
      )}
      {step === 'done' && (
        <div class="confirm-actions">
          <button ref={closeRef} type="button" class="primary" onClick={close}>
            Chiudi
          </button>
        </div>
      )}
    </dialog>
  );
}
