import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ViewModeSwitch } from '../features/preview/ViewModeSwitch';
import { DeviceIcon, MoreIcon } from './icons';

interface AppBarProps {
  menuButtonRef: RefObject<HTMLButtonElement>;
  onOpenSettings: () => void;
}

const MENU_ID = 'app-menu';

// Menu secondo il pattern ARIA "menu button": all'apertura il focus va sulla prima voce,
// frecce/Home/End per muoversi, Escape chiude e riporta il focus al pulsante.
export function AppBar({ menuButtonRef, onOpenSettings }: AppBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) menuButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return undefined;
    items()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [menuOpen]);

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(list.length - 1);
        break;
      case 'Escape':
        closeMenu(true);
        break;
      case 'Tab':
        closeMenu(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <header class="bar">
      <span class="logo">
        <span class="logo-mark" aria-hidden="true" />
        Notepad−−
      </span>
      <span class="badge" title="Le note restano in questo browser e non vengono inviate in rete">
        <DeviceIcon />
        <span>Solo su questo dispositivo</span>
      </span>
      <span class="spacer" />
      <ViewModeSwitch />
      <div
        class="menu-wrap"
        ref={wrapRef}
        onFocusOut={(e) => {
          if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setMenuOpen(false);
        }}
      >
        <button
          ref={menuButtonRef}
          class="icon-button"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? MENU_ID : undefined}
          aria-label="Altro"
          title="Altro"
          onClick={() => setMenuOpen((open) => !open)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !menuOpen) {
              e.preventDefault();
              setMenuOpen(true);
            }
          }}
        >
          <MoreIcon />
        </button>
        {menuOpen && (
          <div id={MENU_ID} class="menu" role="menu" ref={menuRef} onKeyDown={onMenuKeyDown}>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setMenuOpen(false);
                onOpenSettings();
              }}
            >
              Impostazioni
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
