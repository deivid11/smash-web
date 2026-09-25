import { verifyMeleeDisc, verifyAceDisc, readExact, ACE_20 } from '../lib/disc.ts';
import { MAX_ASSET_RESPONSE_BYTES, SERVER_ASSETS, ACE_ASSETS, aceDiscPath, lookAssetName, type SourceLook, type SourceManifest } from '../lib/hsd/source-protocol.ts';
import { LOOKS } from '../lib/hsd/looks.ts';
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
 * only exposed assets are the ACE_ASSETS names, and (optionally) a cosmetic look disc whose
 * only exposed assets are the pinned files of a known look (lib/hsd/looks.ts), served as
 * `look/<id>/<path>`. Vanilla reads never touch either mod disc. */
export async function openIsoSource(path: string, acePath?: string, lookPath?: string): Promise<IsoSource> {
  const disc = await openDisc(path);
  let ace: Awaited<ReturnType<typeof openDisc>> | null = null;
  let lookDisc: Awaited<ReturnType<typeof openDisc>> | null = null;
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
    let look: SourceLook | undefined;
    if (lookPath) {
      lookDisc = await openDisc(lookPath);
      // A look disc is the same NTSC 1.02 game with some data files replaced (identical executable).
      const lookInfo = await verifyMeleeDisc(lookDisc), lookReader = lookDisc;
      const candidates = [...new Set(LOOKS.flatMap((definition) => Object.keys(definition.files)))]
        .flatMap((name) => { const file = lookInfo.files.find((entry) => entry.path === name); return file ? [{ ...file, ace: false }] : []; });
      const lookHashes = await assetHashes(lookPath, undefined, candidates, (file) => readExact(lookReader, file.offset, file.size), '.smash-look-sha256.json');
      // Serve only files whose original bytes and look bytes both match a known look's pins.
      const best = LOOKS.map((definition) => ({ definition, files: candidates.filter((file) => {
        const pin = definition.files[file.path];
        return pin !== undefined && hashes.get(file.path) === pin[0] && lookHashes.get(file.path) === pin[1];
      }) })).sort((a, b) => b.files.length - a.files.length)[0];
      if (!best?.files.length) throw new Error('The look disc matches no known look (lib/hsd/looks.ts) over this original disc.');
      look = { id: best.definition.id, name: best.definition.name, discSize: lookInfo.discSize,
        files: best.files.map((file) => ({ path: file.path, offset: file.offset, size: file.size, sha256: lookHashes.get(file.path)! })) };
    }
    const manifest: SourceManifest = {
      version: 1, mode: 'server', gameId: info.gameId, revision: info.revision, title: info.title,
      discSize: info.discSize + (modded?.discSize ?? 0), executableSha1: info.dolSha1,
      files: files.map(({ ace: _ace, ...entry }) => ({ ...entry, sha256: hashes.get(entry.path)! })), ...(modded ? { modded } : {}),
      ...(look ? { looks: [look] } : {}),
    };
    const lookFiles = new Map((look?.files ?? []).map((file) => [lookAssetName(look!.id, file.path), file]));
    const lookReader = lookDisc;
    return {
      manifest,
      close: async () => { await disc.close(); await aceReader?.close(); await lookReader?.close(); },
      async read(name, start, length) {
        const lookFile = lookFiles.get(name);
        if (lookFile) {
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 ||
              length > MAX_ASSET_RESPONSE_BYTES || start > lookFile.size || length > lookFile.size - start) {
            throw new Error('Asset read is outside the approved ISO ranges.');
          }
          return readExact(lookReader!, lookFile.offset + start, length);
        }
        const file = files.find((file) => file.path === name);
        if (!file || !Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 ||
            length > MAX_ASSET_RESPONSE_BYTES || start > file.size || length > file.size - start) {
          throw new Error('Asset read is outside the approved ISO ranges.');
        }
        if (file.ace) return readExact(aceReader!, file.offset - info.discSize + start, length);
        return readExact(disc, file.offset + start, length);
      },
    };
  } catch (error) { await disc.close(); await ace?.close(); await lookDisc?.close(); throw error; }
}

/** Per-asset SHA-256 for the manifest (content-addressed client caches). Hashing the
 * ~350 MB of exposed files takes seconds, so results persist in a sidecar next to the
 * ISO, keyed by both discs' path + size + mtime; any change rehashes everything. A
 * sidecar that cannot be read or written only costs the rehash, never the boot. */
async function assetHashes(
  isoPath: string, acePath: string | undefined, files: readonly { path: string; offset: number; size: number }[],
  read: (file: { path: string; offset: number; size: number; ace: boolean }) => Promise<Uint8Array>,
  sidecarName = '.smash-asset-sha256.json',
): Promise<Map<string, string>> {
  const signature = async (file: string | undefined) => {
    if (!file) return null;
    const info = await stat(file);
    return { name: basename(file), size: info.size, mtimeMs: Math.round(info.mtimeMs) };
  };
  const key = JSON.stringify({ v: 1, iso: await signature(isoPath), ace: await signature(acePath), files: files.map((file) => [file.path, file.offset, file.size]) });
  const sidecar = join(dirname(isoPath), sidecarName);
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
