/** Il link al file resta valido per un po': alcuni browser avviano il download dopo il clic. */
const REVOKE_DELAY_MS = 30_000;

/**
 * Scarica `blob` con un <a download> temporaneo dentro `container` (in un dialogo modale il
 * resto della pagina è inerte). Un URL blob: con `download` è uno scaricamento, non una
 * navigazione: la CSP non lo blocca e non parte nessuna richiesta di rete.
 */
export function downloadBlob(blob: Blob, fileName: string, container: HTMLElement): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  container.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
