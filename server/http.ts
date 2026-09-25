import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { hostname } from 'node:os';
import { realpath, stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { brotliCompress, brotliCompressSync, gzip, gzipSync, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { resolve, sep, extname } from 'node:path';
import { MAX_ASSET_RESPONSE_BYTES, servedAssets } from '../lib/hsd/source-protocol.ts';
import type { IsoSource } from './iso-source.ts';
import { attachRoomServer } from './rooms.ts';
import { PartyHub, attachPartyServer } from './party-hub.ts';
import { VOICE_CONFIG_PATH } from '../lib/net/party-protocol.ts';
import { siteWebBundle } from './web-bundle.ts';
import { AccountService } from './accounts.ts';
import { TournamentService } from './tournaments.ts';
import { createAccountApi, isAccountPath } from './account-api.ts';
import { createPerfApi, isPerfPath } from './perf-api.ts';
import { createAnalytics, isVisitPath } from './analytics.ts';

export interface ByteRange { start: number; end: number; partial: boolean }
export function parseByteRange(header: string | undefined, size: number): ByteRange {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid asset size.');
  if (header === undefined) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2])) throw new Error('Invalid byte range.');
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error('Invalid suffix range.');
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) throw new Error('Unsatisfiable byte range.');
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

/** Who supplies the game discs. `server`: this host streams the allowlisted assets of its
 * own verified ISO. `client`: every player selects their own ISO in the browser; this host
 * opens no disc and exposes no game assets. `ace` only applies to client mode. */
export type ClientAcePolicy = 'optional' | 'required' | 'off';
interface Options {
  /** Absent in client-disc mode: no manifest, and every /api/assets name is a 404. */
  source?: IsoSource;
  /** Client-disc mode's ACE 2.0 extension policy (default `optional`). */
  clientAce?: ClientAcePolicy;
  staticRoot: string;
  allowedHosts?: string[];
  maxConcurrentAssetReads?: number;
  /** Memory budget for compressed whole-file asset bodies (default 192 MB). */
  compressedAssetBudget?: number;
  /** Android shell self-update channel (`/android/latest.json` + versioned APKs).
   * Host-only setting outside the static root, so code/dist deploys never wipe
   * published releases; absent = the channel answers 404. */
  androidDir?: string;
  /** SQLite file for accounts, cloud saves and friends (':memory:' in tests).
   * Absent = the account routes answer 503 and the game stays account-free. */
  databasePath?: string;
  /** Directory for client performance telemetry (JSONL per day). Absent = POST /api/perf answers 404. */
  perfDir?: string;
  /** SQLite file for visit/usage analytics (POST /api/visit). Absent = disabled. */
  analyticsPath?: string;
  /** Bearer token for downloading telemetry (GET /api/perf/files). Absent = export disabled. */
  perfToken?: string;
  /** Held-seat window for dropped LAN players (server/rooms.ts); 0 closes the match on any drop. */
  reconnectGraceMs?: number;
  /** RTCConfiguration.iceServers for every voice mesh (GET /api/voice/config). `[]` = host
   * candidates only (same LAN); absent = public STUN, which is what Internet parties need. */
  iceServers?: unknown[];
}
/** Update channel files: the APK pointer + immutable versioned packages, and the web
 * bundle pointer + immutable content-addressed game-code objects (sha256 names). */
const ANDROID_RELEASE = /^\/android\/(latest\.json|smash-web-[0-9]{1,12}\.apk|web\/latest\.json|web\/objects\/[0-9a-f]{64})$/u;
const MAX_ANDROID_PACKAGE_BYTES = 256 * 1024 * 1024;
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.LICENSE': 'text/plain; charset=utf-8',
};

export async function createMeleeServer(options: Options) {
  const root = await realpath(options.staticRoot);
  const allowedHosts = new Set(['localhost', hostname().toLowerCase(), `${hostname().toLowerCase()}.local`, ...(options.allowedHosts ?? []).map((host) => host.toLowerCase())]);
  const source = options.source;
  const clientAce: ClientAcePolicy = options.clientAce ?? 'optional';
  // The disc table plus each look's `look/<id>/…` files, by served name.
  const files = new Map((source ? servedAssets(source.manifest) : []).map((file) => [file.path, file]));
  // Client-disc mode still answers the probe (the Android shell uses it for reachability),
  // but with a descriptor that carries no disc identity and no file table.
  const manifest = Buffer.from(JSON.stringify(source ? source.manifest : { version: 1, mode: 'client', ace: clientAce }));
  const discMarker = source ? '' : `<meta name="smash-disc" content="client" data-ace="${clientAce}">\n`;
  const voiceConfig = Buffer.from(JSON.stringify({ iceServers: options.iceServers ?? [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] }));
  let activeAssetReads = 0;
  const maxReads = options.maxConcurrentAssetReads ?? 8;

  function json(res: ServerResponse, status: number, message: string): void {
    const body = Buffer.from(JSON.stringify({ error: message }));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(body);
  }
  function originError(req: IncomingMessage): { status: number; message: string } | null {
    let host: URL;
    try { host = new URL(`http://${req.headers.host ?? ''}`); } catch { return { status: 400, message: 'Invalid Host header.' }; }
    const name = host.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (!isIP(name) && !allowedHosts.has(name)) return { status: 403, message: 'Host is not allowed.' };
    // Top-level navigations are how links from anywhere arrive, and this GET/HEAD-only
    // server has no state they could mutate; only cross-origin READS from scripts are
    // blocked below (with CORP as the second layer for browsers without fetch metadata).
    if (['navigate', 'nested-navigate'].includes(String(req.headers['sec-fetch-mode']))) return null;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      // Compare authorities only: a TLS-terminating proxy changes the scheme, not the host.
      let authority: string;
      try { authority = new URL(origin).host.toLowerCase(); } catch { return { status: 403, message: 'Cross-origin access is not allowed.' }; }
      if (authority !== host.host.toLowerCase()) return { status: 403, message: 'Cross-origin access is not allowed.' };
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return { status: 403, message: 'Cross-origin access is not allowed.' };
    return null;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setTimeout(15_000, () => res.destroy());
    const denied = originError(req);
    if (denied) { json(res, denied.status, denied.message); return; }
    // Accounts, cloud saves and friends, plus performance telemetry intake, are the only routes that accept writes.
    const rawPath = (req.url ?? '/').split('?')[0]!;
    if (isAccountPath(rawPath)) { await accounts.handle(req, res, rawPath); return; }
    if (isPerfPath(rawPath)) { await perf.handle(req, res, rawPath); return; }
    if (isVisitPath(rawPath)) { await analytics.handle(req, res); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD'); json(res, 405, 'Only GET and HEAD are supported.'); return;
    }
    let path: string;
    try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://server').pathname); } catch { json(res, 400, 'Invalid request path.'); return; }
    if (path.includes('\\') || path.includes('\0') || path.split('/').some((part) => part === '..' || part === '.')) {
      json(res, 404, 'Not found.'); return;
    }
    if (path === '/api/source') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': manifest.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : manifest); return;
    }
    if (path === '/api/rooms') {
      // Public lobby directory for the room browser. Same path as the WebSocket
      // relay, but this is a plain GET/HEAD JSON read; upgrades bypass handle().
      // Only lobby counts, host name, rules and compatibility identity are exposed.
      const body = Buffer.from(JSON.stringify({ rooms: rooms.hub.listRooms() }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    if (path === VOICE_CONFIG_PATH) {
      // Past the same origin check as every route above. No-store: the host may rotate TURN credentials.
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': voiceConfig.length, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : voiceConfig); return;
    }
    if (path.startsWith('/api/assets/')) {
      const name = path.slice('/api/assets/'.length), file = files.get(name);
      if (!file) { json(res, 404, 'Asset is not exposed by this viewer.'); return; }
      let range: ByteRange;
      try { range = parseByteRange(req.headers.range, file.size); }
      catch { res.setHeader('Content-Range', `bytes */${file.size}`); json(res, 416, 'Invalid or unsatisfiable asset range.'); return; }
      const length = range.end - range.start + 1;
      if (length > MAX_ASSET_RESPONSE_BYTES) { json(res, 413, 'Asset range exceeds the response limit.'); return; }
      if (activeAssetReads >= maxReads) { res.setHeader('Retry-After', '1'); json(res, 503, 'Asset reader is busy.'); return; }
      const headers: Record<string, string | number> = {
        'Content-Type': 'application/octet-stream', 'Content-Length': length,
        'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
      };
      if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.size}`;
      if (req.method === 'HEAD') { res.writeHead(range.partial ? 206 : 200, headers); res.end(); return; }
      // Whole-file downloads (no Range) may be compressed: fighter and stage archives shrink to
      // 40–60%. Each file is compressed once and kept in a bounded cache; ranges stay identity.
      const accepted = range.partial ? '' : (req.headers['accept-encoding'] ?? '').toLowerCase();
      const assetEncoding = /\bbr\b/u.test(accepted) ? 'br' as const : /\bgzip\b/u.test(accepted) ? 'gzip' as const : null;
      const cachedBody = assetEncoding ? compressedAssets.get(`${assetEncoding}:${name}`) : undefined;
      if (assetEncoding && cachedBody) { sendCompressedAsset(res, headers, assetEncoding, name, cachedBody); return; }
      activeAssetReads++;
      let released = false;
      const release = () => { if (!released) { activeAssetReads--; released = true; } };
      res.once('finish', release); res.once('close', release);
      const bytes = await source!.read(name, range.start, length);
      if (bytes.byteLength !== length) throw new Error('ISO asset read returned an unexpected length.');
      if (res.destroyed) return;
      if (assetEncoding && cachedBody === undefined) {
        const body = await compressAsset(assetEncoding, name, bytes);
        if (res.destroyed) return;
        if (body) { sendCompressedAsset(res, headers, assetEncoding, name, body); return; }
      }
      res.writeHead(range.partial ? 206 : 200, headers); res.end(bytes); return;
    }
    if (path.startsWith('/api/')) { json(res, 404, 'Not found.'); return; }
    const release = ANDROID_RELEASE.exec(path);
    if (release) { await serveAndroidRelease(req, res, release[1]!); return; }
    if (path === '/') { res.writeHead(302, { Location: '/play', 'Cache-Control': 'no-store' }); res.end(); return; }
    // Clean game URLs: the game, the public player directory and a profile are all play.html (one React app
    // that reads the path). /play.html itself stays: installed Android shells and the offline worker load it.
    if (path === '/play' || path === '/players' || /^\/players\/[A-Za-z0-9_]{3,20}$/u.test(path)) path = '/play.html';
    // /sw.js: the offline app-shell worker registered by play-page (web/public/sw.js).
    const allowed = path === '/play.html' || path === '/viewer.html' || path === '/index.html' || path === '/sw.js' ||
      /^\/(assets|wasm|licenses)\/[a-zA-Z0-9_.-]+$/u.test(path);
    const type = mime[extname(path)];
    if (!allowed || !type) { json(res, 404, 'Not found.'); return; }
    let filename: string;
    try { filename = await realpath(resolve(root, `.${path}`)); }
    catch { json(res, 404, 'Not found.'); return; }
    if (!filename.startsWith(root + sep)) { json(res, 404, 'Not found.'); return; }
    const info = await stat(filename);
    if (!info.isFile() || info.size > 8 * 1024 * 1024) { json(res, 404, 'Not found.'); return; }
    const entry = await staticEntry(path, filename, info.size, info.mtimeMs);
    // Hashed bundle names are immutable; everything else revalidates through its ETag.
    const cacheControl = /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[a-z]+$/u.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match']?.split(',').map(tag => tag.trim()).includes(entry.etag)) {
      res.writeHead(304, { ETag: entry.etag, 'Cache-Control': cacheControl }); res.end(); return;
    }
    const accepted = (req.headers['accept-encoding'] ?? '').toLowerCase();
    const encoding = /\bbr\b/u.test(accepted) ? 'br' : /\bgzip\b/u.test(accepted) ? 'gzip' : null;
    const body = encoding === 'br' ? entry.brotli : encoding === 'gzip' ? entry.gzip : entry.body;
    const headers: Record<string, string | number> = { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': cacheControl, ETag: entry.etag };
    if (encoding) headers['Content-Encoding'] = encoding;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  /** Streams update-channel files (APKs are too large for the compressed static
   * cache and are already compressed). latest.json always revalidates; a
   * versioned APK never changes once published. */
  const siteBundle = siteWebBundle(options.staticRoot);
  /** Version of a manually published web bundle (SMASH_ANDROID_DIR/web/latest.json), if any. */
  async function publishedWebVersion(): Promise<number | null> {
    if (!options.androidDir) return null;
    try {
      const version = (JSON.parse(await readFile(resolve(options.androidDir, 'web/latest.json'), 'utf8')) as { version?: unknown }).version;
      return typeof version === 'number' && Number.isSafeInteger(version) ? version : null;
    } catch { return null; }
  }
  async function sendReleaseFile(req: IncomingMessage, res: ServerResponse, filename: string, size: number, headers: Record<string, string>): Promise<void> {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') { res.end(); return; }
    await new Promise<void>((done) => {
      const stream = createReadStream(filename);
      stream.once('error', () => { res.destroy(); done(); });
      res.once('close', () => { stream.destroy(); done(); });
      stream.pipe(res);
    });
  }
  async function serveAndroidRelease(req: IncomingMessage, res: ServerResponse, name: string): Promise<void> {
    // Game code for installed apps follows the deployed website automatically; a
    // manually published bundle (publish-web.sh) wins only while it is newer.
    if (name === 'web/latest.json' || name.startsWith('web/objects/')) {
      const site = await siteBundle();
      if (site && name === 'web/latest.json') {
        const published = await publishedWebVersion();
        if (published === null || site.version >= published) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': site.json.length, 'Cache-Control': 'no-cache' });
          res.end(req.method === 'HEAD' ? undefined : site.json); return;
        }
      }
      const object = site?.objects.get(name.slice('web/objects/'.length));
      if (object) {
        const info = await stat(object).catch(() => null);
        if (info?.isFile()) {
          await sendReleaseFile(req, res, object, info.size, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' }); return;
        }
      }
    }
    if (!options.androidDir) { json(res, 404, 'Not found.'); return; }
    let filename: string, dir: string;
    try { dir = await realpath(options.androidDir); filename = await realpath(resolve(dir, name)); }
    catch { json(res, 404, 'Not found.'); return; }
    if (!filename.startsWith(dir + sep)) { json(res, 404, 'Not found.'); return; }
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_ANDROID_PACKAGE_BYTES) { json(res, 404, 'Not found.'); return; }
    const apk = name.endsWith('.apk'), object = name.startsWith('web/objects/');
    await sendReleaseFile(req, res, filename, info.size, {
      'Content-Type': apk ? 'application/vnd.android.package-archive' : object ? 'application/octet-stream' : 'application/json; charset=utf-8',
      'Cache-Control': apk || object ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(apk ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}),
    });
  }
  /** Compressed whole ISO assets by `encoding:name` (the manifest is fixed for the server's life);
   * null marks files that do not shrink enough to be worth it. Bounded LRU by compressed bytes. */
  const compressedAssets = new Map<string, Buffer | null>();
  const compressingAssets = new Map<string, Promise<Buffer | null>>();
  const compressedAssetBudget = options.compressedAssetBudget ?? 192 * 1024 * 1024;
  let compressedAssetBytes = 0;
  const brotliAsync = promisify(brotliCompress), gzipAsync = promisify(gzip);
  function compressAsset(encoding: 'br' | 'gzip', name: string, bytes: Uint8Array): Promise<Buffer | null> {
    const key = `${encoding}:${name}`;
    let pending = compressingAssets.get(key);
    if (!pending) {
      // Brotli quality 5 / gzip level 6: near-best ratio on these archives at a few ms per MB.
      pending = (encoding === 'br'
        ? brotliAsync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength } })
        : gzipAsync(bytes, { level: 6 })).then((body) => {
        const kept = body.length <= bytes.byteLength * 0.9 ? body : null;
        compressedAssets.set(key, kept);
        compressedAssetBytes += kept?.length ?? 0;
        for (const [oldKey, oldBody] of compressedAssets) {
          if (compressedAssetBytes <= compressedAssetBudget) break;
          if (oldKey === key) continue;
          compressedAssets.delete(oldKey); compressedAssetBytes -= oldBody?.length ?? 0;
        }
        return kept;
      }).finally(() => compressingAssets.delete(key));
      compressingAssets.set(key, pending);
    }
    return pending;
  }
  function sendCompressedAsset(res: ServerResponse, headers: Record<string, string | number>, encoding: 'br' | 'gzip', name: string, body: Buffer): void {
    // Most recently served stays newest in the LRU order.
    const key = `${encoding}:${name}`;
    compressedAssets.delete(key); compressedAssets.set(key, body);
    res.writeHead(200, { ...headers, 'Content-Encoding': encoding, 'Content-Length': body.length, Vary: 'Accept-Encoding' });
    res.end(body);
  }
  interface StaticEntry { size: number; mtimeMs: number; etag: string; body: Buffer; gzip: Buffer; brotli: Buffer }
  const staticEntries = new Map<string, StaticEntry>();
  /** Static files are compressed once per (size, mtime) and served with a strong ETag. */
  async function staticEntry(path: string, filename: string, size: number, mtimeMs: number): Promise<StaticEntry> {
    const cached = staticEntries.get(path);
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached;
    let body = await readFile(filename);
    if (path === '/viewer.html' || path === '/play.html') {
      const html = body.toString('utf8');
      if (!html.includes('</head>')) throw new Error('Viewer HTML has no configuration insertion point.');
      body = Buffer.from(html.replace('</head>', `<meta name="smash-source" content="server">\n${discMarker}</head>`));
    }
    const entry: StaticEntry = {
      size, mtimeMs, body, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
      gzip: gzipSync(body, { level: 9 }),
      brotli: brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length } }),
    };
    if (staticEntries.size >= 64) staticEntries.delete(staticEntries.keys().next().value!);
    staticEntries.set(path, entry);
    return entry;
  }

  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 15_000, keepAliveTimeout: 5000 }, (req, res) => {
    void handle(req, res).catch((error: unknown) => {
      console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
      if (res.destroyed) return;
      if (res.headersSent) res.destroy(); else json(res, 500, 'The server could not complete this request.');
    });
  });
  server.maxConnections = 64;
  // Browser WebSockets must provide an exact same-origin Origin, unlike CLI asset reads.
  const rooms = attachRoomServer(server, { authorize: req => req.headers.origin !== undefined && originError(req) === null, ...(options.reconnectGraceMs === undefined ? {} : { reconnectGraceMs: options.reconnectGraceMs }) });
  // HTTP closeAllConnections does not close upgraded WebSockets. Close the relay
  // first so the existing SIGTERM shutdown can release its ISO handle promptly.
  const closeHttp = server.close.bind(server);
  const perf = createPerfApi({ dir: options.perfDir ?? null, token: options.perfToken ?? null });
  const analytics = createAnalytics({ path: options.analyticsPath ?? null });
  const accountService = options.databasePath ? new AccountService({ path: options.databasePath, listRooms: () => rooms.hub.listRooms() }) : null;
  const accounts = createAccountApi(accountService, Date.now, accountService ? new TournamentService({ path: options.databasePath!, accounts: accountService }) : null);
  // Party chat is account-bound: without accounts its socket path answers a clean 503 (hub: null).
  const partyAccounts = accountService;
  const party = attachPartyServer(server, { authorize: req => req.headers.origin !== undefined && originError(req) === null,
    hub: partyAccounts ? new PartyHub({ directory: { authenticate: token => partyAccounts.authenticate(token), profile: id => partyAccounts.profileById(id), friendIds: id => partyAccounts.friendIdsOf(id) } }) : null });
  server.close = callback => { rooms.close(); party.close(); return closeHttp(error => { accounts.close(); analytics.close(); callback?.(error); }); };
  return server;
}
