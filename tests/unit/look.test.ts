import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { applyLook, lookAssetName, parseSourceManifest, servedAssets, type SourceManifest } from '../../lib/hsd/source-protocol.ts';
import { cachingFetcher, manifestIdentity, type AssetStore } from '../../lib/hsd/asset-fetch.ts';
import { cachedDiscReader, connectServerSource } from '../../lib/hsd/server-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { ANIMELEE_LOOK } from '../../lib/hsd/looks.ts';
import { createMeleeServer } from '../../server/http.ts';
import type { IsoSource } from '../../server/iso-source.ts';
import { chooseLook, ORIGINAL_LOOK } from '../../web/src/play/look-setting.ts';
import { sourceFixture } from './source-fixture.ts';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fill = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (i * 13 + seed) & 255);
const base = sourceFixture();
const [first, second, third] = base.files as [typeof base.files[0], typeof base.files[0], typeof base.files[0]];
const lookBytes = new Map([[first.path, fill(300, 1)], [second.path, fill(200, 2)]]);
/** The fixture disc plus a two-file look addressed in its own 50 kB disc. */
function lookManifest(): SourceManifest {
  const manifest = sourceFixture();
  manifest.looks = [{ id: 'animelee', name: 'Animelee', discSize: 50_000, files: [
    { path: first.path, offset: 1000, size: 300, sha256: sha256(lookBytes.get(first.path)!) },
    { path: second.path, offset: 2000, size: 200, sha256: sha256(lookBytes.get(second.path)!) },
  ] }];
  return manifest;
}

describe('cosmetic look manifest layer', () => {
  it('parses a look and keeps the disc table the original', () => {
    const parsed = parseSourceManifest(JSON.parse(JSON.stringify(lookManifest())));
    expect(parsed.looks?.map((look) => [look.id, look.files.length])).toEqual([['animelee', 2]]);
    expect(parsed.files).toEqual(base.files);
  });
  it.each([
    ['a path the disc table does not expose', (m: SourceManifest) => { m.looks![0]!.files[0]!.path = 'PlZzNr.dat'; }],
    ['a file without a content hash', (m: SourceManifest) => { delete m.looks![0]!.files[0]!.sha256; }],
    ['a malformed id', (m: SourceManifest) => { m.looks![0]!.id = 'Anime Lee'; }],
    ['duplicate ids', (m: SourceManifest) => { m.looks!.push(structuredClone(m.looks![0]!)); }],
    ['bytes past the look disc', (m: SourceManifest) => { m.looks![0]!.files[0]!.offset = 49_900; }],
    ['a served-name override on a disc file', (m: SourceManifest) => { m.files[2]!.asset = 'look/animelee/x'; }],
    ['a served-name override on a look file', (m: SourceManifest) => { m.looks![0]!.files[0]!.asset = 'x'; }],
  ])('rejects %s', (_label, mutate) => {
    const manifest = lookManifest(); mutate(manifest);
    expect(() => parseSourceManifest(JSON.parse(JSON.stringify(manifest)))).toThrow();
  });
  it('rebases chosen look files past the disc, fetched by look name, and leaves the rest', () => {
    const manifest = lookManifest(), applied = applyLook(manifest, 'animelee');
    expect(applied.discSize).toBe(base.discSize + 50_000);
    expect(applied.files[0]).toEqual({ path: first.path, offset: base.discSize + 1000, size: 300, sha256: manifest.looks![0]!.files[0]!.sha256, asset: lookAssetName('animelee', first.path) });
    expect(applied.files[2]).toBe(manifest.files[2]);
    expect(applyLook(manifest, null)).toBe(manifest);
    expect(applyLook(manifest, 'missing')).toBe(manifest);
    expect(servedAssets(manifest).map((file) => file.path)).toEqual([...base.files.map((file) => file.path), `look/animelee/${first.path}`, `look/animelee/${second.path}`]);
  });
  it('defaults to the host look, honours Original and ignores looks this host lacks', () => {
    const manifest = lookManifest();
    expect(chooseLook(manifest, null)).toBe('animelee');
    expect(chooseLook(manifest, ORIGINAL_LOOK)).toBeNull();
    expect(chooseLook(manifest, 'animelee')).toBe('animelee');
    expect(chooseLook(manifest, 'retired-look')).toBe('animelee');
    expect(chooseLook(sourceFixture(), null)).toBeNull();
  });
  it('pins the Animelee look to allowlisted files only, never the executable or fighter tables it leaves', () => {
    const files = Object.keys(ANIMELEE_LOOK.files);
    expect(files.length).toBe(137);
    expect(files).not.toContain('PlNsBu.dat');
    expect(files).not.toContain('PlNsGr.dat');
    for (const [original, look] of Object.values(ANIMELEE_LOOK.files)) { expect(original).toMatch(/^[0-9a-f]{64}$/u); expect(look).toMatch(/^[0-9a-f]{64}$/u); expect(look).not.toBe(original); }
  });
});

/** Range origin serving the disc files by path and look files by look name. */
function origin(manifest: SourceManifest) {
  const log: string[] = [];
  const bytesFor = (name: string) => name.startsWith('look/animelee/') ? lookBytes.get(name.slice('look/animelee/'.length))! : fill(manifest.files.find((file) => file.path === name)!.size, 9);
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/source') return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } });
    const name = decodeURIComponent(url.slice('/api/assets/'.length)), file = bytesFor(name);
    const [, s, e] = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init?.headers).get('Range')!)!;
    const start = Number(s), end = Number(e); log.push(name);
    return new Response(file.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': String(end - start + 1) } });
  };
  return { fetcher, log };
}
function memoryStore(): AssetStore & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return { map, async get(key) { return map.get(key); }, async put(key, bytes) { map.set(key, bytes); } };
}

describe('reading through a look', () => {
  it('reads look files by look name while the connection keeps the original manifest', async () => {
    const manifest = lookManifest(), o = origin(manifest), store = memoryStore();
    const connected = (await connectServerSource(cachingFetcher(o.fetcher, store), undefined, { look: () => 'animelee' }))!;
    expect(connected.look).toBe('animelee');
    expect(connected.manifest.files).toEqual(manifest.files);
    expect(await connected.session.bytes(first.path)).toEqual(lookBytes.get(first.path));
    expect(await connected.session.bytes(third.path)).toEqual(fill(third.size, 9));
    expect(o.log).toEqual([`look/animelee/${first.path}`, third.path]);
    // Content-addressed: the look file is cached under its own hash, readable offline under the original identity.
    const offline = new HsdAssetSession(cachedDiscReader(applyLook(manifest, 'animelee'), store, { identity: manifestIdentity(manifest) }), applyLook(manifest, 'animelee'));
    expect(await offline.bytes(first.path)).toEqual(lookBytes.get(first.path));
    const original = (await connectServerSource(o.fetcher, undefined, { look: () => null }))!;
    expect(original.look).toBeNull();
    expect(await original.session.bytes(first.path)).toEqual(fill(first.size, 9));
  });
});

describe('look assets on the HTTP server', () => {
  let server: Server, url: string, directory: string;
  const reads: string[] = [];
  beforeAll(async () => {
    const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'look-server-'));
    await writeFile(join(directory, 'play.html'), '<html><head></head><body>Play</body></html>');
    const source: IsoSource = { manifest: lookManifest(), read: async (name, start, length) => { reads.push(name); return fill(length, start); }, close: async () => {} };
    server = await createMeleeServer({ source, staticRoot: directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  it('offers the look in the manifest and serves only its pinned files by look name', async () => {
    const manifest = parseSourceManifest(await (await fetch(`${url}/api/source`)).json());
    expect(manifest.looks?.[0]?.id).toBe('animelee');
    const ranged = await fetch(`${url}/api/assets/${encodeURIComponent(lookAssetName('animelee', first.path))}`, { headers: { Range: 'bytes=0-9' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 0-9/300');
    expect(reads).toEqual([`look/animelee/${first.path}`]);
    expect((await fetch(`${url}/api/assets/${encodeURIComponent(lookAssetName('animelee', third.path))}`)).status).toBe(404);
  });
});
