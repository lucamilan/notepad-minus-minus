import { useEffect, useRef, useState } from 'preact/hooks';
import { CopyIcon, PinIcon, SaveFileIcon, TrashIcon } from '../../app/icons';
import { focusAfterModal } from '../../lib/focus';
import { formatRelative } from '../../lib/format';
import { changedElsewhere, keepThisVersion, loadLatestVersion } from '../notes/crossTab';
import { noteTitle, type Note } from '../notes/note';
import { duplicateNote, focusTabs, isRepeatedClick } from '../tabs/actions';
import { saveNoteAsMarkdown } from '../transfer/markdownFile';
import { deleteNote, applyFilter, togglePinned } from './actions';
import { TagChip } from './Collection';
import { deleteRequest, showSidebar } from './state';
import { categoryOf, noteInfo } from './tags';

/** Barra sopra il testo: fissa, duplica, salva .md, tag della nota (filtrano la raccolta), data, elimina. */
export function NoteBar({ note }: { note: Note }) {
  const { tags } = noteInfo(note);
  return (
    <>
      <ElsewhereNotice id={note.id} />
      <div class="note-bar">
        <button
          type="button"
          class="small-button pin-button"
          aria-pressed={note.pinned}
          title="Fissa in cima alla raccolta"
          onClick={() => togglePinned(note.id)}
        >
          <PinIcon />
          <span>Fissa</span>
        </button>
        <button
          type="button"
          class="small-button duplicate-button"
          title="Crea una copia di questa nota"
          onClick={(e) => {
            if (!isRepeatedClick(e)) void duplicateNote(note.id);
          }}
        >
          <CopyIcon />
          <span>Duplica</span>
        </button>
        <button
          type="button"
          class="small-button save-file-button"
          title="Salva la nota in un file Markdown (.md), non cifrato"
          onClick={() => void saveNoteAsMarkdown(note.id)}
        >
          <SaveFileIcon />
          <span>Salva .md</span>
        </button>
        <span class="note-tags">
          {tags.length === 0 ? (
            <span class="note-tags-none">Nessun tag: scrivi #cliente/… nel testo</span>
          ) : (
            tags.map((tag) => (
              <button
                key={tag}
                type="button"
                class="tag-button"
                data-c={categoryOf(tag)}
                title={`Mostra nella raccolta le note con #${tag}`}
                onClick={() => {
                  applyFilter({ view: 'all', tags: [tag] });
                  showSidebar();
                }}
              >
                <TagChip tag={tag} />
              </button>
            ))
          )}
        </span>
        <span class="spacer" />
        <span class="note-modified">Modificata {formatRelative(note.modifiedAt)}</span>
        <button
          type="button"
          class="small-button danger-hover delete-button"
          title="Elimina definitivamente la nota"
          onClick={() => (deleteRequest.value = note.id)}
        >
          <TrashIcon />
          <span>Elimina…</span>
        </button>
      </div>
    </>
  );
}

/** Conferma dell'eliminazione: Annulla riporta il focus su "Elimina…", Elimina sulle schede. */
export function DeleteDialog({ note }: { note: Note }) {
  const onClose = (deleted: boolean) => {
    deleteRequest.value = null;
    if (deleted) focusTabs();
    else focusAfterModal(() => document.querySelector('.note-bar .delete-button'));
  };
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    dialog.showModal();
    // Esc o chiusura dal browser: come Annulla.
    const onDialogClose = () => {
      if (!done.current) onClose(false);
    };
    dialog.addEventListener('close', onDialogClose);
    return () => dialog.removeEventListener('close', onDialogClose);
  }, []);

  const finish = (deleted: boolean) => {
    done.current = true;
    ref.current?.close();
    onClose(deleted);
  };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        // Durante l'eliminazione Esc non può più annullarla: si aspetta l'esito.
        if (busy) e.preventDefault();
      }}
      class="confirm"
      aria-labelledby="delete-title"
      aria-describedby="delete-text"
    >
      <h2 id="delete-title">Eliminare questa nota?</h2>
      <p id="delete-text">
        "{noteTitle(note.text)}" verrà cancellata da questo browser e non si potrà recuperare. Per
        toglierla solo dalle schede aperte, chiudi la scheda.
      </p>
      <div class="confirm-actions">
        {/* Il focus parte da Annulla: Invio per sbaglio non cancella nulla. */}
        <button type="button" class="ghost" autoFocus onClick={() => finish(false)}>
          Annulla
        </button>
        <button
          type="button"
          class="danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void deleteNote(note.id).then((deleted) => {
              setBusy(false);
              finish(deleted);
            });
          }}
        >
          Elimina
        </button>
      </div>
    </dialog>
  );
}

/** Avviso quando la stessa nota è stata cambiata in un'altra scheda del browser. */
export function ElsewhereNotice({ id }: { id: string }) {
  const change = changedElsewhere.value.get(id);
  if (!change) return null;
  return (
    <div class="elsewhere" role="alert">
      <p>
        {change === 'deleted'
          ? 'Questa nota è stata eliminata in un’altra scheda del browser. Se la tieni, torna nell’archivio.'
          : 'Questa nota è stata modificata in un’altra scheda del browser. Se continui a scrivere qui, la tua versione sostituirà quella.'}
      </p>
      <div class="elsewhere-actions">
        <button type="button" class="small-button" onClick={() => void loadLatestVersion(id)}>
          {change === 'deleted' ? 'Chiudi la nota' : 'Carica l’altra versione'}
        </button>
        <button type="button" class="small-button" onClick={() => keepThisVersion(id)}>
          Tieni questa versione
        </button>
      </div>
    </div>
  );
}
