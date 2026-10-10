// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { contentTypeFor, parsePrecache, sha256Base64, verifiedResponse } from '../src/sw/integrity';

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const hashOf = (text: string) => sha256Base64(bytes(text));
const SCRIPT = 'console.log("app");';

describe('integrità dei file del service worker', () => {
  it('sha256Base64 è lo SHA-256 in base64 calcolato alla build', async () => {
    // Vettore di prova FIPS 180-2 ("abc"), lo stesso che dà createHash di Node.
    expect(await sha256Base64(bytes('abc'))).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });

  it('serve un file con l’hash atteso, con intestazioni decise dal service worker', async () => {
    const cached = new Response(SCRIPT, {
      headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'x=1', 'X-Evil': '1' },
    });
    const response = await verifiedResponse(cached, 'assets/index-abc.js', await hashOf(SCRIPT));
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response?.headers.get('X-Evil')).toBeNull();
    expect(await response?.text()).toBe(SCRIPT);
  });

  it('rifiuta un contenuto alterato, assente o una risposta di errore', async () => {
    const expected = await hashOf(SCRIPT);
    const path = 'index.html';
    expect(await verifiedResponse(new Response(`${SCRIPT} `), path, expected)).toBeNull();
    expect(await verifiedResponse(new Response(''), path, expected)).toBeNull();
    expect(await verifiedResponse(undefined, path, expected)).toBeNull();
    expect(
      await verifiedResponse(new Response(SCRIPT, { status: 404 }), path, expected),
    ).toBeNull();
    expect(await verifiedResponse(Response.error(), path, expected)).toBeNull();
  });

  it('un corpo già letto non passa', async () => {
    const used = new Response(SCRIPT);
    await used.text();
    expect(await verifiedResponse(used, 'index.html', await hashOf(SCRIPT))).toBeNull();
  });

  it('l’elenco dei file si accetta solo se ben formato', async () => {
    const ok = [
      ['index.html', await hashOf('a')],
      ['assets/Workspace-Bc3Rqv98.js', await hashOf('b')],
    ];
    expect(parsePrecache(ok)).toEqual(ok);
    const bad: unknown[] = [
      [],
      'index.html',
      [['index.html']],
      [['index.html', 'non-base64']],
      [['../fuori.js', await hashOf('a')]],
      [['./index.html', await hashOf('a')]],
      [['/index.html', await hashOf('a')]],
      [['https://evil.test/x.js', await hashOf('a')]],
      [['index.html?x=1', await hashOf('a')]],
      [
        ['index.html', await hashOf('a')],
        ['index.html', await hashOf('b')],
      ],
      [['index.html', await hashOf('a'), 'extra']],
    ];
    for (const value of bad) expect(() => parsePrecache(value), JSON.stringify(value)).toThrow();
  });

  it('il tipo del contenuto viene dall’estensione', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('assets/x.CSS')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('manifest.webmanifest')).toBe('application/manifest+json');
    expect(contentTypeFor('icons/a.png')).toBe('image/png');
    expect(contentTypeFor('senza-estensione')).toBe('application/octet-stream');
  });
});
