// Client-disc mode: the player's own verified ISO (plus, optionally, their ACE 2.0 extension
// disc) read in the browser. The manifest is built exactly like the server's (same exposed
// names, order and rebased extension offsets), so the content fingerprint of a local disc
// equals the one a server streaming the same discs would produce. Disc bytes never leave
// the browser.
import { ACE_20, verifyAceDisc, verifyMeleeDisc, type DiscReader } from '../disc.ts';
import { HsdAssetSession } from './session.ts';
import { ACE_ASSETS, SERVER_ASSETS, aceDiscPath, type SourceFile, type SourceManifest } from './source-protocol.ts';
import { MANIFEST_CACHE, MANIFEST_REQUEST, manifestIdentity, rangeCacheKey, saveCachedManifest, type AssetStore } from './asset-fetch.ts';
import { readExact } from '../disc.ts';

export interface LocalSource { session: HsdAssetSession; manifest: SourceManifest; reader: DiscReader }
export async function openLocalSource(vanilla: DiscReader, ace?: DiscReader): Promise<LocalSource> {
  const info = await verifyMeleeDisc(vanilla);
  const files: SourceFile[] = SERVER_ASSETS.map((name) => {
    const file = info.files.find((file) => file.path === name);
    if (!file) throw new Error(`The verified disc lacks required asset ${name}.`);
    return { path: name, offset: file.offset, size: file.size };
  });
  let modded: SourceManifest['modded'];
  if (ace) {
    const aceInfo = await verifyAceDisc(ace);
    for (const name of ACE_ASSETS) {
      const file = aceInfo.files.find((file) => file.path === aceDiscPath(name));
      if (!file) throw new Error(`The ACE extension disc lacks required asset ${name}.`);
      files.push({ path: name, offset: info.discSize + file.offset, size: file.size });
    }
    modded = { id: ACE_20.id, executableSha1: aceInfo.dolSha1, discSize: aceInfo.discSize };
  }
  const base = info.discSize;
  const reader: DiscReader = {
    size: base + (modded?.discSize ?? 0),
    async read(offset, length) {
      // A single read never straddles both discs: every exposed entry lives fully on one side.
      if (offset >= base) { if (!ace) throw new Error('Disc read is outside the selected disc.'); return ace.read(offset - base, length); }
      if (offset + length > base) throw new Error('Merged disc read straddles the extension boundary.');
      return vanilla.read(offset, length);
    },
  };
  const manifest: SourceManifest = {
    version: 1, mode: 'server', gameId: info.gameId, revision: info.revision, title: info.title,
    discSize: reader.size, executableSha1: info.dolSha1, files, ...(modded ? { modded } : {}),
  };
  return { session: new HsdAssetSession(reader, manifest), manifest, reader };
}

/** Keeps a copy of the game files this project uses (a few hundred MB, not the disc image) in
 * the browser's own storage, so a reload boots from it instead of asking for the disc again.
 * Every file is stored whole under the same identity-keyed range key the cache-only reader
 * looks up (server-source.ts cachedDiscReader, with no whole-file size limit). The manifest is
 * saved LAST: an interrupted copy leaves no manifest, so the next visit simply asks again.
 * Nothing leaves the device; "Clear downloaded data" in Options removes the copy. */
export async function saveLocalCopy(source: LocalSource, store: AssetStore, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void; storage?: CacheStorage } = {}): Promise<boolean> {
  const identity = manifestIdentity(source.manifest), files = source.manifest.files;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  // An older manifest (an earlier, different or partial copy) must not vouch for this one mid-copy.
  try { await (await (options.storage ?? (globalThis as { caches?: CacheStorage }).caches)?.open(MANIFEST_CACHE))?.delete(MANIFEST_REQUEST); } catch { /* no Cache Storage: put() below reports it */ }
  let done = 0;
  for (const file of files) {
    if (options.signal?.aborted) return false;
    if (file.size > 0) await store.put(rangeCacheKey(identity, file.path, 0, file.size - 1), await readExact(source.reader, file.offset, file.size));
    done += file.size;
    options.onProgress?.(total ? done / total : 1);
    // Yield between files: this runs behind the menus and must never starve input or rendering.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (options.signal?.aborted) return false;
  await saveCachedManifest(source.manifest, options.storage);
  return true;
}
