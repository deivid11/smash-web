/** LAN tournaments: the JSON contract between the SQLite-backed server API
 * (server/tournaments.ts + server/tournament-api.ts) and the browser client
 * (web/src/play/tournament/). Bearer tokens from lib/net/account-protocol.ts
 * carry the player; the bracket itself is lib/game/tournament/bracket.ts. Sets
 * are played in ordinary LAN rooms (lib/net/protocol.ts): this API only keeps
 * the tree, who is waiting in which set lobby and which room a set runs in.
 */
import type { CpuFill, TournamentRules, TournamentState } from '../game/tournament/bracket.ts';
import type { PublicProfile } from './account-protocol.ts';

export const TOURNAMENTS_API = '/api/tournaments';
/** A set-lobby check-in older than this no longer counts as "here". */
export const CHECKIN_TTL_MS = 20_000;
export const CHECKIN_INTERVAL_MS = 4_000;
export const MAX_ACTIVE_TOURNAMENTS_PER_OWNER = 12;
export const MAX_USER_SEARCH = 8;

export type Side = 'a' | 'b';

/** Live (in-memory) state of one ready set. */
export interface SetLobby {
  matchId: number;
  /** Which human sides are in the set lobby right now, and whether they pressed READY. */
  here: { a: boolean; b: boolean };
  ready: { a: boolean; b: boolean };
  /** The LAN room the set runs in, once its host opened it. `host` sits in room slot 0. */
  room: { code: string; host: Side; live: boolean } | null;
  /** RANDOM CHAMP: the champions rolled for this set. */
  picks: { a: string; b: string } | null;
  /** The two sides reported different winners; the organizer decides. */
  disputed: boolean;
}

export interface TournamentView {
  state: TournamentState;
  owner: PublicProfile;
  /** One entry per ready set. */
  lobbies: SetLobby[];
  /** Entrant id of the signed-in player, or null for the organizer-only / spectators. */
  me: number | null;
  isOwner: boolean;
}

export interface TournamentSummary {
  id: string;
  name: string;
  ownerName: string;
  rules: TournamentRules;
  status: TournamentState['status'];
  entrants: number;
  humans: number;
  size: number;
  played: number;
  total: number;
  championName: string | null;
  /** Sets the signed-in player can play right now. */
  myTurn: number;
  /** Sets running in a room right now (spectate). */
  live: number;
  updatedAt: number;
}

export interface TournamentListResponse {
  /** Tournaments the player organizes or plays in. */
  mine: TournamentSummary[];
  /** Other running tournaments, open to spectators. */
  watch: TournamentSummary[];
}
export interface TournamentResponse { tournament: TournamentView }
export interface UserSearchResponse { users: PublicProfile[] }

export interface CreateTournamentBody {
  name: string;
  rules: TournamentRules;
  fill: CpuFill;
  /** Bracket size when the fill is on. */
  size?: number;
  /** Account usernames, the organizer included if they play. */
  usernames: string[];
}
/** POST …/:id/sets/:matchId/checkin — heartbeat while the set lobby is open. */
export interface CheckinBody { ready: boolean; /** Host only: the room it opened for the set. */ room?: string | null; live?: boolean }
/** POST …/:id/sets/:matchId/result — `winner` is an entrant id. Players report their own set; the organizer may settle any. */
export interface ResultBody { winner: number }
