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
