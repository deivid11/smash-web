import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AccountError, AccountService, SaveConflict, type LobbyRoom } from '../../server/accounts.ts';
import { createMeleeServer } from '../../server/http.ts';
import { sourceFixture } from './source-fixture.ts';
import { INVITE_TTL_MS, PRESENCE_TTL_MS } from '../../lib/net/account-protocol.ts';

let clock = 1_000_000;
let rooms: LobbyRoom[] = [];
let service: AccountService;
const make = () => new AccountService({ path: ':memory:', now: () => clock, listRooms: () => rooms, scryptCost: 1024 });
const status = async (promise: Promise<unknown> | (() => unknown)): Promise<number> => {
  try { await (typeof promise === 'function' ? promise() : promise); return 0; } catch (error) { return error instanceof AccountError ? error.status : -1; }
};

beforeEach(() => { clock = 1_000_000; rooms = []; service = make(); });
afterEach(() => service.close());

describe('account service', () => {
  it('registers, signs in, and rejects bad credentials without revealing which part was wrong', async () => {
    const { token, account } = await service.register({ username: 'Falco_1', password: 'correct horse', displayName: '  Falco  Lombardi ' });
    expect(account).toMatchObject({ username: 'Falco_1', displayName: 'Falco Lombardi', avatar: 'Mr', friends: 0, rift: null });
    expect(service.authenticate(token)).toBe(account.id);
    expect(await status(service.register({ username: 'falco_1', password: 'another password' }))).toBe(409);
    expect(await status(service.register({ username: 'no', password: 'long enough' }))).toBe(400);
    expect(await status(service.register({ username: 'shorty', password: 'short' }))).toBe(400);
    const login = await service.login({ username: 'FALCO_1', password: 'correct horse' });
    expect(login.account.id).toBe(account.id);
    const wrong = await service.login({ username: 'Falco_1', password: 'wrong horse' }).catch((error: unknown) => error) as AccountError;
    const unknown = await service.login({ username: 'Nobody', password: 'wrong horse' }).catch((error: unknown) => error) as AccountError;
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.message).toBe(unknown.message);
  });

  it('expires sessions, logs out, and signs other devices out on password change', async () => {
    const first = await service.register({ username: 'marth', password: 'password one' });
    const second = await service.login({ username: 'marth', password: 'password one' });
    await service.changePassword(first.account.id, first.token, { current: 'password one', next: 'password two' });
    expect(service.authenticate(first.token)).toBe(first.account.id);
    expect(await status(() => service.authenticate(second.token))).toBe(401);
    expect(await status(service.login({ username: 'marth', password: 'password one' }))).toBe(401);
    service.logout(first.token);
    expect(await status(() => service.authenticate(first.token))).toBe(401);
    const third = await service.login({ username: 'marth', password: 'password two' });
    clock += 61 * 24 * 60 * 60_000;
    expect(await status(() => service.authenticate(third.token))).toBe(401);
  });

  it('validates profile edits', async () => {
    const { account } = await service.register({ username: 'peach', password: 'toadstool!' });
    expect(service.updateProfile(account.id, { displayName: 'Princess', avatar: 'Pe', title: 'Rift Walker' })).toMatchObject({ displayName: 'Princess', avatar: 'Pe', title: 'Rift Walker' });
    expect(await status(() => service.updateProfile(account.id, { displayName: '' }))).toBe(400);
    expect(await status(() => service.updateProfile(account.id, { displayName: 'bad\u0000name' }))).toBe(400);
    expect(await status(() => service.updateProfile(account.id, { avatar: '../x' }))).toBe(400);
    expect(await status(() => service.updateProfile(account.id, { title: 'x'.repeat(33) }))).toBe(400);
  });

  it('stores cloud saves with optimistic revisions and exposes rift stats on the profile', async () => {
    const { account } = await service.register({ username: 'kirby', password: 'poyo poyo' });
    expect(service.getSave(account.id, 'rift')).toBeNull();
    const data = { format: 1, meta: { shards: 40, keys: 2, stats: { runs: 3, wins: 1, bestHeatWin: 0 } }, best: { score: 900, cleared: 12 } };
    expect(service.putSave(account.id, 'rift', { data, baseRevision: 0 }).revision).toBe(1);
    const conflict = await status(() => service.putSave(account.id, 'rift', { data, baseRevision: 0 }));
    expect(conflict).toBe(409);
    try { service.putSave(account.id, 'rift', { data, baseRevision: 0 }); } catch (error) { expect((error as SaveConflict).save.revision).toBe(1); }
    expect(service.putSave(account.id, 'rift', { data: { ...data, meta: { ...data.meta, shards: 10 } }, baseRevision: 1 }).revision).toBe(2);
    expect(service.getSave(account.id, 'rift')).toMatchObject({ revision: 2, data: { meta: { shards: 10 } } });
    expect(service.account(account.id).rift).toMatchObject({ runs: 3, wins: 1, bestScore: 900, bestCleared: 12, shards: 10, keys: 2 });
    expect(await status(() => service.getSave(account.id, 'other'))).toBe(404);
    expect(await status(() => service.putSave(account.id, 'rift', { data: [1], baseRevision: 2 }))).toBe(400);
    expect(await status(() => service.putSave(account.id, 'rift', { data: { blob: 'x'.repeat(300 * 1024) }, baseRevision: 2 }))).toBe(413);
  });

  it('runs the friend request flow, including crossing requests and removal', async () => {
    const a = await service.register({ username: 'alpha', password: 'password a' });
    const b = await service.register({ username: 'bravo', password: 'password b' });
    const c = await service.register({ username: 'charlie', password: 'password c' });
    expect(await status(() => service.requestFriend(a.account.id, 'alpha'))).toBe(400);
    expect(await status(() => service.requestFriend(a.account.id, 'nobody_here'))).toBe(404);
    expect(service.requestFriend(a.account.id, 'bravo').outgoing.map((entry) => entry.profile.username)).toEqual(['bravo']);
    expect(await status(() => service.requestFriend(a.account.id, 'BRAVO'))).toBe(409);
    expect(service.friends(b.account.id).incoming.map((entry) => entry.profile.username)).toEqual(['alpha']);
    expect(service.respondFriend(b.account.id, a.account.id, true).friends.map((entry) => entry.profile.username)).toEqual(['alpha']);
    expect(service.account(a.account.id).friends).toBe(1);
    // Crossing request: C asks A, then A asks C, which accepts.
    service.requestFriend(c.account.id, 'alpha');
    expect(service.requestFriend(a.account.id, 'charlie').friends.map((entry) => entry.profile.username).sort()).toEqual(['bravo', 'charlie']);
    expect(service.removeFriend(a.account.id, b.account.id).friends.map((entry) => entry.profile.username)).toEqual(['charlie']);
    expect(service.friends(b.account.id).friends).toEqual([]);
    service.requestFriend(b.account.id, 'charlie');
    expect(service.respondFriend(c.account.id, b.account.id, false).incoming).toEqual([]);
    expect(await status(() => service.respondFriend(c.account.id, b.account.id, true))).toBe(404);
  });

  it('tracks presence, joinable rooms and invites between friends only', async () => {
    const a = await service.register({ username: 'host', password: 'password a' });
    const b = await service.register({ username: 'guest', password: 'password b' });
    const stranger = await service.register({ username: 'stranger', password: 'password c' });
    service.requestFriend(a.account.id, 'guest');
    service.respondFriend(b.account.id, a.account.id, true);
    rooms = [{ code: 'ABC234', players: 2, maxPlayers: 8 }];
    service.heartbeat(a.account.id, { activity: 'lan', room: 'ABC234' });
    const seen = service.friends(b.account.id).friends[0]!;
    expect(seen).toMatchObject({ online: true, activity: 'lan', room: { code: 'ABC234', joinable: true } });
    expect(await status(() => service.invite(stranger.account.id, { friendId: b.account.id, room: 'ABC234' }))).toBe(403);
    expect(await status(() => service.invite(a.account.id, { friendId: b.account.id, room: 'ZZZ999' }))).toBe(409);
    service.invite(a.account.id, { friendId: b.account.id, room: 'ABC234' });
    service.invite(a.account.id, { friendId: b.account.id, room: 'ABC234' });
    const beat = service.heartbeat(b.account.id, { activity: 'menu', room: null });
    expect(beat).toMatchObject({ onlineFriends: 1, incoming: 0 });
    expect(beat.invites).toHaveLength(1);
    expect(beat.invites[0]).toMatchObject({ from: { username: 'host' }, room: { code: 'ABC234' } });
    // A closed room hides the invite; an expired one drops it.
    rooms = [];
    expect(service.friends(b.account.id).invites).toEqual([]);
    rooms = [{ code: 'ABC234', players: 3, maxPlayers: 8 }];
    service.dismissInvite(b.account.id, beat.invites[0]!.id);
    expect(service.friends(b.account.id).invites).toEqual([]);
    service.invite(a.account.id, { friendId: b.account.id, room: 'ABC234' });
    clock += INVITE_TTL_MS + 1;
    expect(service.friends(b.account.id).invites).toEqual([]);
    clock += PRESENCE_TTL_MS;
    expect(service.friends(b.account.id).friends[0]).toMatchObject({ online: false, room: null });
  });

  it('deletes an account with its sessions, saves and friendships', async () => {
    const a = await service.register({ username: 'leaver', password: 'password a' });
    const b = await service.register({ username: 'stayer', password: 'password b' });
    service.requestFriend(a.account.id, 'stayer');
    service.respondFriend(b.account.id, a.account.id, true);
    service.putSave(a.account.id, 'rift', { data: { meta: {} }, baseRevision: 0 });
    expect(await status(service.deleteAccount(a.account.id, { password: 'nope nope' }))).toBe(403);
    await service.deleteAccount(a.account.id, { password: 'password a' });
    expect(await status(() => service.authenticate(a.token))).toBe(401);
    expect(service.friends(b.account.id).friends).toEqual([]);
    expect((await service.register({ username: 'leaver', password: 'password z' })).account.rift).toBeNull();
  });
});

describe('account HTTP API', () => {
  let server: Server;
  let base: string;
  let directory: string;
  beforeAll(async () => {
    const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'account-tests-'));
    await writeFile(join(directory, 'play.html'), '<html><head></head><body></body></html>');
    server = await createMeleeServer({ source: { manifest: sourceFixture(), read: async () => new Uint8Array(), close: async () => {} }, staticRoot: directory, databasePath: ':memory:' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const call = (path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) => fetch(`${base}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  it('registers, reads the account, syncs a save and signs out', async () => {
    const created = await call('/api/account/register', { body: { username: 'httpuser', password: 'http password' } });
    expect(created.status).toBe(201);
    const { token } = await created.json() as { token: string };
    expect((await call('/api/account')).status).toBe(401);
    expect(await (await call('/api/account', { token })).json()).toMatchObject({ account: { username: 'httpuser' } });
    const put = await call('/api/saves/rift', { method: 'PUT', token, body: { data: { meta: { shards: 5 } }, baseRevision: 0 } });
    expect(await put.json()).toMatchObject({ revision: 1 });
    const stale = await call('/api/saves/rift', { method: 'PUT', token, body: { data: { meta: { shards: 1 } }, baseRevision: 0 } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ save: { revision: 1, data: { meta: { shards: 5 } } } });
    expect(await (await call('/api/saves/rift', { token })).json()).toMatchObject({ save: { revision: 1 } });
    expect((await call('/api/presence', { token, body: { activity: 'rift', room: null } })).status).toBe(200);
    expect((await call('/api/account/logout', { token, body: {} })).status).toBe(200);
    expect((await call('/api/account', { token })).status).toBe(401);
  });

  it('rejects wrong methods, non-JSON bodies, cross-site writes and keeps assets read-only', async () => {
    expect((await call('/api/account/login')).status).toBe(405);
    expect((await fetch(`${base}/api/account/login`, { method: 'POST', body: 'username=a&password=b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status).toBe(415);
    expect((await call('/api/account/login', { body: { username: 'x' }, headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(`${base}/api/assets/GrNBa.dat`, { method: 'POST', body: 'data' })).status).toBe(405);
    expect((await call('/api/account/nope', { body: {} })).status).toBe(404);
  });

  it('rate-limits repeated sign-in attempts per address', async () => {
    const codes: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) codes.push((await call('/api/account/login', { body: { username: 'ghost', password: 'wrong password' } })).status);
    expect(codes.filter((code) => code === 401).length).toBeGreaterThan(0);
    expect(codes.at(-1)).toBe(429);
  });
});
