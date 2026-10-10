import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import { createNote } from '../src/features/notes/note';
import { notesState } from '../src/features/notes/store';

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
  });

  it("mostra la barra, l'avviso di anteprima e il caricamento delle note", () => {
    render(<App />, root);

    expect(root.querySelector('.logo')?.textContent).toContain('Notepad−−');
    expect(root.querySelector('.notice')?.textContent).toContain('le modifiche non');
    expect(root.querySelector('.workspace')?.textContent).toContain('Apertura delle note');
  });

  it("con le note pronte apre l'editor sulla prima", () => {
    notesState.value = { status: 'ready', notes: [createNote('# Prima nota', 0)], unreadable: [] };
    render(<App />, root);

    expect(root.querySelector('.editor-host')).not.toBeNull();
    expect(root.querySelector('.status')?.textContent).toContain('Creata il');
    expect(root.querySelector('.workspace-warning')).toBeNull();
  });

  it('segnala le note illeggibili senza bloccare le altre', () => {
    notesState.value = {
      status: 'ready',
      notes: [createNote('# Leggibile', 0)],
      unreadable: ['a', 'b'],
    };
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
