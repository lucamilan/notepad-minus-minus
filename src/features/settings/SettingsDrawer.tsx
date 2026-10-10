import { useEffect, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../../app/ConfirmDialog';
import { focusAfterModal } from '../../lib/focus';
import { AUTO_LOCK_OPTIONS, autoLockMinutes, isAutoLockMinutes } from '../crypto/autoLock';
import { ChangePassphraseDialog } from '../crypto/ChangePassphraseDialog';
import { deleteLegacyLeftover, legacyLeftover } from '../crypto/legacy';
import { lockVault } from '../crypto/vault';
import { themePreference, type ThemePreference } from './theme';
import { deleteV1Data, v1DataExists } from './v1Data';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Chiaro' },
  { value: 'dark', label: 'Scuro' },
];

interface SettingsDrawerProps {
  onClose: () => void;
}

// <dialog> nativo aperto con showModal(): il resto della pagina diventa inerte (Tab resta
// nel pannello) ed Escape genera "cancel". Il focus al chiudere lo riporta chi apre il pannello.
export function SettingsDrawer({ onClose }: SettingsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      class="drawer"
      aria-labelledby="settings-title"
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        // Un clic sullo sfondo arriva al <dialog> stesso, non al suo contenuto.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div class="drawer-body">
        <header>
          <h2 id="settings-title">Impostazioni</h2>
          <button class="ghost" type="button" autofocus onClick={() => onCloseRef.current()}>
            Chiudi
          </button>
        </header>
        <section class="drawer-group">
          <fieldset class="choice">
            <legend>Tema</legend>
            <div class="seg">
              {THEME_OPTIONS.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={themePreference.value === option.value}
                    onChange={() => (themePreference.value = option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p class="hint">"Sistema" segue l'impostazione chiaro/scuro del computer.</p>
        </section>
        <SecuritySettings />
        <LegacyLeftoverSettings />
        <V1DataSettings />
      </div>
    </dialog>
  );
}

/** Blocco, blocco automatico e cambio passphrase. */
function SecuritySettings() {
  const [changing, setChanging] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  return (
    <section class="drawer-group" aria-labelledby="security-title">
      <h3 id="security-title" class="group-title">
        Sicurezza
      </h3>
      <div class="drawer-row">
        <button type="button" class="ghost" onClick={() => void lockVault('manual')}>
          Blocca ora
        </button>
        <span class="hint">Alt+L, in tutte le schede aperte.</span>
      </div>
      <label class="drawer-field">
        <span>Blocco automatico dopo</span>
        <select
          value={String(autoLockMinutes.value)}
          onChange={(e) => {
            const minutes = Number(e.currentTarget.value);
            if (isAutoLockMinutes(minutes)) autoLockMinutes.value = minutes;
          }}
        >
          {AUTO_LOCK_OPTIONS.map((minutes) => (
            <option key={minutes} value={String(minutes)}>
              {minutes} minuti
            </option>
          ))}
        </select>
      </label>
      <p class="hint">Senza attività per questo tempo la scheda si blocca da sola.</p>
      <div class="drawer-row">
        <button ref={changeRef} type="button" class="ghost" onClick={() => setChanging(true)}>
          Cambia passphrase…
        </button>
      </div>
      {changing && (
        <ChangePassphraseDialog
          onClose={() => {
            setChanging(false);
            focusAfterModal(() => changeRef.current);
          }}
        />
      )}
    </section>
  );
}

/** Le note della v1 restano in chiaro nel browser finché non le si elimina da qui. */
function V1DataSettings() {
  const [present, setPresent] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void v1DataExists().then((exists) => {
      if (active) setPresent(exists);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!present && !deleted) return null;
  return (
    <section class="drawer-group" aria-labelledby="v1-title">
      <h3 id="v1-title" class="group-title">
        Dati della versione precedente
      </h3>
      {deleted ? (
        <p class="hint" role="status">
          Dati della v1 eliminati.
        </p>
      ) : (
        <>
          <p class="hint">
            In questo browser ci sono ancora le note della prima versione di Notepad−−, salvate
            senza cifratura. Non vengono importate: se non ti servono più, eliminale.
          </p>
          <div class="drawer-row">
            <button
              ref={buttonRef}
              type="button"
              class="ghost danger-hover"
              onClick={() => setConfirming(true)}
            >
              Elimina i dati della v1…
            </button>
          </div>
        </>
      )}
      {confirming && (
        <ConfirmDialog
          id="v1-delete"
          title="Eliminare i dati della v1?"
          confirmLabel="Elimina"
          busyLabel="Eliminazione…"
          onConfirm={async (report) => {
            try {
              await deleteV1Data(() =>
                report('In attesa: chiudi le altre schede che usano la versione precedente.'),
              );
              return null;
            } catch (error) {
              console.error(error);
              return 'Non è stato possibile eliminare i dati della v1. Riprova.';
            }
          }}
          onClose={(confirmed) => {
            setConfirming(false);
            if (confirmed) setDeleted(true);
            // Il pulsante sparisce con i dati: il focus torna su "Chiudi" del pannello.
            focusAfterModal(() =>
              confirmed ? document.querySelector('.drawer header button') : buttonRef.current,
            );
          }}
        >
          <p>
            Le note della prima versione verranno cancellate da questo browser e non si potranno
            recuperare. Le note di questa versione non cambiano.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

/**
 * Record del vecchio archivio in chiaro (F2–F6) che non si sono potuti leggere né cifrare: il
 * database resta finché non lo si elimina da qui.
 */
function LegacyLeftoverSettings() {
  const count = legacyLeftover.value;
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (count === 0 && !deleted) return null;
  return (
    <section class="drawer-group" aria-labelledby="leftover-title">
      <h3 id="leftover-title" class="group-title">
        Note non cifrate rimaste (illeggibili)
      </h3>
      {deleted ? (
        <p class="hint" role="status">
          Vecchio archivio eliminato.
        </p>
      ) : (
        <>
          <p class="hint">
            {count === 1
              ? 'Nel vecchio archivio in chiaro resta 1 nota che non si è potuta leggere, quindi non è stata cifrata.'
              : `Nel vecchio archivio in chiaro restano ${count} note che non si sono potute leggere, quindi non sono state cifrate.`}{' '}
            Le altre note sono già cifrate.
          </p>
          <div class="drawer-row">
            <button
              ref={buttonRef}
              type="button"
              class="ghost danger-hover"
              onClick={() => setConfirming(true)}
            >
              Elimina il vecchio archivio…
            </button>
          </div>
        </>
      )}
      {confirming && (
        <ConfirmDialog
          id="leftover-delete"
          title="Eliminare il vecchio archivio?"
          confirmLabel="Elimina"
          busyLabel="Eliminazione…"
          onConfirm={async (report) => {
            try {
              await deleteLegacyLeftover(() =>
                report('In attesa: chiudi le altre schede con una versione precedente.'),
              );
              return null;
            } catch (error) {
              console.error(error);
              return 'Non è stato possibile eliminare il vecchio archivio. Riprova.';
            }
          }}
          onClose={(confirmed) => {
            setConfirming(false);
            if (confirmed) setDeleted(true);
            focusAfterModal(() =>
              confirmed ? document.querySelector('.drawer header button') : buttonRef.current,
            );
          }}
        >
          <p>
            Le note illeggibili rimaste in chiaro verranno cancellate da questo browser e non si
            potranno recuperare. Le note cifrate non cambiano.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
