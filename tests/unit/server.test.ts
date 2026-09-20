import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { get as httpGet, type Server } from 'node:http';
import { createMeleeServer, parseByteRange } from '../../server/http.ts';
import { sourceFixture } from './source-fixture.ts';
import { VIEWER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import type { IsoSource } from '../../server/iso-source.ts';
import { openIsoSource } from '../../server/iso-source.ts';

describe('HTTP byte range parsing', () => {
  it.each([
    [undefined, { start: 0, end: 99, partial: false }],
    ['bytes=0-9', { start: 0, end: 9, partial: true }],
    ['bytes=50-', { start: 50, end: 99, partial: true }],
    ['bytes=-10', { start: 90, end: 99, partial: true }],
    ['bytes=90-999', { start: 90, end: 99, partial: true }],
    ['bytes=-999', { start: 0, end: 99, partial: true }],
  ])('accepts %s', (header, expected) => expect(parseByteRange(header, 100)).toEqual(expected));
  it.each(['bytes=', 'bytes=-', 'bytes=-0', 'bytes=100-', 'bytes=20-10', 'bytes=1-2,3-4', 'bytes=0-NaN', 'items=0-1', 'bytes=999999999999999999999-', 'bytes=0-999999999999999999999'])('rejects %s', (header) => expect(() => parseByteRange(header, 100)).toThrow());
});

let server: Server;
let base: string;
let directory: string;
let reads = 0;
const bytes = (start: number, length: number) => Uint8Array.from({ length }, (_, index) => (start + index) & 255);
let read: IsoSource['read'] = async (_name, start, length) => bytes(start, length);
beforeAll(async () => {
  const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
  await mkdir(parent, { recursive: true });
  directory = await mkdtemp(join(parent, 'server-tests-'));
  const web = join(directory, 'web');
  await mkdir(join(web, 'assets'), { recursive: true });
  await writeFile(join(web, 'viewer.html'), '<html><head><title>Fixture</title></head><body>Viewer fixture</body></html>');
  await writeFile(join(web, 'play.html'), '<html><head><title>Play</title></head><body>Play fixture</body></html>');
  await writeFile(join(web, 'index.html'), '<html>Lab fixture</html>');
  await writeFile(join(web, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  await writeFile(join(web, 'assets', 'app.js'), 'console.log("fixture");');
  await writeFile(join(directory, 'private.txt'), 'PRIVATE TEST DATA');
  await symlink(join(directory, 'private.txt'), join(web, 'assets', 'leak.js'));
  const manifest = sourceFixture(); manifest.files.push({ path: 'EfCoData.dat', offset: 100000, size: 256 });
  const source: IsoSource = { manifest, read: (...args) => { reads++; return read(...args); }, close: async () => {} };
  server = await createMeleeServer({ source, staticRoot: web, maxConcurrentAssetReads: 1 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(() => { reads = 0; read = async (_name, start, length) => bytes(start, length); });
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('read-only ISO asset server', () => {
  it('serves the offline service worker script with a revalidating cache policy', async () => {
    const response = await fetch(`${base}/sw.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('addEventListener');
  });
  it('redirects the landing page to the automatic viewer', async () => {
    const response = await fetch(base, { redirect: 'manual' }); expect(response.status).toBe(302); expect(response.headers.get('location')).toBe('/play');
  });
  it('serves the game at its clean URLs and nothing else under them', async () => {
    for (const path of ['/play', '/players', '/players/Fox_main']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<meta name="smash-source" content="server">');
    }
    for (const path of ['/players/', '/players/a', '/players/fox/extra', '/play/', '/playx']) expect((await fetch(`${base}${path}`)).status).toBe(404);
  });
  it('marks viewer/play HTML as server-enabled but not the port lab', async () => {
    const response = await fetch(`${base}/viewer.html`);
    expect(await response.text()).toContain('<meta name="smash-source" content="server">');
    expect(await (await fetch(`${base}/play.html`)).text()).toContain('<meta name="smash-source" content="server">');
    expect(await (await fetch(`${base}/index.html`)).text()).not.toContain('smash-source');
  });
  it('serves browser code and restrictive response headers', async () => {
    const response = await fetch(`${base}/assets/app.js`);
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('javascript');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
  it('exposes only curated metadata without host paths', async () => {
    const response = await fetch(`${base}/api/source`), body = await response.text();
    expect(response.status).toBe(200); expect(JSON.parse(body).files).toHaveLength(VIEWER_ASSETS.length + 1);
    expect(body).not.toContain('/home/'); expect(body).not.toContain('.iso'); expect(body).not.toContain('main.dol');
  });
  it.each(['GrNBa.dat', 'EfCoData.dat'])('returns exact bounded %s bytes with proper HTTP headers', async (asset) => {
    const response = await fetch(`${base}/api/assets/${asset}`,  { headers: { Range: 'bytes=10-13' } });
    expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe('bytes 10-13/256');
    expect(response.headers.get('content-length')).toBe('4'); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([10, 11, 12, 13]); expect(reads).toBe(1);
  });
  it('returns complete allowlisted assets when requested without a range', async () => {
    const response = await fetch(`${base}/api/assets/GrNBa.dat`);
    expect(response.status).toBe(200); expect((await response.arrayBuffer()).byteLength).toBe(256);
  });
  it('compresses whole-file asset downloads once, keeping ranges and incompressible files identity', async () => {
    // EfCoData.dat is requested nowhere else: compressed bodies are cached per file for the server's life.
    read = async (_name, _start, length) => new Uint8Array(length);
    const whole = await fetch(`${base}/api/assets/EfCoData.dat`, { headers: { 'Accept-Encoding': 'br, gzip' } });
    expect(whole.status).toBe(200); expect(whole.headers.get('content-encoding')).toBe('br'); expect(whole.headers.get('vary')).toBe('Accept-Encoding');
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(new Uint8Array(256));
    const again = await fetch(`${base}/api/assets/EfCoData.dat`, { headers: { 'Accept-Encoding': 'br' } });
    expect(again.headers.get('content-encoding')).toBe('br'); await again.arrayBuffer();
    expect(reads).toBe(1);
    const gzip = await fetch(`${base}/api/assets/EfCoData.dat`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect([gzip.status, gzip.headers.get('content-encoding')]).toEqual([200, 'gzip']); expect((await gzip.arrayBuffer()).byteLength).toBe(256);
    const ranged = await fetch(`${base}/api/assets/EfCoData.dat`, { headers: { 'Accept-Encoding': 'br, gzip', Range: 'bytes=0-15' } });
    expect(ranged.status).toBe(206); expect(ranged.headers.get('content-encoding')).toBeNull(); expect((await ranged.arrayBuffer()).byteLength).toBe(16);
    // Random bytes do not shrink: sent as-is.
    read = async (_name, _start, length) => Uint8Array.from({ length }, () => Math.floor(Math.random() * 256));
    const noise = await fetch(`${base}/api/assets/PlFx.dat`, { headers: { 'Accept-Encoding': 'br' } });
    expect(noise.status).toBe(200); expect(noise.headers.get('content-encoding')).toBeNull(); await noise.arrayBuffer();
  });
  it('handles HEAD without reading the ISO', async () => {
    const response = await fetch(`${base}/api/assets/GrNBa.dat`, { method: 'HEAD', headers: { Range: 'bytes=0-15' } });
    expect(response.status).toBe(206); expect(response.headers.get('content-length')).toBe('16');
    expect((await response.arrayBuffer()).byteLength).toBe(0); expect(reads).toBe(0);
  });
  it('reports unsatisfiable ranges without reading', async () => {
    const response = await fetch(`${base}/api/assets/GrNBa.dat`, { headers: { Range: 'bytes=999-' } });
    expect(response.status).toBe(416); expect(response.headers.get('content-range')).toBe('bytes */256'); expect(reads).toBe(0);
  });
  it.each(['/api/disc', '/api/assets/main.dol', '/api/assets/GrPs5.dat', '/api/assets/EfAll.dat', '/api/assets/game.iso', '/private/disc-report.json', '/.local/toolchain.json', '/@fs/etc/passwd', '/api/assets/%2e%2e%2fmain.dol', '/assets/leak.js', '/assets/file.dat'])('does not expose %s', async (path) => {
    const response = await fetch(base + path); expect(response.status).toBe(404); expect(reads).toBe(0);
  });
  it('rejects write/upload methods', async () => {
    const response = await fetch(`${base}/api/assets/GrNBa.dat`, { method: 'POST', body: 'data' });
    expect(response.status).toBe(405); expect(response.headers.get('allow')).toBe('GET, HEAD'); expect(reads).toBe(0);
  });
  it('rejects cross-origin requests', async () => {
    const response = await fetch(`${base}/api/source`, { headers: { Origin: 'https://other.example' } });
    expect(response.status).toBe(403); expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });
  it('rejects cross-site fetch metadata', async () => expect((await fetch(`${base}/api/source`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403));
  it('serves cross-site top-level navigations: links from chats/search arrive that way', async () => {
    // fetch overwrites Sec-Fetch-* metadata; use a raw request like a browser navigation.
    const raw = (headers: Record<string, string>) => new Promise<number>((resolve, reject) => {
      const request = httpGet(`${base}/play.html`, { headers }, (response) => {
        response.resume(); response.once('end', () => resolve(response.statusCode ?? 0));
      });
      request.once('error', reject);
    });
    expect(await raw({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' })).toBe(200);
    expect(await raw({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors' })).toBe(403);
  });
  it('accepts a same-host Origin whose scheme was rewritten by a TLS proxy', async () => {
    const authority = new URL(base).host;
    expect((await fetch(`${base}/api/source`, { headers: { Origin: `https://${authority}` } })).status).toBe(200);
    expect((await fetch(`${base}/api/source`, { headers: { Origin: 'null' } })).status).toBe(403);
  });
  it('rejects unexpected Host headers', async () => {
    // Fetch normalizes forbidden Host headers; use an actual raw HTTP request.
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpGet(`${base}/api/source`, { headers: { Host: 'rebind.example' } }, (response) => {
        response.resume(); response.once('end', () => resolve(response.statusCode ?? 0));
      });
      request.once('error', reject);
    });
    expect(status).toBe(403);
  });
  it('does not leak filesystem error details to clients', async () => {
    read = async () => { throw new Error('SYNTHETIC PRIVATE PATH'); };
    const response = await fetch(`${base}/api/assets/GrNBa.dat`);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain('SYNTHETIC');
  });
  it('bounds concurrent asset reads', async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    read = async (_name, start, length) => { entered(); await hold; return bytes(start, length); };
    const first = fetch(`${base}/api/assets/GrNBa.dat`);
    await started;
    try {
      const second = await fetch(`${base}/api/assets/PlFx.dat`);
      expect(second.status).toBe(503); expect(second.headers.get('retry-after')).toBe('1');
    } finally { release(); await (await first).arrayBuffer(); }
  });
  it('refuses invalid server-side discs before creating an asset source', async () => {
    const path = join(directory, 'invalid.iso'); await writeFile(path, new Uint8Array(64));
    await expect(openIsoSource(path)).rejects.toThrow('invalid or truncated');
  });
  it('compresses static files on request and keeps identical bytes for clients without encodings', async () => {
    const plain = await fetch(`${base}/assets/app.js`, { headers: { 'Accept-Encoding': 'identity' } });
    expect(plain.headers.get('content-encoding')).toBeNull(); expect(await plain.text()).toBe('console.log("fixture");');
    const compressed = await fetch(`${base}/assets/app.js`, { headers: { 'Accept-Encoding': 'gzip, br' } });
    expect(compressed.headers.get('content-encoding')).toBe('br'); expect(compressed.headers.get('vary')).toBe('Accept-Encoding');
    expect(await compressed.text()).toBe('console.log("fixture");');
    const gzipped = await fetch(`${base}/play.html`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(gzipped.headers.get('content-encoding')).toBe('gzip'); expect(await gzipped.text()).toContain('<meta name="smash-source" content="server">');
  });
  it('serves strong ETags with 304 revalidation, and immutable caching only for hashed bundle names', async () => {
    const page = await fetch(`${base}/play.html`), etag = page.headers.get('etag')!;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/u); expect(page.headers.get('cache-control')).toBe('no-cache');
    const revalidated = await fetch(`${base}/play.html`, { headers: { 'If-None-Match': etag } });
    expect(revalidated.status).toBe(304); expect(revalidated.headers.get('etag')).toBe(etag);
    expect((await fetch(`${base}/play.html`, { headers: { 'If-None-Match': '"stale"' } })).status).toBe(200);
    expect((await fetch(`${base}/assets/app.js`)).headers.get('cache-control')).toBe('no-cache');
    await writeFile(join(directory, 'web', 'assets', 'play-Ab12cD3e.js'), 'export {};');
    const hashed = await fetch(`${base}/assets/play-Ab12cD3e.js`);
    expect(hashed.status).toBe(200); expect(hashed.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await fetch(`${base}/api/assets/GrNBa.dat`, { headers: { Range: 'bytes=0-3' } })).headers.get('cache-control')).toBe('private, no-store');
  });
});
