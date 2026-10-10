# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Notepad Minus Minus: a client-only notepad running entirely in the browser as a Blazor WebAssembly app (.NET 7, MudBlazor UI, Markdig for markdown). Notes are persisted locally in the browser via SQLite + IndexedDB — there is no backend. Deployed to GitHub Pages at https://lucamilan.github.io/notepad-minus-minus/.

## Commands

The single project is `src/notepad.csproj` (namespace `notepad`). There are no tests and no linter configured.

```sh
dotnet workload install wasm-tools                 # required once: WasmBuildNative=true needs emscripten tooling
dotnet build src/notepad.csproj
dotnet watch run --project src/notepad.csproj      # dev server with hot reload
dotnet publish src/notepad.csproj -c Release -o dist/notepad-minus-minus --nologo   # same as publish-offline.ps1
```

Native WASM build (`WasmBuildNative`) makes builds/publishes slow; this is needed for the bundled `e_sqlite3` native library.

## Architecture

### Persistence: EF Core SQLite inside WASM, mirrored to IndexedDB

This is the non-obvious core of the app and spans several files:

- `Program.cs` registers `NotepadDbContext` via `AddDbContextFactory` with SQLite file `DbConstants.SqliteDbFilename` (`NotepadData.db`), which lives in the Emscripten in-memory virtual filesystem.
- `Data/DataSynchronizer.cs` (scoped) kicks off `FirstTimeSetupAsync` in its constructor: it imports `wwwroot/dbstorage.js`, which restores the DB file from IndexedDB (`SqliteStorage` db, `Files` store, key `"file"`) into the Emscripten FS via `Module.FS_createDataFile`, then runs `EnsureCreatedAsync` (no migrations — schema changes to `Sheet` won't be applied to existing user databases).
- `dbstorage.js` also starts a 1-second `setInterval` poll that copies the DB file back to IndexedDB whenever its `mtime` changes. So "saving" = EF `SaveChangesAsync` writes the virtual file; the JS poll persists it.
- Always obtain contexts through `DataSynchronizer.GetPreparedDbContextAsync()` (awaits setup) rather than the factory directly, and dispose them (`await using`). Entities are tracked manually via `db.Entry(x).State = ...` on short-lived contexts.

Build-file workarounds in `notepad.csproj` (`AllowUnsafeBlocks`, `EmccExtraLDFlags`, MudBlazor `TrimMode=copyused`) exist to make the native SQLite publish and trimming work; don't remove them casually.

### UI and cross-component events

- `Shared/MainLayout.razor` owns the app bar (autosave toggle, dark mode, Save All, loading overlay). `Pages/Index.razor(.cs)` is the only page: a `MudDynamicTabs` with one tab per `Sheet`, toggling between a `MudTextField` editor and a rendered `Components/Markdown` preview (double-click / adornment).
- Layout and page communicate through the scoped `Services/EventNotifier` (C# events `ShowSpinner`, `SaveAll`, `AutoSaveEnabled`). Subscribers must unsubscribe in `Dispose` and call `InvokeAsync(StateHasChanged)`.
- Autosave is a `PeriodicTimer` in `Index.razor.cs`; interval and default enablement come from `wwwroot/appsettings.json` (`Autosave_Interval_In_Seconds`, `Autosave_Enabled`), read via `IConfiguration`.
- A sheet's tab title is derived from the first line of its text (markdown stripped via `MarkdownService.ToPlainText`, truncated). `Sheet.IsEmpty()` treats titles starting with "Sample note" as the placeholder (no delete confirmation).

## Deployment

`.github/workflows/gh-pages.yaml` runs on push to `main`: installs `wasm-tools`, publishes, rewrites `<base href="/">` to `/notepad-minus-minus/`, copies `index.html` to `404.html`, adds `.nojekyll`, and pushes `dist/notepad-minus-minus/wwwroot` to the `gh-pages` branch. Keep `<base href="/">` in `src/wwwroot/index.html` as-is; the workflow depends on that exact string.
