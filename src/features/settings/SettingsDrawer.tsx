import { useEffect, useRef } from 'preact/hooks';
import { themePreference, type ThemePreference } from './theme';

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
      </div>
    </dialog>
  );
}
