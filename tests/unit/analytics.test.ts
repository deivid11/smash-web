import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createMeleeServer } from '../../server/http.ts';
import { browserFamily, createAnalytics, deviceClass, sanitizeEvent } from '../../server/analytics.ts';

let server: Server, base: string, directory: string, database: string;
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const post = (body: unknown, agent = CHROME, type = 'application/json') => fetch(`${base}/api/visit`, { method: 'POST', headers: { 'Content-Type': type, 'User-Agent': agent }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const rows = <T>(sql: string): T[] => { const db = new DatabaseSync(database, { readOnly: true }); try { return db.prepare(sql).all() as T[]; } finally { db.close(); } };

beforeAll(async () => {
  const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
  await mkdir(parent, { recursive: true });
  directory = await mkdtemp(join(parent, 'analytics-tests-'));
  await writeFile(join(directory, 'play.html'), '<html><head></head><body>Play</body></html>');
  database = join(directory, 'data', 'analytics.sqlite');
  server = await createMeleeServer({ staticRoot: directory, analyticsPath: database });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('visit analytics intake', () => {
  it('stores one visit as classes, hosts and slugs — never paths, URLs, the user agent or the raw address', async () => {
    const response = await post({ v: 1, visit: 'visit-aaaaaaaa', engaged: false, activeMs: 10, events: [],
      start: { visitor: 'abcdef0123456789abcdef01', returning: false, page: 'players', path: '/players/SomeUser', referrer: 'https://x.com/someone/status/1?token=secret', referrerHost: 'x.com', campaign: 'launch', language: 'es-MX', timezone: 'America/Mexico_City', screenW: 1920, screenH: 1080, pixelRatio: 1, touch: false, webdriver: false } });
    expect(response.status).toBe(204);
    const [visit] = rows<Record<string, unknown>>('SELECT * FROM visits');
    expect(visit).toMatchObject({ id: 'visit-aaaaaaaa', visitor_id: 'abcdef0123456789abcdef01', path: 'players', referrer: null, referrer_host: 'x.com', campaign: 'launch', user_agent: null, device: 'desktop', browser: 'chrome', language: 'es-MX', dnt: 0, bot: 0, engaged: 0, matches: 0 });
    expect(String(visit!.ip_hash)).toMatch(/^[0-9a-f]{24}$/u);
    const stored = JSON.stringify(visit);
    for (const leak of ['127.0.0.1', 'SomeUser', 'secret', 'status/1', 'Mozilla', 'AppleWebKit']) expect(stored).not.toContain(leak);
  });
  it('drops malformed hosts, campaigns, locales and unknown page classes instead of storing them', async () => {
    await post({ v: 1, visit: 'visit-junk-0001', events: [], start: { page: '/players/SomeUser', referrerHost: 'https://evil.example/path?x=1', campaign: 'free text with spaces & <b>', language: 'not a locale!', timezone: '../../etc/passwd' } });
    expect(rows("SELECT path, referrer_host, campaign, language, timezone FROM visits WHERE id = 'visit-junk-0001'")[0]).toEqual({ path: 'other', referrer_host: null, campaign: null, language: null, timezone: null });
  });
  it('accumulates engagement, active time, load time and allowlisted usage events on later reports', async () => {
    expect((await post({ v: 1, visit: 'visit-aaaaaaaa', engaged: true, activeMs: 65000, events: [
      { type: 'ready', data: { ms: 8200, graphics: 'high', note: 'free text is dropped' } },
      { type: 'match_start', data: { mode: 'solo', stage: 'battlefield', players: 2, humans: 1, fighters: ['Fx', 'Mr', 'not ok!', 7], items: true, account: 'SomeUser' } },
      { type: 'match_end', data: { seconds: 94, finished: true } },
      { type: 'error', data: { kind: 'wasm', message: 'Failed to fetch /secret/path' } },
      { type: 'error', data: { kind: 'made-up' } },
      { type: 'custom_event', data: { anything: 'goes' } }, { type: 'Bad Type!' },
    ] })).status).toBe(204);
    // A stale, smaller activeMs never rewinds the total, and engagement is sticky.
    await post({ v: 1, visit: 'visit-aaaaaaaa', engaged: false, activeMs: 100, events: [] });
    expect(rows("SELECT engaged, active_ms, ready_ms, matches, events FROM visits WHERE id = 'visit-aaaaaaaa'")[0]).toEqual({ engaged: 1, active_ms: 65000, ready_ms: 8200, matches: 1, events: 5 });
    const events = rows<{ type: string; data: string | null }>('SELECT type, data FROM events ORDER BY id');
    expect(events.map((row) => row.type)).toEqual(['ready', 'match_start', 'match_end', 'error', 'error']);
    expect(JSON.parse(events[0]!.data!)).toEqual({ ms: 8200, graphics: 'high' });
    expect(JSON.parse(events[1]!.data!)).toEqual({ mode: 'solo', stage: 'battlefield', players: 2, humans: 1, fighters: ['Fx', 'Mr'], items: true });
    expect(JSON.parse(events[3]!.data!)).toEqual({ kind: 'wasm' });
    expect(events[4]!.data).toBeNull();
    expect(JSON.stringify(events)).not.toMatch(/SomeUser|secret|free text|goes/u);
  });
  it('honours DNT / Sec-GPC request headers and the beacon flag: no visitor number, no address hash', async () => {
    const start = { visitor: 'abcdef0123456789abcdef02', returning: true, page: 'play' };
    await fetch(`${base}/api/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME, DNT: '1' }, body: JSON.stringify({ v: 1, visit: 'visit-dnt-00001', start, events: [] }) });
    await fetch(`${base}/api/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': CHROME, 'Sec-GPC': '1' }, body: JSON.stringify({ v: 1, visit: 'visit-dnt-00002', start, events: [] }) });
    await post({ v: 1, visit: 'visit-dnt-00003', start: { ...start, dnt: true }, events: [] });
    expect(rows("SELECT visitor_id, ip_hash, is_returning, dnt FROM visits WHERE id LIKE 'visit-dnt-%' ORDER BY id")).toEqual(Array.from({ length: 3 }, () => ({ visitor_id: null, ip_hash: 'dnt', is_returning: 0, dnt: 1 })));
  });
  it('salts the address per UTC day and forgets other days', async () => {
    const salts = rows<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'salt:%'");
    expect(salts).toEqual([{ key: `salt:${new Date().toISOString().slice(0, 10)}` }]);
  });
  it('flags automation by user agent or webdriver, and accepts beacons labelled text/plain', async () => {
    await post({ v: 1, visit: 'visit-bot-00001', start: { page: 'play' }, events: [] }, 'Mozilla/5.0 (compatible; Googlebot/2.1)');
    await post(JSON.stringify({ v: 1, visit: 'visit-bot-00002', start: { page: 'play', webdriver: true }, events: [] }), CHROME, 'text/plain;charset=UTF-8');
    expect(rows("SELECT id, bot FROM visits WHERE id LIKE 'visit-bot-%' ORDER BY id")).toEqual([{ id: 'visit-bot-00001', bot: 1 }, { id: 'visit-bot-00002', bot: 1 }]);
  });
  it('rejects junk without storing it', async () => {
    const before = rows<{ n: number }>('SELECT COUNT(*) n FROM visits')[0]!.n;
    expect((await post({ v: 2, visit: 'visit-cccccccc' })).status).toBe(400);
    expect((await post({ v: 1, visit: 'short' })).status).toBe(400);
    expect((await post({ v: 1, visit: 'visit-unknown1', events: [] })).status).toBe(409);
    expect((await post('not json')).status).toBe(400);
    expect((await post('x'.repeat(20000))).status).toBe(413);
    expect((await fetch(`${base}/api/visit`)).status).toBe(405);
    expect(rows<{ n: number }>('SELECT COUNT(*) n FROM visits')[0]!.n).toBe(before);
  });
  it('classifies devices and browsers coarsely', () => {
    expect(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148', true)).toBe('phone');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36', true)).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 11; AFTKA) Silk/120', false)).toBe('tv');
    expect(deviceClass(CHROME, false)).toBe('desktop');
    expect(browserFamily(CHROME)).toBe('chrome');
    expect(browserFamily('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('firefox');
    expect(browserFamily('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('safari');
    expect(browserFamily(`${CHROME} Edg/140.0.0.0`)).toBe('edge');
  });
  it('sanitizes events through the allowlist', () => {
    expect(sanitizeEvent('scene', { scene: 'characters', from: 'home', extra: 1 })).toEqual({ type: 'scene', data: { scene: 'characters', from: 'home' } });
    expect(sanitizeEvent('match_end', { seconds: 9e9, finished: 'yes' })).toEqual({ type: 'match_end', data: { seconds: 86400 } });
    expect(sanitizeEvent('__proto__', {})).toBeNull();
    expect(sanitizeEvent('login', { user: 'x' })).toBeNull();
  });
  it('upgrades a database created by the first build without losing its rows', async () => {
    const legacy = join(directory, 'data', 'legacy.sqlite');
    const db = new DatabaseSync(legacy);
    db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('salt', 'legacy-salt');
      CREATE TABLE visits (id TEXT PRIMARY KEY, visitor_id TEXT, ip_hash TEXT NOT NULL, started_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, active_ms INTEGER NOT NULL DEFAULT 0, is_returning INTEGER NOT NULL DEFAULT 0,
        path TEXT, referrer TEXT, referrer_host TEXT, campaign TEXT, user_agent TEXT, device TEXT, language TEXT, timezone TEXT, screen_w INTEGER, screen_h INTEGER, pixel_ratio REAL,
        touch INTEGER NOT NULL DEFAULT 0, standalone INTEGER NOT NULL DEFAULT 0, native_app INTEGER NOT NULL DEFAULT 0, webdriver INTEGER NOT NULL DEFAULT 0, bot INTEGER NOT NULL DEFAULT 0, engaged INTEGER NOT NULL DEFAULT 0, ready_ms INTEGER, matches INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0);
      INSERT INTO visits (id, ip_hash, started_at, last_seen_at, path) VALUES ('old-visit-0001', 'abc', 1, 1, '/play.html');`);
    db.close();
    const upgraded = createAnalytics({ path: legacy }); upgraded.close();
    const check = new DatabaseSync(legacy, { readOnly: true });
    try {
      expect(check.prepare("SELECT id, path, browser, dnt FROM visits").all()).toEqual([{ id: 'old-visit-0001', path: '/play.html', browser: null, dnt: 0 }]);
      expect(check.prepare("SELECT value FROM meta WHERE key = 'salt'").get()).toEqual({ value: 'legacy-salt' });
    } finally { check.close(); }
  });
});

describe('analytics disabled', () => {
  it('answers 404 so clients stop reporting', async () => {
    const off = await createMeleeServer({ staticRoot: directory });
    await new Promise<void>((resolve) => off.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(off.address() as { port: number }).port}/api/visit`;
      expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);
    } finally { await new Promise<void>((resolve) => off.close(() => resolve())); }
  });
});
