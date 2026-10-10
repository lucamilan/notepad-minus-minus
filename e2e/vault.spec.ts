import { expect, test, type Page } from '@playwright/test';
import {
  DB_NAME,
  LEGACY_DB_NAME,
  openUnlocked,
  setupVault,
  TEST_PASSPHRASE,
  unlockVault,
  waitForPendingSaves,
} from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const lockButton = (page: Page) => page.getByRole('button', { name: 'Blocca', exact: true });
const lockedHeading = (page: Page) => page.getByRole('heading', { name: 'Note bloccate' });
const passphraseField = (page: Page) => page.getByLabel('Passphrase', { exact: true });

/** Sostituisce tutto il testo della nota attiva e aspetta che sia salvato. */
async function replaceText(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
  await expect(page.locator('.save-state')).toHaveText(/^Salvato alle/);
}

/** Tutti i record dei due store, byte compresi, come testo. */
function rawDump(page: Page): Promise<string> {
  return page.evaluate(
    (name) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['notes', 'meta']);
          const parts: unknown[] = [];
          for (const store of ['notes', 'meta']) {
            const values = tx.objectStore(store).getAll();
            const keys = tx.objectStore(store).getAllKeys();
            values.onsuccess = () => parts.push(values.result);
            keys.onsuccess = () => parts.push(keys.result);
          }
          tx.oncomplete = () => {
            db.close();
            const latin1 = new TextDecoder('latin1');
            resolve(
              JSON.stringify(parts, (_key, value: unknown) => {
                if (value instanceof ArrayBuffer) return latin1.decode(value);
                if (ArrayBuffer.isView(value)) return latin1.decode(value);
                return value;
              }),
            );
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    DB_NAME,
  );
}

function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name ?? ''));
}

test('bloccando le note spariscono dalla pagina e tornano solo con la passphrase giusta', async ({
  page,
}) => {
  await openUnlocked(page);
  await replaceText(page, '# Riunione riservata\nBudget segreto #cliente/zeta');
  await expect(page.locator('.note-bar')).toContainText('cliente/zeta');

  await lockButton(page).click();
  await expect(lockedHeading(page)).toBeVisible();
  await expect(passphraseField(page)).toBeFocused();
  const visible = await page.evaluate(() => document.body.innerText);
  expect(visible).not.toContain('Budget segreto');
  expect(visible).not.toContain('zeta');
  // localStorage tiene solo preferenze dell'interfaccia: niente testo né tag delle note.
  const local = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(local).not.toContain('segreto');
  expect(local).not.toContain('zeta');
  expect(local).not.toContain('Riunione');
  expect(await page.locator('.editor-host, .preview').count()).toBe(0);

  await passphraseField(page).fill('non è la passphrase giusta');
  await page.getByRole('button', { name: 'Sblocca' }).click();
  await expect(page.getByRole('alert')).toHaveText('Passphrase errata');
  await expect(passphraseField(page)).toBeFocused();

  await unlockVault(page);
  await expect(editor(page)).toContainText('Budget segreto');
});

test('nell’archivio non resta nulla in chiaro, né il vecchio database', async ({ page }) => {
  await openUnlocked(page);
  await replaceText(page, '# Diario cifrato\nSoltanto per me #progetto/girasole');

  const dump = await rawDump(page);
  for (const secret of ['Diario', 'Soltanto per me', 'girasole', 'progetto/', 'Nota di esempio']) {
    expect(dump).not.toContain(secret);
  }
  expect(dump).toContain('aesgcm-v1');
  expect(await databaseNames(page)).not.toContain(LEGACY_DB_NAME);
});

test('le note del vecchio archivio in chiaro si cifrano alla creazione della passphrase', async ({
  page,
}) => {
  // Prima visita: si crea a mano il database di F2–F6, con una nota "plain-v1".
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Proteggi le tue note' })).toBeVisible();
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('notes', { keyPath: 'id' });
          open.result.createObjectStore('meta');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('notes', 'readwrite');
          tx.objectStore('notes').put({
            id: crypto.randomUUID(),
            format: 'plain-v1',
            payload: {
              text: '# Nota di prima\nScritta quando non c’era la cifratura',
              createdAt: 1_700_000_000_000,
              modifiedAt: 1_700_000_000_000,
              pinned: false,
            },
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    LEGACY_DB_NAME,
  );

  await page.reload();
  await expect(page.getByText('Le note già presenti verranno cifrate')).toBeVisible();
  await setupVault(page);
  await expect(editor(page)).toContainText('Scritta quando non c’era la cifratura');
  // Niente nota di esempio: c'erano già note.
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect.poll(() => databaseNames(page)).not.toContain(LEGACY_DB_NAME);
  expect(await rawDump(page)).not.toContain('cifratura');
});

test('il blocco in una scheda blocca anche le altre', async ({ page, context }) => {
  await openUnlocked(page);
  const other = await context.newPage();
  await openUnlocked(other);
  await expect(editor(other)).toContainText('Nota di esempio');

  await lockButton(page).click();
  await expect(lockedHeading(page)).toBeVisible();
  await expect(lockedHeading(other)).toBeVisible();
  await expect(other.getByText('Note bloccate da un’altra scheda.')).toBeVisible();
  expect(await other.evaluate(() => document.body.innerText)).not.toContain('Nota di esempio');
  await other.close();
});

test('dopo il tempo di inattività la scheda si blocca da sola', async ({ page }) => {
  await page.clock.install();
  await openUnlocked(page);
  await expect(editor(page)).toContainText('Nota di esempio');

  await page.clock.fastForward('14:00');
  await expect(editor(page)).toBeVisible();
  await page.clock.fastForward('02:00');
  await expect(lockedHeading(page)).toBeVisible();
  await expect(page.getByText('Note bloccate per inattività.')).toBeVisible();
});

test('il blocco automatico si regola nelle impostazioni e resta scelto', async ({ page }) => {
  await openUnlocked(page);
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  const select = page.getByLabel('Blocco automatico dopo');
  await expect(select).toHaveValue('15');
  await select.selectOption('5');
  await page.keyboard.press('Escape');
  await page.reload();
  await unlockVault(page);
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  await expect(page.getByLabel('Blocco automatico dopo')).toHaveValue('5');
});

test('cambiata la passphrase vale solo quella nuova', async ({ page }) => {
  await openUnlocked(page);
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  await page.getByRole('button', { name: 'Cambia passphrase…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cambia passphrase' });
  await expect(dialog.getByLabel('Passphrase attuale')).toBeFocused();

  await dialog.getByLabel('Passphrase attuale').fill('una passphrase sbagliata');
  await dialog.getByLabel('Nuova passphrase', { exact: true }).fill('la mia nuova passphrase');
  await dialog.getByLabel('Ripeti la nuova passphrase').fill('la mia nuova passphrase');
  await dialog.getByRole('button', { name: 'Cambia passphrase' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Passphrase attuale errata');

  await dialog.getByLabel('Passphrase attuale').fill(TEST_PASSPHRASE);
  await dialog.getByRole('button', { name: 'Cambia passphrase' }).click();
  await expect(dialog.getByRole('status')).toContainText('Passphrase cambiata');
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Blocca ora' }).click();
  await expect(lockedHeading(page)).toBeVisible();
  await passphraseField(page).fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Sblocca' }).click();
  await expect(page.getByRole('alert')).toHaveText('Passphrase errata');
  await unlockVault(page, 'la mia nuova passphrase');
  await expect(editor(page)).toContainText('Nota di esempio');
});

test('passphrase dimenticata: si eliminano tutte le note e si ricomincia', async ({ page }) => {
  await openUnlocked(page);
  await replaceText(page, 'Testo che andrà perso');
  await lockButton(page).click();

  const forgot = page.getByRole('button', { name: 'Ho dimenticato la passphrase' });
  await forgot.click();
  const dialog = page.getByRole('dialog', { name: 'Eliminare tutte le note?' });
  const confirm = dialog.getByRole('button', { name: 'Elimina tutte le note' });
  await expect(confirm).toBeDisabled();
  // Annullando non succede nulla e il focus torna al pulsante.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(forgot).toBeFocused();

  await forgot.click();
  await dialog.getByLabel('Scrivi ELIMINA per confermare').fill('ELIMINA');
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Proteggi le tue note' })).toBeVisible();
  await setupVault(page, 'una passphrase tutta nuova');
  await expect(editor(page)).toContainText('Nota di esempio');
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('la passphrase si crea e si sblocca solo da tastiera', async ({ page }) => {
  await page.goto('/');
  const first = page.getByLabel('Passphrase', { exact: true });
  await expect(first).toBeFocused();
  // Troppo corta: errore annunciato, niente note.
  await page.keyboard.type('breve');
  await page.keyboard.press('Tab');
  await page.keyboard.type('breve');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('almeno 12 caratteri');

  await first.fill('');
  await first.focus();
  await page.keyboard.type(TEST_PASSPHRASE);
  await page.keyboard.press('Tab');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(TEST_PASSPHRASE);
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();

  // Alt+L blocca; il focus va sul campo, Invio sblocca e si torna a scrivere.
  await page.keyboard.press('Alt+L');
  await expect(lockedHeading(page)).toBeVisible();
  await expect(passphraseField(page)).toBeFocused();
  await page.keyboard.type(TEST_PASSPHRASE);
  await page.keyboard.press('Enter');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Scritto dopo lo sblocco ');
  await expect(editor(page)).toContainText('Scritto dopo lo sblocco');
});

test('i dati della v1 si segnalano nelle impostazioni e si eliminano solo con conferma', async ({
  page,
}) => {
  await openUnlocked(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('SqliteStorage', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('files');
        open.onsuccess = () => {
          open.result.close();
          resolve();
        };
        open.onerror = () => reject(open.error);
      }),
  );
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  const settings = page.getByRole('dialog', { name: 'Impostazioni' });
  await expect(settings.getByText('Dati della versione precedente')).toBeVisible();
  await settings.getByRole('button', { name: 'Elimina i dati della v1…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Eliminare i dati della v1?' });
  await expect(confirm.getByRole('button', { name: 'Annulla' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Elimina' }).click();
  await expect(settings.getByText('Dati della v1 eliminati.')).toBeVisible();
  expect(await databaseNames(page)).not.toContain('SqliteStorage');
});
