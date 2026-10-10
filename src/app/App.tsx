import { useEffect } from 'preact/hooks';
import { vaultState } from '../features/crypto/vault';
import { VaultFrame, VaultScreen } from '../features/crypto/VaultScreen';
import { loadWorkspace, workspaceComponent, workspaceLoadFailed } from './lazyWorkspace';

/**
 * Guscio dell'app: con le note bloccate mostra solo le schermate della passphrase; sbloccate,
 * l'area delle note (Workspace.tsx), caricata a parte. Bloccando, l'area si smonta tutta:
 * editor, anteprima e dialoghi spariscono dal DOM insieme al testo che mostravano.
 */
export function App() {
  const vault = vaultState.value;
  const unlocked = vault.status === 'unlocked';

  useEffect(() => {
    if (unlocked) void loadWorkspace();
  }, [unlocked]);

  if (vault.status !== 'unlocked') return <VaultScreen state={vault} />;
  const Workspace = workspaceComponent.value;
  if (Workspace) return <Workspace />;
  return (
    <VaultFrame>
      {workspaceLoadFailed.value ? (
        <div class="workspace-message" role="alert">
          <h1>Impossibile aprire le note</h1>
          <p>
            Non è stato possibile caricare l’app, forse è appena stata aggiornata. Ricarica la
            pagina.
          </p>
        </div>
      ) : (
        <p class="workspace-message">Apertura delle note…</p>
      )}
    </VaultFrame>
  );
}
