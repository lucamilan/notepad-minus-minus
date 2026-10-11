import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import preact from '@preact/preset-vite';
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vitest/config';

// La CSP vive in un meta tag perché GitHub Pages non permette header personalizzati.
// Viene iniettata solo in build: il dev server di Vite usa script inline e WebSocket per l'HMR.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  // dompurify: la policy di DOMPurify (anteprima); notepad-sw: solo l'URL di sw.js (update.ts).
  'trusted-types dompurify notepad-sw',
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'notepad:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

/** Tutti i file sotto `dir`, come percorsi relativi con `/` (ordinati: l'hash non dipende dal disco). */
async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    ),
  );
  return files.flat().sort();
}

/**
 * Service worker dell'app installabile (src/sw/sw.ts + integrity.ts): a fine build lo compila
 * e lo scrive in dist/sw.js con l'elenco di tutti i file usciti dalla build (chunk caricati a
 * parte, CSS, font, index.html, manifest, icone, theme-boot.js), ciascuno con il suo SHA-256,
 * e un nome di cache derivato da quegli hash: una build diversa installa una versione nuova. Gli URL sono relativi
 * alla radice dell'app, quindi vale sia sotto /notepad-minus-minus/ sia sotto /.
 * Solo in build: in `npm run dev` non c'è service worker.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'notepad:sw',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      const files = (await listFiles(outDir)).filter((file) => file !== 'sw.js');
      if (!files.includes('index.html')) throw new Error('notepad:sw: index.html mancante');
      // Ogni file con il suo SHA-256 (base64): il service worker li verifica prima di servirli.
      const precache: [string, string][] = [];
      const build = createHash('sha256');
      for (const file of files) {
        const digest = createHash('sha256')
          .update(await readFile(join(outDir, file)))
          .digest('base64');
        precache.push([file, digest]);
        build.update(file).update('\0').update(digest).update('\0');
      }
      const cacheName = `notepad-minus-minus-${build.digest('hex').slice(0, 16)}`;
      // sw.js è uno script classico: integrity.ts senza `export` e sw.ts senza import, insieme.
      const read = (path: string) => readFile(resolve(import.meta.dirname, path), 'utf8');
      const source = [
        (await read('src/sw/integrity.ts')).replace(/^export /gm, ''),
        (await read('src/sw/sw.ts')).replace(/^import [^;]+;$/gm, ''),
      ].join('\n');
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      });
      if (/^\s*(?:import|export)\b|\bexports\.|\brequire\(/m.test(outputText)) {
        throw new Error('notepad:sw: sw.js deve restare uno script classico');
      }
      const header = [
        "'use strict';",
        `const SW_PRECACHE = ${JSON.stringify(precache)};`,
        `const SW_CACHE_NAME = ${JSON.stringify(cacheName)};`,
      ].join('\n');
      // 'use strict' deve venire prima delle costanti, altrimenti non vale.
      const body = outputText.replace(/^"use strict";\s*/, '');
      await writeFile(join(outDir, 'sw.js'), `${header}\n${body}`);
    },
  };
}

export default defineConfig({
  // In GitHub Pages l'app vive sotto /notepad-minus-minus/: il workflow passa BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact(), contentSecurityPolicy(), serviceWorker()],
  build: {
    sourcemap: false,
    modulePreload: { polyfill: false },
    // L'area delle note (Workspace) è un solo chunk caricato dopo lo sblocco, in parallelo con
    // PBKDF2: con CodeMirror e il Markdown supera i 500 kB predefiniti.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
