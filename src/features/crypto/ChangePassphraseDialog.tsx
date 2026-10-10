import { useEffect, useRef, useState } from 'preact/hooks';
import {
  MISMATCH_ERROR,
  NEW_PASSPHRASE_HINT,
  TOO_SHORT_ERROR,
  newPassphraseError,
  PassphraseInput,
  ShowPassphraseToggle,
} from './PassphraseInput';
import { changePassphrase } from './vault';

const CURRENT_MISSING = 'Scrivi la passphrase attuale.';

/**
 * Cambio passphrase in un <dialog> modale sopra le impostazioni: attuale, nuova e conferma.
 * Riuscito, il dialogo resta aperto con la conferma finché non lo si chiude.
 */
export function ChangePassphraseDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    currentRef.current?.focus();
    const onDialogClose = () => onCloseRef.current();
    dialog.addEventListener('close', onDialogClose);
    return () => {
      dialog.removeEventListener('close', onDialogClose);
      if (dialog.open) dialog.close();
    };
  }, []);

  // autoFocus non sposta il focus dentro un dialogo già aperto: lo si porta a mano su "Chiudi".
  useEffect(() => {
    if (changed) closeRef.current?.focus();
  }, [changed]);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    const invalid = newPassphraseError(next, confirmation);
    if (current === '' || invalid) {
      setError(current === '' ? CURRENT_MISSING : invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await changePassphrase(current, next);
    setBusy(false);
    if (result === 'ok') {
      setCurrent('');
      setNext('');
      setConfirmation('');
      setChanged(true);
      return;
    }
    setError(
      result === 'wrong'
        ? 'Passphrase attuale errata'
        : result === 'invalid'
          ? TOO_SHORT_ERROR
          : 'Non è stato possibile cambiare la passphrase. Riprova.',
    );
    if (result === 'wrong') {
      currentRef.current?.focus();
      currentRef.current?.select();
    }
  };

  return (
    <dialog
      ref={ref}
      class="confirm passphrase-dialog"
      aria-labelledby="change-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <h2 id="change-title">Cambia passphrase</h2>
      {/* Regione viva sempre montata, vuota finché il cambio non riesce. */}
      <p role="status" class="change-status">
        {changed ? 'Passphrase cambiata. Dalla prossima volta sblocca con quella nuova.' : ''}
      </p>
      {changed ? (
        <div class="confirm-actions">
          <button ref={closeRef} type="button" class="primary" onClick={() => ref.current?.close()}>
            Chiudi
          </button>
        </div>
      ) : (
        <form class="vault-form" onSubmit={(e) => void onSubmit(e)}>
          <PassphraseInput
            id="current-passphrase"
            label="Passphrase attuale"
            value={current}
            onInput={setCurrent}
            autocomplete="current-password"
            shown={shown}
            busy={busy}
            inputRef={currentRef}
            describedBy="change-error"
            invalid={error === 'Passphrase attuale errata' || error === CURRENT_MISSING}
          />
          <PassphraseInput
            id="next-passphrase"
            label="Nuova passphrase"
            value={next}
            onInput={setNext}
            autocomplete="new-password"
            shown={shown}
            busy={busy}
            describedBy="next-passphrase-hint change-error"
            invalid={error === TOO_SHORT_ERROR}
          />
          <p id="next-passphrase-hint" class="hint">
            {NEW_PASSPHRASE_HINT}
          </p>
          <PassphraseInput
            id="repeat-passphrase"
            label="Ripeti la nuova passphrase"
            value={confirmation}
            onInput={setConfirmation}
            autocomplete="new-password"
            shown={shown}
            busy={busy}
            describedBy="change-error"
            invalid={error === MISMATCH_ERROR}
          />
          <ShowPassphraseToggle
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            controls="current-passphrase next-passphrase repeat-passphrase"
          />
          <p class="vault-warning">
            Anche la nuova non si può recuperare: se la dimentichi, le note sono perse.
          </p>
          <p id="change-error" class="form-error" role="alert">
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
              {busy ? 'Cambio…' : 'Cambia passphrase'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
