import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createMeleeServer } from '../../server/http.ts';
import { sourceFixture } from './source-fixture.ts';
import type { IsoSource } from '../../server/iso-source.ts';

let directory: string;
const servers: Server[] = [];
async function listen(androidDir?: string, staticRoot = join(directory, 'web')): Promise<string> {
  const source: IsoSource = { manifest: sourceFixture(), read: async (_name, _start, length) => new Uint8Array(length), close: async () => {} };
  const server = await createMeleeServer({ source, staticRoot, androidDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
beforeAll(async () => {
  const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
  await mkdir(parent, { recursive: true });
  directory = await mkdtemp(join(parent, 'android-release-tests-'));
  await mkdir(join(directory, 'web'), { recursive: true });
  await writeFile(join(directory, 'web', 'play.html'), '<html><head></head><body>Play</body></html>');
  await mkdir(join(directory, 'android'), { recursive: true });
  await writeFile(join(directory, 'android', 'latest.json'), JSON.stringify({ versionCode: 42, apk: 'smash-web-42.apk' }));
  await writeFile(join(directory, 'android', 'smash-web-42.apk'), Buffer.alloc(300_000, 7));
  await mkdir(join(directory, 'android', 'web', 'objects'), { recursive: true });
  // Far-future version: a manually published bundle only wins while it is newer than the site build.
  await writeFile(join(directory, 'android', 'web', 'latest.json'), JSON.stringify({ version: 99_999_999_999, shellApi: 1, files: {} }));
  await writeFile(join(directory, 'android', 'web', 'objects', 'a'.repeat(64)), 'console.log("bundle");');
  await writeFile(join(directory, 'android', 'web', 'bundles.json'), 'internal');
  await writeFile(join(directory, 'secret.apk'), 'PRIVATE');
  await symlink(join(directory, 'secret.apk'), join(directory, 'android', 'smash-web-43.apk'));
});
afterAll(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('Android self-update channel', () => {
  it('serves the release pointer (revalidated) and immutable versioned APKs', async () => {
    const base = await listen(join(directory, 'android'));
    const latest = await fetch(`${base}/android/latest.json`);
    expect(latest.status).toBe(200);
    expect(latest.headers.get('cache-control')).toBe('no-cache');
    expect(await latest.json()).toEqual({ versionCode: 42, apk: 'smash-web-42.apk' });
    const apk = await fetch(`${base}/android/smash-web-42.apk`);
    expect(apk.status).toBe(200);
    expect(apk.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(apk.headers.get('cache-control')).toContain('immutable');
    const body = new Uint8Array(await apk.arrayBuffer());
    expect(body.length).toBe(300_000);
    expect(body.every((value) => value === 7)).toBe(true);
    const head = await fetch(`${base}/android/smash-web-42.apk`, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('300000');
  });
  it('serves the game-code bundle pointer and immutable content-addressed objects', async () => {
    const base = await listen(join(directory, 'android'));
    const pointer = await fetch(`${base}/android/web/latest.json`);
    expect(pointer.status).toBe(200);
    expect(pointer.headers.get('cache-control')).toBe('no-cache');
    expect(await pointer.json()).toMatchObject({ version: 99_999_999_999 });
    const object = await fetch(`${base}/android/web/objects/${'a'.repeat(64)}`);
    expect(object.status).toBe(200);
    expect(object.headers.get('content-type')).toBe('application/octet-stream');
    expect(object.headers.get('cache-control')).toContain('immutable');
    expect(await object.text()).toBe('console.log("bundle");');
    for (const path of ['/android/web/bundles.json', `/android/web/objects/${'A'.repeat(64)}`, '/android/web/objects/short', `/android/web/objects/${'b'.repeat(64)}`]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
  });
  it('derives the game-code bundle from the deployed site build, so any site deploy reaches installed apps', async () => {
    const site = join(directory, 'site');
    await mkdir(join(site, 'assets'), { recursive: true });
    await writeFile(join(site, 'play.html'), '<html><head><meta name="smash-shell-api" content="2">\n</head><body>Site</body></html>');
    await writeFile(join(site, 'assets', 'app-abc123.js'), 'console.log("site build");');
    await writeFile(join(site, 'assets', 'app-abc123.js.map'), '{"version":3}');
    await symlink(join(directory, 'secret.apk'), join(site, 'assets', 'leak.js'));
    const built = new Date('2026-09-17T05:38:12Z');
    await utimes(join(site, 'play.html'), built, built);
    const base = await listen(undefined, site);
    const pointer = await fetch(`${base}/android/web/latest.json`);
    expect(pointer.status).toBe(200);
    expect(pointer.headers.get('cache-control')).toBe('no-cache');
    const manifest = await pointer.json() as { version: number; label: string; shellApi: number; files: Record<string, { sha256: string; size: number }> };
    expect(manifest).toMatchObject({ version: Math.floor(built.getTime() / 1000), label: '2026.09.17-0538', shellApi: 2 });
    expect(Object.keys(manifest.files).sort()).toEqual(['/assets/app-abc123.js', '/play.html']);
    const sha = createHash('sha256').update('console.log("site build");').digest('hex');
    expect(manifest.files['/assets/app-abc123.js']).toEqual({ sha256: sha, size: 'console.log("site build");'.length });
    const object = await fetch(`${base}/android/web/objects/${sha}`);
    expect(object.status).toBe(200);
    expect(object.headers.get('cache-control')).toContain('immutable');
    expect(await object.text()).toBe('console.log("site build");');
    // A new deploy rewrites play.html: the next pointer read reflects the new build.
    await writeFile(join(site, 'assets', 'app-def456.js'), 'console.log("next build");');
    await writeFile(join(site, 'play.html'), '<html><head><meta name="smash-shell-api" content="2">\n</head><body>Next</body></html>');
    const next = await (await fetch(`${base}/android/web/latest.json`)).json() as { version: number; files: Record<string, unknown> };
    expect(next.version).toBeGreaterThan(manifest.version);
    expect(Object.keys(next.files)).toContain('/assets/app-def456.js');
    // A newer manually published bundle still takes precedence over the site build.
    const published = await listen(join(directory, 'android'), site);
    expect(await (await fetch(`${published}/android/web/latest.json`)).json()).toMatchObject({ version: 99_999_999_999 });
  });
  it('exposes nothing else: other names, symlink escapes, missing files or no configured channel', async () => {
    const base = await listen(join(directory, 'android'));
    for (const path of ['/android/', '/android/other.apk', '/android/smash-web-1.apk', '/android/smash-web-43.apk', '/android/latest.json.bak', '/android/../secret.apk']) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    }
    const disabled = await listen();
    expect((await fetch(`${disabled}/android/latest.json`)).status).toBe(404);
  });
});
