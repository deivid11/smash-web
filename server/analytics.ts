/** Visit and usage statistics (POST /api/visit), stored in SQLite. No dashboard: query the file.
 *
 * A "visit" is one page session reported by the browser beacon (web/src/analytics/visits.ts).
 * Crawlers that never run JavaScript therefore never appear, and the rows carry the signals
 * needed to separate people from automation: a bot-looking user agent, `navigator.webdriver`,
 * and `engaged` — set on the first real pointer/key/touch/gamepad input.
 *
 * Collection scope is counts only, and everything stored is allowlisted:
 * - page CLASS (play/players/viewer/other), never a path; referring site HOST, never a URL;
 *   a short campaign slug; coarse device class and browser family, never the user-agent string.
 * - Events are a fixed set of types whose fields are individually validated (enums, slugs,
 *   bounded integers, booleans). Free text — error messages included — is never persisted.
 * - No raw IP address is stored. It becomes a hash under a salt that rotates every UTC day, so
 *   it only de-duplicates people within one day and cannot link days. The legacy fixed `salt`
 *   row of earlier databases is left in place but no longer used.
 * - The data is pseudonymous, not anonymous: a visit may carry the random visitor number the
 *   browser generated. Browsers sending Do-Not-Track / Global Privacy Control (request headers
 *   `DNT: 1` / `Sec-GPC: 1`, or the beacon's own flag) are stored with neither a visitor
 *   number nor an address hash.
 * - Opting out in the game stops reporting and deletes the browser's visitor number; rows
 *   already stored here stay until the operator deletes them.
 *
 * Columns `referrer` and `user_agent` remain for compatibility with earlier databases and are
 * always NULL for new rows; `path` now holds the page class.
 *
 * Handy queries:
 *   -- real people per day
 *   SELECT date(started_at/1000,'unixepoch') day, COUNT(DISTINCT COALESCE(visitor_id, NULLIF(ip_hash,'dnt'), id)) people,
 *          COUNT(*) visits FROM visits WHERE bot = 0 AND engaged = 1 GROUP BY day ORDER BY day;
 *   -- what they play
 *   SELECT json_extract(data,'$.mode') mode, COUNT(*) FROM events WHERE type='match_start' GROUP BY mode; */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { clientAddress, RateLimiter } from './account-api.ts';

export const VISIT_API = '/api/visit';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_EVENTS_PER_VISIT = 400;
const MAX_EVENTS_PER_REQUEST = 40;
const BOT_AGENT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python|httpclient|okhttp|go-http|axios|node-fetch|scrapy|phantom|puppeteer|playwright|selenium/iu;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/u;
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]{0,118}[a-z0-9])?(:\d{1,5})?$/iu;
const PAGE_CLASSES = ['play', 'players', 'viewer', 'other'] as const;
const ERROR_KINDS = ['source', 'wasm', 'webgl', 'other'] as const;
const ACE_POLICIES = ['optional', 'required', 'off'] as const;

type Field = (value: unknown) => unknown;
const slug: Field = (value) => typeof value === 'string' && SLUG.test(value) ? value : undefined;
const bool: Field = (value) => typeof value === 'boolean' ? value : undefined;
const count = (max: number): Field => (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(max, Math.round(value)) : undefined;
const oneOf = (values: readonly string[]): Field => (value) => typeof value === 'string' && values.includes(value) ? value : undefined;
const slugList = (max: number): Field => (value) => Array.isArray(value) ? value.slice(0, max).filter((entry) => typeof entry === 'string' && SLUG.test(entry)) : undefined;
/** The only event types and fields ever persisted; anything else in a report is dropped. */
export const EVENT_FIELDS: Readonly<Record<string, Readonly<Record<string, Field>>>> = {
  ready: { ms: count(3_600_000), graphics: slug, discGate: bool },
  error: { kind: oneOf(ERROR_KINDS) },
  disc_gate: { ace: oneOf(ACE_POLICIES) },
  scene: { scene: slug, from: slug },
  mode: { mode: slug },
  match_start: { mode: slug, stage: slug, players: count(8), humans: count(8), fighters: slugList(8), stocks: count(99), items: bool, teams: bool, hill: bool },
  match_end: { seconds: count(24 * 3600), finished: bool },
};
export function sanitizeEvent(type: unknown, data: unknown): { type: string; data: Record<string, unknown> } | null {
  if (typeof type !== 'string' || !Object.hasOwn(EVENT_FIELDS, type)) return null;
  const clean: Record<string, unknown> = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, field] of Object.entries(EVENT_FIELDS[type]!)) {
      const value = field((data as Record<string, unknown>)[key]);
      if (value !== undefined) clean[key] = value;
    }
  }
  return { type, data: clean };
}

export interface AnalyticsOptions {
  /** SQLite file; null disables intake (the route answers 404 and clients stop reporting). */
  path: string | null;
  now?: () => number;
}

export function isVisitPath(path: string): boolean { return path === VISIT_API; }

class VisitError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) { res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Length': 0 }); res.end(); return; }
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
  res.end(bytes);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  // sendBeacon may label JSON as text/plain when the Blob type is dropped.
  if (!/^(application\/json|text\/plain)\b/iu.test(String(req.headers['content-type'] ?? ''))) throw new VisitError(415, 'Send JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new VisitError(413, 'Report is too large.');
    chunks.push(chunk as Buffer);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new VisitError(400, 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VisitError(400, 'The report must be a JSON object.');
  return value as Record<string, unknown>;
}

/** BCP 47-shaped language tag and IANA-shaped time zone only; anything else is dropped. */
const locale = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/u.test(value) ? value : null;
const zone = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z0-9_+-]{1,32}(\/[A-Za-z0-9_+-]{1,32}){0,2}$/u.test(value) ? value : null;
const id = (value: unknown): string | null => typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/u.test(value) ? value : null;
const int = (value: unknown, max: number): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(max, Math.round(value)) : null;
const flag = (value: unknown): number => value === true ? 1 : 0;

/** Browser family only; the user-agent string itself is never stored. */
export function browserFamily(agent: string): string {
  if (/edg(e|a|ios)?\//iu.test(agent)) return 'edge';
  if (/firefox|fxios/iu.test(agent)) return 'firefox';
  if (/chrome|chromium|crios/iu.test(agent)) return 'chrome';
  if (/safari/iu.test(agent)) return 'safari';
  return 'other';
}
/** `DNT: 1` or `Sec-GPC: 1` on the request itself, whatever the beacon body says. */
export function declinesTracking(req: IncomingMessage): boolean {
  return String(req.headers.dnt ?? '').trim() === '1' || String(req.headers['sec-gpc'] ?? '').trim() === '1';
}

/** Coarse device class from the user agent; enough for "phones vs desktops", nothing finer. */
export function deviceClass(agent: string, touch: boolean): string {
  if (/smart-?tv|tizen|webos|aft[a-z]|bravia|crkey/iu.test(agent)) return 'tv';
  if (/ipad|tablet|(android(?!.*mobile))/iu.test(agent)) return 'tablet';
  if (/mobi|iphone|android/iu.test(agent)) return 'phone';
  return touch ? 'desktop-touch' : 'desktop';
}

export function createAnalytics(options: AnalyticsOptions) {
  const now = options.now ?? Date.now;
  if (!options.path) {
    return { enabled: false, async handle(_req: IncomingMessage, res: ServerResponse): Promise<void> { send(res, 404, { error: 'Analytics are disabled.' }); }, close(): void {} };
  }
  mkdirSync(dirname(options.path), { recursive: true });
  const db = new DatabaseSync(options.path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      visitor_id TEXT,
      ip_hash TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      active_ms INTEGER NOT NULL DEFAULT 0,
      is_returning INTEGER NOT NULL DEFAULT 0,
      path TEXT, referrer TEXT, referrer_host TEXT, campaign TEXT,
      user_agent TEXT, device TEXT, language TEXT, timezone TEXT,
      screen_w INTEGER, screen_h INTEGER, pixel_ratio REAL,
      touch INTEGER NOT NULL DEFAULT 0,
      standalone INTEGER NOT NULL DEFAULT 0,
      native_app INTEGER NOT NULL DEFAULT 0,
      webdriver INTEGER NOT NULL DEFAULT 0,
      bot INTEGER NOT NULL DEFAULT 0,
      engaged INTEGER NOT NULL DEFAULT 0,
      ready_ms INTEGER,
      matches INTEGER NOT NULL DEFAULT 0,
      events INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS visits_started ON visits (started_at);
    CREATE INDEX IF NOT EXISTS visits_visitor ON visits (visitor_id);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT
    );
    CREATE INDEX IF NOT EXISTS events_visit ON events (visit_id);
    CREATE INDEX IF NOT EXISTS events_type_at ON events (type, at);
  `);
  // Additive upgrades keep databases created by earlier builds usable.
  const columns = new Set((db.prepare('PRAGMA table_info(visits)').all() as { name: string }[]).map((column) => column.name));
  if (!columns.has('browser')) db.exec('ALTER TABLE visits ADD COLUMN browser TEXT');
  if (!columns.has('dnt')) db.exec('ALTER TABLE visits ADD COLUMN dnt INTEGER NOT NULL DEFAULT 0');
  // The address salt rotates every UTC day and yesterday's is forgotten, so a hash cannot link days.
  const readSalt = db.prepare('SELECT value FROM meta WHERE key = ?');
  const writeSalt = db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)');
  const forgetSalts = db.prepare("DELETE FROM meta WHERE key LIKE 'salt:%' AND key <> ?");
  let saltDay = '', salt = '';
  const hashAddress = (address: string, at: number): string => {
    const day = new Date(at).toISOString().slice(0, 10);
    if (day !== saltDay) {
      const key = `salt:${day}`;
      writeSalt.run(key, randomBytes(24).toString('hex'));
      salt = (readSalt.get(key) as { value: string }).value; saltDay = day;
      forgetSalts.run(key);
    }
    return createHash('sha256').update(`${salt}:${address}`).digest('hex').slice(0, 24);
  };

  const findVisit = db.prepare('SELECT events FROM visits WHERE id = ?');
  const insertVisit = db.prepare(`INSERT INTO visits (id, visitor_id, ip_hash, started_at, last_seen_at, is_returning, path, referrer, referrer_host, campaign,
    user_agent, device, language, timezone, screen_w, screen_h, pixel_ratio, touch, standalone, native_app, webdriver, bot, browser, dnt)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const touchVisit = db.prepare('UPDATE visits SET last_seen_at = ?, active_ms = MAX(active_ms, ?), engaged = MAX(engaged, ?), events = events + ? WHERE id = ?');
  const markReady = db.prepare('UPDATE visits SET ready_ms = COALESCE(ready_ms, ?) WHERE id = ?');
  const countMatch = db.prepare('UPDATE visits SET matches = matches + 1 WHERE id = ?');
  const insertEvent = db.prepare('INSERT INTO events (visit_id, at, type, data) VALUES (?, ?, ?, ?)');
  // Burst of 120 reports, refilled at 2/s per client address.
  const limiter = new RateLimiter(120, 2, now);

  function record(req: IncomingMessage, body: Record<string, unknown>): void {
    const visit = id(body.visit);
    if (body.v !== 1 || !visit) throw new VisitError(400, 'Unsupported report.');
    // The user agent is only classified (device, browser family, bot); the string is not stored.
    const at = now(), agent = String(req.headers['user-agent'] ?? '').slice(0, 300);
    let known = findVisit.get(visit) as { events: number } | undefined;
    if (!known) {
      const start = body.start as Record<string, unknown> | undefined;
      if (!start || typeof start !== 'object') throw new VisitError(409, 'Unknown visit: send its start first.');
      // Header or body: either is enough to store neither a visitor number nor an address hash.
      const dnt = declinesTracking(req) || start.dnt === true;
      const host = typeof start.referrerHost === 'string' && HOSTNAME.test(start.referrerHost) ? start.referrerHost.toLowerCase() : null;
      const page = PAGE_CLASSES.find((entry) => entry === start.page) ?? 'other';
      const touch = start.touch === true, webdriver = start.webdriver === true;
      insertVisit.run(visit, dnt ? null : id(start.visitor), dnt ? 'dnt' : hashAddress(clientAddress(req), at), at, at, flag(start.returning && !dnt), page, host,
        typeof start.campaign === 'string' && SLUG.test(start.campaign) ? start.campaign : null,
        deviceClass(agent, touch), locale(start.language), zone(start.timezone), int(start.screenW, 20000), int(start.screenH, 20000),
        typeof start.pixelRatio === 'number' && Number.isFinite(start.pixelRatio) ? Math.min(8, Math.max(0, start.pixelRatio)) : null,
        flag(touch), flag(start.standalone), flag(start.nativeApp), flag(webdriver), flag(webdriver || !agent || BOT_AGENT.test(agent)), browserFamily(agent), flag(dnt));
      known = { events: 0 };
    }
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
    let stored = 0;
    for (const raw of events) {
      if (known.events + stored >= MAX_EVENTS_PER_VISIT) break;
      const event = raw && typeof raw === 'object' ? sanitizeEvent((raw as Record<string, unknown>).type, (raw as Record<string, unknown>).data) : null;
      if (!event) continue;
      insertEvent.run(visit, at, event.type, Object.keys(event.data).length ? JSON.stringify(event.data) : null);
      if (event.type === 'ready') markReady.run(typeof event.data.ms === 'number' ? event.data.ms : null, visit);
      if (event.type === 'match_start') countMatch.run(visit);
      stored++;
    }
    touchVisit.run(at, int(body.activeMs, 7 * 24 * 3_600_000) ?? 0, flag(body.engaged), stored, visit);
  }

  return {
    enabled: true,
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new VisitError(405, 'Only POST is supported.'); }
        if (!limiter.take(clientAddress(req))) throw new VisitError(429, 'Too many reports.');
        record(req, await readJson(req));
        send(res, 204);
      } catch (error) {
        if (error instanceof VisitError) { send(res, error.status, { error: error.message }); return; }
        console.error('analytics:', error instanceof Error ? error.message : error);
        send(res, 500, { error: 'Analytics are unavailable.' });
      }
    },
    close(): void { db.close(); },
  };
}
