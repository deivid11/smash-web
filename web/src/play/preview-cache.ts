/** Phase 2.2 — menu preview cache. Rendered portraits are runtime thumbnails
 * of already-loaded original models (never published assets). They persist in
 * CacheStorage keyed by disc fingerprint + capture version, so a warm boot
 * skips `captureMenuPreviews` entirely. All storage access is best-effort:
 * denial or absence falls back to a cold capture. */
export interface PreviewCacheData {
  portraits: Record<string, string>;
  itemPortraits: Record<string, string>;
  stagePreviews: Record<string, string>;
}

/** Bump when the capture framing/rendering changes, invalidating old entries. */
export const PREVIEW_CACHE_VERSION = 7;
const CACHE_NAME = 'smash-web-previews-v1';

export function previewCacheKey(discFingerprint: string): string {
  return `previews/v${PREVIEW_CACHE_VERSION}/${discFingerprint}`;
}

/** Read-through is async via the global caches object (may be absent off HTTPS). */
export async function readPreviewCache(discFingerprint: string): Promise<PreviewCacheData | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(previewCacheKey(discFingerprint));
    if (!response) return null;
    const data = (await response.json()) as Partial<PreviewCacheData>;
    if (!data || typeof data !== 'object' || !data.portraits || !data.stagePreviews) return null;
    // An entry with no portraits is a stale poison write, not a warm cache:
    // miss so the caller recaptures instead of showing an empty grid forever.
    if (!Object.keys(data.portraits).length) return null;
    return {
      portraits: data.portraits,
      itemPortraits: data.itemPortraits ?? {},
      stagePreviews: data.stagePreviews,
    };
  } catch {
    return null;
  }
}

export async function writePreviewCache(discFingerprint: string, data: PreviewCacheData): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      previewCacheKey(discFingerprint),
      new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }),
    );
  } catch {
    /* Quota or private mode: cold capture next boot. */
  }
}
