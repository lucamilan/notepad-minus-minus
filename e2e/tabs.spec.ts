import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Note aperte' }).getByRole('tab');

async function openApp(page: Page) {
  await page.goto('/');
  await expect(editor(page)).toContainText('Nota di esempio');
}

test('una nota nuova si apre in una scheda col titolo pronto da riscrivere', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '+ Nuova nota' }).click();

  await expect(tabs(page)).toHaveCount(2);
  const created = tabs(page).nth(1);
  await expect(created).toHaveAttribute('aria-selected', 'true');
  await expect(created).toHaveText('Nuova nota');
  await expect(editor(page)).toBeFocused();

  // "Nuova nota" è selezionato: scrivendo lo si sostituisce e la scheda segue il titolo.
  await page.keyboard.type('Preventivo per il cliente Rossi, seconda versione');
  await expect(created).toHaveText('Preventivo per il cliente R...');
  await expect(created).toHaveAttribute(
    'title',
    /^"Preventivo per il cliente Rossi, seconda versione" creata il \d/,
  );
  await expect(page.locator('.status')).toContainText('Creata il');

  // Dopo il ricaricamento le schede restano aperte (il testo si salverà da F4).
  await page.reload();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs(page).nth(1)).toHaveText('Nuova nota');
});

test('le schede si usano da tastiera e chiuderle non elimina le note', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await expect(tabs(page)).toHaveCount(2);

  const [sample, created] = [tabs(page).nth(0), tabs(page).nth(1)];
  await created.focus();
  await page.keyboard.press('ArrowRight'); // dall'ultima si riparte dalla prima
  await expect(sample).toBeFocused();
  await expect(sample).toHaveAttribute('aria-selected', 'true');
  await expect(editor(page)).toContainText('Nota di esempio');

  await page.keyboard.press('End');
  await expect(created).toBeFocused();
  await expect(created).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Delete');
  await expect(tabs(page)).toHaveCount(1);
  await expect(sample).toBeFocused();
  await expect(sample).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Delete');
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nessuna nota aperta' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Nuova nota' })).toBeFocused();

  // Le note sono ancora nell'archivio e si riaprono, anche dopo un ricaricamento.
  await page.reload();
  const reopen = page.getByRole('list', { name: "Note nell'archivio" }).getByRole('button');
  await expect(reopen).toHaveCount(2);
  await reopen.filter({ hasText: 'Nota di esempio' }).click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toBeFocused();
  await expect(editor(page)).toContainText('Nota di esempio');
});

test('scorciatoie: Alt+N crea, Ctrl+Alt+frecce cambia scheda, Alt+W chiude', async ({ page }) => {
  await openApp(page);
  await editor(page).click();

  await page.keyboard.press('Alt+KeyN');
  await expect(tabs(page)).toHaveCount(2);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Seconda');
  await expect(tabs(page).nth(1)).toHaveText('Seconda');

  // Il testo non salvato resta in memoria passando da una scheda all'altra.
  await page.keyboard.press('Control+Alt+ArrowLeft');
  await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Control+Alt+ArrowRight');
  await expect(editor(page)).toContainText('Seconda');

  await page.keyboard.press('Alt+KeyW');
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toBeFocused();
});

test('scrivendo subito dopo aver creato una nota non si perdono caratteri', async ({ page }) => {
  await openApp(page);
  // Nessuna attesa tra la creazione e la digitazione: l'editor deve essere già pronto.
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await page.keyboard.type('Lista spesa');
  await page.keyboard.press('Alt+KeyN');
  await page.keyboard.type('Riunione');

  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(1)).toHaveText('Lista spesa');
  await expect(tabs(page).nth(2)).toHaveText('Riunione');
});

test('il clic centrale chiude la scheda attiva e il focus resta sulle schede', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(editor(page)).toBeFocused();

  await tabs(page).nth(1).click({ button: 'middle' });
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toBeFocused();
});

test('su mobile con molte schede la pagina non scorre e "+ Nuova nota" resta visibile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await openApp(page);
  const add = page.getByRole('button', { name: '+ Nuova nota' });
  for (let i = 0; i < 6; i++) await add.click();
  await expect(tabs(page)).toHaveCount(7);

  await expect(add).toBeInViewport({ ratio: 1 });
  await expect(tabs(page).last()).toBeInViewport({ ratio: 1 });
  const layout = await page.evaluate(() => {
    const bar = document.querySelector('.tabs');
    return {
      pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
      barScrollsVertically: bar ? bar.scrollHeight > bar.clientHeight : true,
    };
  });
  expect(layout).toEqual({ pageScrolls: false, barScrollsVertically: false });
});

test('il × chiude la scheda col mouse', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await expect(tabs(page)).toHaveCount(2);

  await page.locator('.tab').first().locator('.tab-close').click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveText('Nuova nota');
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true');
});
