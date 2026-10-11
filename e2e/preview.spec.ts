import { expect, test, type Page } from '@playwright/test';
import { openUnlocked, reloadUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

declare global {
  interface Window {
    __violations: string[];
    __dialogs: number;
  }
}

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const preview = (page: Page) => page.getByRole('article', { name: 'Anteprima della nota' });
const modeButton = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Modalità di visualizzazione' }).getByRole('button', { name });

async function openApp(page: Page) {
  await openUnlocked(page);
  await expect(editor(page)).toContainText('Nota di esempio');
}

/** Sostituisce tutto il testo della nota attiva. */
async function replaceText(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

test('di default testo e anteprima affiancati; l’anteprima segue la scrittura', async ({
  page,
}) => {
  await openApp(page);
  await expect(modeButton(page, 'Affiancata')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('Nota di esempio');
  await expect(preview(page).locator('em')).toHaveText('Markdown');

  await replaceText(page, '# Spesa\n\n- [x] pane\n- [ ] **latte**');
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('Spesa');
  await expect(preview(page).getByRole('checkbox')).toHaveCount(2);
  await expect(preview(page).getByRole('checkbox').first()).toBeChecked();
  await expect(preview(page).getByRole('checkbox').first()).toBeDisabled();
  await expect(preview(page).locator('strong')).toHaveText('latte');
});

test('i pulsanti e Ctrl+E cambiano modalità, che resta dopo il ricaricamento', async ({ page }) => {
  await openApp(page);
  await modeButton(page, 'Modifica').click();
  await expect(modeButton(page, 'Modifica')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page)).toHaveCount(0);
  await expect(editor(page)).toBeVisible();

  // Ctrl+E dall'editor: Dal vivo e Affiancata restando nel testo, poi Anteprima con il focus
  // che passa all'anteprima.
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+E');
  await expect(modeButton(page, 'Dal vivo')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+E');
  await expect(modeButton(page, 'Affiancata')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+E');
  await expect(modeButton(page, 'Anteprima')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).toBeHidden();
  await expect(preview(page)).toBeFocused();

  await reloadUnlocked(page);
  await expect(modeButton(page, 'Anteprima')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('Nota di esempio');

  // Ctrl+E dall'anteprima torna a scrivere.
  await preview(page).focus();
  await page.keyboard.press('ControlOrMeta+E');
  await expect(modeButton(page, 'Modifica')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).toBeFocused();
});

test('doppio clic sull’anteprima: si scrive dalla riga del blocco toccato', async ({ page }) => {
  await openApp(page);
  await replaceText(page, '# Titolo\n\nPrimo paragrafo\n\nSecondo paragrafo');
  await modeButton(page, 'Anteprima').click();
  await expect(preview(page).locator('p').nth(1)).toHaveText('Secondo paragrafo');

  await preview(page).locator('p').nth(1).dblclick();
  await expect(modeButton(page, 'Modifica')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('>> ');
  await expect(editor(page)).toContainText('>> Secondo paragrafo');
});

test('nuova nota dalla sola anteprima: si torna all’affiancata per scrivere', async ({ page }) => {
  await openApp(page);
  await modeButton(page, 'Anteprima').click();
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await expect(modeButton(page, 'Affiancata')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('Appunti veloci');
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('Appunti veloci');
});

test('contenuti ostili: niente script, stili o richieste esterne, solo testo e avvisi', async ({
  page,
  baseURL,
}) => {
  const appOrigin = new URL(baseURL ?? '').origin;
  const foreign: string[] = [];
  const errors: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith('http') && url.origin !== appOrigin) foreign.push(req.url());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.addInitScript(() => {
    window.__violations = [];
    window.__dialogs = 0;
    window.alert = () => void window.__dialogs++;
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  await openApp(page);
  await replaceText(
    page,
    [
      '# Prova <img src=x onerror=alert(1)>',
      '<script>alert(1)</script>',
      '<style>body{display:none}</style>',
      '[clic](javascript:alert(1)) [dati](data:text/html,<script>alert(1)</script>)',
      '![schema](https://example.com/schema.png)',
      '![traccia](//example.com/pixel.gif)',
      '[repo](https://github.com/lucamilan/notepad-minus-minus)',
      '| a | b |',
      '|:-:|--:|',
      '| 1 | 2 |',
    ].join('\n'),
  );

  const view = preview(page);
  await expect(view.getByRole('heading', { level: 1 })).toHaveText(
    'Prova <img src=x onerror=alert(1)>',
  );
  await expect(view.locator('.blocked-image')).toHaveText(['Immagine esterna bloccata: schema']);
  // Senza schema http(s) non diventa nemmeno un'immagine: resta testo.
  await expect(view).toContainText('![traccia](//example.com/pixel.gif)');
  await expect(view.locator('img, script, style, iframe')).toHaveCount(0);
  await expect(view.getByRole('link')).toHaveCount(1);
  const link = view.getByRole('link', { name: 'repo' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(view.locator('th').first()).toHaveClass('align-center');

  expect(await page.evaluate(() => window.__dialogs)).toBe(0);
  expect(await page.evaluate(() => window.__violations)).toEqual([]);
  expect(await page.evaluate(() => document.querySelectorAll('style').length)).toBe(0);
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

test('cliccando i pulsanti il focus resta sul pulsante, anche dopo Ctrl+E', async ({ page }) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+E'); // da Affiancata ad Anteprima
  await expect(preview(page)).toBeFocused();
  await modeButton(page, 'Modifica').click();
  await modeButton(page, 'Affiancata').click();
  await expect(modeButton(page, 'Affiancata')).toBeFocused();
});

test('dalla sola anteprima: Invio torna a scrivere e gli annullamenti restano', async ({
  page,
}) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' parola');
  await modeButton(page, 'Anteprima').click();
  await expect(preview(page)).toContainText('parola');

  await preview(page).focus();
  await page.keyboard.press('Enter');
  await expect(modeButton(page, 'Modifica')).toHaveAttribute('aria-pressed', 'true');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor(page)).not.toContainText('parola');
});

test('cambiando scheda nella sola anteprima il focus va all’anteprima della nuova', async ({
  page,
}) => {
  await openApp(page);
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await page.keyboard.type('Seconda');
  await modeButton(page, 'Anteprima').click();
  await preview(page).focus();
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Nota di esempio');
  await expect(preview(page)).toBeFocused();
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('Nota di esempio');
});

test('doppio clic su un blocco di codice porta alla sua riga', async ({ page }) => {
  await openApp(page);
  await replaceText(page, 'Testo\n\n```\nnpm ci\n```');
  await modeButton(page, 'Anteprima').click();
  await preview(page).locator('pre').dblclick();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('X');
  await expect(editor(page)).toContainText('X```');
});
