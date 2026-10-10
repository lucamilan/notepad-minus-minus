/**
 * L'elemento con il focus anche dentro uno shadow root: con il cursore nell'editor
 * `document.activeElement` è il contenitore dello shadow root, che non accetta il focus.
 */
export function deepActiveElement(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

/**
 * Riporta il focus dopo la chiusura di un dialogo modale: al momento della chiusura il resto
 * della pagina è ancora `inert` (lo toglie il disegno successivo), quindi si aspetta un frame.
 */
export function focusAfterModal(target: () => Element | null | undefined): void {
  requestAnimationFrame(() => {
    const element = target();
    if (element instanceof HTMLElement && element.isConnected) element.focus();
  });
}
