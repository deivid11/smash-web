import type { DiscReader } from '../disc.ts';
import { HsdAssetSession } from './session.ts';
import { MAX_ASSET_RESPONSE_BYTES, applyLook, parseSourceManifest, type SourceFile, type SourceManifest } from './source-protocol.ts';
import { WHOLE_FILE_LIMIT, assetCacheKeys, cacheStorageStore, loadCachedManifest, manifestIdentity, type AssetStore } from './asset-fetch.ts';
import { lookModelPatch } from './looks.ts';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export function serverDiscReader(manifest: SourceManifest, fetcher: Fetcher = fetch): DiscReader {
  return {
    size: manifest.discSize,
    async read(offset, length) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > MAX_ASSET_RESPONSE_BYTES) {
        throw new Error('Invalid server asset read length.');
      }
      const file = manifest.files.find((file) => offset >= file.offset && offset - file.offset <= file.size && length <= file.size - (offset - file.offset));
      if (!file) throw new Error('The requested bytes are not part of an exposed viewer asset.');
      if (length === 0) return new Uint8Array();
      const start = offset - file.offset, end = start + length - 1;
      const request = () => fetcher(`/api/assets/${encodeURIComponent(file.asset ?? file.path)}`, {
        headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store', credentials: 'same-origin',
      });
      // The server bounds concurrent ISO reads and answers 503 when busy: back off and retry.
      let response = await request();
      for (let attempt = 0; response.status === 503 && attempt < 5; attempt++) {
        await response.body?.cancel().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 200 * 2 ** attempt)));
        response = await request();
      }
      if (response.status !== 206) throw new Error(`Server asset read failed (${response.status}): ${file.path}`);
      if (response.headers.get('content-range') !== `bytes ${start}-${end}/${file.size}` || response.headers.get('content-length') !== String(length)) {
        await response.body?.cancel();
        throw new Error('Server returned an unexpected asset byte range.');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== length) throw new Error('Server asset response was truncated.');
      return bytes;
    },
  };
}

/** Offline cache-only reader: serves previously downloaded ranges from the persistent
 * per-disc Cache Storage populated by cachingFetcher. Anything not downloaded yet
 * throws a miss error naming the asset, so the UI can ask for one online visit.
 * Identity-keyed exactly like the live path, so hashes match online peers.
 *
 * Online play stacks coalescingFetcher above the cache, so files up to the
 * whole-file limit are stored once under their whole-file range key, never under
 * each sub-range the reader asked for; those are sliced from that entry (kept in a
 * small LRU so one file is not re-read per range). Exact range keys (larger files,
 * or transports that cache below the slicing layer) are tried as well. */
export function cachedDiscReader(manifest: SourceManifest, store: AssetStore, options: { wholeFileLimit?: number; retain?: number; missHint?: string; identity?: string } = {}): DiscReader {
  // A look-applied manifest keeps the original disc's identity (its extended size is not an identity).
  const identity = options.identity ?? manifestIdentity(manifest);
  const limit = options.wholeFileLimit ?? WHOLE_FILE_LIMIT, retain = options.retain ?? 16;
  const whole = new Map<string, Promise<Uint8Array | undefined>>();
  // Content key first (hashed manifests), then the pre-hash identity key.
  const lookup = async (keys: readonly string[], length: number): Promise<Uint8Array | undefined> => {
    for (const key of keys) {
      const bytes = await store.get(key).catch(() => undefined);
      if (bytes && bytes.length === length) return bytes;
    }
    return undefined;
  };
  const wholeFile = (file: SourceFile): Promise<Uint8Array | undefined> => {
    const { path, size } = file;
    let pending = whole.get(path);
    if (pending) {
      whole.delete(path); whole.set(path, pending);
      return pending;
    }
    pending = lookup(assetCacheKeys(identity, file, 0, size - 1), size);
    whole.set(path, pending);
    void pending.then((bytes) => { if (!bytes) whole.delete(path); });
    while (whole.size > retain) whole.delete(whole.keys().next().value!);
    return pending;
  };
  return {
    size: manifest.discSize,
    async read(offset, length) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > MAX_ASSET_RESPONSE_BYTES) {
        throw new Error('Invalid cached asset read length.');
      }
      const file = manifest.files.find((file) => offset >= file.offset && offset - file.offset <= file.size && length <= file.size - (offset - file.offset));
      if (!file) throw new Error('The requested bytes are not part of an exposed viewer asset.');
      if (length === 0) return new Uint8Array();
      const start = offset - file.offset, end = start + length - 1;
      if (file.size <= limit) {
        const bytes = await wholeFile(file);
        if (bytes) return bytes.slice(start, end + 1);
      }
      const hit = await lookup(assetCacheKeys(identity, file, start, end), length);
      if (!hit) {
        throw new Error(`Offline asset missing (${file.path} bytes ${start}-${end}). ${options.missHint ?? 'Connect once to download game data, then play offline.'}`);
      }
      return hit;
    },
  };
}

/** Offline boot from the persisted manifest + downloaded ranges. Returns null when
 * nothing was ever downloaded (first visit must be online). Never touches network. */
/** Files of the manifest that have no whole-file entry in the store. A copy saved from the
 * player's own disc has none; data downloaded on demand from a streaming host is partial,
 * and a host that no longer streams can only complete it from the player's disc. */
export async function storedCopyGaps(manifest: SourceManifest, store: AssetStore): Promise<string[]> {
  const identity = manifestIdentity(manifest), gaps: string[] = [];
  for (const file of manifest.files) {
    if (file.size === 0) continue;
    let found = false;
    for (const key of assetCacheKeys(identity, file, 0, file.size - 1)) {
      if (await (store.has ? store.has(key) : store.get(key).then((bytes) => bytes !== undefined)).catch(() => false)) { found = true; break; }
    }
    if (!found) gaps.push(file.path);
  }
  return gaps;
}

/** Chooses a look (or null) from the manifest's offered looks; see web/src/play/look-setting.ts. */
export type LookChooser = (manifest: SourceManifest) => string | null;
/** A connected source: `manifest` is always the original disc table (identity, fingerprints,
 * caches); the session reads through `look` when one was chosen and offered. */
export interface ConnectedSource { session: HsdAssetSession; manifest: SourceManifest; look: string | null }
/** Only looks this build pins (lib/hsd/looks.ts) are applied: their neutralizing patch must be known. */
function chosenLook(manifest: SourceManifest, choose?: LookChooser): string | null {
  const id = choose?.(manifest) ?? null;
  return id !== null && manifest.looks?.some((look) => look.id === id) && lookModelPatch(id) ? id : null;
}
/** A session over `manifest` with look `look` applied (or the plain disc). */
function lookSession(reader: DiscReader, manifest: SourceManifest, look: string | null): HsdAssetSession {
  return new HsdAssetSession(reader, manifest, look === null ? undefined : lookModelPatch(look));
}

export async function connectCachedSource(options: { wholeFileLimit?: number; missHint?: string; look?: LookChooser } = {}): Promise<ConnectedSource | null> {
  const store = cacheStorageStore();
  if (!store) return null;
  const manifest = await loadCachedManifest();
  if (!manifest) return null;
  const look = chosenLook(manifest, options.look), read = applyLook(manifest, look);
  return { session: lookSession(cachedDiscReader(read, store, { ...options, identity: manifestIdentity(manifest) }), read, look), manifest, look };
}

/** Options for the source handshake. The manifest fetch is the one request boot
 * cannot proceed without, so it gets its own deadline + retries instead of
 * hanging the loading screen forever when the server stalls mid-reply. */
export interface SourceConnectOptions {
  /** Per-attempt deadline in ms (default 15000). */
  timeoutMs?: number;
  /** Extra attempts after the first (default 2). */
  retries?: number;
  /** Picks one of the manifest's cosmetic looks for this session (default: none). */
  look?: LookChooser;
}
const DEFAULT_SOURCE_TIMEOUT_MS = 15000;
const DEFAULT_SOURCE_RETRIES = 2;

/** A static-only build has no API and continues to offer the local file picker. */
export async function connectServerSource(fetcher: Fetcher = fetch, signal?: AbortSignal, options: SourceConnectOptions = {}): Promise<ConnectedSource | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_SOURCE_RETRIES;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Outer abort (dispose/reset) is not a server failure: stop quietly.
    if (signal?.aborted) throw new DOMException('Source request aborted.', 'AbortError');
    const attemptController = new AbortController();
    const timer = setTimeout(() => attemptController.abort(), timeoutMs);
    let onAbort: (() => void) | null = null;
    // The deadline is raced explicitly: a hung server (or a fetcher ignoring
    // abort signals) must never stall boot past timeoutMs.
    const outcome = await Promise.race([
      fetcher('/api/source', { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin', signal: attemptController.signal }).then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      ),
      new Promise<{ timeout: true }>((resolve) => setTimeout(() => resolve({ timeout: true }), timeoutMs)),
      new Promise<{ aborted: true }>((resolve) => {
        onAbort = () => resolve({ aborted: true });
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if ('aborted' in outcome) throw new DOMException('Source request aborted.', 'AbortError');
    if ('timeout' in outcome || 'error' in outcome) {
      lastError = 'timeout' in outcome ? new DOMException('The operation timed out.', 'AbortError') : outcome.error;
      attemptController.abort();
      if (attempt === retries) throw timeoutError(lastError, timeoutMs, attempt);
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)));
      continue;
    }
    const response = outcome.response;
    if (response.status === 404 || (response.ok && !response.headers.get('content-type')?.includes('application/json'))) return null;
    if (!response.ok) throw new Error(`The server disc is unavailable (HTTP ${response.status}).`);
    try {
      const manifest = parseSourceManifest(await response.json());
      const look = chosenLook(manifest, options.look), read = applyLook(manifest, look);
      return { session: lookSession(serverDiscReader(read, fetcher), read, look), manifest, look };
    } catch (error) {
      // Name the manifest as the culprit (with its own message) instead of a
      // generic load failure: mismatched/partial manifests are otherwise silent.
      throw new Error(`The server manifest is unusable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw timeoutError(lastError, timeoutMs, retries);
}
function timeoutError(error: unknown, timeoutMs: number, attempt: number): Error {
  if (error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))) {
    return new Error(`The game source did not answer within ${timeoutMs / 1000}s (attempt ${attempt + 1}). Check the server and retry.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
