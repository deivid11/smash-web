/** Downloaded-data storage: inspect and clear what offline play persists.
 *
 * Offline play keeps three Cache Storage families (never the ISO itself):
 * - `smash-assets-*`: downloaded original-data ranges, one cache per disc
 *   identity (lib/hsd/asset-fetch.ts). Re-downloaded only on server update.
 * - `smash-manifest`: the persisted source manifest that lets boot seed
 *   sizes/identity with no network.
 * - `smash-shell-*`: the service-worker app shell (web/public/sw.js).
 * - `smash-web-previews-v1`: rendered menu thumbnails (portraits, previews).
 * Everything is best-effort: absence just means cold boot / re-download. */
export interface DownloadedDataStatus {
  caches: string[];
  estimatedBytes: number | null;
}

const DATA_PREFIXES = ['smash-assets-', 'smash-manifest', 'smash-shell-', 'smash-web-previews-v1'];

function storage(): CacheStorage | null {
  try {
    return typeof caches !== 'undefined' ? caches : null;
  } catch {
    return null;
  }
}

export async function downloadedDataStatus(): Promise<DownloadedDataStatus> {
  const caches = storage();
  if (!caches) return { caches: [], estimatedBytes: null };
  let names: string[] = [];
  try {
    names = (await caches.keys()).filter((name) => DATA_PREFIXES.some((prefix) => name.startsWith(prefix)));
  } catch {
    return { caches: [], estimatedBytes: null };
  }
  let estimatedBytes: number | null = null;
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (estimate && Number.isFinite(estimate.usage)) estimatedBytes = Math.max(0, Math.round(estimate.usage!));
  } catch { /* estimate is informational only */ }
  // Origin-wide usage (all site data, not just game downloads): informational.
  return { caches: names, estimatedBytes };
}

/** Delete every downloaded-data cache. Returns the removed cache names.
 * The game re-downloads on next online boot; offline play is unavailable
 * until then. Never throws. */
export async function clearDownloadedData(): Promise<string[]> {
  const caches = storage();
  if (!caches) return [];
  let names: string[] = [];
  try {
    names = (await caches.keys()).filter((name) => DATA_PREFIXES.some((prefix) => name.startsWith(prefix)));
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    try {
      if (await caches.delete(name)) removed.push(name);
    } catch { /* keep deleting the rest */ }
  }
  return removed;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
