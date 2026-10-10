import { effect } from '@preact/signals';
import { render } from 'preact';
import { App } from './app/App';
import { startSidebarSync } from './features/collection/state';
import { startAutoLock } from './features/crypto/autoLock';
import { settleBeforeReload, startLockedQueueGuard, startVault } from './features/crypto/vault';
import { startAutosaveLifecycle } from './features/notes/autosave';
import { startCrossTabSync } from './features/notes/crossTab';
import { requestPersistentStorageOnFirstInteraction } from './features/notes/persistence';
import { notesState } from './features/notes/store';
import { startViewModeSync } from './features/preview/viewMode';
import { registerServiceWorker } from './features/pwa/update';
import { startThemeSync } from './features/settings/theme';
import './app/fonts';
import './app/app.css';
import './app/collection.css';
import './app/vault.css';

// Il primo tema lo applica public/theme-boot.js prima del disegno; da qui in poi lo segue il segnale.
startThemeSync();
startViewModeSync();
startSidebarSync();

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app mancante in index.html');
render(<App />, root);
startAutosaveLifecycle();
startCrossTabSync();
startLockedQueueGuard();
startAutoLock();
void startVault();
// Funziona anche senza rete (PWA): solo nella build, in `npm run dev` niente service worker.
if (import.meta.env.PROD) registerServiceWorker(settleBeforeReload);

// La persistenza si chiede solo la prima volta che le note si aprono: prima non c'è nulla da proteggere.
let persistenceRequested = false;
effect(() => {
  if (persistenceRequested || notesState.value.status !== 'ready') return;
  persistenceRequested = true;
  requestPersistentStorageOnFirstInteraction();
});
