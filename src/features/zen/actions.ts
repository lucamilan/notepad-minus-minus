import { editorFocusRequest } from '../tabs/actions';
import { tabsState } from '../tabs/tabs';
import { enterZen, exitZen, zenMode } from './zen';

/**
 * Entra o esce da zen dai pulsanti: il pulsante premuto sparisce, quindi il focus va al testo
 * della nota attiva (all'anteprima se è in sola anteprima).
 */
export function toggleZenFromButton(): void {
  if (zenMode.value) exitZen();
  else enterZen();
  const { active } = tabsState.value;
  if (active !== null) editorFocusRequest.value = { id: active };
}
