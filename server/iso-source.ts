import { verifyMeleeDisc, verifyAceDisc, readExact, ACE_20 } from '../lib/disc.ts';
import { MAX_ASSET_RESPONSE_BYTES, SERVER_ASSETS, ACE_ASSETS, aceDiscPath, type SourceManifest } from '../lib/hsd/source-protocol.ts';
import { openDisc } from '../scripts/node-disc.ts';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface IsoSource {
  readonly manifest: SourceManifest;
  read(name: string, start: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Opens the verified vanilla disc, plus (optionally) the ACE 2.0 extension disc whose
 * only exposed assets are the ACE_ASSETS names. Vanilla reads never touch the mod disc. */
export async function openIsoSource(path: string, acePath?: string): Promise<IsoSource> {
  const disc = await openDisc(path);
  let ace: Awaited<ReturnType<typeof openDisc>> | null = null;
  try {
    const info = await verifyMeleeDisc(disc);
    const files = SERVER_ASSETS.map((name) => {
      const file = info.files.find((file) => file.path === name);
      if (!file) throw new Error(`The verified disc lacks required viewer asset ${name}.`);
      return { ...file, ace: false };
    });
    let modded: SourceManifest['modded'];
    if (acePath) {
      ace = await openDisc(acePath);
      const aceInfo = await verifyAceDisc(ace);
      for (const name of ACE_ASSETS) {
        const file = aceInfo.files.find((file) => file.path === aceDiscPath(name));
        if (!file) throw new Error(`The ACE extension disc lacks required asset ${name}.`);
        // Extension entries live past the vanilla disc in the manifest's flat address space.
        files.push({ path: name, offset: info.discSize + file.offset, size: file.size, ace: true });
      }
      modded = { id: ACE_20.id, executableSha1: aceInfo.dolSha1, discSize: aceInfo.discSize };
    }
    const aceReader = ace;
    const hashes = await assetHashes(path, acePath, files, (file) => file.ace
      ? readExact(aceReader!, file.offset - info.discSize, file.size)
      : readExact(disc, file.offset, file.size));
    const manifest: SourceManifest = {
      version: 1, mode: 'server', gameId: info.gameId, revision: info.revision, title: info.title,
      discSize: info.discSize + (modded?.discSize ?? 0), executableSha1: info.dolSha1,
      files: files.map(({ ace: _ace, ...entry }) => ({ ...entry, sha256: hashes.get(entry.path)! })), ...(modded ? { modded } : {}),
    };
    return {
      manifest,
      close: async () => { await disc.close(); await aceReader?.close(); },
      async read(name, start, length) {
        const file = files.find((file) => file.path === name);
        if (!file || !Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 ||
            length > MAX_ASSET_RESPONSE_BYTES || start > file.size || length > file.size - start) {
          throw new Error('Asset read is outside the approved ISO ranges.');
        }
        if (file.ace) return readExact(aceReader!, file.offset - info.discSize + start, length);
        return readExact(disc, file.offset + start, length);
      },
    };
  } catch (error) { await disc.close(); await ace?.close(); throw error; }
}

/** Per-asset SHA-256 for the manifest (content-addressed client caches). Hashing the
 * ~350 MB of exposed files takes seconds, so results persist in a sidecar next to the
 * ISO, keyed by both discs' path + size + mtime; any change rehashes everything. A
 * sidecar that cannot be read or written only costs the rehash, never the boot. */
async function assetHashes(
  isoPath: string, acePath: string | undefined, files: readonly { path: string; offset: number; size: number }[],
  read: (file: { path: string; offset: number; size: number; ace: boolean }) => Promise<Uint8Array>,
): Promise<Map<string, string>> {
  const signature = async (file: string | undefined) => {
    if (!file) return null;
    const info = await stat(file);
    return { name: basename(file), size: info.size, mtimeMs: Math.round(info.mtimeMs) };
  };
  const key = JSON.stringify({ v: 1, iso: await signature(isoPath), ace: await signature(acePath), files: files.map((file) => [file.path, file.offset, file.size]) });
  const sidecar = join(dirname(isoPath), '.smash-asset-sha256.json');
  try {
    const cached = JSON.parse(await readFile(sidecar, 'utf8')) as { key?: string; hashes?: Record<string, string> };
    if (cached.key === key && cached.hashes && files.every((file) => /^[0-9a-f]{64}$/u.test(cached.hashes![file.path] ?? ''))) {
      return new Map(files.map((file) => [file.path, cached.hashes![file.path]!]));
    }
  } catch { /* first boot or unreadable sidecar: hash below */ }
  const hashes = new Map<string, string>();
  for (const file of files as readonly { path: string; offset: number; size: number; ace: boolean }[]) {
    hashes.set(file.path, createHash('sha256').update(await read(file)).digest('hex'));
  }
  try {
    const temp = `${sidecar}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ key, hashes: Object.fromEntries(hashes) }));
    await rename(temp, sidecar);
  } catch { /* read-only disc folder: hashes still serve this process */ }
  return hashes;
}
