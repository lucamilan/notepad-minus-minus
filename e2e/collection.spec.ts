import { expect, test, type Page } from '@playwright/test';
import { waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const collection = (page: Page) => page.getByRole('complementary', { name: 'Raccolta' });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Viste e tag' });
const noteItems = (page: Page) => collection(page).locator('.note-item');

async function openApp(page: Page) {
  await page.goto('/');
  await expect(editor(page)).toContainText('Nota di esempio');
}

/** Crea una nota con questo testo (Alt+N, poi sostituisce tutto). */
async function addNote(page: Page, text: string) {
  await page.keyboard.press('Alt+N');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

async function seed(page: Page) {
  await openApp(page);
  await editor(page).click();
  await addNote(page, '# Kickoff portale\n#cliente/acme #tipo/riunione\n- [ ] mockup');
  await addNote(page, '# Preventivo Acme\n#cliente/acme\nAnalisi 4 giorni');
  await addNote(page, 'Lista spesa\n#personale\n- caffè');
  await expect(page.locator('.save-state')).toHaveText(/^Salvato alle/);
}

test('la raccolta mostra viste e tag per categoria; i tag filtrano l’elenco', async ({ page }) => {
  await seed(page);
  await expect(nav(page).getByRole('button', { name: /^Tutte/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(noteItems(page)).toHaveCount(4);
  await expect(nav(page).getByRole('heading', { name: 'Clienti' })).toBeVisible();

  await nav(page).getByRole('button', { name: /^acme/ }).click();
  await expect(noteItems(page)).toHaveCount(2);
  await expect(collection(page).getByRole('heading', { name: 'Filtrate' })).toBeVisible();

  await nav(page)
    .getByRole('button', { name: /^Attività aperte/ })
    .click();
  await expect(noteItems(page)).toHaveCount(1);
  await expect(noteItems(page)).toContainText('Kickoff portale');

  // Clic su una nota dell'elenco: si apre nella scheda e il focus va al testo.
  await noteItems(page).first().click();
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Kickoff portale');
  await expect(editor(page)).toBeFocused();
});

test('salva il filtro come vista, che resta dopo il ricaricamento e si può eliminare', async ({
  page,
}) => {
  await seed(page);
  await nav(page).getByRole('button', { name: /^acme/ }).click();
  await collection(page).getByRole('button', { name: 'Salva come vista' }).click();
  const name = collection(page).getByRole('textbox', { name: 'Nome della vista' });
  await expect(name).toHaveValue('Acme');
  await name.fill('Cliente Acme');
  await page.keyboard.press('Enter');
  await expect(nav(page).getByRole('button', { name: /^Cliente Acme/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.reload();
  await expect(editor(page)).toBeVisible();
  await nav(page)
    .getByRole('button', { name: /^Cliente Acme/ })
    .click();
  await expect(noteItems(page)).toHaveCount(2);
  await nav(page).getByRole('button', { name: 'Elimina la vista Cliente Acme' }).click();
  await expect(nav(page).getByRole('button', { name: /^Cliente Acme/ })).toHaveCount(0);
});

test('una nota fissata sta in cima e nella vista Fissate, anche dopo il ricaricamento', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('tab', { name: 'Kickoff portale' }).click();
  const pin = page.getByRole('button', { name: 'Fissa', exact: true });
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await expect(noteItems(page).first()).toContainText('Kickoff portale');
  await page.reload();
  await nav(page)
    .getByRole('button', { name: /^Fissate/ })
    .click();
  await expect(noteItems(page)).toHaveCount(1);
  await expect(noteItems(page)).toContainText('Kickoff portale');
});

test('elimina chiede conferma: Annulla non tocca nulla, Elimina cancella per sempre', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Elimina…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Eliminare questa nota?' });
  await expect(dialog).toContainText('"Lista spesa"');
  await expect(dialog.getByRole('button', { name: 'Annulla' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Elimina…' })).toBeFocused();
  await expect(noteItems(page)).toHaveCount(4);

  await page.getByRole('button', { name: 'Elimina…' }).click();
  await dialog.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(noteItems(page)).toHaveCount(3);
  await expect(page.getByRole('tab', { name: 'Lista spesa' })).toHaveCount(0);
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(noteItems(page)).toHaveCount(3);
  await expect(collection(page)).not.toContainText('Lista spesa');
});

test('Ctrl+K cerca in tutte le note; Invio apre la nota scelta', async ({ page }) => {
  await seed(page);
  await page.keyboard.press('ControlOrMeta+K');
  const dialog = page.getByRole('dialog', { name: 'Cerca nelle note' });
  const input = dialog.getByRole('combobox');
  await expect(input).toBeFocused();
  await page.keyboard.type('CAFFE');
  const options = dialog.getByRole('option');
  await expect(options).toHaveCount(1);
  await expect(options.first().locator('mark')).toHaveText('caffè');
  await expect(input).toHaveAttribute('aria-activedescendant', 'search-option-0');

  await page.keyboard.press('Control+A');
  await page.keyboard.type('#acme');
  await expect(options).toHaveCount(2);
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  const chosen = (await options.nth(1).locator('.search-option-title').innerText()).split('\n')[0];
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { selected: true })).toHaveText(chosen ?? '');
  await expect(editor(page)).toBeFocused();

  // Esc chiude e riporta il focus dov'era.
  await page.keyboard.press('ControlOrMeta+K');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(editor(page)).toBeFocused();
});

test('scrivendo # l’editor suggerisce i tag già usati', async ({ page }) => {
  await seed(page);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' #acm');
  const suggestion = page.locator('.editor-host').getByRole('option', { name: /cliente\/acme/ });
  await expect(suggestion).toBeVisible();
  // Invio senza aver scelto va a capo: chi scrive un tag nuovo non se lo vede sostituire.
  await expect(suggestion).not.toHaveAttribute('aria-selected', 'true');
  // Con la freccia si sceglie; CodeMirror ignora i tasti nei primi 75 ms (interactionDelay).
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');
  await expect(suggestion).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(editor(page)).toContainText('#cliente/acme ');
});

test('Ctrl+\\ nasconde e mostra la raccolta, e la scelta resta', async ({ page }) => {
  await openApp(page);
  await expect(collection(page)).toBeVisible();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+Backslash');
  await expect(collection(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Raccolta' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(collection(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Raccolta' }).click();
  await expect(collection(page)).toBeVisible();
});

test('la stessa nota modificata in un’altra scheda: avviso e scelta della versione', async ({
  page,
  context,
}) => {
  await openApp(page);
  const other = await context.newPage();
  await openApp(other);

  await editor(other).click();
  await other.keyboard.press('ControlOrMeta+End');
  await other.keyboard.type(' (dall’altra scheda)');
  await expect(other.locator('.save-state')).toHaveText(/^Salvato alle/);

  const notice = page.getByRole('alert').filter({ hasText: 'modificata in un’altra scheda' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Carica l’altra versione' }).click();
  await expect(notice).toBeHidden();
  await expect(editor(page)).toContainText('(dall’altra scheda)');
  await waitForPendingSaves(other);
  await other.close();
});

test('una nota nuova creata in un’altra scheda compare nella raccolta', async ({
  page,
  context,
}) => {
  await openApp(page);
  const other = await context.newPage();
  await openApp(other);
  await editor(other).click();
  await addNote(other, '# Dall’altra scheda');
  await expect(other.locator('.save-state')).toHaveText(/^Salvato alle/);
  await expect(noteItems(page).filter({ hasText: 'Dall’altra scheda' })).toHaveCount(1);
  await waitForPendingSaves(other);
  await other.close();
});

test('su schermi stretti la raccolta è un pannello: prende il focus e lo restituisce', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await openApp(page);
  await expect(collection(page)).toHaveCount(0);
  const toggle = page.getByRole('button', { name: 'Raccolta' });
  await toggle.click();
  await expect(collection(page)).toBeVisible();
  await expect(collection(page).getByRole('button', { name: /Cerca nelle note/ })).toBeFocused();
  // Le note sotto il pannello sono inerti.
  await expect(page.locator('.workspace-main')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(collection(page)).toHaveCount(0);
  await expect(toggle).toBeFocused();

  // Scegliendo una nota il pannello si chiude e si scrive subito.
  await toggle.click();
  await collection(page).locator('.note-item').first().click();
  await expect(collection(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});
