import { effect, signal } from '@preact/signals';
import { lockVault, vaultState } from './vault';

/**
 * Blocco automatico per inattività, per scheda (non avvisa le altre). Si confrontano
 * timestamp e non si conta sui timer: nelle schede in background i browser li rallentano,
 * quindi si controlla anche quando la pagina torna visibile o riprende il focus.
 */
export const AUTO_LOCK_OPTIONS = [5, 15, 30, 60] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number];
const DEFAULT_MINUTES: AutoLockMinutes = 15;
const STORAGE_KEY = 'notepad:auto-lock';
export const AUTO_LOCK_CHECK_MS = 15_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function isAutoLockMinutes(value: unknown): value is AutoLockMinutes {
  return AUTO_LOCK_OPTIONS.includes(value as AutoLockMinutes);
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// Una preferenza dell'interfaccia, non un dato delle note: può stare in localStorage.
export function loadAutoLockMinutes(
  storage: Pick<Storage, 'getItem'> | undefined,
): AutoLockMinutes {
  try {
    const stored = Number(storage?.getItem(STORAGE_KEY));
    return isAutoLockMinutes(stored) ? stored : DEFAULT_MINUTES;
  } catch {
    return DEFAULT_MINUTES;
  }
}

export const autoLockMinutes = signal<AutoLockMinutes>(loadAutoLockMinutes(safeLocalStorage()));

let lastActivity = Date.now();

/** Attività dell'utente (anche il testo scritto nell'editor, che vive in uno shadow root). */
export function recordActivity(): void {
  lastActivity = Date.now();
}

/** Blocca se l'ultima attività è più vecchia del tempo scelto. */
export function checkAutoLock(now: number = Date.now()): void {
  if (vaultState.value.status !== 'unlocked') return;
  if (now - lastActivity >= autoLockMinutes.value * 60_000) void lockVault('auto');
}

export function startAutoLock(target: Window = window): () => void {
  const options = { capture: true, passive: true } as const;
  for (const type of ACTIVITY_EVENTS) target.addEventListener(type, recordActivity, options);
  const onVisible = () => {
    if (target.document.visibilityState === 'visible') checkAutoLock();
  };
  const onFocus = () => checkAutoLock();
  target.document.addEventListener('visibilitychange', onVisible);
  target.addEventListener('focus', onFocus);
  const timer = setInterval(() => checkAutoLock(), AUTO_LOCK_CHECK_MS);
  // Il conto riparte dallo sblocco.
  const stopUnlock = effect(() => {
    if (vaultState.value.status === 'unlocked') recordActivity();
  });
  const stopSave = effect(() => {
    const minutes = autoLockMinutes.value;
    try {
      safeLocalStorage()?.setItem(STORAGE_KEY, String(minutes));
    } catch {
      // La scelta vale solo per questa sessione.
    }
  });
  return () => {
    for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, recordActivity, options);
    target.document.removeEventListener('visibilitychange', onVisible);
    target.removeEventListener('focus', onFocus);
    clearInterval(timer);
    stopUnlock();
    stopSave();
  };
}
