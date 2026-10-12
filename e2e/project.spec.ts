import { expect, test, type Page } from '@playwright/test';
import { openUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const collection = (page: Page) => page.getByRole('complementary', { name: 'Raccolta' });
const noteItems = (page: Page) => collection(page).locator('.note-item');
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Note aperte' }).getByRole('tab');
const projectBar = (page: Page) => page.getByRole('region', { name: /^Progetto/ });

async function addNote(page: Page, text: string) {
  await page.keyboard.press('Alt+N');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

async function seed(page: Page) {
  await openUnlocked(page);
  await expect(editor(page)).toContainText('Nota di esempio');
  await editor(page).click();
  await addNote(page, '# Kickoff portale\n#progetto/portale\n- [ ] mockup');
  await addNote(page, '# Lista spesa\n#personale');
  await addNote(page, '# Specifiche portale\n#progetto/portale #cliente/acme');
  await expect(page.locator('.save-state')).toHaveText(/^Salvato alle/);
  await expect(tabs(page)).toHaveCount(4);
}

test('il progetto mostra solo le sue note e schede; uscendo torna tutto', async ({ page }) => {
  await seed(page);

  await collection(page).getByRole('button', { name: 'Apri il progetto portale' }).click();
  await expect(projectBar(page)).toContainText('Progetto portale');
  await expect(projectBar(page)).toContainText('2 note');
  await expect(projectBar(page).getByRole('heading')).toBeFocused();
  await expect(tabs(page)).toHaveText(['Kickoff portale', 'Specifiche portale']);
  await expect(noteItems(page)).toHaveCount(2);
  await expect(collection(page).getByRole('heading', { name: 'portale' })).toBeVisible();

  // Una nota nuova nasce nel progetto.
  await editor(page).click();
  await page.keyboard.press('Alt+N');
  await expect(editor(page)).toContainText('#progetto/portale');
  // Il titolo è selezionato: si scrive sopra.
  await page.keyboard.insertText('Rilascio');
  await expect(tabs(page)).toHaveCount(3);
  await expect(noteItems(page)).toHaveCount(3);

  // "Chiudi tutte le schede" chiude solo quelle del progetto.
  await page.getByRole('button', { name: 'Chiudi tutte le schede' }).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Nessuna nota aperta nel progetto portale' }),
  ).toBeVisible();
  await expect(page.locator('.reopen li')).toHaveCount(3);

  await projectBar(page).getByRole('button', { name: 'Esci dal progetto' }).click();
  await expect(projectBar(page)).toHaveCount(0);
  await expect(tabs(page)).toHaveText(['Nota di esempio', 'Lista spesa']);
  await expect(noteItems(page)).toHaveCount(5);
});

test('la ricerca resta nel progetto; in tutte le note, aprirne una fuori esce', async ({
  page,
}) => {
  await seed(page);
  await collection(page).getByRole('button', { name: 'Apri il progetto portale' }).click();

  await page.keyboard.press('ControlOrMeta+K');
  const search = page.getByRole('dialog', { name: 'Cerca nelle note' });
  await page.keyboard.insertText('spesa');
  await expect(search.getByRole('option')).toHaveCount(0);

  await search.getByRole('checkbox', { name: 'Solo nel progetto portale' }).uncheck();
  await expect(search.getByRole('option')).toHaveCount(1);
  await search.getByRole('combobox').press('Enter');

  await expect(projectBar(page)).toHaveCount(0);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Lista spesa');
  await expect(tabs(page)).toHaveCount(4);
});
