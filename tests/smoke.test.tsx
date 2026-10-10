import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
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

describe('App', () => {
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

  it("mostra la barra, l'avviso di anteprima e il caricamento delle note", () => {
    render(<App />, root);

    expect(root.querySelector('.logo')?.textContent).toContain('Notepad−−');
    expect(root.querySelector('.notice')?.textContent).toContain('non sono ancora');
    expect(root.querySelector('.workspace')?.textContent).toContain('Apertura delle note');
  });

  it("con le note pronte apre l'editor sulla scheda attiva", () => {
    ready([createNote('# Prima nota', 0)]);
    render(<App />, root);

    expect(root.querySelector('.editor-host')).not.toBeNull();
    expect(root.querySelector('.status')?.textContent).toContain('Creata il');
    expect(root.querySelector('.workspace-warning')).toBeNull();
  });

  it('mostra una scheda per nota aperta, con titolo, tooltip e pannello collegato', () => {
    const long = createNote('## Un titolo decisamente troppo lungo per una scheda\ntesto', 0);
    const other = createNote('Seconda', 0);
    ready([long, other], [long.id, other.id]);
    render(<App />, root);

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
    render(<App />, root);

    expect(root.querySelector('.editor-host')).toBeNull();
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.querySelector('.empty h2')?.textContent).toBe('Nessuna nota aperta');
    expect(root.querySelector('.reopen')?.textContent).toContain('Lista della spesa');
    expect(root.querySelector('.status')?.textContent).not.toContain('Creata il');
  });

  it('segnala le note illeggibili senza bloccare le altre', () => {
    ready([createNote('# Leggibile', 0)], undefined, ['a', 'b']);
    render(<App />, root);

    expect(root.querySelector('.workspace-warning')?.textContent).toContain(
      '2 note non si possono',
    );
    expect(root.querySelector('.editor-host')).not.toBeNull();
  });

  it('durante un aggiornamento bloccato spiega cosa fare', () => {
    notesState.value = { status: 'loading', message: "Chiudi l'altra scheda" };
    render(<App />, root);

    expect(root.querySelector('.workspace')?.textContent).toContain("Chiudi l'altra scheda");
  });

  it("se l'archivio non si apre mostra il motivo", () => {
    notesState.value = { status: 'error', message: 'Archivio bloccato' };
    render(<App />, root);

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Archivio bloccato');
  });
});
