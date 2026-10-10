import preact from '@preact/preset-vite';
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
  'trusted-types dompurify',
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

export default defineConfig({
  // In GitHub Pages l'app vive sotto /notepad-minus-minus/: il workflow passa BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact(), contentSecurityPolicy()],
  build: {
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
