import { expect, test, type Page } from '@playwright/test';
import {
  openUnlocked,
  reloadUnlocked,
  setupVault,
  unlockVault,
  waitForPendingSaves,
  waitForServiceWorker,
} from './support';

/**
 * Collaudo finale (F9): i percorsi principali dall'inizio alla fine, le impostazioni che
 * restano, il telefono e un controllo di accessibilità senza dipendenze (nomi accessibili e
 * id unici al posto di axe).
 */

// Qui il service worker conta: attivo come per chi usa l'app (vedi playwright.config.ts).
test.use({ serviceWorkers: 'allow' });

test.afterEach(async ({ page }) => {
  await waitForPendingSaves(page);
  await waitForServiceWorker(page);
});

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const preview = (page: Page) => page.getByRole('article', { name: 'Anteprima della nota' });
const collection = (page: Page) => page.getByRole('complementary', { name: 'Raccolta' });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Viste e tag' });
const noteItems = (page: Page) => collection(page).locator('.note-item');
const modeButton = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Modalità di visualizzazione' }).getByRole('button', { name });

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Altro' }).click();
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  return page.getByRole('dialog', { name: 'Impostazioni' });
}

/**
 * Controlli visibili senza nome accessibile e id duplicati, nella pagina e negli shadow root
 * aperti (l'editor). Calcolo del nome semplificato: aria-labelledby, aria-label, <label>,
 * testo, title.
 */
async function accessibilityProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const interactive = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
      ...[
        'button',
        'tab',
        'menuitem',
        'menuitemradio',
        'option',
        'checkbox',
        'radio',
        'textbox',
        'combobox',
        'switch',
        'link',
      ].map((role) => `[role="${role}"]`),
    ].join(',');
    const roots: (Document | ShadowRoot)[] = [document];
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);

    const accessibleName = (el: Element, root: Document | ShadowRoot): string => {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => root.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      }
      const label = el.getAttribute('aria-label')?.trim();
      if (label) return label;
      const labels = (el as HTMLInputElement).labels;
      if (labels && labels.length > 0) {
        return [...labels]
          .map((l) => l.textContent ?? '')
          .join(' ')
          .trim();
      }
      if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) {
        return el.value.trim();
      }
      const isField =
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement ||
        el.getAttribute('contenteditable') === 'true';
      const text = isField ? '' : (el.textContent ?? '').trim();
      return text || (el.getAttribute('title') ?? '').trim();
    };

    for (const root of roots) {
      for (const el of root.querySelectorAll(interactive)) {
        if (!el.checkVisibility() || el.closest('[inert]')) continue;
        if (!accessibleName(el, root)) {
          problems.push(`senza nome: <${el.tagName.toLowerCase()} class="${el.className}">`);
        }
      }
      const seen = new Set<string>();
      for (const el of root.querySelectorAll('[id]')) {
        if (seen.has(el.id)) problems.push(`id duplicato: ${el.id}`);
        seen.add(el.id);
      }
    }
    return problems;
  });
}

test('percorso completo: nota con tag e attività, anteprima, ricerca, vista, fissata, blocco', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await setupVault(page);
  await expect(editor(page)).toContainText('Nota di esempio');

  // Una nota nuova con tag (con categoria) e un elenco di attività.
  await page.keyboard.press('Alt+N');
  await expect(editor(page)).toBeFocused();
  // La nota nuova parte con un titolo da riscrivere: si sostituisce tutto.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(
    '# Riunione Acme\n#cliente/acme #tipo/riunione\n\n- [x] agenda\n- [ ] verbale',
  );
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Riunione Acme');

  // Anteprima affiancata: titolo, attività di sola lettura, tag cliccabili.
  await expect(preview(page).getByRole('heading', { level: 1 })).toHaveText('Riunione Acme');
  await expect(preview(page).getByRole('checkbox')).toHaveCount(2);
  await expect(preview(page).getByRole('checkbox').first()).toBeChecked();
  await expect(preview(page).getByRole('checkbox').last()).toBeDisabled();
  await expect(page.locator('.save-state')).toHaveText(/^Salvato alle/);

  // Ricerca globale.
  await page.keyboard.press('ControlOrMeta+K');
  const search = page.getByRole('dialog', { name: 'Cerca nelle note' });
  await page.keyboard.type('verbale');
  await expect(search.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(search).toBeHidden();
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Riunione Acme');

  // Vista salvata dal filtro per tag.
  await nav(page).getByRole('button', { name: /^acme/ }).click();
  await collection(page).getByRole('button', { name: 'Salva come vista' }).click();
  await collection(page).getByRole('textbox', { name: 'Nome della vista' }).fill('Cliente Acme');
  await page.keyboard.press('Enter');
  await expect(nav(page).getByRole('button', { name: /^Cliente Acme/ })).toBeVisible();

  // Nota fissata.
  await page.getByRole('button', { name: 'Fissa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fissa', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await waitForPendingSaves(page);

  // Blocco con Alt+L: dalla pagina sparisce tutto.
  await page.keyboard.press('Alt+L');
  await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toContain('Riunione Acme');

  await unlockVault(page);
  await expect(page.getByRole('tab')).toHaveText(['Nota di esempio', 'Riunione Acme']);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Riunione Acme');
  await expect(editor(page)).toContainText('- [ ] verbale');
  await nav(page)
    .getByRole('button', { name: /^Cliente Acme/ })
    .click();
  await expect(noteItems(page)).toHaveCount(1);
  await nav(page)
    .getByRole('button', { name: /^Fissate/ })
    .click();
  await expect(noteItems(page)).toHaveCount(1);
  await expect(noteItems(page)).toContainText('Riunione Acme');
  await nav(page)
    .getByRole('button', { name: /^Attività aperte/ })
    .click();
  await expect(noteItems(page)).toContainText('Riunione Acme');
});

test('tema, modalità, raccolta e blocco automatico restano dopo il ricaricamento', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await openUnlocked(page);
  await expect(editor(page)).toContainText('Nota di esempio');

  const settings = await openSettings(page);
  await settings.getByRole('radio', { name: 'Scuro' }).check();
  await settings.getByLabel('Blocco automatico dopo').selectOption('30');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await modeButton(page, 'Anteprima').click();
  await page.getByRole('button', { name: 'Raccolta' }).click();
  await expect(collection(page)).toHaveCount(0);

  await reloadUnlocked(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(modeButton(page, 'Anteprima')).toHaveAttribute('aria-pressed', 'true');
  await expect(preview(page)).toBeVisible();
  await expect(collection(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Raccolta' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const reopened = await openSettings(page);
  await expect(reopened.getByRole('radio', { name: 'Scuro' })).toBeChecked();
  await expect(reopened.getByLabel('Blocco automatico dopo')).toHaveValue('30');
});

test('sul telefono (390×844) blocco e note si usano senza scorrere di lato', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const scrollsSideways = () =>
    page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Proteggi le tue note' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crea la passphrase' })).toBeInViewport();
  expect(await scrollsSideways()).toBe(false);
  await setupVault(page);

  await expect(editor(page)).toContainText('Nota di esempio');
  expect(await scrollsSideways()).toBe(false);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nDal telefono');
  await expect(editor(page)).toContainText('Dal telefono');
  await expect(page.getByRole('button', { name: '+ Nuova nota' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Blocca' })).toBeInViewport();

  // "Chiudi tutte le schede" resta visibile e staccata da "+ Nuova nota", anche con molte schede.
  const newTab = page.getByRole('button', { name: '+ Nuova nota' });
  const closeAll = page.getByRole('button', { name: 'Chiudi tutte le schede' });
  const gap = async () => {
    const [a, b] = [await newTab.boundingBox(), await closeAll.boundingBox()];
    return a && b ? b.x - (a.x + a.width) : -1;
  };
  await expect(closeAll).toBeInViewport({ ratio: 1 });
  expect(await gap()).toBeGreaterThanOrEqual(16);
  for (let i = 0; i < 5; i++) await newTab.click();
  await expect(page.getByRole('tab')).toHaveCount(6);
  await expect(newTab).toBeInViewport({ ratio: 1 });
  await expect(closeAll).toBeInViewport({ ratio: 1 });
  expect(await gap()).toBeGreaterThanOrEqual(16);
  expect(await scrollsSideways()).toBe(false);

  // La raccolta è un pannello sopra le note.
  await page.getByRole('button', { name: 'Raccolta' }).click();
  await expect(collection(page)).toBeVisible();
  expect(await scrollsSideways()).toBe(false);
  await page.keyboard.press('Escape');
  await expect(collection(page)).toBeHidden();

  await page.getByRole('button', { name: 'Blocca' }).click();
  await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();
  expect(await scrollsSideways()).toBe(false);
});

test('ogni controllo ha un nome accessibile e non ci sono id duplicati', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Proteggi le tue note' })).toBeVisible();
  expect(await accessibilityProblems(page), 'creazione della passphrase').toEqual([]);
  await setupVault(page);

  // Note con attività e tag: anteprima, raccolta e schede piene.
  await page.keyboard.press('Alt+N');
  await page.keyboard.insertText('# Attività\n#progetto/sito\n- [ ] prima\n- [x] seconda');
  await expect(preview(page).getByRole('checkbox')).toHaveCount(2);
  expect(await accessibilityProblems(page), 'area delle note').toEqual([]);

  await page.getByRole('button', { name: 'Altro' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  expect(await accessibilityProblems(page), 'menu "Altro"').toEqual([]);
  await page.getByRole('menuitem', { name: 'Impostazioni' }).click();
  await expect(page.getByRole('dialog', { name: 'Impostazioni' })).toBeVisible();
  expect(await accessibilityProblems(page), 'impostazioni').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Cerca', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Cerca nelle note' });
  await search.getByRole('combobox').fill('attività');
  await expect(search.getByRole('option')).toHaveCount(1);
  expect(await accessibilityProblems(page), 'ricerca').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Elimina…' }).click();
  await expect(page.getByRole('dialog', { name: 'Eliminare questa nota?' })).toBeVisible();
  expect(await accessibilityProblems(page), 'conferma eliminazione').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Chiudi tutte le schede' }).click();
  await expect(page.getByRole('heading', { name: 'Nessuna nota aperta' })).toBeVisible();
  expect(await accessibilityProblems(page), 'nessuna nota aperta').toEqual([]);

  await waitForPendingSaves(page);
  await page.keyboard.press('Alt+L');
  await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();
  expect(await accessibilityProblems(page), 'note bloccate').toEqual([]);
});
