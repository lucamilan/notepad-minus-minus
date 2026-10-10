import { expect, test, type Page } from '@playwright/test';
import { openUnlocked, reloadUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const saveState = (page: Page) => page.locator('.save-state');

async function openApp(page: Page) {
  await openUnlocked(page);
  await expect(editor(page)).toContainText('Nota di esempio');
  await expect(saveState(page)).toHaveText('Salvato nel browser');
}

test('le modifiche si salvano da sole dopo una pausa e restano dopo il ricaricamento', async ({
  page,
}) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nRiga aggiunta');

  await expect(saveState(page)).toHaveText(/^Salvato alle \d{2}:\d{2}$/);
  await reloadUnlocked(page);
  await expect(editor(page)).toContainText('Riga aggiunta');
});

test('Ctrl+S salva subito e lo annuncia ai lettori di schermo', async ({ page }) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Urgente: ');

  // Il browser non deve aprire "Salva pagina con nome": l'evento va annullato.
  await page.evaluate(() => {
    // Il primo keydown è quello del solo Ctrl: conta quello della S.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyS') return;
      document.documentElement.setAttribute('data-test-prevented', String(e.defaultPrevented));
    });
  });
  await page.keyboard.press('Control+KeyS');
  await expect(page.locator('html')).toHaveAttribute('data-test-prevented', 'true');
  await expect(page.locator('.sr-only[aria-live="polite"]')).toHaveText(
    /^Tutte le note salvate alle/,
  );
  await expect(saveState(page)).toHaveText(/^Salvato alle/);

  await reloadUnlocked(page);
  await expect(editor(page)).toContainText('Urgente: # Nota di esempio');
  await expect(page.getByRole('tab').first()).toHaveText('Urgente: # Nota di esempio');
});

test('passando da una scheda all’altra si salvano tutte le note modificate', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await page.keyboard.type('Prima nuova');
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' (modificata)');

  await expect(saveState(page)).toHaveText(/^Salvato alle/);
  await reloadUnlocked(page);
  await expect(page.getByRole('tab')).toHaveText(['Nota di esempio', 'Prima nuova']);
  await expect(editor(page)).toContainText('(modificata)');
});
