import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enterZen,
  exitZen,
  toggleZen,
  zenMode,
  type FullscreenHost,
} from '../src/features/zen/zen';

function fakeHost(options: { supported?: boolean; rejects?: boolean } = {}) {
  const { supported = true, rejects = false } = options;
  const host = {
    fullscreenElement: null as Element | null,
    requestFullscreen: vi.fn(() => {
      if (rejects) return Promise.reject(new TypeError('negato'));
      // Come nei browser: lo schermo intero arriva dopo, non alla chiamata.
      return Promise.resolve().then(() => {
        host.fullscreenElement = {} as Element;
      });
    }),
    exitFullscreen: vi.fn(() => {
      host.fullscreenElement = null;
      return Promise.resolve();
    }),
  };
  const api: FullscreenHost = {
    get fullscreenElement() {
      return host.fullscreenElement;
    },
    documentElement: (supported ? { requestFullscreen: host.requestFullscreen } : {}) as Pick<
      Element,
      'requestFullscreen'
    >,
    exitFullscreen: host.exitFullscreen,
  };
  return { host, api };
}

afterEach(() => {
  zenMode.value = false;
});

describe('modalità zen', () => {
  it('entrando chiede lo schermo intero, uscendo lo lascia', async () => {
    const { host, api } = fakeHost();
    enterZen(api);
    expect(zenMode.value).toBe(true);
    expect(host.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    await Promise.resolve();
    expect(host.fullscreenElement).not.toBeNull();
    exitZen(api);
    expect(zenMode.value).toBe(false);
    expect(host.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('senza schermo intero (iPhone) o con il rifiuto resta il layout zen', async () => {
    const unsupported = fakeHost({ supported: false });
    enterZen(unsupported.api);
    expect(zenMode.value).toBe(true);
    exitZen(unsupported.api);
    expect(unsupported.host.exitFullscreen).not.toHaveBeenCalled();

    const refused = fakeHost({ rejects: true });
    enterZen(refused.api);
    await Promise.resolve();
    expect(zenMode.value).toBe(true);
    expect(refused.host.fullscreenElement).toBeNull();
  });

  it('uscito dallo schermo intero con Esc, zen resta finché non si esce', async () => {
    const { host, api } = fakeHost();
    enterZen(api);
    await Promise.resolve();
    host.fullscreenElement = null; // Esc gestito dal browser
    expect(zenMode.value).toBe(true);
    toggleZen(api);
    expect(zenMode.value).toBe(false);
    expect(host.exitFullscreen).not.toHaveBeenCalled();
  });

  it('uscendo prima che lo schermo intero arrivi, lo si lascia appena arriva', async () => {
    const { host, api } = fakeHost();
    enterZen(api);
    exitZen(api);
    expect(host.exitFullscreen).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(host.fullscreenElement).toBeNull();
  });

  it('già a schermo intero (F11 o altro) non lo richiede di nuovo', () => {
    const { host, api } = fakeHost();
    host.fullscreenElement = {} as Element;
    toggleZen(api);
    expect(zenMode.value).toBe(true);
    expect(host.requestFullscreen).not.toHaveBeenCalled();
  });
});
