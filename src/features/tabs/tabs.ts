import { signal } from '@preact/signals';

/**
 * Schede = note aperte. Chiudere una scheda non elimina la nota: resta nell'archivio.
 * Lo stato si salva nello store `meta` (chiave `tabs`) e contiene solo id di note,
 * UUID casuali che non rivelano nulla del contenuto.
 */
export interface TabsState {
  open: string[];
  active: string | null;
}

export const TABS_META_KEY = 'tabs';

export const tabsState = signal<TabsState>({ open: [], active: null });

/** Id delle schede nascoste (vedi `hiddenTabs`), fissati all'apertura dell'archivio. */
export const hiddenTabIds = { current: [] as string[] };

export function isTabsState(value: unknown): value is TabsState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v['open']) &&
    v['open'].every((id) => typeof id === 'string') &&
    (v['active'] === null || typeof v['active'] === 'string')
  );
}

/**
 * Ricostruisce le schede salvate scartando le note che non esistono più. Senza uno stato
 * salvato (primo avvio, o record rovinato) apre la prima nota dell'elenco.
 */
export function restoreTabs(saved: unknown, noteIds: readonly string[]): TabsState {
  if (!isTabsState(saved)) {
    const first = noteIds[0];
    return first ? { open: [first], active: first } : { open: [], active: null };
  }
  const known = new Set(noteIds);
  const open = [...new Set(saved.open)].filter((id) => known.has(id));
  const active = saved.active !== null && open.includes(saved.active) ? saved.active : null;
  return { open, active: active ?? open[0] ?? null };
}

/**
 * Schede salvate di note oggi illeggibili: non si mostrano, ma restano nello stato salvato
 * così ricompaiono se la nota torna leggibile (per esempio aprendo una versione più recente).
 */
export function hiddenTabs(saved: unknown, unreadableIds: readonly string[]): string[] {
  if (!isTabsState(saved)) return [];
  const unreadable = new Set(unreadableIds);
  return [...new Set(saved.open)].filter((id) => unreadable.has(id));
}

/** Stato da salvare: le schede visibili più quelle nascoste delle note illeggibili. */
export function tabsToSave(state: TabsState, hidden: readonly string[]): TabsState {
  const extra = hidden.filter((id) => !state.open.includes(id));
  return extra.length ? { open: [...state.open, ...extra], active: state.active } : state;
}

/** Apre la nota in una scheda (in fondo, se non è già aperta) e la rende attiva. */
export function withOpened(state: TabsState, id: string): TabsState {
  if (state.active === id) return state;
  const open = state.open.includes(id) ? state.open : [...state.open, id];
  return { open, active: id };
}

/** Chiude la scheda; se era quella attiva passa alla successiva, o alla precedente se era l'ultima. */
export function withClosed(state: TabsState, id: string): TabsState {
  const index = state.open.indexOf(id);
  if (index < 0) return state;
  const open = state.open.filter((other) => other !== id);
  const active =
    state.active === id ? (open[Math.min(index, open.length - 1)] ?? null) : state.active;
  return { open, active };
}

/** Attiva la scheda a `delta` posizioni da quella attiva, ripartendo dall'altro capo. */
export function withCycled(state: TabsState, delta: number): TabsState {
  const count = state.open.length;
  if (count === 0) return state;
  const index = state.active === null ? 0 : state.open.indexOf(state.active);
  const next = state.open[(((index + delta) % count) + count) % count] ?? null;
  return next === state.active ? state : { open: state.open, active: next };
}
