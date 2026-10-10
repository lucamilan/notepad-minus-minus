import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PinIcon, SearchIcon } from '../../app/icons';
import { deepActiveElement, focusAfterModal } from '../../lib/focus';
import { formatRelative } from '../../lib/format';
import { openNoteFromCollection } from '../collection/actions';
import { TagChip } from '../collection/Collection';
import { noteInfo } from '../collection/tags';
import { noteTitle, type Note } from '../notes/note';
import { highlight, isEmptyQuery, parseQuery, searchNotes, snippet, type Segment } from './search';
import { closeSearch } from './state';

const LISTBOX_ID = 'search-results';
const RECENT_LIMIT = 6;
/** Righe mostrate al massimo: oltre conviene affinare la ricerca. */
const SHOWN_LIMIT = 50;
const FILTER_HINTS = ['#cliente/', '#progetto/', '#tipo/', 'is:aperte', 'is:fissate', 'is:recenti'];

function optionId(index: number): string {
  return `search-option-${index}`;
}

function Highlighted({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.mark ? <mark key={i}>{segment.text}</mark> : segment.text,
      )}
    </>
  );
}

/**
 * Ricerca globale (Ctrl+K): <dialog> modale con campo combobox e elenco di risultati
 * (pattern ARIA combobox con aria-activedescendant). Il focus resta nel campo; frecce per
 * scegliere, Invio per aprire, Esc per chiudere tornando dove si era.
 */
export function SearchDialog({
  notes,
  initialQuery,
}: {
  notes: readonly Note[];
  initialQuery: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(deepActiveElement());
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const filtered = !isEmptyQuery(parsed);
  const found = useMemo(
    () =>
      filtered
        ? searchNotes(notes, parsed).map((r) => r.note)
        : [...notes].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, RECENT_LIMIT),
    [notes, parsed, filtered],
  );
  const results = found.length > SHOWN_LIMIT ? found.slice(0, SHOWN_LIMIT) : found;
  const current = Math.min(selected, Math.max(0, results.length - 1));

  // Prima del disegno: chi preme Ctrl+K e scrive subito non perde i primi caratteri.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.showModal();
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    return () => dialog.close();
  }, []);

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  }, [current, results]);

  const close = (restoreFocus: boolean) => {
    closeSearch();
    if (restoreFocus) focusAfterModal(() => opener.current);
  };

  const pick = (note: Note | undefined) => {
    if (!note) return;
    closeSearch();
    openNoteFromCollection(note.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    // Ctrl+K a ricerca aperta non deve finire al browser (barra di ricerca).
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') setSelected(Math.min(current + 1, results.length - 1));
    else if (e.key === 'ArrowUp') setSelected(Math.max(current - 1, 0));
    else if (e.key === 'Home' && e.ctrlKey) setSelected(0);
    else if (e.key === 'End' && e.ctrlKey) setSelected(results.length - 1);
    else if (e.key === 'Enter') pick(results[current]);
    else return;
    e.preventDefault();
  };

  const insertHint = (hint: string) => {
    const base = query.replace(/\s*$/, '');
    setQuery(base ? `${base} ${hint}` : hint);
    setSelected(0);
    inputRef.current?.focus();
  };

  const count = results.length;
  const total = found.length;
  const heading = !filtered
    ? 'Modificate di recente'
    : total > count
      ? `${total} risultati, mostrati i primi ${count}`
      : `${total} ${total === 1 ? 'risultato' : 'risultati'}`;

  return (
    <dialog
      ref={dialogRef}
      class="search"
      aria-label="Cerca nelle note"
      onCancel={(e) => {
        e.preventDefault();
        close(true);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close(true);
      }}
    >
      <div class="search-box">
        <div class="search-field">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Cerca in titoli, testo e tag"
            aria-expanded="true"
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={count > 0 ? optionId(current) : undefined}
            placeholder="Cerca in titoli, testo e tag…"
            autocomplete="off"
            spellcheck={false}
            value={query}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>
        <div class="search-hints">
          <span>Filtri:</span>
          {FILTER_HINTS.map((hint) => (
            <button key={hint} type="button" tabIndex={-1} onClick={() => insertHint(hint)}>
              {hint}
            </button>
          ))}
        </div>
        <div class="search-results">
          <p class="search-heading" id="search-heading" role="status">
            {heading}
          </p>
          {filtered && count === 0 && (
            <p class="search-none">
              Nessuna nota trovata per "{query.trim()}". Prova con meno parole o togli un filtro.
            </p>
          )}
          <ul id={LISTBOX_ID} role="listbox" aria-labelledby="search-heading">
            {results.map((note, index) => (
              <li
                key={note.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === current}
                class="search-option"
                onMouseMove={() => index !== current && setSelected(index)}
                onClick={() => pick(note)}
              >
                <span class="search-option-title">
                  {note.pinned && (
                    <PinIcon class="pin" role="img" aria-hidden="false" aria-label="Fissata" />
                  )}
                  <span>
                    <Highlighted segments={highlight(noteTitle(note.text), parsed.terms)} />
                  </span>
                  <span class="search-option-date">{formatRelative(note.modifiedAt)}</span>
                </span>
                <span class="search-option-snippet">
                  <Highlighted segments={snippet(note.text, parsed.terms)} />
                </span>
                {noteInfo(note).tags.length > 0 && (
                  <span class="search-option-tags">
                    {noteInfo(note).tags.map((tag) => (
                      <TagChip key={tag} tag={tag} />
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div class="search-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> scegli
          </span>
          <span>
            <kbd>Invio</kbd> apri
          </span>
          <span>Accenti e maiuscole non contano</span>
          <span>Indice solo in memoria, mai salvato</span>
        </div>
      </div>
    </dialog>
  );
}
