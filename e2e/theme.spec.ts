import { expect, test } from '@playwright/test';
import { openUnlocked, reloadUnlocked } from './support';

test('il tema scelto nelle impostazioni resta dopo il ricaricamento', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openUnlocked(page);
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme');

  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  const dialog = page.getByRole('dialog', { name: 'Impostazioni' });
  await dialog.getByRole('radio', { name: 'Scuro' }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await reloadUnlocked(page);
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(15, 19, 23)',
  );
  // Le variabili CSS del tema arrivano anche dentro lo shadow root dell'editor.
  const editorBackground = await page.evaluate(() => {
    const editor = document.querySelector('.editor-host')?.shadowRoot?.querySelector('.cm-editor');
    return editor ? getComputedStyle(editor).backgroundColor : null;
  });
  expect(editorBackground).toBe('rgb(22, 27, 33)');

  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Sistema' }).check();
  await expect(html).not.toHaveAttribute('data-theme');
});

test('"Sistema" segue il tema scuro del computer', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(15, 19, 23)',
  );
});
