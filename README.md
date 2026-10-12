# notepad-minus-minus

Notepad−− è un blocco note che vive solo nel browser: le note sono cifrate con una passphrase, restano sul dispositivo e non vengono mai inviate in rete. Si installa come app e funziona anche senza connessione.

<https://lucamilan.github.io/notepad-minus-minus/>

Scrivi in Markdown con anteprima affiancata, organizzi le note con tag nel testo (`#cliente/acme`, `#progetto/sito`, `#tipo/riunione` o tag liberi come `#idee`), le ritrovi con viste e ricerca, le tieni aperte in schede.

## Privacy e sicurezza

- **Solo nel browser.** Le note stanno in IndexedDB, nel browser e nel profilo in cui le scrivi. L’app non ha server, account, statistiche o font e immagini esterne: le uniche richieste di rete sono per i suoi stessi file e per controllare se c’è una versione nuova. I link nelle note si aprono in una nuova scheda senza referrer; le immagini remote nelle note sono bloccate.
- **Cifratura.** Al primo avvio scegli una passphrase (almeno 12 caratteri; meglio 4 o più parole a caso). Note, schede aperte e viste salvate sono cifrate con AES-256-GCM; la chiave deriva dalla passphrase (PBKDF2-SHA-256, 600.000 iterazioni) e resta solo in memoria mentre le note sono sbloccate.
- **Nessun recupero.** Se dimentichi la passphrase nessuno può leggere le note, nemmeno tu: puoi solo eliminarle tutte e ricominciare ("Ho dimenticato la passphrase").
- **Blocco.** Le note si bloccano con <kbd>Alt</kbd>+<kbd>L</kbd> o "Blocca" (in tutte le schede del browser) e da sole dopo un periodo di inattività (5, 15, 30 o 60 minuti, nelle impostazioni). Bloccando, l’app scarta dalla memoria il testo decifrato, l’indice di ricerca e la chiave.
- **Cosa si vede a riposo.** Chi ha accesso ai file del browser non legge testi, titoli, tag, date né viste salvate. Vede però quante note ci sono, la loro dimensione approssimativa e il loro identificativo casuale, oltre ai parametri della passphrase (sale e numero di iterazioni). Tema, modalità di visualizzazione, raccolta e tempo di blocco sono preferenze in chiaro nel `localStorage`.
- **Limite dell’origine condivisa.** Tutte le pagine sotto `lucamilan.github.io` hanno la stessa origine dell’app: possono leggere o alterare l’archivio cifrato e, mentre le note sono sbloccate, agire nella pagina. La cifratura protegge le note salvate, non l’integrità dell’archivio né una sessione sbloccata. Quelle pagine possono anche scrivere nella cache dell’app: per questo l’app controlla l’impronta (SHA-256) di ogni suo file prima di usarlo e scarta quelli alterati. Possono però cancellare la cache o disattivare il service worker: allora l’app torna a scaricarsi dalla rete e, finché non lo rifà, senza connessione non si apre. È un limite accettato di GitHub Pages.
- **Offline e installabile.** Un service worker tiene in cache solo i file dell’app (HTML, JavaScript, stili, font, icone), mai le note, e li usa solo se l’impronta corrisponde a quella della versione installata. Dal browser puoi installarla ("Installa app" o "Aggiungi a schermata Home") e aprirla senza connessione.
- **Appunti.** Il testo copiato (anche con la copia alla selezione) va negli appunti del sistema, fuori dalla cifratura: altre app e la cronologia degli appunti possono leggerlo. Se nelle note tieni dati delicati, spegni la copia alla selezione nelle impostazioni.
- **File .md.** "Salva .md" scrive la nota in chiaro sul disco, fuori dalla cifratura: il file resta leggibile da chi accede al computer, anche dopo il blocco.
- **Politica di sicurezza dei contenuti.** La pagina ammette solo i propri script e stili, nessuna connessione verso altri siti e, con Trusted Types, nessun HTML scritto nel DOM se non quello dell’anteprima, già ripulito da DOMPurify.

## Come si usa

- **Note e schede.** Ogni scheda è una nota aperta; il titolo è la prima riga. Chiudere una scheda non elimina la nota: la riapri dalla raccolta o dalla ricerca. "Chiudi le schede non fissate" e "Chiudi tutte le schede" (in fondo alla barra delle schede) le chiudono insieme, tranne le note fissate nel primo caso, sempre senza eliminare nulla; restano aperte solo le note cambiate in un’altra scheda del browser, finché non scegli quale versione tenere. "Duplica" crea una copia della nota, con le modifiche non ancora salvate e "(copia)" in fondo al titolo, e la apre in una scheda nuova. Per eliminare una nota usa "Elimina…", che chiede conferma. "Salva .md" salva la nota in un file Markdown, col nome ricavato dal titolo (es. `perche-il-caffe.md`): nei browser che lo permettono (Chrome, Edge) scegli tu dove e con che nome, negli altri si scarica.
- **Salvataggio.** È sempre attivo: le modifiche si salvano dopo mezzo secondo di pausa, quando cambi scheda o chiudi la pagina. Lo stato è nella barra in basso.
- **Markdown nell’editor.** Il testo resta Markdown, ma titoli, grassetto, corsivo, codice, link e citazioni si vedono già formattati; i segni (`#`, `*`, `` ` ``) restano, più chiari. <kbd>Invio</kbd> continua elenchi, attività e citazioni; su una voce vuota esce dall’elenco.
- **Anteprima.** Quattro modalità: Modifica (il testo Markdown), Dal vivo (si scrive con il Markdown già formattato: i segni si vedono solo sulla riga del cursore, le caselle delle attività si spuntano con un clic; tabelle, codice e immagini restano testo), Affiancata, Anteprima. Doppio clic su un punto dell’anteprima per scrivere da quella riga. Le liste di attività (`- [ ] da fare`) diventano caselle.
- **Modalità zen.** "Zen" nella barra in alto o <kbd>Alt</kbd>+<kbd>Z</kbd>: restano solo il testo della nota, in una colonna centrata e più grande, e lo schermo intero del browser (dove c’è; su iPhone solo il layout). Una barra in alto a destra, visibile passandoci sopra, mostra salvataggio e parole ed esce da zen; si vede sempre se il salvataggio ha un problema. Si esce con <kbd>Alt</kbd>+<kbd>Z</kbd> o <kbd>Esc</kbd> (a schermo intero il primo <kbd>Esc</kbd> esce dallo schermo intero).
- **Copia alla selezione.** Come nei terminali: il testo che selezioni col mouse nell’editor (trascinando, doppio o triplo clic) va subito negli appunti e la barra in basso dice quanti caratteri hai copiato. Con la tastiera si copia con <kbd>Ctrl</kbd>+<kbd>C</kbd>. Si spegne nelle impostazioni (Editor).
- **Tag e raccolta.** Scrivi `#` nel testo e l’editor suggerisce i tag già usati. La raccolta mostra le viste (Tutte, Recenti, Attività aperte, Fissate, Senza tag), i tag per categoria (Clienti, Progetti, Tipi, Altri tag) e le viste che salvi da un filtro. Fissa le note importanti per tenerle in cima.
- **Ricerca.** Cerca in tutte le note, senza badare a maiuscole e accenti; accetta `#tag` e `is:aperte`, `is:fissate`, `is:recenti`.

### Scorciatoie da tastiera

| Tasti                                                                      | Azione                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| <kbd>Alt</kbd>+<kbd>N</kbd>                                                | Nuova nota in una scheda nuova                                                  |
| <kbd>Alt</kbd>+<kbd>W</kbd>                                                | Chiude la scheda (la nota resta nell’archivio)                                  |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>W</kbd>                               | Chiude tutte le schede (le note restano nell’archivio)                          |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd>                 | Scheda precedente / successiva                                                  |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>Home</kbd> <kbd>Fine</kbd>, <kbd>Canc</kbd> | Sulle schede: spostarsi, chiudere la scheda                                     |
| <kbd>Ctrl</kbd>+<kbd>E</kbd>                                               | Modifica → Dal vivo → Affiancata → Anteprima                                    |
| <kbd>Invio</kbd>                                                           | Nella sola anteprima: torna a scrivere                                          |
| <kbd>Ctrl</kbd>+<kbd>S</kbd>                                               | Salva subito                                                                    |
| <kbd>Ctrl</kbd>+<kbd>K</kbd>                                               | Cerca in tutte le note (<kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Invio</kbd> apre)       |
| <kbd>Ctrl</kbd>+<kbd>&#92;</kbd>                                           | Mostra o nasconde la raccolta                                                   |
| <kbd>Alt</kbd>+<kbd>Z</kbd>                                                | Modalità zen: solo il testo, a schermo intero                                   |
| <kbd>Alt</kbd>+<kbd>L</kbd>                                                | Blocca le note in tutte le schede                                               |
| <kbd>Esc</kbd>                                                             | Chiude menu, dialoghi, ricerca e la raccolta sugli schermi stretti; esce da zen |

Su macOS <kbd>Cmd</kbd> vale come <kbd>Ctrl</kbd>.

## Spostare le note su un altro PC

Le note restano nel browser in cui le scrivi. Per portarle su un altro PC (o in un altro browser):

1. qui, dal menu "Altro" (o dalle impostazioni, sezione "Trasferimento tra PC") scegli **Esporta note…**, scrivi due volte una passphrase per il file (almeno 12 caratteri: può essere quella delle note, ma va riscritta) e salva il file `notepad-AAAA-MM-GG.notepad`;
2. porta il file sull’altro PC (chiavetta, e-mail, cartella condivisa: è cifrato con AES-256-GCM e non contiene nulla in chiaro, nemmeno quante note ci sono);
3. lì scegli **Importa note…**, il file e la sua passphrase, poi:
   - **Unisci** (predefinito): aggiunge le note nuove; se una nota è su entrambi i PC resta la versione modificata più di recente; le viste salvate con un nome nuovo si aggiungono;
   - **Sostituisci tutto**: elimina le note e le viste salvate di quel browser e mette quelle del file (chiede una conferma esplicita).

Senza la passphrase del file non c’è modo di aprirlo. Le note illeggibili non si esportano e non vengono mai sovrascritte. Le note con modifiche non ancora salvate, o appena cambiate in un’altra scheda, restano come sono e l’esito le conta come "in conflitto".

L’esportazione è anche il modo per fare un backup: cancellando i dati del sito nel browser le note si perdono.

## Aggiornamenti

Quando è pubblicata una versione nuova, l’app la scarica da sola ma non la usa finché non lo chiedi: compare l’avviso **"È disponibile una nuova versione"**, anche con le note bloccate. **Aggiorna** salva le modifiche in coda e ricarica la pagina con la versione nuova; **Più tardi** nasconde l’avviso fino al prossimo avvio. È così che arrivano le correzioni: conviene aggiornare appena l’avviso compare.

Se le note sono bloccate e al blocco alcune modifiche non si erano potute salvare, l’avviso chiede di sbloccare prima: quelle modifiche si salvano solo con le note sbloccate, e aggiornando andrebbero perse.

Una versione nuova si installa solo se tutti i suoi file arrivano completi e integri; altrimenti resta quella di prima e si riprova più tardi.

**Se l’app non si apre dopo un aggiornamento:** chiudi tutte le schede e le finestre di Notepad−− (anche l’app installata) e riaprila. **Non cancellare i dati del sito** dalle impostazioni del browser: cancellerebbe anche le note.

## Sviluppo

Serve Node 22.

```sh
npm ci
npm run dev          # server di sviluppo (senza CSP né service worker)
npm run build        # controllo dei tipi + build di produzione in dist/
npm run preview      # serve dist/ con CSP e service worker attivi
npm run lint
npm run typecheck
npm run format       # Prettier
npm test             # test unitari (Vitest)
npm run test:e2e     # test end-to-end (Playwright, Chromium e Firefox) sulla build: prima npm run build
npx playwright install chromium firefox   # una volta, per i browser dei test e2e
```

Prima di aprire una PR: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`. Fermare eventuali `vite preview` rimasti aperti sulla porta 4173: Playwright riusa il server che trova.

`npm run preview` registra il service worker su `localhost`: se poi `npm run dev` sembra servire file vecchi, rimuovilo dagli strumenti per sviluppatori (Applicazione → Service worker).

L’architettura e le regole di sicurezza sono in [CLAUDE.md](CLAUDE.md); decisioni, fasi e limiti accettati in [docs/piano-v2.md](docs/piano-v2.md).

## Versione 1

La versione 1 (Blazor WebAssembly, .NET 7) è archiviata nel branch [`legacy/blazor-net7`](https://github.com/lucamilan/notepad-minus-minus/tree/legacy/blazor-net7), tag `v1-blazor-final`. Le sue note non si importano; se nel browser restano i suoi dati, le impostazioni offrono di eliminarli.
