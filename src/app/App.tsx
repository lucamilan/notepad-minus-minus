import { useComputed, useSignal } from '@preact/signals';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '../features/editor/Editor';
import { SettingsDrawer } from '../features/settings/SettingsDrawer';
import { AppBar } from './AppBar';
import { InfoIcon } from './icons';

const SAMPLE_NOTE = `# Nota di esempio
Puoi scrivere la nota usando la sintassi *Markdown* di base.

Questa è un'anteprima di sviluppo di Notepad−− v2: l'editor funziona,
ma il testo non viene ancora salvato.`;

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
      <AppBar menuButtonRef={menuButtonRef} onOpenSettings={openSettings} />
      <p class="notice" role="note">
        <InfoIcon />
        <span>
          Anteprima di sviluppo: il salvataggio non c'è ancora. Quello che scrivi si perde quando
          chiudi o ricarichi la pagina.
        </span>
      </p>
      <main class="workspace">
        <Editor
          initialText={SAMPLE_NOTE}
          label="Testo della nota"
          onChange={(value) => (text.value = value)}
        />
      </main>
      <footer class="status">
        <span class="unsaved">Non salvato</span>
        <span>{stats}</span>
      </footer>
      {settingsOpen && <SettingsDrawer onClose={closeSettings} />}
    </div>
  );
}
