import { useComputed } from '@preact/signals';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '../features/editor/Editor';
import { noteTitle, type Note } from '../features/notes/note';
import { notesState, updateNoteText } from '../features/notes/store';
import { SettingsDrawer } from '../features/settings/SettingsDrawer';
import {
  actionError,
  closeActiveTab,
  createNoteInNewTab,
  cycleTabKeepingEditorFocus,
  editorFocusRequest,
  focusTabs,
  openTab,
} from '../features/tabs/actions';
import { NOTE_PANEL_ID, noteTooltip, TabBar, tabElementId } from '../features/tabs/TabBar';
import { tabsState } from '../features/tabs/tabs';
import { formatDateTime } from '../lib/format';
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

/** La nota della scheda attiva, se l'archivio è pronto e c'è una scheda aperta. */
function activeNote(): Note | undefined {
  const state = notesState.value;
  const { active } = tabsState.value;
  if (state.status !== 'ready' || active === null) return undefined;
  return state.notes.find((note) => note.id === active);
}

export function App() {
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

  // Scorciatoie delle schede: solo con le note pronte e nessun pannello modale aperto.
  useEffect(() => {
    if (settingsOpen) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || notesState.value.status !== 'ready') return;
      const altOnly = e.altKey && !e.ctrlKey && !e.shiftKey;
      const letter = shortcutLetter(e);
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
  }, [settingsOpen]);

  return (
    <div class="app">
      {/* Con un pannello modale aperto il resto è inerte in modo esplicito: showModal() da solo
          non esclude sempre dal Tab il contenuto nello shadow root dell'editor (Chromium). */}
      <div class="app-content" inert={settingsOpen}>
        <AppBar menuButtonRef={menuButtonRef} onOpenSettings={openSettings} />
        <p class="notice" role="note">
          <InfoIcon />
          <span>
            Anteprima di sviluppo: note nuove e schede aperte restano nell'archivio del browser, ma
            le modifiche al testo non vengono ancora salvate e si perdono quando chiudi o ricarichi
            la pagina.
          </span>
        </p>
        <main class="workspace">
          <Workspace />
        </main>
        <StatusBar />
      </div>
      {settingsOpen && <SettingsDrawer onClose={closeSettings} />}
    </div>
  );
}

function Workspace() {
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
  return (
    <>
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
      {note ? <NotePanel key={note.id} note={note} /> : <NoOpenNotes notes={state.notes} />}
    </>
  );
}

function NotePanel({ note }: { note: Note }) {
  // La richiesta di focus vale solo per l'editor che si monta adesso, poi si consuma.
  const request = editorFocusRequest.peek();
  const focus = request?.id === note.id ? request : undefined;
  useEffect(() => {
    if (editorFocusRequest.peek()?.id === note.id) editorFocusRequest.value = null;
  }, [note.id]);

  return (
    <div
      class="note-panel"
      role="tabpanel"
      id={NOTE_PANEL_ID}
      aria-labelledby={tabElementId(note.id)}
    >
      <Editor
        initialText={note.text}
        label="Testo della nota"
        autoFocus={focus !== undefined}
        initialSelection={focus?.selection}
        onChange={(text) => updateNoteText(note.id, text)}
      />
    </div>
  );
}

/** Nessuna scheda aperta: le note restano nell'archivio e da qui si riaprono. */
function NoOpenNotes({ notes }: { notes: readonly Note[] }) {
  return (
    <section class="empty" aria-labelledby="empty-title">
      <h2 id="empty-title">Nessuna nota aperta</h2>
      <p>Chiudere una scheda non elimina la nota: puoi riaprirla da qui o crearne una nuova.</p>
      <button type="button" class="primary" onClick={() => void createNoteInNewTab()}>
        Nuova nota
      </button>
      {notes.length > 0 && (
        <ul class="reopen" aria-label="Note nell'archivio">
          {notes.map((note) => (
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
  // Cambia solo aprendo o chiudendo l'ultima scheda, non a ogni tasto.
  const hasNote = useComputed(() => activeNote() !== undefined);
  const created = useComputed(() => {
    const note = activeNote();
    return note ? `Creata il ${formatDateTime(note.createdAt)}` : '';
  });
  return (
    <footer class="status">
      {hasNote.value && <span class="unsaved">Modifiche non salvate</span>}
      <span>{stats}</span>
      <span>{created}</span>
    </footer>
  );
}
