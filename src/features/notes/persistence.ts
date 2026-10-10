/**
 * Chiede al browser di non cancellare i dati del sito quando lo spazio scarseggia.
 * Firefox mostra una richiesta all'utente, per questo la chiamiamo solo dopo la prima
 * interazione e non al caricamento. Restituisce true se l'archivio è persistente.
 */
export async function requestPersistentStorage(
  storage: Pick<StorageManager, 'persisted' | 'persist'> | undefined = navigator.storage,
): Promise<boolean> {
  if (!storage?.persist || !storage.persisted) return false;
  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export function requestPersistentStorageOnFirstInteraction(target: EventTarget = window): void {
  const handler = () => {
    target.removeEventListener('pointerdown', handler);
    target.removeEventListener('keydown', handler);
    void requestPersistentStorage();
  };
  target.addEventListener('pointerdown', handler, { once: true });
  target.addEventListener('keydown', handler, { once: true });
}
