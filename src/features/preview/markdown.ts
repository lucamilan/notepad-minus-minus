import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

/**
 * Unico punto dell'app che trasforma testo in HTML. Due difese indipendenti:
 * 1. markdown-it senza HTML grezzo, con link limitati a http/https/mailto e immagini remote
 *    sostituite da un avviso (nessuna richiesta di rete parte dal testo di una nota);
 * 2. DOMPurify con un elenco chiuso di tag e attributi, che restituisce nodi (non una stringa):
 *    nessun innerHTML nel codice dell'app. Sotto `require-trusted-types-for 'script'` DOMPurify
 *    usa la propria policy `dompurify`, l'unica ammessa dalla CSP.
 */

const SAFE_LINK = /^(?:https?:|mailto:)/i;
/**
 * Solo immagini raster incorporate nel testo: non escono in rete (img-src 'self' data:).
 * Minuscolo come lo accetta DOMPurify: "DATA:" diventerebbe un'immagine vuota.
 */
const SAFE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);/;

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

md.validateLink = (url) => {
  const trimmed = url.trim();
  return SAFE_LINK.test(trimmed) || SAFE_IMAGE.test(trimmed);
};

// Collegamenti: sempre in una nuova scheda, senza referrer né accesso a window.opener.
const defaultLinkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token) {
    if (/^https?:/i.test(token.attrGet('href') ?? '')) token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// Immagini: quelle incorporate (data:) si mostrano, tutte le altre diventano un avviso.
const defaultImage = md.renderer.rules.image ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (!token) return '';
  const src = token.attrGet('src') ?? '';
  if (SAFE_IMAGE.test(src)) return defaultImage(tokens, idx, options, env, self);
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const label = alt ? `Immagine esterna bloccata: ${alt}` : 'Immagine esterna bloccata';
  return `<span class="blocked-image" title="${md.utils.escapeHtml(src)}">${md.utils.escapeHtml(label)}</span>`;
};

md.renderer.rules['task_checkbox'] = (tokens, idx) =>
  tokens[idx]?.meta === true
    ? '<input type="checkbox" disabled checked> '
    : '<input type="checkbox" disabled> ';

const TASK_MARK = /^\[([ xX])\]\s+/;

/**
 * Liste di attività (`- [ ] da fare`, `- [x] fatto`) come caselle in sola lettura, e
 * `data-line` sui blocchi per tornare alla riga giusta con il doppio clic.
 * L'allineamento delle tabelle diventa una classe: lo stile inline violerebbe la CSP.
 */
md.core.ruler.push('notepad_blocks', (state) => {
  const tokens = state.tokens;
  tokens.forEach((token, index) => {
    if (token.block && token.map && (token.nesting === 1 || LEAF_BLOCKS.has(token.type))) {
      token.attrSet('data-line', String(token.map[0]));
    }
    if (token.type === 'th_open' || token.type === 'td_open') alignToClass(token);
    if (token.type === 'inline') {
      markTask(tokens, index, state.Token);
      unlinkUnsafe(token);
    }
  });
});

/** Blocchi senza apertura/chiusura che meritano comunque la riga per il doppio clic. */
const LEAF_BLOCKS = new Set(['fence', 'code_block', 'hr']);

/**
 * validateLink ammette anche le immagini data: (valide solo come immagini): un link con quella
 * destinazione perde il collegamento e resta solo il testo.
 */
function unlinkUnsafe(inline: Token): void {
  const children = inline.children ?? [];
  children.forEach((child, i) => {
    if (child.type !== 'link_open' || SAFE_LINK.test(child.attrGet('href') ?? '')) return;
    const close = children.findIndex(
      (c, j) => j > i && c.type === 'link_close' && c.level === child.level,
    );
    for (const t of [child, children[close]]) {
      if (!t) continue;
      t.type = 'text';
      t.tag = '';
      t.content = '';
      t.attrs = null;
      t.nesting = 0;
    }
  });
}

function alignToClass(token: Token): void {
  const style = token.attrGet('style');
  if (style === null) return;
  const align = /text-align:(left|center|right)/.exec(style)?.[1];
  token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
  if (align) token.attrJoin('class', `align-${align}`);
}

function markTask(tokens: Token[], index: number, TokenClass: typeof Token): void {
  const inline = tokens[index];
  const paragraph = tokens[index - 1];
  const item = tokens[index - 2];
  const first = inline?.children?.[0];
  if (!inline || paragraph?.type !== 'paragraph_open' || item?.type !== 'list_item_open') return;
  if (first?.type !== 'text') return;
  const match = TASK_MARK.exec(first.content);
  if (!match) return;
  first.content = first.content.slice(match[0].length);
  const box = new TokenClass('task_checkbox', '', 0);
  box.meta = match[1] !== ' ';
  inline.children?.unshift(box);
  item.attrJoin('class', 'task');
}

const ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];
const ALLOWED_ATTR = [
  'alt',
  'checked',
  'class',
  'data-line',
  'disabled',
  'href',
  'rel',
  'src',
  'start',
  'target',
  'title',
  'type',
];

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (!SAFE_LINK.test(href)) node.removeAttribute('href');
    // mailto: in una nuova scheda lascerebbe una scheda vuota in alcuni browser.
    if (/^https?:/i.test(href)) node.setAttribute('target', '_blank');
    else node.removeAttribute('target');
    node.setAttribute('rel', 'noopener noreferrer');
  } else if (node.tagName === 'IMG') {
    if (!SAFE_IMAGE.test(node.getAttribute('src') ?? '')) node.removeAttribute('src');
  } else if (node.tagName === 'INPUT') {
    // Solo caselle di attività in sola lettura: nessun campo in cui scrivere o da inviare.
    node.setAttribute('type', 'checkbox');
    node.setAttribute('disabled', '');
  }
});

/** Testo della nota → nodi DOM già sanificati, pronti per `replaceChildren`. */
export function renderMarkdown(text: string): DocumentFragment {
  return DOMPurify.sanitize(md.render(text), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
}
