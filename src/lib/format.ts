const DATE_TIME = new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' });

/** Data e ora brevi in italiano, es. "10/10/26, 15:56". */
export function formatDateTime(epochMs: number): string {
  return DATE_TIME.format(epochMs);
}

const TIME = new Intl.DateTimeFormat('it-IT', { timeStyle: 'short' });

/** Solo l'ora, es. "15:56". */
export function formatTime(epochMs: number): string {
  return TIME.format(epochMs);
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
  const days = Math.round((startOfDay(now) - startOfDay(epochMs)) / 86_400_000);
  if (days <= 0) return `oggi ${formatTime(epochMs)}`;
  if (days === 1) return 'ieri';
  return new Date(epochMs).getFullYear() === new Date(now).getFullYear()
    ? DAY_MONTH.format(epochMs)
    : DAY_MONTH_YEAR.format(epochMs);
}
