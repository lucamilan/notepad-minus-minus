import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { openUnlocked, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });
const saveButton = (page: Page) => page.getByRole('button', { name: 'Salva .md' });
const NOTE_TEXT = '# Perché il caffè?\n\n- [ ] comprarlo\n';

async function writeNote(page: Page) {
  await openUnlocked(page);
  await expect(editor(page)).toContainText('Nota di esempio');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  // Modifica non ancora salvata: il file la comprende.
  await page.keyboard.insertText(NOTE_TEXT);
}

test('senza selettore di file la nota si scarica come slug-del-titolo.md', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await writeNote(page);
  await expect(saveButton(page)).toHaveAttribute(
    'title',
    'Salva la nota in un file Markdown (.md), non cifrato',
  );
  const downloading = page.waitForEvent('download');
  await saveButton(page).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('perche-il-caffe.md');
  const path = await download.path();
  // Il testo esatto della nota (Windows non c'entra: niente CRLF aggiunti).
  expect(await readFile(path, 'utf8')).toBe(NOTE_TEXT);
  await expect(page.locator('.sr-only[aria-live="polite"]')).toHaveText(
    'Nota scaricata come perche-il-caffe.md',
  );
  // Il link temporaneo non resta nella pagina.
  await expect(page.locator('a[download]')).toHaveCount(0);
});

test('con il selettore di file propone lo slug e scrive il testo della nota', async ({ page }) => {
  await page.addInitScript(() => {
    const saved: { options?: unknown; text?: string } = {};
    Object.assign(window, {
      savedFile: saved,
      showSaveFilePicker: (options: unknown) => {
        saved.options = options;
        return Promise.resolve({
          name: 'scelto.md',
          createWritable: () => {
            const parts: Blob[] = [];
            return Promise.resolve({
              write: (blob: Blob) => Promise.resolve(void parts.push(blob)),
              close: async () => {
                saved.text = await new Blob(parts).text();
              },
              abort: () => Promise.resolve(),
            });
          },
        });
      },
    });
  });
  await writeNote(page);
  await saveButton(page).click();
  await expect(page.locator('.sr-only[aria-live="polite"]')).toHaveText(
    'Nota salvata come scelto.md',
  );
  const saved = await page.evaluate(
    () => (window as unknown as { savedFile: { options: unknown; text: string } }).savedFile,
  );
  expect(saved.text).toBe(NOTE_TEXT);
  expect(saved.options).toEqual({
    suggestedName: 'perche-il-caffe.md',
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
  });
});

test('annullare il selettore di file non scarica nulla e non mostra errori', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      showSaveFilePicker: () => Promise.reject(new DOMException('annullato', 'AbortError')),
    });
  });
  await writeNote(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await saveButton(page).click();
  await expect(editor(page)).toContainText('Perché il caffè?');
  await expect(page.locator('.workspace-warning')).toHaveCount(0);
  expect(downloads).toBe(0);
});
