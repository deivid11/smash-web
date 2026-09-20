import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { root } from './shared.ts';
import { ANDROID_SHELL_API, WEB_BUNDLE_MANIFEST } from '../web/src/android-bridge.ts';

/** Writes `web-bundle.json` into an Android web build (default dist-android/): the
 * versioned, per-file-hashed description of the game code (HTML/JS/CSS/WASM) that the
 * APK packages and the host's web channel publishes. The shell serves exactly the
 * listed paths from the newest compatible bundle, so a JS-only change reaches phones
 * without reinstalling the app (docs/ANDROID.md). Source maps stay out: they are not
 * needed to run the game and would dominate every download. */
const dist = resolve(root, process.argv[2] ?? 'dist-android');
const files: Record<string, { sha256: string; size: number }> = {};

async function walk(directory: string): Promise<void> {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) { await walk(full); continue; }
    if (!entry.isFile() || entry.name.endsWith('.map') || full === join(dist, WEB_BUNDLE_MANIFEST)) continue;
    const path = `/${relative(dist, full).split(sep).join('/')}`;
    if (!/^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/u.test(path)) throw new Error(`Unsupported bundle path: ${path}`);
    const bytes = await readFile(full);
    files[path] = { sha256: createHash('sha256').update(bytes).digest('hex'), size: (await stat(full)).size };
  }
}

await walk(dist);
if (!files['/play.html']) throw new Error(`${dist} has no play.html; build the Android web bundle first.`);
const now = new Date();
const pad = (value: number) => String(value).padStart(2, '0');
const manifest = {
  // Seconds, so a bundle published minutes after an APK build still compares newer.
  version: Math.floor(now.getTime() / 1000),
  label: `${now.getUTCFullYear()}.${pad(now.getUTCMonth() + 1)}.${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`,
  shellApi: ANDROID_SHELL_API,
  files,
};
await writeFile(join(dist, WEB_BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 1)}\n`);
const total = Object.values(files).reduce((sum, file) => sum + file.size, 0);
console.log(`Web bundle ${manifest.label} (v${manifest.version}, shell API ${manifest.shellApi}): ${Object.keys(files).length} files, ${(total / 1048576).toFixed(1)} MB.`);
