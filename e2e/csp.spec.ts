import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __cspViolations: string[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
});

test('la pagina si carica senza violazioni CSP, errori o richieste esterne', async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  const foreignRequests: string[] = [];
  const appOrigin = new URL(baseURL ?? '').origin;

  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith('http') && url.origin !== appOrigin)
      foreignRequests.push(req.url());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'La nuova versione è in costruzione',
  );

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("require-trusted-types-for 'script'");

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
