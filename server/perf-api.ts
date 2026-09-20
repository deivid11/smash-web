/** Client performance telemetry intake (POST /api/perf) and token-gated export.
 *
 * Browsers upload small JSON batches (web/src/perf/telemetry.ts); each accepted
 * batch becomes one line in `<dir>/perf-YYYY-MM-DD.jsonl` (UTC day) with the
 * receive time and a salted client hash (never the raw address). Reads require
 * SMASH_PERF_TOKEN as a bearer token and are what scripts/perf-report.ts pulls:
 *   GET /api/perf/files          -> [{ name, size, modified }]
 *   GET /api/perf/files/<name>   -> raw JSONL
 * Without a directory the intake answers 404, which clients treat as "disabled". */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { clientAddress, RateLimiter } from './account-api.ts';

export const PERF_API = '/api/perf';
const MAX_BODY_BYTES = 256 * 1024;
const FILE_NAME = /^perf-\d{4}-\d{2}-\d{2}\.jsonl$/u;

export interface PerfApiOptions {
  /** Directory for the JSONL files; null disables intake and export. */
  dir: string | null;
  /** Bearer token for the export routes; null disables export. */
  token: string | null;
  /** Per-day file cap (bytes); further uploads that day are dropped with 507. */
  maxDayBytes?: number;
  now?: () => number;
}

export function isPerfPath(path: string): boolean {
  return path === PERF_API || path.startsWith(`${PERF_API}/`);
}

class PerfError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
  res.end(bytes);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  // sendBeacon may label JSON as text/plain when the Blob type is dropped.
  if (!/^(application\/json|text\/plain)\b/iu.test(String(req.headers['content-type'] ?? ''))) throw new PerfError(415, 'Send JSON.');
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) throw new PerfError(413, 'Report is too large.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new PerfError(413, 'Report is too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const shortString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

/** Minimal structural check: enough to keep junk out of the log, not a full schema. */
export function validatePerfUpload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PerfError(400, 'The report must be a JSON object.');
  const report = value as Record<string, unknown>;
  if (report.v !== 1 || report.kind !== 'smash-perf') throw new PerfError(400, 'Unsupported report version.');
  const session = report.session as Record<string, unknown> | undefined, match = report.match as Record<string, unknown> | undefined;
  if (!session || !shortString(session.id, 64)) throw new PerfError(400, 'Missing session id.');
  if (!match || !shortString(match.id, 64) || !match.context || typeof match.context !== 'object') throw new PerfError(400, 'Missing match context.');
  if (!Array.isArray(report.windows) || report.windows.length > 120) throw new PerfError(400, 'Invalid windows.');
  if (!Number.isInteger(report.part) || (report.part as number) < 0) throw new PerfError(400, 'Invalid part.');
  return report;
}

export function createPerfApi(options: PerfApiOptions) {
  const now = options.now ?? Date.now;
  const limiter = new RateLimiter(12, 1 / 5, now);
  const salt = options.token ? createHash('sha256').update(`perf-salt:${options.token}`).digest() : randomBytes(32);
  const maxDayBytes = options.maxDayBytes ?? 256 * 1024 * 1024;
  const daySizes = new Map<string, number>();
  let ready: Promise<void> | null = null;

  function authorized(req: IncomingMessage): boolean {
    if (!options.token) return false;
    const given = /^Bearer (\S{8,256})$/u.exec(String(req.headers.authorization ?? ''))?.[1];
    if (!given) return false;
    const a = createHash('sha256').update(given).digest(), b = createHash('sha256').update(options.token).digest();
    return timingSafeEqual(a, b);
  }

  async function intake(req: IncomingMessage, res: ServerResponse, dir: string): Promise<void> {
    const ip = clientAddress(req);
    if (!limiter.take(ip)) throw new PerfError(429, 'Too many reports.');
    const body = await readBody(req);
    let parsed: unknown;
    try { parsed = JSON.parse(body.toString('utf8')); } catch { throw new PerfError(400, 'Invalid JSON.'); }
    const report = validatePerfUpload(parsed);
    const received = new Date(now());
    const name = `perf-${received.toISOString().slice(0, 10)}.jsonl`;
    const line = `${JSON.stringify({ receivedAt: received.toISOString(), client: createHash('sha256').update(salt).update(ip).digest('hex').slice(0, 16), ...report })}\n`;
    ready ??= mkdir(dir, { recursive: true }).then(() => undefined);
    await ready;
    let size = daySizes.get(name);
    if (size === undefined) { size = await stat(join(dir, name)).then(info => info.size, () => 0); daySizes.clear(); }
    if (size + line.length > maxDayBytes) throw new PerfError(507, 'Daily report storage is full.');
    await appendFile(join(dir, name), line, 'utf8');
    daySizes.set(name, size + Buffer.byteLength(line));
    res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end();
  }

  async function exportRoute(req: IncomingMessage, res: ServerResponse, path: string, dir: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); throw new PerfError(405, 'Method not allowed.'); }
    if (!authorized(req)) throw new PerfError(options.token ? 401 : 404, options.token ? 'Unauthorized.' : 'Not found.');
    if (path === `${PERF_API}/files`) {
      const names = await readdir(dir).catch(() => [] as string[]);
      const files = await Promise.all(names.filter(name => FILE_NAME.test(name)).sort().map(async name => {
        const info = await stat(join(dir, name));
        return { name, size: info.size, modified: info.mtime.toISOString() };
      }));
      send(res, 200, { files }); return;
    }
    const name = path.slice(`${PERF_API}/files/`.length);
    if (!path.startsWith(`${PERF_API}/files/`) || !FILE_NAME.test(name)) throw new PerfError(404, 'Not found.');
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info?.isFile()) throw new PerfError(404, 'Not found.');
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') { res.end(); return; }
    await new Promise<void>((done) => {
      const stream = createReadStream(join(dir, name), { start: 0, end: Math.max(0, info.size - 1) });
      stream.once('error', () => { res.destroy(); done(); });
      res.once('close', () => { stream.destroy(); done(); });
      stream.pipe(res);
    });
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
      try {
        const dir = options.dir;
        if (!dir) throw new PerfError(404, 'Performance telemetry is disabled on this server.');
        if (path === PERF_API) {
          if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new PerfError(405, 'Method not allowed.'); }
          await intake(req, res, dir); return;
        }
        await exportRoute(req, res, path, dir);
      } catch (error) {
        if (res.headersSent) { res.destroy(); return; }
        if (error instanceof PerfError) { send(res, error.status, { error: error.message }); return; }
        throw error;
      }
    },
  };
}
