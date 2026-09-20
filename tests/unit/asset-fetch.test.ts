import { describe, expect, it } from 'vitest';
import { cacheStorageStore, cachingFetcher, coalescingFetcher, manifestIdentity, offlineWholeFileFetcher, type AssetStore } from '../../lib/hsd/asset-fetch.ts';
import { connectServerSource } from '../../lib/hsd/server-source.ts';
import { sourceFixture } from './source-fixture.ts';

const manifest = sourceFixture();
const first = manifest.files[0]!;
const data = new Map<string, Uint8Array>(manifest.files.map(file => [file.path, Uint8Array.from({ length: file.size }, (_, i) => (i * 7 + file.path.length) & 255)]));
/** Range-serving origin that counts requests and bytes like the real asset endpoint. */
function origin() {
  const log: string[] = []; let bytes = 0;
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === '/api/source') return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } });
    const path = decodeURIComponent(url.slice('/api/assets/'.length)), file = data.get(path)!;
    const header = new Headers(init?.headers).get('Range');
    // Like the real endpoint: no Range header is a whole-file 200 (which it may compress).
    const [, s, e] = header ? /^bytes=(\d+)-(\d+)$/u.exec(header)! : ['', '0', String(file.length - 1)];
    const start = Number(s), end = Number(e); log.push(`${path}:${start}-${end}`); bytes += end - start + 1;
    if (!header) return new Response(file.slice(0), { status: 200, headers: { 'Content-Length': String(file.length) } });
    return new Response(file.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': String(end - start + 1) } });
  };
  return { fetcher, log, bytes: () => bytes };
}
function memoryStore(): AssetStore & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return { map, async get(key) { return map.get(key); }, async put(key, bytes) { map.set(key, bytes); } };
}

describe('play-mode read coalescing', () => {
  it('downloads a small asset once and answers every range from it with exact 206 replies', async () => {
    const o = origin(), fetcher = coalescingFetcher(o.fetcher, { limit: 512 });
    const connected = (await connectServerSource(fetcher))!;
    const a = await connected.session.bytes(first.path), b = await connected.session.bytes(first.path);
    expect(a).toEqual(data.get(first.path)); expect(b).toEqual(a);
    const reader = connected.session;
    const slice = await (reader as unknown as { read(entry: { offset: number; size: number }, start: number, length: number): Promise<Uint8Array> }).read({ offset: first.offset, size: first.size }, 10, 5);
    expect([...slice]).toEqual([...data.get(first.path)!.subarray(10, 15)]);
    expect(o.log.filter(entry => entry.startsWith(first.path))).toEqual([`${first.path}:0-${first.size - 1}`]);
  });
  it('is chosen by manifest size only, passes larger assets through unchanged, and shares in-flight downloads', async () => {
    const o = origin(), fetcher = coalescingFetcher(o.fetcher, { limit: first.size - 1 });
    await fetcher('/api/source');
    const range = (start: number, end: number) => fetcher(`/api/assets/${encodeURIComponent(first.path)}`, { headers: { Range: `bytes=${start}-${end}` } });
    const [x, y] = await Promise.all([range(0, 3), range(4, 7)]);
    expect(x.status).toBe(206); expect(x.headers.get('content-range')).toBe(`bytes 0-3/${first.size}`); expect(y.headers.get('content-range')).toBe(`bytes 4-7/${first.size}`);
    expect(o.log).toEqual([`${first.path}:0-3`, `${first.path}:4-7`]);
    const small = coalescingFetcher(origin().fetcher, { limit: first.size });
    await small('/api/source');
    const shared = await Promise.all([small(`/api/assets/${first.path}`, { headers: { Range: 'bytes=0-3' } }), small(`/api/assets/${first.path}`, { headers: { Range: 'bytes=4-7' } })]);
    expect([...new Uint8Array(await shared[0]!.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(0, 4)]);
    expect([...new Uint8Array(await shared[1]!.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(4, 8)]);
  });
  it('bounds the bytes it holds without dropping downloads in flight, and serves session prefetches once', async () => {
    const [a, b] = manifest.files.filter(file => file.size > 16).slice(0, 2) as [typeof first, typeof first];
    const o = origin(), fetcher = coalescingFetcher(o.fetcher, { limit: 1 << 20, budget: Math.max(a.size, b.size) });
    const connected = (await connectServerSource(fetcher))!;
    const downloads = (path: string) => o.log.filter(entry => entry.startsWith(`${path}:`)).length;
    // Both prefetches are in flight together: over budget, but neither is dropped or fetched twice.
    connected.session.prefetch([a.path, b.path, 'missing.dat'], 1 << 20);
    expect(await connected.session.bytes(a.path)).toEqual(data.get(a.path));
    expect(await connected.session.bytes(b.path)).toEqual(data.get(b.path));
    expect([downloads(a.path), downloads(b.path)]).toEqual([1, 1]);
    // Once settled, the next new file evicts the older one (the budget fits one file).
    const c = manifest.files.find(file => file.size > 16 && file !== a && file !== b)!;
    await connected.session.bytes(c.path);
    await connected.session.bytes(b.path);
    expect(downloads(b.path)).toBe(2);
    // Files above the caller's limit are never warmed.
    const before = o.log.length;
    connected.session.prefetch([first.path], first.size - 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(o.log).toHaveLength(before);
  });
  it('retries whole downloads the server declines as busy and caches whole-file replies', async () => {
    const o = origin(); let busy = 2;
    const flaky = async (url: string, init?: RequestInit) => {
      if (url !== '/api/source' && busy-- > 0) return new Response('busy', { status: 503, headers: { 'Retry-After': '1' } });
      return o.fetcher(url, init);
    };
    const store = memoryStore();
    const fetcher = coalescingFetcher(cachingFetcher(flaky, store), { limit: 1 << 20 });
    const connected = (await connectServerSource(fetcher))!;
    expect(await connected.session.bytes(first.path)).toEqual(data.get(first.path));
    expect(o.log.filter(entry => entry.startsWith(`${first.path}:`))).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    // A new transport over the same store answers from the cached whole file, with no request.
    const cached = coalescingFetcher(cachingFetcher(o.fetcher, store), { limit: 1 << 20 });
    const again = (await connectServerSource(cached))!;
    expect(await again.session.bytes(first.path)).toEqual(data.get(first.path));
    expect(o.log.filter(entry => entry.startsWith(`${first.path}:`))).toHaveLength(1);
  }, 10_000);
  it('ignores non-asset, non-range and out-of-file requests', async () => {
    const o = origin(), fetcher = coalescingFetcher(o.fetcher, { limit: 1 << 20 });
    await fetcher('/api/source');
    expect((await fetcher(`/api/assets/${first.path}`, { headers: { Range: `bytes=0-${first.size}` } })).status).toBe(206);
    expect(o.log).toEqual([`${first.path}:0-${first.size}`]);
  });
});

describe('offline whole-file transport', () => {
  /** Origin modeling the TV-shell WebView quirk: only start-at-zero 206s and
   * full 200 bodies survive interception; any nonzero-start range fails. */
  function quirkOrigin() {
    const log: string[] = [];
    const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === '/api/source') return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } });
      const path = decodeURIComponent(url.slice('/api/assets/'.length)), file = data.get(path)!;
      const range = new Headers(init?.headers).get('Range');
      if (!range) {
        log.push(`${path}:full`);
        return new Response(file.slice(0), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.length) } });
      }
      const [, s, e] = /^bytes=(\d+)-(\d+)$/u.exec(range)!;
      const start = Number(s), end = Number(e);
      log.push(`${path}:${start}-${end}`);
      if (start > 0) throw new TypeError('Failed to fetch');
      return new Response(file.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': String(end - start + 1) } });
    };
    return { fetcher, log };
  }
  it('never sends a ranged request: one whole download answers every slice with exact 206s', async () => {
    const o = quirkOrigin(), fetcher = offlineWholeFileFetcher(o.fetcher, { retain: 8 });
    await fetcher('/api/source');
    const url = `/api/assets/${encodeURIComponent(first.path)}`;
    const mid = await fetcher(url, { headers: { Range: 'bytes=10-19' } });
    expect(mid.status).toBe(206);
    expect(mid.headers.get('content-range')).toBe(`bytes 10-19/${first.size}`);
    expect(mid.headers.get('content-length')).toBe('10');
    expect([...new Uint8Array(await mid.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(10, 20)]);
    const head = await fetcher(url, { headers: { Range: 'bytes=0-4' } });
    expect(head.status).toBe(206);
    expect([...new Uint8Array(await head.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(0, 5)]);
    expect(o.log).toEqual([`${first.path}:full`]);
  });
  it('shares in-flight whole downloads and passes through unknown, non-range and out-of-file reads', async () => {
    const o = quirkOrigin(), fetcher = offlineWholeFileFetcher(o.fetcher, { retain: 1 });
    // Before the manifest is known there are no sizes to slice by.
    await fetcher(`/api/assets/${first.path}`, { headers: { Range: 'bytes=0-1' } });
    expect(o.log).toEqual([`${first.path}:0-1`]);
    await fetcher('/api/source');
    const url = `/api/assets/${encodeURIComponent(first.path)}`;
    const [x, y] = await Promise.all([
      fetcher(url, { headers: { Range: 'bytes=20-29' } }),
      fetcher(url, { headers: { Range: 'bytes=30-39' } }),
    ]);
    expect(x.status).toBe(206); expect(y.status).toBe(206);
    expect([...new Uint8Array(await x.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(20, 30)]);
    expect([...new Uint8Array(await y.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(30, 40)]);
    expect(o.log.filter(entry => entry.endsWith(':full')).length).toBe(1);
    // Out-of-file ranges are not sliced locally; the origin answers them directly.
    const pastEnd = await fetcher(url, { headers: { Range: `bytes=0-${first.size}` } });
    expect(pastEnd.status).toBe(206);
    expect(o.log.at(-1)).toBe(`${first.path}:0-${first.size}`);
  });
});

describe('persistent asset cache', () => {
  it('replays stored ranges without touching the network and keys them by disc identity', async () => {
    const o = origin(), store = memoryStore(), fetcher = cachingFetcher(o.fetcher, store);
    await fetcher('/api/source');
    const url = `/api/assets/${encodeURIComponent(first.path)}`, init = { headers: { Range: 'bytes=2-9' } };
    const miss = await fetcher(url, init); expect(miss.status).toBe(206); expect([...new Uint8Array(await miss.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(2, 10)]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([...store.map.keys()]).toEqual([`${manifestIdentity(manifest)}/${first.path}?start=2&end=9`]);
    const hit = await fetcher(url, init);
    expect(hit.status).toBe(206); expect(hit.headers.get('content-range')).toBe(`bytes 2-9/${first.size}`); expect(hit.headers.get('content-length')).toBe('8');
    expect([...new Uint8Array(await hit.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(2, 10)]);
    expect(o.log).toEqual([`${first.path}:2-9`]);
  });
  it('never caches before the manifest is known, on errors, or with a corrupt stored length', async () => {
    const o = origin(), store = memoryStore(), fetcher = cachingFetcher(o.fetcher, store);
    await fetcher(`/api/assets/${first.path}`, { headers: { Range: 'bytes=0-1' } });
    expect(store.map.size).toBe(0);
    await fetcher('/api/source');
    store.map.set(`${manifestIdentity(manifest)}/${first.path}?start=0&end=1`, new Uint8Array(5));
    const response = await fetcher(`/api/assets/${first.path}`, { headers: { Range: 'bytes=0-1' } });
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...data.get(first.path)!.subarray(0, 2)]);
    expect(o.log).toEqual([`${first.path}:0-1`, `${first.path}:0-1`]);
    expect(cachingFetcher(o.fetcher, null)).toBe(o.fetcher);
  });
  it('maps keys onto Cache Storage per disc identity and evicts other disc caches', async () => {
    const stores = new Map<string, Map<string, Response>>(), deleted: string[] = [];
    stores.set('smash-assets-old-disc', new Map()); stores.set('unrelated', new Map());
    const caches = {
      async keys() { return [...stores.keys()]; },
      async delete(name: string) { deleted.push(name); return stores.delete(name); },
      async open(name: string) {
        if (!stores.has(name)) stores.set(name, new Map());
        const map = stores.get(name)!;
        return { async match(request: string) { return map.get(request); }, async put(request: string, response: Response) { map.set(request, response); } } as unknown as Cache;
      },
    } as unknown as CacheStorage;
    const store = cacheStorageStore({ caches })!;
    const key = `${manifestIdentity(manifest)}/${first.path}?start=0&end=3`;
    expect(await store.get(key)).toBeUndefined();
    await store.put(key, new Uint8Array([9, 8, 7, 6]));
    expect([...(await store.get(key))!]).toEqual([9, 8, 7, 6]);
    expect([...stores.keys()]).toEqual(['unrelated', `smash-assets-${manifestIdentity(manifest)}`]); expect(deleted).toEqual(['smash-assets-old-disc']);
    expect(cacheStorageStore({})).toBeNull();
  });
});
