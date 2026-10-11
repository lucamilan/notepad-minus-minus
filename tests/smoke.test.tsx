import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { Workspace } from '../src/app/Workspace';
import { vaultState } from '../src/features/crypto/vault';
import { createNote, type Note } from '../src/features/notes/note';
import { notesState } from '../src/features/notes/store';
import { tabsState } from '../src/features/tabs/tabs';

function ready(
  notes: Note[],
  open: string[] = notes.slice(0, 1).map((n) => n.id),
  unreadable: string[] = [],
) {
  notesState.value = { status: 'ready', notes, unreadable };
  tabsState.value = { open, active: open[0] ?? null };
}

describe('Workspace', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    render(null, root); // smonta l'app e distrugge l'EditorView
    root.remove();
    notesState.value = { status: 'loading' };
    tabsState.value = { open: [], active: null };
  });

  it('mostra la barra, senza avvisi sopra le note, e il caricamento delle note', () => {
    render(<Workspace />, root);

    expect(root.querySelector('.logo')?.textContent).toContain('Notepad−−');
    expect(root.querySelector('.notice')).toBeNull();
    expect(root.querySelector('.lock-button')?.getAttribute('aria-keyshortcuts')).toBe('Alt+L');
    expect(root.querySelector('.workspace')?.textContent).toContain('Apertura delle note');
  });

  it("con le note pronte apre l'editor sulla scheda attiva", () => {
    ready([createNote('# Prima nota', 0)]);
    render(<Workspace />, root);

    expect(root.querySelector('.editor-host')).not.toBeNull();
    expect(root.querySelector('.status')?.textContent).toContain('Creata il');
    expect(root.querySelector('.workspace-warning')).toBeNull();
  });

  it('mostra una scheda per nota aperta, con titolo, tooltip e pannello collegato', () => {
    const long = createNote('## Un titolo decisamente troppo lungo per una scheda\ntesto', 0);
    const other = createNote('Seconda', 0);
    ready([long, other], [long.id, other.id]);
    render(<Workspace />, root);

    const tabs = root.querySelectorAll('[role="tablist"] [role="tab"]');
    expect(tabs).toHaveLength(2);
    const [first, second] = tabs;
    expect(first?.textContent).toBe('Un titolo decisamente tropp...');
    expect(first?.getAttribute('title')).toMatch(
      /^"Un titolo decisamente troppo lungo per una scheda" creata il /,
    );
    expect(first?.getAttribute('aria-selected')).toBe('true');
    expect(first?.getAttribute('tabindex')).toBe('0');
    expect(second?.getAttribute('aria-selected')).toBe('false');
    expect(second?.getAttribute('tabindex')).toBe('-1');

    const panel = root.querySelector('[role="tabpanel"]');
    expect(first?.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(first?.id);
    // Il × è solo per il mouse: da tastiera si chiude con Canc o Alt+W.
    expect(root.querySelector('.tab-close')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('senza schede aperte propone le note da riaprire', () => {
    ready([createNote('# Lista della spesa', 0)], []);
    render(<Workspace />, root);

    expect(root.querySelector('.editor-host')).toBeNull();
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.querySelector('.empty h2')?.textContent).toBe('Nessuna nota aperta');
    expect(root.querySelector('.reopen')?.textContent).toContain('Lista della spesa');
    expect(root.querySelector('.status')?.textContent).not.toContain('Creata il');
    expect(root.querySelector('.reopen-more')).toBeNull();
    expect(root.querySelector('.tab-close-all')).toBeNull();
  });

  it('senza schede aperte elenca solo le 50 note più recenti e rimanda alla ricerca', () => {
    const notes = Array.from({ length: 53 }, (_, i) => createNote(`Nota ${i}`, i));
    ready(notes, []);
    render(<Workspace />, root);

    const items = root.querySelectorAll('.reopen li');
    expect(items).toHaveLength(50);
    expect(items[0]?.textContent).toContain('Nota 52');
    expect(items[49]?.textContent).toContain('Nota 3');
    expect(root.querySelector('.reopen-more')?.textContent).toBe('e altre 3: usa Cerca nelle note');
  });

  it('segnala le note illeggibili senza bloccare le altre', () => {
    ready([createNote('# Leggibile', 0)], undefined, ['a', 'b']);
    render(<Workspace />, root);

    expect(root.querySelector('.workspace-warning')?.textContent).toContain(
      '2 note non si possono',
    );
    expect(root.querySelector('.editor-host')).not.toBeNull();
  });

  it('durante un aggiornamento bloccato spiega cosa fare', () => {
    notesState.value = { status: 'loading', message: "Chiudi l'altra scheda" };
    render(<Workspace />, root);

    expect(root.querySelector('.workspace')?.textContent).toContain("Chiudi l'altra scheda");
  });

  it("se l'archivio non si apre mostra il motivo", () => {
    notesState.value = { status: 'error', message: 'Archivio bloccato' };
    render(<Workspace />, root);

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Archivio bloccato');
  });
});

describe('App', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vaultState.value = { status: 'opening' };
  });

  it('al primo avvio chiede di creare la passphrase, senza aree delle note', () => {
    vaultState.value = { status: 'setup', legacy: true };
    render(<App />, root);

    expect(root.querySelector('h1')?.textContent).toBe('Proteggi le tue note');
    expect(root.textContent).toContain('Le note già presenti verranno cifrate');
    const fields = root.querySelectorAll('input');
    expect([...fields].map((f) => f.getAttribute('autocomplete'))).toEqual([
      'new-password',
      'new-password',
    ]);
    expect([...fields].every((f) => f.type === 'password')).toBe(true);
    expect(root.querySelector('.editor-host')).toBeNull();
    expect(root.textContent).toContain('le note sono perse');
  });

  it('bloccata mostra lo sblocco con il motivo del blocco', async () => {
    vaultState.value = { status: 'locked', message: 'Note bloccate per inattività.' };
    render(<App />, root);

    expect(root.querySelector('h1')?.textContent).toBe('Note bloccate');
    // Il motivo descrive il campo, che prende il focus: un lettore di schermo lo legge subito.
    expect(root.querySelector('#unlock-reason')?.textContent).toBe('Note bloccate per inattività.');
    const field = root.querySelector('input');
    expect(field?.getAttribute('autocomplete')).toBe('current-password');
    expect(field?.getAttribute('aria-describedby')).toBe('unlock-reason unlock-error');
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
    const toggle = root.querySelector<HTMLButtonElement>('.show-toggle');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  });

  it("se l'archivio non si apre lo spiega nella schermata di blocco", () => {
    vaultState.value = { status: 'error', message: 'Archivio bloccato' };
    render(<App />, root);

    expect(root.querySelector('.workspace [role="alert"]')?.textContent).toContain(
      'Archivio bloccato',
    );
  });
});
