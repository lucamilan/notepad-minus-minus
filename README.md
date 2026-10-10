# notepad-minus-minus

Blocco note che vive solo nel browser: le note sono cifrate con una passphrase e non lasciano mai il dispositivo.

<https://lucamilan.github.io/notepad-minus-minus/>

## Stato

La versione 2 è in costruzione, una fase alla volta: il piano è in [docs/piano-v2.md](docs/piano-v2.md).

Scorciatoie da tastiera: <kbd>Alt</kbd>+<kbd>N</kbd> nuova nota, <kbd>Alt</kbd>+<kbd>W</kbd> chiude la scheda (la nota resta nell'archivio), <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> cambia scheda, <kbd>Ctrl</kbd>+<kbd>E</kbd> passa tra Modifica, Affiancata e Anteprima (doppio clic sull'anteprima per tornare a scrivere da quel punto), <kbd>Ctrl</kbd>+<kbd>S</kbd> salva subito; sulle schede <kbd>←</kbd>/<kbd>→</kbd> per spostarsi e <kbd>Canc</kbd> per chiudere.

La versione 1 (Blazor WebAssembly, .NET 7) è archiviata nel branch [`legacy/blazor-net7`](https://github.com/lucamilan/notepad-minus-minus/tree/legacy/blazor-net7), tag `v1-blazor-final`.

## Sviluppo

Serve Node 22.

```sh
npm ci
npm run dev
```

Prima di aprire una PR: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`.
