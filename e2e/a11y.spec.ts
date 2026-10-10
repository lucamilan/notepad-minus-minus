import { expect, test } from '@playwright/test';

test('il menu si usa da tastiera e restituisce il focus al pulsante', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Altro' });

  await trigger.focus();
  await page.keyboard.press('Enter');
  const item = page.getByRole('menuitem', { name: 'Impostazioni' });
  await expect(item).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('ArrowDown');
  await expect(item).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

for (const how of ['Escape', 'Chiudi', 'sfondo'] as const) {
  test(`chiudendo le impostazioni con ${how} il focus torna su "Altro"`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Altro' });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
    const dialog = page.getByRole('dialog', { name: 'Impostazioni' });
    await expect(dialog).toBeVisible();

    if (how === 'Escape') await page.keyboard.press('Escape');
    else if (how === 'Chiudi') await dialog.getByRole('button', { name: 'Chiudi' }).click();
    else await page.mouse.click(100, 360);

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test('con le impostazioni aperte il Tab resta dentro il pannello', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  const dialog = page.getByRole('dialog', { name: 'Impostazioni' });

  // Uscendo dall'ultimo elemento il browser può portare il focus sulla propria interfaccia
  // (activeElement = body o html): conta solo che non arrivi a elementi della pagina sotto.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return 'browser';
      if (el.closest('dialog')) return 'dialog';
      return `${el.tagName.toLowerCase()}.${el.className}`;
    });
    expect(['dialog', 'browser'], `focus finito su ${focused}`).toContain(focused);
  }
  await expect(dialog).toBeVisible();
});
