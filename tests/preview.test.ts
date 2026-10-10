import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/features/preview/markdown';
import { nextViewMode, loadViewMode } from '../src/features/preview/viewMode';

function render(text: string): HTMLElement {
  const host = document.createElement('div');
  host.append(renderMarkdown(text));
  return host;
}

/** Nessun elemento o attributo che possa eseguire codice, caricare risorse o applicare stili. */
function expectInert(host: HTMLElement): void {
  expect(
    host.querySelector('script, style, iframe, object, embed, form, svg, math, link, meta'),
  ).toBeNull();
  for (const element of host.querySelectorAll('*')) {
    for (const { name, value } of element.attributes) {
      expect(name.startsWith('on'), `${element.tagName} ${name}`).toBe(false);
      expect(name).not.toBe('style');
      if (name === 'href') expect(value).toMatch(/^(https?:|mailto:)/i);
      if (name === 'src') expect(value).toMatch(/^data:image\/(png|jpeg|gif|webp);/i);
    }
  }
}

describe('anteprima Markdown: attacchi', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<iframe src="https://example.com"></iframe>',
    '<style>body{display:none}</style>',
    '<a href="javascript:alert(1)">x</a>',
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](  javascript:alert(1))',
    '[x](javascript&#58;alert(1))',
    '[x](java\nscript:alert(1))',
    '[x](vbscript:msgbox(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[x](file:///etc/passwd)',
    '<javascript:alert(1)>',
    '[x](#"onmouseover="alert(1))',
    '![x](javascript:alert(1))',
    '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)',
    '# Titolo <b onmouseover=alert(1)>grassetto</b>',
    '```\n</code></pre><script>alert(1)</script>\n```',
    '[x](https://example.com "titolo\\" onmouseover=\\"alert(1)")',
    '- [ ] <input type="text" autofocus onfocus=alert(1)>',
  ];

  it.each(payloads)('rende innocuo %j', (payload) => {
    const host = render(payload);
    expectInert(host);
  });

  it('l’HTML grezzo resta testo visibile', () => {
    const host = render('<script>alert(1)</script>');
    expect(host.textContent).toContain('<script>alert(1)</script>');
  });

  it('i link non sicuri restano testo senza href', () => {
    const host = render('[clic](javascript:alert(1))');
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('[clic](javascript:alert(1))');
  });
});

describe('anteprima Markdown: rete', () => {
  it('blocca le immagini remote e mostra un avviso con il testo alternativo', () => {
    const host = render('![schema](https://example.com/schema.png)');
    expect(host.querySelector('img')).toBeNull();
    const blocked = host.querySelector('.blocked-image');
    expect(blocked?.textContent).toBe('Immagine esterna bloccata: schema');
    expect(blocked?.getAttribute('title')).toBe('https://example.com/schema.png');
  });

  it('blocca anche le immagini relative e senza testo alternativo', () => {
    const host = render('![](immagine.png)');
    expect(host.querySelector('img')).toBeNull();
  });

  it('le immagini DATA: maiuscolo restano testo, non un’immagine rotta', () => {
    const host = render('![x](DATA:image/png;base64,iVBORw0KGgo=)');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('![x](DATA:image/png');
  });

  it('un link verso un’immagine data: resta solo testo', () => {
    const host = render('[x](data:image/png;base64,iVBORw0KGgo=)');
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent?.trim()).toBe('x');
  });

  it('mostra le immagini incorporate nel testo (data: raster)', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const host = render(`![punto](${src})`);
    expect(host.querySelector('img')?.getAttribute('src')).toBe(src);
  });

  it('i link si aprono in una nuova scheda senza referrer né opener', () => {
    const host = render('[repo](https://github.com) e www.example.com e mailto:a@b.it');
    const links = [...host.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://github.com',
      'http://www.example.com',
      'mailto:a@b.it',
    ]);
    for (const a of links) expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    // mailto: nella stessa scheda (apre il programma di posta, niente scheda vuota).
    expect(links.map((a) => a.getAttribute('target'))).toEqual(['_blank', '_blank', null]);
  });
});

describe('anteprima Markdown: contenuto', () => {
  it('liste di attività come caselle in sola lettura', () => {
    const host = render('- [ ] da fare\n- [x] fatto\n- normale');
    const boxes = [...host.querySelectorAll('input')];
    expect(boxes.map((b) => [b.type, b.disabled, b.checked])).toEqual([
      ['checkbox', true, false],
      ['checkbox', true, true],
    ]);
    expect(host.querySelectorAll('li.task')).toHaveLength(2);
    expect(host.textContent).toContain('da fare');
    expect(host.textContent).not.toContain('[ ]');
  });

  it('allineamento delle tabelle con classi, non con stile inline', () => {
    const host = render('| a | b |\n|:-:|--:|\n| 1 | 2 |');
    expect(host.querySelector('th')?.className).toBe('align-center');
    expect(host.querySelector('td:last-child')?.className).toBe('align-right');
    expectInert(host);
  });

  it('i blocchi ricordano la riga del sorgente per il doppio clic', () => {
    const host = render('# Titolo\n\nParagrafo\n\n- voce');
    expect(host.querySelector('h1')?.getAttribute('data-line')).toBe('0');
    expect(host.querySelector('p')?.getAttribute('data-line')).toBe('2');
    expect(host.querySelector('li')?.getAttribute('data-line')).toBe('4');
  });

  it('anche blocchi di codice e righe orizzontali portano la riga', () => {
    const host = render('testo\n\n```\ncodice\n```\n\n---\n\n    rientrato');
    expect(host.querySelector('pre code')?.getAttribute('data-line')).toBe('2');
    expect(host.querySelector('hr')?.getAttribute('data-line')).toBe('6');
    expect(host.querySelectorAll('pre')[1]?.getAttribute('data-line')).toBe('8');
  });

  it('a capo singolo diventa un a capo, come nel testo', () => {
    const host = render('riga uno\nriga due');
    expect(host.querySelector('p br')).not.toBeNull();
  });
});

describe('modalità di visualizzazione', () => {
  it('Ctrl+E gira tra le tre modalità', () => {
    expect(nextViewMode('edit')).toBe('split');
    expect(nextViewMode('split')).toBe('preview');
    expect(nextViewMode('preview')).toBe('edit');
  });

  it('valori salvati non validi o storage inaccessibile tornano ad "affiancata"', () => {
    expect(loadViewMode({ getItem: () => 'preview' })).toBe('preview');
    expect(loadViewMode({ getItem: () => 'boh' })).toBe('split');
    expect(
      loadViewMode({
        getItem: () => {
          throw new Error('bloccato');
        },
      }),
    ).toBe('split');
    expect(loadViewMode(undefined)).toBe('split');
  });
});

describe('anteprima Markdown: tag', () => {
  it('i tag diventano etichette, ma non nei link né nel codice', () => {
    const host = render('Vedi #cliente/Acme e #personale\n\n[#nonTag](https://x.it) `#codice`');
    const tags = [...host.querySelectorAll('.tag')];
    expect(
      tags.map((t) => [t.getAttribute('data-tag'), t.getAttribute('data-c'), t.textContent]),
    ).toEqual([
      ['cliente/acme', 'cliente', '#cliente/acme'],
      ['personale', 'altri', '#personale'],
    ]);
    expect(host.textContent).toContain('Vedi');
    expectInert(host);
  });
});
