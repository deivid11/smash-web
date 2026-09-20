/** Setup-safe floor application: translate a generated floor + build into a
 * concrete match setup, then apply post-start adjustments to a live match.
 *
 * Everything here stays inside legal `BattleSetup` ranges and per-fighter
 * `stocks`/`percent`/`rogue` fields. This wrapper never edits physics, combat
 * data, move tables or original functions — it only configures what the
 * existing `LocalMatch` in `lib/game/match.ts` already supports (plus the
 * bounded one-way-platform remix from `lib/game/roguelike/procedural-stage.ts`,
 * which keeps solid floors, blast zones, spawns and ledges identical).
 */
import { clampCpuLevel, DEFAULT_CPU_LEVEL, type CpuLevel } from '../cpu.ts';
import type { FighterKind, StageGameplayData } from '../data.ts';
import type { RogueHex, RogueMods, RoguePoison } from './sim.ts';
import { MAX_MATCH_PLAYERS } from '../limits.ts';
import type { PlayerSeat, SeatControl } from '../setup.ts';
import type { StageId } from '../stages.ts';
import type { BoonState } from './boons.ts';
import { modsForAffixes, type FoeAffixId } from './affixes.ts';
import { floorVersus, type FloorPlan } from './generator.ts';
import { applyRiftRemix, planRiftRemixForStage } from './procedural-stage.ts';
import { bossById, boostMods } from './bosses.ts';
import type { PendingFight } from './run-state.ts';

export interface FloorSetup {
  seats: PlayerSeat[];
  stage: StageId;
  stocks: number;
  seconds: number;
  playerStartPercent: number;
  enemyStartPercent: number;
  playerMods: RogueMods;
  enemyMods: RogueMods;
  /** Per-foe mods and stocks in dense seat order (bosses boosted). */
  foeMods: RogueMods[];
  foeStocks: number[];
  /** Fighter actually fielded per foe (after ACE fallbacks), and boss flags. */
  foes: Array<{ fighter: FighterKind; boss: boolean; giga: boolean; substituted: boolean }>;
  /** Foe gifts in force (floor affixes + event curses). */
  affixes: FoeAffixId[];
  /** Per-floor Last Stands from boons, before run-wide defiances are added. */
  floorStands: number;
  remixLabel: string | null;
}

export interface FloorExtras {
  pending?: readonly PendingFight[];
  /** Run-wide Last Stands added to the player's per-floor ones. */
  defiances?: number;
  /** Fighter availability (ACE boss slots fall back when this says no). */
  available?: (fighter: FighterKind) => boolean;
  /** Extra match stocks for the player (boss treasures). */
  bonusStocks?: number;
}

/** Structural view of a live match: satisfied by `LocalMatch` in
 * `lib/game/match.ts` and by test fakes. Rendering never reads this. */
export interface MatchLike {
  fighters: Array<{ stocks: number; percent: number; rogue: RogueMods; poison: RoguePoison | null; hex: RogueHex | null }>;
  content: { stage: StageGameplayData };
}

const clampPercent = (value: number): number => Math.max(0, Math.min(999, Math.floor(value)));
const clampStocks = (value: number): number => Math.max(1, Math.min(9, Math.round(value)));
const clampSeconds = (value: number): number => Math.max(1, Math.min(600, Math.round(value)));

export function floorSetupFor(floor: FloorPlan, boons: BoonState, playerFighter: FighterKind, extras: FloorExtras = {}): FloorSetup {
  const pending = extras.pending ?? [];
  const curseLevels = pending.reduce((sum, entry) => sum + entry.levelShift, 0);
  const seats: PlayerSeat[] = Array.from({ length: MAX_MATCH_PLAYERS }, (_, slot) => ({
    slot,
    fighter: playerFighter,
    control: 'off' as SeatControl,
    level: DEFAULT_CPU_LEVEL,
    costume: 0,
  }));
  seats[0] = { slot: 0, fighter: playerFighter, control: 'human', level: DEFAULT_CPU_LEVEL, costume: 0 };
  const shift = (level: number): CpuLevel => clampCpuLevel(Math.max(1, Math.min(9, level + boons.levelShift + curseLevels)) as CpuLevel);
  const affixes = [...new Set([...(floor.affixes ?? []), ...pending.flatMap((entry) => entry.affixes)])];
  const foe = modsForAffixes(affixes);
  // Team floors ally every rival (the Echo mirror and gauntlet twin included); free-for-alls don't.
  const versus = floorVersus(floor, pending.some((entry) => entry.mirror) ? 1 : 0);
  // Tower rage, depth scaling and heat ride the foe side; boons stay player-side.
  const enemyMods: RogueMods = {
    ...foe,
    team: versus.format === 'team' ? 2 : 0,
    damageDealtMul: boons.enemyDamageMul * floor.foeDamage * foe.damageDealtMul,
    damageTakenMul: foe.damageTakenMul * (floor.foeTakenMul ?? 1),
    knockbackTakenMul: foe.knockbackTakenMul * (floor.foeKnockbackTakenMul ?? 1),
    speedMul: Math.min(1.5, boons.enemySpeedMul * foe.speedMul * (floor.foeSpeedMul ?? 1)),
  };
  const boss = floor.boss ? bossById(floor.boss) : null;
  const foeMods: RogueMods[] = [];
  const foeStocks: number[] = [];
  const foes: FloorSetup['foes'] = [];
  let next = 1;
  for (const enemy of floor.enemies) {
    if (next >= MAX_MATCH_PLAYERS) break;
    const substituted = !!enemy.fallback && !!extras.available && !extras.available(enemy.fighter);
    const fighter = substituted ? enemy.fallback! : enemy.fighter;
    seats[next] = { slot: next, fighter, control: 'cpu', level: shift(enemy.level), costume: 0 };
    let mods = enemy.boss && boss ? boostMods(enemyMods, boss.boost) : { ...enemyMods };
    // A boosted stand-in for a missing Giga fighter is extra heavy to compensate (ACE rival stand-ins fight as themselves).
    if (substituted && enemy.giga) mods = { ...mods, damageTakenMul: mods.damageTakenMul * 0.85, knockbackTakenMul: mods.knockbackTakenMul * 0.8, damageDealtMul: mods.damageDealtMul * 1.1 };
    foeMods.push(mods);
    foeStocks.push(clampStocks(enemy.stocks ?? floor.playerStocks));
    foes.push({ fighter, boss: !!enemy.boss, giga: !!enemy.giga, substituted });
    next++;
  }
  if (floor.modifier?.id === 'gauntlet' && next < MAX_MATCH_PLAYERS && floor.enemies[0]) {
    seats[next] = { slot: next, fighter: floor.enemies[0].fighter, control: 'cpu', level: shift(Math.max(1, floor.enemies[0].level - 2)), costume: 0 };
    foeMods.push({ ...enemyMods }); foeStocks.push(clampStocks(floor.playerStocks));
    foes.push({ fighter: floor.enemies[0].fighter, boss: false, giga: false, substituted: false });
    next++;
  }
  // Echo of Yourself: a mirror of the player's fighter one level above the top rival.
  if (pending.some((entry) => entry.mirror) && next < MAX_MATCH_PLAYERS) {
    const top = Math.max(1, ...floor.enemies.map((enemy) => enemy.level));
    seats[next] = { slot: next, fighter: playerFighter, control: 'cpu', level: shift(top + 1), costume: 0 };
    foeMods.push({ ...enemyMods }); foeStocks.push(clampStocks(floor.playerStocks));
    foes.push({ fighter: playerFighter, boss: false, giga: false, substituted: false });
    next++;
  }
  const playerMods: RogueMods = { ...boons.player, lastStand: boons.player.lastStand + Math.max(0, extras.defiances ?? 0) };
  return {
    seats,
    stage: floor.stage,
    stocks: clampStocks(floor.playerStocks + boons.bonusStocks + (extras.bonusStocks ?? 0)),
    seconds: clampSeconds(floor.timeSeconds + boons.clockBonus),
    playerStartPercent: clampPercent(boons.playerStartPercent),
    enemyStartPercent: clampPercent(boons.enemyStartPercent + floor.handicap),
    playerMods,
    enemyMods,
    foeMods,
    foeStocks,
    foes,
    affixes,
    floorStands: boons.player.lastStand,
    remixLabel: floor.rift ? `RIFT ${floor.stage.toUpperCase()} · #${(floor.seed % 1000).toString().padStart(3, '0')}` : null,
  };
}

/** Post-start adjustments: per-fighter stocks/percents/mods plus the optional
 * procedural platform remix. Must run while the match is in countdown (before
 * the first playing tick) so authoritative state stays consistent. */
export function applyFloorToMatch(match: MatchLike, setup: FloorSetup, floor: FloorPlan): void {
  if (match.fighters.length < 2) throw new Error('Roguelike floors need at least two fighters.');
  const player = match.fighters[0]!;
  player.stocks = clampStocks(setup.stocks);
  player.percent = clampPercent(setup.playerStartPercent);
  player.rogue = { ...setup.playerMods, essential: true };
  player.poison = null;
  player.hex = null;
  for (let index = 1; index < match.fighters.length; index++) {
    const foe = match.fighters[index]!;
    foe.stocks = clampStocks(setup.foeStocks[index - 1] ?? floor.playerStocks);
    foe.percent = clampPercent(setup.enemyStartPercent);
    foe.rogue = { ...(setup.foeMods[index - 1] ?? setup.enemyMods) };
    foe.poison = null;
    foe.hex = null;
  }
  if (floor.rift) {
    const remix = planRiftRemixForStage(floor.stage, floor.seed, match.content.stage);
    match.content.stage = applyRiftRemix(match.content.stage, remix);
  }
}
