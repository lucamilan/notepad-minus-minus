/**
 * Integrità dei file dell'app per il service worker (sw.ts). Modulo puro, senza dipendenze
 * dal service worker: lo provano i test (tests/integrity.test.ts) e il plugin `notepad:sw`
 * lo incolla in sw.js togliendo `export` (niente import nello script classico).
 *
 * Perché: CacheStorage è per origine, e ogni pagina sotto lucamilan.github.io può scrivere
 * nella nostra cache (`caches.open(...).put(...)`) un index.html o uno script modificato.
 * Ogni file si serve quindi solo se il suo SHA-256 è quello scritto in sw.js alla build.
 */

/** [percorso relativo alla radice dell'app, SHA-256 in base64]. */
export type PrecacheEntry = readonly [path: string, sha256: string];

const SHA256_BASE64 = /^[A-Za-z0-9+/]{43}=$/;
/** Percorsi della build: relativi, senza `..`, schema, query o frammento. */
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;

/** Controllo stretto dell'elenco incluso in sw.js: se non torna, l'installazione fallisce. */
export function parsePrecache(value: unknown): PrecacheEntry[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('Elenco dei file vuoto');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string' ||
      !SAFE_PATH.test(entry[0]) ||
      !SHA256_BASE64.test(entry[1]) ||
      seen.has(entry[0])
    ) {
      throw new TypeError('Voce non valida nell’elenco dei file');
    }
    seen.add(entry[0]);
    return [entry[0], entry[1]] as const;
  });
}

export async function sha256Base64(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff: 'font/woff',
  woff2: 'font/woff2',
  webmanifest: 'application/manifest+json',
};

/** Tipo del file dall'estensione: le intestazioni di una risposta in cache non contano. */
export function contentTypeFor(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * La risposta da servire se il corpo ha l'hash atteso, altrimenti null. È sempre una
 * risposta nuova: corpo verificato e solo le intestazioni decise qui, così da una voce
 * scritta da altri non passano né il contenuto né intestazioni scelte da loro.
 */
export async function verifiedResponse(
  response: Response | undefined,
  path: string,
  expected: string,
): Promise<Response | null> {
  if (!response?.ok || response.type === 'opaque' || response.redirected) return null;
  let body: ArrayBuffer;
  try {
    body = await response.arrayBuffer();
  } catch {
    return null;
  }
  if ((await sha256Base64(body)) !== expected) return null;
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentTypeFor(path), 'X-Content-Type-Options': 'nosniff' },
  });
}
