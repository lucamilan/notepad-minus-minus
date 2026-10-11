import { signal } from '@preact/signals';

/**
 * Modalità zen: restano solo il testo della nota attiva e una barra minima. Vive solo in
 * memoria (lo schermo intero non si può ripristinare dopo un ricaricamento) e si azzera quando
 * l'area delle note si smonta, per esempio al blocco.
 */
export const zenMode = signal(false);

/** Le API dello schermo intero usate qui: iniettabili nei test. */
export interface FullscreenHost {
  fullscreenElement: Element | null;
  documentElement: Pick<Element, 'requestFullscreen'>;
  exitFullscreen: () => Promise<void>;
}

/**
 * Entra in zen e chiede lo schermo intero del browser. Va chiamata da un gesto dell'utente
 * (tasto o clic). Dove lo schermo intero non c'è (iPhone) o viene rifiutato resta il layout zen.
 */
export function enterZen(host: FullscreenHost = document): void {
  zenMode.value = true;
  if (host.fullscreenElement !== null) return;
  try {
    // Su iPhone requestFullscreen non esiste per gli elementi della pagina.
    const request = host.documentElement.requestFullscreen as
      Element['requestFullscreen'] | undefined;
    void request
      ?.call(host.documentElement, { navigationUI: 'hide' })
      // Uscita da zen (o blocco) prima che lo schermo intero arrivasse: lo si lascia subito.
      .then(() => {
        if (!zenMode.value) leaveFullscreen(host);
      })
      .catch(() => undefined);
  } catch {
    // Rifiutato (permessi, iframe): basta il layout zen.
  }
}

/** Esce da zen e, se c'era, dallo schermo intero. */
export function exitZen(host: FullscreenHost = document): void {
  zenMode.value = false;
  leaveFullscreen(host);
}

function leaveFullscreen(host: FullscreenHost): void {
  if (host.fullscreenElement === null) return;
  try {
    void host.exitFullscreen().catch(() => undefined);
  } catch {
    // Già uscito.
  }
}

export function toggleZen(host: FullscreenHost = document): void {
  if (zenMode.value) exitZen(host);
  else enterZen(host);
}
