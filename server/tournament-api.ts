/** HTTP routes for LAN tournaments. server/account-api.ts owns the listener
 * side (bearer auth, JSON parsing, error mapping) and delegates every path
 * under TOURNAMENTS_API here, so this file is only a path table.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TOURNAMENTS_API } from '../lib/net/tournament-protocol.ts';
import { AccountError } from './accounts.ts';
import type { TournamentService } from './tournaments.ts';

/** Create bodies carry up to 32 usernames plus rules; everything else is a few flags. */
const CREATE_BODY_BYTES = 8 * 1024;
const SMALL_BODY_BYTES = 2 * 1024;

export interface TournamentRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  /** Path without the query string. */
  path: string;
  method: string;
  /** Authenticates the bearer token (throws 401). */
  user: () => number;
  readJson: (limit: number) => Promise<Record<string, unknown>>;
  send: (status: number, body: unknown) => void;
}

export function isTournamentPath(path: string): boolean {
  return path === TOURNAMENTS_API || path.startsWith(`${TOURNAMENTS_API}/`);
}

export async function routeTournaments(ctx: TournamentRouteContext, service: TournamentService): Promise<void> {
  const { method, path, send } = ctx;
  const allow = (...methods: string[]): void => {
    if (!methods.includes(method)) { ctx.res.setHeader('Allow', methods.join(', ')); throw new AccountError(405, 'Method not allowed.'); }
  };
  const parts = path.slice(TOURNAMENTS_API.length).split('/').filter(Boolean);

  if (parts.length === 0) {
    allow('GET', 'POST');
    const id = ctx.user();
    if (method === 'GET') { send(200, service.list(id)); return; }
    send(201, { tournament: service.create(id, await ctx.readJson(CREATE_BODY_BYTES)) }); return;
  }
  // `users` can never be a tournament id: ids are 8 characters.
  if (parts.length === 1 && parts[0] === 'users') {
    allow('GET');
    ctx.user();
    // server/http.ts strips the query before routing, so read it off the request itself.
    const query = new URLSearchParams((ctx.req.url ?? '').split('?')[1] ?? '').get('q') ?? '';
    send(200, { users: service.searchUsers(query) }); return;
  }
  const id = parts[0]!;
  if (parts.length === 1) {
    allow('GET', 'DELETE');
    const user = ctx.user();
    if (method === 'GET') { send(200, { tournament: service.get(user, id) }); return; }
    service.remove(user, id);
    send(200, { ok: true }); return;
  }
  if (parts.length === 2 && parts[1] === 'cancel') {
    allow('POST');
    const user = ctx.user();
    await ctx.readJson(SMALL_BODY_BYTES);
    send(200, { tournament: service.cancel(user, id) }); return;
  }
  if (parts.length === 4 && parts[1] === 'sets' && /^\d{1,3}$/u.test(parts[2]!) && ['checkin', 'result', 'reopen'].includes(parts[3]!)) {
    allow('POST');
    const user = ctx.user(), matchId = Number(parts[2]), body = await ctx.readJson(SMALL_BODY_BYTES);
    const tournament = parts[3] === 'checkin' ? service.checkin(user, id, matchId, body) : parts[3] === 'result' ? service.report(user, id, matchId, body) : service.reopen(user, id, matchId);
    send(200, { tournament }); return;
  }
  throw new AccountError(404, 'Not found.');
}
