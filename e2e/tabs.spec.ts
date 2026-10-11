import { expect, test, type Page } from '@playwright/test';
import { openUnlocked, reloadUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Note aperte' }).getByRole('tab');

async function openApp(page: Page) {
  await openUnlocked(page);
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

  // Dopo il ricaricamento schede e testo salvato sono ancora lì.
  await expect(page.locator('.save-state')).toHaveText(/^Salvato alle/);
  await reloadUnlocked(page);
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs(page).nth(1)).toHaveText('Preventivo per il cliente R...');
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
  await reloadUnlocked(page);
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

test('un doppio clic su "+ Nuova nota" crea una sola nota', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '+ Nuova nota' }).dblclick();
  await expect(tabs(page)).toHaveCount(2);
  await page.waitForTimeout(300);
  await expect(tabs(page)).toHaveCount(2);
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

const closeAll = (page: Page) => page.getByRole('button', { name: 'Chiudi tutte le schede' });
const noteItems = (page: Page) =>
  page.getByRole('complementary', { name: 'Raccolta' }).locator('.note-item');

test('"Chiudi tutte le schede" chiude le schede ma non le note', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await page.keyboard.type('Seconda');
  await page.keyboard.press('Alt+KeyN');
  await page.keyboard.type('Terza');
  await expect(tabs(page)).toHaveCount(3);
  await expect(closeAll(page)).toHaveAttribute('title', 'Chiudi tutte le schede (Alt+Shift+W)');
  await expect(closeAll(page)).toHaveAttribute('aria-keyshortcuts', 'Alt+Shift+W');

  // Subito, con "Terza" ancora da salvare: chiudere non scarta le modifiche.
  await closeAll(page).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nessuna nota aperta' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Nuova nota' })).toBeFocused();
  await expect(closeAll(page)).toHaveCount(0);
  await expect(noteItems(page)).toHaveCount(3);

  await expect(page.locator('.save-state')).toHaveText(/^Salvato/);
  await reloadUnlocked(page);
  await expect(tabs(page)).toHaveCount(0);
  const reopen = page.getByRole('list', { name: "Note nell'archivio" }).getByRole('button');
  await expect(reopen).toHaveCount(3);
  await expect(reopen.filter({ hasText: 'Terza' })).toHaveCount(1);
});

test('"Chiudi le schede non fissate" lascia aperte solo le note fissate', async ({ page }) => {
  await openApp(page);
  const closeUnpinned = page.getByRole('button', { name: 'Chiudi le schede non fissate' });
  // La nota di esempio, unica scheda e non fissata: il pulsante chiuderebbe solo quella.
  await expect(closeUnpinned).toBeEnabled();
  await page.getByRole('button', { name: 'Fissa', exact: true }).click();
  await expect(closeUnpinned).toBeDisabled();
  await page.getByRole('button', { name: '+ Nuova nota' }).click();
  await page.keyboard.type('Seconda');
  await page.keyboard.press('Alt+KeyN');
  await page.keyboard.type('Terza');
  await expect(tabs(page)).toHaveCount(3);
  await expect(closeUnpinned).toHaveAttribute('title', 'Chiudi le schede non fissate');

  await closeUnpinned.click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveText('Nota di esempio');
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true');
  await expect(closeUnpinned).toBeDisabled();
  await expect(noteItems(page)).toHaveCount(3);
});

test('Alt+Shift+W chiude tutte le schede; la pagina vuota si usa da tastiera', async ({ page }) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press('Alt+KeyN');
  await page.keyboard.type('Seconda');
  await expect(tabs(page)).toHaveCount(2);

  await page.keyboard.press('Alt+Shift+KeyW');
  await expect(tabs(page)).toHaveCount(0);
  const newTab = page.getByRole('button', { name: '+ Nuova nota' });
  await expect(newTab).toBeFocused();

  // Da "+ Nuova nota": Nuova nota, Cerca, poi le note da riaprire.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Nuova nota', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const search = page.getByRole('button', { name: 'Cerca nelle note (Ctrl+K)' });
  await expect(search).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Cerca nelle note' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(search).toBeFocused();

  await page.keyboard.press('Tab');
  const reopen = page.getByRole('list', { name: "Note nell'archivio" }).getByRole('button');
  await expect(reopen.first()).toBeFocused();
  await expect(reopen.first()).toContainText('Seconda');
  await page.keyboard.press('Enter');
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toBeFocused();
  await expect(editor(page)).toContainText('Seconda');

  // Senza schede Alt+Shift+W non fa nulla di male.
  await page.keyboard.press('Alt+Shift+KeyW');
  await page.keyboard.press('Alt+Shift+KeyW');
  await expect(tabs(page)).toHaveCount(0);
  await expect(newTab).toBeFocused();
});
