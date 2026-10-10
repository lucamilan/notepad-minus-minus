# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Notepad Minus Minus v2: a notepad that runs entirely in the browser. Notes are encrypted with a user passphrase and stored only in the browser (IndexedDB); nothing is ever sent over the network. Published on GitHub Pages at https://lucamilan.github.io/notepad-minus-minus/.

The rewrite proceeds in phases F0–F9, one PR each, described in `docs/piano-v2.md` (decisions, phase scope, verification). Read it before starting a phase. The interactive UI reference is https://claude.ai/artifact/SSAzPUw7bUe8Az9mEh9Wv4.

The v1 (Blazor WebAssembly, .NET 7) is archived on branch `legacy/blazor-net7`, tag `v1-blazor-final`. Do not port code from it; it is only a reference for feature parity.

## Commands

Node 22 (`.nvmrc`), npm with exact versions (`.npmrc` has `save-exact=true`).

```sh
npm ci
npm run dev          # Vite dev server (no CSP in dev, see below)
npm run build        # typecheck + production build in dist/
npm run preview      # serve dist/ (CSP active)
npm run lint         # ESLint (typescript-eslint strict)
npm run typecheck    # tsconfig.json (browser code) + tsconfig.node.json (configs, e2e)
npm run format       # Prettier; CI runs format:check
npm test             # Vitest unit tests in tests/ (jsdom)
npx vitest run tests/smoke.test.tsx   # single test file
npm run test:e2e     # Playwright on Chromium + Firefox against the built dist/ (run build first)
npx playwright install chromium firefox   # once, to get the e2e browsers
```

## Architecture and security rules

Stack: Preact + `@preact/signals`, TypeScript strict, Vite. Planned per phase: CodeMirror 6 (F4), markdown-it + DOMPurify (F5), `idb` (F2), Web Crypto (F7). No WebAssembly.

- **CSP** is a `<meta>` tag injected at build time by the `notepad:csp` plugin in `vite.config.ts` (GitHub Pages can't send headers; Vite dev needs inline scripts and WebSocket, so dev runs without it). It enforces `default-src 'none'`, `script-src 'self'`, `connect-src 'self'` and **Trusted Types** (`require-trusted-types-for 'script'`). Any change that breaks it fails `e2e/csp.spec.ts`.
- **CodeMirror lives in a shadow root** (`src/features/editor/Editor.tsx`): only there does style-mod use constructed stylesheets (`adoptedStyleSheets`); mounted on the document it would inject a `<style>` tag that `style-src 'self'` blocks. Editor colors come from the page's CSS variables, which cross the shadow boundary. `e2e/csp.spec.ts` asserts no `<style>` tags and that editor styles actually apply.
- **Theme**: `public/theme-boot.js` (plain script in `<head>`, allowed by `script-src 'self'`) applies the saved `data-theme` before first paint; `src/features/settings/theme.ts` owns the signal and persistence. Keep the storage key in sync between the two.
- **Accessibility**: modal panels use native `<dialog>` + `showModal()`; the opener restores focus on close. Menus follow the ARIA menu-button pattern (see `src/app/AppBar.tsx`). `e2e/a11y.spec.ts` covers keyboard behavior.
- **Storage** (`src/features/notes/`): IndexedDB database `notepad-minus-minus` (stores `notes`, `meta`) opened via `idb`. Schema changes go through the ordered `MIGRATIONS` array in `database.ts`: never edit a published migration, append a new one. Every record is `{ id, format, payload }`: the `NoteCodec` (`codec.ts`) turns a `Note` into a payload, so F7 swaps `plainCodec` for an AES-GCM codec without touching `repository.ts`; read its header comment for the encryption requirements. No indexes on note fields (they would leak metadata). The repository never overwrites unreadable records; first-run sample creation is atomic (`addIfEmpty`) so two tabs can't duplicate it. On `versionchange` the connection closes itself and the UI asks to reload.
- **Tabs** (`src/features/tabs/`): tabs are open notes; closing one never deletes the note. `tabs.ts` holds pure state transitions (`withOpened`/`withClosed`/`withCycled`/`restoreTabs`), `actions.ts` commits them and persists `{ open, active }` in `meta` under key `tabs` (note UUIDs only; tabs of currently unreadable notes are kept hidden, not dropped). Titles come from `noteTitle`/`tabTitle` in `note.ts` (first line, Markdown stripped, 27 chars + "..."). Never put note titles in `document.title`: they would end up in browser history in clear. `TabBar.tsx` follows the ARIA tabs pattern (roving tabindex, arrows/Home/End, Delete closes; the × is mouse-only). Shortcuts: Alt+N new note, Alt+W close tab, Ctrl+Alt+←/→ switch tab. New notes open optimistically before the IndexedDB write so fast typing isn't lost; CodeMirror is created in `useLayoutEffect` for the same reason.
- **Shared origin**: every page under `lucamilan.github.io/*` is same-origin with this app and can read or alter its IndexedDB, and script it while unlocked. F7 encryption protects confidentiality at rest, not integrity nor an unlocked session. This is an accepted GitHub Pages limit unless the app moves to a dedicated domain.
- **No HTML into the DOM** except through the Trusted Types policy of the Markdown preview (`notepad-md`, F5). ESLint blocks `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `dangerouslySetInnerHTML`. Preact renders via `createElement`, which is why it was chosen over Svelte/Solid.
- **No network**: no CDNs, no external fonts (self-host them), no analytics, no remote images in notes. Links in notes open with `noopener noreferrer`.
- **Encryption at rest** (F7): AES-256-GCM, key from PBKDF2-SHA-256 600k iterations, non-extractable `CryptoKey` kept only in memory. The search index (F6) also lives only in memory and is discarded on lock.
- **Dependencies**: add one only when a phase needs it, pin the exact version, and choose a release at least 14 days old (Dependabot uses the same cooldown).
- Code layout: `src/app` (shell UI), `src/features/<feature>` (notes, tabs, editor, preview, collection, search, crypto, transfer, settings), `src/lib` (shared utilities). Create folders only when they get code.

## Deployment

`.github/workflows/pages.yml` runs on push to `main`: lint, unit tests, `vite build` with `BASE_PATH=/notepad-minus-minus/`, then pushes `dist/` to the root of the `gh-pages` branch (`JamesIves/github-pages-deploy-action`, `clean: true`). The v2 replaced v1 at the site root from F0 onward. `ci.yml` runs the full checks (format, lint, typecheck, unit, build, e2e) on every PR. Actions are pinned by commit SHA.
