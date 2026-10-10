import { deleteDatabase } from '../notes/database';

/**
 * Dati della v1 (Blazor): il database IndexedDB "SqliteStorage" con le vecchie note in
 * chiaro. Non si importano e non si eliminano da soli (cancellare è irreversibile): le
 * impostazioni li segnalano e offrono di eliminarli, con conferma.
 */
export const V1_DB_NAME = 'SqliteStorage';

/** Solo con indexedDB.databases(): aprire il database per controllare lo creerebbe. */
export async function v1DataExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return false;
  try {
    const list = await indexedDB.databases();
    return list.some((info) => info.name === V1_DB_NAME);
  } catch {
    return false;
  }
}

export function deleteV1Data(onBlocked?: () => void): Promise<void> {
  return deleteDatabase(V1_DB_NAME, onBlocked);
}
