import { batch, useComputed } from '@preact/signals';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyFilter } from '../features/collection/actions';
import { Collection } from '../features/collection/Collection';
import { DeleteDialog, ElsewhereNotice, NoteBar } from '../features/collection/NoteBar';
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
  closeAllTabs,
  createNoteInNewTab,
  cycleTabKeepingEditorFocus,
  isRepeatedClick,
  editorFocusRequest,
  focusTabs,
  openTab,
} from '../features/tabs/actions';
import { NOTE_PANEL_ID, noteTooltip, TabBar, tabElementId } from '../features/tabs/TabBar';
import { tabsState } from '../features/tabs/tabs';
import { TransferDialog, type TransferKind } from '../features/transfer/TransferDialog';
import { toggleZenFromButton } from '../features/zen/actions';
import { exitZen, toggleZen, zenMode } from '../features/zen/zen';
import { announcement, announce } from '../lib/announce';
import { deepActiveElement, focusAfterModal } from '../lib/focus';
import { formatDateTime, formatTime } from '../lib/format';
import { AppBar } from './AppBar';
import { SearchIcon, ZenIcon } from './icons';

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

/** Zen vale solo con una nota aperta: senza, si torna all'area delle note normale. */
function zenActive(): boolean {
  return zenMode.value && activeNote() !== undefined;
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
  // Esportazione o importazione (F8): dal menu "Altro" o dalle impostazioni.
  const [transfer, setTransfer] = useState<TransferKind | null>(null);
  const transferOpener = useRef<Element | null>(null);
  const openTransfer = useCallback((kind: TransferKind) => {
    transferOpener.current = deepActiveElement();
    setTransfer(kind);
  }, []);
  const closeTransfer = useCallback(() => {
    setTransfer(null);
    // Dal menu la voce non c'è più: il focus torna sul pulsante "Altro".
    const opener = transferOpener.current;
    transferOpener.current = null;
    focusAfterModal(() => (opener?.isConnected ? opener : menuButtonRef.current));
  }, []);

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
  const transferOpen = ready ? transfer : null;
  // Archivio chiuso (aggiornamento da un'altra scheda, errore): il dialogo non torna da solo
  // quando le note si riaprono.
  useEffect(() => {
    if (!ready) setTransfer(null);
  }, [ready]);
  const modalOpen =
    settingsOpen || search !== null || noteToDelete !== undefined || transferOpen !== null;
  const zen = zenActive();

  // Zen senza più una nota (scheda chiusa, archivio chiuso): si esce, e il focus va alle schede
  // che ricompaiono. Al blocco l'area delle note si smonta: si esce anche dallo schermo intero.
  useEffect(() => {
    if (!zenMode.value || zen) return;
    exitZen();
    requestAnimationFrame(focusTabs);
  }, [zen]);
  useEffect(() => () => exitZen(), []);

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
        // In zen la raccolta non c'è.
        if (!e.repeat && !zenMode.value) toggleSidebar();
        return;
      }
      // Esc esce da zen. Con lo schermo intero il primo Esc lo prende il browser per uscirne;
      // quelli già usati dall'editor (suggerimenti dei tag) arrivano con defaultPrevented.
      if (e.key === 'Escape' && zenMode.value) {
        e.preventDefault();
        exitZen();
        return;
      }
      if (e.key === 'Escape' && narrowScreen.value && sidebarOverlayOpen.value) {
        e.preventDefault();
        sidebarOverlayOpen.value = false;
        return;
      }
      // Ctrl+E (Cmd+E su macOS): Modifica → Dal vivo → Affiancata → Anteprima.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && letter === 'e') {
        e.preventDefault();
        if (!e.repeat) viewMode.value = nextViewMode(viewMode.value);
        return;
      }
      if (e.metaKey || notesState.value.status !== 'ready') return;
      const altOnly = e.altKey && !e.ctrlKey && !e.shiftKey;
      if (altOnly && letter === 'z') {
        // Alt+Z: modalità zen, solo con una nota aperta.
        if (!e.repeat && (zenMode.value || activeNote())) toggleZen();
      } else if (altOnly && letter === 'n') {
        // Tenendo premuto Alt+N la ripetizione del tasto non crea una nota dopo l'altra.
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        void createNoteInNewTab();
      } else if (altOnly && letter === 'w') {
        closeActiveTab();
        // In zen le schede non si vedono: si continua a scrivere nella nota che resta attiva.
        const { active } = tabsState.value;
        if (zenMode.value && active !== null) editorFocusRequest.value = { id: active };
        else focusTabs();
      } else if (e.altKey && e.shiftKey && !e.ctrlKey && letter === 'w') {
        // Alt+Shift+W: chiude tutte le schede. Nessuna conferma: le note restano nell'archivio.
        closeAllTabs();
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
    <div class="app" data-zen={zen ? '' : undefined}>
      {/* Con un pannello modale aperto il resto è inerte in modo esplicito: showModal() da solo
          non esclude sempre dal Tab il contenuto nello shadow root dell'editor (Chromium). */}
      <div class="app-content" inert={modalOpen}>
        {!zen && (
          <AppBar
            menuButtonRef={menuButtonRef}
            onOpenSettings={openSettings}
            onOpenTransfer={openTransfer}
          />
        )}
        <main class="workspace">
          <NotesArea zen={zen} />
        </main>
        {zen ? <ZenBar /> : <StatusBar />}
      </div>
      <SaveAnnouncer />
      {settingsOpen && <SettingsDrawer onClose={closeSettings} onOpenTransfer={openTransfer} />}
      {search && ready && <SearchDialog notes={state.notes} initialQuery={search.query} />}
      {noteToDelete && <DeleteDialog note={noteToDelete} />}
      {transferOpen && (
        <TransferDialog key={transferOpen} kind={transferOpen} onClose={closeTransfer} />
      )}
    </div>
  );
}

function NotesArea({ zen }: { zen: boolean }) {
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
  const showCollection = !zen && sidebarVisible();
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
        {!zen && <TabBar notes={state.notes} />}
        {/* In zen resta solo l'avviso tra schede del browser, che aspetta una scelta. */}
        {note && (zen ? <ElsewhereNotice id={note.id} /> : <NoteBar note={note} />)}
        {/* La revisione cambia quando si carica la versione di un'altra scheda: editor nuovo. */}
        {note ? (
          <NotePanel key={`${note.id}:${revision}`} note={note} zen={zen} />
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

function NotePanel({ note, zen }: { note: Note; zen: boolean }) {
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
          gutters={!zen}
          live={mode === 'live'}
          focusRequest={editorFocus}
          onChange={(text) => {
            recordActivity();
            editNote(note.id, text);
          }}
        />
      </div>
      {(mode === 'split' || mode === 'preview') && (
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

/** Note riaperte dalla pagina "Nessuna nota aperta": le più recenti. */
const REOPEN_MAX = 50;

/** Nessuna scheda aperta: le note restano nell'archivio e da qui si riaprono. */
function NoOpenNotes({ notes }: { notes: readonly Note[] }) {
  // Con migliaia di note la pagina resterebbe lenta: solo le più recenti, il resto con Cerca.
  const recent = sortNotes(notes).slice(0, REOPEN_MAX);
  const hidden = notes.length - recent.length;
  return (
    <section class="empty" aria-labelledby="empty-title">
      <h2 id="empty-title">Nessuna nota aperta</h2>
      <p>Chiudere una scheda non elimina la nota: puoi riaprirla da qui o crearne una nuova.</p>
      <div class="empty-actions">
        <button
          type="button"
          class="primary"
          aria-keyshortcuts="Alt+N"
          onClick={(e) => {
            if (!isRepeatedClick(e)) void createNoteInNewTab();
          }}
        >
          Nuova nota
        </button>
        <button
          type="button"
          class="small-button"
          aria-keyshortcuts="Control+K"
          onClick={() => openSearch()}
        >
          <SearchIcon />
          <span>Cerca nelle note (Ctrl+K)</span>
        </button>
      </div>
      {notes.length > 0 && (
        <ul class="reopen" aria-label="Note nell'archivio">
          {/* Ordinate qui, non a ogni tasto: modifiedAt cambia mentre si scrive. */}
          {recent.map((note) => (
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
      {hidden > 0 && (
        <p class="reopen-more">
          {hidden === 1 ? 'e un’altra' : `e altre ${hidden}`}: usa Cerca nelle note
        </p>
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

/**
 * Barra della modalità zen, in alto a destra: si vede passandoci sopra o con il focus dentro,
 * sempre se il salvataggio ha un problema o aspetta una scelta.
 */
function ZenBar() {
  const words = useComputed(() => {
    const note = activeNote();
    return note ? `${countWords(note.text)} parole` : '';
  });
  const status = saveStatus.value.state;
  return (
    <footer
      class="zen-bar"
      data-alert={status === 'error' || status === 'held' ? '' : undefined}
      aria-label="Modalità zen"
    >
      <SaveState />
      <span class="zen-words">{words}</span>
      <button
        type="button"
        class="small-button"
        aria-keyshortcuts="Alt+Z Escape"
        title="Torna alla vista normale (Alt+Z o Esc)"
        onClick={toggleZenFromButton}
      >
        <ZenIcon />
        <span>Esci da zen</span>
      </button>
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
