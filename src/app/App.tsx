import { useComputed, useSignal } from '@preact/signals';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '../features/editor/Editor';
import type { Note } from '../features/notes/note';
import { notesState } from '../features/notes/store';
import { SettingsDrawer } from '../features/settings/SettingsDrawer';
import { AppBar } from './AppBar';
import { InfoIcon } from './icons';

const DATE_FORMAT = new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' });

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasSettingsOpen = useRef(false);
  const text = useSignal('');
  // Passati come segnali nel JSX: a ogni tasto si aggiorna solo il nodo di testo, non tutta l'app.
  const stats = useComputed(
    () => `${text.value.length} caratteri · ${countWords(text.value)} parole`,
  );
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Quando il pannello si chiude il focus torna al pulsante "Altro" da cui era stato aperto.
  useEffect(() => {
    if (wasSettingsOpen.current && !settingsOpen) menuButtonRef.current?.focus();
    wasSettingsOpen.current = settingsOpen;
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
            Anteprima di sviluppo: le note si aprono dall'archivio del browser, ma le modifiche non
            vengono ancora salvate e si perdono quando chiudi o ricarichi la pagina.
          </span>
        </p>
        <main class="workspace">
          <Workspace onTextChange={(value) => (text.value = value)} />
        </main>
        <footer class="status">
          <span class="unsaved">Modifiche non salvate</span>
          <span>{stats}</span>
          <CreatedAt />
        </footer>
      </div>
      {settingsOpen && <SettingsDrawer onClose={closeSettings} />}
    </div>
  );
}

function firstNote(): Note | undefined {
  const state = notesState.value;
  return state.status === 'ready' ? state.notes[0] : undefined;
}

function Workspace({ onTextChange }: { onTextChange: (text: string) => void }) {
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
  const note = state.notes[0];
  const unreadable = state.unreadable.length;
  return (
    <>
      {unreadable > 0 && (
        <p class="workspace-warning" role="status">
          {unreadable === 1
            ? '1 nota non si può leggere: è stata lasciata intatta nell’archivio.'
            : `${unreadable} note non si possono leggere: sono state lasciate intatte nell’archivio.`}
        </p>
      )}
      {note && (
        <Editor
          key={note.id}
          initialText={note.text}
          label="Testo della nota"
          onChange={onTextChange}
        />
      )}
    </>
  );
}

function CreatedAt() {
  const note = firstNote();
  return note ? <span>Creata il {DATE_FORMAT.format(note.createdAt)}</span> : null;
}
