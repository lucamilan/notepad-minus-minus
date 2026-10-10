import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockedQueueCount, vaultState } from '../src/features/crypto/vault';
import { UpdateBanner } from '../src/features/pwa/UpdateBanner';
import { resetUpdateForTests, updateState } from '../src/features/pwa/update';

describe('avviso di aggiornamento', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    resetUpdateForTests();
    lockedQueueCount.value = 0;
    vaultState.value = { status: 'opening' };
  });

  const button = (name: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === name);

  it('la regione role="status" c’è già prima dell’avviso', () => {
    render(<UpdateBanner />, root);
    const region = root.querySelector('[role="status"]');
    expect(region?.textContent).toBe('');
    act(() => {
      updateState.value = 'waiting';
    });
    expect(region?.textContent).toContain('È disponibile una nuova versione');
    expect(button('Aggiorna')?.disabled).toBe(false);
  });

  it('bloccate con modifiche trattenute: prima si sblocca, il pulsante è disattivato', () => {
    vaultState.value = { status: 'locked' };
    lockedQueueCount.value = 2;
    updateState.value = 'waiting';
    render(<UpdateBanner />, root);
    expect(root.textContent).toContain('Sblocca per salvare le modifiche prima di aggiornare');
    expect(button('Aggiorna')?.disabled).toBe(true);
    expect(button('Più tardi')?.disabled).toBe(false);

    act(() => {
      vaultState.value = { status: 'unlocked' };
    });
    expect(root.textContent).not.toContain('Sblocca per salvare');
    expect(button('Aggiorna')?.disabled).toBe(false);
  });

  it('bloccate senza modifiche trattenute si aggiorna subito', () => {
    vaultState.value = { status: 'locked' };
    updateState.value = 'waiting';
    render(<UpdateBanner />, root);
    expect(root.textContent).not.toContain('Sblocca per salvare');
    expect(button('Aggiorna')?.disabled).toBe(false);
  });

  it('"Più tardi" nasconde l’avviso e riporta il focus dov’era', async () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    render(<UpdateBanner />, root);
    act(() => {
      updateState.value = 'waiting';
    });
    const later = button('Più tardi');
    later?.focus();
    act(() => later?.click());
    expect(root.textContent).not.toContain('nuova versione');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(field);
    field.remove();
  });
});
