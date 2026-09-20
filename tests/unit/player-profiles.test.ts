import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AccountError, AccountService } from '../../server/accounts.ts';
import { createMeleeServer } from '../../server/http.ts';
import { sourceFixture } from './source-fixture.ts';
import { matchReport, matchResult, riftReport, type EndedFighter, type EndedMatch } from '../../web/src/account/game-report.ts';
import type { GameReport, PlayerProfileResponse, PlayersResponse } from '../../lib/net/account-protocol.ts';

let clock = 1_000_000;
let service: AccountService;
const make = (path = ':memory:') => new AccountService({ path, now: () => clock, scryptCost: 1024 });
const status = (fn: () => unknown): number => {
  try { fn(); return 0; } catch (error) { return error instanceof AccountError ? error.status : -1; }
};
let serial = 0;
const game = (patch: Partial<GameReport> = {}): GameReport => ({
  clientId: `game-${String(++serial).padStart(6, '0')}`, mode: 'local', result: 'win', fighter: 'Fx', stage: 'battlefield', players: 2,
  kos: 3, falls: 1, damage: 240, seconds: 95, rules: ['stocks:3'], opponents: [{ name: 'CPU', fighter: 'Mr', cpu: true }], rift: null, ...patch,
});

beforeEach(() => { clock = 1_000_000; service = make(); });
afterEach(() => service.close());

describe('game history service', () => {
  it('records games once per clientId and totals them on the public profile', async () => {
    const { account } = await service.register({ username: 'fox_main', password: 'password one' });
    const first = game();
    expect(service.recordGame(account.id, first as unknown as Record<string, unknown>).id).toBeGreaterThan(0);
    expect(service.recordGame(account.id, first as unknown as Record<string, unknown>).id).toBeNull();
    clock += 1000;
    service.recordGame(account.id, game({ result: 'loss', fighter: 'Fc', mode: 'lan', kos: 1, falls: 3 }) as unknown as Record<string, unknown>);
    clock += 1000;
    service.recordGame(account.id, game({ mode: 'rift', result: 'win', stage: 'rift', players: 1, opponents: [], rift: { cleared: 8, length: 8, bossesDown: 2, fightsWon: 7, heat: 1, score: 4200 } }) as unknown as Record<string, unknown>);
    const page = service.playerProfile('FOX_MAIN');
    expect(page.profile.username).toBe('fox_main');
    expect(page.stats).toMatchObject({ games: 3, wins: 2, losses: 1, draws: 0, kos: 7, falls: 5, lastPlayedAt: 1_002_000 });
    expect(page.stats.byMode).toMatchObject({ local: { games: 1, wins: 1 }, lan: { games: 1, wins: 0 }, rift: { games: 1, wins: 1 }, tournament: { games: 0, wins: 0 } });
    expect(page.stats.fighters[0]).toEqual({ fighter: 'Fx', games: 2, wins: 2 });
    expect(page.recent.map((entry) => entry.mode)).toEqual(['rift', 'lan', 'local']);
    expect(page.recent[0]!.rift).toEqual({ cleared: 8, length: 8, bossesDown: 2, fightsWon: 7, heat: 1, score: 4200 });
    expect(page.recent[2]!.opponents).toEqual([{ name: 'CPU', fighter: 'Mr', cpu: true }]);
    expect(page.rift).toBeNull();
    expect(status(() => service.playerProfile('nobody_here'))).toBe(404);
  });

  it('preserves namespaced custom fighters in avatars, game history and Rift records', async () => {
    const kind = `custom:${'n'.repeat(24)}.${'c'.repeat(24)}`;
    const { account } = await service.register({ username: 'pack_owner', password: 'local test password' });
    expect(service.updateProfile(account.id, { avatar: kind }).avatar).toBe(kind);
    service.recordGame(account.id, game({ fighter: kind, opponents: [{ name: 'Custom rival', fighter: 'custom:example.dummy', cpu: true }] }) as unknown as Record<string, unknown>);
    service.putSave(account.id, 'rift', { baseRevision: 0, data: {
      meta: { champions: { [kind]: { xp: 25, runs: 2, wins: 1 }, 'custom:../secret': { xp: 999, runs: 1, wins: 1 } }, stats: { runs: 2, wins: 1 } },
      best: { score: 100, cleared: 2, fighter: kind, heat: 0 },
    } });
    const page = service.playerProfile('pack_owner');
    expect(page.recent[0]?.fighter).toBe(kind);
    expect(page.recent[0]?.opponents[0]?.fighter).toBe('custom:example.dummy');
    expect(page.stats.fighters[0]?.fighter).toBe(kind);
    expect(page.rift?.bestFighter).toBe(kind);
    expect(page.rift?.champions).toEqual([{ fighter: kind, xp: 25, runs: 2, wins: 1 }]);
    expect(status(() => service.updateProfile(account.id, { avatar: 'custom:../secret' }))).toBe(400);
    expect(status(() => service.recordGame(account.id, { ...game(), fighter: 'custom:../secret' }))).toBe(400);
  });

  it('rejects malformed reports', async () => {
    const { account } = await service.register({ username: 'checker', password: 'password one' });
    const bad = (patch: Record<string, unknown>) => status(() => service.recordGame(account.id, { ...game(), ...patch }));
    expect(bad({ clientId: 'x' })).toBe(400);
    expect(bad({ mode: 'ranked' })).toBe(400);
    expect(bad({ result: 'forfeit' })).toBe(400);
    expect(bad({ fighter: '../etc' })).toBe(400);
    expect(bad({ stage: 'a b' })).toBe(400);
    expect(bad({ players: 0 })).toBe(400);
    expect(bad({ opponents: Array.from({ length: 8 }, () => ({ name: 'x', fighter: 'Mr', cpu: true })) })).toBe(400);
    expect(bad({ mode: 'rift', rift: null })).toBe(400);
    // Numbers are clamped, junk rules dropped, names cleaned.
    service.recordGame(account.id, { ...game(), kos: 1e9, rules: ['stocks:3', 'DROP TABLE'], opponents: [{ name: '  Evil\u0000 ', fighter: 'Mr', cpu: false }] });
    const [stored] = service.playerProfile('checker').recent;
    expect(stored).toMatchObject({ kos: 999, rules: ['stocks:3'], opponents: [{ name: 'Player', fighter: 'Mr', cpu: false }] });
  });

  it('lists every registered player, most recently active first, with a name filter', async () => {
    const a = (await service.register({ username: 'alpha', password: 'password one' })).account;
    clock += 10;
    await service.register({ username: 'bravo', password: 'password one', displayName: 'Bravo Six' });
    clock += 10;
    const c = (await service.register({ username: 'charlie', password: 'password one' })).account;
    service.recordGame(a.id, game() as unknown as Record<string, unknown>);
    clock += 10;
    service.recordGame(c.id, game({ result: 'loss' }) as unknown as Record<string, unknown>);
    const all = service.players({});
    expect(all.total).toBe(3);
    expect(all.players.map((entry) => [entry.profile.username, entry.games, entry.wins])).toEqual([['charlie', 1, 0], ['alpha', 1, 1], ['bravo', 0, 0]]);
    expect(service.players({ query: 'bra' }).players.map((entry) => entry.profile.username)).toEqual(['bravo']);
    expect(service.players({ query: 'Bravo S' }).total).toBe(1);
    expect(service.players({ query: '%' }).total).toBe(0);
    expect(service.players({ limit: 1, offset: 1 }).players.map((entry) => entry.profile.username)).toEqual(['alpha']);
  });

  it('reads the lifetime Rift record and champions from the cloud save', async () => {
    const { account } = await service.register({ username: 'rifter', password: 'password one' });
    service.putSave(account.id, 'rift', { baseRevision: 0, data: {
      meta: { shards: 12, keys: 3, champions: { Fx: { xp: 40, runs: 4, wins: 1 }, Mr: { xp: 0, runs: 0, wins: 0 } }, stats: { runs: 4, wins: 1, bossesDown: 5, elitesDown: 2, eventsVisited: 9, coinsSpent: 300, duoRuns: 1, bestHeatWin: 0 } },
      best: { score: 900, cleared: 6, fighter: 'Fx', heat: 0 },
    } });
    expect(service.playerProfile('rifter').rift).toMatchObject({
      runs: 4, wins: 1, bestScore: 900, bestCleared: 6, shards: 12, keys: 3, bossesDown: 5, elitesDown: 2, eventsVisited: 9, duoRuns: 1, bestFighter: 'Fx',
      champions: [{ fighter: 'Fx', runs: 4, wins: 1, xp: 40 }],
    });
  });

  it('deletes a player\'s games with the account', async () => {
    const { account } = await service.register({ username: 'leaver', password: 'password one' });
    service.recordGame(account.id, game() as unknown as Record<string, unknown>);
    await service.deleteAccount(account.id, { password: 'password one' });
    expect(service.players({}).total).toBe(0);
  });

  it('migrates a version-1 database in place', async () => {
    const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(join(parent, 'games-migrate-'));
    const path = join(directory, 'accounts.sqlite');
    try {
      const old = new DatabaseSync(path);
      old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'Mr', title TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE saves (user_id INTEGER NOT NULL, slot TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, slot));
        CREATE TABLE friendships (requester_id INTEGER NOT NULL, addressee_id INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, responded_at INTEGER, PRIMARY KEY (requester_id, addressee_id));
        INSERT INTO users (username, display_name, password_hash, created_at, updated_at) VALUES ('veteran', 'Veteran', 'x', 1, 1);
        PRAGMA user_version = 1;`);
      old.close();
      const upgraded = make(path);
      try {
        const veteran = upgraded.players({}).players[0]!;
        expect(veteran.profile.username).toBe('veteran');
        upgraded.recordGame(veteran.profile.id, game() as unknown as Record<string, unknown>);
        expect(upgraded.playerProfile('veteran').stats.games).toBe(1);
      } finally { upgraded.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('game reports from the browser', () => {
  const fighter = (patch: Partial<EndedFighter> = {}): EndedFighter => ({ kind: 'Fx', name: 'P1', cpu: false, seatId: 0, team: null, infected: false, kos: 0, falls: 0, damage: 0, ...patch });
  const ended = (patch: Partial<EndedMatch> = {}): EndedMatch => ({
    mode: 'local', stage: 'final', seconds: 61.4, winner: 0, me: 0, zombies: false, rules: ['stocks:3'],
    fighters: [fighter({ kos: 3, damage: 210 }), fighter({ kind: 'Mr', name: 'CPU', cpu: true, seatId: 1 })], ...patch,
  });

  it('decides the result from this browser\'s seat', () => {
    expect(matchResult(ended())).toBe('win');
    expect(matchResult(ended({ winner: 1 }))).toBe('loss');
    expect(matchResult(ended({ winner: null }))).toBe('draw');
    const teams = [fighter({ team: 0 }), fighter({ seatId: 1, team: 1 }), fighter({ seatId: 2, team: 0 })];
    expect(matchResult(ended({ fighters: teams, winner: 2 }))).toBe('win');
    expect(matchResult(ended({ fighters: teams, winner: 1 }))).toBe('loss');
    const horde = [fighter({ infected: true }), fighter({ seatId: 1 }), fighter({ seatId: 2, infected: true })];
    expect(matchResult(ended({ zombies: true, fighters: horde, winner: 2 }))).toBe('win');
    expect(matchResult(ended({ zombies: true, fighters: horde, winner: 1, me: 0 }))).toBe('loss');
  });

  it('builds a report with the opponents, and none for a CPU seat', () => {
    expect(matchReport(ended(), 'client-id-01')).toEqual({
      clientId: 'client-id-01', mode: 'local', result: 'win', fighter: 'Fx', stage: 'final', players: 2, kos: 3, falls: 0, damage: 210, seconds: 61,
      rules: ['stocks:3'], opponents: [{ name: 'CPU', fighter: 'Mr', cpu: true }], rift: null,
    });
    expect(matchReport(ended({ me: 1 }))).toBeNull();
    const rift = riftReport({ fighter: 'Lk', victory: false, cleared: 3, length: 8, bossesDown: 1, fightsWon: 4, heat: 2, score: 700, seconds: 0 });
    expect(rift).toMatchObject({ mode: 'rift', result: 'loss', fighter: 'Lk', stage: 'rift', players: 1, rift: { cleared: 3, score: 700 } });
    expect(rift.clientId).toMatch(/^[0-9a-f]{24}$/u);
  });
});

describe('public player HTTP API', () => {
  let server: Server;
  let base: string;
  let directory: string;
  beforeAll(async () => {
    const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'player-tests-'));
    await writeFile(join(directory, 'play.html'), '<html><head></head><body></body></html>');
    server = await createMeleeServer({ source: { manifest: sourceFixture(), read: async () => new Uint8Array(), close: async () => {} }, staticRoot: directory, databasePath: ':memory:' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('reads the directory and profiles without a session, and only records games with one', async () => {
    const created = await fetch(`${base}/api/account/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'public_one', password: 'http password' }) });
    const { token } = await created.json() as { token: string };
    const report = game();
    expect((await fetch(`${base}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) })).status).toBe(401);
    const posted = await fetch(`${base}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(report) });
    expect(posted.status).toBe(201);
    expect((await fetch(`${base}/api/games`)).status).toBe(405);
    const list = await (await fetch(`${base}/api/players?q=pub&limit=10`)).json() as PlayersResponse;
    expect(list).toMatchObject({ total: 1, players: [{ profile: { username: 'public_one' }, games: 1, wins: 1 }] });
    const page = await (await fetch(`${base}/api/players/public_one`)).json() as PlayerProfileResponse;
    expect(page).toMatchObject({ profile: { username: 'public_one' }, stats: { games: 1 }, recent: [{ fighter: 'Fx', result: 'win' }] });
    expect(JSON.stringify(page)).not.toMatch(/password|token|clientId/u);
    expect((await fetch(`${base}/api/players/nobody_home`)).status).toBe(404);
    expect((await fetch(`${base}/api/players/%E0%A4%A`)).status).toBe(404);
    expect((await fetch(`${base}/api/players`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(405);
  });
});

describe('players URLs', () => {
  it('reads the directory and profile links, old hash links included', async () => {
    const { readPlayersLink } = await import('../../web/src/account/players-route.ts');
    const at = (pathname: string, hash = '') => { (globalThis as { window?: unknown }).window = { location: { pathname, hash } }; return readPlayersLink(); };
    try {
      expect(at('/players')).toEqual({ username: null });
      expect(at('/players/Fox_main')).toEqual({ username: 'Fox_main' });
      expect(at('/play.html', '#player=mark')).toEqual({ username: 'mark' });
      expect(at('/play.html', '#players')).toEqual({ username: null });
      expect(at('/play')).toBeNull();
      expect(at('/players/a')).toBeNull();
      expect(at('/players/mark/extra')).toBeNull();
    } finally { delete (globalThis as { window?: unknown }).window; }
  });
});
