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

export const COPY_SUFFIX = '(copia)';
/**
 * Prime righe a cui non si può aggiungere testo senza cambiarne il significato Markdown:
 * blocco di codice (recintato o indentato), definizione di link (il suffisso diventerebbe il
 * titolo del link) e linea orizzontale.
 */
const UNAPPENDABLE_LINE = [
  /^\s{0,3}(?:`{3,}|~{3,})/,
  /^(?: {4}|\t)/,
  /^\s{0,3}\[[^\]]+\]:/,
  /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/,
];
/** Riga di separazione di una tabella: la riga prima è l'intestazione, con le colonne contate. */
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Testo della copia creata da "Duplica": " (copia)" in fondo alla prima riga non vuota, cioè al
 * titolo (prima di eventuali spazi finali, che possono essere un a capo forzato). Se quella riga
 * non si può allungare (codice, definizione di link, linea, intestazione di tabella) il
 * suffisso va su una riga nuova in cima, con lo stesso a capo della nota. Una nota vuota
 * diventa "(copia)".
 */
export function copyText(text: string): string {
  // Il gruppo nello split tiene i separatori (indici dispari): il testo si ricompone uguale.
  const lines = text.split(/(\r\n|\r|\n)/);
  const index = lines.findIndex((line, i) => i % 2 === 0 && line.trim() !== '');
  const first = lines[index];
  if (first === undefined) return COPY_SUFFIX;
  const next = lines[index + 2];
  if (
    UNAPPENDABLE_LINE.some((pattern) => pattern.test(first)) ||
    (next !== undefined && first.includes('|') && TABLE_DELIMITER.test(next))
  ) {
    return `${COPY_SUFFIX}${lines[1] ?? '\n'}${text}`;
  }
  lines[index] = first.replace(/(\s*)$/, ` ${COPY_SUFFIX}$1`);
  return lines.join('');
}

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

/**
 * Titolo della scheda: al massimo 27 caratteri più "...", senza spezzare le emoji. Il suffisso
 * " (copia)" resta visibile anche su un titolo lungo, così copia e originale si distinguono.
 */
export function tabTitle(text: string): string {
  const title = noteTitle(text);
  const suffix = ` ${COPY_SUFFIX}`;
  const isCopy = title.endsWith(suffix);
  const chars = Array.from(isCopy ? title.slice(0, -suffix.length) : title);
  const room = TAB_TITLE_MAX - (isCopy ? suffix.length : 0);
  const base = chars.length <= room ? chars.join('') : `${chars.slice(0, room).join('')}...`;
  return isCopy ? `${base}${suffix}` : base;
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
