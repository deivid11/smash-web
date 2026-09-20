/** Rift Descent permanent unlocks that attach to a run: relics (Hades
 * Keepsakes) equipped into loadout slots, and per-champion mastery that
 * unlocks and strengthens Aspects (Hades Weapon Aspects). Pure data + math;
 * storage lives in `lib/game/roguelike/meta.ts`, run application in
 * `lib/game/roguelike/run-state.ts`. Prototype-only, never Melee behavior.
 */
import { boonById, type BoonState } from './boons.ts';
import type { PatronId } from './patrons.ts';

// ——— Lifetime stats (unlock conditions read these) ———

export interface LifetimeStats {
  runs: number;
  wins: number;
  bossesDown: number;
  elitesDown: number;
  eventsVisited: number;
  coinsSpent: number;
  bestHeatWin: number;
  /** Runs that ended holding a duo boon. */
  duoRuns: number;
  /** Most boons from one patron held at the end of a run. */
  maxPatronBoons: number;
  /** Chaos pacts ever held at the end of a run. */
  chaosPacts: number;
}

export function emptyStats(): LifetimeStats {
  return { runs: 0, wins: 0, bossesDown: 0, elitesDown: 0, eventsVisited: 0, coinsSpent: 0, bestHeatWin: -1, duoRuns: 0, maxPatronBoons: 0, chaosPacts: 0 };
}

/** Everything a finished run reports to the meta layer. */
export interface RunSummary {
  fighter: string;
  cleared: number;
  bossesDown: number;
  elitesDown: number;
  fightsWon: number;
  eventsVisited: number;
  coinsSpent: number;
  victory: boolean;
  heat: number;
  boonIds: readonly string[];
  relics: readonly RelicId[];
}

export function mergeStats(stats: LifetimeStats, run: RunSummary): LifetimeStats {
  const patrons = new Map<PatronId, number>();
  let duo = false;
  let chaos = 0;
  for (const id of run.boonIds) {
    const boon = boonById(id);
    if (boon.duo) duo = true;
    else patrons.set(boon.patron, (patrons.get(boon.patron) ?? 0) + 1);
    if (boon.patron === 'chaos') chaos++;
  }
  return {
    runs: stats.runs + 1,
    wins: stats.wins + (run.victory ? 1 : 0),
    bossesDown: stats.bossesDown + run.bossesDown,
    elitesDown: stats.elitesDown + run.elitesDown,
    eventsVisited: stats.eventsVisited + run.eventsVisited,
    coinsSpent: stats.coinsSpent + run.coinsSpent,
    bestHeatWin: run.victory ? Math.max(stats.bestHeatWin, run.heat) : stats.bestHeatWin,
    duoRuns: stats.duoRuns + (duo ? 1 : 0),
    maxPatronBoons: Math.max(stats.maxPatronBoons, ...patrons.values(), 0),
    chaosPacts: stats.chaosPacts + chaos,
  };
}

// ——— Relics ———

export type RelicId =
  | 'spiked-collar' | 'lucky-coin' | 'harpy-feather' | 'compass' | 'blood-vial' | 'thunder-idol' | 'hunter-eye'
  | 'titan-belt' | 'hourglass' | 'chaos-shard' | 'ledger' | 'phoenix-heart' | 'wanderer-map';

export interface RelicDef {
  id: RelicId;
  icon: string;
  name: string;
  flavor: string;
  /** Effect line at Lv1 / Lv2 / Lv3. */
  levels: readonly [string, string, string];
  /** Starter relics are always unlocked; others need `condition` or keys. */
  starter?: boolean;
  condition?: { text: string; met: (stats: LifetimeStats) => boolean };
  keyCost: number;
}

export const RELICS: readonly RelicDef[] = Object.freeze([
  { id: 'spiked-collar', icon: '🦴', name: 'Old Spiked Collar', flavor: 'It still smells like the last champion.', starter: true, keyCost: 0,
    levels: ['−6% damage taken', '−10% damage taken', '−14% damage taken'] },
  { id: 'lucky-coin', icon: '🪙', name: 'Lucky Coin', flavor: 'Heads you win. Tails you also win.', starter: true, keyCost: 0,
    levels: ['Start with +60 coins', 'Start with +110 coins', 'Start with +160 coins'] },
  { id: 'hunter-eye', icon: '🎯', name: "Hunter's Eye", flavor: 'Always watching the percent.', keyCost: 3,
    condition: { text: 'Defeat your first boss', met: (s) => s.bossesDown >= 1 },
    levels: ['+5% crit chance', '+8% crit chance', '+12% crit chance'] },
  { id: 'titan-belt', icon: '🗿', name: 'Titan Belt', flavor: 'Heavy is the waist.', keyCost: 3,
    condition: { text: 'Defeat 3 elites', met: (s) => s.elitesDown >= 3 },
    levels: ['−8% launch taken', '−12% launch taken', '−16% launch taken'] },
  { id: 'harpy-feather', icon: '🪶', name: 'Harpy Feather', flavor: 'Plucked mid-fall.', keyCost: 4,
    condition: { text: 'Finish 5 runs', met: (s) => s.runs >= 5 },
    levels: ['Start with a Phoenix Feather', 'Start with a Phoenix Feather · +1 pocket', 'Start with 2 Phoenix Feathers · +1 pocket'] },
  { id: 'blood-vial', icon: '🩸', name: 'Blood Vial', flavor: 'Still warm.', keyCost: 4,
    condition: { text: 'Defeat 3 bosses', met: (s) => s.bossesDown >= 3 },
    levels: ['Heal 4% when a rival is KO’d', 'Heal 6% when a rival is KO’d', 'Heal 8% when a rival is KO’d'] },
  { id: 'thunder-idol', icon: '⚡', name: 'Thunder Idol', flavor: 'Hums before storms.', keyCost: 4,
    condition: { text: 'End a run with 3 boons from one patron', met: (s) => s.maxPatronBoons >= 3 },
    levels: ['Your hits arc 2%', 'Your hits arc 3%', 'Your hits arc 4%'] },
  { id: 'wanderer-map', icon: '🗺', name: "Wanderer's Map", flavor: 'Someone circled the good rooms.', keyCost: 4,
    condition: { text: 'Visit 8 events', met: (s) => s.eventsVisited >= 8 },
    levels: ['+1 boon reroll', '+2 boon rerolls', '+3 boon rerolls'] },
  { id: 'ledger', icon: '📒', name: "Merchant's Ledger", flavor: 'Charon owes you a favor.', keyCost: 5,
    condition: { text: 'Spend 600 coins', met: (s) => s.coinsSpent >= 600 },
    levels: ['Shop prices −10%', 'Shop prices −20%', 'Shop prices −30%'] },
  { id: 'chaos-shard', icon: '🌀', name: 'Chaos Shard', flavor: 'Whispers in two voices.', keyCost: 5,
    condition: { text: 'Hold a Chaos pact at the end of a run', met: (s) => s.chaosPacts >= 1 },
    levels: ['Start with a RARE+ Chaos pact', 'Start with an EPIC Chaos pact', 'Start with an EPIC Chaos pact · +1 reroll'] },
  { id: 'compass', icon: '🧭', name: 'Compass of Favor', flavor: 'Points toward generous gods.', keyCost: 5,
    condition: { text: 'Hold a duo boon at the end of a run', met: (s) => s.duoRuns >= 1 },
    levels: ['+5% RARE+ and EPIC boon odds', '+10% RARE+ and EPIC boon odds', '+15% RARE+ and EPIC boon odds'] },
  { id: 'hourglass', icon: '⏳', name: 'Sand of Ages', flavor: 'Time bends for the patient.', keyCost: 6,
    condition: { text: 'Complete a descent', met: (s) => s.wins >= 1 },
    levels: ['+20s floor clock · +50 score per floor', '+40s floor clock · +100 score per floor', '+60s floor clock · +150 score per floor'] },
  { id: 'phoenix-heart', icon: '❤️‍🔥', name: 'Phoenix Heart', flavor: 'Beats twice.', keyCost: 7,
    condition: { text: 'Complete a descent at Heat 1+', met: (s) => s.bestHeatWin >= 1 },
    levels: ['+1 run-wide Last Stand', '+1 run-wide Last Stand · +1 run life', '+2 run-wide Last Stands · +1 run life'] },
]);

/** Floors-cleared XP needed for Lv2 and Lv3 (Hades keepsake ranks). */
export const RELIC_LEVEL_XP: readonly [number, number] = [8, 20];
export const MAX_RELIC_SLOTS = 3;

export function relicById(id: string): RelicDef {
  const found = RELICS.find((relic) => relic.id === id);
  if (!found) throw new Error(`Unknown relic: ${id}`);
  return found;
}
export function relicLevel(xp: number): 1 | 2 | 3 {
  return xp >= RELIC_LEVEL_XP[1] ? 3 : xp >= RELIC_LEVEL_XP[0] ? 2 : 1;
}
/** Relic XP a run pays to each equipped relic: fights won, bosses count triple. */
export function relicXpForRun(run: Pick<RunSummary, 'fightsWon' | 'bossesDown'>): number {
  return run.fightsWon + run.bossesDown * 2;
}

export interface EquippedRelic { id: RelicId; level: number }

/** Numbers behind every relic level (single source for build + run-start effects). */
export function relicValue(id: RelicId, level: number): number {
  const at = <T,>(values: readonly [T, T, T]): T => values[Math.max(1, Math.min(3, level)) - 1]!;
  switch (id) {
    case 'spiked-collar': return at([6, 10, 14]);
    case 'lucky-coin': return at([60, 110, 160]);
    case 'hunter-eye': return at([5, 8, 12]);
    case 'titan-belt': return at([8, 12, 16]);
    case 'harpy-feather': return at([1, 1, 2]);
    case 'blood-vial': return at([4, 6, 8]);
    case 'thunder-idol': return at([2, 3, 4]);
    case 'wanderer-map': return at([1, 2, 3]);
    case 'ledger': return at([10, 20, 30]);
    case 'chaos-shard': return at([1, 2, 3]);
    case 'compass': return at([0.05, 0.1, 0.15]);
    case 'hourglass': return at([20, 40, 60]);
    case 'phoenix-heart': return at([1, 1, 2]);
    default: return 0;
  }
}

// ——— Aspects + champion mastery ———

export type AspectId = 'vanguard' | 'tempest' | 'bastion' | 'reaper';

export interface AspectDef {
  id: AspectId;
  icon: string;
  name: string;
  flavor: string;
  /** Mastery rank that unlocks it for a champion. */
  rank: number;
  levels: readonly [string, string, string];
}

export const ASPECTS: readonly AspectDef[] = Object.freeze([
  { id: 'vanguard', icon: '⚔', name: 'Aspect of the Vanguard', flavor: 'Lead with the fist.', rank: 1,
    levels: ['+8% damage · +4% launch power', '+12% damage · +6% launch power', '+16% damage · +8% launch power'] },
  { id: 'tempest', icon: '🌪', name: 'Aspect of the Tempest', flavor: 'Never where they aim.', rank: 2,
    levels: ['+8% movement speed · +4% crit chance', '+11% movement speed · +6% crit chance', '+14% movement speed · +8% crit chance'] },
  { id: 'bastion', icon: '🏰', name: 'Aspect of the Bastion', flavor: 'The rift breaks on you.', rank: 4,
    levels: ['−10% damage taken · −8% launch taken · −4% speed', '−14% damage taken · −11% launch taken · −4% speed', '−18% damage taken · −14% launch taken · −4% speed'] },
  { id: 'reaper', icon: '💀', name: 'Aspect of the Reaper', flavor: 'Harvest the high percents.', rank: 6,
    levels: ['+15% damage vs 100%+ · heal 3% on KOs · start floors at +10%', '+22% damage vs 100%+ · heal 4% on KOs · start floors at +10%', '+30% damage vs 100%+ · heal 5% on KOs · start floors at +10%'] },
]);

export function aspectById(id: string): AspectDef {
  const found = ASPECTS.find((aspect) => aspect.id === id);
  if (!found) throw new Error(`Unknown aspect: ${id}`);
  return found;
}

/** Cumulative XP to reach ranks 1..8. */
export const MASTERY_XP: readonly number[] = [0, 80, 200, 380, 620, 950, 1400, 2000];
export const MAX_MASTERY_RANK = MASTERY_XP.length;

export function masteryRank(xp: number): number {
  let rank = 1;
  for (let index = 0; index < MASTERY_XP.length; index++) if (xp >= MASTERY_XP[index]!) rank = index + 1;
  return rank;
}
/** XP into the current rank and the span to the next one (null at max). */
export function masteryProgress(xp: number): { rank: number; into: number; span: number | null } {
  const rank = masteryRank(xp);
  const floor = MASTERY_XP[rank - 1]!;
  const next = MASTERY_XP[rank];
  return { rank, into: xp - floor, span: next === undefined ? null : next - floor };
}
export function masteryXpForRun(run: Pick<RunSummary, 'cleared' | 'bossesDown' | 'elitesDown' | 'victory' | 'heat'>): number {
  return Math.round((run.cleared * 10 + run.bossesDown * 30 + run.elitesDown * 10 + (run.victory ? 120 : 0)) * (1 + 0.25 * run.heat));
}

export interface ChampionPerks { rerolls: number; coins: number; lives: number; aspectLevel: 1 | 2 | 3 }
export function championPerks(rank: number): ChampionPerks {
  return {
    rerolls: rank >= 3 ? 1 : 0,
    coins: rank >= 5 ? 40 : 0,
    lives: rank >= 7 ? 1 : 0,
    aspectLevel: rank >= 8 ? 3 : rank >= 5 ? 2 : 1,
  };
}
/** Rank rewards in order, for the champion card (English source; ES in roguelike-text). */
export const MASTERY_REWARDS: ReadonlyArray<{ rank: number; key: string; text: string }> = Object.freeze([
  { rank: 2, key: 'tempest', text: 'Unlock Aspect of the Tempest' },
  { rank: 3, key: 'reroll', text: '+1 boon reroll every run' },
  { rank: 4, key: 'bastion', text: 'Unlock Aspect of the Bastion' },
  { rank: 5, key: 'aspect2', text: 'Aspects Lv2 · +40 starting coins' },
  { rank: 6, key: 'reaper', text: 'Unlock Aspect of the Reaper' },
  { rank: 7, key: 'life', text: '+1 starting run life' },
  { rank: 8, key: 'aspect3', text: 'Aspects Lv3 · Rift Champion' },
]);

export interface EquippedAspect { id: AspectId; level: number }

/** Build-lane effects of equipped relics + the aspect, folded in before the boon caps. */
export function applyLoadoutBuild(state: BoonState, relics: readonly EquippedRelic[], aspect: EquippedAspect | null): void {
  const p = state.player;
  for (const relic of relics) {
    const value = relicValue(relic.id, relic.level);
    switch (relic.id) {
      case 'spiked-collar': p.damageTakenMul *= 1 - value / 100; break;
      case 'hunter-eye': p.critChance += value / 100; break;
      case 'titan-belt': p.knockbackTakenMul *= 1 - value / 100; break;
      case 'blood-vial': p.lifesteal += value; break;
      case 'thunder-idol': p.chainDamage += value; break;
      case 'hourglass': state.clockBonus += value; state.scorePerFloor += value * 2.5; break;
      default: break; // Run-start relics (coins, pockets, rerolls, pacts, stands, prices, luck).
    }
  }
  if (!aspect) return;
  const at = <T,>(values: readonly [T, T, T]): T => values[Math.max(1, Math.min(3, aspect.level)) - 1]!;
  switch (aspect.id) {
    case 'vanguard': p.damageDealtMul *= 1 + at([8, 12, 16]) / 100; p.knockbackMul *= 1 + at([4, 6, 8]) / 100; break;
    case 'tempest': p.speedMul *= 1 + at([8, 11, 14]) / 100; p.critChance += at([4, 6, 8]) / 100; break;
    case 'bastion': p.damageTakenMul *= 1 - at([10, 14, 18]) / 100; p.knockbackTakenMul *= 1 - at([8, 11, 14]) / 100; p.speedMul *= 0.96; break;
    case 'reaper': p.executeMul *= 1 + at([15, 22, 30]) / 100; p.lifesteal += at([3, 4, 5]); state.playerStartPercent += 10; break;
  }
}
