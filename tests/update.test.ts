import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUpdate,
  resetUpdateForTests,
  startServiceWorker,
  trustedScriptUrl,
  UPDATE_CHECK_MS,
  UPDATE_FALLBACK_MS,
  updateInProgress,
  updateState,
  type ServiceWorkerEnv,
} from '../src/features/pwa/update';

/** Un service worker finto: stato e postMessage, con gli eventi di EventTarget. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  messages: unknown[] = [];
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  setState(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve());
  /** Il browser trova una versione nuova e la installa (resta in attesa). */
  install(): FakeWorker {
    const worker = new FakeWorker();
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    this.installing = null;
    this.waiting = worker;
    worker.setState('installed');
    return worker;
  }
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null;
  constructor(
    public registration: FakeRegistration,
    controlled: boolean,
  ) {
    super();
    this.controller = controlled ? new FakeWorker() : null;
  }
  register = vi.fn(() => Promise.resolve(this.registration));
  /** Attivazione di una versione nuova (qui o da un'altra scheda). */
  activate(worker: FakeWorker): void {
    this.registration.waiting = null;
    this.registration.active = worker;
    worker.setState('activated');
    this.controller = worker;
    this.dispatchEvent(new Event('controllerchange'));
  }
}

function setup(options: { controlled?: boolean; waiting?: boolean } = {}) {
  const registration = new FakeRegistration();
  registration.active = new FakeWorker();
  if (options.waiting) registration.waiting = new FakeWorker();
  const container = new FakeContainer(registration, options.controlled ?? true);
  const reload = vi.fn();
  const prepare = vi.fn(() => Promise.resolve());
  let visible: (() => void) | undefined;
  let now = 0;
  const env: ServiceWorkerEnv = {
    container: container as unknown as ServiceWorkerEnv['container'],
    scriptUrl: 'https://example.test/app/sw.js',
    scope: 'https://example.test/app/',
    prepare,
    reload,
    onVisible: (listener) => (visible = listener),
    now: () => now,
  };
  return {
    registration,
    container,
    reload,
    prepare,
    env,
    becomeVisible: (at: number) => {
      now = at;
      visible?.();
    },
  };
}

afterEach(() => {
  resetUpdateForTests();
  vi.restoreAllMocks();
});

describe('aggiornamenti dell’app (service worker)', () => {
  it('registra sw.js con lo scope dell’app', async () => {
    const { container, env } = setup();
    await startServiceWorker(env);
    expect(container.register).toHaveBeenCalledWith('https://example.test/app/sw.js', {
      scope: 'https://example.test/app/',
    });
    expect(updateState.value).toBe('none');
  });

  it('se la registrazione fallisce lo scrive in console e l’app va avanti', async () => {
    const { container, env } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container.register.mockRejectedValueOnce(new Error('no'));
    await expect(startServiceWorker(env)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    expect(updateState.value).toBe('none');
  });

  it('se il browser non restituisce una registrazione non succede nulla', async () => {
    const { container, env } = setup();
    container.register.mockResolvedValueOnce(undefined as unknown as FakeRegistration);
    await expect(startServiceWorker(env)).resolves.toBeUndefined();
    expect(updateState.value).toBe('none');
    await applyUpdate();
  });

  it('la prima installazione non è un aggiornamento', async () => {
    const { registration, env } = setup({ controlled: false });
    await startServiceWorker(env);
    registration.install();
    expect(updateState.value).toBe('none');
  });

  it('una versione nuova installata resta in attesa e lo segnala', async () => {
    const { registration, env } = setup();
    await startServiceWorker(env);
    registration.install();
    expect(updateState.value).toBe('waiting');
  });

  it('una versione già in attesa all’avvio si segnala subito', async () => {
    const { env } = setup({ waiting: true });
    await startServiceWorker(env);
    expect(updateState.value).toBe('waiting');
  });

  it('"Aggiorna" salva, chiede SKIP_WAITING e ricarica una volta sola al cambio', async () => {
    const { registration, container, env, prepare, reload } = setup();
    await startServiceWorker(env);
    const worker = registration.install();

    const order: string[] = [];
    prepare.mockImplementation(() => {
      order.push('prepare');
      return Promise.resolve();
    });
    vi.spyOn(worker, 'postMessage').mockImplementation(() => order.push('skip'));
    await applyUpdate();
    expect(order).toEqual(['prepare', 'skip']);
    expect(updateInProgress.value).toBe(true);
    expect(reload).not.toHaveBeenCalled();

    container.activate(worker);
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
    // Se il browser chiede conferma e si resta sulla pagina, i pulsanti tornano attivi.
    expect(updateInProgress.value).toBe(false);
  });

  it('se la versione nuova non si attiva entro 5 s si ricarica comunque, una volta', async () => {
    vi.useFakeTimers();
    const { registration, container, env, reload } = setup();
    await startServiceWorker(env);
    registration.install();
    await applyUpdate();
    vi.advanceTimersByTime(UPDATE_FALLBACK_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    expect(updateInProgress.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(updateInProgress.value).toBe(false);
    // Un controllerchange tardivo non ricarica di nuovo.
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('se la versione in attesa diventa redundant si ricarica subito', async () => {
    vi.useFakeTimers();
    const { registration, env, reload } = setup();
    await startServiceWorker(env);
    const worker = registration.install();
    await applyUpdate();
    worker.setState('redundant');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(updateInProgress.value).toBe(false);
    vi.advanceTimersByTime(UPDATE_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('dopo il ricaricamento normale il timer di riserva non scatta', async () => {
    vi.useFakeTimers();
    const { registration, container, env, reload } = setup();
    await startServiceWorker(env);
    const worker = registration.install();
    await applyUpdate();
    container.activate(worker);
    vi.advanceTimersByTime(UPDATE_FALLBACK_MS * 2);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('un ricaricamento annullato si può riprovare con un nuovo clic', async () => {
    const { registration, container, env, reload, prepare } = setup();
    await startServiceWorker(env);
    container.activate(registration.install());
    expect(updateState.value).toBe('active');
    await applyUpdate();
    await applyUpdate();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('il messaggio inviato è esattamente { type: "SKIP_WAITING" }', async () => {
    const { registration, env } = setup();
    await startServiceWorker(env);
    const worker = registration.install();
    await applyUpdate();
    expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('se il salvataggio fallisce si aggiorna lo stesso (il browser chiederà conferma)', async () => {
    const { registration, env, prepare } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    prepare.mockRejectedValueOnce(new Error('quota'));
    await startServiceWorker(env);
    const worker = registration.install();
    await applyUpdate();
    expect(worker.messages).toHaveLength(1);
  });

  it('attivata da un’altra scheda: l’avviso resta e "Aggiorna" ricarica e basta', async () => {
    const { registration, container, env, reload } = setup();
    await startServiceWorker(env);
    const worker = registration.install();
    container.activate(worker);
    expect(updateState.value).toBe('active');
    expect(reload).not.toHaveBeenCalled();
    await applyUpdate();
    expect(worker.messages).toEqual([]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tornando sulla scheda cerca aggiornamenti al massimo una volta all’ora', async () => {
    const { registration, env, becomeVisible } = setup();
    await startServiceWorker(env);
    becomeVisible(UPDATE_CHECK_MS - 1);
    expect(registration.update).not.toHaveBeenCalled();
    becomeVisible(UPDATE_CHECK_MS);
    becomeVisible(UPDATE_CHECK_MS + 10);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('senza rete il controllo degli aggiornamenti fallisce in silenzio', async () => {
    const { registration, env, becomeVisible } = setup();
    registration.update.mockRejectedValueOnce(new TypeError('offline'));
    await startServiceWorker(env);
    becomeVisible(UPDATE_CHECK_MS);
    await Promise.resolve();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });
});

describe('policy Trusted Types del service worker', () => {
  it('senza Trusted Types restituisce l’URL così com’è', () => {
    expect(trustedScriptUrl('https://example.test/sw.js', {})).toBe('https://example.test/sw.js');
  });

  it('la policy notepad-sw ammette solo l’URL di sw.js', () => {
    let rules: { createScriptURL: (input: string) => string } | undefined;
    const factory = {
      createPolicy: vi.fn((_name: string, r: typeof rules & object) => {
        rules = r;
        return { createScriptURL: (input: string) => r.createScriptURL(input) };
      }),
    };
    const url = 'https://example.test/sw.js';
    expect(trustedScriptUrl(url, { trustedTypes: factory })).toBe(url);
    expect(factory.createPolicy).toHaveBeenCalledWith('notepad-sw', expect.any(Object));
    expect(() => rules?.createScriptURL('https://evil.test/sw.js')).toThrow(TypeError);
  });
});
