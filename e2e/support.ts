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

/** L'unica passphrase dei test e2e (ogni test parte da un contesto, quindi un archivio, nuovo). */
export const TEST_PASSPHRASE = 'prova e2e con quattro parole';

export const DB_NAME = 'notepad-minus-minus-cifrato';
export const LEGACY_DB_NAME = 'notepad-minus-minus';

/** L'area delle note è pronta (la barra di stato c'è solo da sbloccate). */
async function expectUnlocked(page: Page): Promise<void> {
  // PBKDF2 (600.000 iterazioni) con molti test in parallelo può superare i 5 s predefiniti.
  await expect(page.locator('footer.status')).toBeVisible({ timeout: 20_000 });
}

/** Prima apertura: crea la passphrase. */
export async function setupVault(page: Page, passphrase: string = TEST_PASSPHRASE): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Proteggi le tue note' })).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByLabel('Ripeti la passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Crea la passphrase' }).click();
  await expectUnlocked(page);
}

/** Schermata "Note bloccate": sblocca. */
export async function unlockVault(page: Page, passphrase: string = TEST_PASSPHRASE): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Sblocca' }).click();
  await expectUnlocked(page);
}

/**
 * Apre l'app e arriva alle note: crea la passphrase al primo avvio del contesto, altrimenti
 * (per esempio una seconda scheda) sblocca.
 */
export async function openUnlocked(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  const title = page.locator('#vault-title');
  await expect(title).toBeVisible();
  if ((await title.textContent()) === 'Proteggi le tue note') await setupVault(page);
  else await unlockVault(page);
}

/** Ricarica la pagina (che riparte bloccata) e sblocca. */
export async function reloadUnlocked(page: Page): Promise<void> {
  await page.reload();
  await unlockVault(page);
}

/**
 * Con i service worker attivi: aspetta che l'installazione (la cache dei file dell'app) sia
 * finita prima che il test chiuda il contesto, per lo stesso motivo di waitForPendingSaves.
 */
export async function waitForServiceWorker(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page
    .evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;
      const worker = registration.installing ?? registration.waiting ?? registration.active;
      if (!worker || worker.state === 'activated' || worker.state === 'installed') return;
      await new Promise<void>((done) => {
        const check = () => {
          if (worker.state !== 'installing' && worker.state !== 'activating') done();
        };
        worker.addEventListener('statechange', check);
        check();
      });
    })
    .catch(() => undefined);
}
