import { useEffect, useRef } from 'preact/hooks';
import { formatDateTime } from '../../lib/format';
import { noteTitle, tabTitle, type Note } from '../notes/note';
import { CloseAllIcon, CloseUnpinnedIcon } from '../../app/icons';
import {
  closeAllTabs,
  closeTab,
  closeUnpinnedTabs,
  createNoteInNewTab,
  focusTabs,
  isRepeatedClick,
  openTab,
  tabFocusRequest,
  unpinnedTabIds,
} from './actions';
import { tabsState } from './tabs';

export const NOTE_PANEL_ID = 'note-panel';

export function tabElementId(noteId: string): string {
  return `tab-${noteId}`;
}

export function noteTooltip(note: Note): string {
  return `"${noteTitle(note.text)}" creata il ${formatDateTime(note.createdAt)}`;
}

/**
 * Schede secondo il pattern ARIA "tabs": una sola scheda nel giro del Tab, frecce/Home/End
 * per spostarsi (attivazione automatica), Canc per chiudere. Il pulsante × è solo per il
 * mouse (nascosto alle tecnologie assistive e fuori dal Tab): da tastiera si usa Canc o Alt+W.
 * In fondo, dopo "+ Nuova nota", "Chiudi le schede non fissate" e "Chiudi tutte le schede"
 * (Alt+Shift+W).
 */
export function TabBar({ notes }: { notes: readonly Note[] }) {
  const { open, active } = tabsState.value;
  const focusToken = tabFocusRequest.value;
  const handledToken = useRef(focusToken);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const byId = new Map(notes.map((note) => [note.id, note]));

  useEffect(() => {
    if (handledToken.current === focusToken) return;
    handledToken.current = focusToken;
    const target = active === null ? null : document.getElementById(tabElementId(active));
    (target ?? newButtonRef.current)?.focus();
  }, [focusToken, active]);

  // La scheda attiva resta visibile anche quando le schede non stanno nella barra (mobile).
  useEffect(() => {
    if (active === null) return;
    document
      .getElementById(tabElementId(active))
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const moveTo = (id: string | undefined) => {
    if (id === undefined) return;
    openTab(id);
    focusTabs();
  };

  const onKeyDown = (e: KeyboardEvent, id: string) => {
    const index = open.indexOf(id);
    if (e.key === 'ArrowRight') moveTo(open[(index + 1) % open.length]);
    else if (e.key === 'ArrowLeft') moveTo(open[(index - 1 + open.length) % open.length]);
    else if (e.key === 'Home') moveTo(open[0]);
    else if (e.key === 'End') moveTo(open[open.length - 1]);
    else if (e.key === 'Delete') {
      closeTab(id);
      focusTabs();
    } else return;
    e.preventDefault();
  };

  return (
    <div class="tabs">
      {open.length > 0 && (
        <div class="tablist" role="tablist" aria-label="Note aperte">
          {open.map((id) => {
            const note = byId.get(id);
            if (!note) return null;
            const selected = id === active;
            return (
              <div key={id} class={selected ? 'tab is-active' : 'tab'} role="presentation">
                <button
                  type="button"
                  role="tab"
                  id={tabElementId(id)}
                  class="tab-label"
                  aria-selected={selected}
                  aria-controls={selected ? NOTE_PANEL_ID : undefined}
                  aria-keyshortcuts="Delete Alt+W Control+Alt+ArrowLeft Control+Alt+ArrowRight"
                  tabIndex={selected ? 0 : -1}
                  title={noteTooltip(note)}
                  onClick={() => openTab(id)}
                  onKeyDown={(e) => onKeyDown(e, id)}
                  // Clic centrale: chiude. Il mousedown va fermato subito, altrimenti su Windows
                  // il browser avvia lo scorrimento automatico.
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    if (selected) focusTabs();
                    closeTab(id);
                  }}
                >
                  {tabTitle(note.text)}
                </button>
                <button
                  type="button"
                  class="tab-close"
                  tabIndex={-1}
                  aria-hidden="true"
                  title="Chiudi scheda (Alt+W). La nota resta nell'archivio."
                  // Il clic non sposta il focus: chi stava scrivendo in un'altra scheda resta lì.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (selected) focusTabs();
                    closeTab(id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        class="tab-new"
        ref={newButtonRef}
        title="Nuova nota (Alt+N)"
        aria-keyshortcuts="Alt+N"
        onClick={(e) => {
          if (!isRepeatedClick(e)) void createNoteInNewTab();
        }}
      >
        + Nuova nota
      </button>
      {/* Fuori dal tablist: non è una scheda. Senza schede aperte non serve. Lo spaziatore
          (almeno 24px) li tiene lontani da "+ Nuova nota", e 12px separano i due pulsanti tra loro:
          un clic sbagliato non chiude più del voluto. */}
      {open.length > 0 && <span class="tabs-spacer" aria-hidden="true" />}
      {open.length > 0 && (
        <button
          type="button"
          class="tab-close-all"
          title="Chiudi le schede non fissate"
          // Disattivato se tutte le schede aperte sono di note fissate: non chiuderebbe nulla.
          disabled={unpinnedTabIds().length === 0}
          onClick={() => {
            closeUnpinnedTabs();
            focusTabs();
          }}
        >
          <CloseUnpinnedIcon />
          <span class="sr-only">Chiudi le schede non fissate</span>
        </button>
      )}
      {open.length > 0 && (
        <button
          type="button"
          class="tab-close-all"
          title="Chiudi tutte le schede (Alt+Shift+W)"
          aria-keyshortcuts="Alt+Shift+W"
          onClick={() => {
            closeAllTabs();
            focusTabs();
          }}
        >
          <CloseAllIcon />
          <span class="sr-only">Chiudi tutte le schede</span>
        </button>
      )}
    </div>
  );
}
