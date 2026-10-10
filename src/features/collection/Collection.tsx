import { Component, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  BookmarkIcon,
  ClockIcon,
  ListIcon,
  PinIcon,
  SearchIcon,
  TagOffIcon,
  TaskIcon,
} from '../../app/icons';
import { formatRelative } from '../../lib/format';
import { noteTitle, sortNotes, type Note } from '../notes/note';
import { openSearch } from '../search/state';
import { createNoteInNewTab, isRepeatedClick } from '../tabs/actions';
import { tabsState } from '../tabs/tabs';
import { applyFilter, openNoteFromCollection, removeSavedView, saveCurrentView } from './actions';
import { collectionFilter, savedViews } from './state';
import {
  CATEGORIES,
  categoryOf,
  OTHER_TAGS_LABEL,
  tagCounts,
  tagLabel,
  noteInfo,
  type CategoryId,
} from './tags';
import {
  isFiltered,
  matchesFilter,
  NO_FILTER,
  sameFilter,
  suggestViewName,
  viewDefinition,
  VIEWS,
  withTagToggled,
  type ViewId,
} from './views';

const VIEW_ICONS: Record<ViewId, () => JSX.Element> = {
  all: () => <ListIcon />,
  recent: () => <ClockIcon />,
  open: () => <TaskIcon />,
  pinned: () => <PinIcon />,
  untagged: () => <TagOffIcon />,
};

export const COLLECTION_ID = 'collection';

/** Etichetta di un tag con il pallino del colore della sua categoria. */
export function TagChip({ tag }: { tag: string }) {
  return (
    <span class="tag" data-c={categoryOf(tag)}>
      #{tag}
    </span>
  );
}

/** Raccolta: viste, viste salvate, tag per categoria e l'elenco delle note filtrate. */
export function Collection({ notes }: { notes: readonly Note[] }) {
  // Al minuto: le date relative ("oggi 15:56") non cambiano a ogni tasto.
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  return (
    <aside id={COLLECTION_ID} class="collection" aria-label="Raccolta">
      <Navigation notes={notes} now={now} />
      <NoteList notes={notes} now={now} />
    </aside>
  );
}

function NavButton({
  pressed,
  onClick,
  icon,
  label,
  count,
}: {
  pressed: boolean;
  onClick: () => void;
  icon?: JSX.Element | undefined;
  label: string;
  count: number;
}) {
  return (
    <button type="button" class="nav-item" aria-pressed={pressed} onClick={onClick}>
      {icon}
      <span class="nav-label">{label}</span>
      <span class="nav-count">
        <span aria-hidden="true">{count}</span>
        <span class="sr-only">{count === 1 ? '1 nota' : `${count} note`}</span>
      </span>
    </button>
  );
}

function Navigation({ notes, now }: { notes: readonly Note[]; now: number }) {
  const filter = collectionFilter.value;
  const views = savedViews.value;
  const counts = tagCounts(notes);
  const groups = new Map<CategoryId, string[]>();
  for (const tag of counts.keys()) {
    const category = categoryOf(tag);
    groups.set(category, [...(groups.get(category) ?? []), tag]);
  }
  const sections: { id: CategoryId; label: string }[] = [
    ...CATEGORIES,
    { id: 'altri', label: OTHER_TAGS_LABEL },
  ];

  return (
    <nav class="collection-nav" aria-label="Viste e tag">
      <button type="button" class="find" onClick={() => openSearch()} aria-keyshortcuts="Control+K">
        <SearchIcon />
        <span>Cerca nelle note…</span>
        <kbd>Ctrl+K</kbd>
      </button>

      <section class="nav-section" aria-labelledby="nav-views">
        <h2 id="nav-views">Viste</h2>
        {VIEWS.map((view) => (
          <NavButton
            key={view.id}
            pressed={filter.view === view.id && filter.tags.length === 0}
            onClick={() => applyFilter({ view: view.id, tags: [] })}
            icon={VIEW_ICONS[view.id]()}
            label={view.label}
            count={notes.filter((note) => view.test(note, now)).length}
          />
        ))}
      </section>

      <section class="nav-section" aria-labelledby="nav-saved">
        <h2 id="nav-saved">Viste salvate</h2>
        {views.length === 0 && (
          <p class="nav-hint">Scegli una vista o dei tag, poi "Salva come vista".</p>
        )}
        {views.map((view, index) => (
          <div class="nav-row" key={`${index}:${view.name}`}>
            <NavButton
              pressed={sameFilter(filter, view)}
              onClick={() => applyFilter({ view: view.view, tags: [...view.tags] })}
              icon={<BookmarkIcon />}
              label={view.name}
              count={notes.filter((note) => matchesFilter(note, view, now)).length}
            />
            <button
              type="button"
              class="nav-remove"
              aria-label={`Elimina la vista ${view.name}`}
              title="Elimina la vista (le note restano)"
              onClick={() => void removeSavedView(view)}
            >
              ×
            </button>
          </div>
        ))}
      </section>

      {sections.map(({ id, label }) => {
        const tags = (groups.get(id) ?? []).sort(
          (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
        );
        if (tags.length === 0) return null;
        return (
          <section class="nav-section" key={id} aria-labelledby={`nav-tags-${id}`}>
            <h2 id={`nav-tags-${id}`}>
              <span class="tag-dot" data-c={id} aria-hidden="true" />
              {label}
            </h2>
            {tags.map((tag) => (
              <NavButton
                key={tag}
                pressed={filter.tags.includes(tag)}
                onClick={() => applyFilter(withTagToggled(filter, tag))}
                label={tagLabel(tag)}
                count={counts.get(tag) ?? 0}
              />
            ))}
          </section>
        );
      })}
    </nav>
  );
}

function NoteList({ notes, now }: { notes: readonly Note[]; now: number }) {
  const filter = collectionFilter.value;
  const active = tabsState.value.active;
  const saved = savedViews.value.find((view) => sameFilter(filter, view));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const filtered = isFiltered(filter);
  const shown = sortNotes(notes.filter((note) => matchesFilter(note, filter, now)));
  const view = viewDefinition(filter.view);
  const title =
    saved?.name ?? (filter.tags.length && filter.view === 'all' ? 'Filtrate' : view.label);

  useEffect(() => setNaming(false), [filter]);
  useEffect(() => {
    if (naming) nameRef.current?.select();
  }, [naming]);

  return (
    <section class="note-list" aria-labelledby="note-list-title">
      <div class="note-list-head">
        <div class="note-list-title">
          <h2 id="note-list-title">{title}</h2>
          <span class="note-list-count">{shown.length}</span>
          <button
            type="button"
            class="small-button"
            title="Nuova nota (Alt+N)"
            onClick={(e) => {
              if (!isRepeatedClick(e)) void createNoteInNewTab();
            }}
          >
            + Nuova
          </button>
        </div>
        {filtered && (
          <div class="chips" aria-label="Filtri attivi">
            {filter.view !== 'all' && (
              <span class="chip">
                {view.label}
                <button
                  type="button"
                  aria-label={`Togli il filtro ${view.label}`}
                  onClick={() => applyFilter({ ...filter, view: 'all' })}
                >
                  ×
                </button>
              </span>
            )}
            {filter.tags.map((tag) => (
              <span class="chip" key={tag}>
                <TagChip tag={tag} />
                <button
                  type="button"
                  aria-label={`Togli il filtro #${tag}`}
                  onClick={() => applyFilter(withTagToggled(filter, tag))}
                >
                  ×
                </button>
              </span>
            ))}
            {!saved && !naming && (
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  setName(suggestViewName(filter));
                  setNaming(true);
                }}
              >
                Salva come vista
              </button>
            )}
          </div>
        )}
        {naming && (
          <form
            class="save-view"
            onSubmit={(e) => {
              e.preventDefault();
              void saveCurrentView(name || suggestViewName(filter), filter);
              setNaming(false);
            }}
          >
            <input
              ref={nameRef}
              aria-label="Nome della vista"
              maxLength={60}
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setNaming(false);
                }
              }}
            />
            <button type="submit" class="primary small">
              Salva
            </button>
          </form>
        )}
        {filter.tags.length > 0 && (
          <p class="note-list-hint">Le nuove note riceveranno questi tag.</p>
        )}
      </div>
      {shown.length === 0 ? (
        <div class="note-list-empty">
          <p>Nessuna nota con questi filtri.</p>
          <button type="button" class="link-button" onClick={() => applyFilter(NO_FILTER)}>
            Togli tutti i filtri
          </button>
        </div>
      ) : (
        <ul class="note-items">
          {shown.map((note) => (
            <li key={note.id}>
              <NoteItem note={note} current={note.id === active} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface NoteItemProps {
  note: Note;
  current: boolean;
  now: number;
}

/**
 * Una riga dell'elenco. Si ridisegna solo se cambia la sua nota (oggetto nuovo a ogni
 * modifica), lo stato di nota attiva o il minuto: con migliaia di note un tasto non
 * ridisegna tutto l'elenco.
 */
class NoteItem extends Component<NoteItemProps> {
  override shouldComponentUpdate(next: NoteItemProps): boolean {
    const { note, current, now } = this.props;
    return next.note !== note || next.current !== current || next.now !== now;
  }

  override render() {
    const { note, current, now } = this.props;
    const { tags, openTasks, excerpt } = noteInfo(note);
    return (
      <button
        type="button"
        class="note-item"
        aria-current={current ? 'true' : undefined}
        onClick={() => openNoteFromCollection(note.id)}
      >
        <span class="note-item-title">
          {note.pinned && (
            <PinIcon class="pin" aria-label="Fissata" aria-hidden="false" role="img" />
          )}
          <span>{noteTitle(note.text)}</span>
        </span>
        {excerpt && <span class="note-item-excerpt">{excerpt}</span>}
        <span class="note-item-meta">
          <span class="note-item-date">{formatRelative(note.modifiedAt, now)}</span>
          {openTasks > 0 && (
            <span class="note-item-tasks">
              {openTasks === 1 ? '1 attività aperta' : `${openTasks} attività aperte`}
            </span>
          )}
          {tags.slice(0, 3).map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
          {tags.length > 3 && <span>+{tags.length - 3}</span>}
        </span>
      </button>
    );
  }
}
