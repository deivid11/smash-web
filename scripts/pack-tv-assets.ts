/** Personal-use offline asset packer for the FireTV/Android TV shell.
 *
 * Reads your local verified ISO (via private/disc-report.json) and extracts ONLY
 * the allowlisted runtime assets from lib/hsd/source-protocol.ts SERVER_ASSETS.
 * An explicit --out directory outside this repository is required. Extracted data
 * must remain a private personal backup, never a source or web-deployment artifact.
 *
 * Usage:
 *   npm run pack:tv-assets -- --out <private-external-directory> [--iso <path>]
 *
 * The TV WebView shell intercepts /api/source + /api/assets/* and serves these
 * local files, so the APK needs no LAN server for solo/local play. Online rooms
 * still need the trusted-LAN relay in server/rooms.ts. Personal backups only:
 * do not redistribute the pack or an APK containing it.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { privateOutputDirectory } from './private-output.ts';
import { verifyMeleeDisc, readExact } from '../lib/disc.ts';
import { SERVER_ASSETS } from '../lib/hsd/source-protocol.ts';
import { root } from './shared.ts';
import { openDisc } from './node-disc.ts';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const outDir = privateOutputDirectory(root, arg('--out'));
const isoOverride = arg('--iso');

const reportPath = join(root, 'private/disc-report.json');
const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
  input?: unknown;
  gameId?: unknown;
  revision?: unknown;
  dolSha1?: unknown;
  files?: { path: string; offset: number; size: number }[];
};
const isoPath = isoOverride ? resolve(isoOverride) : typeof report.input === 'string' ? resolve(root, report.input) : null;
if (!isoPath) throw new Error('Set --iso or run disc:import first (private/disc-report.json has no input).');
if (!Array.isArray(report.files) || report.files.length === 0) throw new Error('private/disc-report.json has no file index.');

console.log(`Packing ${SERVER_ASSETS.length} allowlisted assets (personal use only, no redistribution)...`);
console.log(`ISO: ${isoPath}`);
console.log(`Out: ${outDir}`);

const reader = await openDisc(isoPath);
try {
  const info = await verifyMeleeDisc(reader);
  console.log(`Verified ${info.gameId} rev ${info.revision} exe ${info.dolSha1}.`);
  const byPath = new Map(info.files.map((file) => [file.path, file]));
  // Cross-check the import-time index so a stale report cannot silently pack wrong bytes.
  const reportByPath = new Map((report.files ?? []).map((file) => [file.path, file]));
  let total = 0;
  const manifestFiles: { path: string; size: number; sha256: string }[] = [];
  const sums: string[] = [];
  await mkdir(join(outDir, 'files'), { recursive: true });
  for (const name of SERVER_ASSETS) {
    const live = byPath.get(name);
    const recorded = reportByPath.get(name);
    if (!live || !recorded) throw new Error(`Verified disc lacks allowlisted asset ${name}.`);
    if (live.offset !== recorded.offset || live.size !== recorded.size) {
      throw new Error(`Asset index mismatch for ${name}: re-run disc:import.`);
    }
    if (name.includes('\\') || name.includes('\0') || name.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error(`Unsafe asset name: ${name}.`);
    }
    const bytes = await readExact(reader, live.offset, live.size);
    const dest = join(outDir, 'files', name);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    manifestFiles.push({ path: name, size: live.size, sha256 });
    sums.push(`${sha256}  ${name}`);
    total += live.size;
    if (manifestFiles.length % 20 === 0 || manifestFiles.length === SERVER_ASSETS.length) {
      console.log(`  ${manifestFiles.length}/${SERVER_ASSETS.length}  ${(total / 1024 / 1024).toFixed(1)} MiB`);
    }
  }
  const manifest = {
    version: 1 as const,
    mode: 'tv-offline' as const,
    gameId: info.gameId,
    revision: info.revision,
    title: info.title,
    executableSha1: info.dolSha1,
    packedAt: new Date().toISOString(),
    files: manifestFiles,
  };
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(outDir, 'sha256sums.txt'), `${sums.join('\n')}\n`);
  await writeFile(
    join(outDir, 'pack-report.json'),
    `${JSON.stringify({ iso: isoPath, gameId: info.gameId, revision: info.revision, executableSha1: info.dolSha1, count: manifestFiles.length, totalBytes: total, totalMiB: total / 1024 / 1024 }, null, 2)}\n`,
  );
  await writeFile(
    join(outDir, 'PERSONAL_USE_ONLY.txt'),
    'Personal backup extracted from your own disc for your own FireTV. Do not redistribute this folder or any APK containing it.\n',
  );
  console.log(`Done: ${manifestFiles.length} files, ${(total / 1024 / 1024).toFixed(2)} MiB.`);
  console.log(`Manifest: ${join(outDir, 'manifest.json')}`);
  console.log('Keep this pack private. Any compatible offline shell integration is operator-specific; do not publish the pack or a bundled APK.');
} finally {
  await reader.close();
}
