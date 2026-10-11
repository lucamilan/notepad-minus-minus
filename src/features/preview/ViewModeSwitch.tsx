import type { JSX } from 'preact';
import { ColumnsIcon, EyeIcon, LiveIcon, PenIcon } from '../../app/icons';
import { viewMode, type ViewMode } from './viewMode';

const OPTIONS: readonly {
  mode: ViewMode;
  label: string;
  hint?: string;
  icon: () => JSX.Element;
}[] = [
  { mode: 'edit', label: 'Modifica', icon: () => <PenIcon /> },
  {
    mode: 'live',
    label: 'Dal vivo',
    hint: 'Dal vivo: il Markdown formattato mentre scrivi',
    icon: () => <LiveIcon />,
  },
  { mode: 'split', label: 'Affiancata', icon: () => <ColumnsIcon /> },
  { mode: 'preview', label: 'Anteprima', icon: () => <EyeIcon /> },
];

/** Pulsanti a interruttore (aria-pressed): uno solo è premuto, Ctrl+E passa al successivo. */
export function ViewModeSwitch() {
  const current = viewMode.value;
  return (
    <div
      class="mode-switch"
      role="group"
      aria-label="Modalità di visualizzazione"
      aria-keyshortcuts="Control+E Meta+E"
    >
      {OPTIONS.map(({ mode, label, hint, icon }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={current === mode}
          title={`${hint ?? label} (Ctrl+E per cambiare)`}
          onClick={() => (viewMode.value = mode)}
        >
          {icon()}
          <span class="mode-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
