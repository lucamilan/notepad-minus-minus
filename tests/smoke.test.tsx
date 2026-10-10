import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';

describe('App', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('mostra la pagina di benvenuto', () => {
    const root = document.createElement('div');
    document.body.append(root);

    render(<App />, root);

    expect(root.querySelector('h1')?.textContent).toBe('La nuova versione è in costruzione');
  });
});
