import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { COLLECTION_ID } from '../features/collection/Collection';
import { sidebarVisible, toggleSidebar } from '../features/collection/state';
import { lockVault } from '../features/crypto/vault';
import { notesState } from '../features/notes/store';
import { ViewModeSwitch } from '../features/preview/ViewModeSwitch';
import { openSearch } from '../features/search/state';
import type { TransferKind } from '../features/transfer/TransferDialog';
import { DeviceIcon, LockIcon, MoreIcon, SearchIcon, SidebarIcon } from './icons';

interface AppBarProps {
  menuButtonRef: RefObject<HTMLButtonElement>;
  onOpenSettings: () => void;
  onOpenTransfer: (kind: TransferKind) => void;
}

const MENU_ID = 'app-menu';

// Menu secondo il pattern ARIA "menu button": all'apertura il focus va sulla prima voce,
// frecce/Home/End per muoversi, Escape chiude e riporta il focus al pulsante.
export function AppBar({ menuButtonRef, onOpenSettings, onOpenTransfer }: AppBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ready = notesState.value.status === 'ready';
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
      {ready && (
        <button
          type="button"
          class="icon-button plain sidebar-toggle"
          aria-label="Raccolta"
          aria-expanded={sidebarVisible()}
          aria-controls={sidebarVisible() ? COLLECTION_ID : undefined}
          aria-keyshortcuts="Control+\"
          title="Mostra o nascondi la raccolta (Ctrl+\)"
          onClick={toggleSidebar}
        >
          <SidebarIcon />
        </button>
      )}
      <span class="logo">
        <span class="logo-mark" aria-hidden="true" />
        <span class="logo-text">Notepad−−</span>
      </span>
      <span class="badge" title="Le note restano in questo browser e non vengono inviate in rete">
        <DeviceIcon />
        <span>Solo su questo dispositivo</span>
      </span>
      <span class="spacer" />
      {ready && (
        <button
          type="button"
          class="icon-button"
          aria-keyshortcuts="Control+K"
          title="Cerca in tutte le note (Ctrl+K)"
          onClick={() => openSearch()}
        >
          <SearchIcon />
          <span class="bar-label">Cerca</span>
        </button>
      )}
      <ViewModeSwitch />
      <button
        type="button"
        class="icon-button lock-button"
        aria-keyshortcuts="Alt+L"
        title="Blocca le note in tutte le schede (Alt+L)"
        onClick={() => void lockVault('manual')}
      >
        <LockIcon />
        <span class="bar-label">Blocca</span>
      </button>
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
            {ready && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenTransfer('export');
                  }}
                >
                  Esporta note…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenTransfer('import');
                  }}
                >
                  Importa note…
                </button>
              </>
            )}
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
