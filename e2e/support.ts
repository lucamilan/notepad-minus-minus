import { expect, type Page } from '@playwright/test';

/**
 * Aspetta che non ci siano salvataggi in coda o in corso. Da usare prima che il test chiuda
 * la pagina: in Firefox chiudere un contesto con una scrittura IndexedDB in volo può
 * rallentare per secondi l'apertura dell'archivio nel test successivo.
 */
export async function waitForPendingSaves(page: Page): Promise<void> {
  const state = page.locator('.save-state');
  if ((await state.count()) === 0) return;
  await expect(state).not.toHaveAttribute('data-state', /^(pending|saving)$/);
}
