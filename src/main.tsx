import { render } from 'preact';
import { App } from './app/App';
import { startSidebarSync } from './features/collection/state';
import { startAutosaveLifecycle } from './features/notes/autosave';
import { startCrossTabSync } from './features/notes/crossTab';
import { requestPersistentStorageOnFirstInteraction } from './features/notes/persistence';
import { initNotes, notesState } from './features/notes/store';
import { startViewModeSync } from './features/preview/viewMode';
import { startThemeSync } from './features/settings/theme';
import './app/fonts';
import './app/app.css';
import './app/collection.css';

// Il primo tema lo applica public/theme-boot.js prima del disegno; da qui in poi lo segue il segnale.
startThemeSync();
startViewModeSync();
startSidebarSync();

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app mancante in index.html');
render(<App />, root);
startAutosaveLifecycle();
startCrossTabSync();

// La persistenza si chiede solo se l'archivio si è aperto: altrimenti non c'è nulla da proteggere.
void initNotes().then(() => {
  if (notesState.value.status === 'ready') requestPersistentStorageOnFirstInteraction();
});
