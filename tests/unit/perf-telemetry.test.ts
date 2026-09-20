import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SpanProfiler, spanParent } from '../../lib/perf/profiler.ts';
import { createMeleeServer } from '../../server/http.ts';
import { sourceFixture } from './source-fixture.ts';

describe('span profiler', () => {
  it('accumulates begin/end pairs per frame and drains to zero', () => {
    let clock = 0;
    const profiler = new SpanProfiler(() => clock);
    const a = profiler.span('step.cpu'), b = profiler.span('render.draw');
    expect(profiler.span('step.cpu')).toBe(a);
    profiler.begin(a); clock += 3; profiler.end(a);
    expect(profiler.totals[a]).toBe(0); // disabled: nothing recorded
    profiler.enabled = true;
    profiler.begin(a); clock += 2; profiler.end(a);
    profiler.begin(a); clock += 1.5; profiler.end(a);
    profiler.begin(b); clock += 4;
    profiler.begin(b); clock += 1; profiler.end(b); // re-entry keeps the outer start
    const totals = new Float32Array(64), counts = new Uint16Array(64);
    profiler.drain(totals, counts);
    expect(totals[a]).toBeCloseTo(3.5); expect(counts[a]).toBe(2);
    expect(totals[b]).toBeCloseTo(5); expect(counts[b]).toBe(1);
    expect(profiler.totals[a]).toBe(0);
    // A span left open by an exception is closed by drain, never inflating later frames.
    profiler.begin(a); clock += 100;
    profiler.drain(totals, counts);
    profiler.end(a);
    profiler.drain(totals, counts);
    expect(totals[a]).toBe(0);
  });

  it('nests span families for reports', () => {
    expect(spanParent('step.cpu')).toBe('sim.step');
    expect(spanParent('sim.step')).toBe('frame.sim');
    expect(spanParent('render.draw')).toBe('frame.render');
    expect(spanParent('frame.render')).toBe('');
    expect(spanParent('net.hash')).toBe('');
  });
});

const upload = (overrides: Record<string, unknown> = {}) => ({
  v: 1, kind: 'smash-perf', session: { id: 'session-1', startedAt: '2026-09-17T00:00:00Z' }, device: { userAgent: 'test' },
  match: { id: 'match-1', startedAt: '2026-09-17T00:00:00Z', context: { players: 8, stage: 'battlefield' } },
  part: 0, windows: [{ seq: 0, frames: 300 }], events: [], summary: null, endReason: null, ...overrides,
});

describe('performance telemetry HTTP API', () => {
  let server: Server, disabled: Server;
  let base: string, disabledBase: string;
  let directory: string;
  const token = 'perf-test-token-1234';
  beforeAll(async () => {
    const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'perf-tests-'));
    await writeFile(join(directory, 'play.html'), '<html><head></head><body></body></html>');
    const source = { manifest: sourceFixture(), read: async () => new Uint8Array(), close: async () => {} };
    server = await createMeleeServer({ source, staticRoot: directory, perfDir: join(directory, 'perf'), perfToken: token });
    disabled = await createMeleeServer({ source, staticRoot: directory });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => disabled.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    disabledBase = `http://127.0.0.1:${(disabled.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (disabled) await new Promise<void>((resolve) => disabled.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const post = (url: string, body: unknown, type = 'application/json') => fetch(`${url}/api/perf`, { method: 'POST', headers: { 'Content-Type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('appends valid uploads as JSONL lines with a hashed client id', async () => {
    expect((await post(base, upload())).status).toBe(204);
    expect((await post(base, upload({ part: 1 }), 'text/plain;charset=UTF-8')).status).toBe(204);
    const files = await readdir(join(directory, 'perf'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^perf-\d{4}-\d{2}-\d{2}\.jsonl$/u);
    const lines = (await readFile(join(directory, 'perf', files[0]!), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: 'smash-perf', part: 0, match: { id: 'match-1' } });
    expect(lines[0]!.client).toMatch(/^[0-9a-f]{16}$/u);
    expect(JSON.stringify(lines[0])).not.toContain('127.0.0.1');
  });

  it('rejects malformed uploads and wrong methods', async () => {
    expect((await post(base, '{nope')).status).toBe(400);
    expect((await post(base, upload({ v: 2 }))).status).toBe(400);
    expect((await post(base, upload({ session: {} }))).status).toBe(400);
    expect((await post(base, 'a=b', 'application/x-www-form-urlencoded')).status).toBe(415);
    expect((await post(base, { ...upload(), padding: 'x'.repeat(300_000) })).status).toBe(413);
    expect((await fetch(`${base}/api/perf`)).status).toBe(405);
  });

  it('exports files only with the bearer token', async () => {
    expect((await fetch(`${base}/api/perf/files`)).status).toBe(401);
    expect((await fetch(`${base}/api/perf/files`, { headers: { Authorization: 'Bearer wrong-token-000' } })).status).toBe(401);
    const listed = await fetch(`${base}/api/perf/files`, { headers: { Authorization: `Bearer ${token}` } });
    expect(listed.status).toBe(200);
    const { files } = await listed.json() as { files: Array<{ name: string; size: number }> };
    expect(files.length).toBe(1);
    const download = await fetch(`${base}/api/perf/files/${files[0]!.name}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(download.status).toBe(200);
    expect((await download.text()).trim().split('\n').length).toBeGreaterThanOrEqual(2);
    expect((await fetch(`${base}/api/perf/files/..%2Faccounts.sqlite`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it('answers 404 when the server has no telemetry directory', async () => {
    expect((await post(disabledBase, upload())).status).toBe(404);
    expect((await fetch(`${disabledBase}/api/perf/files`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
  });
});
