/** LAN tournaments: the bracket (lib/game/tournament/bracket.ts) persisted as a
 * JSON blob per tournament in the accounts database, plus the in-memory set
 * lobbies (who is waiting, which LAN room a set runs in, result claims). The
 * sets themselves are ordinary LAN rooms: this service never sees a match, it
 * only trusts what the two sides (or the organizer) report. The HTTP surface
 * lives in server/tournament-api.ts; the JSON contract in lib/net/tournament-protocol.ts.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createTournament, MAX_ENTRANTS, MAX_TOURNAMENT_NAME, progress, reopenMatch, reportWinner, SeededRng, simulateCpuMatches, validFill, validRules,
  type BracketMatch, type TournamentState,
} from '../lib/game/tournament/bracket.ts';
import { cleanText, validRoomCode, validUsername, type PublicProfile } from '../lib/net/account-protocol.ts';
import { ROOM_FIGHTERS } from '../lib/net/protocol.ts';
import {
  CHECKIN_TTL_MS, MAX_ACTIVE_TOURNAMENTS_PER_OWNER, MAX_USER_SEARCH,
  type SetLobby, type Side, type TournamentListResponse, type TournamentSummary, type TournamentView,
} from '../lib/net/tournament-protocol.ts';
import { AccountError, type AccountService } from './accounts.ts';

export interface TournamentServiceOptions {
  /** Same database file as the accounts, or ':memory:' for tests. */
  path: string;
  accounts: AccountService;
  now?: () => number;
  /** 32-bit seed source: bracket shuffles and RANDOM CHAMP rolls. */
  seed?: () => number;
  id?: () => string;
}

/** A lone result claim settles by itself after this long: the other client may have closed the tab. */
export const CLAIM_GRACE_MS = 30_000;
/** A live room outlives the lobby TTL: its host is inside a match and may heartbeat slowly (or not at all). */
export const LIVE_ROOM_TTL_MS = 15 * 60_000;
const LOBBY_IDLE_MS = 60 * 60_000;
const MINE_LIMIT = 30;
const WATCH_LIMIT = 20;
/** Room-code alphabet: no 0/O/1/I, URL-safe. */
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SIDES: readonly Side[] = ['a', 'b'];

interface Row { id: string; owner_id: number; state: string }
interface Loaded { ownerId: number; state: TournamentState }
interface Checkin { at: number; ready: boolean }
interface Claim { winner: number; at: number }
interface LobbyMemory {
  tournament: string;
  matchId: number;
  checkins: Partial<Record<Side, Checkin>>;
  room: { code: string; host: Side; live: boolean } | null;
  /** The room ran a match at some point: an organizer's report is then 'played', not a walkover. */
  wasLive: boolean;
  picks: { a: string; b: string } | null;
  claims: Partial<Record<Side, Claim>>;
  disputed: boolean;
  touchedAt: number;
}

const randomId = (): string => Array.from({ length: 8 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('');

export class TournamentService {
  private readonly db: DatabaseSync;
  private readonly accounts: AccountService;
  private readonly now: () => number;
  private readonly seed: () => number;
  private readonly id: () => string;
  /** Memory only, like presence: a restart forgets who was waiting and any unconfirmed claim. */
  private readonly lobbies = new Map<string, LobbyMemory>();

  constructor(options: TournamentServiceOptions) {
    if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true });
    // Its own handle on the accounts file (WAL allows that). No foreign keys to
    // `users`: a deleted account keeps its name in every bracket it played.
    this.db = new DatabaseSync(options.path);
    this.accounts = options.accounts;
    this.now = options.now ?? Date.now;
    this.seed = options.seed ?? (() => randomBytes(4).readUInt32BE(0));
    this.id = options.id ?? randomId;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    // Idempotent on purpose: the accounts migration owns PRAGMA user_version.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tournaments (
        id TEXT PRIMARY KEY,
        owner_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        state TEXT NOT NULL, -- JSON TournamentState
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tournaments_owner ON tournaments(owner_id);
      CREATE TABLE IF NOT EXISTS tournament_players (
        tournament_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (tournament_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS tournament_players_user ON tournament_players(user_id);
    `);
  }

  close(): void { if (this.db.isOpen) this.db.close(); }

  // ——— Storage ———

  private load(id: unknown): Loaded {
    const row = typeof id === 'string' && id.length <= 32 ? this.db.prepare('SELECT id, owner_id, state FROM tournaments WHERE id = ?').get(id) as Row | undefined : undefined;
    if (!row) throw new AccountError(404, 'That tournament does not exist.');
    return { ownerId: row.owner_id, state: JSON.parse(row.state) as TournamentState };
  }
  private save(state: TournamentState): void {
    this.db.prepare('UPDATE tournaments SET status = ?, state = ?, updated_at = ? WHERE id = ?').run(state.status, JSON.stringify(state), state.updatedAt, state.id);
  }
  private owned(userId: number, id: unknown): Loaded {
    const loaded = this.load(id);
    if (loaded.ownerId !== userId) throw new AccountError(403, 'Only the organizer can do that.');
    return loaded;
  }

  // ——— Set lobbies ———

  private static key(tournament: string, matchId: number): string { return `${tournament}:${matchId}`; }
  private dropLobbies(tournament: string, matchId?: number): void {
    for (const [key, lobby] of this.lobbies) if (lobby.tournament === tournament && (matchId === undefined || lobby.matchId === matchId)) this.lobbies.delete(key);
  }
  private lobby(state: TournamentState, matchId: number): LobbyMemory {
    const key = TournamentService.key(state.id, matchId);
    let lobby = this.lobbies.get(key);
    if (!lobby) { lobby = { tournament: state.id, matchId, checkins: {}, room: null, wasLive: false, picks: null, claims: {}, disputed: false, touchedAt: this.now() }; this.lobbies.set(key, lobby); }
    return lobby;
  }
  private lobbyView(state: TournamentState, match: BracketMatch): SetLobby {
    const lobby = this.lobbies.get(TournamentService.key(state.id, match.id));
    const now = this.now();
    const age = (side: Side): number => now - (lobby?.checkins[side]?.at ?? -Infinity);
    const here = { a: age('a') < CHECKIN_TTL_MS, b: age('b') < CHECKIN_TTL_MS };
    // A room whose host walked away is forgotten, so a returning host starts clean.
    if (lobby?.room && age(lobby.room.host) >= (lobby.room.live ? LIVE_ROOM_TTL_MS : CHECKIN_TTL_MS)) lobby.room = null;
    return {
      matchId: match.id, here,
      ready: { a: here.a && !!lobby?.checkins.a?.ready, b: here.b && !!lobby?.checkins.b?.ready },
      room: lobby?.room ? { ...lobby.room } : null,
      picks: lobby?.picks ? { ...lobby.picks } : null,
      disputed: lobby?.disputed ?? false,
    };
  }
  private readySets(state: TournamentState): BracketMatch[] {
    return state.status === 'active' ? state.matches.filter((match) => match.status === 'ready') : [];
  }
  private static sideOf(state: TournamentState, match: BracketMatch, userId: number): Side | null {
    return SIDES.find((side) => { const entrant = state.entrants[match[side]!]; return entrant?.kind === 'human' && entrant.userId === userId; }) ?? null;
  }
  /** The ready set, plus the caller's side of it (403 unless they play in it). */
  private playerSet(state: TournamentState, matchId: number, userId: number): { match: BracketMatch; side: Side | null } {
    if (state.status !== 'active') throw new AccountError(409, 'This tournament is not running.');
    const match = state.matches.find((entry) => entry.id === matchId);
    if (!match) throw new AccountError(404, 'That set does not exist.');
    if (match.status !== 'ready') throw new AccountError(409, 'That set is not ready to be played.');
    return { match, side: TournamentService.sideOf(state, match, userId) };
  }

  private settleSet(state: TournamentState, matchId: number, winner: number, note: 'played' | 'walkover'): void {
    const now = this.now();
    try { reportWinner(state, matchId, winner, now, note); } catch (error) { throw new AccountError(409, error instanceof Error ? error.message : 'That set cannot be settled.'); }
    // The winner may now face a CPU-vs-CPU leftover further down: never let those block the tree.
    simulateCpuMatches(state, now);
    this.dropLobbies(state.id, matchId);
    this.save(state);
  }

  /** Lazy housekeeping instead of timers: lone claims past their grace settle, idle lobbies are forgotten. */
  private sweep(): void {
    const now = this.now();
    for (const [key, lobby] of [...this.lobbies]) {
      const claims = SIDES.flatMap((side) => (lobby.claims[side] ? [lobby.claims[side]!] : []));
      if (claims.length === 1 && !lobby.disputed && now - claims[0]!.at >= CLAIM_GRACE_MS) {
        this.lobbies.delete(key);
        try {
          const { state } = this.load(lobby.tournament);
          if (state.status === 'active') this.settleSet(state, lobby.matchId, claims[0]!.winner, 'played');
        } catch { /* The tournament or the set is gone: the claim dies with it. */ }
      } else if (!claims.length && now - lobby.touchedAt >= LOBBY_IDLE_MS) this.lobbies.delete(key);
    }
  }

  // ——— Views ———

  private ownerProfile(ownerId: number): PublicProfile {
    return this.accounts.profileById(ownerId) ?? { id: ownerId, username: '', displayName: 'Deleted player', avatar: 'Mr', title: '', createdAt: 0, rift: null };
  }
  private view(userId: number, { ownerId, state }: Loaded): TournamentView {
    return {
      state, owner: this.ownerProfile(ownerId),
      lobbies: this.readySets(state).map((match) => this.lobbyView(state, match)),
      me: state.entrants.find((entrant) => entrant.kind === 'human' && entrant.userId === userId)?.id ?? null,
      isOwner: ownerId === userId,
    };
  }
  private summary(userId: number, row: Row): TournamentSummary {
    const state = JSON.parse(row.state) as TournamentState;
    const ready = this.readySets(state), { played, total } = progress(state);
    return {
      id: state.id, name: state.name, ownerName: this.ownerProfile(row.owner_id).displayName, rules: state.rules, status: state.status,
      entrants: state.entrants.length, humans: state.entrants.filter((entrant) => entrant.kind === 'human').length, size: state.size, played, total,
      championName: state.champion === null ? null : state.entrants[state.champion]?.name ?? null,
      myTurn: ready.filter((match) => TournamentService.sideOf(state, match, userId)).length,
      live: ready.filter((match) => this.lobbyView(state, match).room?.live).length,
      updatedAt: state.updatedAt,
    };
  }

  searchUsers(prefix: unknown): PublicProfile[] {
    return typeof prefix === 'string' ? this.accounts.searchUsers(prefix, MAX_USER_SEARCH) : [];
  }

  list(userId: number): TournamentListResponse {
    this.sweep();
    const involved = 'owner_id = ? OR id IN (SELECT tournament_id FROM tournament_players WHERE user_id = ?)';
    const mine = this.db.prepare(`SELECT id, owner_id, state FROM tournaments WHERE ${involved} ORDER BY (status = 'active') DESC, updated_at DESC LIMIT ?`).all(userId, userId, MINE_LIMIT) as unknown as Row[];
    const watch = this.db.prepare(`SELECT id, owner_id, state FROM tournaments WHERE status = 'active' AND NOT (${involved}) ORDER BY updated_at DESC LIMIT ?`).all(userId, userId, WATCH_LIMIT) as unknown as Row[];
    return { mine: mine.map((row) => this.summary(userId, row)), watch: watch.map((row) => this.summary(userId, row)) };
  }

  /** Any signed-in player may look: tournaments are open to spectators. */
  get(userId: number, id: unknown): TournamentView {
    this.sweep();
    return this.view(userId, this.load(id));
  }

  // ——— Organizer ———

  create(userId: number, body: unknown): TournamentView {
    const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const name = cleanText(input.name, MAX_TOURNAMENT_NAME);
    if (!name) throw new AccountError(400, `Tournament names are 1–${MAX_TOURNAMENT_NAME} printable characters.`);
    if (!validRules(input.rules)) throw new AccountError(400, 'Invalid tournament rules.');
    if (!validFill(input.fill)) throw new AccountError(400, 'Invalid CPU fill.');
    if (input.size !== undefined && !Number.isInteger(input.size)) throw new AccountError(400, 'Invalid bracket size.');
    const usernames = input.usernames;
    if (!Array.isArray(usernames) || usernames.length < 1 || usernames.length > MAX_ENTRANTS || !usernames.every(validUsername)) throw new AccountError(400, `Enter 1 to ${MAX_ENTRANTS} valid usernames.`);
    if (new Set(usernames.map((username) => username.toLowerCase())).size !== usernames.length) throw new AccountError(400, 'Every player can only enter once.');
    // Any account may be entered, friend or not: the organizer is running a room full of people.
    const profiles = usernames.map((username) => this.accounts.profileByUsername(username));
    const unknown = usernames.filter((_, index) => !profiles[index]);
    if (unknown.length) throw new AccountError(400, `Unknown player${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`);
    const active = Number((this.db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE owner_id = ? AND status = 'active'").get(userId) as { n: number }).n);
    if (active >= MAX_ACTIVE_TOURNAMENTS_PER_OWNER) throw new AccountError(409, `You can run up to ${MAX_ACTIVE_TOURNAMENTS_PER_OWNER} tournaments at once. Finish or cancel one first.`);
    let id = this.id();
    for (let attempt = 0; attempt < 8 && this.db.prepare('SELECT 1 FROM tournaments WHERE id = ?').get(id); attempt++) id = this.id();
    const now = this.now();
    let state: TournamentState;
    try {
      state = createTournament({
        id, name, rules: input.rules, fill: input.fill, seed: this.seed() >>> 0, fighters: ROOM_FIGHTERS, now,
        humans: profiles.map((profile) => ({ name: profile!.displayName, userId: profile!.id, username: profile!.username, avatar: profile!.avatar })),
        ...(input.size === undefined ? {} : { size: input.size as number }),
      });
    } catch (error) { throw new AccountError(400, error instanceof Error ? error.message : 'Invalid tournament.'); }
    simulateCpuMatches(state, now);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO tournaments (id, owner_id, status, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, userId, state.status, JSON.stringify(state), now, state.updatedAt);
      const player = this.db.prepare('INSERT INTO tournament_players (tournament_id, user_id) VALUES (?, ?)');
      for (const profile of profiles) player.run(id, profile!.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.view(userId, { ownerId: userId, state });
  }

  reopen(userId: number, id: unknown, matchId: number): TournamentView {
    this.sweep();
    const loaded = this.owned(userId, id), { state } = loaded;
    if (state.status === 'cancelled') throw new AccountError(409, 'This tournament was cancelled.');
    const match = state.matches.find((entry) => entry.id === matchId);
    if (!match) throw new AccountError(404, 'That set does not exist.');
    // A reopened CPU-vs-CPU set would only be simulated again, with the same seed and the same winner.
    if (match.note === 'simulated') throw new AccountError(409, 'CPU sets are simulated: there is nothing to replay.');
    const now = this.now();
    try { reopenMatch(state, matchId, now); } catch (error) { throw new AccountError(409, error instanceof Error ? error.message : 'That set cannot be reopened.'); }
    // The set above lost an entrant: whoever was waiting there is no longer in a ready set.
    const next = state.matches.find((entry) => entry.round === match.round + 1 && entry.index === Math.floor(match.index / 2));
    if (next) this.dropLobbies(state.id, next.id);
    this.dropLobbies(state.id, matchId);
    this.save(state);
    return this.view(userId, loaded);
  }

  cancel(userId: number, id: unknown): TournamentView {
    const loaded = this.owned(userId, id), { state } = loaded;
    if (state.status !== 'active') throw new AccountError(409, 'This tournament is not running.');
    state.status = 'cancelled'; state.updatedAt = this.now();
    this.dropLobbies(state.id);
    this.save(state);
    return this.view(userId, loaded);
  }

  /** Only finished or cancelled tournaments: a running one must be cancelled first, so a slip cannot erase a bracket mid-event. */
  remove(userId: number, id: unknown): void {
    const { state } = this.owned(userId, id);
    if (state.status === 'active') throw new AccountError(409, 'Cancel the tournament before deleting it.');
    this.dropLobbies(state.id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM tournament_players WHERE tournament_id = ?').run(state.id);
      this.db.prepare('DELETE FROM tournaments WHERE id = ?').run(state.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  // ——— Players ———

  /** Set-lobby heartbeat. Only the designated host (side a when human, else b) may publish the room. */
  checkin(userId: number, id: unknown, matchId: number, body: unknown): TournamentView {
    this.sweep();
    const loaded = this.load(id), { state } = loaded;
    const { match, side } = this.playerSet(state, matchId, userId);
    if (!side) throw new AccountError(403, 'You are not playing in that set.');
    const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (typeof input.ready !== 'boolean') throw new AccountError(400, 'Invalid check-in.');
    if (input.room !== undefined && input.room !== null && !validRoomCode(input.room)) throw new AccountError(400, 'Invalid room code.');
    if (input.live !== undefined && typeof input.live !== 'boolean') throw new AccountError(400, 'Invalid check-in.');
    const host: Side = state.entrants[match.a!]?.kind === 'human' ? 'a' : 'b';
    if ((input.room !== undefined || input.live !== undefined) && side !== host) throw new AccountError(403, 'Only the host of the set opens its room.');
    const lobby = this.lobby(state, matchId), now = this.now();
    // Expire a stale room before touching it, so an old `live` flag cannot leak into a new room.
    this.lobbyView(state, match);
    lobby.checkins[side] = { at: now, ready: input.ready };
    lobby.touchedAt = now;
    if (input.room === null) lobby.room = null;
    else if (typeof input.room === 'string' && lobby.room?.code !== input.room) lobby.room = { code: input.room, host, live: false };
    if (input.live !== undefined) {
      if (!lobby.room) { if (input.live) throw new AccountError(400, 'Open a room before going live.'); }
      else { lobby.room.live = input.live; lobby.wasLive ||= input.live; }
    }
    // RANDOM CHAMP: one roll per set, CPUs included, kept until the set is settled.
    if (state.rules.mode === 'random' && !lobby.picks) {
      const rng = new SeededRng(this.seed());
      lobby.picks = { a: rng.pick(ROOM_FIGHTERS), b: rng.pick(ROOM_FIGHTERS) };
    }
    return this.view(userId, loaded);
  }

  /** The organizer's word is final. Two humans must agree (or one stays silent for CLAIM_GRACE_MS); against a CPU the player's word is enough. */
  report(userId: number, id: unknown, matchId: number, body: unknown): TournamentView {
    // No sweep here: a late second report should still agree (or dispute) instead of finding the set already gone.
    const loaded = this.load(id), { state, ownerId } = loaded;
    const { match, side } = this.playerSet(state, matchId, userId);
    if (ownerId !== userId && !side) throw new AccountError(403, 'Only the two players or the organizer report this set.');
    const winner = (body && typeof body === 'object' ? (body as Record<string, unknown>).winner : undefined);
    if (!Number.isInteger(winner) || (winner !== match.a && winner !== match.b)) throw new AccountError(400, 'The winner must be one of the two entrants.');
    const lobby = this.lobbies.get(TournamentService.key(state.id, matchId));
    if (ownerId === userId) this.settleSet(state, matchId, winner as number, lobby?.wasLive ? 'played' : 'walkover');
    else if (SIDES.some((entry) => state.entrants[match[entry]!]?.kind === 'cpu')) this.settleSet(state, matchId, winner as number, 'played');
    else {
      const mine = side!, other: Side = mine === 'a' ? 'b' : 'a';
      const memory = lobby ?? this.lobby(state, matchId);
      if (memory.disputed) throw new AccountError(409, 'The two sides disagree: the organizer decides this set.');
      const now = this.now();
      memory.claims[mine] = { winner: winner as number, at: now };
      memory.touchedAt = now;
      const theirs = memory.claims[other];
      if (theirs && theirs.winner === winner) this.settleSet(state, matchId, winner as number, 'played');
      else if (theirs) memory.disputed = true;
    }
    return this.view(userId, loaded);
  }
}
