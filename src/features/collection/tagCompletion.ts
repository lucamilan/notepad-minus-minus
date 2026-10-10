import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { normalize } from '../search/search';
import { categoryOf } from './tags';

const TAG_BEFORE_CURSOR = /(?:^|[\s(])#([\p{L}\p{N}_/-]*)$/u;
const MAX_OPTIONS = 8;

/**
 * Suggerisce i tag già usati mentre si scrive `#…`: prima quelli che iniziano così, poi
 * quelli in cui la parte dopo la categoria inizia così (`#acme` → `cliente/acme`).
 * `getTags` legge i conteggi al momento (le note cambiano mentre si scrive).
 */
export function tagCompletion(getTags: () => ReadonlyMap<string, number>): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const match = TAG_BEFORE_CURSOR.exec(before);
    if (!match) return null;
    const typed = match[1] ?? '';
    if (!typed && !context.explicit) {
      // Solo "#": suggerisce subito, ma non in testa alla riga (lì è un titolo Markdown).
      if (before.trimStart() === '#') return null;
    }
    const prefix = normalize(typed);
    const counts = getTags();
    const options: Completion[] = [...counts.entries()]
      .filter(([tag]) => {
        const plain = normalize(tag);
        return plain !== prefix && (plain.startsWith(prefix) || plain.includes(`/${prefix}`));
      })
      .sort(
        ([a, ca], [b, cb]) =>
          Number(normalize(b).startsWith(prefix)) - Number(normalize(a).startsWith(prefix)) ||
          cb - ca ||
          a.localeCompare(b),
      )
      .slice(0, MAX_OPTIONS)
      .map(([tag, count]) => ({
        label: tag,
        detail: count === 1 ? '1 nota' : `${count} note`,
        type: categoryOf(tag),
        apply: `${tag} `,
      }));
    if (options.length === 0) return null;
    return { from: context.pos - typed.length, options, filter: false };
  };

  return autocompletion({
    override: [source],
    icons: false,
    activateOnTyping: true,
    closeOnBlur: true,
  });
}
