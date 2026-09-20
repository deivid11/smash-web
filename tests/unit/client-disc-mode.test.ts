import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createMeleeServer } from '../../server/http.ts';
import { openIsoSource } from '../../server/iso-source.ts';
import { openLocalSource, saveLocalCopy } from '../../lib/hsd/local-source.ts';
import { cachedDiscReader } from '../../lib/hsd/server-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { openDisc } from '../../scripts/node-disc.ts';

let server: Server, base: string, directory: string;
beforeAll(async () => {
  const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
  await mkdir(parent, { recursive: true });
  directory = await mkdtemp(join(parent, 'client-disc-tests-'));
  await writeFile(join(directory, 'play.html'), '<html><head><title>Play</title></head><body>Play fixture</body></html>');
  await writeFile(join(directory, 'index.html'), '<html><head></head>Lab fixture</html>');
  server = await createMeleeServer({ staticRoot: directory, clientAce: 'required' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('client-disc mode server (no ISO on the host)', () => {
  it('stamps the client-disc marker and its ACE policy beside the server marker', async () => {
    const html = await (await fetch(`${base}/play.html`)).text();
    expect(html).toContain('<meta name="smash-source" content="server">');
    expect(html).toContain('<meta name="smash-disc" content="client" data-ace="required">');
    expect(await (await fetch(`${base}/index.html`)).text()).not.toContain('smash-disc');
  });
  it('answers the source probe without any disc identity or file table', async () => {
    const response = await fetch(`${base}/api/source`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, mode: 'client', ace: 'required' });
  });
  it('exposes no game asset', async () => {
    for (const name of ['PlFx.dat', 'GrNBa.dat', 'audio/us/main.ssm', 'PlZx.dat']) expect((await fetch(`${base}/api/assets/${name}`)).status).toBe(404);
  });
});

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
describe.skipIf(!iso)('local source parity with the server manifest', () => {
  const identity = (manifest: { files: { path: string; offset: number; size: number }[] }) => ({ ...manifest, files: manifest.files.map((file) => [file.path, file.offset, file.size]) });
  it('builds the same manifest identity from the original disc alone', async () => {
    const disc = await openDisc(iso!), served = await openIsoSource(iso!);
    try {
      const local = await openLocalSource(disc);
      expect(identity(local.manifest)).toEqual(identity(served.manifest));
      expect(local.manifest.modded).toBeUndefined();
      expect((await local.session.bytes('PlCo.dat')).byteLength).toBeGreaterThan(0);
    } finally { await disc.close(); await served.close(); }
  }, 120000);
  it.skipIf(!aceIso)('builds the same manifest identity with the ACE 2.0 extension disc', async () => {
    const disc = await openDisc(iso!), ace = await openDisc(aceIso!), served = await openIsoSource(iso!, aceIso!);
    try {
      const local = await openLocalSource(disc, ace);
      expect(identity(local.manifest)).toEqual(identity(served.manifest));
      expect((await local.session.bytes('PlZx.dat')).byteLength).toBeGreaterThan(0);
    } finally { await disc.close(); await ace.close(); await served.close(); }
  }, 120000);
  it('saves a complete local copy that the cache-only reader boots from, manifest last', async () => {
    const disc = await openDisc(iso!);
    try {
      const local = await openLocalSource(disc);
      const memory = new Map<string, Uint8Array>(), saved: string[] = [];
      const store = { get: async (key: string) => memory.get(key), put: async (key: string, bytes: Uint8Array) => { memory.set(key, bytes); } };
      const storage = { open: async () => ({ put: async () => { saved.push(`manifest after ${memory.size} files`); }, delete: async () => { saved.push('old manifest dropped'); return true; }, match: async () => undefined }) } as unknown as CacheStorage;
      // Interrupted copy: nothing vouches for it.
      const abort = new AbortController(); let calls = 0;
      expect(await saveLocalCopy(local, store, { storage, signal: abort.signal, onProgress: () => { if (++calls === 5) abort.abort(); } })).toBe(false);
      expect(saved).toEqual(['old manifest dropped']);
      // Full copy: every exposed file stored whole, manifest written last.
      let last = 0;
      expect(await saveLocalCopy(local, store, { storage, onProgress: (fraction) => { expect(fraction).toBeGreaterThanOrEqual(last); last = fraction; } })).toBe(true);
      expect(last).toBe(1); expect(memory.size).toBe(local.manifest.files.length);
      expect(saved.at(-1)).toBe(`manifest after ${local.manifest.files.length} files`);
      // The cache-only reader (no whole-file size limit) serves big and small files byte-identically.
      const cached = new HsdAssetSession(cachedDiscReader(local.manifest, store, { wholeFileLimit: Number.POSITIVE_INFINITY }), local.manifest);
      const biggest = [...local.manifest.files].sort((a, b) => b.size - a.size)[0]!;
      expect(biggest.size).toBeGreaterThan(4 * 1024 * 1024);
      for (const name of ['PlCo.dat', biggest.path]) expect(Buffer.from(await cached.bytes(name)).equals(Buffer.from(await local.session.bytes(name)))).toBe(true);
    } finally { await disc.close(); }
  }, 240000);
  it.skipIf(!aceIso)('refuses the ACE disc in the original slot and the original in the ACE slot', async () => {
    const disc = await openDisc(iso!), ace = await openDisc(aceIso!);
    try {
      await expect(openLocalSource(ace)).rejects.toThrow('SHA-1 mismatch');
      await expect(openLocalSource(disc, disc)).rejects.toThrow('ACE 2.0');
    } finally { await disc.close(); await ace.close(); }
  }, 120000);
});
