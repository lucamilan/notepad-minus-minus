import { expect, test, type Page } from '@playwright/test';
import { leaveZenWithEscape, openUnlocked, reloadUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

declare global {
  interface Window {
    __liveViolations: string[];
  }
}

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const modeButton = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Modalità di visualizzazione' }).getByRole('button', { name });
const lineText = (page: Page, n: number) =>
  editor(page)
    .locator('.cm-line')
    .nth(n)
    .evaluate((el) => (el as HTMLElement).innerText);

const ARTICLE = [
  '# Titolo',
  '',
  'Testo **forte**, *corsivo*, ~~via~~, `codice` e [un link](https://example.com "titolo").',
  '',
  '> citazione',
  '',
  '- [ ] da fare',
  '- punto',
  '',
  '---',
  '',
  'fine',
].join('\n');

async function openLive(page: Page) {
  await page.addInitScript(() => {
    window.__liveViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__liveViolations.push(e.violatedDirective);
    });
  });
  await openUnlocked(page);
  await modeButton(page, 'Dal vivo').click();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(ARTICLE);
  // Il cursore sull'ultima riga: tutte le altre si vedono formattate.
  await expect(modeButton(page, 'Dal vivo')).toHaveAttribute('aria-pressed', 'true');
}

test('fuori dalla riga del cursore i segni spariscono, il testo no', async ({ page }) => {
  await openLive(page);
  await expect.poll(() => lineText(page, 0)).toBe('Titolo');
  expect(await lineText(page, 2)).toBe('Testo forte, corsivo, via, codice e un link.');
  expect(await lineText(page, 4)).toBe('citazione');
  expect(await lineText(page, 7)).toBe('• punto');
  await expect(editor(page).locator('.cm-live-hr')).toHaveCount(1);
  await expect(editor(page).getByRole('checkbox', { name: 'da fare' })).not.toBeChecked();
  // Nessuna anteprima a fianco: il testo è l'anteprima.
  await expect(page.getByRole('article', { name: 'Anteprima della nota' })).toHaveCount(0);

  // Sulla riga del cursore torna il sorgente.
  await page.keyboard.press('ControlOrMeta+Home');
  await expect.poll(() => lineText(page, 0)).toBe('# Titolo');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => lineText(page, 2))
    .toBe(
      'Testo **forte**, *corsivo*, ~~via~~, `codice` e [un link](https://example.com "titolo").',
    );
  expect(await lineText(page, 0)).toBe('Titolo');

  await expect(editor(page).locator('[style]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__liveViolations)).toEqual([]);
});

test('la casella di un’attività cambia il testo della nota, che si salva', async ({ page }) => {
  await openLive(page);
  await editor(page).getByRole('checkbox', { name: 'da fare' }).click();
  await expect(editor(page).getByRole('checkbox', { name: 'da fare' })).toBeChecked();
  await expect(page.locator('.save-state')).toHaveAttribute('data-state', 'saved');

  await reloadUnlocked(page);
  await expect(modeButton(page, 'Dal vivo')).toHaveAttribute('aria-pressed', 'true');
  await modeButton(page, 'Modifica').click();
  await expect(editor(page)).toContainText('- [x] da fare');
});

test('Dal vivo funziona anche in zen; Modifica torna al sorgente', async ({ page }) => {
  await openLive(page);
  await page.keyboard.press('Alt+Z');
  await expect(page.locator('.zen-bar')).toBeVisible();
  await expect.poll(() => lineText(page, 0)).toBe('Titolo');
  await leaveZenWithEscape(page);
  await modeButton(page, 'Modifica').click();
  await expect.poll(() => lineText(page, 0)).toBe('# Titolo');
  await expect(editor(page).getByRole('checkbox')).toHaveCount(0);
});
