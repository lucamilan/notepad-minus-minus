import { signal } from '@preact/signals';

/**
 * Registrazione del service worker (src/sw/sw.ts) e aggiornamenti dell'app installata.
 *
 * Una versione nuova si installa da sola ma resta in attesa: la pagina mostra "È disponibile
 * una nuova versione" e solo con "Aggiorna" salva le note in coda, attiva il nuovo service
 * worker e si ricarica, una volta sola. Le API del browser arrivano da fuori (ServiceWorkerEnv)
 * così la logica si prova nei test senza un browser vero.
 */

/**
 * - `none`: niente da fare;
 * - `waiting`: una versione nuova è installata e aspetta "Aggiorna";
 * - `active`: la versione nuova è già attiva (aggiornata da un'altra scheda), basta ricaricare.
 */
export type UpdateState = 'none' | 'waiting' | 'active';

export const updateState = signal<UpdateState>('none');
/** "Aggiorna" premuto: il pulsante resta disattivato finché la pagina non si ricarica. */
export const updateInProgress = signal(false);

/** Le parti del browser usate qui (navigator.serviceWorker, location.reload…). */
export interface ServiceWorkerEnv {
  container: Pick<
    ServiceWorkerContainer,
    'register' | 'controller' | 'addEventListener' | 'removeEventListener'
  >;
  /** URL di sw.js (già passato dalla policy Trusted Types se serve). */
  scriptUrl: string;
  scope: string;
  /** Salva quanto è in coda prima di ricaricare (bloccate o no). */
  prepare: () => Promise<void>;
  reload: () => void;
  /** Pagina tornata visibile: occasione per cercare aggiornamenti (vedi UPDATE_CHECK_MS). */
  onVisible?: (listener: () => void) => void;
  now?: () => number;
}

/**
 * Dopo "Aggiorna", se la versione nuova non si attiva entro questo tempo (o diventa
 * `redundant`) si ricarica comunque: al peggio riparte la versione di prima.
 */
export const UPDATE_FALLBACK_MS = 5000;

/** Al massimo un controllo degli aggiornamenti all'ora, quando si torna sulla scheda. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

let registration: ServiceWorkerRegistration | undefined;
let env: ServiceWorkerEnv | undefined;
let reloading = false;
let updateRequested = false;
/** Toglie la rete di sicurezza di applyUpdate (timer e ascolto di `redundant`). */
let stopFallback: (() => void) | undefined;

/** Solo per i test. */
export function resetUpdateForTests(): void {
  registration = undefined;
  env = undefined;
  reloading = false;
  updateRequested = false;
  stopFallback?.();
  updateState.value = 'none';
  updateInProgress.value = false;
}

function reloadOnce(): void {
  if (reloading || !env) return;
  reloading = true;
  stopFallback?.();
  // Se il browser chiede conferma (modifiche non salvate) e si resta, i pulsanti tornano attivi.
  updateInProgress.value = false;
  env.reload();
}

/** Segue un service worker appena trovato: installato con una pagina già controllata = aggiornamento. */
function watchInstalling(worker: ServiceWorker | null): void {
  if (!worker) return;
  const onStateChange = () => {
    if (worker.state !== 'installed') return;
    worker.removeEventListener('statechange', onStateChange);
    // Senza controller è la prima installazione: non c'è nulla da aggiornare.
    if (env?.container.controller && registration?.waiting === worker) {
      updateState.value = 'waiting';
    }
  };
  worker.addEventListener('statechange', onStateChange);
  onStateChange();
}

/**
 * Registra sw.js. Gli errori si registrano in console e basta: l'app funziona lo stesso,
 * solo senza la cache offline.
 */
export async function startServiceWorker(options: ServiceWorkerEnv): Promise<void> {
  env = options;
  const { container } = options;
  // Una pagina già controllata che cambia controller senza averlo chiesto: aggiornata altrove.
  const hadController = container.controller !== null;
  container.addEventListener('controllerchange', () => {
    // Il nostro "Aggiorna": la pagina si ricarica con la versione nuova.
    if (updateRequested) {
      reloadOnce();
      return;
    }
    // Attivata da un'altra scheda: questa pagina è ancora della versione precedente.
    if (hadController) updateState.value = 'active';
  });
  // Alcuni ambienti (service worker bloccati da criteri o dall'automazione) risolvono senza
  // registrazione: si va avanti senza cache offline.
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await container.register(options.scriptUrl, { scope: options.scope });
  } catch (error) {
    console.error('Service worker non registrato: l’app funziona, ma non senza rete.', error);
    return;
  }
  if (!reg) return;
  registration = reg;
  if (reg.waiting && container.controller) updateState.value = 'waiting';
  watchInstalling(reg.installing);
  reg.addEventListener('updatefound', () => watchInstalling(reg.installing));

  const now = options.now ?? Date.now;
  let lastCheck = now();
  options.onVisible?.(() => {
    if (now() - lastCheck < UPDATE_CHECK_MS) return;
    lastCheck = now();
    // Senza rete il controllo fallisce: si riprova la prossima volta.
    reg.update().catch(() => undefined);
  });
}

/** "Aggiorna": salva, attiva la versione in attesa e ricarica (una volta, a controllerchange). */
export async function applyUpdate(): Promise<void> {
  if (!env || updateInProgress.value) return;
  updateInProgress.value = true;
  // Un nuovo clic dopo un ricaricamento annullato (conferma del browser) riprova davvero.
  reloading = false;
  try {
    await env.prepare();
  } catch (error) {
    // Il browser chiederà conferma prima di ricaricare se resta qualcosa da salvare.
    console.error(error);
  }
  const waiting = registration?.waiting;
  if (updateState.value === 'waiting' && waiting) {
    updateRequested = true;
    // Rete di sicurezza: se l'attivazione non arriva (o il worker diventa `redundant`) si
    // ricarica lo stesso e i pulsanti tornano attivi.
    const onStateChange = () => {
      if (waiting.state === 'redundant') reloadOnce();
    };
    const timer = setTimeout(reloadOnce, UPDATE_FALLBACK_MS);
    waiting.addEventListener('statechange', onStateChange);
    stopFallback = () => {
      clearTimeout(timer);
      waiting.removeEventListener('statechange', onStateChange);
      stopFallback = undefined;
    };
    waiting.postMessage({ type: 'SKIP_WAITING' });
    // Se nel frattempo un'altra scheda l'ha già attivata, controllerchange è già passato.
    if (registration?.active === waiting) reloadOnce();
    return;
  }
  reloadOnce();
}

/** Trusted Types: la policy che ammette solo l'URL di sw.js (la CSP la nomina: notepad-sw). */
interface TrustedTypesFactory {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): { createScriptURL: (input: string) => unknown };
}

/**
 * Con Trusted Types attivi register() accetta solo un TrustedScriptURL: la policy
 * `notepad-sw` ne crea uno solo per l'URL esatto di sw.js, nient'altro.
 */
export function trustedScriptUrl(url: string, target: object = window): string {
  const factory = (target as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
  if (!factory) return url;
  const policy = factory.createPolicy('notepad-sw', {
    createScriptURL: (input) => {
      if (input !== url) throw new TypeError('URL del service worker non ammesso');
      return input;
    },
  });
  // register() lo accetta come stringa: il tipo DOM di TypeScript non conosce TrustedScriptURL.
  return policy.createScriptURL(url) as string;
}

/** Da main.tsx, solo in produzione e se il browser ha i service worker. */
export function registerServiceWorker(prepare: () => Promise<void>): void {
  if (!('serviceWorker' in navigator)) return;
  const scope = new URL(import.meta.env.BASE_URL, window.location.href).href;
  const scriptUrl = new URL('sw.js', scope).href;
  let trusted: string;
  try {
    trusted = trustedScriptUrl(scriptUrl);
  } catch (error) {
    console.error('Service worker non registrato.', error);
    return;
  }
  void startServiceWorker({
    container: navigator.serviceWorker,
    scriptUrl: trusted,
    scope,
    prepare,
    reload: () => window.location.reload(),
    onVisible: (listener) =>
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') listener();
      }),
  });
}
