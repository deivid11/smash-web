/** Turns a finished match or Rift run into the game report a signed-in player's
 * browser uploads (web/src/account/account-client.ts `reportGame`). Pure: the
 * session gathers the numbers, this decides the result from the player's seat.
 */
import type { GameMode, GameReport, GameResult } from '../../../lib/net/account-protocol.ts';

export interface EndedFighter {
  kind: string;
  /** Seat label shown to others: a room player name, `CPU`, or `P2`. */
  name: string;
  cpu: boolean;
  seatId: number;
  /** Team battles: 0 RED, 1 BLUE; null in free-for-all. */
  team: 0 | 1 | null;
  infected: boolean;
  kos: number;
  falls: number;
  damage: number;
}
export interface EndedMatch {
  mode: Exclude<GameMode, 'rift'>;
  stage: string;
  seconds: number;
  /** Dense index of the winner (team battles: any member of the winning team); null on a draw. */
  winner: number | null;
  /** Dense index of this browser's player. */
  me: number;
  zombies: boolean;
  rules: string[];
  fighters: EndedFighter[];
}
export interface EndedRun {
  fighter: string;
  victory: boolean;
  cleared: number;
  length: number;
  bossesDown: number;
  fightsWon: number;
  heat: number;
  score: number;
  seconds: number;
}

export function newClientId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.every((byte) => byte === 0)) for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function matchResult(match: Pick<EndedMatch, 'winner' | 'me' | 'zombies' | 'fighters'>): GameResult {
  if (match.winner === null) return 'draw';
  const me = match.fighters[match.me], winner = match.fighters[match.winner];
  if (!me || !winner) return 'draw';
  // Zombies: the horde wins together, a lone survivor wins alone.
  if (match.zombies) return winner.infected ? (me.infected ? 'win' : 'loss') : match.winner === match.me ? 'win' : 'loss';
  if (winner.team !== null) return me.team === winner.team ? 'win' : 'loss';
  return match.winner === match.me ? 'win' : 'loss';
}

/** Null when this browser had no seat (spectating, CPU exhibition). */
export function matchReport(match: EndedMatch, clientId = newClientId()): GameReport | null {
  const me = match.fighters[match.me];
  if (!me || me.cpu) return null;
  return {
    clientId, mode: match.mode, result: matchResult(match), fighter: me.kind, stage: match.stage, players: match.fighters.length,
    kos: me.kos, falls: me.falls, damage: me.damage, seconds: Math.round(match.seconds), rules: match.rules,
    opponents: match.fighters.flatMap((fighter, index) => (index === match.me ? [] : [{ name: fighter.name, fighter: fighter.kind, cpu: fighter.cpu }])),
    rift: null,
  };
}

export function riftReport(run: EndedRun, clientId = newClientId()): GameReport {
  return {
    clientId, mode: 'rift', result: run.victory ? 'win' : 'loss', fighter: run.fighter, stage: 'rift', players: 1,
    kos: run.fightsWon, falls: 0, damage: 0, seconds: Math.round(run.seconds), rules: [`heat:${Math.max(0, Math.min(999, Math.floor(run.heat)))}`],
    opponents: [],
    rift: { cleared: run.cleared, length: run.length, bossesDown: run.bossesDown, fightsWon: run.fightsWon, heat: run.heat, score: run.score },
  };
}
