import { useEffect, useRef, useState } from 'preact/hooks';
import { deepActiveElement, focusAfterModal } from '../../lib/focus';
import { lockedQueueCount, vaultState } from '../crypto/vault';
import { editorFocusRequest } from '../tabs/actions';
import { tabsState } from '../tabs/tabs';
import { applyUpdate, updateInProgress, updateState } from './update';

/**
 * Dove torna il focus quando l'avviso si chiude e non si sa da dove si era arrivati: il campo
 * della passphrase sulle schermate di blocco, altrimenti il testo della nota attiva.
 */
function fallbackFocus(): Element | null {
  const input = document.querySelector('#unlock-passphrase, #new-passphrase');
  if (input) return input;
  const { active } = tabsState.value;
  if (active !== null) editorFocusRequest.value = { id: active };
  return null;
}

/**
 * Avviso non modale "È disponibile una nuova versione", sia sulle schermate di blocco sia con
 * le note aperte. La regione role="status" è sempre montata (vuota finché non serve): così
 * l'avviso si annuncia quando compare. "Più tardi" lo nasconde fino al prossimo ricaricamento.
 * Con le note bloccate e modifiche trattenute al blocco (salvabili solo da sbloccate)
 * l'aggiornamento aspetta lo sblocco: ricaricando andrebbero perse.
 */
export function UpdateBanner() {
  const state = updateState.value;
  const busy = updateInProgress.value;
  const waitsForUnlock = vaultState.value.status !== 'unlocked' && lockedQueueCount.value > 0;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const shown = state !== 'none' && dismissed !== state;
  const regionRef = useRef<HTMLDivElement>(null);
  /** L'ultimo elemento con il focus fuori dall'avviso, dove riportarlo con "Più tardi". */
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!shown) return undefined;
    returnFocus.current = deepActiveElement();
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && regionRef.current?.contains(e.target)) return;
      returnFocus.current = deepActiveElement();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [shown]);

  const dismiss = () => {
    setDismissed(state);
    const target = returnFocus.current;
    focusAfterModal(() =>
      target?.isConnected && target !== document.body ? target : fallbackFocus(),
    );
  };

  return (
    <div class="update-region" role="status" ref={regionRef}>
      {shown && (
        <div class="update-banner">
          <span>
            È disponibile una nuova versione
            {waitsForUnlock && '. Sblocca per salvare le modifiche prima di aggiornare'}
          </span>
          <button
            type="button"
            class="primary"
            disabled={busy || waitsForUnlock}
            onClick={() => void applyUpdate()}
          >
            {busy ? 'Aggiornamento…' : 'Aggiorna'}
          </button>
          <button type="button" class="link-button" disabled={busy} onClick={dismiss}>
            Più tardi
          </button>
        </div>
      )}
    </div>
  );
}
