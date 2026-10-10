import type { RefObject } from 'preact';
import { PASSPHRASE_MIN_LENGTH, passphraseLength } from './keys';

interface PassphraseInputProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  autocomplete: 'new-password' | 'current-password';
  /** Testo in chiaro (pulsante "Mostra"): vale per tutti i campi del modulo. */
  shown: boolean;
  busy: boolean;
  inputRef?: RefObject<HTMLInputElement> | null;
  describedBy?: string;
  invalid?: boolean;
}

export function PassphraseInput({
  id,
  label,
  value,
  onInput,
  autocomplete,
  shown,
  busy,
  inputRef = null,
  describedBy,
  invalid = false,
}: PassphraseInputProps) {
  return (
    <div class="vault-field">
      <label for={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={shown ? 'text' : 'password'}
        autocomplete={autocomplete}
        autoCapitalize="off"
        spellcheck={false}
        required
        readOnly={busy}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        value={value}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
    </div>
  );
}

/** Un solo interruttore per modulo, con aria-pressed: mostra o nasconde tutte le passphrase. */
export function ShowPassphraseToggle({
  shown,
  onToggle,
  controls,
}: {
  shown: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      class="small-button show-toggle"
      aria-pressed={shown}
      aria-controls={controls}
      onClick={onToggle}
    >
      Mostra la passphrase
    </button>
  );
}

export const TOO_SHORT_ERROR = `La passphrase deve avere almeno ${PASSPHRASE_MIN_LENGTH} caratteri.`;
export const MISMATCH_ERROR = 'Le due passphrase non coincidono.';

/** Errore di una nuova passphrase (creazione o cambio), o null se va bene. */
export function newPassphraseError(passphrase: string, confirmation: string): string | null {
  if (passphraseLength(passphrase) < PASSPHRASE_MIN_LENGTH) return TOO_SHORT_ERROR;
  if (passphrase.normalize('NFC') !== confirmation.normalize('NFC')) return MISMATCH_ERROR;
  return null;
}

export const NEW_PASSPHRASE_HINT = `Almeno ${PASSPHRASE_MIN_LENGTH} caratteri. Meglio una frase di 4 o più parole scelte a caso: lunga ma facile da ricordare per te.`;
