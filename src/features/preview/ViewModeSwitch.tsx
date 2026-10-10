import type { JSX } from 'preact';
import { ColumnsIcon, EyeIcon, PenIcon } from '../../app/icons';
import { viewMode, type ViewMode } from './viewMode';

const OPTIONS: readonly { mode: ViewMode; label: string; icon: () => JSX.Element }[] = [
  { mode: 'edit', label: 'Modifica', icon: () => <PenIcon /> },
  { mode: 'split', label: 'Affiancata', icon: () => <ColumnsIcon /> },
  { mode: 'preview', label: 'Anteprima', icon: () => <EyeIcon /> },
];

/** Pulsanti a interruttore (aria-pressed): uno solo è premuto, Ctrl+E passa al successivo. */
export function ViewModeSwitch() {
  const current = viewMode.value;
  return (
    <div class="mode-switch" role="group" aria-label="Modalità di visualizzazione">
      {OPTIONS.map(({ mode, label, icon }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={current === mode}
          aria-keyshortcuts="Control+E"
          title={`${label} (Ctrl+E per cambiare)`}
          onClick={() => (viewMode.value = mode)}
        >
          {icon()}
          <span class="mode-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
