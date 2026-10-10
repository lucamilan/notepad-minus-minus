/**
 * Service worker dell'app installabile: tiene in cache solo i file statici dell'app (mai
 * dati delle note, che restano in IndexedDB) così che si apra anche senza rete.
 *
 * In sw.js diventa uno script classico: il plugin `notepad:sw` di vite.config.ts incolla
 * integrity.ts e questo file (senza import/export), li compila e antepone SW_PRECACHE (ogni
 * file della build con il suo SHA-256, percorsi relativi alla radice dell'app) e
 * SW_CACHE_NAME (prefisso + hash della build). Niente importScripts, niente URL esterni,
 * niente cache a runtime: ciò che non è nell'elenco va in rete come senza service worker.
 *
 * Integrità: ogni pagina di lucamilan.github.io può scrivere nella nostra cache, quindi ogni
 * file si verifica con l'hash di sw.js all'installazione e a ogni risposta servita (anche
 * index.html). Una voce alterata si elimina e si riprende dalla rete, verificata; se nemmeno
 * quella torna (versione nuova pubblicata a metà) si risponde 503.
 * La versione nuova si attiva solo quando la pagina lo chiede (pulsante "Aggiorna").
 */
import { parsePrecache, verifiedResponse, type PrecacheEntry } from './integrity';

declare const SW_PRECACHE: unknown;
declare const SW_CACHE_NAME: string;

/** Le cache di questa app; altre app sulla stessa origine (lucamilan.github.io) hanno le loro. */
const CACHE_PREFIX = 'notepad-minus-minus-';

const sw = self as unknown as ServiceWorkerGlobalScope;
const scope = new URL(sw.registration.scope);
const indexUrl = new URL('index.html', scope).href;
/** URL assoluto senza query → [percorso, hash atteso]. */
const precache = new Map<string, PrecacheEntry>(
  parsePrecache(SW_PRECACHE).map((entry) => [new URL(entry[0], scope).href, entry]),
);

/** URL senza query né frammento: i file della build hanno già l'hash nel nome. */
function bareUrl(url: URL): string {
  return url.origin + url.pathname;
}

/** Scarica un file della build scavalcando la cache HTTP e lo restituisce solo se verificato. */
async function fetchVerified(url: string, entry: PrecacheEntry): Promise<Response | null> {
  try {
    // `reload`: index.html di GitHub Pages vive 10 minuti in cache HTTP, i file devono essere
    // tutti della stessa build.
    return await verifiedResponse(await fetch(url, { cache: 'reload' }), entry[0], entry[1]);
  } catch {
    return null;
  }
}

sw.addEventListener('install', (event) => {
  // Un file mancante o con un hash diverso (pubblicazione a metà, risposta alterata) fa
  // fallire l'installazione: resta attiva la versione precedente, che si riprova più tardi.
  event.waitUntil(
    (async () => {
      const responses = await Promise.all(
        [...precache].map(async ([url, entry]) => {
          const response = await fetchVerified(url, entry);
          if (!response) throw new Error(`File non valido: ${entry[0]}`);
          return [url, response] as const;
        }),
      );
      const cache = await caches.open(SW_CACHE_NAME);
      await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== SW_CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

function unavailable(): Response {
  return new Response(
    'Notepad−−: i file dell’app non sono disponibili o non sono integri. Chiudi tutte le schede dell’app e riaprila.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}

/**
 * Prima la cache, ma solo se il contenuto ha l'hash atteso (verificato a ogni risposta: la
 * cache può cambiare in qualunque momento). Altrimenti la rete, verificata, che ripara la
 * cache; se nemmeno la rete dà il file giusto, 503.
 */
async function serveVerified(url: string, entry: PrecacheEntry): Promise<Response> {
  const cache = await caches.open(SW_CACHE_NAME);
  const cached = await verifiedResponse(await cache.match(url), entry[0], entry[1]);
  if (cached) return cached;
  await cache.delete(url);
  const fresh = await fetchVerified(url, entry);
  if (!fresh) return unavailable();
  await cache.put(url, fresh.clone());
  return fresh;
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  if (request.mode === 'navigate') {
    // Solo la pagina dell'app (radice o index.html, con qualunque query): altre pagine
    // dentro lo scope vanno in rete come prima.
    if (url.pathname !== scope.pathname && bareUrl(url) !== indexUrl) return;
    const entry = precache.get(indexUrl);
    if (entry) event.respondWith(serveVerified(indexUrl, entry));
    return;
  }
  const bare = bareUrl(url);
  const entry = precache.get(bare);
  if (entry) event.respondWith(serveVerified(bare, entry));
});

/** L'unico messaggio accettato: { type: 'SKIP_WAITING' }, da una finestra della stessa origine. */
function isSkipWaiting(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  return (
    keys.length === 1 && keys[0] === 'type' && (data as { type: unknown }).type === 'SKIP_WAITING'
  );
}

sw.addEventListener('message', (event) => {
  const source = event.source;
  if (!(source instanceof WindowClient)) return;
  if (new URL(source.url).origin !== scope.origin) return;
  if (event.origin !== '' && event.origin !== scope.origin) return;
  if (!isSkipWaiting(event.data)) return;
  // La pagina ha già salvato le note in coda: si attiva e la pagina si ricarica (update.ts).
  void sw.skipWaiting();
});
