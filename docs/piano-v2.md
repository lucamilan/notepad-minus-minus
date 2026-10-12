# Notepad−− v2: piano di riscrittura ed esecuzione di F0

## Contesto

Riscriviamo Notepad−− (oggi Blazor WASM su .NET 7, fuori supporto) come app solo browser. Le note sono cifrate, non vengono mai salvate in remoto e l'app resta pubblicata su GitHub Pages.

Finora il piano esisteva solo come pagina condivisibile (ora rimossa) e come file temporaneo nello scratchpad, non nel repository. Questo file lo rende persistente. In F0 lo copiamo anche nel repo (`docs/piano-v2.md`), così resta versionato insieme al codice.

La preview della UI approvata come riferimento era una pagina condivisa, ora rimossa: il riferimento è l'app pubblicata.

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

| Fase | Contenuto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F0   | Archiviazione v1, scaffolding, CI, deploy di anteprima, nuovo CLAUDE.md (dettaglio sotto)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F1   | Struttura grafica, token e temi (sistema/chiaro/scuro ricordato); verifica di CodeMirror con la CSP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F2   | Modello `Note` (id, testo, `createdAt`, `modifiedAt`, `pinned`), repository IndexedDB versionato, nota di esempio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F3   | Schede = note aperte; titolo dalla prima riga (27 caratteri + "..."), tooltip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F4   | Editor CodeMirror, salvataggio continuo, `Ctrl+S`, stato nella barra                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F5   | Anteprima: tre modalità, doppio clic, markdown-it + DOMPurify + Trusted Types, test XSS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F6   | Raccolta, tag con categorie e suggerimenti, viste automatiche e salvate, note fissate, ricerca globale; avviso tra schede del browser (`BroadcastChannel` con solo `{id, modifiedAt}`) quando la stessa nota è modificata altrove                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| F7   | Cifratura: creazione passphrase, sblocco, blocco (manuale per tutte le schede, automatico per inattività per scheda), cambio passphrase. Gerarchia di chiavi: una chiave dati AES-256-GCM casuale, salvata cifrata (wrapKey) con una chiave da PBKDF2-SHA-256 a 600.000 iterazioni; portachiavi in chiaro in `meta`. Codec `aesgcm-v1` con IV casuale per record e `id`+`format` come AAD (anche per i dati di `meta`: schede e viste salvate sono cifrate). Il cambio passphrase ricifra solo la chiave dati in un'unica scrittura di `meta` invece di ricifrare tutte le note in una transazione `notes`+`meta`: atomico, istantaneo, sicuro con più schede (la chiave dati non ruota). Le note in chiaro di F2–F6 si cifrano nel database nuovo `notepad-minus-minus-cifrato` e il vecchio si elimina con `deleteDatabase`. `SqliteStorage` della v1 non si elimina da solo: le impostazioni offrono di eliminarlo, con conferma. Al blocco si svuotano note, schede, viste, filtri, ricerca e cache; l'area delle note si carica a parte (code splitting) dopo lo sblocco                                                                                                                                                                                                                                |
| F8   | Export/import del file `.notepad` cifrato (unisci o sostituisci). Fatto: file JSON con una chiave AES-256-GCM propria, cifrata come il portachiavi (PBKDF2-SHA-256 600.000 iterazioni sulla passphrase scelta all'esportazione, additional data `export\0v1`) e un unico blob cifrato (`export-data\0v1`) con note e viste salvate: niente in chiaro, nemmeno date o conteggi. Import con controlli stretti (64 MB, campi esatti, UUID, id unici), passphrase errata distinta da file non valido o di versione più recente. Unisci: vince la data di modifica più recente, identiche saltate, viste unite per nome; Sostituisci tutto: conferma esplicita, i record illeggibili restano intatti. Il piano si fa sulle versioni salvate (rilette); le note con modifiche non salvate o con un avviso da un'altra scheda restano come sono (conflitti). Note e viste in un'unica transazione `notes` + `meta` (tutto o niente) che salta i record cambiati dopo la rilettura; poi memoria e schede; avviso alle altre schede senza contenuto (`{ reloadAll }` sostituendo o oltre 50 note: le altre schede adottano ogni versione salvata diversa, anche più vecchia). Date importate controllate (interi, non nel futuro oltre 24 ore). Voci nel menu "Altro" e nelle impostazioni, dialoghi caricati a parte |
| F9   | PWA offline, e2e completi, collaudo finale, README e CLAUDE.md definitivi. Fatto: service worker scritto a mano (nessuna dipendenza), generato in build dal plugin `notepad:sw` con l'elenco di tutti i file della build e una cache `notepad-minus-minus-<hash>`; offline la pagina e l'area delle note arrivano dalla cache, mai le note. Nuova versione installata ma in attesa: avviso "È disponibile una nuova versione" (anche con le note bloccate), "Aggiorna" salva, attiva e ricarica una volta. Ogni file ha il suo SHA-256 in `sw.js`, verificato all'installazione e a ogni risposta (la cache è scrivibile dalle altre pagine dell'origine). Manifest con icone (anche maskable), policy Trusted Types `notepad-sw` solo per l'URL di `sw.js`. Collaudo e2e: percorso completo, impostazioni che restano, telefono 390×844, nomi accessibili e id unici (trovate e corrette: caselle delle attività senza nome accessibile)                                                                                                                                                                                                                                                                                                                                                                    |

## Stato

Tutte le fasi F0–F9 sono completate: la v2 è la versione pubblicata (2.0.0).

| Fase | Stato                                                             |
| ---- | ----------------------------------------------------------------- |
| F0   | Fatta: archivio v1, scaffolding, CI, deploy                       |
| F1   | Fatta: struttura grafica e temi                                   |
| F2   | Fatta: modello e archivio IndexedDB                               |
| F3   | Fatta: schede                                                     |
| F4   | Fatta: editor e salvataggio continuo                              |
| F5   | Fatta: anteprima Markdown sicura                                  |
| F6   | Fatta: raccolta, tag, viste, ricerca, avviso tra schede           |
| F7   | Fatta: cifratura a riposo, blocco, cambio passphrase, migrazione  |
| F8   | Fatta: esportazione e importazione del file `.notepad` cifrato    |
| F9   | Fatta: PWA offline, e2e completi, collaudo finale, documentazione |

Dopo F9:

- **Chiudi tutte le schede**: pulsante in fondo alla barra delle schede (fuori dal `tablist`) e <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd>; chiude le schede con un solo salvataggio di `meta`, senza eliminare note né scartare modifiche in coda e senza conferma; restano aperte le note con l'avviso "cambiata in un'altra scheda", che aspettano la scelta della versione. La pagina "Nessuna nota aperta" ha anche "Cerca nelle note (Ctrl+K)" ed elenca solo le 50 note più recenti.
- **Chiudi le schede non fissate**: pulsante accanto a "Chiudi tutte le schede"; chiude tutte le schede tranne quelle delle note fissate (e quelle in attesa di scelta tra due versioni), senza eliminare nulla.
- **Avviso sopra le note rimosso** su richiesta del Senior.
- **Duplica**: pulsante nella barra della nota tra "Fissa" ed "Elimina…"; copia del testo in memoria (modifiche non salvate comprese) con "(copia)" in fondo al titolo, id e date nuovi, non fissata, aperta in una scheda nuova col cursore all'inizio, annunciata con "Nota duplicata". Stesso percorso di Alt+N (`openNewNote`: annullamento se il salvataggio fallisce, epoca del blocco); dopo il salvataggio le altre schede del browser ricevono `{ id, modifiedAt }` e caricano la nota nuova, anche quella creata con Alt+N. Nessuna scorciatoia (Alt+D è la barra degli indirizzi).

- **Modalità zen**: pulsante "Zen" nella barra superiore (solo con una nota aperta) e <kbd>Alt</kbd>+<kbd>Z</kbd>. Spariscono barra superiore, raccolta, schede, barra della nota, barra di stato e numeri di riga; il testo sta in una colonna centrata (72 caratteri) e più grande, anche nell'anteprima, e <kbd>Ctrl</kbd>+<kbd>E</kbd> cambia ancora modalità. Si chiede lo schermo intero del browser; dove manca (iPhone) o viene rifiutato resta il layout. Restano l'avviso "cambiata in un'altra scheda", gli errori e una barra in alto a destra (stato del salvataggio, parole, "Esci da zen") che si vede passandoci sopra, con il focus, sui dispositivi touch e sempre con un errore o una nota in attesa. Si esce con <kbd>Alt</kbd>+<kbd>Z</kbd>, il pulsante o <kbd>Esc</kbd>; a schermo intero il primo <kbd>Esc</kbd> lo prende il browser e zen resta. Solo in memoria: blocco, ricaricamento o nessuna nota aperta fanno uscire (e dallo schermo intero).

- **Markdown nell'editor**: evidenziazione con `@codemirror/lang-markdown` (solo `markdownLanguage`, CommonMark + GFM: senza `markdown()` l'HTML, il CSS e il JavaScript di lang-html restano fuori dal bundle, +45 kB invece di qualche centinaio) e uno stile sulle variabili CSS della pagina: titoli più grandi, grassetto, corsivo, barrato, codice, link, citazioni; i segni restano, attenuati. <kbd>Invio</kbd> continua elenchi, attività e citazioni e su una voce vuota esce dall'elenco; <kbd>Backspace</kbd> dopo il segno lo toglie. Scrivendo sopra una selezione con stili diversi i browser inserivano `<span style>` (bloccati dalla CSP): quella sostituzione la fa CodeMirror. Dipendenze nuove, tutte con almeno 14 giorni: `@codemirror/lang-markdown` 6.5.2, `@codemirror/language` 6.12.4, `@lezer/highlight` 1.2.4.

- **Dal vivo**: quarta modalità di visualizzazione tra Modifica e Affiancata (<kbd>Ctrl</kbd>+<kbd>E</kbd> la include). Solo l'editor, con il carattere del testo: sulle righe senza cursore né selezione i segni del Markdown spariscono (titoli, enfasi, barrato, codice in linea, citazioni, link con indirizzo e titolo, `<>` dei link automatici), i punti elenco diventano "•", le attività caselle che si spuntano con un clic (cambia `[ ]`/`[x]` nel testo, si salva come ogni modifica), `---` una linea. Sulla riga del cursore torna il sorgente. Restano sorgente, in monospaziato, tabelle, blocchi di codice, HTML e immagini. Solo decorazioni di CodeMirror: il testo della nota non cambia, niente HTML né attributi `style`. Funziona anche in zen.

- **Copia alla selezione**: come nei terminali, il testo selezionato col mouse nell'editor (trascinando, doppio o triplo clic, Maiusc+clic) va negli appunti e la barra di stato (o la barra zen, che si mostra) dice "Copiati N caratteri (R righe)" per 4 secondi; i lettori di schermo lo sentono. Da tastiera niente copia automatica. Preferenza "Copia negli appunti il testo selezionato con il mouse" nelle impostazioni (sezione Editor), attiva di default, in `localStorage`.

- **Modalità progetto**: accanto a ogni tag `#progetto/…` della raccolta, il pulsante con la cartella ("Apri il progetto …") apre il progetto. Una striscia sopra raccolta e note mostra nome e numero di note con "Esci dal progetto". Dentro: la raccolta, le sue viste e i suoi tag contano solo le note del progetto (il tag del progetto non si elenca, è implicito: anche un clic sul tag nell'anteprima o una vista salvata che lo contiene lo tolgono dal filtro); le schede mostrate sono solo quelle delle sue note più quella attiva, che resta anche se la nota perde il tag finché non si cambia scheda. Le altre schede non si chiudono né si salvano diversamente: restano aperte, messe da parte, e tornano all'uscita. Chiudi tutte, chiudi le non fissate, Alt+W e Ctrl+Alt+←/→ restano tra le schede del progetto; le note nuove hanno il tag del progetto per primo, poi quelli del filtro; la pagina "Nessuna nota aperta" elenca le note del progetto. La ricerca cerca nel progetto, con la casella "Solo nel progetto …" per cercare in tutte: aprire una nota di fuori esce dal progetto. Entrando, se la scheda attiva non è del progetto diventa attiva la prima sua (o nessuna); uscendo la nota attiva resta, o se non c'è torna quella di prima, insieme al filtro di prima. Passando da un progetto all'altro si ricorda lo stato di prima del primo. Solo in memoria (contiene un nome di tag): ricaricamento e blocco tornano a tutte le note. Le schede di ogni progetto invece si ricordano: a ogni cambio di scheda nel progetto quelle mostrate (`{ open, active }`) si salvano in `meta` sotto la chiave fissa `projectTabs`, cifrata come ogni valore di `meta` (i nomi dei tag stanno solo nel valore); rientrando si riaprono in fondo quelle che esistono e sono ancora del progetto, e diventa attiva quella salvata se l'attuale non è del progetto. Chiudendo tutte le schede del progetto la voce si toglie. Ogni scrittura rilegge il valore salvato, così le voci di altri progetti scritte da un'altra scheda del browser restano; le voci cambiate in un'altra scheda arrivano qui alla prossima apertura dell'archivio.

Limiti noti e accettati:

- **Origine condivisa**: ogni pagina sotto `lucamilan.github.io` ha la stessa origine dell'app e può leggere o alterare l'archivio cifrato e, a note sbloccate, agire nella pagina. La cifratura protegge la riservatezza a riposo, non l'integrità né una sessione sbloccata. Si risolve solo con un dominio dedicato.
- **Metadati a riposo**: nell'archivio si vedono il numero di note, la loro dimensione approssimativa, gli identificativi casuali e i parametri della passphrase (sale, iterazioni); le preferenze di `localStorage` (tema, modalità, raccolta, tempo di blocco) sono in chiaro.
- **Nessun recupero** della passphrase; la chiave dati non ruota al cambio passphrase (chi ha una vecchia copia dell'archivio e la vecchia passphrase può leggere le note di allora).
- **Appunti**: il testo copiato (anche dalla copia alla selezione) esce dalla cifratura: altre app e la cronologia degli appunti del sistema possono leggerlo. La copia alla selezione si spegne nelle impostazioni.
- **Dati solo nel browser**: cancellare i dati del sito elimina le note; l'unico backup è l'esportazione `.notepad`.
- **Aggiornamenti**: arrivano solo quando l'utente preme "Aggiorna"; una scheda rimasta aperta a lungo con la versione vecchia e già aggiornata da un'altra mostra l'avviso e va ricaricata.
- **CSP in un meta tag** (GitHub Pages non manda header): niente `frame-ancestors` né report delle violazioni.
- **Cache dell'app sull'origine condivisa**: le altre pagine di `lucamilan.github.io` possono scrivere nella cache, ma il service worker verifica lo SHA-256 di ogni file (all'installazione e a ogni risposta) e scarta quelli alterati; possono però cancellare la cache o disattivare il service worker, e allora l'app torna alla rete (offline non si apre finché non si ricarica online).
- **Schede vecchie dopo un aggiornamento da un'altra scheda**: i file della versione precedente non si servono più dalla cache (gli hash vecchi verrebbero da uno spazio scrivibile da altri); se una scheda vecchia deve ancora caricarne uno, mostra "Ricarica la pagina" e l'avviso di aggiornamento.
- **Service worker in locale**: dopo `npm run preview` resta registrato su `localhost` finché non lo si rimuove dagli strumenti per sviluppatori.

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
