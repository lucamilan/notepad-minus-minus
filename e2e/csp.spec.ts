import { expect, test, type Page } from '@playwright/test';
import { setupVault, unlockVault, waitForPendingSaves } from './support';

test.afterEach(async ({ page }) => waitForPendingSaves(page));

declare global {
  interface Window {
    __cspViolations: string[];
  }
}

function watchPage(page: Page, appOrigin: string) {
  const errors: string[] = [];
  const foreignRequests: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith('http') && url.origin !== appOrigin)
      foreignRequests.push(req.url());
  });
  return { errors, foreignRequests };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
});

test('passphrase, editor e blocco funzionano senza violazioni CSP, errori o richieste esterne', async ({
  page,
  baseURL,
}) => {
  const { errors, foreignRequests } = watchPage(page, new URL(baseURL ?? '').origin);
  const scripts: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'script') scripts.push(new URL(req.url()).pathname);
  });

  await page.goto('/');
  // La schermata della passphrase non scarica l'area delle note (CodeMirror, markdown-it…).
  await expect(page.getByRole('heading', { name: 'Proteggi le tue note' })).toBeVisible();
  expect(scripts.filter((path) => path.includes('Workspace'))).toEqual([]);
  await setupVault(page);
  expect(scripts.filter((path) => path.includes('Workspace'))).toHaveLength(1);

  const editor = page.getByRole('textbox', { name: 'Testo della nota' });
  await expect(editor).toContainText('Nota di esempio');

  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nRiga scritta dal test');
  await expect(editor).toContainText('Riga scritta dal test');
  await expect(page.locator('.status')).toContainText('caratteri');

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).toContain("require-trusted-types-for 'script'");

  // CodeMirror deve usare fogli di stile costruiti nello shadow root, non <style> inline
  // (che la CSP bloccherebbe lasciando l'editor senza stile).
  const editorStyles = await page.evaluate(() => {
    const shadow = document.querySelector('.editor-host')?.shadowRoot;
    const editor = shadow?.querySelector('.cm-editor');
    return {
      pageStyleTags: document.querySelectorAll('style').length,
      shadowStyleTags: shadow?.querySelectorAll('style').length ?? -1,
      adoptedSheets: shadow?.adoptedStyleSheets.length ?? 0,
      editorDisplay: editor ? getComputedStyle(editor).display : null,
    };
  });
  expect(editorStyles).toEqual({
    pageStyleTags: 0,
    shadowStyleTags: 0,
    adoptedSheets: expect.any(Number),
    editorDisplay: 'flex',
  });
  expect(editorStyles.adoptedSheets).toBeGreaterThan(0);

  // Anche la schermata di blocco e lo sblocco restano dentro la CSP.
  await waitForPendingSaves(page);
  await page.getByRole('button', { name: 'Blocca' }).click();
  await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();
  expect(await page.evaluate(() => document.querySelectorAll('style').length)).toBe(0);
  await unlockVault(page);
  await expect(editor).toContainText('Riga scritta dal test');

  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
  expect(foreignRequests).toEqual([]);
});

test('Trusted Types blocca la scrittura di HTML grezzo nel DOM', async ({ page }) => {
  await page.goto('/');
  const outcome = await page.evaluate(() => {
    if (!('trustedTypes' in window)) return 'non supportato';
    try {
      // eslint-disable-next-line no-restricted-syntax -- è proprio ciò che il test verifica
      document.body.innerHTML = '<b>x</b>';
      return 'permesso';
    } catch {
      return 'bloccato';
    }
  });
  test.skip(outcome === 'non supportato', 'Il browser non implementa Trusted Types');
  expect(outcome).toBe('bloccato');
});
