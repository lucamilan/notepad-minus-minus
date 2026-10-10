import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { openUnlocked, setupVault, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

declare global {
  interface Window {
    __cspViolations: string[];
  }
}

const FILE_PASSPHRASE = 'passphrase del file per il pc di casa';
/** L'"altro PC": un contesto nuovo, con un suo archivio e una sua passphrase. */
const OTHER_PASSPHRASE = 'altro computer altra passphrase';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const noteItems = (page: Page) =>
  page.getByRole('complementary', { name: 'Raccolta' }).locator('.note-item');

/** Sostituisce tutto il testo della nota attiva e aspetta che sia salvato. */
async function replaceText(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
  await expect(page.locator('.save-state')).toHaveText(/^Salvato alle/);
}

async function openFromMenu(page: Page, item: 'Esporta note…' | 'Importa note…') {
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

function watchSecurity(page: Page, appOrigin: string) {
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith('http') && url.origin !== appOrigin) foreign.push(req.url());
  });
  return foreign;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
});

/** Esporta tutte le note con FILE_PASSPHRASE e restituisce il percorso del file scaricato. */
async function exportAll(page: Page, expected: string): Promise<string> {
  await openFromMenu(page, 'Esporta note…');
  const dialog = page.getByRole('dialog', { name: 'Esporta note' });
  await expect(dialog.getByLabel('Passphrase del file', { exact: true })).toBeFocused();
  await dialog.getByLabel('Passphrase del file', { exact: true }).fill(FILE_PASSPHRASE);
  await dialog.getByLabel('Ripeti la passphrase del file').fill(FILE_PASSPHRASE);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Esporta' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^notepad-\d{4}-\d{2}-\d{2}\.notepad$/);
  await expect(dialog.getByRole('status')).toHaveText(expected);
  // Il link temporaneo dello scaricamento non resta nella pagina.
  await expect(page.locator('a[download]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Altro' })).toBeFocused();
  const path = await download.path();
  if (!path) throw new Error('download senza file');
  return path;
}

/** Un browser nuovo, come un altro PC: crea la sua passphrase. */
async function otherPc(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await setupVault(page, OTHER_PASSPHRASE);
  return page;
}

/** Primi due passi dell'importazione: file e passphrase. */
async function chooseFile(page: Page, file: string | { name: string; buffer: Buffer }) {
  await openFromMenu(page, 'Importa note…');
  const dialog = page.getByRole('dialog', { name: 'Importa note' });
  await expect(dialog.getByLabel('File da importare')).toBeFocused();
  await dialog
    .getByLabel('File da importare')
    .setInputFiles(
      typeof file === 'string'
        ? file
        : { name: file.name, mimeType: 'application/octet-stream', buffer: file.buffer },
    );
  await dialog.getByRole('button', { name: 'Avanti' }).click();
  return dialog;
}

async function enterPassphrase(page: Page, passphrase: string) {
  const dialog = page.getByRole('dialog', { name: 'Importa note' });
  await expect(dialog.getByLabel('Passphrase del file', { exact: true })).toBeFocused();
  await dialog.getByLabel('Passphrase del file', { exact: true }).fill(passphrase);
  await dialog.getByRole('button', { name: 'Apri il file' }).click();
  return dialog;
}

test('le note passano a un altro PC con il file cifrato: prima unendo, poi sostituendo', async ({
  page,
  browser,
  baseURL,
}) => {
  const foreign = watchSecurity(page, new URL(baseURL ?? '').origin);
  await openUnlocked(page);
  await replaceText(page, '# Verbale riservato\nSegreto trasferito #cliente/acme');

  const path = await exportAll(page, 'Esportata 1 nota.');
  const content = await readFile(path, 'utf8');
  for (const clear of ['Verbale', 'Segreto', 'acme', 'cliente', 'modifiedAt']) {
    expect(content).not.toContain(clear);
  }
  expect(JSON.parse(content)).toMatchObject({ app: 'notepad-minus-minus', version: 1 });
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(foreign).toEqual([]);

  // L'altro PC: ha già la sua nota di esempio.
  const other = await otherPc(browser);
  await expect(editor(other)).toContainText('Nota di esempio');
  let dialog = await chooseFile(other, path);
  await enterPassphrase(other, FILE_PASSPHRASE);
  await expect(dialog.getByText('Il file contiene 1 nota.')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Unisci/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Importa' }).click();
  await expect(dialog.getByRole('status')).toHaveText('1 aggiunta, 0 aggiornate, 0 già presenti.');
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  await expect(noteItems(other)).toHaveCount(2);
  await expect(noteItems(other).filter({ hasText: 'Verbale riservato' })).toHaveCount(1);

  // Di nuovo, sostituendo: la conferma esplicita abilita il pulsante.
  dialog = await chooseFile(other, path);
  await enterPassphrase(other, FILE_PASSPHRASE);
  await dialog.getByRole('radio', { name: /Sostituisci tutto/ }).check();
  const replace = dialog.getByRole('button', { name: 'Sostituisci tutto' });
  await expect(replace).toBeDisabled();
  // Si elimina solo la nota di esempio dell'altro PC: quella del file viene riscritta.
  await dialog.getByLabel('Ho capito che 1 nota attuale verrà eliminata').check();
  await replace.click();
  await expect(dialog.getByRole('status')).toHaveText('Sostituita: 1 nota. 1 nota eliminata.');
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  await expect(noteItems(other)).toHaveCount(1);
  await expect(editor(other)).toContainText('Segreto trasferito');
  await expect(other.getByRole('tab')).toHaveCount(1);

  // Una terza volta: sostituendo non si eliminerebbe nulla, quindi niente conferma.
  dialog = await chooseFile(other, path);
  await enterPassphrase(other, FILE_PASSPHRASE);
  await dialog.getByRole('radio', { name: /Sostituisci tutto/ }).check();
  await expect(dialog.getByText('Nessuna nota attuale verrà eliminata.')).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Sostituisci tutto' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Annulla' }).click();
  await waitForPendingSaves(other);
  await other.context().close();
});

test('passphrase del file sbagliata e file non validi danno un errore chiaro', async ({
  page,
  browser,
}) => {
  await openUnlocked(page);
  const path = await exportAll(page, 'Esportata 1 nota.');

  const other = await otherPc(browser);
  const dialog = await chooseFile(other, path);
  await enterPassphrase(other, 'questa non è quella del file');
  await expect(dialog.getByRole('alert')).toHaveText('Passphrase del file errata');
  await expect(dialog.getByLabel('Passphrase del file', { exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Annulla' }).click();
  await expect(dialog).toBeHidden();

  // Riaperto, il dialogo riparte da zero: nessun file né passphrase rimasti.
  await openFromMenu(other, 'Importa note…');
  await expect(dialog.getByLabel('File da importare')).toBeFocused();
  await expect(dialog.getByLabel('File da importare')).toHaveValue('');
  await expect(dialog.getByLabel('Passphrase del file', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveText('');
  await dialog.getByRole('button', { name: 'Annulla' }).click();
  await expect(dialog).toBeHidden();

  for (const buffer of [
    Buffer.from('non è un file di Notepad−−'),
    Buffer.from(JSON.stringify({ app: 'notepad-minus-minus', kind: 'export', version: 1 })),
  ]) {
    const garbage = await chooseFile(other, { name: 'note.notepad', buffer });
    await expect(garbage.getByRole('alert')).toHaveText(
      'Il file non è un’esportazione di Notepad−− valida.',
    );
    await garbage.getByRole('button', { name: 'Annulla' }).click();
  }
  const future = await chooseFile(other, {
    name: 'futuro.notepad',
    buffer: Buffer.from(JSON.stringify({ app: 'notepad-minus-minus', kind: 'export', version: 9 })),
  });
  await expect(future.getByRole('alert')).toContainText('Versione non supportata');
  await other.context().close();
});

test('esportazione e importazione si usano solo con la tastiera', async ({ page, browser }) => {
  await openUnlocked(page);
  const menu = page.getByRole('button', { name: 'Altro' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Esporta note…' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Passphrase del file', { exact: true })).toBeFocused();
  await page.keyboard.type(FILE_PASSPHRASE);
  await page.keyboard.press('Tab'); // suggerimento non focalizzabile: si va alla conferma
  await expect(page.getByLabel('Ripeti la passphrase del file')).toBeFocused();
  await page.keyboard.type(FILE_PASSPHRASE);
  const downloading = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const path = await (await downloading).path();
  const close = page.getByRole('button', { name: 'Chiudi', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeFocused();

  const other = await otherPc(browser);
  const otherMenu = other.getByRole('button', { name: 'Altro' });
  await otherMenu.focus();
  await other.keyboard.press('ArrowDown');
  await expect(other.getByRole('menuitem', { name: 'Esporta note…' })).toBeFocused();
  await other.keyboard.press('ArrowDown');
  await expect(other.getByRole('menuitem', { name: 'Importa note…' })).toBeFocused();
  await other.keyboard.press('Enter');
  const fileInput = other.getByLabel('File da importare');
  await expect(fileInput).toBeFocused();
  // Il selettore di file è del sistema: lo si apre da tastiera e si sceglie il file.
  const choosing = other.waitForEvent('filechooser');
  await other.keyboard.press('Space');
  await (await choosing).setFiles(path);
  await other.keyboard.press('Tab');
  await other.keyboard.press('Tab');
  await expect(other.getByRole('button', { name: 'Avanti' })).toBeFocused();
  await other.keyboard.press('Enter');
  await expect(other.getByLabel('Passphrase del file', { exact: true })).toBeFocused();
  await other.keyboard.type(FILE_PASSPHRASE);
  await other.keyboard.press('Enter');
  const merge = other.getByRole('radio', { name: /Unisci/ });
  await expect(merge).toBeFocused();
  await other.keyboard.press('ArrowDown');
  await expect(other.getByRole('radio', { name: /Sostituisci tutto/ })).toBeChecked();
  await other.keyboard.press('Tab');
  await expect(other.getByRole('checkbox')).toBeFocused();
  await other.keyboard.press('Space');
  await other.keyboard.press('Tab');
  await other.keyboard.press('Tab');
  await expect(other.getByRole('button', { name: 'Sostituisci tutto' })).toBeFocused();
  await other.keyboard.press('Enter');
  await expect(other.getByRole('status').filter({ hasText: 'Sostituita' })).toHaveText(
    'Sostituita: 1 nota. 1 nota eliminata.',
  );
  await expect(other.getByRole('button', { name: 'Chiudi', exact: true })).toBeFocused();
  await other.keyboard.press('Enter');
  await expect(otherMenu).toBeFocused();
  await expect(editor(other)).toContainText('Nota di esempio');
  await waitForPendingSaves(other);
  await other.context().close();
});

test('dalle impostazioni: sezione "Trasferimento tra PC"', async ({ page }) => {
  await openUnlocked(page);
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  const settings = page.getByRole('dialog', { name: 'Impostazioni' });
  await expect(settings.getByRole('heading', { name: 'Trasferimento tra PC' })).toBeVisible();
  const exportButton = settings.getByRole('button', { name: 'Esporta note…' });
  await exportButton.click();
  const dialog = page.getByRole('dialog', { name: 'Esporta note' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(exportButton).toBeFocused();
});
