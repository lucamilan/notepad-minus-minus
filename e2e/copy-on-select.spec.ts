import { expect, test, type Page } from '@playwright/test';
import { openUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const copyState = (page: Page) => page.locator('footer.status .copy-state');

async function openWith(page: Page, text: string) {
  await openUnlocked(page);
  await page
    .getByRole('group', { name: 'Modalità di visualizzazione' })
    .getByRole('button', { name: 'Modifica' })
    .click();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

/** Trascina il mouse dall'inizio della prima riga alla fine della seconda. */
async function dragSelectFirstTwoLines(page: Page) {
  const lines = editor(page).locator('.cm-line');
  const first = await lines.nth(0).boundingBox();
  const second = await lines.nth(1).boundingBox();
  if (!first || !second) throw new Error('righe non visibili');
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 2, second.y + second.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('selezionando col mouse il testo va negli appunti e la barra lo dice', async ({
  page,
  browserName,
}) => {
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await openWith(page, 'prima riga\nseconda\nterza');
  await dragSelectFirstTwoLines(page);
  await expect(copyState(page)).toHaveText('Copiati 18 caratteri (2 righe)');
  if (browserName === 'chromium') {
    // Su Windows gli appunti tornano con a capo \r\n.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.replace(/\r\n/g, '\n')).toBe('prima riga\nseconda');
  }
  // Dopo qualche secondo l'avviso sparisce.
  await expect(copyState(page)).toHaveCount(0, { timeout: 8000 });

  // Doppio clic su una parola: la parola.
  await editor(page).locator('.cm-line').nth(2).dblclick();
  await expect(copyState(page)).toHaveText('Copiati 5 caratteri');

  // Con la tastiera niente copia automatica.
  await expect(copyState(page)).toHaveCount(0, { timeout: 8000 });
  await page.keyboard.press('ControlOrMeta+A');
  await page.waitForTimeout(300);
  await expect(copyState(page)).toHaveCount(0);
});

test('si spegne nelle impostazioni, e la scelta resta', async ({ page }) => {
  await openWith(page, 'prima riga\nseconda');
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  const option = page.getByRole('checkbox', {
    name: 'Copia negli appunti il testo selezionato con il mouse',
  });
  await expect(option).toBeChecked();
  await option.uncheck();
  await page
    .getByRole('dialog', { name: 'Impostazioni' })
    .getByRole('button', { name: 'Chiudi' })
    .click();

  await dragSelectFirstTwoLines(page);
  await page.waitForTimeout(300);
  await expect(copyState(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('notepad:copy-on-select'))).toBe('off');
});
