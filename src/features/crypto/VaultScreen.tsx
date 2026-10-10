import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../app/ConfirmDialog';
import { DeviceIcon, LockIcon } from '../../app/icons';
import { loadWorkspace } from '../../app/lazyWorkspace';
import { focusAfterModal } from '../../lib/focus';
import { editorFocusRequest } from '../tabs/actions';
import { tabsState } from '../tabs/tabs';
import {
  MISMATCH_ERROR,
  NEW_PASSPHRASE_HINT,
  newPassphraseError,
  TOO_SHORT_ERROR,
  PassphraseInput,
  ShowPassphraseToggle,
} from './PassphraseInput';
import { resetVault, setupVault, unlockVault, type VaultState } from './vault';

/**
 * Schermate senza note: apertura, creazione della passphrase, sblocco, errori. Stanno nel
 * pacchetto iniziale e non importano nulla dell'area delle note (lazyWorkspace.ts).
 */
export function VaultFrame({ children }: { children: ComponentChildren }) {
  return (
    <div class="app vault-app">
      <header class="bar">
        <span class="logo">
          <span class="logo-mark" aria-hidden="true" />
          <span class="logo-text">Notepad−−</span>
        </span>
        <span class="badge" title="Le note restano in questo browser e non vengono inviate in rete">
          <DeviceIcon />
          <span>Solo su questo dispositivo</span>
        </span>
      </header>
      <main class="workspace vault">{children}</main>
    </div>
  );
}

export function VaultScreen({ state }: { state: Exclude<VaultState, { status: 'unlocked' }> }) {
  return (
    <VaultFrame>
      {state.status === 'opening' && (
        <>
          {!state.message && <p class="workspace-message">Apertura delle note…</p>}
          {/* Regione viva montata vuota: i messaggi di attesa (lento, bloccato) si annunciano. */}
          <p class="workspace-message" role="status">
            {state.message ?? ''}
          </p>
        </>
      )}
      {state.status === 'error' && (
        <div class="workspace-message" role="alert">
          <h1>Impossibile aprire le note</h1>
          <p>{state.message}</p>
          {state.canReset && <ForgotPassphrase />}
        </div>
      )}
      {state.status === 'setup' && <SetupForm legacy={state.legacy} />}
      {state.status === 'locked' && <UnlockForm message={state.message} />}
    </VaultFrame>
  );
}

/** Dopo lo sblocco si torna a scrivere nella nota attiva. */
function focusActiveNote(): void {
  const { active } = tabsState.value;
  if (active !== null) editorFocusRequest.value = { id: active };
}

function SetupForm({ legacy }: { legacy: boolean }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    const invalid = newPassphraseError(passphrase, confirmation);
    if (invalid) {
      setError(invalid);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    // L'area delle note si scarica mentre PBKDF2 lavora.
    void loadWorkspace();
    const result = await setupVault(passphrase);
    setBusy(false);
    if (result === 'ok') {
      setPassphrase('');
      setConfirmation('');
      focusActiveNote();
    } else if (result === 'invalid') {
      setError(TOO_SHORT_ERROR);
    } else if (result === 'error') {
      setError('Non è stato possibile creare la passphrase. Ricarica la pagina e riprova.');
    }
    // 'exists' e 'locked': la schermata di sblocco spiega cosa è successo.
  };

  return (
    <section class="vault-card" aria-labelledby="vault-title">
      <LockIcon size={28} class="vault-icon" />
      <h1 id="vault-title">Proteggi le tue note</h1>
      <p>
        Scegli una passphrase: cifra le note salvate in questo browser e ti servirà per aprirle ogni
        volta.
      </p>
      {legacy && <p class="vault-info">Le note già presenti verranno cifrate.</p>}
      <form class="vault-form" onSubmit={(e) => void onSubmit(e)}>
        <PassphraseInput
          id="new-passphrase"
          label="Passphrase"
          value={passphrase}
          onInput={setPassphrase}
          autocomplete="new-password"
          shown={shown}
          busy={busy}
          inputRef={inputRef}
          describedBy="new-passphrase-hint setup-error"
          invalid={error !== null && error !== MISMATCH_ERROR}
        />
        <p id="new-passphrase-hint" class="hint">
          {NEW_PASSPHRASE_HINT}
        </p>
        <PassphraseInput
          id="confirm-passphrase"
          label="Ripeti la passphrase"
          value={confirmation}
          onInput={setConfirmation}
          autocomplete="new-password"
          shown={shown}
          busy={busy}
          describedBy="setup-error"
          invalid={error === MISMATCH_ERROR}
        />
        <ShowPassphraseToggle
          shown={shown}
          onToggle={() => setShown((s) => !s)}
          controls="new-passphrase confirm-passphrase"
        />
        <p class="vault-warning">
          Non c’è modo di recuperarla: se dimentichi la passphrase, le note sono perse.
        </p>
        <p id="setup-error" class="form-error" role="alert">
          {error ?? ''}
        </p>
        <button type="submit" class="primary" disabled={busy}>
          {busy ? 'Cifratura…' : 'Crea la passphrase'}
        </button>
      </form>
    </section>
  );
}

function UnlockForm({ message }: { message: string | undefined }) {
  const [passphrase, setPassphrase] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (busy || passphrase === '') return;
    setBusy(true);
    setError(null);
    void loadWorkspace();
    const result = await unlockVault(passphrase);
    setBusy(false);
    if (result === 'ok') {
      setPassphrase('');
      focusActiveNote();
      return;
    }
    // Bloccate di nuovo mentre si apriva (Alt+L, un'altra scheda): il motivo è già sotto il campo.
    if (result === 'locked') return;
    setError(
      result === 'wrong'
        ? 'Passphrase errata'
        : 'Non è stato possibile sbloccare le note. Ricarica la pagina e riprova.',
    );
    // Il testo resta, selezionato: si riscrive subito o si corregge.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  return (
    <section class="vault-card" aria-labelledby="vault-title">
      <LockIcon size={28} class="vault-icon" />
      <h1 id="vault-title">Note bloccate</h1>
      {/* Il motivo del blocco descrive il campo, che prende il focus: lo si sente subito. */}
      {message && (
        <p id="unlock-reason" class="vault-info">
          {message}
        </p>
      )}
      <form class="vault-form" onSubmit={(e) => void onSubmit(e)}>
        <PassphraseInput
          id="unlock-passphrase"
          label="Passphrase"
          value={passphrase}
          onInput={setPassphrase}
          autocomplete="current-password"
          shown={shown}
          busy={busy}
          inputRef={inputRef}
          invalid={error !== null}
          describedBy={message ? 'unlock-reason unlock-error' : 'unlock-error'}
        />
        <ShowPassphraseToggle
          shown={shown}
          onToggle={() => setShown((s) => !s)}
          controls="unlock-passphrase"
        />
        <p id="unlock-error" class="form-error" role="alert">
          {error ?? ''}
        </p>
        <button type="submit" class="primary" disabled={busy}>
          {busy ? 'Sblocco…' : 'Sblocca'}
        </button>
      </form>
      <ForgotPassphrase disabled={busy} />
    </section>
  );
}

/** Senza passphrase si può solo ricominciare: conferma scrivendo ELIMINA. */
function ForgotPassphrase({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class="link-button forgot"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Ho dimenticato la passphrase
      </button>
      {open && (
        <ConfirmDialog
          id="reset"
          title="Eliminare tutte le note?"
          confirmLabel="Elimina tutte le note"
          busyLabel="Eliminazione…"
          requireText="ELIMINA"
          onConfirm={async (report) => {
            const done = await resetVault(() =>
              report('Chiudi le altre schede di Notepad−− per completare l’eliminazione.'),
            );
            return done ? null : 'Non è stato possibile eliminare le note. Ricarica e riprova.';
          }}
          onClose={(confirmed) => {
            setOpen(false);
            if (!confirmed) focusAfterModal(() => buttonRef.current);
          }}
        >
          <p>
            Senza la passphrase le note cifrate non si possono leggere, da nessuno. Puoi solo
            eliminarle tutte da questo browser e ricominciare con una passphrase nuova.
          </p>
          <p>L’eliminazione è definitiva.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
