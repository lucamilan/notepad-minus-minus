import { expect, test, type Page } from '@playwright/test';
import {
  DB_NAME,
  openUnlocked,
  reloadUnlocked,
  TEST_PASSPHRASE,
  unlockVault,
  waitForPendingSaves,
} from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

async function storedRecords(page: Page) {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('notes').objectStore('notes').getAll();
          req.onsuccess = () => {
            resolve(req.result as Record<string, unknown>[]);
            open.result.close();
          };
          req.onerror = () => reject(req.error);
        };
      }),
    DB_NAME,
  );
}

test('al primo avvio crea la nota di esempio nell’archivio, una sola volta', async ({ page }) => {
  await openUnlocked(page);
  const editor = page.getByRole('textbox', { name: 'Testo della nota' });
  await expect(editor).toContainText('Nota di esempio');
  await expect(page.locator('.status')).toContainText('Creata il');

  const first = await storedRecords(page);
  expect(first).toHaveLength(1);
  // In chiaro solo id e formato: testo e date stanno nel payload cifrato.
  expect(Object.keys(first[0] ?? {}).sort()).toEqual(['format', 'id', 'payload']);
  expect(first[0]?.['format']).toBe('aesgcm-v1');

  await reloadUnlocked(page);
  await expect(editor).toContainText('Nota di esempio');
  expect(await storedRecords(page)).toEqual(first);
});

test('due schede che creano insieme la passphrase: vince una, l’altra chiede di sbloccare', async ({
  context,
}) => {
  const [a, b] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([a.goto('/'), b.goto('/')]);
  for (const page of [a, b]) {
    await page.getByLabel('Passphrase', { exact: true }).fill(TEST_PASSPHRASE);
    await page.getByLabel('Ripeti la passphrase').fill(TEST_PASSPHRASE);
  }
  await Promise.all(
    [a, b].map((page) => page.getByRole('button', { name: 'Crea la passphrase' }).click()),
  );
  const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
  const refused = (page: Page) =>
    page.getByText('La passphrase è già stata creata in un’altra scheda');
  // Una delle due è già nelle note, l'altra spiega e chiede la passphrase appena creata.
  await expect(editor(a).or(refused(a))).toBeVisible();
  await expect(editor(b).or(refused(b))).toBeVisible();
  const loser = (await refused(a).isVisible()) ? a : b;
  const winner = loser === a ? b : a;
  await expect(editor(winner)).toContainText('Nota di esempio');
  await unlockVault(loser);
  await expect(editor(loser)).toContainText('Nota di esempio');
  expect(await storedRecords(a)).toHaveLength(1);
  await waitForPendingSaves(a);
  await waitForPendingSaves(b);
});

test('se un’altra scheda aggiorna l’archivio, questa chiede di ricaricare', async ({ context }) => {
  const page = await context.newPage();
  await openUnlocked(page);
  await expect(page.getByRole('textbox', { name: 'Testo della nota' })).toBeVisible();

  // Una seconda scheda con una versione futura dell'app alza lo schema del database.
  const other = await context.newPage();
  await other.goto('/');
  const upgraded = await other.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const probe = indexedDB.open(name);
        probe.onsuccess = () => {
          const next = probe.result.version + 1;
          probe.result.close();
          const open = indexedDB.open(name, next);
          open.onsuccess = () => {
            resolve(open.result.version);
            open.result.close();
          };
          open.onerror = () => reject(open.error);
        };
      }),
    DB_NAME,
  );
  expect(upgraded).toBeGreaterThan(1);
  await expect(page.locator('.workspace').getByRole('alert')).toContainText(
    'Ricarica questa pagina',
  );
});

test('se IndexedDB non è disponibile mostra un messaggio chiaro', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new DOMException('bloccato', 'SecurityError');
      },
    });
  });
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await expect(page.locator('.workspace').getByRole('alert')).toContainText(
    'non permette di salvare dati',
  );
  // L'errore originale finisce in console per chi indaga (il testo varia da browser a browser).
  expect(errors.length).toBeGreaterThan(0);
});
