import { afterEach, describe, expect, it } from 'vitest';
import { clearDownloadedData, downloadedDataStatus, formatBytes } from '../../web/src/offline-cache.ts';

function fakeCaches(names: string[]) {
  const live = new Set(names);
  return {
    keys: async () => [...live],
    open: async () => ({ match: async () => null, put: async () => {} }),
    delete: async (name: string) => live.delete(name),
  };
}

describe('downloaded-data storage controls', () => {
  const previous = (globalThis as { caches?: unknown }).caches;
  afterEach(() => {
    if (previous === undefined) delete (globalThis as { caches?: unknown }).caches;
    else (globalThis as { caches?: unknown }).caches = previous;
  });
  it('reports empty when no cache API exists', async () => {
    delete (globalThis as { caches?: unknown }).caches;
    expect(await downloadedDataStatus()).toEqual({ caches: [], estimatedBytes: null });
    expect(await clearDownloadedData()).toEqual([]);
  });
  it('lists only game-data caches and clears exactly those', async () => {
    (globalThis as { caches?: unknown }).caches = fakeCaches([
      'smash-assets-GALE01-abc',
      'smash-manifest',
      'smash-shell-v1',
      'smash-web-previews-v1',
      'other-framework-cache',
    ]) as unknown as CacheStorage;
    expect((await downloadedDataStatus()).caches).toEqual([
      'smash-assets-GALE01-abc',
      'smash-manifest',
      'smash-shell-v1',
      'smash-web-previews-v1',
    ]);
    const removed = await clearDownloadedData();
    expect(removed).toHaveLength(4);
    expect((await downloadedDataStatus()).caches).toEqual([]);
  });
  it('formats byte counts for the status line', () => {
    expect(formatBytes(null)).toBe('unknown size');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
