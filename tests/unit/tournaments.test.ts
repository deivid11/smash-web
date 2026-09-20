import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AccountError, AccountService } from '../../server/accounts.ts';
import { CLAIM_GRACE_MS, TournamentService } from '../../server/tournaments.ts';
import { createMeleeServer } from '../../server/http.ts';
import { sourceFixture } from './source-fixture.ts';
import {
  bracketSize, createTournament, DEFAULT_FILL, DEFAULT_RULES, progress, reopenMatch, reportWinner, seedOrder, simulateCpuMatches, sizeChoices,
  type CpuFill, type TournamentState,
} from '../../lib/game/tournament/bracket.ts';
import { CHECKIN_TTL_MS, MAX_ACTIVE_TOURNAMENTS_PER_OWNER, type TournamentListResponse, type TournamentView, type UserSearchResponse } from '../../lib/net/tournament-protocol.ts';
import { ROOM_FIGHTERS } from '../../lib/net/protocol.ts';

const NO_FILL: CpuFill = { enabled: false, min: 1, max: 9 };
const build = (humans: number, fill: CpuFill, size?: number, seed = 7): TournamentState => createTournament({
  id: 'TEST', name: 'Test Cup', rules: { ...DEFAULT_RULES }, fill, seed, fighters: ['Mr', 'Fx', 'Kb'], now: 1,
  humans: Array.from({ length: humans }, (_, index) => ({ name: `P${index + 1}`, userId: index + 1 })),
  ...(size === undefined ? {} : { size }),
});
/** Plays every ready set (side a wins) until the bracket is complete. */
const playOut = (state: TournamentState): void => {
  for (let guard = 0; guard < 64 && state.status === 'active'; guard++) {
    simulateCpuMatches(state, 2);
    const match = state.matches.find((entry) => entry.status === 'ready');
    if (match) reportWinner(state, match.id, match.a!, 2);
  }
};

describe('bracket engine', () => {
  it('derives the standard seed order and bracket sizes', () => {
    expect(seedOrder(2)).toEqual([0, 1]);
    expect(seedOrder(4)).toEqual([0, 3, 1, 2]);
    expect(seedOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
    expect([...seedOrder(32)].sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, index) => index));
    expect([2, 3, 5, 8, 13].map(bracketSize)).toEqual([2, 4, 8, 8, 16]);
    expect(sizeChoices(5)).toEqual([8, 16, 32]);
  });

  for (const humans of [2, 3, 5, 8, 13]) {
    it(`seeds ${humans} humans without the fill: byes never meet and go to the top seeds`, () => {
      const state = build(humans, NO_FILL);
      expect(state.size).toBe(bracketSize(humans));
      expect(state.entrants.map((entrant) => entrant.kind)).toEqual(Array(humans).fill('human'));
      expect(state.entrants.map((entrant) => entrant.id)).toEqual(Array.from({ length: humans }, (_, index) => index));
      const first = state.matches.filter((match) => match.round === 0);
      expect(first.every((match) => match.a !== null || match.b !== null)).toBe(true);
      const byes = first.filter((match) => match.status === 'bye');
      expect(byes.length).toBe(state.size - humans);
      // The byes belong to the best seeds: 0 … byes-1.
      expect(byes.map((match) => match.winner!).sort((a, b) => a - b)).toEqual(Array.from({ length: byes.length }, (_, index) => index));
      expect(first.filter((match) => match.status === 'ready').length).toBe(humans - state.size / 2);
      playOut(state);
      expect(state.status).toBe('complete');
      expect(state.champion).not.toBeNull();
      expect(progress(state)).toEqual({ played: humans - 1, total: humans - 1 });
    });

    it(`pads ${humans} humans with CPUs: humans hold the top seeds and CPU sets simulate themselves`, () => {
      const state = build(humans, { ...DEFAULT_FILL }, 16);
      expect(state.size).toBe(16);
      expect(state.entrants.length).toBe(16);
      expect(state.entrants.slice(0, humans).every((entrant) => entrant.kind === 'human')).toBe(true);
      expect(state.entrants.slice(humans).every((entrant) => entrant.kind === 'cpu' && entrant.level! >= DEFAULT_FILL.min && entrant.level! <= DEFAULT_FILL.max && !!entrant.fighter)).toBe(true);
      expect(state.matches.some((match) => match.status === 'bye')).toBe(false);
      simulateCpuMatches(state, 2);
      const cpuOnly = (match: TournamentState['matches'][number]): boolean => match.a !== null && match.b !== null && state.entrants[match.a]!.kind === 'cpu' && state.entrants[match.b]!.kind === 'cpu';
      expect(state.matches.filter((match) => match.status === 'ready').some(cpuOnly)).toBe(false);
      expect(state.matches.filter((match) => match.note === 'simulated').every(cpuOnly)).toBe(true);
      // Nothing with a human in it was ever decided by the simulation.
      expect(state.matches.filter((match) => match.status === 'done').every(cpuOnly)).toBe(true);
    });
  }

  it('is deterministic per seed and rejects impossible shapes', () => {
    expect(build(5, { ...DEFAULT_FILL }, 8, 99)).toEqual(build(5, { ...DEFAULT_FILL }, 8, 99));
    expect(() => build(1, NO_FILL)).toThrow();
    expect(() => build(3, { ...DEFAULT_FILL }, 12)).toThrow();
    expect(() => build(33, NO_FILL)).toThrow();
    expect(build(1, { ...DEFAULT_FILL }).entrants.map((entrant) => entrant.kind)).toEqual(['human', 'cpu']);
  });

  it('advances winners to a champion and only reopens a set nothing was played on top of', () => {
    const state = build(4, NO_FILL);
    const [semiA, semiB, final] = state.matches;
    expect(() => reportWinner(state, final!.id, 0, 2)).toThrow();
    expect(() => reportWinner(state, semiA!.id, semiB!.a!, 2)).toThrow();
    reportWinner(state, semiA!.id, semiA!.a!, 2);
    expect(final!.status).toBe('pending');
    reportWinner(state, semiB!.id, semiB!.b!, 3);
    expect(final).toMatchObject({ status: 'ready', a: semiA!.a, b: semiB!.b });
    reopenMatch(state, semiA!.id, 4);
    expect(semiA).toMatchObject({ status: 'ready', winner: null });
    expect(final).toMatchObject({ status: 'pending', a: null });
    reportWinner(state, semiA!.id, semiA!.b!, 5);
    reportWinner(state, final!.id, semiA!.b!, 6);
    expect(state).toMatchObject({ status: 'complete', champion: semiA!.b });
    expect(() => reopenMatch(state, semiA!.id, 7)).toThrow(/on top/u);
    expect(() => reportWinner(state, final!.id, semiB!.b!, 7)).toThrow();
    reopenMatch(state, final!.id, 8);
    expect(state).toMatchObject({ status: 'active', champion: null });
  });
});

// ——— Service ———

let clock = 1_000_000;
let accounts: AccountService;
let service: TournamentService;
let nextId = 0;
const ids: Record<string, number> = {};
const status = (fn: () => unknown): number => {
  try { fn(); return 0; } catch (error) { return error instanceof AccountError ? error.status : -1; }
};
const body = (usernames: string[], extra: Record<string, unknown> = {}) => ({ name: ' Friday  Cup ', rules: { ...DEFAULT_RULES }, fill: NO_FILL, usernames, ...extra });
const lobbyOf = (view: TournamentView, matchId: number) => view.lobbies.find((lobby) => lobby.matchId === matchId)!;
/** Entrant order is shuffled: look the sides up by account. */
const sides = (view: TournamentView, matchId: number) => {
  const match = view.state.matches.find((entry) => entry.id === matchId)!;
  return { match, a: view.state.entrants[match.a!]!, b: view.state.entrants[match.b!]! };
};

beforeEach(async () => {
  clock = 1_000_000; nextId = 0;
  accounts = new AccountService({ path: ':memory:', now: () => clock, scryptCost: 1024 });
  service = new TournamentService({ path: ':memory:', accounts, now: () => clock, seed: () => 12345, id: () => `CUP${(++nextId).toString(2).padStart(5, '0').replace(/0/gu, 'A').replace(/1/gu, 'B')}` });
  for (const username of ['olga', 'mario', 'luigi', 'peach', 'toad']) ids[username] = (await accounts.register({ username, password: 'password!', displayName: username.toUpperCase() })).account.id;
});
afterEach(() => { service.close(); accounts.close(); });

describe('tournament service', () => {
  it('validates the wizard input and names unknown players', () => {
    const error = (() => { try { service.create(ids.olga!, body(['mario', 'ghost_1', 'ghost_2'])); } catch (caught) { return caught as AccountError; } return null; })();
    expect(error).toMatchObject({ status: 400 });
    expect(error!.message).toContain('ghost_1, ghost_2');
    expect(status(() => service.create(ids.olga!, body(['mario', 'MARIO'])))).toBe(400);
    expect(status(() => service.create(ids.olga!, body([])))).toBe(400);
    expect(status(() => service.create(ids.olga!, body(['mario', 'no']))) ).toBe(400);
    expect(status(() => service.create(ids.olga!, body(['mario'])))).toBe(400); // one player, no fill
    expect(status(() => service.create(ids.olga!, body(['mario', 'luigi'], { name: '' })))).toBe(400);
    expect(status(() => service.create(ids.olga!, body(['mario', 'luigi'], { rules: { ...DEFAULT_RULES, stocks: 0 } })))).toBe(400);
    expect(status(() => service.create(ids.olga!, body(['mario', 'luigi'], { fill: { enabled: true, min: 9, max: 1 } })))).toBe(400);
    expect(status(() => service.create(ids.olga!, body(['mario', 'luigi'], { fill: DEFAULT_FILL, size: 6 })))).toBe(400);
    expect(status(() => service.create(ids.olga!, null))).toBe(400);
  });

  it('enters any account (no friendship needed) and lets the organizer stay out of the bracket', () => {
    const view = service.create(ids.olga!, body(['Mario', 'luigi', 'peach']));
    expect(view).toMatchObject({ isOwner: true, me: null, owner: { username: 'olga' }, state: { name: 'Friday Cup', size: 4, status: 'active' } });
    expect(view.state.id).toMatch(/^[A-Z2-9]{8}$/u);
    expect(view.state.entrants.map((entrant) => entrant.username).sort()).toEqual(['luigi', 'mario', 'peach']);
    expect(view.state.entrants.find((entrant) => entrant.username === 'mario')).toMatchObject({ kind: 'human', name: 'MARIO', userId: ids.mario, avatar: 'Mr' });
    expect(view.lobbies).toEqual([{ matchId: view.lobbies[0]!.matchId, here: { a: false, b: false }, ready: { a: false, b: false }, room: null, picks: null, disputed: false }]);
    const mario = service.get(ids.mario!, view.state.id);
    expect(mario.isOwner).toBe(false);
    expect(view.state.entrants[mario.me!]!.username).toBe('mario');
    expect(service.get(ids.toad!, view.state.id)).toMatchObject({ me: null, isOwner: false });
    expect(status(() => service.get(ids.toad!, 'NOPE2222'))).toBe(404);
  });

  it('simulates CPU-only sets at creation but never one with a human', () => {
    const view = service.create(ids.olga!, body(['mario'], { fill: DEFAULT_FILL, size: 8 }));
    const human = (id: number | null): boolean => id !== null && view.state.entrants[id]!.kind === 'human';
    const done = view.state.matches.filter((match) => match.status === 'done');
    expect(done.length).toBe(4); // three first-round CPU sets + the CPU semifinal
    expect(done.every((match) => match.note === 'simulated' && !human(match.a) && !human(match.b))).toBe(true);
    expect(view.lobbies.length).toBe(1);
  });

  it('lists mine (active first) and what there is to watch', () => {
    const first = service.create(ids.olga!, body(['mario', 'luigi']));
    clock += 1000;
    const second = service.create(ids.olga!, body(['olga', 'peach']));
    clock += 1000;
    service.cancel(ids.olga!, second.state.id);
    const olga = service.list(ids.olga!);
    expect(olga.mine.map((entry) => entry.id)).toEqual([first.state.id, second.state.id]);
    expect(olga.mine[0]).toMatchObject({ name: 'Friday Cup', ownerName: 'OLGA', entrants: 2, humans: 2, size: 2, played: 0, total: 1, myTurn: 0, live: 0, championName: null, status: 'active' });
    expect(olga.watch).toEqual([]);
    expect(service.list(ids.mario!)).toMatchObject({ mine: [{ id: first.state.id, myTurn: 1 }], watch: [] });
    // A cancelled tournament is nothing to watch; a running one is.
    expect(service.list(ids.toad!)).toMatchObject({ mine: [], watch: [{ id: first.state.id, myTurn: 0 }] });
    expect(service.list(ids.peach!).mine.map((entry) => entry.status)).toEqual(['cancelled']);
    service.checkin(ids[sides(first, 0).a.username!]!, first.state.id, 0, { ready: true, room: 'ABCDEF', live: true });
    expect(service.list(ids.toad!).watch[0]!.live).toBe(1);
  });

  it('caps the tournaments one organizer runs at once', () => {
    for (let index = 0; index < MAX_ACTIVE_TOURNAMENTS_PER_OWNER; index++) service.create(ids.olga!, body(['mario', 'luigi']));
    expect(status(() => service.create(ids.olga!, body(['mario', 'luigi'])))).toBe(409);
    service.cancel(ids.olga!, service.list(ids.olga!).mine[0]!.id);
    expect(status(() => service.create(ids.olga!, body(['mario', 'luigi'])))).toBe(0);
  });

  it('tracks who is in the set lobby until the check-in goes stale', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi']));
    const id = created.state.id, { a, b } = sides(created, 0);
    expect(lobbyOf(service.checkin(a.userId!, id, 0, { ready: false }), 0)).toMatchObject({ here: { a: true, b: false }, ready: { a: false, b: false } });
    clock += CHECKIN_TTL_MS - 1;
    expect(lobbyOf(service.checkin(b.userId!, id, 0, { ready: true }), 0)).toMatchObject({ here: { a: true, b: true }, ready: { a: false, b: true } });
    clock += 1;
    expect(lobbyOf(service.get(ids.toad!, id), 0)).toMatchObject({ here: { a: false, b: true }, ready: { a: false, b: true } });
    clock += CHECKIN_TTL_MS;
    // Ready only counts while here.
    expect(lobbyOf(service.get(ids.toad!, id), 0)).toMatchObject({ here: { a: false, b: false }, ready: { a: false, b: false } });
    expect(status(() => service.checkin(a.userId!, id, 0, {}))).toBe(400);
    expect(status(() => service.checkin(a.userId!, id, 9, { ready: true }))).toBe(404);
  });

  it('lets only the designated host publish the room', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi']));
    const id = created.state.id, { a, b } = sides(created, 0);
    expect(status(() => service.checkin(b.userId!, id, 0, { ready: true, room: 'ABCDEF' }))).toBe(403);
    expect(status(() => service.checkin(b.userId!, id, 0, { ready: true, live: true }))).toBe(403);
    expect(status(() => service.checkin(a.userId!, id, 0, { ready: true, room: 'abc' }))).toBe(400);
    expect(status(() => service.checkin(a.userId!, id, 0, { ready: true, live: true }))).toBe(400);
    expect(lobbyOf(service.checkin(a.userId!, id, 0, { ready: true, room: 'ABCDEF' }), 0).room).toEqual({ code: 'ABCDEF', host: 'a', live: false });
    expect(lobbyOf(service.checkin(a.userId!, id, 0, { ready: true, live: true }), 0).room).toEqual({ code: 'ABCDEF', host: 'a', live: true });
    // A plain heartbeat leaves the room alone; null closes it.
    expect(lobbyOf(service.checkin(a.userId!, id, 0, { ready: true }), 0).room).toMatchObject({ code: 'ABCDEF', live: true });
    expect(lobbyOf(service.checkin(a.userId!, id, 0, { ready: true, room: null }), 0).room).toBeNull();
    // A non-live room disappears with its host.
    service.checkin(a.userId!, id, 0, { ready: true, room: 'GHJKLM' });
    clock += CHECKIN_TTL_MS;
    expect(lobbyOf(service.get(ids.toad!, id), 0).room).toBeNull();
  });

  it('hosts from side b when side a is a CPU', () => {
    // Two humans in a bracket of four: each opens against a CPU. Seed 0 loses, so the final seats that CPU on side a.
    const created = service.create(ids.olga!, body(['mario', 'luigi'], { fill: DEFAULT_FILL, size: 4 }));
    const id = created.state.id, top = sides(created, 0), bottom = sides(created, 1);
    expect([top.a.kind, top.b.kind, bottom.a.kind, bottom.b.kind]).toEqual(['human', 'cpu', 'human', 'cpu']);
    service.report(top.a.userId!, id, 0, { winner: top.b.id });
    const view = service.report(bottom.a.userId!, id, 1, { winner: bottom.a.id });
    expect(view.state.matches[2]).toMatchObject({ status: 'ready', a: top.b.id, b: bottom.a.id });
    expect(lobbyOf(service.checkin(bottom.a.userId!, id, 2, { ready: true, room: 'ABCDEF' }), 2)).toMatchObject({ here: { a: false, b: true }, room: { host: 'b' } });
  });

  it('rolls RANDOM CHAMP picks once per set', () => {
    let seed = 1;
    service.close();
    service = new TournamentService({ path: ':memory:', accounts, now: () => clock, seed: () => seed++ });
    const created = service.create(ids.olga!, body(['mario', 'luigi'], { rules: { ...DEFAULT_RULES, mode: 'random' } }));
    const id = created.state.id;
    expect(lobbyOf(created, 0).picks).toBeNull();
    const picks = lobbyOf(service.checkin(ids.mario!, id, 0, { ready: false }), 0).picks!;
    expect(ROOM_FIGHTERS).toContain(picks.a);
    expect(ROOM_FIGHTERS).toContain(picks.b);
    for (let beat = 0; beat < 5; beat++) { clock += 4000; expect(lobbyOf(service.checkin(beat % 2 ? ids.mario! : ids.luigi!, id, 0, { ready: true }), 0).picks).toEqual(picks); }
    // Classic sets never roll.
    const classic = service.create(ids.olga!, body(['mario', 'luigi']));
    expect(lobbyOf(service.checkin(ids.mario!, classic.state.id, 0, { ready: true }), 0).picks).toBeNull();
  });

  it('takes a player\'s word against a CPU', () => {
    const created = service.create(ids.olga!, body(['mario'], { fill: DEFAULT_FILL, size: 2 }));
    const { a, b } = sides(created, 0);
    expect([a.kind, b.kind]).toEqual(['human', 'cpu']);
    expect(status(() => service.report(ids.mario!, created.state.id, 0, { winner: 5 }))).toBe(400);
    const view = service.report(ids.mario!, created.state.id, 0, { winner: b.id });
    expect(view.state).toMatchObject({ status: 'complete', champion: b.id });
    expect(view.state.matches[0]).toMatchObject({ status: 'done', note: 'played' });
    expect(view.lobbies).toEqual([]);
    expect(service.list(ids.mario!).mine[0]).toMatchObject({ status: 'complete', championName: b.name, played: 1 });
    expect(status(() => service.report(ids.mario!, created.state.id, 0, { winner: a.id }))).toBe(409);
  });

  it('settles a set when both humans report the same winner', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi']));
    const id = created.state.id, { a, b } = sides(created, 0);
    const claimed = service.report(a.userId!, id, 0, { winner: a.id });
    expect(claimed.state.matches[0]!.status).toBe('ready');
    expect(lobbyOf(claimed, 0).disputed).toBe(false);
    clock += CLAIM_GRACE_MS + 5000; // the late confirmation still agrees instead of racing the grace period
    const settled = service.report(b.userId!, id, 0, { winner: a.id });
    expect(settled.state).toMatchObject({ status: 'complete', champion: a.id });
    expect(settled.state.matches[0]!.note).toBe('played');
  });

  it('flags a dispute and waits for the organizer', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi']));
    const id = created.state.id, { a, b } = sides(created, 0);
    service.report(a.userId!, id, 0, { winner: a.id });
    expect(lobbyOf(service.report(b.userId!, id, 0, { winner: b.id }), 0).disputed).toBe(true);
    expect(status(() => service.report(a.userId!, id, 0, { winner: b.id }))).toBe(409);
    clock += CLAIM_GRACE_MS * 4;
    expect(service.get(ids.toad!, id).state.matches[0]!.status).toBe('ready');
    expect(status(() => service.report(ids.toad!, id, 0, { winner: a.id }))).toBe(403);
    const settled = service.report(ids.olga!, id, 0, { winner: b.id });
    expect(settled.state).toMatchObject({ status: 'complete', champion: b.id });
    // Nobody ever went live: the organizer handed out a walkover.
    expect(settled.state.matches[0]!.note).toBe('walkover');
  });

  it('notes an organizer result as played once the room went live', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi']));
    const id = created.state.id, { a } = sides(created, 0);
    service.checkin(a.userId!, id, 0, { ready: true, room: 'ABCDEF', live: true });
    expect(service.report(ids.olga!, id, 0, { winner: a.id }).state.matches[0]!.note).toBe('played');
  });

  it('settles a lone claim once the other side stayed silent for the grace period', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi', 'peach', 'toad']));
    const id = created.state.id, { a, b } = sides(created, 0);
    service.report(b.userId!, id, 0, { winner: b.id });
    clock += CLAIM_GRACE_MS - 1;
    expect(service.get(ids.olga!, id).state.matches[0]!.status).toBe('ready');
    clock += 1;
    expect(service.list(ids.olga!).mine[0]!.played).toBe(1);
    const view = service.get(a.userId!, id);
    expect(view.state.matches[0]).toMatchObject({ status: 'done', winner: b.id, note: 'played' });
    expect(view.state.matches[2]!.a).toBe(b.id);
  });

  it('reopens a set for the organizer only, and only while nothing was played on top', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi', 'peach', 'toad']));
    const id = created.state.id, first = sides(created, 0), second = sides(created, 1);
    service.report(ids.olga!, id, 0, { winner: first.a.id });
    service.report(ids.olga!, id, 1, { winner: second.a.id });
    expect(status(() => service.reopen(first.a.userId!, id, 0))).toBe(403);
    expect(status(() => service.reopen(ids.olga!, id, 2))).toBe(409);
    expect(status(() => service.reopen(ids.olga!, id, 7))).toBe(404);
    service.checkin(first.a.userId!, id, 2, { ready: true, room: 'ABCDEF' });
    const reopened = service.reopen(ids.olga!, id, 0);
    expect(reopened.state.matches[0]).toMatchObject({ status: 'ready', winner: null });
    expect(reopened.state.matches[2]).toMatchObject({ status: 'pending', a: null });
    expect(reopened.lobbies.map((lobby) => lobby.matchId)).toEqual([0]);
    service.report(ids.olga!, id, 0, { winner: first.b.id });
    // The final's old lobby went with the reopen.
    expect(lobbyOf(service.get(ids.olga!, id), 2)).toMatchObject({ room: null, here: { a: false, b: false } });
    service.report(ids.olga!, id, 2, { winner: first.b.id });
    expect(status(() => service.reopen(ids.olga!, id, 0))).toBe(409);
    expect(service.reopen(ids.olga!, id, 2).state).toMatchObject({ status: 'active', champion: null });
  });

  it('cancels and removes for the organizer only', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi']));
    const id = created.state.id;
    expect(status(() => service.cancel(ids.mario!, id))).toBe(403);
    expect(status(() => service.remove(ids.olga!, id))).toBe(409); // still running
    expect(service.cancel(ids.olga!, id)).toMatchObject({ state: { status: 'cancelled' }, lobbies: [] });
    expect(status(() => service.cancel(ids.olga!, id))).toBe(409);
    expect(status(() => service.checkin(ids.mario!, id, 0, { ready: true }))).toBe(409);
    expect(status(() => service.report(ids.olga!, id, 0, { winner: 0 }))).toBe(409);
    expect(status(() => service.reopen(ids.olga!, id, 0))).toBe(409);
    expect(status(() => service.remove(ids.mario!, id))).toBe(403);
    service.remove(ids.olga!, id);
    expect(status(() => service.get(ids.olga!, id))).toBe(404);
    expect(service.list(ids.mario!)).toEqual({ mine: [], watch: [] });
  });

  it('keeps spectators and other entrants out of a set', () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi', 'peach', 'toad']));
    const id = created.state.id, other = sides(created, 1);
    expect(status(() => service.checkin(ids.olga!, id, 0, { ready: true }))).toBe(403); // organizer, not a player
    expect(status(() => service.checkin(other.a.userId!, id, 0, { ready: true }))).toBe(403);
    expect(status(() => service.report(other.a.userId!, id, 0, { winner: sides(created, 0).a.id }))).toBe(403);
    expect(status(() => service.checkin(other.a.userId!, id, 2, { ready: true }))).toBe(409); // the final is not ready
  });

  it('keeps a deleted player\'s name in the bracket', async () => {
    const created = service.create(ids.olga!, body(['mario', 'luigi']));
    await accounts.deleteAccount(ids.mario!, { password: 'password!' });
    expect(service.get(ids.luigi!, created.state.id).state.entrants.map((entrant) => entrant.name).sort()).toEqual(['LUIGI', 'MARIO']);
    await accounts.deleteAccount(ids.olga!, { password: 'password!' });
    expect(service.get(ids.luigi!, created.state.id).owner.displayName).toBe('Deleted player');
  });

  it('searches accounts by username or display-name prefix', () => {
    accounts.updateProfile(ids.toad!, { displayName: 'Mushroom_Kid' });
    expect(service.searchUsers('ma').map((profile) => profile.username)).toEqual(['mario']);
    expect(service.searchUsers('MUSH').map((profile) => profile.username)).toEqual(['toad']);
    expect(service.searchUsers('m')).toEqual([]);
    expect(service.searchUsers('%%')).toEqual([]);
    expect(service.searchUsers('mushroom_')).toHaveLength(1);
    expect(service.searchUsers('mushroomXk')).toEqual([]); // `_` is a literal, not a wildcard
    expect(service.searchUsers(42)).toEqual([]);
    expect(accounts.searchUsers('ma', 999).length).toBeLessThanOrEqual(8);
    expect(accounts.profileByUsername('PEACH')).toMatchObject({ id: ids.peach, username: 'peach' });
    expect(accounts.profileByUsername('nobody')).toBeNull();
    expect(accounts.profileById(ids.peach!)).toMatchObject({ username: 'peach' });
    expect(accounts.profileById(9999)).toBeNull();
  });
});

describe('tournament HTTP API', () => {
  let server: Server;
  let base: string;
  let directory: string;
  beforeAll(async () => {
    const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'tournament-tests-'));
    await writeFile(join(directory, 'play.html'), '<html><head></head><body></body></html>');
    server = await createMeleeServer({ source: { manifest: sourceFixture(), read: async () => new Uint8Array(), close: async () => {} }, staticRoot: directory, databasePath: ':memory:' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const call = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => fetch(`${base}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const signUp = async (username: string): Promise<string> => ((await (await call('/api/account/register', { body: { username, password: 'http password' } })).json()) as { token: string }).token;

  it('runs a two-player tournament end to end', async () => {
    const [owner, red, blue] = [await signUp('organizer'), await signUp('redplayer'), await signUp('blueplayer')];
    expect((await call('/api/tournaments')).status).toBe(401);
    expect(await (await call('/api/tournaments/users?q=red', { token: owner })).json() as UserSearchResponse).toMatchObject({ users: [{ username: 'redplayer', rift: null }] });
    expect((await call('/api/tournaments', { token: owner, body: body(['redplayer', 'nobody_here']) })).status).toBe(400);
    const created = await call('/api/tournaments', { token: owner, body: body(['redplayer', 'blueplayer']) });
    expect(created.status).toBe(201);
    const { tournament } = await created.json() as { tournament: TournamentView };
    const id = tournament.state.id, path = `/api/tournaments/${id}`;
    expect(tournament).toMatchObject({ isOwner: true, me: null, lobbies: [{ matchId: 0 }] });
    expect((await (await call('/api/tournaments', { token: red })).json() as TournamentListResponse).mine).toMatchObject([{ id, myTurn: 1 }]);
    const tokenOf = (username: string): string => (username === 'redplayer' ? red : blue);
    const { a, b } = sides(tournament, 0);
    const checked = await (await call(`${path}/sets/0/checkin`, { token: tokenOf(a.username!), body: { ready: true, room: 'ABCDEF', live: true } })).json() as { tournament: TournamentView };
    expect(checked.tournament.lobbies[0]).toMatchObject({ here: { a: true, b: false }, room: { code: 'ABCDEF', host: 'a', live: true } });
    expect((await call(`${path}/sets/0/checkin`, { token: owner, body: { ready: true } })).status).toBe(403);
    expect((await call(`${path}/sets/0/checkin`, { token: red })).status).toBe(405);
    expect((await call(`${path}/sets/x/checkin`, { token: red, body: {} })).status).toBe(404);
    expect((await call(`${path}/sets/0/result`, { token: tokenOf(a.username!), body: { winner: a.id } })).status).toBe(200);
    const settled = await (await call(`${path}/sets/0/result`, { token: tokenOf(b.username!), body: { winner: a.id } })).json() as { tournament: TournamentView };
    expect(settled.tournament.state).toMatchObject({ status: 'complete', champion: a.id });
    const reopened = await call(`${path}/sets/0/reopen`, { token: owner, body: {} });
    expect(((await reopened.json()) as { tournament: TournamentView }).tournament.state.status).toBe('active');
    expect((await call(path, { token: owner, method: 'DELETE' })).status).toBe(409);
    expect((await call(`${path}/cancel`, { token: red, body: {} })).status).toBe(403);
    expect(await (await call(`${path}/cancel`, { token: owner, body: {} })).json()).toMatchObject({ tournament: { state: { status: 'cancelled' } } });
    expect(await (await call(path, { token: owner, method: 'DELETE' })).json()).toEqual({ ok: true });
    expect((await call(path, { token: blue })).status).toBe(404);
  });
});
