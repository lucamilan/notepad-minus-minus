import { batch, signal, useComputed } from '@preact/signals';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyFilter } from '../features/collection/actions';
import { Collection } from '../features/collection/Collection';
import { DeleteDialog, NoteBar } from '../features/collection/NoteBar';
import {
  deleteRequest,
  narrowScreen,
  showSidebar,
  sidebarOverlayOpen,
  sidebarVisible,
  toggleSidebar,
} from '../features/collection/state';
import { tagCompletion } from '../features/collection/tagCompletion';
import { tagCounts } from '../features/collection/tags';
import { recordActivity } from '../features/crypto/autoLock';
import { lockVault } from '../features/crypto/vault';
import { noteRevisions } from '../features/notes/crossTab';
import { SearchDialog } from '../features/search/SearchDialog';
import { openSearch, searchRequest } from '../features/search/state';
import { Editor, type EditorFocus } from '../features/editor/Editor';
import { noteTitle, sortNotes, type Note } from '../features/notes/note';
import { editNote, flushSaves, saveStatus, type SaveStatus } from '../features/notes/autosave';
import { notesState } from '../features/notes/store';
import { Preview } from '../features/preview/Preview';
import { nextViewMode, viewMode } from '../features/preview/viewMode';
import { SettingsDrawer } from '../features/settings/SettingsDrawer';
import {
  actionError,
  closeActiveTab,
  createNoteInNewTab,
  cycleTabKeepingEditorFocus,
  isRepeatedClick,
  editorFocusRequest,
  focusTabs,
  openTab,
} from '../features/tabs/actions';
import { NOTE_PANEL_ID, noteTooltip, TabBar, tabElementId } from '../features/tabs/TabBar';
import { tabsState } from '../features/tabs/tabs';
import { formatDateTime, formatTime } from '../lib/format';
import { AppBar } from './AppBar';
import { InfoIcon } from './icons';

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Lettera della scorciatoia: quella stampata sul tasto (e.key), così su AZERTY Alt+W è
 * davvero il tasto W; per tastiere non latine o tasti morti (Option su macOS) si ricade
 * sulla posizione fisica (e.code).
 */
function shortcutLetter(e: KeyboardEvent): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  return /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : '';
}

/** Messaggio per i lettori di schermo dopo Ctrl+S (lo stato normale non viene annunciato). */
const announcement = signal('');

/** Svuota e poi riscrive: due Ctrl+S nello stesso minuto vengono annunciati entrambi. */
function announce(message: string): void {
  announcement.value = '';
  setTimeout(() => (announcement.value = message), 100);
}

function saveStatusText(status: SaveStatus): string {
  switch (status.state) {
    case 'saved':
      return status.at === null ? 'Salvato nel browser' : `Salvato alle ${formatTime(status.at)}`;
    case 'pending':
      return 'Modifiche non salvate';
    case 'saving':
      return 'Salvataggio…';
    case 'held':
      return 'In attesa: scegli quale versione tenere';
    case 'error':
      return status.message;
  }
}

/** La nota della scheda attiva, se l'archivio è pronto e c'è una scheda aperta. */
function activeNote(): Note | undefined {
  const state = notesState.value;
  const { active } = tabsState.value;
  if (state.status !== 'ready' || active === null) return undefined;
  return state.notes.find((note) => note.id === active);
}

/**
 * Tutto ciò che si vede con le note sbloccate. Si carica con import() dopo lo sblocco
 * (lazyWorkspace.ts): le schermate di blocco non scaricano CodeMirror, markdown-it,
 * DOMPurify né la raccolta.
 */
export function Workspace() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasSettingsOpen = useRef(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Quando il pannello si chiude il focus torna al pulsante "Altro" da cui era stato aperto.
  useEffect(() => {
    if (wasSettingsOpen.current && !settingsOpen) menuButtonRef.current?.focus();
    wasSettingsOpen.current = settingsOpen;
  }, [settingsOpen]);

  // Ctrl+S e Alt+L sempre, anche con un pannello aperto: Ctrl+S altrimenti farebbe salvare la
  // pagina al browser, e bloccare deve funzionare ovunque.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && shortcutLetter(e) === 'l') {
        e.preventDefault();
        if (!e.repeat) void lockVault('manual');
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || shortcutLetter(e) !== 's') return;
      e.preventDefault();
      if (e.repeat) return;
      void flushSaves().then(() => {
        if (notesState.value.status !== 'ready') return;
        const status = saveStatus.value;
        // Gli errori li annuncia già il contenitore role="alert": niente doppioni.
        if (status.state === 'error') return;
        announce(
          status.state === 'saved'
            ? `Tutte le note salvate alle ${formatTime(status.at ?? Date.now())}`
            : 'Salvataggio in corso',
        );
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Un dialogo modale aperto (impostazioni, ricerca, eliminazione) rende inerte il resto.
  // Conta solo ciò che è davvero sullo schermo: se l'archivio si chiude mentre la ricerca è
  // aperta, il messaggio d'errore non deve restare inerte.
  const state = notesState.value;
  const ready = state.status === 'ready';
  const deleting = deleteRequest.value;
  const noteToDelete = ready ? state.notes.find((note) => note.id === deleting) : undefined;
  const search = ready ? searchRequest.value : null;
  const modalOpen = settingsOpen || search !== null || noteToDelete !== undefined;

  // Scorciatoie delle schede: solo con le note pronte e nessun pannello modale aperto.
  useEffect(() => {
    if (modalOpen) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const letter = shortcutLetter(e);
      const ctrlOnly = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
      // Ctrl+K: ricerca globale. Ctrl+\: mostra o nasconde la raccolta.
      if (ctrlOnly && letter === 'k' && notesState.value.status === 'ready') {
        e.preventDefault();
        if (!e.repeat) openSearch();
        return;
      }
      if (ctrlOnly && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        if (!e.repeat) toggleSidebar();
        return;
      }
      if (e.key === 'Escape' && narrowScreen.value && sidebarOverlayOpen.value) {
        e.preventDefault();
        sidebarOverlayOpen.value = false;
        return;
      }
      // Ctrl+E (Cmd+E su macOS): Modifica → Affiancata → Anteprima.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && letter === 'e') {
        e.preventDefault();
        if (!e.repeat) viewMode.value = nextViewMode(viewMode.value);
        return;
      }
      if (e.metaKey || notesState.value.status !== 'ready') return;
      const altOnly = e.altKey && !e.ctrlKey && !e.shiftKey;
      if (altOnly && letter === 'n') {
        // Tenendo premuto Alt+N la ripetizione del tasto non crea una nota dopo l'altra.
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        void createNoteInNewTab();
      } else if (altOnly && letter === 'w') {
        closeActiveTab();
        focusTabs();
      } else if (e.altKey && e.ctrlKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        cycleTabKeepingEditorFocus(e.key === 'ArrowRight' ? 1 : -1);
      } else {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modalOpen]);

  return (
    <div class="app">
      {/* Con un pannello modale aperto il resto è inerte in modo esplicito: showModal() da solo
          non esclude sempre dal Tab il contenuto nello shadow root dell'editor (Chromium). */}
      <div class="app-content" inert={modalOpen}>
        <AppBar menuButtonRef={menuButtonRef} onOpenSettings={openSettings} />
        <p class="notice" role="note">
          <InfoIcon />
          <span>
            Anteprima di sviluppo: le note sono cifrate con la tua passphrase e restano solo in
            questo browser. Se dimentichi la passphrase non si possono recuperare.
          </span>
        </p>
        <main class="workspace">
          <NotesArea />
        </main>
        <StatusBar />
      </div>
      <SaveAnnouncer />
      {settingsOpen && <SettingsDrawer onClose={closeSettings} />}
      {search && ready && <SearchDialog notes={state.notes} initialQuery={search.query} />}
      {noteToDelete && <DeleteDialog note={noteToDelete} />}
    </div>
  );
}

function NotesArea() {
  const state = notesState.value;
  if (state.status === 'loading') {
    return <p class="workspace-message">{state.message ?? 'Apertura delle note…'}</p>;
  }
  if (state.status === 'error') {
    return (
      <div class="workspace-message" role="alert">
        <h1>Impossibile aprire le note</h1>
        <p>{state.message}</p>
      </div>
    );
  }
  const unreadable = state.unreadable.length;
  const error = actionError.value;
  const note = activeNote();
  const revision = note ? (noteRevisions.value.get(note.id) ?? 0) : 0;
  const overlay = narrowScreen.value;
  const showCollection = sidebarVisible();
  return (
    <div class="workspace-body" data-collection={showCollection ? 'shown' : 'hidden'}>
      <CollectionFocus shown={showCollection} overlay={overlay} />
      {showCollection && <Collection notes={state.notes} />}
      {showCollection && overlay && (
        <div
          class="collection-scrim"
          aria-hidden="true"
          onClick={() => (sidebarOverlayOpen.value = false)}
        />
      )}
      {/* Su schermi stretti la raccolta copre le note: sotto, niente Tab né lettore di schermo. */}
      <div class="workspace-main" inert={showCollection && overlay}>
        {unreadable > 0 && (
          <p class="workspace-warning" role="status">
            {unreadable === 1
              ? '1 nota non si può leggere: è stata lasciata intatta nell’archivio.'
              : `${unreadable} note non si possono leggere: sono state lasciate intatte nell’archivio.`}
          </p>
        )}
        {error && (
          <p class="workspace-warning" role="alert">
            {error}
          </p>
        )}
        <TabBar notes={state.notes} />
        {note && <NoteBar note={note} />}
        {/* La revisione cambia quando si carica la versione di un'altra scheda: editor nuovo. */}
        {note ? (
          <NotePanel key={`${note.id}:${revision}`} note={note} />
        ) : (
          <NoOpenNotes notes={state.notes} />
        )}
      </div>
    </div>
  );
}

/**
 * Focus della raccolta: aperta come pannello sopra le note, il focus entra nel pannello;
 * chiusa (Esc, clic fuori, Ctrl+) con il focus dentro, torna sul pulsante "Raccolta".
 */
function CollectionFocus({ shown, overlay }: { shown: boolean; overlay: boolean }) {
  const wasShown = useRef(shown);
  useEffect(() => {
    if (wasShown.current === shown) return;
    wasShown.current = shown;
    if (shown && overlay) {
      document.querySelector<HTMLElement>('.collection .find')?.focus();
    } else if (!shown) {
      // Dopo il disegno: se si è aperta una nota dalla raccolta, il focus è già nel suo testo.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body || !document.activeElement) {
          document.querySelector<HTMLElement>('.sidebar-toggle')?.focus();
        }
      });
    }
  }, [shown, overlay]);
  return null;
}

/** Offset del primo carattere della riga `line` (0 = prima riga). */
function lineStart(text: string, line: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}

function NotePanel({ note }: { note: Note }) {
  const mode = viewMode.value;
  const panelRef = useRef<HTMLDivElement>(null);
  // I conteggi si leggono al momento del suggerimento: le note cambiano mentre si scrive.
  const extensions = useMemo(
    () => [
      tagCompletion(() => {
        const state = notesState.peek();
        return tagCounts(state.status === 'ready' ? state.notes : []);
      }),
    ],
    [],
  );
  // Le richieste di focus per questa nota: al montaggio (Alt+N, cambio scheda) e dopo
  // (doppio clic sull'anteprima). In sola anteprima l'editor è nascosto: va all'anteprima.
  const request = editorFocusRequest.value;
  const forThisNote = request?.id === note.id ? request : undefined;
  const editorFocus: EditorFocus | undefined =
    forThisNote && mode !== 'preview' ? forThisNote : undefined;
  const [previewFocus, setPreviewFocus] = useState<number | undefined>(() =>
    forThisNote && mode === 'preview' ? 1 : undefined,
  );

  // Consumata dopo che l'editor (figlio, effetti prima del genitore) l'ha applicata.
  useEffect(() => {
    if (!forThisNote) return;
    if (mode === 'preview') setPreviewFocus((n) => (n ?? 0) + 1);
    editorFocusRequest.value = null;
  }, [forThisNote]);

  // Cambiando modalità con Ctrl+E il focus resta nella nota: sull'editor se è visibile,
  // altrimenti sull'anteprima. Con un clic sui pulsanti il focus resta sul pulsante.
  const previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    // Un vecchio gettone non deve rubare il focus quando l'anteprima si rimonta.
    setPreviewFocus(undefined);
    const active = document.activeElement;
    const focusWasHere = active === document.body || panelRef.current?.contains(active);
    if (!focusWasHere) return;
    if (mode === 'preview') setPreviewFocus((n) => (n ?? 0) + 1);
    else editorFocusRequest.value = { id: note.id };
  }, [mode]);

  const editAt = (line: number | null) =>
    batch(() => {
      if (viewMode.value === 'preview') viewMode.value = 'edit';
      editorFocusRequest.value =
        line === null
          ? { id: note.id }
          : {
              id: note.id,
              selection: { anchor: lineStart(note.text, line), head: lineStart(note.text, line) },
            };
    });

  return (
    <div
      ref={panelRef}
      class="note-panel"
      data-mode={mode}
      role="tabpanel"
      id={NOTE_PANEL_ID}
      aria-labelledby={tabElementId(note.id)}
    >
      {/* L'editor resta montato anche quando è nascosto: niente perdita di annullamenti. */}
      <div class="note-editor" hidden={mode === 'preview'}>
        <Editor
          extensions={extensions}
          initialText={note.text}
          label="Testo della nota"
          focusRequest={editorFocus}
          onChange={(text) => {
            recordActivity();
            editNote(note.id, text);
          }}
        />
      </div>
      {mode !== 'edit' && (
        <Preview
          text={note.text}
          onRequestEdit={editAt}
          onTagClick={(tag) => {
            applyFilter({ view: 'all', tags: [tag] });
            showSidebar();
          }}
          focusToken={previewFocus}
        />
      )}
    </div>
  );
}

/** Nessuna scheda aperta: le note restano nell'archivio e da qui si riaprono. */
function NoOpenNotes({ notes }: { notes: readonly Note[] }) {
  return (
    <section class="empty" aria-labelledby="empty-title">
      <h2 id="empty-title">Nessuna nota aperta</h2>
      <p>Chiudere una scheda non elimina la nota: puoi riaprirla da qui o crearne una nuova.</p>
      <button
        type="button"
        class="primary"
        onClick={(e) => {
          if (!isRepeatedClick(e)) void createNoteInNewTab();
        }}
      >
        Nuova nota
      </button>
      {notes.length > 0 && (
        <ul class="reopen" aria-label="Note nell'archivio">
          {/* Ordinate qui, non a ogni tasto: modifiedAt cambia mentre si scrive. */}
          {sortNotes(notes).map((note) => (
            <li key={note.id}>
              <button
                type="button"
                title={noteTooltip(note)}
                onClick={() => {
                  openTab(note.id);
                  focusTabs();
                }}
              >
                <span class="reopen-title">{noteTitle(note.text)}</span>
                <span class="reopen-date">Creata il {formatDateTime(note.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBar() {
  // Passati come segnali nel JSX: la barra di stato non si ridisegna a ogni tasto, solo il testo.
  const stats = useComputed(() => {
    const note = activeNote();
    return note ? `${note.text.length} caratteri · ${countWords(note.text)} parole` : '';
  });
  const created = useComputed(() => {
    const note = activeNote();
    return note ? `Creata il ${formatDateTime(note.createdAt)}` : '';
  });
  return (
    <footer class="status">
      <SaveState />
      <span>{stats}</span>
      <span>{created}</span>
    </footer>
  );
}

/** Cambia a ogni pausa nella scrittura: si vede ma non si annuncia (lo fa SaveAnnouncer). */
function SaveState() {
  const status = saveStatus.value;
  return (
    <span class="save-state" data-state={status.state}>
      {saveStatusText(status)}
    </span>
  );
}

/**
 * Regioni live sempre montate, fuori dal contenuto reso inerte dai pannelli modali: così
 * Ctrl+S ed errori si sentono anche con le impostazioni aperte.
 */
function SaveAnnouncer() {
  const status = saveStatus.value;
  return (
    <>
      <div class="sr-only" aria-live="polite">
        {announcement}
      </div>
      <div class="sr-only" role="alert">
        {status.state === 'error' ? status.message : ''}
      </div>
    </>
  );
}
