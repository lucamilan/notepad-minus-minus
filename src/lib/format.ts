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
