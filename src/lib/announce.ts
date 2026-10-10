import { signal } from '@preact/signals';

/**
 * Messaggio per i lettori di schermo (esito di Ctrl+S, "Nota duplicata"). Lo mostra la regione
 * live sempre montata fuori dal contenuto inerte (SaveAnnouncer in Workspace.tsx).
 */
export const announcement = signal('');

let pending: ReturnType<typeof setTimeout> | undefined;

/**
 * Svuota e poi riscrive: due annunci uguali ravvicinati vengono letti entrambi. Un annuncio
 * ancora in attesa lascia il posto al nuovo.
 */
export function announce(message: string): void {
  clearTimeout(pending);
  announcement.value = '';
  pending = setTimeout(() => {
    pending = undefined;
    announcement.value = message;
  }, 100);
}

/** Annulla l'annuncio in attesa e svuota la regione (nei test). */
export function resetAnnouncement(): void {
  clearTimeout(pending);
  pending = undefined;
  announcement.value = '';
}
