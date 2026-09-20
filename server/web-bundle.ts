import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** Android game-code channel derived from the deployed website build.
 *
 * The APK serves its game code from the newest compatible "web bundle"
 * (android/app/src/main/java/dev/smashweb/play/WebBundles.java). Deriving that bundle
 * from the static root the server already serves means every website deploy — by any
 * script, agent or person — reaches installed apps without a separate publish step.
 * The manifest matches scripts/web-bundle-manifest.ts: `version` is play.html's build
 * time in seconds (rsync preserves it, so rebuilds always compare newer), `shellApi`
 * comes from the `smash-shell-api` meta the Vite config stamps into play.html, and each
 * file is addressed by its SHA-256. Source maps and symlinks are never included. */
export interface SiteWebBundle {
  readonly version: number;
  readonly json: Buffer;
  /** sha256 → absolute file path inside the static root. */
  readonly objects: ReadonlyMap<string, string>;
}

const MAX_FILES = 4096;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const BUNDLE_PATH = /^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/u;
const SHELL_API_META = /<meta name="smash-shell-api" content="(\d{1,4})">/u;

async function buildBundle(root: string, playMtimeMs: number): Promise<SiteWebBundle> {
  const files: Record<string, { sha256: string; size: number }> = {};
  const objects = new Map<string, string>();
  let count = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.isFile() || entry.name.endsWith('.map') || entry.name === 'web-bundle.json') continue;
      const path = `/${relative(root, full).split(sep).join('/')}`;
      if (!BUNDLE_PATH.test(path)) continue;
      if (++count > MAX_FILES) throw new Error('Website build has too many files for a web bundle.');
      const bytes = await readFile(full);
      if (bytes.length > MAX_FILE_BYTES) continue;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      files[path] = { sha256, size: bytes.length };
      objects.set(sha256, full);
    }
  };
  await walk(root);
  const html = await readFile(join(root, 'play.html'), 'utf8');
  const shellApi = Number(SHELL_API_META.exec(html)?.[1] ?? 1);
  const built = new Date(playMtimeMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  const label = `${built.getUTCFullYear()}.${pad(built.getUTCMonth() + 1)}.${pad(built.getUTCDate())}-${pad(built.getUTCHours())}${pad(built.getUTCMinutes())}`;
  const version = Math.floor(playMtimeMs / 1000);
  return { version, objects, json: Buffer.from(JSON.stringify({ version, label, shellApi, source: 'site', files })) };
}

/** Returns a reader for the current site bundle: rebuilt only when play.html changes
 * (every Vite build rewrites it), shared while a rebuild is in flight, null without a
 * deployed play.html. */
export function siteWebBundle(staticRoot: string): () => Promise<SiteWebBundle | null> {
  let cached: { key: string; bundle: SiteWebBundle } | null = null;
  let pending: { key: string; promise: Promise<SiteWebBundle | null> } | null = null;
  return async () => {
    let root: string;
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      root = await realpath(staticRoot);
      info = await stat(join(root, 'play.html'));
    } catch {
      return null;
    }
    if (!info.isFile()) return null;
    const key = `${root}:${info.size}:${info.mtimeMs}`;
    if (cached?.key === key) return cached.bundle;
    if (pending?.key !== key) {
      const promise = buildBundle(root, info.mtimeMs).then(
        (bundle) => { cached = { key, bundle }; return bundle; },
        () => null,
      );
      pending = { key, promise };
      void promise.finally(() => { if (pending?.promise === promise) pending = null; });
    }
    return pending.promise;
  };
}
