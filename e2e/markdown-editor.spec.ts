import { expect, test, type Page } from '@playwright/test';
import { openUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });

async function replaceText(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

/** Stile calcolato dell'elemento più interno del testo che contiene `text`. */
async function styleOf(page: Page, text: string) {
  const element = editor(page).locator('span', { hasText: text }).last();
  return element.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      fontSize: parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight),
      fontStyle: style.fontStyle,
      color: style.color,
    };
  });
}

test('il Markdown si evidenzia nel testo, che resta sorgente', async ({ page }) => {
  await openUnlocked(page);
  await replaceText(page, '# Titolo grande\n\nTesto **forte** e *corsivo* e `codice`.');
  await expect(editor(page)).toContainText('# Titolo grande');
  await expect(editor(page)).toContainText('**forte**');

  const body = await editor(page)
    .locator('.cm-line')
    .last()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const heading = await styleOf(page, 'Titolo grande');
  expect(heading.fontSize).toBeGreaterThan(body * 1.2);
  expect(heading.fontWeight).toBeGreaterThanOrEqual(600);
  expect((await styleOf(page, 'forte')).fontWeight).toBeGreaterThanOrEqual(600);
  expect((await styleOf(page, 'corsivo')).fontStyle).toBe('italic');
  // I segni restano visibili, attenuati.
  const mark = await styleOf(page, '**');
  expect(mark.color).not.toBe((await styleOf(page, 'forte')).color);
});

test('Invio continua l’elenco; su una voce vuota ne esce', async ({ page }) => {
  await openUnlocked(page);
  await replaceText(page, '- [ ] latte');
  await page.keyboard.press('Enter');
  await page.keyboard.type('pane');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('fine');
  await expect
    .poll(() => editor(page).evaluate((el) => (el as HTMLElement).innerText))
    .toBe('- [ ] latte\n- [ ] pane\nfine');
});

test('scrivere sopra testo evidenziato non produce stili inline (CSP)', async ({ page }) => {
  await page.addInitScript(() => {
    window.__editorViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__editorViolations.push(e.violatedDirective);
    });
  });
  await openUnlocked(page);
  await replaceText(page, '# Titolo\n\nuno **forte** *corsivo* `codice` fine');
  // Selezione che attraversa titolo, grassetto e codice, poi battitura e incolla di testo.
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ControlOrMeta+End');
  await page.keyboard.type('x');
  await replaceText(page, '## Altro **titolo**');
  await expect(editor(page)).toHaveText('## Altro **titolo**');
  await expect(editor(page).locator('[style]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__editorViolations)).toEqual([]);
});

declare global {
  interface Window {
    __editorViolations: string[];
  }
}
