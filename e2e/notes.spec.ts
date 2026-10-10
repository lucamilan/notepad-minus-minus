import { expect, test, type Page } from '@playwright/test';

const DB_NAME = 'notepad-minus-minus';

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
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Testo della nota' });
  await expect(editor).toContainText('Nota di esempio');
  await expect(page.locator('.status')).toContainText('Creata il');

  const first = await storedRecords(page);
  expect(first).toHaveLength(1);
  // In chiaro solo id e formato: testo e date stanno nel payload (che F7 cifrerà).
  expect(Object.keys(first[0] ?? {}).sort()).toEqual(['format', 'id', 'payload']);
  expect(first[0]?.['format']).toBe('plain-v1');

  await page.reload();
  await expect(editor).toContainText('Nota di esempio');
  expect(await storedRecords(page)).toEqual(first);
});

test('due schede aperte insieme al primo avvio creano una sola nota', async ({ context }) => {
  const [a, b] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([a.goto('/'), b.goto('/')]);
  for (const page of [a, b]) {
    await expect(page.getByRole('textbox', { name: 'Testo della nota' })).toContainText(
      'Nota di esempio',
    );
  }
  expect(await storedRecords(a)).toHaveLength(1);
});

test('se un’altra scheda aggiorna l’archivio, questa chiede di ricaricare', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/');
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
  await expect(page.getByRole('alert')).toContainText('Ricarica questa pagina');
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
  await expect(page.getByRole('alert')).toContainText('non permette di salvare dati');
  // L'errore originale finisce in console per chi indaga (il testo varia da browser a browser).
  expect(errors.length).toBeGreaterThan(0);
});
