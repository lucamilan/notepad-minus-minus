import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';

describe('App', () => {
  let root: HTMLElement;

  afterEach(() => {
    render(null, root); // smonta l'app e distrugge l'EditorView
    root.remove();
  });

  it("mostra la barra, l'avviso di anteprima e l'area dell'editor", () => {
    root = document.createElement('div');
    document.body.append(root);

    render(<App />, root);

    expect(root.querySelector('.logo')?.textContent).toContain('Notepad−−');
    expect(root.querySelector('.notice')?.textContent).toContain('il salvataggio non c');
    expect(root.querySelector('.editor-host')).not.toBeNull();
  });
});
