import { expect, test, type Page } from '@playwright/test';
import { leaveZenWithEscape, openUnlocked, reloadUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const zenBar = (page: Page) => page.locator('.zen-bar');
const exitButton = (page: Page) => page.getByRole('button', { name: 'Esci da zen' });
const lineNumbers = (page: Page) => page.locator('.editor-host').locator('.cm-lineNumbers');

async function openApp(page: Page) {
  await openUnlocked(page);
  await expect(editor(page)).toContainText('Nota di esempio');
}

async function expectNormalLayout(page: Page) {
  await expect(zenBar(page)).toHaveCount(0);
  await expect(page.locator('header.bar')).toBeVisible();
  await expect(page.locator('footer.status')).toBeVisible();
  await expect(page.getByRole('tablist')).toBeVisible();
  await expect(lineNumbers(page)).toHaveCount(1);
}

test('il pulsante Zen lascia solo il testo; si scrive e si salva; Esc torna indietro', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Zen' }).click();

  await expect(zenBar(page)).toBeVisible();
  await expect(page.locator('header.bar')).toHaveCount(0);
  await expect(page.locator('footer.status')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('.note-bar')).toHaveCount(0);
  await expect(page.locator('.collection')).toHaveCount(0);
  await expect(lineNumbers(page)).toHaveCount(0);
  // Il focus passa al testo: si scrive subito.
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nscritto in zen');
  await expect(zenBar(page).locator('.save-state')).toHaveAttribute('data-state', 'saved');
  await expect(zenBar(page)).toContainText('parole');

  await leaveZenWithEscape(page);
  await expectNormalLayout(page);
  await expect(editor(page)).toBeFocused();

  await reloadUnlocked(page);
  await expect(editor(page)).toContainText('scritto in zen');
  await expectNormalLayout(page);
});

test('Alt+Z entra ed esce; "Esci da zen" riporta il focus al testo', async ({ page }) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press('Alt+Z');
  await expect(zenBar(page)).toBeVisible();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Alt+Z');
  await expectNormalLayout(page);

  await page.keyboard.press('Alt+Z');
  await exitButton(page).click();
  await expectNormalLayout(page);
  await expect(editor(page)).toBeFocused();
});

test('in zen il testo è centrato e più grande; Ctrl+E cambia ancora modalità', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await page
    .getByRole('group', { name: 'Modalità di visualizzazione' })
    .getByRole('button', { name: 'Modifica' })
    .click();
  const line = page.locator('.editor-host').locator('.cm-line').first();
  const normalPad = await line.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  const normalSize = await line.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  await page.getByRole('button', { name: 'Zen' }).click();
  await expect(lineNumbers(page)).toHaveCount(0);
  const zenPad = await line.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  const zenSize = await line.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(zenPad).toBeGreaterThan(normalPad + 100);
  expect(zenSize).toBeGreaterThan(normalSize);

  // Modifica → Dal vivo → Affiancata.
  await page.keyboard.press('ControlOrMeta+E');
  await expect(editor(page).locator('.cm-live-h1')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+E');
  await expect(page.getByRole('article', { name: 'Anteprima della nota' })).toBeVisible();
  await expect(zenBar(page)).toBeVisible();
});

test('chiudendo l’ultima scheda in zen si torna alle schede', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Zen' }).click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Alt+W');
  await expect(page.getByRole('heading', { name: 'Nessuna nota aperta' })).toBeVisible();
  await expect(zenBar(page)).toHaveCount(0);
  await expect(page.locator('header.bar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Nuova nota' })).toBeFocused();
});

test('bloccando in zen si esce da zen', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Zen' }).click();
  await page.keyboard.press('Alt+L');
  await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await reloadUnlocked(page);
  await expectNormalLayout(page);
});
