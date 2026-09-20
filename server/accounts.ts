/** SQLite account store: users, bearer sessions, cloud save slots, friendships,
 * plus in-memory presence and LAN room invites. Uses Node's built-in
 * `node:sqlite` (no native addon to compile on the gateway). The HTTP surface
 * lives in server/account-api.ts; the JSON contract in lib/net/account-protocol.ts.
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACTIVITIES, cleanText, GAME_MODES, GAME_RESULTS, INVITE_TTL_MS, MAX_DISPLAY_NAME, MAX_FRIENDS, MAX_GAME_OPPONENTS, MAX_PLAYER_PAGE, MAX_RECENT_GAMES,
  MAX_SAVE_BYTES, MAX_TITLE, PRESENCE_TTL_MS, SAVE_SLOTS, validPassword, validRoomCode, validUsername,
  type AccountView, type Activity, type CloudSave, type FriendEntry, type FriendRequest, type FriendsResponse, type GameMode, type GameOpponent,
  type GameRecord, type GameReport, type GameResult, type GameStats, type PlayerProfileResponse, type PlayersResponse, type PresenceResponse,
  type ProfilePatch, type PublicProfile, type RiftLifetime, type RiftRunDetail, type RiftSummary, type RoomInvite, type RoomRef, type SaveSlot,
} from '../lib/net/account-protocol.ts';
import { MAX_USER_SEARCH } from '../lib/net/tournament-protocol.ts';
import { isCustomFighter } from '../lib/custom/identity.ts';

export class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Open lobby rooms, as the room hub lists them for the public browser. */
export interface LobbyRoom { code: string; players: number; maxPlayers: number }
export interface AccountServiceOptions {
  /** Database file, or ':memory:' for tests. */
  path: string;
  now?: () => number;
  listRooms?: () => LobbyRoom[];
  /** scrypt cost; tests lower it. */
  scryptCost?: number;
  sessionTtlMs?: number;
}

interface UserRow { id: number; username: string; display_name: string; password_hash: string; avatar: string; title: string; created_at: number }
interface Presence { at: number; activity: Activity; room: string | null }
interface StoredInvite { id: string; fromId: number; toId: number; room: string; createdAt: number; expiresAt: number }

const SCHEMA_VERSION = 2;
const DEFAULT_AVATAR = 'Mr';
const SESSION_TTL_MS = 60 * 24 * 60 * 60_000;
const MAX_SESSIONS_PER_USER = 20;
const MAX_INVITES_PER_USER = 20;

const SCHEMA_V1 = `
      CREATE TABLE IF NOT EXISTS users (
        -- AUTOINCREMENT: a deleted account's id is never handed to someone else.
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '${DEFAULT_AVATAR}',
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS saves (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot TEXT NOT NULL,
        data TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, slot)
      );
      CREATE TABLE IF NOT EXISTS friendships (
        requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
        created_at INTEGER NOT NULL,
        responded_at INTEGER,
        PRIMARY KEY (requester_id, addressee_id),
        CHECK (requester_id <> addressee_id)
      );
      CREATE INDEX IF NOT EXISTS friendships_addressee ON friendships(addressee_id);
`;
/** v2: game history behind public profiles. Rows are self-reported by the player's browser. */
const SCHEMA_V2 = `
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
        fighter TEXT NOT NULL,
        stage TEXT NOT NULL,
        players INTEGER NOT NULL,
        kos INTEGER NOT NULL,
        falls INTEGER NOT NULL,
        damage INTEGER NOT NULL,
        seconds INTEGER NOT NULL,
        rules TEXT NOT NULL,
        opponents TEXT NOT NULL,
        rift TEXT,
        played_at INTEGER NOT NULL,
        UNIQUE (user_id, client_id)
      );
      CREATE INDEX IF NOT EXISTS games_user_played ON games(user_id, played_at DESC);
`;
/** Oldest rows beyond this are dropped, so totals cover a player's latest games. */
const MAX_GAMES_PER_USER = 5000;
const count = (value: unknown, max: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0);
const FIGHTER_PATTERN = /^[A-Za-z0-9]{1,4}$/u;
/** Historical metadata may name a pack no longer installed; validate identity, never import it. */
const validFighterCode = (value: string): boolean => FIGHTER_PATTERN.test(value) || isCustomFighter(value);
const STAGE_PATTERN = /^[A-Za-z0-9_-]{1,40}$/u;
const RULE_PATTERN = /^[a-z]{1,12}(:[0-9]{1,3})?$/u;
const emptyTally = () => ({ games: 0, wins: 0 });

function scrypt(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, 32, { N: cost, r: 8, p: 1, maxmem: 128 * cost * 8 * 2 }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

export class AccountService {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly cost: number;
  private readonly sessionTtl: number;
  private readonly presence = new Map<number, Presence>();
  private readonly invites = new Map<number, StoredInvite[]>();
  /** Precomputed hash so unknown usernames cost the same as wrong passwords. */
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly options: AccountServiceOptions) {
    if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true });
    this.db = new DatabaseSync(options.path);
    this.now = options.now ?? Date.now;
    this.cost = options.scryptCost ?? 1 << 15;
    this.sessionTtl = options.sessionTtlMs ?? SESSION_TTL_MS;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void { if (this.db.isOpen) this.db.close(); }

  private migrate(): void {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    if (version >= SCHEMA_VERSION) return;
    this.db.exec(`
      BEGIN;
      ${version < 1 ? SCHEMA_V1 : ''}
      ${version < 2 ? SCHEMA_V2 : ''}
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  // ——— Passwords + sessions ———

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, this.cost);
    return `scrypt$${this.cost}$${salt.toString('base64')}$${key.toString('base64')}`;
  }
  private async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, cost, salt, key] = stored.split('$');
    if (scheme !== 'scrypt' || !cost || !salt || !key) return false;
    const expected = Buffer.from(key, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), Number(cost));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  private createSession(userId: number): string {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(tokenHash(token), userId, now, now, now + this.sessionTtl);
    // Oldest sessions beyond the cap are signed out.
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC LIMIT ?)').run(userId, userId, MAX_SESSIONS_PER_USER);
    return token;
  }

  async register(input: { username?: unknown; password?: unknown; displayName?: unknown }): Promise<{ token: string; account: AccountView }> {
    if (!validUsername(input.username)) throw new AccountError(400, 'Usernames are 3–20 letters, numbers or underscores.');
    if (!validPassword(input.password)) throw new AccountError(400, 'Passwords are 8–128 characters.');
    const displayName = input.displayName === undefined || input.displayName === '' ? input.username : cleanText(input.displayName, MAX_DISPLAY_NAME);
    if (!displayName) throw new AccountError(400, `Display names are 1–${MAX_DISPLAY_NAME} printable characters.`);
    if (this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(input.username)) throw new AccountError(409, 'That username is taken.');
    const hash = await this.hashPassword(input.password);
    const now = this.now();
    let id: number;
    try {
      id = Number(this.db.prepare('INSERT INTO users (username, display_name, password_hash, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(input.username, displayName, hash, DEFAULT_AVATAR, now, now).lastInsertRowid);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new AccountError(409, 'That username is taken.');
      throw error;
    }
    return { token: this.createSession(id), account: this.account(id) };
  }

  async login(input: { username?: unknown; password?: unknown }): Promise<{ token: string; account: AccountView }> {
    const invalid = new AccountError(401, 'Wrong username or password.');
    if (typeof input.username !== 'string' || typeof input.password !== 'string' || input.password.length > 1024) throw invalid;
    const row = validUsername(input.username) ? this.db.prepare('SELECT * FROM users WHERE username = ?').get(input.username) as UserRow | undefined : undefined;
    if (!row) {
      this.dummyHash ??= this.hashPassword('not-a-real-password');
      await this.verifyPassword(input.password, await this.dummyHash);
      throw invalid;
    }
    if (!(await this.verifyPassword(input.password, row.password_hash))) throw invalid;
    return { token: this.createSession(row.id), account: this.account(row.id) };
  }

  /** Resolves a bearer token to a user id, sliding its expiry. */
  authenticate(token: string | null): number {
    if (!token || token.length > 128) throw new AccountError(401, 'Sign in first.');
    const now = this.now();
    const hash = tokenHash(token);
    const row = this.db.prepare('SELECT user_id, last_used_at, expires_at FROM sessions WHERE token_hash = ?').get(hash) as { user_id: number; last_used_at: number; expires_at: number } | undefined;
    if (!row || row.expires_at <= now) {
      if (row) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      throw new AccountError(401, 'Your session expired. Sign in again.');
    }
    if (now - row.last_used_at > 10 * 60_000) this.db.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?').run(now, now + this.sessionTtl, hash);
    return row.user_id;
  }

  logout(token: string): void { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token)); }

  async changePassword(userId: number, token: string, input: { current?: unknown; next?: unknown }): Promise<void> {
    const row = this.user(userId);
    if (typeof input.current !== 'string' || !(await this.verifyPassword(input.current, row.password_hash))) throw new AccountError(403, 'Your current password is wrong.');
    if (!validPassword(input.next)) throw new AccountError(400, 'Passwords are 8–128 characters.');
    const hash = await this.hashPassword(input.next);
    this.transaction(() => {
      this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, this.now(), userId);
      // Every other device signs in again.
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, tokenHash(token));
    });
  }

  async deleteAccount(userId: number, input: { password?: unknown }): Promise<void> {
    const row = this.user(userId);
    if (typeof input.password !== 'string' || !(await this.verifyPassword(input.password, row.password_hash))) throw new AccountError(403, 'Your password is wrong.');
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    this.presence.delete(userId);
    this.invites.delete(userId);
    for (const [id, list] of this.invites) this.invites.set(id, list.filter((invite) => invite.fromId !== userId));
  }

  // ——— Profiles ———

  private user(id: number): UserRow {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!row) throw new AccountError(401, 'This account no longer exists.');
    return row;
  }
  private rift(userId: number): RiftSummary | null {
    const row = this.db.prepare(`SELECT updated_at,
      json_extract(data, '$.meta.stats.runs') AS runs, json_extract(data, '$.meta.stats.wins') AS wins,
      json_extract(data, '$.meta.shards') AS shards, json_extract(data, '$.meta.keys') AS keys,
      json_extract(data, '$.meta.stats.bestHeatWin') AS bestHeatWin,
      json_extract(data, '$.best.score') AS bestScore, json_extract(data, '$.best.cleared') AS bestCleared
      FROM saves WHERE user_id = ? AND slot = 'rift'`).get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      runs: num(row.runs), wins: num(row.wins), shards: num(row.shards), keys: num(row.keys), bestHeatWin: num(row.bestHeatWin, -1),
      bestScore: num(row.bestScore), bestCleared: num(row.bestCleared), updatedAt: num(row.updated_at),
    };
  }
  private publicProfile(row: UserRow): PublicProfile {
    return { id: row.id, username: row.username, displayName: row.display_name, avatar: row.avatar, title: row.title, createdAt: row.created_at, rift: this.rift(row.id) };
  }
  // Public lookups for server/tournaments.ts: any account may be entered in a bracket, friend or not.
  profileById(id: number): PublicProfile | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? this.publicProfile(row) : null;
  }
  /** Case-insensitive: the column is COLLATE NOCASE. */
  profileByUsername(username: string): PublicProfile | null {
    const row = validUsername(username) ? this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined : undefined;
    return row ? this.publicProfile(row) : null;
  }
  /** Prefix match on username or display name. `rift` stays null: a search result is a name tag, not a profile page. */
  searchUsers(prefix: string, limit: number): PublicProfile[] {
    const text = cleanText(prefix, MAX_DISPLAY_NAME);
    if (!text || text.length < 2) return [];
    const pattern = `${text.replace(/[\\%_]/gu, '\\$&')}%`;
    const rows = this.db.prepare("SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' ORDER BY username LIMIT ?")
      .all(pattern, pattern, Math.max(1, Math.min(MAX_USER_SEARCH, Math.floor(limit) || 1))) as unknown as UserRow[];
    return rows.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, avatar: row.avatar, title: row.title, createdAt: row.created_at, rift: null }));
  }
  account(userId: number): AccountView {
    const friends = Number((this.db.prepare("SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)").get(userId, userId) as { n: number }).n);
    return { ...this.publicProfile(this.user(userId)), friends };
  }

  updateProfile(userId: number, patch: ProfilePatch): AccountView {
    const row = this.user(userId);
    let displayName = row.display_name, avatar = row.avatar, title = row.title;
    if (patch.displayName !== undefined) {
      const clean = cleanText(patch.displayName, MAX_DISPLAY_NAME);
      if (!clean) throw new AccountError(400, `Display names are 1–${MAX_DISPLAY_NAME} printable characters.`);
      displayName = clean;
    }
    if (patch.avatar !== undefined) {
      if (typeof patch.avatar !== 'string' || !validFighterCode(patch.avatar)) throw new AccountError(400, 'Unknown avatar fighter.');
      avatar = patch.avatar;
    }
    if (patch.title !== undefined) {
      const clean = patch.title === '' ? '' : cleanText(patch.title, MAX_TITLE);
      if (clean === null) throw new AccountError(400, `Titles are up to ${MAX_TITLE} printable characters.`);
      title = clean;
    }
    this.db.prepare('UPDATE users SET display_name = ?, avatar = ?, title = ?, updated_at = ? WHERE id = ?').run(displayName, avatar, title, this.now(), userId);
    return this.account(userId);
  }

  // ——— Game history + public profiles (readable without signing in) ———

  /** Stores one finished game. A repeated `clientId` (a retried upload) is a no-op. */
  recordGame(userId: number, input: Record<string, unknown>): { id: number | null } {
    this.user(userId);
    const report = this.parseGame(input);
    const now = this.now();
    return this.transaction(() => {
      const result = this.db.prepare(`INSERT OR IGNORE INTO games (user_id, client_id, mode, result, fighter, stage, players, kos, falls, damage, seconds, rules, opponents, rift, played_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, report.clientId, report.mode, report.result, report.fighter, report.stage, report.players,
        report.kos, report.falls, report.damage, report.seconds, JSON.stringify(report.rules), JSON.stringify(report.opponents), report.rift ? JSON.stringify(report.rift) : null, now);
      if (!result.changes) return { id: null };
      this.db.prepare('DELETE FROM games WHERE user_id = ? AND id NOT IN (SELECT id FROM games WHERE user_id = ? ORDER BY played_at DESC, id DESC LIMIT ?)').run(userId, userId, MAX_GAMES_PER_USER);
      return { id: Number(result.lastInsertRowid) };
    });
  }

  private parseGame(input: Record<string, unknown>): GameReport {
    const invalid = (what: string) => new AccountError(400, `Invalid game report: ${what}.`);
    const mode = GAME_MODES.find((entry) => entry === input.mode);
    const result = GAME_RESULTS.find((entry) => entry === input.result);
    if (typeof input.clientId !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/u.test(input.clientId)) throw invalid('clientId');
    if (!mode) throw invalid('mode');
    if (!result) throw invalid('result');
    if (typeof input.fighter !== 'string' || !validFighterCode(input.fighter)) throw invalid('fighter');
    if (typeof input.stage !== 'string' || !STAGE_PATTERN.test(input.stage)) throw invalid('stage');
    const players = count(input.players, 8);
    if (players < 1) throw invalid('players');
    const rules = Array.isArray(input.rules) ? input.rules.filter((rule): rule is string => typeof rule === 'string' && RULE_PATTERN.test(rule)).slice(0, 8) : [];
    if (!Array.isArray(input.opponents) || input.opponents.length > MAX_GAME_OPPONENTS) throw invalid('opponents');
    const opponents: GameOpponent[] = input.opponents.map((entry: unknown) => {
      const opponent = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      if (typeof opponent.fighter !== 'string' || !validFighterCode(opponent.fighter)) throw invalid('opponent fighter');
      return { name: cleanText(opponent.name, MAX_DISPLAY_NAME) || 'Player', fighter: opponent.fighter, cpu: opponent.cpu === true };
    });
    let rift: RiftRunDetail | null = null;
    if (mode === 'rift') {
      const detail = (input.rift && typeof input.rift === 'object' ? input.rift : null) as Record<string, unknown> | null;
      if (!detail) throw invalid('rift');
      rift = { cleared: count(detail.cleared, 99), length: count(detail.length, 99), bossesDown: count(detail.bossesDown, 99), fightsWon: count(detail.fightsWon, 999), heat: count(detail.heat, 99), score: count(detail.score, 1e9) };
    }
    return {
      clientId: input.clientId, mode, result, fighter: input.fighter, stage: input.stage, players,
      kos: count(input.kos, 999), falls: count(input.falls, 999), damage: count(input.damage, 1e6), seconds: count(input.seconds, 86_400),
      rules, opponents, rift,
    };
  }

  /** The player directory: most recently active first, then newest accounts. `query` filters by name prefix. */
  players(input: { offset?: unknown; limit?: unknown; query?: unknown }): PlayersResponse {
    const limit = Math.max(1, Math.min(MAX_PLAYER_PAGE, Math.floor(Number(input.limit)) || 50));
    const offset = Math.max(0, Math.floor(Number(input.offset)) || 0);
    const text = typeof input.query === 'string' ? cleanText(input.query, MAX_DISPLAY_NAME) : '';
    const filter = text ? "WHERE u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'" : '';
    const args = text ? [`${text.replace(/[\\%_]/gu, '\\$&')}%`, `${text.replace(/[\\%_]/gu, '\\$&')}%`] : [];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM users u ${filter}`).get(...args) as { n: number }).n);
    const rows = this.db.prepare(`SELECT u.*, COUNT(g.id) AS games, COALESCE(SUM(g.result = 'win'), 0) AS wins, MAX(g.played_at) AS last_played
      FROM users u LEFT JOIN games g ON g.user_id = u.id ${filter}
      GROUP BY u.id ORDER BY last_played IS NULL, last_played DESC, u.created_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as unknown as Array<UserRow & { games: number; wins: number; last_played: number | null }>;
    return {
      total,
      players: rows.map((row) => ({ profile: this.publicProfile(row), games: Number(row.games), wins: Number(row.wins), lastPlayedAt: row.last_played === null ? null : Number(row.last_played) })),
    };
  }

  /** Anyone's profile page: Rift record, totals over every recorded game and the latest games. */
  playerProfile(username: string): PlayerProfileResponse {
    const row = validUsername(username) ? this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined : undefined;
    if (!row) throw new AccountError(404, 'No player has that username.');
    return { profile: this.publicProfile(row), rift: this.riftLifetime(row.id), stats: this.gameStats(row.id), recent: this.recentGames(row.id, MAX_RECENT_GAMES) };
  }

  private gameStats(userId: number): GameStats {
    const totals = this.db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(result = 'win'), 0) AS wins, COALESCE(SUM(result = 'loss'), 0) AS losses, COALESCE(SUM(result = 'draw'), 0) AS draws,
      COALESCE(SUM(kos), 0) AS kos, COALESCE(SUM(falls), 0) AS falls, COALESCE(SUM(damage), 0) AS damage, COALESCE(SUM(seconds), 0) AS seconds, MAX(played_at) AS last
      FROM games WHERE user_id = ?`).get(userId) as Record<string, number | null>;
    const byMode = Object.fromEntries(GAME_MODES.map((mode) => [mode, emptyTally()])) as Record<GameMode, { games: number; wins: number }>;
    for (const entry of this.db.prepare("SELECT mode, COUNT(*) AS games, SUM(result = 'win') AS wins FROM games WHERE user_id = ? GROUP BY mode").all(userId) as Array<{ mode: GameMode; games: number; wins: number }>) {
      if (byMode[entry.mode]) byMode[entry.mode] = { games: Number(entry.games), wins: Number(entry.wins) };
    }
    const fighters = (this.db.prepare("SELECT fighter, COUNT(*) AS games, SUM(result = 'win') AS wins FROM games WHERE user_id = ? GROUP BY fighter ORDER BY games DESC, wins DESC LIMIT 8").all(userId) as Array<{ fighter: string; games: number; wins: number }>)
      .map((entry) => ({ fighter: entry.fighter, games: Number(entry.games), wins: Number(entry.wins) }));
    return {
      games: num(totals.games), wins: num(totals.wins), losses: num(totals.losses), draws: num(totals.draws),
      kos: num(totals.kos), falls: num(totals.falls), damage: num(totals.damage), seconds: num(totals.seconds),
      byMode, fighters, lastPlayedAt: totals.last === null ? null : num(totals.last),
    };
  }

  private recentGames(userId: number, limit: number): GameRecord[] {
    const rows = this.db.prepare('SELECT * FROM games WHERE user_id = ? ORDER BY played_at DESC, id DESC LIMIT ?').all(userId, limit) as Array<Record<string, unknown>>;
    const parse = <T>(text: unknown, fallback: T): T => { try { return typeof text === 'string' ? JSON.parse(text) as T : fallback; } catch { return fallback; } };
    return rows.map((row) => ({
      id: Number(row.id), playedAt: Number(row.played_at), mode: row.mode as GameMode, result: row.result as GameResult, fighter: String(row.fighter), stage: String(row.stage),
      players: Number(row.players), kos: Number(row.kos), falls: Number(row.falls), damage: Number(row.damage), seconds: Number(row.seconds),
      rules: parse<string[]>(row.rules, []), opponents: parse<GameOpponent[]>(row.opponents, []), rift: parse<RiftRunDetail | null>(row.rift, null),
    }));
  }

  /** The whole lifetime Rift record the cloud save carries, not just the summary on name tags. */
  private riftLifetime(userId: number): RiftLifetime | null {
    const summary = this.rift(userId);
    if (!summary) return null;
    const row = this.db.prepare("SELECT data FROM saves WHERE user_id = ? AND slot = 'rift'").get(userId) as { data: string } | undefined;
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(row?.data ?? '{}') as Record<string, unknown>; } catch { /* summary only */ }
    const meta = (data.meta && typeof data.meta === 'object' ? data.meta : {}) as Record<string, unknown>;
    const stats = (meta.stats && typeof meta.stats === 'object' ? meta.stats : {}) as Record<string, unknown>;
    const best = (data.best && typeof data.best === 'object' ? data.best : {}) as Record<string, unknown>;
    const champions = Object.entries((meta.champions && typeof meta.champions === 'object' ? meta.champions : {}) as Record<string, Record<string, unknown>>)
      .filter(([fighter, record]) => validFighterCode(fighter) && record && typeof record === 'object')
      .map(([fighter, record]) => ({ fighter, runs: num(record.runs), wins: num(record.wins), xp: num(record.xp) }))
      .filter((entry) => entry.runs > 0)
      .sort((a, b) => b.runs - a.runs || b.wins - a.wins)
      .slice(0, 12);
    return {
      ...summary,
      bossesDown: num(stats.bossesDown), elitesDown: num(stats.elitesDown), eventsVisited: num(stats.eventsVisited), coinsSpent: num(stats.coinsSpent), duoRuns: num(stats.duoRuns),
      bestFighter: typeof best.fighter === 'string' && validFighterCode(best.fighter) ? best.fighter : null, bestHeat: num(best.heat),
      champions,
    };
  }

  // ——— Cloud saves ———

  private slot(value: unknown): SaveSlot {
    const slot = SAVE_SLOTS.find((entry) => entry === value);
    if (!slot) throw new AccountError(404, 'Unknown save slot.');
    return slot;
  }
  getSave(userId: number, slotName: unknown): CloudSave | null {
    const slot = this.slot(slotName);
    const row = this.db.prepare('SELECT data, revision, updated_at FROM saves WHERE user_id = ? AND slot = ?').get(userId, slot) as { data: string; revision: number; updated_at: number } | undefined;
    return row ? { slot, data: JSON.parse(row.data) as unknown, revision: row.revision, updatedAt: row.updated_at } : null;
  }
  /** Optimistic concurrency: `baseRevision` must match the stored revision (0 = no save yet). */
  putSave(userId: number, slotName: unknown, input: { data: unknown; baseRevision: unknown }): { revision: number; updatedAt: number } {
    const slot = this.slot(slotName);
    if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new AccountError(400, 'Save data must be a JSON object.');
    if (!Number.isSafeInteger(input.baseRevision) || (input.baseRevision as number) < 0) throw new AccountError(400, 'baseRevision must be a non-negative integer.');
    const text = JSON.stringify(input.data);
    if (Buffer.byteLength(text) > MAX_SAVE_BYTES) throw new AccountError(413, 'Save data is too large.');
    return this.transaction(() => {
      const current = this.db.prepare('SELECT revision FROM saves WHERE user_id = ? AND slot = ?').get(userId, slot) as { revision: number } | undefined;
      if ((current?.revision ?? 0) !== input.baseRevision) throw new SaveConflict(this.getSave(userId, slot)!);
      const revision = (current?.revision ?? 0) + 1, updatedAt = this.now();
      this.db.prepare('INSERT INTO saves (user_id, slot, data, revision, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, slot) DO UPDATE SET data = excluded.data, revision = excluded.revision, updated_at = excluded.updated_at').run(userId, slot, text, revision, updatedAt);
      return { revision, updatedAt };
    });
  }

  // ——— Friends ———

  private friendIds(userId: number): Array<{ id: number; since: number }> {
    return (this.db.prepare(`SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id, COALESCE(responded_at, created_at) AS since
      FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`).all(userId, userId, userId) as Array<{ id: number; since: number }>);
  }
  /** Accepted friends only; server/party-hub.ts gates invitations and friends-only parties on it. */
  friendIdsOf(userId: number): number[] { return this.friendIds(userId).map(({ id }) => id); }
  private areFriends(a: number, b: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))").get(a, b, b, a);
  }

  /** Sends a request by username; a crossing request from them is accepted instead. */
  requestFriend(userId: number, username: unknown): FriendsResponse {
    if (typeof username !== 'string' || !validUsername(username.trim())) throw new AccountError(400, 'Enter a valid username.');
    const target = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
    if (!target) throw new AccountError(404, 'No player has that username.');
    if (target.id === userId) throw new AccountError(400, 'You cannot add yourself.');
    this.transaction(() => {
      const mine = this.db.prepare('SELECT status FROM friendships WHERE requester_id = ? AND addressee_id = ?').get(userId, target.id) as { status: string } | undefined;
      const theirs = this.db.prepare('SELECT status FROM friendships WHERE requester_id = ? AND addressee_id = ?').get(target.id, userId) as { status: string } | undefined;
      if (mine?.status === 'accepted' || theirs?.status === 'accepted') throw new AccountError(409, 'You are already friends.');
      if (mine) throw new AccountError(409, 'Your request is already pending.');
      if (theirs) {
        this.db.prepare("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE requester_id = ? AND addressee_id = ?").run(this.now(), target.id, userId);
        return;
      }
      if (this.friendIds(userId).length >= MAX_FRIENDS) throw new AccountError(409, `Friend lists hold up to ${MAX_FRIENDS} players.`);
      const pending = Number((this.db.prepare("SELECT COUNT(*) AS n FROM friendships WHERE requester_id = ? AND status = 'pending'").get(userId) as { n: number }).n);
      if (pending >= 50) throw new AccountError(429, 'Too many pending requests. Wait for some answers first.');
      this.db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(userId, target.id, this.now());
    });
    return this.friends(userId);
  }

  respondFriend(userId: number, fromId: unknown, accept: unknown): FriendsResponse {
    if (!Number.isSafeInteger(fromId) || typeof accept !== 'boolean') throw new AccountError(400, 'Invalid friend request answer.');
    const pending = this.db.prepare("SELECT 1 FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'").get(fromId as number, userId);
    if (!pending) throw new AccountError(404, 'That friend request no longer exists.');
    if (accept) {
      if (this.friendIds(userId).length >= MAX_FRIENDS) throw new AccountError(409, `Friend lists hold up to ${MAX_FRIENDS} players.`);
      this.db.prepare("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE requester_id = ? AND addressee_id = ?").run(this.now(), fromId as number, userId);
    } else {
      this.db.prepare('DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?').run(fromId as number, userId);
    }
    return this.friends(userId);
  }

  /** Unfriends, or cancels an outgoing request, in either direction. */
  removeFriend(userId: number, otherId: unknown): FriendsResponse {
    if (!Number.isSafeInteger(otherId)) throw new AccountError(400, 'Invalid player id.');
    const other = otherId as number;
    this.db.prepare('DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)').run(userId, other, other, userId);
    const drop = (owner: number, from: number) => this.invites.set(owner, (this.invites.get(owner) ?? []).filter((invite) => invite.fromId !== from));
    drop(userId, other); drop(other, userId);
    return this.friends(userId);
  }

  private roomRef(code: string | null): RoomRef | null {
    if (!code) return null;
    const room = this.options.listRooms?.().find((entry) => entry.code === code);
    return room ? { code, players: room.players, maxPlayers: room.maxPlayers, joinable: room.players < room.maxPlayers } : { code, players: 0, maxPlayers: 0, joinable: false };
  }
  private livePresence(userId: number): Presence | null {
    const entry = this.presence.get(userId);
    if (!entry || this.now() - entry.at > PRESENCE_TTL_MS) return null;
    return entry;
  }
  private liveInvites(userId: number): RoomInvite[] {
    const now = this.now();
    const list = (this.invites.get(userId) ?? []).filter((invite) => invite.expiresAt > now && this.areFriends(invite.fromId, userId));
    if (list.length) this.invites.set(userId, list); else this.invites.delete(userId);
    return list.flatMap((invite) => {
      const from = this.db.prepare('SELECT * FROM users WHERE id = ?').get(invite.fromId) as UserRow | undefined;
      const room = this.roomRef(invite.room);
      // An invite only matters while its room is still an open lobby.
      return from && room?.joinable ? [{ id: invite.id, from: this.publicProfile(from), room, createdAt: invite.createdAt, expiresAt: invite.expiresAt }] : [];
    });
  }

  friends(userId: number): FriendsResponse {
    const friends: FriendEntry[] = this.friendIds(userId).map(({ id, since }) => {
      const presence = this.livePresence(id);
      return { profile: this.publicProfile(this.user(id)), since, online: !!presence, activity: presence?.activity ?? null, room: presence ? this.roomRef(presence.room) : null };
    }).sort((a, b) => Number(b.online) - Number(a.online) || a.profile.displayName.localeCompare(b.profile.displayName));
    const requests = (sql: string): FriendRequest[] => (this.db.prepare(sql).all(userId) as Array<{ other: number; created_at: number }>)
      .map((row) => ({ profile: this.publicProfile(this.user(row.other)), createdAt: row.created_at }));
    return {
      friends,
      incoming: requests("SELECT requester_id AS other, created_at FROM friendships WHERE addressee_id = ? AND status = 'pending' ORDER BY created_at DESC"),
      outgoing: requests("SELECT addressee_id AS other, created_at FROM friendships WHERE requester_id = ? AND status = 'pending' ORDER BY created_at DESC"),
      invites: this.liveInvites(userId),
    };
  }

  // ——— Presence + invites (memory only: a restart simply forgets them) ———

  heartbeat(userId: number, input: { activity: unknown; room: unknown }): PresenceResponse {
    const activity = ACTIVITIES.find((entry) => entry === input.activity) ?? 'menu';
    const room = validRoomCode(input.room) ? input.room : null;
    this.presence.set(userId, { at: this.now(), activity, room });
    const incoming = Number((this.db.prepare("SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'").get(userId) as { n: number }).n);
    const onlineFriends = this.friendIds(userId).filter(({ id }) => this.livePresence(id)).length;
    return { incoming, onlineFriends, invites: this.liveInvites(userId) };
  }
  signOff(userId: number): void { this.presence.delete(userId); }

  invite(userId: number, input: { friendId: unknown; room: unknown }): void {
    if (!Number.isSafeInteger(input.friendId) || !validRoomCode(input.room)) throw new AccountError(400, 'Invalid invite.');
    const friendId = input.friendId as number;
    if (!this.areFriends(userId, friendId)) throw new AccountError(403, 'You can only invite friends.');
    if (!this.roomRef(input.room)?.joinable) throw new AccountError(409, 'That room is not an open lobby.');
    const now = this.now();
    const list = (this.invites.get(friendId) ?? []).filter((invite) => invite.expiresAt > now && !(invite.fromId === userId && invite.room === input.room));
    list.push({ id: randomBytes(9).toString('base64url'), fromId: userId, toId: friendId, room: input.room, createdAt: now, expiresAt: now + INVITE_TTL_MS });
    this.invites.set(friendId, list.slice(-MAX_INVITES_PER_USER));
  }
  dismissInvite(userId: number, id: unknown): void {
    if (typeof id !== 'string') throw new AccountError(400, 'Invalid invite id.');
    this.invites.set(userId, (this.invites.get(userId) ?? []).filter((invite) => invite.id !== id));
  }
}

export class SaveConflict extends AccountError {
  constructor(readonly save: CloudSave) { super(409, 'The cloud save changed on another device.'); }
}
