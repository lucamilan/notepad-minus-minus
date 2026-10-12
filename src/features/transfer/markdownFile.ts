import { announce } from '../../lib/announce';
import { downloadBlob } from '../../lib/download';
import { noteFileName } from '../notes/note';
import { currentLockEpoch, notesState } from '../notes/store';
import { actionError } from '../tabs/actions';

/** File System Access API (Chromium desktop): non è ancora nei tipi DOM di TypeScript. */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
};

/**
 * Salva il testo della nota (in memoria, comprese le modifiche non ancora salvate) in un file
 * .md, in chiaro: fuori dalla cifratura, come gli appunti. Dove c'è `showSaveFilePicker` il
 * browser chiede dove salvarlo, col nome proposto dallo slug del titolo; altrove il file si
 * scarica con quel nome. Va chiamata nel gestore del clic: il selettore vuole un gesto
 * dell'utente.
 */
export async function saveNoteAsMarkdown(id: string): Promise<void> {
  const state = notesState.value;
  if (state.status !== 'ready') return;
  const note = state.notes.find((candidate) => candidate.id === id);
  if (!note) return;
  actionError.value = null;
  const fileName = noteFileName(note.text);
  const blob = new Blob([note.text], { type: 'text/markdown' });
  const win = window as WindowWithSavePicker;
  if (!win.showSaveFilePicker) {
    downloadBlob(blob, fileName, document.body);
    announce(`Nota scaricata come ${fileName}`);
    return;
  }
  const epoch = currentLockEpoch();
  let handle: FileSystemFileHandle;
  try {
    handle = await win.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
    });
  } catch (error) {
    // Annullato dall'utente: niente da fare.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    // Selettore non disponibile qui (es. vietato dal browser): si scarica come altrove.
    if (currentLockEpoch() !== epoch) return;
    downloadBlob(blob, fileName, document.body);
    announce(`Nota scaricata come ${fileName}`);
    return;
  }
  // Bloccate nel frattempo: il testo non si scrive più da nessuna parte.
  if (currentLockEpoch() !== epoch) return;
  try {
    const writable = await handle.createWritable();
    if (currentLockEpoch() !== epoch) {
      await writable.abort();
      return;
    }
    await writable.write(blob);
    await writable.close();
    if (currentLockEpoch() !== epoch) return;
    announce(`Nota salvata come ${handle.name}`);
  } catch {
    if (currentLockEpoch() !== epoch) return;
    actionError.value = 'Non è stato possibile salvare il file. Riprova.';
  }
}
