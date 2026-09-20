import { describe, expect, it } from 'vitest';
import {
  cacheStorageStore,
  cachingFetcher,
  coalescingFetcher,
  contentCacheKey,
  loadCachedManifest,
  manifestIdentity,
  rangeCacheKey,
  saveCachedManifest,
} from '../../lib/hsd/asset-fetch.ts';
import { cachedDiscReader, connectCachedSource, connectServerSource, serverDiscReader, storedCopyGaps } from '../../lib/hsd/server-source.ts';
import { registerOfflineWorker } from '../../web/src/sw-register.ts';
import { MELEE_102 } from '../../lib/disc.ts';
import { VIEWER_ASSETS, parseSourceManifest, type SourceManifest } from '../../lib/hsd/source-protocol.ts';
import { createHash } from 'node:crypto';

// Validation-passing fixture: every VIEWER_ASSETS entry present, real v1.02 ids.
const manifest = (() => {
  let offset = 0;
  const files = [...VIEWER_ASSETS, 'PlCo.dat'].map((path) => {
    const size = path === 'PlCo.dat' ? 100 : 10;
    const entry = { path, offset, size };
    offset += size;
    return entry;
  });
  return {
    version: 1,
    mode: 'server',
    gameId: MELEE_102.gameId,
    revision: MELEE_102.discRevision,
    title: 'Fixture',
    discSize: offset,
    executableSha1: MELEE_102.mainDolSha1,
    files,
  } as unknown as SourceManifest;
})();

const offlineInit = (start: number, end: number): RequestInit => ({ headers: { Range: `bytes=${start}-${end}` } });

/** Minimal in-memory CacheStorage for manifest round-trips. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  return {
    async open(name: string) {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      const cache = store;
      return {
        async match(request: string) { return cache.get(String(request)); },
        async put(request: string, response: Response) { cache.set(String(request), response); },
        async keys() { return [...cache.keys()].map((url) => ({ url })); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
  };
}

describe('offline-first original data', () => {
  it('keys ranges by disc identity so offline bytes hash like online peers', () => {
    expect(rangeCacheKey('id', 'PlCo.dat', 0, 9)).toBe('id/PlCo.dat?start=0&end=9');
    expect(manifestIdentity(manifest)).toBe(`GALE01-${MELEE_102.mainDolSha1}-${manifest.discSize}-v1`);
  });
  it('persists the manifest for offline boot and drops it nowhere else', async () => {
    const caches = fakeCaches();
    expect(await loadCachedManifest(caches as unknown as CacheStorage)).toBeNull();
    await saveCachedManifest(manifest, caches as unknown as CacheStorage);
    expect(await loadCachedManifest(caches as unknown as CacheStorage)).toMatchObject({ gameId: 'GALE01', title: 'Fixture' });
  });
  it('serves seeded cache hits with no network (update = same bytes, zero download)', async () => {
    const identity = manifestIdentity(manifest);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const memory = new Map<string, Uint8Array>([[rangeCacheKey(identity, 'PlCo.dat', 0, 3), bytes]]);
    const store = {
      get: async (key: string) => memory.get(key),
      put: async () => {},
    };
    const failing = () => { throw new Error('offline: no network'); };
    const fetch = cachingFetcher(failing, store, manifest);
    const response = await fetch('/api/assets/PlCo.dat', offlineInit(0, 3));
    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
  it('reads downloaded ranges offline and names missing ones', async () => {
    const identity = manifestIdentity(manifest);
    const plCo = manifest.files.find((file) => file.path === 'PlCo.dat')!;
    const memory = new Map<string, Uint8Array>([[rangeCacheKey(identity, 'PlCo.dat', 0, 1), new Uint8Array([9, 9])]]);
    const reader = cachedDiscReader(manifest, {
      get: async (key: string) => memory.get(key),
      put: async () => {},
    });
    expect(await reader.read(plCo.offset, 2)).toEqual(new Uint8Array([9, 9]));
    await expect(reader.read(plCo.offset + 10, 4)).rejects.toThrow('Offline asset missing (PlCo.dat bytes 10-13)');
  });
  it('lists the files a partial stored copy lacks and words the miss for a host that streams nothing', async () => {
    const identity = manifestIdentity(manifest);
    const plCo = manifest.files.find((file) => file.path === 'PlCo.dat')!;
    const memory = new Map<string, Uint8Array>(manifest.files.filter((file) => file.path !== 'PlCo.dat').map((file) => [rangeCacheKey(identity, file.path, 0, file.size - 1), new Uint8Array(file.size)]));
    const store = { get: async (key: string) => memory.get(key), put: async () => {}, has: async (key: string) => memory.has(key) };
    expect(await storedCopyGaps(manifest, store)).toEqual(['PlCo.dat']);
    const reader = cachedDiscReader(manifest, store, { wholeFileLimit: Number.POSITIVE_INFINITY, missHint: 'Reload with your own disc.' });
    await expect(reader.read(plCo.offset, 4)).rejects.toThrow('Offline asset missing (PlCo.dat bytes 0-3). Reload with your own disc.');
    memory.set(rangeCacheKey(identity, 'PlCo.dat', 0, plCo.size - 1), new Uint8Array(plCo.size));
    expect(await storedCopyGaps(manifest, { get: store.get, put: store.put })).toEqual([]);
  });
  it('replays sub-ranges offline from whole-file downloads made by the online transport', async () => {
    // Online play caches small files whole (coalescing above the cache), so offline
    // reads of any sub-range must slice that entry instead of reporting a miss.
    const bytes = new Uint8Array(manifest.discSize).map((_, index) => index % 251);
    const origin = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === '/api/source') return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } });
      const path = decodeURIComponent(url.slice('/api/assets/'.length));
      const file = manifest.files.find((entry) => entry.path === path)!;
      const header = new Headers(init?.headers).get('Range');
      const [, start, end] = header ? /bytes=(\d+)-(\d+)/.exec(header)!.map(Number) : [0, 0, file.size - 1];
      const body = bytes.slice(file.offset + start!, file.offset + end! + 1);
      if (!header) return new Response(body, { status: 200, headers: { 'Content-Length': String(body.length) } });
      return new Response(body, { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': String(body.length) } });
    };
    const memory = new Map<string, Uint8Array>();
    const store = { get: async (key: string) => memory.get(key), put: async (key: string, value: Uint8Array) => { memory.set(key, value); } };
    const online = coalescingFetcher(cachingFetcher(origin, store));
    const connected = (await connectServerSource(online))!;
    const reader = serverDiscReader(connected.manifest, online);
    const plCo = manifest.files.find((file) => file.path === 'PlCo.dat')!;
    const live = await reader.read(plCo.offset + 10, 4);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(memory.has(rangeCacheKey(manifestIdentity(manifest), 'PlCo.dat', 0, plCo.size - 1))).toBe(true);
    expect(memory.has(rangeCacheKey(manifestIdentity(manifest), 'PlCo.dat', 10, 13))).toBe(false);
    const offline = cachedDiscReader(manifest, store);
    expect(await offline.read(plCo.offset + 10, 4)).toEqual(live);
    expect(await offline.read(plCo.offset + 90, 10)).toEqual(bytes.slice(plCo.offset + 90, plCo.offset + 100));
  });
  it('skips worker registration where workers cannot run', async () => {
    // Node has no serviceWorker: same path as file:// shells and plain http.
    expect(await registerOfflineWorker()).toBe('skipped');
  });
  it('removes stale workers instead of registering inside the native Android shell', async () => {
    const registered: string[] = [];
    let unregistered = 0;
    const scope = globalThis as { window?: unknown; navigator?: unknown; location?: unknown };
    const saved = { window: scope.window, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), location: scope.location };
    scope.window = { SmashPad: {} };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: {
      register: async (url: string) => { registered.push(url); return {}; },
      getRegistrations: async () => [{ unregister: async () => { unregistered++; return true; } }],
    } } });
    scope.location = { protocol: 'https:', hostname: 'play.example.org' };
    try {
      expect(await registerOfflineWorker()).toBe('skipped');
      expect(registered).toEqual([]);
      expect(unregistered).toBe(1);
    } finally {
      if (saved.window === undefined) delete scope.window; else scope.window = saved.window;
      if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else delete (globalThis as { navigator?: unknown }).navigator;
      if (saved.location === undefined) delete scope.location; else scope.location = saved.location;
    }
  });
  it('times out a hanging manifest instead of stalling boot forever', async () => {
    let calls = 0;
    const hanging = (_input: string, init?: RequestInit) => {
      calls++;
      return new Promise<never>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    };
    await expect(connectServerSource(hanging, undefined, { timeoutMs: 20, retries: 1 })).rejects.toThrow('did not answer within');
    expect(calls).toBe(2);
  });
  it('retries a flaky manifest fetch and keeps its specific errors', async () => {
    const json = () => Promise.resolve(manifest);
    const ok = (status = 200) => ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json,
    });
    let calls = 0;
    const flaky = () => (++calls === 1 ? Promise.reject(new TypeError('network down')) : Promise.resolve(ok()));
    const connected = await connectServerSource(flaky as never, undefined, { timeoutMs: 500, retries: 2 });
    expect(connected?.manifest.gameId).toBe('GALE01');
    expect(calls).toBe(2);
    const bad = () => Promise.resolve({ ...ok(), json: () => Promise.resolve({ bogus: true }) });
    await expect(connectServerSource(bad as never, undefined, { timeoutMs: 500, retries: 0 })).rejects.toThrow('The server manifest is unusable:');
    const missing = () => Promise.resolve({ status: 404, ok: false, headers: { get: () => null }, json });
    expect(await connectServerSource(missing as never)).toBeNull();
  });
  it('stops quietly on outer abort without retrying', async () => {
    let calls = 0;
    const controller = new AbortController();
    const hanging = () => {
      calls++;
      return new Promise<never>(() => {});
    };
    const pending = connectServerSource(hanging, controller.signal, { timeoutMs: 50, retries: 3 });
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('finds nothing to boot from before the first download', async () => {
    expect(cacheStorageStore({})).toBeNull();
    expect(await connectCachedSource()).toBeNull();
  });
});

describe('per-asset content hashes', () => {
  const discBytes = new Uint8Array(manifest.discSize).map((_, index) => (index * 7) % 253);
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  /** Same fixture with every file hashed; `discSize` bump = a different disc identity. */
  const hashed = (discSizeDelta = 0): SourceManifest => ({
    ...manifest, discSize: manifest.discSize + discSizeDelta,
    files: manifest.files.map((file) => ({ ...file, sha256: sha(discBytes.slice(file.offset, file.offset + file.size)) })),
  });
  function origin(served: SourceManifest, bytes = discBytes) {
    const requests: string[] = [];
    const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === '/api/source') return new Response(JSON.stringify(served), { headers: { 'Content-Type': 'application/json' } });
      const path = decodeURIComponent(url.slice('/api/assets/'.length));
      const file = served.files.find((entry) => entry.path === path)!;
      const header = new Headers(init?.headers).get('Range');
      const [, start, end] = header ? /bytes=(\d+)-(\d+)/.exec(header)!.map(Number) : [0, 0, file.size - 1];
      requests.push(`${path}:${start}-${end}`);
      const body = bytes.slice(file.offset + start!, file.offset + end! + 1);
      if (!header) return new Response(body, { status: 200, headers: { 'Content-Length': String(body.length) } });
      return new Response(body, { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': String(body.length) } });
    };
    return { fetcher, requests };
  }
  const memoryStore = () => {
    const map = new Map<string, Uint8Array>();
    return { map, get: async (key: string) => map.get(key), put: async (key: string, value: Uint8Array) => { map.set(key, value); }, delete: async (key: string) => { map.delete(key); } };
  };
  const plCo = manifest.files.find((file) => file.path === 'PlCo.dat')!;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('validates manifest hashes', () => {
    expect(() => parseSourceManifest(hashed())).not.toThrow();
    const bad = hashed(); bad.files[0] = { ...bad.files[0]!, sha256: 'ABC' };
    expect(() => parseSourceManifest(bad)).toThrow('Invalid asset entry');
  });
  it('stores hashed assets by content and reuses them after the disc identity changes', async () => {
    const store = memoryStore();
    const first = origin(hashed());
    const online = coalescingFetcher(cachingFetcher(first.fetcher, store));
    const connected = (await connectServerSource(online))!;
    const live = await serverDiscReader(connected.manifest, online).read(plCo.offset + 10, 4);
    await settle();
    const file = connected.manifest.files.find((entry) => entry.path === 'PlCo.dat')!;
    expect(store.map.has(contentCacheKey(file.sha256!, 0, plCo.size - 1))).toBe(true);
    expect([...store.map.keys()].some((key) => key.startsWith(`${manifestIdentity(manifest)}/`))).toBe(false);
    // New disc identity, identical PlCo.dat bytes: no network read for that asset.
    const second = origin(hashed(1));
    const next = coalescingFetcher(cachingFetcher(second.fetcher, store));
    const reconnected = (await connectServerSource(next))!;
    expect(manifestIdentity(reconnected.manifest)).not.toBe(manifestIdentity(connected.manifest));
    expect(await serverDiscReader(reconnected.manifest, next).read(plCo.offset + 10, 4)).toEqual(live);
    expect(second.requests).toEqual([]);
    expect(await cachedDiscReader(reconnected.manifest, store).read(plCo.offset + 90, 10)).toEqual(discBytes.slice(plCo.offset + 90, plCo.offset + 100));
  });
  it('migrates legacy identity entries to content keys instead of downloading again', async () => {
    const store = memoryStore(), served = hashed();
    const legacy = rangeCacheKey(manifestIdentity(served), 'PlCo.dat', 0, plCo.size - 1);
    store.map.set(legacy, discBytes.slice(plCo.offset, plCo.offset + plCo.size));
    const net = origin(served);
    const online = coalescingFetcher(cachingFetcher(net.fetcher, store));
    const connected = (await connectServerSource(online))!;
    await serverDiscReader(connected.manifest, online).read(plCo.offset, 8);
    await settle();
    expect(net.requests).toEqual([]);
    expect(store.map.has(legacy)).toBe(false);
    expect(store.map.has(contentCacheKey(served.files.find((file) => file.path === 'PlCo.dat')!.sha256!, 0, plCo.size - 1))).toBe(true);
  });
  it('refuses and never saves a whole-file download that fails its checksum', async () => {
    const store = memoryStore(), served = hashed();
    const corrupt = discBytes.slice(); corrupt[plCo.offset + 3] = (corrupt[plCo.offset + 3]! ^ 0xff) & 0xff;
    const online = coalescingFetcher(cachingFetcher(origin(served, corrupt).fetcher, store));
    const connected = (await connectServerSource(online))!;
    await expect(serverDiscReader(connected.manifest, online).read(plCo.offset, 8)).rejects.toThrow();
    await settle();
    expect([...store.map.keys()].filter((key) => key.startsWith('content/'))).toEqual([]);
  });
  it('prunes content entries the manifest no longer lists and other identities, keeping the current legacy cache', async () => {
    const stores = new Map<string, Map<string, Response>>();
    const caches = {
      async open(name: string) { let map = stores.get(name); if (!map) stores.set(name, map = new Map()); const cache = map;
        return { match: async (request: string) => cache.get(request), put: async (request: string, response: Response) => { cache.set(request, response); },
          delete: async (request: string | { url: string }) => cache.delete(typeof request === 'string' ? request : request.url),
          keys: async () => [...cache.keys()].map((url) => ({ url })) }; },
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    } as unknown as CacheStorage;
    const store = cacheStorageStore({ caches })!;
    const keep = 'a'.repeat(64), drop = 'b'.repeat(64);
    await store.put(contentCacheKey(keep, 0, 1), new Uint8Array(2));
    await store.put(contentCacheKey(drop, 0, 1), new Uint8Array(2));
    stores.set('smash-assets-old-identity', new Map());
    stores.set('smash-assets-current', new Map());
    await store.prune!(new Set([keep]), 'current');
    expect([...stores.keys()].sort()).toEqual(['smash-assets-content', 'smash-assets-current']);
    expect([...stores.get('smash-assets-content')!.keys()]).toEqual([`/__smash_asset_cache__/${contentCacheKey(keep, 0, 1)}`]);
  });
});
