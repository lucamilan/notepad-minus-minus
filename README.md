# notepad-minus-minus

Blocco note che vive solo nel browser: le note sono cifrate con una passphrase e non lasciano mai il dispositivo.

<https://lucamilan.github.io/notepad-minus-minus/>

## Stato

La versione 2 è in costruzione, una fase alla volta: il piano è in [docs/piano-v2.md](docs/piano-v2.md).

Scorciatoie da tastiera: <kbd>Alt</kbd>+<kbd>N</kbd> nuova nota, <kbd>Alt</kbd>+<kbd>W</kbd> chiude la scheda (la nota resta nell'archivio), <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> cambia scheda, <kbd>Ctrl</kbd>+<kbd>E</kbd> passa tra Modifica, Affiancata e Anteprima (doppio clic sull'anteprima per tornare a scrivere da quel punto), <kbd>Ctrl</kbd>+<kbd>S</kbd> salva subito, <kbd>Ctrl</kbd>+<kbd>K</kbd> cerca in tutte le note, <kbd>Ctrl</kbd>+<kbd>&#92;</kbd> mostra o nasconde la raccolta, <kbd>Alt</kbd>+<kbd>L</kbd> blocca le note in tutte le schede; sulle schede <kbd>←</kbd>/<kbd>→</kbd> per spostarsi e <kbd>Canc</kbd> per chiudere.

La versione 1 (Blazor WebAssembly, .NET 7) è archiviata nel branch [`legacy/blazor-net7`](https://github.com/lucamilan/notepad-minus-minus/tree/legacy/blazor-net7), tag `v1-blazor-final`.

## Sicurezza

Al primo avvio si sceglie una passphrase (almeno 12 caratteri; meglio 4 o più parole a caso). Le note, le schede aperte e le viste salvate sono cifrate con AES-256-GCM in IndexedDB; la chiave deriva dalla passphrase (PBKDF2-SHA-256, 600.000 iterazioni) e resta solo in memoria mentre le note sono sbloccate. **Non c'è recupero**: se dimentichi la passphrase puoi solo eliminare tutte le note e ricominciare.

Le note si bloccano con <kbd>Alt</kbd>+<kbd>L</kbd> o il pulsante "Blocca" (in tutte le schede aperte) e da sole dopo un periodo di inattività (5, 15, 30 o 60 minuti, nelle impostazioni). Bloccando, l’app scarta il testo decifrato e la chiave. Le note scritte con le anteprime precedenti, salvate in chiaro, vengono cifrate alla creazione della passphrase e il vecchio archivio viene eliminato; i dati della v1, se presenti, si possono eliminare dalle impostazioni.

La cifratura protegge le note salvate nel browser, non una sessione sbloccata: tutte le pagine sotto `lucamilan.github.io` condividono la stessa origine.

## Sviluppo

Serve Node 22.

```sh
npm ci
npm run dev
```

Prima di aprire una PR: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`.
