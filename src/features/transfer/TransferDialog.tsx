import { useEffect, useRef, useState } from 'preact/hooks';
import { actionError } from '../tabs/actions';

export type TransferKind = 'export' | 'import';

type Dialogs = typeof import('./dialogs');

let loading: Promise<Dialogs> | undefined;

/**
 * Dialogo di esportazione o importazione. Il codice (formato del file, cifratura, unione)
 * arriva con import() solo la prima volta che serve, come l'area delle note: chi non sposta
 * mai le note non lo scarica.
 */
export function TransferDialog({ kind, onClose }: { kind: TransferKind; onClose: () => void }) {
  const [dialogs, setDialogs] = useState<Dialogs | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let active = true;
    loading ??= import('./dialogs');
    loading.then(
      (module) => {
        if (active) setDialogs(module);
      },
      (error: unknown) => {
        // Per esempio un aggiornamento pubblicato nel frattempo: i file vecchi non ci sono più.
        console.error(error);
        loading = undefined;
        if (!active) return;
        actionError.value = 'Non è stato possibile aprire il trasferimento: ricarica la pagina.';
        onCloseRef.current();
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (!dialogs) return null;
  return kind === 'export' ? (
    <dialogs.ExportDialog onClose={onClose} />
  ) : (
    <dialogs.ImportDialog onClose={onClose} />
  );
}
