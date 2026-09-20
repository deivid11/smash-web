import type { FighterKind } from './data.ts';
import type { StageId } from './stages.ts';
import type { HillSetup } from './hill.ts';
import { MAX_MATCH_PLAYERS } from './limits.ts';
import { DEFAULT_CPU_LEVEL, type CpuLevel } from './cpu.ts';

export type SeatControl = 'off' | 'human' | 'cpu';
export type PlayerControllerMode = Exclude<SeatControl, 'off'>;
/** `level` is the CPU intelligence (1-9) used when `control` is 'cpu'; humans keep it for later toggles.
 * `costume` is the visual-only skin index (0 = default `Nr`); simulation never reads it. */
export interface PlayerSeat { slot: number; fighter: FighterKind; control: SeatControl; level: CpuLevel; costume: number }
/** `items` is the match-item frequency rule: -1 off, 0-4 the original interval ladder.
 * `itemSwitches` mirrors the original Item Switch menu: null = every supported item on,
 * otherwise the exact enabled ItemKind ids (subset of the supported set). */
export interface BattleSetup { seats: readonly PlayerSeat[]; stage: StageId; stocks: number; seconds: number; items: number; itemSwitches: readonly number[] | null; /** King of the Hill zone rules (local matches only); null is a classic stock battle. */ hill: HillSetup | null; /** RED (even seats) vs BLUE (odd seats) team battle; free-for-all when false. Local matches only. */ teams: boolean; /** PROTOTYPE (zombies): last-stock KO joins the horde with one permanent stock. Local matches only. */ zombies: boolean }

/** A draft may have fewer than two active seats; starting still requires 2–8. */
export function defaultSeats(): PlayerSeat[] {
  const fighters: readonly FighterKind[] = ['Fx', 'Mr', 'Kb', 'Ss'];
  return Array.from({ length: MAX_MATCH_PLAYERS }, (_, slot) => ({ slot, fighter: fighters[slot % fighters.length]!, control: slot === 0 ? 'human' : slot === 1 ? 'cpu' : 'off', level: DEFAULT_CPU_LEVEL, costume: 0 }));
}
export function activeSeats(seats: readonly PlayerSeat[]): PlayerSeat[] {
  return seats.filter(seat => seat.control !== 'off').sort((a, b) => a.slot - b.slot);
}
