'use strict';
const SW_PRECACHE = [["assets/Workspace-DW0agBhj.js","4bhl3S84kzQrX17fujIMKSGyQrK22JD40f9DRyDRlQc="],["assets/bricolage-grotesque-latin-ext-opsz-normal-IcJDqblK.woff2","d29tyvA2Ns1ppYAslICMyIlsCmbI6c4P4UcjG27gGVc="],["assets/bricolage-grotesque-latin-opsz-normal-Cre6nC2_.woff2","p5/bUtSlx2VSRS9pICrdluKHQB//A9PowOOLTctamc0="],["assets/bricolage-grotesque-vietnamese-opsz-normal-D9N6E8K1.woff2","tQqdkKUmTyDR5FvguUj+lH3bNkRVfx6F71070GQnyUQ="],["assets/dialogs-CL80QcHt.js","DCG7Yb5LwMtXd+bSSRityn7McwMIZV1KdF2yr5I7jac="],["assets/ibm-plex-mono-latin-400-italic-66oory27.woff","RfKOEBf2tFQwYU7IqJLVs+BGhw8+yzomscmcHloYOHc="],["assets/ibm-plex-mono-latin-400-italic-BqAiT5Ww.woff2","CEAJX6roZANzWowEAUtyyynnkjZGsiKzYLfoJSky5OM="],["assets/ibm-plex-mono-latin-400-normal-CvHOgSBP.woff","Mo1QtuzpyiXEbuo+iFukl/Yjfy+4Tve5L4jhShol44E="],["assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","CJSfco3FLVKOabFmfRXImlaGpO6aKW/5CYOYX5nDgPc="],["assets/ibm-plex-mono-latin-500-normal-CB9ihrfo.woff","CfAYxYVW5YAezEnVtSddz/THMxHCr2uI4xxR120Hap0="],["assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","AdKFRHQJyKWIaSFiQ5oDi4y9eHEwnuICZ7DS2RxujiI="],["assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","DR8LjQciIk4y6fKCYb3IbHkRW+c0RK5ezrc5dqG834M="],["assets/ibm-plex-mono-latin-600-normal-DWFSQ4vo.woff","y5YoLyLG8ZEShW/W4LNOK6769MplUehR1YxasKq80r4="],["assets/ibm-plex-sans-latin-400-italic-CZTNEAuW.woff2","bekS5TG2yYCE8bLV5akbrXe+Tmi8TjluQ8RvxDXl89k="],["assets/ibm-plex-sans-latin-400-italic-CsGl1sm0.woff","04WjjPW+9rG8jtv5UWe9qpmSsjHJ6Iepka4RSGV2wHM="],["assets/ibm-plex-sans-latin-400-normal-CDDApCn2.woff2","O2RpkdMAVak6TsxJlxPUNHlTp0qUfsq0NatyBwy9qw4="],["assets/ibm-plex-sans-latin-400-normal-CYLoc0-x.woff","gokHv9FIVciAeJh4vSs4/9KEpsJ8i4D2BpkA9w2uOQE="],["assets/ibm-plex-sans-latin-500-normal-6ng42L7E.woff2","Bxczb7Mfzc3kuN6zZ1u0oPf21ISGSvzWdRrCmXWWIgM="],["assets/ibm-plex-sans-latin-500-normal-BgVn5rGT.woff","jSx7LsqRhp1EeFGpyL0H7fYpsmAl6suIIpHgOzhLTjU="],["assets/ibm-plex-sans-latin-600-normal-Cu4Hd6ag.woff","eGGjSa8eklqA1WVHwsngsen2qQAqmmhnNR2i8FEirSE="],["assets/ibm-plex-sans-latin-600-normal-CuJfVYMP.woff2","iWCFHWkcBU7TjiWb3PGmGQ0Ve0ID7VuzLGMqhj+47C8="],["assets/index-BUzc8SVZ.css","nyilCwampoX9t53VXj3zvSsO5fCzALna/1VaDiti98Y="],["assets/index-DD-5kCna.js","cbzXiOPy08j3GUnybVJzYjWMlBbABp51EJLRgjEby94="],["favicon.svg","q7bNgAZhBfi6tm5bV/uaZDu9/Zs4DMmad4hht5FJ8kM="],["icons/apple-touch-icon.png","2MoIHO3ny0Y221Dmvdu1JwvtRRsNTGuwRKxFXoaZbss="],["icons/icon-192.png","CjfB2JV7mehN/kgVmGX7QUFzri8ApBP7nse2ZLdDfRA="],["icons/icon-512.png","sFaJ6n/JNyaoM/sogU6h1ffc7q2zI2YUCI+LTS2rVUA="],["icons/icon-maskable-512.png","WPfBVgryRX1P3RtoakQodcn0MUtzxva9sJaierGcT+c="],["index.html","HPjs7l0HBc3ODTLOi0ymBHw+0BUs0KK3I3puIomFpOY="],["manifest.webmanifest","/aNDA0ZwfjJZCwkAKOWKTdArB5pinKvjWvNk1sQibLI="],["theme-boot.js","bJ2DEPuxjB4K6t0RHCrrl9x00qJipEcCny3ododRO3Q="]];
const SW_CACHE_NAME = "notepad-minus-minus-f67b93aac8bdbb86";
/**
 * Integrità dei file dell'app per il service worker (sw.ts). Modulo puro, senza dipendenze
 * dal service worker: lo provano i test (tests/integrity.test.ts) e il plugin `notepad:sw`
 * lo incolla in sw.js togliendo `export` (niente import nello script classico).
 *
 * Perché: CacheStorage è per origine, e ogni pagina sotto lucamilan.github.io può scrivere
 * nella nostra cache (`caches.open(...).put(...)`) un index.html o uno script modificato.
 * Ogni file si serve quindi solo se il suo SHA-256 è quello scritto in sw.js alla build.
 */
const SHA256_BASE64 = /^[A-Za-z0-9+/]{43}=$/;
/** Percorsi della build: relativi, senza `..`, schema, query o frammento. */
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;
/** Controllo stretto dell'elenco incluso in sw.js: se non torna, l'installazione fallisce. */
function parsePrecache(value) {
    if (!Array.isArray(value) || value.length === 0)
        throw new TypeError('Elenco dei file vuoto');
    const seen = new Set();
    return value.map((entry) => {
        if (!Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== 'string' ||
            typeof entry[1] !== 'string' ||
            !SAFE_PATH.test(entry[0]) ||
            !SHA256_BASE64.test(entry[1]) ||
            seen.has(entry[0])) {
            throw new TypeError('Voce non valida nell’elenco dei file');
        }
        seen.add(entry[0]);
        return [entry[0], entry[1]];
    });
}
async function sha256Base64(data) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    let binary = '';
    for (const byte of digest)
        binary += String.fromCharCode(byte);
    return btoa(binary);
}
const CONTENT_TYPES = {
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
function contentTypeFor(path) {
    const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
    return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}
/**
 * La risposta da servire se il corpo ha l'hash atteso, altrimenti null. È sempre una
 * risposta nuova: corpo verificato e solo le intestazioni decise qui, così da una voce
 * scritta da altri non passano né il contenuto né intestazioni scelte da loro.
 */
async function verifiedResponse(response, path, expected) {
    if (!response?.ok || response.type === 'opaque' || response.redirected)
        return null;
    let body;
    try {
        body = await response.arrayBuffer();
    }
    catch {
        return null;
    }
    if ((await sha256Base64(body)) !== expected)
        return null;
    return new Response(body, {
        status: 200,
        headers: { 'Content-Type': contentTypeFor(path), 'X-Content-Type-Options': 'nosniff' },
    });
}
/** Le cache di questa app; altre app sulla stessa origine (lucamilan.github.io) hanno le loro. */
const CACHE_PREFIX = 'notepad-minus-minus-';
const sw = self;
const scope = new URL(sw.registration.scope);
const indexUrl = new URL('index.html', scope).href;
/** URL assoluto senza query → [percorso, hash atteso]. */
const precache = new Map(parsePrecache(SW_PRECACHE).map((entry) => [new URL(entry[0], scope).href, entry]));
/** URL senza query né frammento: i file della build hanno già l'hash nel nome. */
function bareUrl(url) {
    return url.origin + url.pathname;
}
/** Scarica un file della build scavalcando la cache HTTP e lo restituisce solo se verificato. */
async function fetchVerified(url, entry) {
    try {
        // `reload`: index.html di GitHub Pages vive 10 minuti in cache HTTP, i file devono essere
        // tutti della stessa build.
        return await verifiedResponse(await fetch(url, { cache: 'reload' }), entry[0], entry[1]);
    }
    catch {
        return null;
    }
}
sw.addEventListener('install', (event) => {
    // Un file mancante o con un hash diverso (pubblicazione a metà, risposta alterata) fa
    // fallire l'installazione: resta attiva la versione precedente, che si riprova più tardi.
    event.waitUntil((async () => {
        const responses = await Promise.all([...precache].map(async ([url, entry]) => {
            const response = await fetchVerified(url, entry);
            if (!response)
                throw new Error(`File non valido: ${entry[0]}`);
            return [url, response];
        }));
        const cache = await caches.open(SW_CACHE_NAME);
        await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
    })());
});
sw.addEventListener('activate', (event) => {
    event.waitUntil(caches
        .keys()
        .then((names) => Promise.all(names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== SW_CACHE_NAME)
        .map((name) => caches.delete(name)))));
});
function unavailable() {
    return new Response('Notepad−−: i file dell’app non sono disponibili o non sono integri. Chiudi tutte le schede dell’app e riaprila.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
/**
 * Prima la cache, ma solo se il contenuto ha l'hash atteso (verificato a ogni risposta: la
 * cache può cambiare in qualunque momento). Altrimenti la rete, verificata, che ripara la
 * cache; se nemmeno la rete dà il file giusto, 503.
 */
async function serveVerified(url, entry) {
    const cache = await caches.open(SW_CACHE_NAME);
    const cached = await verifiedResponse(await cache.match(url), entry[0], entry[1]);
    if (cached)
        return cached;
    await cache.delete(url);
    const fresh = await fetchVerified(url, entry);
    if (!fresh)
        return unavailable();
    await cache.put(url, fresh.clone());
    return fresh;
}
sw.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET')
        return;
    const url = new URL(request.url);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname))
        return;
    if (request.mode === 'navigate') {
        // Solo la pagina dell'app (radice o index.html, con qualunque query): altre pagine
        // dentro lo scope vanno in rete come prima.
        if (url.pathname !== scope.pathname && bareUrl(url) !== indexUrl)
            return;
        const entry = precache.get(indexUrl);
        if (entry)
            event.respondWith(serveVerified(indexUrl, entry));
        return;
    }
    const bare = bareUrl(url);
    const entry = precache.get(bare);
    if (entry)
        event.respondWith(serveVerified(bare, entry));
});
/** L'unico messaggio accettato: { type: 'SKIP_WAITING' }, da una finestra della stessa origine. */
function isSkipWaiting(data) {
    if (typeof data !== 'object' || data === null || Array.isArray(data))
        return false;
    const keys = Object.keys(data);
    return (keys.length === 1 && keys[0] === 'type' && data.type === 'SKIP_WAITING');
}
sw.addEventListener('message', (event) => {
    const source = event.source;
    if (!(source instanceof WindowClient))
        return;
    if (new URL(source.url).origin !== scope.origin)
        return;
    if (event.origin !== '' && event.origin !== scope.origin)
        return;
    if (!isSkipWaiting(event.data))
        return;
    // La pagina ha già salvato le note in coda: si attiva e la pagina si ricarica (update.ts).
    void sw.skipWaiting();
});
