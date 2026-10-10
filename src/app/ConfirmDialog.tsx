import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

interface ConfirmDialogProps {
  /** Prefisso degli id interni (titolo, descrizione, campo). */
  id: string;
  title: string;
  children: ComponentChildren;
  confirmLabel: string;
  busyLabel: string;
  /** Parola da scrivere per abilitare la conferma, per le azioni che non si possono annullare. */
  requireText?: string;
  /**
   * Esegue l'azione; restituisce un messaggio d'errore (il dialogo resta aperto) o null.
   * `report` mostra un avviso mentre si aspetta (per esempio altre schede da chiudere).
   */
  onConfirm: (report: (message: string) => void) => Promise<string | null>;
  /** Chiamato una volta, alla chiusura: `confirmed` se l'azione è riuscita. */
  onClose: (confirmed: boolean) => void;
}

/**
 * Conferma di un'azione distruttiva in un <dialog> modale (mai window.confirm): Esc o
 * Annulla chiudono senza fare nulla; durante l'azione non si può più annullare.
 */
export function ConfirmDialog({
  id,
  title,
  children,
  confirmLabel,
  busyLabel,
  requireText,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const done = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    const onDialogClose = () => {
      if (done.current) return;
      done.current = true;
      onCloseRef.current(false);
    };
    dialog.addEventListener('close', onDialogClose);
    return () => {
      dialog.removeEventListener('close', onDialogClose);
      if (dialog.open) dialog.close();
    };
  }, []);

  const finish = (confirmed: boolean) => {
    if (done.current) return;
    done.current = true;
    ref.current?.close();
    onCloseRef.current(confirmed);
  };

  const ready = requireText === undefined || typed.trim() === requireText;

  return (
    <dialog
      ref={ref}
      class="confirm"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || busy) return;
          setBusy(true);
          setError(null);
          void onConfirm(setStatus).then((failure) => {
            setBusy(false);
            setStatus(null);
            if (failure === null) finish(true);
            else setError(failure);
          });
        }}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-text`} class="confirm-text">
          {children}
        </div>
        {requireText !== undefined && (
          <div class="vault-field">
            <label for={`${id}-typed`}>Scrivi {requireText} per confermare</label>
            <input
              id={`${id}-typed`}
              type="text"
              autocomplete="off"
              spellcheck={false}
              autoFocus
              value={typed}
              readOnly={busy}
              onInput={(e) => setTyped(e.currentTarget.value)}
            />
          </div>
        )}
        {status && (
          <p class="confirm-status" role="status">
            {status}
          </p>
        )}
        {error && (
          <p class="form-error" role="alert">
            {error}
          </p>
        )}
        <div class="confirm-actions">
          {/* Senza parola da scrivere il focus parte da Annulla: Invio per sbaglio non fa nulla. */}
          <button
            type="button"
            class="ghost"
            autoFocus={requireText === undefined}
            disabled={busy}
            onClick={() => finish(false)}
          >
            Annulla
          </button>
          <button type="submit" class="danger" disabled={!ready || busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
