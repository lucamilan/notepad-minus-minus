import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openUnlocked, unlockVault, waitForPendingSaves, waitForServiceWorker } from './support';

// Qui il service worker conta: attivo come per chi usa l'app (vedi playwright.config.ts).
test.use({ serviceWorkers: 'allow' });

test.afterEach(async ({ page }) => {
  await waitForPendingSaves(page);
  await waitForServiceWorker(page);
});

declare global {
  interface Window {
    __cspViolations: string[];
  }
}

const editor = (page: Page) => page.getByRole('textbox', { name: 'Testo della nota' });

/** Violazioni CSP, errori in console e richieste verso altre origini, per tutto il contesto. */
function watch(context: BrowserContext, page: Page, appOrigin: string) {
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  context.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith('http') && url.origin !== appOrigin) foreign.push(req.url());
  });
  return { errors, foreign };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
});

/** Il service worker è attivo: dopo un ricaricamento controlla la pagina. */
async function reloadUntilControlled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state ?? null))
    .toBe('activated');
}

async function serviceWorkersAvailable(page: Page): Promise<boolean> {
  return page.evaluate(() => 'serviceWorker' in navigator);
}

test('senza rete l’app si apre, si sblocca e salva le note', async ({ page, context, baseURL }) => {
  const { errors, foreign } = watch(context, page, new URL(baseURL ?? '').origin);
  await openUnlocked(page);
  test.skip(!(await serviceWorkersAvailable(page)), 'Service worker non disponibili');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nScritta con la rete');
  await waitForPendingSaves(page);

  await reloadUntilControlled(page);
  // La cache non contiene note: solo i file dell'app.
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return { names, urls };
  });
  expect(cached.names).toHaveLength(1);
  expect(cached.names[0]).toMatch(/^notepad-minus-minus-[0-9a-f]{16}$/);
  expect(cached.urls.some((url) => url.endsWith('/index.html'))).toBe(true);
  expect(cached.urls.some((url) => /\/assets\/Workspace-[\w-]+\.js$/.test(url))).toBe(true);
  expect(cached.urls.some((url) => url.endsWith('/sw.js'))).toBe(false);

  await context.setOffline(true);
  try {
    await page.reload();
    // L'area delle note (caricata a parte) arriva dalla cache.
    await unlockVault(page);
    await expect(editor(page)).toContainText('Scritta con la rete');
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\nScritta senza rete');
    await expect(page.locator('.save-state')).toHaveText(/^Salvato alle/);

    await page.reload();
    await unlockVault(page);
    await expect(editor(page)).toContainText('Scritta senza rete');
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

/**
 * Un server tutto suo per gli aggiornamenti: serve la stessa build di `vite preview`, ma
 * sw.js con un suffisso scelto dal test (una "build nuova"). Le route di Playwright non
 * intercettano lo script del service worker, e cambiare dist/ toccherebbe gli altri test.
 * Porta diversa = origine diversa: service worker, cache e archivio sono solo di questo test.
 */
async function startUpdateServer(): Promise<{
  url: string;
  publish: () => void;
  close: () => Promise<void>;
}> {
  const dist = resolve(import.meta.dirname, '..', 'dist');
  let version = '';
  const server = createServer((req, res) => {
    void (async () => {
      try {
        // Dentro il try: un URL con una sequenza % non valida è un 404, non un'eccezione.
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
        const file = normalize(join(dist, pathname === '/' ? 'index.html' : pathname));
        // dist + separatore: "dist-altro" o "dist/../x" non passano.
        if (!file.startsWith(dist + sep)) {
          res.writeHead(403).end();
          return;
        }
        let body: Buffer | string = await readFile(file);
        if (pathname === '/sw.js') body = `${body.toString('utf8')}\n${version}`;
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    publish: () => (version = `// versione ${Date.now()}\n`),
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

test.describe('aggiornamenti', () => {
  let server: Awaited<ReturnType<typeof startUpdateServer>>;
  test.beforeEach(async () => {
    server = await startUpdateServer();
  });
  // Gira prima di quello del file: le note si salvano in IndexedDB, il server non serve più.
  test.afterEach(async ({ page }) => {
    await waitForPendingSaves(page);
    await server.close();
  });

  /** Pubblica una "build nuova" e fa cercare aggiornamenti al browser. */
  async function publishUpdate(page: Page): Promise<void> {
    server.publish();
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
  }

  const banner = (page: Page) =>
    page.getByRole('status').filter({ hasText: 'È disponibile una nuova versione' });

  test('una versione nuova aspetta "Aggiorna", che salva le note e ricarica una volta', async ({
    page,
  }) => {
    await openUnlocked(page, server.url);
    await reloadUntilControlled(page);
    await unlockVault(page);

    await publishUpdate(page);
    await expect(banner(page)).toBeVisible();
    // In attesa, non attiva da sola: la pagina resta della versione di prima.
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state,
      ),
    ).toBe('installed');

    // Una modifica appena scritta (prima della pausa di salvataggio) si salva prima di
    // ricaricare. Al pulsante si arriva da tastiera.
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\nPrima dell’aggiornamento');
    const update = banner(page).getByRole('button', { name: 'Aggiorna' });
    await update.focus();
    await expect(update).toBeFocused();
    let loads = 0;
    page.on('load', () => loads++);
    const reloaded = page.waitForEvent('load');
    await page.keyboard.press('Enter');
    await reloaded;

    await unlockVault(page);
    await expect(editor(page)).toContainText('Prima dell’aggiornamento');
    await expect(page.getByText('È disponibile una nuova versione')).toHaveCount(0);
    expect(loads).toBe(1);
    expect(
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return { waiting: registration?.waiting ?? null, caches: (await caches.keys()).length };
      }),
    ).toEqual({ waiting: null, caches: 1 });
  });

  test('l’avviso compare anche con le note bloccate e "Più tardi" lo nasconde', async ({
    page,
  }) => {
    await openUnlocked(page, server.url);
    await reloadUntilControlled(page);
    await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();

    await publishUpdate(page);
    await expect(banner(page)).toBeVisible();
    await banner(page).getByRole('button', { name: 'Più tardi' }).click();
    // Il focus torna dov'era: il campo della passphrase.
    await expect(page.getByLabel('Passphrase', { exact: true })).toBeFocused();
    await expect(page.getByText('È disponibile una nuova versione')).toHaveCount(0);

    // Al prossimo avvio la versione nuova è ancora in attesa: l'avviso torna.
    await page.reload();
    await expect(banner(page)).toBeVisible();
    const reloaded = page.waitForEvent('load');
    await banner(page).getByRole('button', { name: 'Aggiorna' }).click();
    await reloaded;
    await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();
    await expect(page.getByText('È disponibile una nuova versione')).toHaveCount(0);
  });
});

test('file alterati nella cache (dalla stessa origine) non si servono mai', async ({
  page,
  context,
  browserName,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await openUnlocked(page);
  await reloadUntilControlled(page);
  await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();

  // Quello che può fare qualunque pagina sotto lucamilan.github.io: scrivere nella nostra cache.
  const poison = () =>
    page.evaluate(async () => {
      const [name] = await caches.keys();
      const cache = await caches.open(name ?? '');
      const keys = (await cache.keys()).map((request) => request.url);
      const index = keys.find((url) => url.endsWith('/index.html')) ?? '';
      const workspace = keys.find((url) => /\/assets\/Workspace-[\w-]+\.js$/.test(url)) ?? '';
      await cache.put(
        index,
        new Response('<!doctype html><h1>Contraffatta</h1>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      );
      await cache.put(
        workspace,
        new Response('window.__alterato = true; export function Workspace() {}', {
          headers: { 'Content-Type': 'text/javascript' },
        }),
      );
      return { index, workspace };
    });
  const { index, workspace } = await poison();

  // Con la rete: le voci alterate si scartano e si riprendono, verificate, dalla rete.
  await page.reload();
  await unlockVault(page);
  await expect(editor(page)).toContainText('Nota di esempio');
  expect(await page.evaluate(() => '__alterato' in window)).toBe(false);
  const repaired = await page.evaluate(
    async (urls) => {
      const [name] = await caches.keys();
      const cache = await caches.open(name ?? '');
      return Promise.all(urls.map(async (url) => (await (await cache.match(url))?.text()) ?? ''));
    },
    [index, workspace],
  );
  expect(repaired[0]).toContain('<div id="app">');
  expect(repaired[1]).not.toContain('__alterato');

  // Senza rete una voce alterata non si può riparare: 503, mai il contenuto contraffatto.
  await poison();
  await context.setOffline(true);
  try {
    await page.reload();
    // Chromium taglia anche le richieste del service worker: 503. Firefox in Playwright le
    // lascia passare, e il file si ripara dalla rete. In entrambi i casi mai il contraffatto.
    await expect(page.locator('body')).toContainText(
      browserName === 'chromium' ? 'non sono disponibili o non sono integri' : 'Note bloccate',
    );
    await expect(page.getByText('Contraffatta')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Note bloccate' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('il manifest è valido e le sue icone si caricano', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
    'content',
    /^#[0-9a-f]{6}$/,
  );
  const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(appleIcon ?? '')).ok()).toBe(true);

  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    lang: string;
    start_url: string;
    scope: string;
    display: string;
    background_color: string;
    theme_color: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({
    name: 'Notepad−−',
    short_name: 'Notepad−−',
    lang: 'it',
    start_url: './',
    scope: './',
    display: 'standalone',
  });
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
  expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
    'any any',
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);

  const manifestUrl = new URL('/manifest.webmanifest', page.url());
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(new URL(icon.src, manifestUrl).href);
    expect(iconResponse.ok(), icon.src).toBe(true);
    expect(iconResponse.headers()['content-type']).toContain(icon.type);
    if (icon.type === 'image/png') {
      const size = await page.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return `${image.naturalWidth}x${image.naturalHeight}`;
      }, new URL(icon.src, manifestUrl).pathname);
      expect(size).toBe(icon.sizes);
    }
  }
});
