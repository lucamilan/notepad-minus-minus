import { signal } from '@preact/signals';

/** Ricerca globale (Ctrl+K) aperta, con il testo iniziale da mettere nel campo. */
export const searchRequest = signal<{ query: string } | null>(null);

export function openSearch(query = ''): void {
  searchRequest.value = { query };
}

export function closeSearch(): void {
  searchRequest.value = null;
}
