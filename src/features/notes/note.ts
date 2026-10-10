export interface Note {
  /** UUID: resta unico anche unendo note esportate da altri dispositivi (F8). */
  id: string;
  text: string;
  /** Millisecondi da epoch. */
  createdAt: number;
  modifiedAt: number;
  pinned: boolean;
}

export const SAMPLE_NOTE_TEXT = `# Nota di esempio
Puoi scrivere la nota usando la sintassi *Markdown* di base.`;

/** Testo di una nota nuova: il titolo (caratteri 2–12) viene selezionato per riscriverlo subito. */
export const NEW_NOTE_TEXT = '# Nuova nota\n\n';
export const NEW_NOTE_TITLE_RANGE = { anchor: 2, head: 12 } as const;

export const UNTITLED = 'Nota senza titolo';
const TAB_TITLE_MAX = 27;

/**
 * Titolo della nota: la prima riga non vuota, senza la sintassi Markdown più comune
 * (titoli, citazioni, elenchi, attività, link, enfasi). Come nella v1.
 */
export function noteTitle(text: string): string {
  const firstLine = text.trim().split(/\r\n|\r|\n/, 1)[0] ?? '';
  const plain = firstLine
    .replace(/^#{1,6}(?:\s+|$)/, '')
    .replace(/^>\s*/, '')
    .replace(/^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain || UNTITLED;
}

/** Titolo della scheda: al massimo 27 caratteri più "...", senza spezzare le emoji. */
export function tabTitle(text: string): string {
  const chars = Array.from(noteTitle(text));
  return chars.length <= TAB_TITLE_MAX
    ? chars.join('')
    : `${chars.slice(0, TAB_TITLE_MAX).join('')}...`;
}

export function createNote(
  text: string,
  now: number = Date.now(),
  id: string = crypto.randomUUID(),
): Note {
  return { id, text, createdAt: now, modifiedAt: now, pinned: false };
}

/** Più recenti prima; le fissate stanno sempre in cima. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.modifiedAt - a.modifiedAt,
  );
}

/** Stessa nota, campo per campo. */
export function sameNote(a: Note, b: Note): boolean {
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.createdAt === b.createdAt &&
    a.modifiedAt === b.modifiedAt &&
    a.pinned === b.pinned
  );
}

export function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['text'] === 'string' &&
    typeof v['createdAt'] === 'number' &&
    typeof v['modifiedAt'] === 'number' &&
    typeof v['pinned'] === 'boolean'
  );
}
