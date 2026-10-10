# Notepad−− v2: piano di riscrittura ed esecuzione di F0

## Contesto

Riscriviamo Notepad−− (oggi Blazor WASM su .NET 7, fuori supporto) come app solo browser. Le note sono cifrate, non vengono mai salvate in remoto e l'app resta pubblicata su GitHub Pages.

Finora il piano esisteva solo come pagina condivisibile (https://claude.ai/artifact/NfREHwC8GQBt4cL5Ea4Yw8) e come file temporaneo nello scratchpad, non nel repository. Questo file lo rende persistente. In F0 lo copiamo anche nel repo (`docs/piano-v2.md`), così resta versionato insieme al codice.

Preview della UI approvata come riferimento: https://claude.ai/artifact/SSAzPUw7bUe8Az9mEh9Wv4

## Decisioni prese dal Senior

| Tema                 | Scelta                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| UI                   | Preact + Signals, TypeScript strict, Vite                                                       |
| Editor               | CodeMirror 6 (Markdown)                                                                         |
| Markdown             | markdown-it, con HTML grezzo disattivato, + plugin + DOMPurify con policy Trusted Types         |
| Storage              | IndexedDB tramite `idb`, `navigator.storage.persist()`                                          |
| Cifratura            | Obbligatoria: AES-256-GCM, chiave da PBKDF2-SHA-256 a 600.000 iterazioni, blocco per inattività |
| WebAssembly          | No (CSP senza `'wasm-unsafe-eval'`)                                                             |
| Dati v1              | Nessun import, si parte da zero                                                                 |
| Trasferimento tra PC | Export/import di un file `.notepad` cifrato                                                     |
| Archivio v1          | Tag `v1-blazor-final` + branch `legacy/blazor-net7`                                             |
| Salvataggio          | Sempre attivo (debounce di 500 ms e flush su `visibilitychange`), nessun interruttore           |
| Dominio              | Resta `lucamilan.github.io/notepad-minus-minus`                                                 |
| Pubblicazione        | La v2 sostituisce la v1 alla radice del sito già da F0 (niente percorso `/v2/`)                 |
| Immagini remote      | Bloccate. Link ammessi solo `https`, `http`, `mailto` e autolink, con `noopener noreferrer`     |
| Raggruppamento       | Tag con categorie nel testo: `#cliente/…`, `#progetto/…`, `#tipo/…`, più tag liberi             |
| Viste                | Tutte, Recenti (7 giorni), Attività aperte, Fissate, Senza tag, più viste salvate               |
| Schede               | Chiudere una scheda non elimina la nota; l'eliminazione è separata e chiede conferma            |
| Ricerca              | `Ctrl+K`, implementazione interna senza dipendenze, indice solo in memoria                      |

## Fasi (una PR per fase, approvata dal Senior prima della successiva)

| Fase | Contenuto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0   | Archiviazione v1, scaffolding, CI, deploy di anteprima, nuovo CLAUDE.md (dettaglio sotto)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F1   | Struttura grafica, token e temi (sistema/chiaro/scuro ricordato); verifica di CodeMirror con la CSP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F2   | Modello `Note` (id, testo, `createdAt`, `modifiedAt`, `pinned`), repository IndexedDB versionato, nota di esempio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F3   | Schede = note aperte; titolo dalla prima riga (27 caratteri + "..."), tooltip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F4   | Editor CodeMirror, salvataggio continuo, `Ctrl+S`, stato nella barra                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| F5   | Anteprima: tre modalità, doppio clic, markdown-it + DOMPurify + Trusted Types, test XSS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F6   | Raccolta, tag con categorie e suggerimenti, viste automatiche e salvate, note fissate, ricerca globale; avviso tra schede del browser (`BroadcastChannel` con solo `{id, modifiedAt}`) quando la stessa nota è modificata altrove                                                                                                                                                                                                                                                                                                                                                                                                        |
| F7   | Cifratura: creazione passphrase, sblocco, blocco automatico, cambio passphrase. Codec AES-GCM (formato versionato, `id`+`format` come AAD) che legge anche `plain-v1`; parametri KDF e record di verifica nello store `meta`; cambio passphrase in un'unica transazione `notes`+`meta`. Per non lasciare residui in chiaro delle fasi F4–F6, cifrare in un database nuovo e poi eliminare il vecchio con `deleteDatabase`; valutare la rimozione del vecchio IndexedDB `SqliteStorage` della v1. Cifrare anche le viste salvate (`meta.savedViews`, contengono nomi di tag) e svuotare al blocco le cache in memoria (`tagsOf`, ricerca) |
| F8   | Export/import del file `.notepad` cifrato (unisci o sostituisci)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F9   | PWA offline, e2e completi, collaudo finale, README e CLAUDE.md definitivi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Sotto-agenti: per ogni fase uno implementa e uno fa revisione di codice e sicurezza in parallelo. Io integro e verifico.

## F0: dettaglio di esecuzione

### 1. Archiviazione v1 (azioni che pubblicano su GitHub, coperte dall'approvazione di questo piano)

- Da `main` (HEAD `75be77a`):
  - creare il branch `legacy/blazor-net7`;
  - committare lì il `CLAUDE.md` attuale, oggi non tracciato, che documenta la v1;
  - creare il tag annotato `v1-blazor-final` su quel commit;
  - fare push di branch e tag.
- Il workflow attuale si attiva solo su `main` e `master`, quindi il branch legacy non avvia deploy.

### 2. Branch di lavoro `feat/v2-f0` da `main`

- Rimuovere `src/`, `publish-offline.ps1`, `.vscode/launch.json` e `.vscode/tasks.json` (sono configurazioni dotnet).
- Sostituire `.gitignore` (oggi è quello di Visual Studio) con uno per Node: `node_modules`, `dist`, `coverage`, `playwright-report`, `test-results`.

### 3. Scaffolding alla radice del repo

- `package.json`:
  - Node 22 LTS con `engines` e `.nvmrc`, npm con lockfile;
  - script `dev`, `build`, `preview`, `lint`, `format`, `test`, `test:e2e`, `typecheck`.
- Dipendenze runtime: in F0 solo `preact` e `@preact/signals`. Le altre arrivano nella fase che le usa.
- Dipendenze di sviluppo: `vite`, `@preact/preset-vite`, `typescript`, `eslint`, `typescript-eslint`, `prettier`, `vitest`, `@playwright/test`.
- `vite.config.ts`:
  - `base` da variabile d'ambiente: `/notepad-minus-minus/` su GitHub Pages, `/` in locale;
  - niente sourcemap in produzione;
  - asset con hash nel nome.
- `tsconfig.json` strict, con `noUncheckedIndexedAccess` ed `exactOptionalPropertyTypes`.
- `index.html`:
  - meta CSP con `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types notepad-md dompurify` (da F5: `trusted-types dompurify`, l'anteprima non usa una policy propria);
  - meta `referrer` impostato a `no-referrer`;
  - niente risorse esterne.
- `src/main.tsx` + `src/app/App.tsx`: schermata segnaposto "Notepad−− v2 in costruzione", resa senza `innerHTML`.
- Struttura delle cartelle prevista, creata solo quando serve:
  - `src/app` (shell UI)
  - `src/features/{notes,editor,preview,collection,search,crypto,transfer,settings}`
  - `src/lib` (utilità)
  - `tests/` (Vitest)
  - `e2e/` (Playwright)
- `eslint.config.js` (flat config, `typescript-eslint` strict) e `.prettierrc`.
- `docs/piano-v2.md`: copia di questo piano.

### 4. Test minimi di F0

- `tests/smoke.test.ts` (Vitest): verifica che l'app si monti.
- `e2e/csp.spec.ts` (Playwright, Chromium e Firefox):
  - apre la build servita da `vite preview`;
  - fallisce se compare un evento `securitypolicyviolation` o un errore in console;
  - fallisce se parte una richiesta verso un'origine diversa da quella dell'app.

### 5. CI e deploy (`.github/workflows/`)

- `ci.yml`, su PR e push: `npm ci`, poi lint, typecheck, test, build ed e2e.
- `pages.yml`, su push a `main`:
  - fa la build con base `/notepad-minus-minus/`;
  - pubblica alla radice del branch `gh-pages` tramite `JamesIves/github-pages-deploy-action` v4 con `clean: true`, sostituendo la v1 (decisione del Senior durante F0).
- Le action sono fissate per SHA, con `permissions` minimi: `contents: write` solo nel job di deploy.
- `.github/dependabot.yml` per npm e github-actions.
- Il vecchio `gh-pages.yaml` va rimosso nello stesso commit, altrimenti al push su `main` proverebbe a compilare `src/`, che non esiste più.

### 6. Documentazione

- Nuovo `CLAUDE.md`:
  - panoramica della v2;
  - comandi npm;
  - architettura prevista (CSP, Trusted Types, unico punto che scrive HTML, cifratura, indice solo in memoria);
  - regole: niente dipendenze senza motivazione, niente richieste di rete, niente `innerHTML` fuori dalla policy;
  - deploy alla radice del sito;
  - link al branch legacy.
- `README.md` aggiornato: stato v2, link alla v1 archiviata.

## File coinvolti in F0

- **Rimossi:** `src/**`, `publish-offline.ps1`, `.vscode/launch.json`, `.vscode/tasks.json`, `.github/workflows/gh-pages.yaml`
- **Creati:** `package.json`, `package-lock.json`, `.nvmrc`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `index.html`, `src/main.tsx`, `src/app/App.tsx`, `tests/smoke.test.ts`, `e2e/csp.spec.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `.github/dependabot.yml`, `docs/piano-v2.md`
- **Riscritti:** `.gitignore`, `CLAUDE.md`, `README.md`

## Verifica

1. `git ls-remote --tags origin v1-blazor-final` e `git ls-remote origin legacy/blazor-net7` rispondono.
2. In locale `npm ci && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e` è tutto verde.
3. `npm run preview`: la pagina segnaposto si apre senza violazioni CSP; in DevTools nessuna richiesta esterna.
4. La CI è verde sulla PR `feat/v2-f0` → `main`.
5. Dopo il merge https://lucamilan.github.io/notepad-minus-minus/ mostra il segnaposto della v2.
