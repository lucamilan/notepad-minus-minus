const DATE_TIME = new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' });

/** Al posto di una data non valida (per esempio da un file manomesso): mai un'eccezione. */
export const NO_DATE = '—';

function validDate(epochMs: number): boolean {
  return Number.isFinite(epochMs) && !Number.isNaN(new Date(epochMs).getTime());
}

/** Data e ora brevi in italiano, es. "10/10/26, 15:56". */
export function formatDateTime(epochMs: number): string {
  return validDate(epochMs) ? DATE_TIME.format(epochMs) : NO_DATE;
}

const TIME = new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' });

/** Solo l'ora, es. "15:56". */
export function formatTime(epochMs: number): string {
  return validDate(epochMs) ? TIME.format(epochMs) : NO_DATE;
}

const DAY_MONTH = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' });

function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Data breve per gli elenchi: "oggi 15:56", "ieri", "12 ott", "12 ott 2025". */
export function formatRelative(epochMs: number, now: number = Date.now()): string {
  if (!validDate(epochMs) || !validDate(now)) return NO_DATE;
  const days = Math.round((startOfDay(now) - startOfDay(epochMs)) / 86_400_000);
  if (days <= 0) return `oggi ${formatTime(epochMs)}`;
  if (days === 1) return 'ieri';
  return new Date(epochMs).getFullYear() === new Date(now).getFullYear()
    ? DAY_MONTH.format(epochMs)
    : DAY_MONTH_YEAR.format(epochMs);
}
