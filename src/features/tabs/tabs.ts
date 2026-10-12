import { signal } from '@preact/signals';
import { isProjectTag } from '../collection/project';
import { isValidTag } from '../collection/views';

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

/**
 * Chiude la scheda; se era quella attiva passa alla successiva, o alla precedente se era
 * l'ultima, tra le schede `visible` (in un progetto le altre restano aperte ma messe da parte).
 */
export function withClosed(
  state: TabsState,
  id: string,
  visible: readonly string[] = state.open,
): TabsState {
  if (!state.open.includes(id)) return state;
  const open = state.open.filter((other) => other !== id);
  if (state.active !== id) return { open, active: state.active };
  const index = visible.indexOf(id);
  const remaining = visible.filter((other) => other !== id && open.includes(other));
  const active = remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null;
  return { open, active };
}

/**
 * Attiva la scheda a `delta` posizioni da quella attiva tra le schede `visible`, ripartendo
 * dall'altro capo.
 */
export function withCycled(
  state: TabsState,
  delta: number,
  visible: readonly string[] = state.open,
): TabsState {
  const count = visible.length;
  if (count === 0) return state;
  const index = state.active === null ? 0 : Math.max(visible.indexOf(state.active), 0);
  const next = visible[(((index + delta) % count) + count) % count] ?? null;
  return next === state.active ? state : { open: state.open, active: next };
}

/**
 * Schede da mostrare: in un progetto solo quelle delle sue note (`inProject`) più quella
 * attiva, che resta anche se la nota ha appena perso il tag; le altre restano aperte, messe da
 * parte, e tornano uscendo dal progetto.
 */
export function visibleTabs(
  state: TabsState,
  inProject: ((id: string) => boolean) | null,
): string[] {
  if (!inProject) return state.open;
  return state.open.filter((id) => id === state.active || inProject(id));
}

/**
 * Schede di ogni progetto, salvate in `meta` sotto `projectTabs` (cifrate dal codec: la chiave è
 * fissa, i nomi dei tag stanno solo nel valore). Rientrando in un progetto si riaprono.
 */
export const PROJECT_TABS_META_KEY = 'projectTabs';

export type ProjectTabs = Map<string, TabsState>;

/** Ultime schede salvate per progetto, lette all'apertura dell'archivio (svuotate al blocco). */
export const projectTabsMemory = { current: new Map() as ProjectTabs };

/**
 * Legge il valore salvato, un elenco di `{ tag, open, active }`: scarta voci non valide, tag
 * che non sono di progetto, doppioni e una scheda attiva che non è tra quelle aperte.
 */
export function parseProjectTabs(value: unknown): ProjectTabs {
  const result: ProjectTabs = new Map();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    const tag = v['tag'];
    if (typeof tag !== 'string' || !isValidTag(tag) || !isProjectTag(tag) || result.has(tag)) {
      continue;
    }
    const state = { open: v['open'], active: v['active'] };
    if (!isTabsState(state)) continue;
    const open = [...new Set(state.open)];
    if (open.length === 0) continue;
    result.set(tag, {
      open,
      active: state.active !== null && open.includes(state.active) ? state.active : null,
    });
  }
  return result;
}

export function projectTabsToSave(
  tabs: ProjectTabs,
): { tag: string; open: string[]; active: string | null }[] {
  return [...tabs].map(([tag, { open, active }]) => ({ tag, open, active }));
}

/**
 * Entrando in un progetto: riapre in fondo le sue schede salvate (solo note che esistono e sono
 * ancora del progetto). Resta attiva la scheda attuale se è del progetto, altrimenti quella
 * salvata, altrimenti la prima del progetto, altrimenti nessuna.
 */
export function withProjectTabs(
  state: TabsState,
  saved: TabsState | undefined,
  inProject: (id: string) => boolean,
): TabsState {
  const restored = (saved?.open ?? []).filter((id) => inProject(id) && !state.open.includes(id));
  const open = restored.length ? [...state.open, ...restored] : state.open;
  const visible = open.filter(inProject);
  const savedActive = saved?.active ?? null;
  const active =
    state.active !== null && inProject(state.active)
      ? state.active
      : savedActive !== null && visible.includes(savedActive)
        ? savedActive
        : (visible[0] ?? null);
  return open === state.open && active === state.active ? state : { open, active };
}
