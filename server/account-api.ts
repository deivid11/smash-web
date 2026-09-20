/** HTTP routes for accounts, cloud saves, friends and presence (JSON over the
 * same origin as the game). The asset server (server/http.ts) stays GET/HEAD
 * only; these routes are the single place that accepts writes. Bearer tokens
 * (not cookies) carry the session, so cross-site form posts cannot act for a
 * player, and server/http.ts still rejects cross-origin requests first.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { ACCOUNT_API, FRIENDS_API, GAMES_API, PLAYERS_API, PRESENCE_API, SAVES_API } from '../lib/net/account-protocol.ts';
import { AccountError, AccountService, SaveConflict } from './accounts.ts';
import { isTournamentPath, routeTournaments } from './tournament-api.ts';
import type { TournamentService } from './tournaments.ts';

const MAX_BODY_BYTES = 300 * 1024;
const SMALL_BODY_BYTES = 4 * 1024;

interface Bucket { tokens: number; at: number }
/** Token buckets keyed by client address. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly capacity: number, private readonly perSecond: number, private readonly now: () => number) {}
  take(key: string, cost = 1): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + ((now - bucket.at) / 1000) * this.perSecond);
    bucket.at = now;
    if (this.buckets.size > 10_000) this.buckets.clear();
    this.buckets.set(key, bucket);
    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  }
}

export function isAccountPath(path: string): boolean {
  return isTournamentPath(path) || [ACCOUNT_API, SAVES_API, FRIENDS_API, PRESENCE_API, PLAYERS_API, GAMES_API].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Loopback peers are the TLS proxy (nginx on the gateway): trust its forwarded address. */
export function clientAddress(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? 'unknown';
  if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
    const forwarded = String(req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim();
    if (isIP(forwarded)) return forwarded;
  }
  return remote;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
  res.end(bytes);
}

async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/iu.test(String(req.headers['content-type'] ?? ''))) throw new AccountError(415, 'Send JSON (Content-Type: application/json).');
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new AccountError(413, 'Request body is too large.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new AccountError(413, 'Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new AccountError(400, 'Invalid JSON body.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AccountError(400, 'The JSON body must be an object.');
  return parsed as Record<string, unknown>;
}

export interface AccountApi {
  handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
  close(): void;
}

export function createAccountApi(service: AccountService | null, now: () => number = Date.now, tournaments: TournamentService | null = null): AccountApi {
  const general = new RateLimiter(120, 4, now);
  // A whole LAN party shares one address and every set lobby heartbeats: its own, roomier bucket.
  const lobby = new RateLimiter(300, 15, now);
  const auth = new RateLimiter(10, 1 / 6, now);
  const signups = new RateLimiter(5, 5 / 3600, now);
  // Per player, not per address: a finished game is one report, a Rift run one more.
  const games = new RateLimiter(20, 1 / 15, now);

  async function route(req: IncomingMessage, res: ServerResponse, path: string, accounts: AccountService): Promise<void> {
    const method = req.method ?? 'GET';
    const ip = clientAddress(req);
    if (!(isTournamentPath(path) ? lobby : general).take(ip)) throw new AccountError(429, 'Too many requests. Slow down a little.');
    const bearer = /^Bearer ([A-Za-z0-9_-]{16,128})$/u.exec(String(req.headers.authorization ?? ''))?.[1] ?? null;
    const user = (): number => accounts.authenticate(bearer);
    const allow = (...methods: string[]): void => {
      if (!methods.includes(method)) { res.setHeader('Allow', methods.join(', ')); throw new AccountError(405, 'Method not allowed.'); }
    };

    if (isTournamentPath(path)) {
      if (!tournaments) throw new AccountError(503, 'Tournaments are not enabled on this server.');
      await routeTournaments({ req, res, path, method, user, readJson: (limit) => readJson(req, limit), send: (status, body) => send(res, status, body) }, tournaments);
      return;
    }
    if (path === `${ACCOUNT_API}/register`) {
      allow('POST');
      if (!auth.take(ip) || !signups.take(ip)) throw new AccountError(429, 'Too many sign-up attempts. Try again later.');
      send(res, 201, await accounts.register(await readJson(req, SMALL_BODY_BYTES))); return;
    }
    if (path === `${ACCOUNT_API}/login`) {
      allow('POST');
      if (!auth.take(ip)) throw new AccountError(429, 'Too many sign-in attempts. Wait a minute.');
      send(res, 200, await accounts.login(await readJson(req, SMALL_BODY_BYTES))); return;
    }
    if (path === `${ACCOUNT_API}/logout`) {
      allow('POST');
      const id = user(); accounts.signOff(id); accounts.logout(bearer!);
      send(res, 200, { ok: true }); return;
    }
    if (path === ACCOUNT_API) {
      allow('GET', 'DELETE');
      const id = user();
      if (method === 'GET') { send(res, 200, { account: accounts.account(id) }); return; }
      if (!auth.take(ip)) throw new AccountError(429, 'Too many attempts. Wait a minute.');
      await accounts.deleteAccount(id, await readJson(req, SMALL_BODY_BYTES));
      send(res, 200, { ok: true }); return;
    }
    if (path === `${ACCOUNT_API}/profile`) {
      allow('PATCH');
      const id = user();
      send(res, 200, { account: accounts.updateProfile(id, await readJson(req, SMALL_BODY_BYTES)) }); return;
    }
    if (path === `${ACCOUNT_API}/password`) {
      allow('POST');
      const id = user();
      if (!auth.take(ip)) throw new AccountError(429, 'Too many attempts. Wait a minute.');
      await accounts.changePassword(id, bearer!, await readJson(req, SMALL_BODY_BYTES));
      send(res, 200, { ok: true }); return;
    }
    if (path.startsWith(`${SAVES_API}/`)) {
      allow('GET', 'PUT');
      const id = user(), slot = path.slice(SAVES_API.length + 1);
      if (method === 'GET') { send(res, 200, { save: accounts.getSave(id, slot) }); return; }
      const body = await readJson(req, MAX_BODY_BYTES);
      try { send(res, 200, accounts.putSave(id, slot, { data: body.data, baseRevision: body.baseRevision })); }
      catch (error) { if (error instanceof SaveConflict) { send(res, 409, { error: error.message, save: error.save }); return; } throw error; }
      return;
    }
    if (path === FRIENDS_API) { allow('GET'); send(res, 200, accounts.friends(user())); return; }
    if (path === `${FRIENDS_API}/requests`) {
      allow('POST');
      const id = user();
      send(res, 200, accounts.requestFriend(id, (await readJson(req, SMALL_BODY_BYTES)).username)); return;
    }
    if (path === `${FRIENDS_API}/respond`) {
      allow('POST');
      const id = user(), body = await readJson(req, SMALL_BODY_BYTES);
      send(res, 200, accounts.respondFriend(id, body.userId, body.accept)); return;
    }
    if (path === `${FRIENDS_API}/remove`) {
      allow('POST');
      const id = user();
      send(res, 200, accounts.removeFriend(id, (await readJson(req, SMALL_BODY_BYTES)).userId)); return;
    }
    if (path === `${FRIENDS_API}/invite`) {
      allow('POST');
      const id = user(), body = await readJson(req, SMALL_BODY_BYTES);
      accounts.invite(id, { friendId: body.userId, room: body.room });
      send(res, 200, { ok: true }); return;
    }
    if (path === `${FRIENDS_API}/invites/dismiss`) {
      allow('POST');
      const id = user();
      accounts.dismissInvite(id, (await readJson(req, SMALL_BODY_BYTES)).id);
      send(res, 200, { ok: true }); return;
    }
    // Public reads: the player directory and profile pages need no session.
    if (path === PLAYERS_API) {
      allow('GET');
      const query = new URL(req.url ?? path, 'http://local').searchParams;
      send(res, 200, accounts.players({ offset: query.get('offset'), limit: query.get('limit'), query: query.get('q') ?? '' })); return;
    }
    if (path.startsWith(`${PLAYERS_API}/`)) {
      allow('GET');
      let username = '';
      try { username = decodeURIComponent(path.slice(PLAYERS_API.length + 1)); } catch { /* 404 below */ }
      send(res, 200, accounts.playerProfile(username)); return;
    }
    if (path === GAMES_API) {
      allow('POST');
      const id = user();
      if (!games.take(String(id))) throw new AccountError(429, 'Too many game reports. Slow down a little.');
      send(res, 201, accounts.recordGame(id, await readJson(req, SMALL_BODY_BYTES))); return;
    }
    if (path === PRESENCE_API) {
      allow('POST');
      const id = user(), body = await readJson(req, SMALL_BODY_BYTES);
      send(res, 200, accounts.heartbeat(id, { activity: body.activity, room: body.room })); return;
    }
    throw new AccountError(404, 'Not found.');
  }

  return {
    async handle(req, res, path) {
      try {
        if (!service) throw new AccountError(503, 'Accounts are not enabled on this server.');
        await route(req, res, path, service);
      } catch (error) {
        if (res.headersSent) { res.destroy(); return; }
        if (error instanceof AccountError) { send(res, error.status, { error: error.message }); return; }
        console.error('Account request failed:', error instanceof Error ? error.message : 'Unknown error');
        send(res, 500, { error: 'The server could not complete this request.' });
      }
    },
    close() { tournaments?.close(); service?.close(); },
  };
}
