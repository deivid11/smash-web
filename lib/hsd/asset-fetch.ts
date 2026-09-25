import { parseSourceManifest, servedAssets, type SourceFile, type SourceManifest } from './source-protocol.ts';

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
/** Persistent byte store for exposed asset ranges. Keys are namespaced: `content/<sha256>…`
 * for hashed assets, `<disc identity>/<path>…` otherwise (see {@link assetCacheKeys}). */
export interface AssetStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Optional: drop one entry (legacy entries after their content-key migration). */
  delete?(key: string): Promise<void>;
  /** True when the key is stored, without reading its bytes (completeness checks). */
  has?(key: string): Promise<boolean>;
  /** Optional: keep only content entries whose hash is listed, plus the given identity's legacy cache. */
  prune?(keepHashes: ReadonlySet<string>, identity: string): Promise<void>;
}

const ASSET_PREFIX = '/api/assets/';
const RANGE = /^bytes=(\d+)-(\d+)$/u;
/** Files at or below this size are downloaded once and sliced locally in play mode. */
/** Files up to this size download once whole and are sliced locally. It covers every fighter
 * animation bank (the largest is ~2.4 MB): above it, each clip was its own ranged request. */
export const WHOLE_FILE_LIMIT = 4 * 1024 * 1024;
export const ASSET_CACHE_PREFIX = 'smash-assets-';

function assetRequest(url: string, init?: RequestInit): { path: string; start: number; end: number } | null {
  if (!url.startsWith(ASSET_PREFIX) || (init?.method ?? 'GET') !== 'GET') return null;
  const match = RANGE.exec(new Headers(init?.headers).get('Range') ?? '');
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  let path: string;
  try { path = decodeURIComponent(url.slice(ASSET_PREFIX.length)); } catch { return null; }
  return { path, start, end };
}
/** Path of a whole-file asset GET (no Range header): the server may answer it compressed. */
function wholeAssetPath(url: string, init?: RequestInit): string | null {
  if (!url.startsWith(ASSET_PREFIX) || (init?.method ?? 'GET') !== 'GET' || new Headers(init?.headers).has('Range')) return null;
  try { return decodeURIComponent(url.slice(ASSET_PREFIX.length)); } catch { return null; }
}
/** Retries a request the server declined as busy (503, bounded concurrent ISO reads). */
async function withBusyRetry(send: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await send();
    if (response.status !== 503 || attempt >= 5) return response;
    await response.body?.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 200 * 2 ** attempt)));
  }
}
function partial(bytes: Uint8Array, start: number, end: number, size: number): Response {
  const body = bytes.slice(0);
  return new Response(body, { status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' } });
}
/** Learns the verified manifest from the same `/api/source` reply the reader consumes. */
function manifestLearner(next: Fetcher, onManifest: (manifest: SourceManifest) => void): Fetcher {
  return async (url, init) => {
    const response = await next(url, init);
    if (url === '/api/source' && response.ok && response.headers.get('content-type')?.includes('application/json')) {
      try { onManifest(parseSourceManifest(await response.clone().json())); } catch { /* The reader reports invalid manifests itself. */ }
    }
    return response;
  };
}
/** Deterministic identity of the served disc; every cache key and namespace derives from it.
 * A registered extension disc (ACE) changes the identity so its assets never collide with
 * vanilla-only caches. */
export function manifestIdentity(manifest: SourceManifest): string {
  const modded = manifest.modded ? `-${manifest.modded.id}-${manifest.modded.executableSha1}` : '';
  return `${manifest.gameId}-${manifest.executableSha1}-${manifest.discSize}-v${manifest.version}${modded}`;
}

/** Play-mode read coalescing: a small asset is fetched whole once (shared while in
 * flight), and each ranged read is answered from that copy as a normal 206 reply.
 * The choice depends only on the manifest size, never on timing or cache state, so
 * every peer still hashes the same per-range responses. Larger assets pass through. */
export function coalescingFetcher(next: Fetcher, options: { limit?: number; retain?: number; budget?: number } = {}): Fetcher {
  // `retain` bounds the file count and `budget` the bytes held (in flight or settled); the
  // most recent file always stays so a slice never re-downloads its own source.
  const limit = options.limit ?? WHOLE_FILE_LIMIT, retain = options.retain ?? 16, budget = options.budget ?? 32 * 1024 * 1024;
  let sizes = new Map<string, number>();
  const whole = new Map<string, Promise<Uint8Array>>();
  const settled = new Set<string>();
  const learner = manifestLearner(next, manifest => { sizes = new Map(servedAssets(manifest).map(file => [file.path, file.size])); whole.clear(); settled.clear(); });
  return async (url, init) => {
    const request = assetRequest(url, init), size = request ? sizes.get(request.path) : undefined;
    if (!request || size === undefined || size > limit || request.end >= size) return learner(url, init);
    let pending = whole.get(request.path);
    if (!pending) {
      const download: Promise<Uint8Array> = (async () => {
        // No Range header: the server may compress a whole file (fetch decodes it transparently).
        const headers = new Headers(init?.headers); headers.delete('Range');
        const response = await withBusyRetry(() => next(url, { ...init, headers }));
        if (response.status !== 200) throw new Error(`Whole asset download failed (${response.status}): ${request.path}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== size) throw new Error('Whole asset download was truncated.');
        return bytes;
      })();
      pending = download;
      whole.set(request.path, download);
      download.then(() => { if (whole.get(request.path) === download) settled.add(request.path); }, () => { if (whole.get(request.path) === download) whole.delete(request.path); });
      // Only settled files are evicted: dropping one still downloading would make its next
      // reader start a second download (prefetch-ahead keeps several in flight).
      let held = 0;
      for (const path of whole.keys()) held += sizes.get(path) ?? 0;
      for (const path of [...whole.keys()]) {
        if (whole.size <= 1 || (whole.size <= retain && held <= budget)) break;
        if (!settled.has(path) || path === request.path) continue;
        whole.delete(path); settled.delete(path); held -= sizes.get(path) ?? 0;
      }
    } else { whole.delete(request.path); whole.set(request.path, pending); }
    const bytes = await pending;
    return partial(bytes.subarray(request.start, request.end + 1), request.start, request.end, size);
  };
}

/** Offline whole-file transport for the bundled TV shell. Some Android WebView
 * builds never deliver an intercepted 206 reply whose range starts above zero
 * (the load fails with a network error even though the bytes are correct),
 * while start-at-zero 206s and full 200 bodies work. This transport therefore
 * never sends a ranged request: every file is downloaded whole once (shared
 * while in flight, bounded LRU) and each ranged read is answered locally with
 * a synthetic 206 built by {@link partial}. Bytes, statuses, headers and the
 * resulting content hashes are identical to the server's per-range replies,
 * so fingerprints and rollback hashes match LAN peers. It is only selected
 * when the page carries `<meta name="smash-offline">`; the LAN build keeps
 * using {@link coalescingFetcher} unchanged. */
export function offlineWholeFileFetcher(next: Fetcher, options: { retain?: number } = {}): Fetcher {
  const retain = options.retain ?? 8;
  let sizes = new Map<string, number>();
  const whole = new Map<string, Promise<Uint8Array>>();
  const learner = manifestLearner(next, manifest => { sizes = new Map(servedAssets(manifest).map(file => [file.path, file.size])); whole.clear(); });
  return async (url, init) => {
    const request = assetRequest(url, init), size = request ? sizes.get(request.path) : undefined;
    if (!request || size === undefined || request.end >= size) return learner(url, init);
    let pending = whole.get(request.path);
    if (!pending) {
      pending = (async () => {
        const headers = new Headers(init?.headers); headers.delete('Range');
        const response = await next(url, { ...init, headers });
        if (!response.ok || response.status !== 200) throw new Error(`Whole asset download failed (${response.status}): ${request.path}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== size) throw new Error('Whole asset download was truncated.');
        return bytes;
      })();
      whole.set(request.path, pending);
      pending.catch(() => whole.delete(request.path));
      while (whole.size > retain) whole.delete(whole.keys().next().value!);
    } else { whole.delete(request.path); whole.set(request.path, pending); }
    const bytes = await pending;
    return partial(bytes.subarray(request.start, request.end + 1), request.start, request.end, size);
  };
}
/** Legacy cache key for one ranged read, namespaced by disc identity. Shared by the
 * persistent fetchers and the offline cache-only reader so both address the same bytes. */
export function rangeCacheKey(identity: string, path: string, start: number, end: number): string {
  return `${identity}/${path}?start=${start}&end=${end}`;
}
/** Namespace of content-addressed asset entries (one cache shared by every disc identity). */
export const CONTENT_NAMESPACE = 'content';
export function contentCacheKey(sha256: string, start: number, end: number): string {
  return `${CONTENT_NAMESPACE}/${sha256}?start=${start}&end=${end}`;
}
/** Keys that may hold one read, preferred first. A hashed asset lives under its content key,
 * so an unchanged file is reused when the disc identity changes and only changed assets
 * download again; the identity key is the pre-hash layout, read for lazy migration. */
export function assetCacheKeys(identity: string, file: Pick<SourceFile, 'path' | 'sha256'>, start: number, end: number): string[] {
  const legacy = rangeCacheKey(identity, file.path, start, end);
  return file.sha256 ? [contentCacheKey(file.sha256, start, end), legacy] : [legacy];
}
/** True when `bytes` hash to `sha256`, or when Web Crypto is unavailable (plain-http LAN
 * origins): verification is best effort there, never a reason to refuse play. */
export async function matchesSha256(bytes: Uint8Array, sha256: string): Promise<boolean> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return true;
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes.slice(0)));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('') === sha256;
}

/** Persisted source manifest for offline boot (Cache Storage, one entry).
 * Cache Storage is already per-origin, so no origin is encoded. The manifest
 * carries sizes + the disc identity every cache key derives from. */
export const MANIFEST_CACHE = 'smash-manifest';
export const MANIFEST_REQUEST = '/__smash_manifest__/current';
export async function saveCachedManifest(manifest: SourceManifest, storage?: CacheStorage | undefined): Promise<void> {
  const caches = storage ?? (globalThis as { caches?: CacheStorage }).caches;
  if (!caches) return;
  try {
    const cache = await caches.open(MANIFEST_CACHE);
    await cache.put(MANIFEST_REQUEST, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* private mode: online play still works, offline boot will not */ }
}
export async function loadCachedManifest(storage?: CacheStorage | undefined): Promise<SourceManifest | null> {
  const caches = storage ?? (globalThis as { caches?: CacheStorage }).caches;
  if (!caches) return null;
  try {
    const cache = await caches.open(MANIFEST_CACHE);
    const match = await cache.match(MANIFEST_REQUEST);
    if (!match) return null;
    return parseSourceManifest(await match.json());
  } catch {
    return null;
  }
}
/** Persistent asset cache: successful ranged reads are stored (content-addressed when the
 * manifest hashes the file, else under the disc identity) and replayed as identical 206
 * replies. Whole-file downloads of hashed assets are verified before use. Legacy identity
 * entries are migrated to content keys on first read instead of downloading again, and
 * content entries no longer listed by the manifest are pruned. Misses fall through. */
export function cachingFetcher(next: Fetcher, store: AssetStore | null, seed?: SourceManifest | null): Fetcher {
  if (!store) return next;
  let identity: string | null = seed ? manifestIdentity(seed) : null;
  let files = new Map<string, SourceFile>(seed ? servedAssets(seed).map(file => [file.path, file]) : []);
  const learner = manifestLearner(next, manifest => {
    // Look files are cached by their served names and content hashes, so switching looks keeps both.
    identity = manifestIdentity(manifest); files = new Map(servedAssets(manifest).map(file => [file.path, file]));
    // Remember the manifest itself: offline boot re-seeds from it (see loadCachedManifest).
    void saveCachedManifest(manifest);
    const hashes = new Set(servedAssets(manifest).flatMap(file => file.sha256 ? [file.sha256] : []));
    if (hashes.size) void store.prune?.(hashes, identity).catch(() => undefined);
  });
  return async (url, init) => {
    // Ranged reads, or whole-file GETs without a Range (possibly compressed on the wire): both are
    // stored decoded under the same byte-range keys, so earlier caches keep hitting.
    const ranged = assetRequest(url, init), wholePath = ranged ? null : wholeAssetPath(url, init);
    const file = ranged ? files.get(ranged.path) : wholePath !== null ? files.get(wholePath) : undefined;
    if ((!ranged && wholePath === null) || identity === null || file === undefined) return learner(url, init);
    const size = file.size, request = ranged ?? { path: file.path, start: 0, end: size - 1 }, length = request.end - request.start + 1;
    const keys = assetCacheKeys(identity, file, request.start, request.end);
    for (const [index, key] of keys.entries()) {
      const hit = await store.get(key).catch(() => undefined);
      if (hit && hit.length === length) {
        if (index > 0) void store.put(keys[0]!, hit).then(() => store.delete?.(key)).catch(() => undefined);
        return ranged ? partial(hit, request.start, request.end, size)
          : new Response(hit.slice(0), { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(hit.byteLength) } });
      }
    }
    const response = await next(url, init);
    if (ranged ? response.status === 206 && response.headers.get('content-range') === `bytes ${request.start}-${request.end}/${size}` : response.status === 200) {
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      if (bytes.length === length) {
        if (file.sha256 && request.start === 0 && length === size && !(await matchesSha256(bytes, file.sha256))) {
          throw new Error(`Downloaded asset failed its checksum: ${file.path}. Retry; the corrupt copy was not saved.`);
        }
        void store.put(keys[0]!, bytes).catch(() => undefined);
      }
    }
    return response;
  };
}

/** Browser Cache Storage backend: one shared content-addressed cache plus one legacy cache
 * per disc identity (opening an identity drops other identities, never the content cache). */
export function cacheStorageStore(scope: { caches?: CacheStorage } = globalThis as { caches?: CacheStorage }): AssetStore | null {
  const storage = scope.caches;
  if (!storage) return null;
  const opened = new Map<string, Promise<Cache>>();
  const contentName = ASSET_CACHE_PREFIX + CONTENT_NAMESPACE;
  const cacheFor = (identity: string) => {
    let cache = opened.get(identity);
    if (!cache) {
      cache = (async () => {
        const name = ASSET_CACHE_PREFIX + identity;
        if (name !== contentName) {
          for (const other of await storage.keys()) if (other.startsWith(ASSET_CACHE_PREFIX) && other !== name && other !== contentName) await storage.delete(other);
        }
        return storage.open(name);
      })();
      opened.set(identity, cache);
    }
    return cache;
  };
  const split = (key: string) => { const slash = key.indexOf('/'); return { identity: key.slice(0, slash), request: `/__smash_asset_cache__/${key}` }; };
  return {
    async get(key) {
      const { identity, request } = split(key);
      const match = await (await cacheFor(identity)).match(request);
      return match ? new Uint8Array(await match.arrayBuffer()) : undefined;
    },
    async put(key, bytes) {
      const { identity, request } = split(key);
      await (await cacheFor(identity)).put(request, new Response(bytes.slice(0), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength) } }));
    },
    async has(key) {
      const { identity, request } = split(key);
      return (await (await cacheFor(identity)).match(request)) !== undefined;
    },
    async delete(key) {
      const { identity, request } = split(key);
      await (await cacheFor(identity)).delete(request);
    },
    async prune(keepHashes, identity) {
      for (const name of await storage.keys()) {
        if (name.startsWith(ASSET_CACHE_PREFIX) && name !== contentName && name !== ASSET_CACHE_PREFIX + identity) await storage.delete(name);
      }
      const content = await cacheFor(CONTENT_NAMESPACE);
      for (const entry of await content.keys()) {
        const hash = /\/content\/([0-9a-f]{64})\?/u.exec(typeof entry === 'string' ? entry : entry.url)?.[1];
        if (!hash || !keepHashes.has(hash)) await content.delete(entry);
      }
    },
  };
}
