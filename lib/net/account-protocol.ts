/** Accounts, cloud saves, profiles and friends: the JSON contract shared by the
 * SQLite-backed server API (server/accounts.ts + server/account-api.ts) and the
 * browser client (web/src/account/). Sessions are bearer tokens; nothing here
 * travels over the LAN room relay, whose protocol (lib/net/protocol.ts) is unchanged.
 */

export const ACCOUNT_API = '/api/account';
export const SAVES_API = '/api/saves';
export const FRIENDS_API = '/api/friends';
export const PRESENCE_API = '/api/presence';
/** Public, sign-in free: the player directory and any player's profile page. */
export const PLAYERS_API = '/api/players';
/** Signed-in players report each finished game here. */
export const GAMES_API = '/api/games';

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/u;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;
export const MAX_DISPLAY_NAME = 24;
export const MAX_TITLE = 32;
/** Cloud save slots. Only the Rift Descent slot exists today. */
export const SAVE_SLOTS = ['rift'] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];
export const MAX_SAVE_BYTES = 256 * 1024;
/** Presence older than this counts as offline. */
export const PRESENCE_TTL_MS = 75_000;
export const PRESENCE_INTERVAL_MS = 30_000;
export const INVITE_TTL_MS = 10 * 60_000;
export const MAX_FRIENDS = 200;

export type Activity = 'menu' | 'local' | 'lan' | 'rift';
export const ACTIVITIES: readonly Activity[] = ['menu', 'local', 'lan', 'rift'];

/** Rift Descent numbers the server reads out of the saved blob (never trusted for anything but display). */
export interface RiftSummary {
  runs: number;
  wins: number;
  bestScore: number;
  bestCleared: number;
  shards: number;
  keys: number;
  bestHeatWin: number;
  updatedAt: number;
}

/** What any signed-in player may see about another account. */
export interface PublicProfile {
  id: number;
  username: string;
  displayName: string;
  /** Fighter kind shown as the avatar portrait. */
  avatar: string;
  title: string;
  createdAt: number;
  rift: RiftSummary | null;
}

export interface AccountView extends PublicProfile {
  friends: number;
}

export interface AuthResponse { token: string; account: AccountView }
export interface AccountResponse { account: AccountView }

export interface CloudSave { slot: SaveSlot; data: unknown; revision: number; updatedAt: number }
export interface SaveResponse { save: CloudSave | null }
export interface SaveWriteResponse { revision: number; updatedAt: number }
/** 409 body when `baseRevision` is stale: the current cloud copy wins the race. */
export interface SaveConflictResponse { error: string; save: CloudSave }

export interface RoomRef { code: string; players: number; maxPlayers: number; joinable: boolean }
export interface FriendEntry { profile: PublicProfile; since: number; online: boolean; activity: Activity | null; room: RoomRef | null }
export interface FriendRequest { profile: PublicProfile; createdAt: number }
export interface RoomInvite { id: string; from: PublicProfile; room: RoomRef; createdAt: number; expiresAt: number }
export interface FriendsResponse { friends: FriendEntry[]; incoming: FriendRequest[]; outgoing: FriendRequest[]; invites: RoomInvite[] }
/** Heartbeat reply: enough for the home badge and invite toasts without a full friends poll. */
export interface PresenceResponse { incoming: number; onlineFriends: number; invites: RoomInvite[] }

export interface ProfilePatch { displayName?: string; avatar?: string; title?: string }

// ——— Game history + public profiles ———

/** `local`: a battle on one device; `lan`: an online room; `tournament`: a local bracket set; `rift`: one Rift Descent run. */
export type GameMode = 'local' | 'lan' | 'tournament' | 'rift';
export const GAME_MODES: readonly GameMode[] = ['local', 'lan', 'tournament', 'rift'];
export type GameResult = 'win' | 'loss' | 'draw';
export const GAME_RESULTS: readonly GameResult[] = ['win', 'loss', 'draw'];
export const MAX_GAME_OPPONENTS = 7;
export const MAX_RECENT_GAMES = 20;
export const MAX_PLAYER_PAGE = 100;

export interface GameOpponent { name: string; fighter: string; cpu: boolean }
/** Rift runs only: how deep the run got. */
export interface RiftRunDetail { cleared: number; length: number; bossesDown: number; fightsWon: number; heat: number; score: number }
/** One finished game, as reported by the player's own browser. Display only: nothing is ranked on it. */
export interface GameReport {
  /** Random per-game id so a retried upload is stored once. */
  clientId: string;
  mode: GameMode;
  result: GameResult;
  /** Fighter kind the player used. */
  fighter: string;
  stage: string;
  /** Everyone in the match, the player included (1 for a Rift run). */
  players: number;
  kos: number;
  falls: number;
  damage: number;
  seconds: number;
  /** Ruleset tags: `stocks:3`, `teams`, `hill`, `zombies`. */
  rules: string[];
  opponents: GameOpponent[];
  rift: RiftRunDetail | null;
}
export interface GameRecord extends Omit<GameReport, 'clientId'> { id: number; playedAt: number }

export interface ModeTally { games: number; wins: number }
export interface FighterTally { fighter: string; games: number; wins: number }
/** Totals over every recorded game. */
export interface GameStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  falls: number;
  damage: number;
  seconds: number;
  byMode: Record<GameMode, ModeTally>;
  /** Most played first. */
  fighters: FighterTally[];
  lastPlayedAt: number | null;
}
/** Lifetime Rift record from the cloud save (the save holds more than the summary). */
export interface RiftLifetime extends RiftSummary {
  bossesDown: number;
  elitesDown: number;
  eventsVisited: number;
  coinsSpent: number;
  duoRuns: number;
  bestFighter: string | null;
  bestHeat: number;
  /** Champion mastery, most runs first. */
  champions: Array<{ fighter: string; runs: number; wins: number; xp: number }>;
}
export interface PlayerSummary { profile: PublicProfile; games: number; wins: number; lastPlayedAt: number | null }
export interface PlayersResponse { players: PlayerSummary[]; total: number }
export interface PlayerProfileResponse { profile: PublicProfile; rift: RiftLifetime | null; stats: GameStats; recent: GameRecord[] }

export function validUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_PATTERN.test(value);
}
export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD && value.length <= MAX_PASSWORD;
}
/** Printable, trimmed, no control characters. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (text.length > max || /[\p{Cc}\p{Cf}]/u.test(text)) return null;
  return text;
}
export function validRoomCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z2-9]{6}$/u.test(value);
}
