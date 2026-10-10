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

  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(
      () => !!document.activeElement?.closest('dialog') || document.activeElement === document.body,
    );
    expect(inside).toBe(true);
  }
  await expect(dialog).toBeVisible();
});
