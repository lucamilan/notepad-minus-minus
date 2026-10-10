import { useEffect, useRef, useState } from 'preact/hooks';
import {
  MISMATCH_ERROR,
  NEW_PASSPHRASE_HINT,
  newPassphraseError,
  PassphraseInput,
  ShowPassphraseToggle,
  TOO_SHORT_ERROR,
} from '../crypto/PassphraseInput';
import { exportNotes } from './actions';

/** Il link al file resta valido per un po': alcuni browser avviano il download dopo il clic. */
const REVOKE_DELAY_MS = 30_000;

/**
 * Scarica `blob` con un <a download> temporaneo. Il link sta dentro il dialogo modale (fuori
 * il resto della pagina è inerte). Un URL blob: con `download` è uno scaricamento, non una
 * navigazione: la CSP non lo blocca e non parte nessuna richiesta di rete.
 */
function downloadBlob(blob: Blob, fileName: string, container: HTMLElement): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  container.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

function exportedText(count: number, unreadable: number): string {
  const done = count === 1 ? 'Esportata 1 nota.' : `Esportate ${count} note.`;
  if (unreadable === 0) return done;
  return unreadable === 1
    ? `${done} 1 nota illeggibile non è inclusa.`
    : `${done} ${unreadable} note illeggibili non sono incluse.`;
}

/**
 * Esportazione in un <dialog> modale: passphrase del file (con conferma), poi lo scaricamento.
 * Riuscita, il dialogo resta aperto con l'esito finché non lo si chiude.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    firstRef.current?.focus();
    const onDialogClose = () => onCloseRef.current();
    dialog.addEventListener('close', onDialogClose);
    return () => {
      dialog.removeEventListener('close', onDialogClose);
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (done) closeRef.current?.focus();
  }, [done]);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    const invalid = newPassphraseError(passphrase, confirmation);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await exportNotes(passphrase);
    setBusy(false);
    if (result.status === 'ok') {
      const dialog = ref.current;
      if (dialog) downloadBlob(result.blob, result.fileName, dialog);
      setPassphrase('');
      setConfirmation('');
      setDone(exportedText(result.count, result.unreadable));
      return;
    }
    // 'locked': il dialogo sparisce con le note, non c'è nulla da mostrare.
    if (result.status === 'locked') return;
    setError(
      result.status === 'invalid'
        ? TOO_SHORT_ERROR
        : 'Non è stato possibile esportare le note. Riprova.',
    );
  };

  return (
    <dialog
      ref={ref}
      class="confirm passphrase-dialog transfer-dialog"
      aria-labelledby="export-title"
      aria-describedby="export-text"
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <h2 id="export-title">Esporta note</h2>
      <p id="export-text">
        Tutte le note e le viste salvate finiscono in un file <code>.notepad</code> cifrato con la
        passphrase che scegli qui. Ti servirà per importarle sull’altro PC.
      </p>
      {/* Regione viva sempre montata, vuota finché l'esportazione non riesce. */}
      <p role="status" class="change-status">
        {done ?? ''}
      </p>
      {done ? (
        <div class="confirm-actions">
          <button ref={closeRef} type="button" class="primary" onClick={() => ref.current?.close()}>
            Chiudi
          </button>
        </div>
      ) : (
        <form class="vault-form" onSubmit={(e) => void onSubmit(e)}>
          <PassphraseInput
            id="export-passphrase"
            label="Passphrase del file"
            value={passphrase}
            onInput={setPassphrase}
            autocomplete="new-password"
            shown={shown}
            busy={busy}
            inputRef={firstRef}
            describedBy="export-passphrase-hint export-error"
            invalid={error === TOO_SHORT_ERROR}
          />
          <p id="export-passphrase-hint" class="hint">
            {NEW_PASSPHRASE_HINT} Puoi usare la stessa passphrase delle note, ma va scritta di
            nuovo.
          </p>
          <PassphraseInput
            id="export-repeat"
            label="Ripeti la passphrase del file"
            value={confirmation}
            onInput={setConfirmation}
            autocomplete="new-password"
            shown={shown}
            busy={busy}
            describedBy="export-error"
            invalid={error === MISMATCH_ERROR}
          />
          <ShowPassphraseToggle
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            controls="export-passphrase export-repeat"
          />
          <p class="vault-warning">
            Senza questa passphrase il file non si può aprire: non c’è modo di recuperarla.
          </p>
          <p id="export-error" class="form-error" role="alert">
            {error ?? ''}
          </p>
          <div class="confirm-actions">
            <button
              type="button"
              class="ghost"
              disabled={busy}
              onClick={() => ref.current?.close()}
            >
              Annulla
            </button>
            <button type="submit" class="primary" disabled={busy}>
              {busy ? 'Cifratura…' : 'Esporta'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
