import { describe, expect, it } from 'vitest';
import { parseSourceManifest, VIEWER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { connectServerSource, serverDiscReader } from '../../lib/hsd/server-source.ts';
import { sourceFixture } from './source-fixture.ts';

const manifestResponse = () => new Response(JSON.stringify(sourceFixture()), { headers: { 'Content-Type': 'application/json' } });

describe('server source manifest validation', () => {
  it('accepts a complete supported manifest', () => expect(parseSourceManifest(sourceFixture()).files).toHaveLength(VIEWER_ASSETS.length));
  it('accepts the optional common gameplay data without breaking viewer-only manifests', () => {
    const manifest = sourceFixture(); manifest.files.push({ path: 'PlCo.dat', offset: 100000, size: 256 });
    expect(parseSourceManifest(manifest).files).toHaveLength(VIEWER_ASSETS.length + 1);
  });
  it.each([null, [], 'text', 0])('rejects non-manifests (%j)', (input) => expect(() => parseSourceManifest(input)).toThrow());
  it('rejects unknown protocol versions', () => expect(() => parseSourceManifest({ ...sourceFixture(), version: 2 })).toThrow('Unsupported'));
  it('rejects unverified executable identities', () => expect(() => parseSourceManifest({ ...sourceFixture(), executableSha1: 'bad' })).toThrow('Unsupported'));
  it('rejects missing assets', () => { const manifest = sourceFixture(); manifest.files.pop(); expect(() => parseSourceManifest(manifest)).toThrow('incomplete'); });
  it('rejects arbitrary or traversal asset paths', () => { const manifest = sourceFixture(); manifest.files[0]!.path = '../private/disc.iso'; expect(() => parseSourceManifest(manifest)).toThrow('asset entry'); });
  it('rejects duplicate entries', () => { const manifest = sourceFixture(); manifest.files[1]!.path = manifest.files[0]!.path; expect(() => parseSourceManifest(manifest)).toThrow('asset entry'); });
  it('rejects out-of-disc ranges', () => { const manifest = sourceFixture(); manifest.files[0]!.size = manifest.discSize; expect(() => parseSourceManifest(manifest)).toThrow('asset entry'); });
});

describe('bounded remote asset adapter', () => {
  it('maps disc offsets to named asset ranges, not a full-ISO endpoint', async () => {
    const manifest = sourceFixture(), entry = manifest.files[0]!;
    const reader = serverDiscReader(manifest, async (url, options) => {
      expect(url).toBe('/api/assets/GrNBa.dat');
      expect(new Headers(options?.headers).get('Range')).toBe('bytes=10-12');
      return new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'Content-Range': 'bytes 10-12/256', 'Content-Length': '3' } });
    });
    expect([...await reader.read(entry.offset + 10, 3)]).toEqual([1, 2, 3]);
  });
  it('rejects reads that cross asset boundaries without making a request', async () => {
    let requests = 0;
    const manifest = sourceFixture();
    const reader = serverDiscReader(manifest, async () => { requests++; return new Response(); });
    await expect(reader.read(manifest.files[0]!.offset + 250, 8)).rejects.toThrow('not part');
    expect(requests).toBe(0);
  });
  it('rejects direct executable/header reads', async () => {
    await expect(serverDiscReader(sourceFixture()).read(0, 256)).rejects.toThrow('not part');
  });
  it.each([-1, Infinity, 1.5, 17 * 1024 * 1024])('rejects invalid lengths %s', async (length) => {
    await expect(serverDiscReader(sourceFixture()).read(0, length)).rejects.toThrow('length');
  });
  it('handles zero-length requests locally', async () => {
    const manifest = sourceFixture();
    expect(await serverDiscReader(manifest).read(manifest.files[0]!.offset, 0)).toHaveLength(0);
  });
  it('rejects non-partial responses', async () => {
    const manifest = sourceFixture();
    const reader = serverDiscReader(manifest, async () => new Response('bad', { status: 200 }));
    await expect(reader.read(manifest.files[0]!.offset, 3)).rejects.toThrow('failed (200)');
  });
  it('rejects mismatching range headers before reading the body', async () => {
    const manifest = sourceFixture();
    const reader = serverDiscReader(manifest, async () => new Response(new Uint8Array(3), { status: 206, headers: { 'Content-Range': 'bytes 0-2/999', 'Content-Length': '3' } }));
    await expect(reader.read(manifest.files[0]!.offset, 3)).rejects.toThrow('unexpected');
  });
  it('rejects truncated response bodies', async () => {
    const manifest = sourceFixture();
    const reader = serverDiscReader(manifest, async () => new Response(new Uint8Array(2), { status: 206, headers: { 'Content-Range': 'bytes 0-2/256', 'Content-Length': '3' } }));
    await expect(reader.read(manifest.files[0]!.offset, 3)).rejects.toThrow('truncated');
  });
  it('connects a verified server source', async () => expect((await connectServerSource(async () => manifestResponse()))?.manifest.gameId).toBe('GALE01'));
  it('falls back for static-only builds', async () => expect(await connectServerSource(async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }))).toBeNull());
  it('falls back when there is no source endpoint', async () => expect(await connectServerSource(async () => new Response('', { status: 404 }))).toBeNull());
  it('reports server-side disc failures instead of silently using bad data', async () => {
    await expect(connectServerSource(async () => new Response('', { status: 503 }))).rejects.toThrow('unavailable');
  });
});
