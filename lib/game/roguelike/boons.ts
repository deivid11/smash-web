/** Rift Descent boons: Hades-style patron powers with rarity, levels (poms) and
 * duo boons. Pure data + reducers, no simulation access.
 *
 * A run owns `OwnedBoon` records ({ id, rarity, level }); the combined build is
 * always recomputed by `computeBoonState`, so rarity upgrades, poms, removals
 * and event rewards can never drift from the numbers the match receives.
 *
 * Effects split into two lanes, both prototype-only:
 * - setup lane (lives, stocks, starting percents, clock, score, CPU levels,
 *   coins per KO): legal `BattleSetup` ranges applied by
 *   `lib/game/roguelike/apply.ts`;
 * - sim lane (`RogueMods` from `lib/game/roguelike/sim.ts`): damage, launch,
 *   crits, arcs, burn, doom, thorns, leech, last stands, extra jumps — all
 *   neutral-by-default hooks in `lib/game/match.ts`.
 */
import { createRng } from './seed.ts';
import { NEUTRAL_ROGUE_MODS, type RogueMods } from './sim.ts';
import type { PatronId } from './patrons.ts';

export type BoonRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type BoonKind = 'attack' | 'defense' | 'utility' | 'pact' | 'duo';
export const RARITIES: readonly BoonRarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_POWER: Readonly<Record<BoonRarity, number>> = Object.freeze({ common: 1, rare: 1.5, epic: 2, legendary: 1 });
export const MAX_BOON_LEVEL = 5;

export interface BoonState {
  // Setup lane
  bonusLives: number;
  bonusStocks: number;
  enemyStartPercent: number;
  playerStartPercent: number;
  scorePerFloor: number;
  levelShift: number;
  clockBonus: number;
  coinsPerKo: number;
  enemyDamageMul: number;
  enemySpeedMul: number;
  // Sim lane for the player (neutral = NEUTRAL_ROGUE_MODS)
  player: RogueMods;
}

export interface BoonDef {
  id: string;
  patron: PatronId;
  /** Duo boons name both patrons (the first is `patron`). */
  duo?: readonly [PatronId, PatronId];
  kind: BoonKind;
  name: string;
  icon: string;
  flavor: string;
  /** Magnitude at common level 1; scaled by rarity × level unless `fixed`. */
  base: number;
  fixed?: boolean;
  /** Highest magnitude this boon can reach (its lane cap), so a card never shows more than it does. */
  cap?: number;
  /** `{v}` in gains/costs is replaced by the scaled magnitude. */
  gains: readonly string[];
  costs: readonly string[];
  minRarity?: BoonRarity;
  maxLevel?: number;
  /** Other boons that must be owned first (any one of them). */
  requires?: readonly string[];
  apply: (state: BoonState, value: number) => void;
}

export interface OwnedBoon { id: string; rarity: BoonRarity; level: number }

const pct = (value: number): number => value / 100;
const up = (value: number): number => 1 + value / 100;
const down = (value: number): number => 1 - value / 100;

export const BOON_POOL: readonly BoonDef[] = Object.freeze([
  // ——— VOLTRA · arcs and jolts ———
  { id: 'volt-arc', patron: 'volt', kind: 'attack', name: 'Arc Strike', icon: '⚡', flavor: 'Lightning never hits just once.', base: 3, cap: 16, gains: ['Your hits arc {v}% into the nearest other fighter (within reach)'], costs: [], apply: (s, v) => { s.player.chainDamage += v; } },
  { id: 'volt-static', patron: 'volt', kind: 'defense', name: 'Static Jolt', icon: '🔋', flavor: 'Numb hands swing soft.', base: 20, cap: 60, gains: ['Hit foes are jolted: they deal −{v}% damage for 3s'], costs: [], apply: (s, v) => { s.player.weakTicks = 180; s.player.weakMul = Math.min(s.player.weakMul, down(Math.min(60, v))); } },
  { id: 'volt-clap', patron: 'volt', kind: 'attack', name: 'Thunderclap', icon: '🌩', flavor: 'Every fall echoes.', base: 8, cap: 30, gains: ['When you score a KO, every other foe takes {v}%'], costs: [], apply: (s, v) => { s.player.koBlast += v; } },
  { id: 'volt-conduit', patron: 'volt', kind: 'utility', name: 'Conduit', icon: '🧲', flavor: 'The storm reaches further.', base: 50, cap: 180, gains: ['Arc reach +{v}%', 'Arcs deal +1%'], costs: [], requires: ['volt-arc'], apply: (s, v) => { s.player.chainRange *= up(v); s.player.chainDamage += 1; } },
  // ——— MAELSTROM · launch power ———
  { id: 'tide-riptide', patron: 'tide', kind: 'attack', name: 'Riptide', icon: '🌊', flavor: 'The current takes them.', base: 10, cap: 80, gains: ['+{v}% launch power on your hits'], costs: [], apply: (s, v) => { s.player.knockbackMul *= up(v); } },
  { id: 'tide-breaker', patron: 'tide', kind: 'attack', name: 'Breaker', icon: '💥', flavor: 'Big waves finish the job.', base: 20, cap: 80, gains: ['+{v}% launch power against foes at 100%+'], costs: [], apply: (s, v) => { s.player.executeKnockbackMul *= up(v); } },
  { id: 'tide-anchor', patron: 'tide', kind: 'defense', name: 'Anchor', icon: '⚓', flavor: 'Root yourself to the sea floor.', base: 10, cap: 40, gains: ['−{v}% launch taken'], costs: [], apply: (s, v) => { s.player.knockbackTakenMul *= down(Math.min(40, v)); } },
  { id: 'tide-undertow', patron: 'tide', kind: 'utility', name: 'Undertow', icon: '🫧', flavor: 'Wading through the deep.', base: 25, cap: 50, gains: ['Hit foes are slowed: −{v}% movement speed for 2s'], costs: [], apply: (s, v) => { s.player.chillTicks = 120; s.player.chillMul = Math.min(s.player.chillMul, down(Math.min(50, v))); } },
  // ——— PYRA · burn and doom ———
  { id: 'ember-brand', patron: 'ember', kind: 'attack', name: 'Searing Brand', icon: '🔥', flavor: 'Every cut keeps burning.', base: 6, cap: 20, gains: ['Hits burn foes: +1% every 1.25s for {v}s', 'Burn never KOs by itself'], costs: [], apply: (s, v) => { s.player.venomTicks += Math.round(v * 60); } },
  { id: 'ember-doom', patron: 'ember', kind: 'attack', name: 'Doom Mark', icon: '☄', flavor: 'A promise, delivered late.', base: 6, cap: 30, gains: ['Hits mark foes; 1s later they take {v}%'], costs: [], apply: (s, v) => { s.player.doomDamage += v; } },
  { id: 'ember-fury', patron: 'ember', kind: 'attack', name: 'Fury', icon: '😡', flavor: 'Hot hands, heavy hits.', base: 10, cap: 200, gains: ['+{v}% damage on your hits'], costs: [], apply: (s, v) => { s.player.damageDealtMul *= up(v); } },
  { id: 'ember-wildfire', patron: 'ember', kind: 'attack', name: 'Wildfire', icon: '🌋', flavor: 'Fuel for the fire.', base: 20, cap: 100, gains: ['+{v}% damage against burning foes'], costs: [], requires: ['ember-brand'], apply: (s, v) => { s.player.burnBonusMul *= up(v); } },
  // ——— AEGIS · guard ———
  { id: 'aegis-plate', patron: 'aegis', kind: 'defense', name: 'Bronze Plate', icon: '🛡', flavor: 'Hammered from old trophies.', base: 10, cap: 40, gains: ['−{v}% damage taken'], costs: [], apply: (s, v) => { s.player.damageTakenMul *= down(Math.min(40, v)); } },
  { id: 'aegis-thorns', patron: 'aegis', kind: 'defense', name: 'Thorn Mail', icon: '🌵', flavor: 'Hug at your own risk.', base: 3, cap: 12, gains: ['Foes that hit you up close take {v}% back'], costs: [], apply: (s, v) => { s.player.thorns += v; } },
  { id: 'aegis-defiance', patron: 'aegis', kind: 'defense', name: 'Last Stand', icon: '✝', flavor: 'Not today.', base: 1, fixed: true, minRarity: 'rare', maxLevel: 1, gains: ['Once per floor, a KO does not cost a stock'], costs: [], apply: (s) => { s.player.lastStand += 1; } },
  { id: 'aegis-retaliate', patron: 'aegis', kind: 'attack', name: 'Retaliate', icon: '⚔', flavor: 'Answer every blow.', base: 40, cap: 150, gains: ['After being hit, your next hit within 2s deals +{v}%'], costs: [], apply: (s, v) => { s.player.retaliateMul *= up(v); } },
  // ——— NOCTURNE · blood ———
  { id: 'blood-leech', patron: 'blood', kind: 'defense', name: 'Leech', icon: '🦇', flavor: 'Take a little back.', base: 10, cap: 40, gains: ['Heal {v}% of the damage you deal'], costs: [], apply: (s, v) => { s.player.leech += pct(v); } },
  { id: 'blood-feast', patron: 'blood', kind: 'defense', name: 'Feast', icon: '🍷', flavor: 'Their last stock is your snack.', base: 8, cap: 30, gains: ['Heal {v}% whenever a rival is KO’d'], costs: [], apply: (s, v) => { s.player.lifesteal += v; } },
  { id: 'blood-rage', patron: 'blood', kind: 'attack', name: 'Blood Rage', icon: '💢', flavor: 'Hurt makes it hit harder.', base: 6, cap: 20, gains: ['+{v}% damage for every 50% you carry', 'Up to five stacks'], costs: [], apply: (s, v) => { s.player.rage += pct(v); s.player.rageCap += pct(v * 5); } },
  { id: 'blood-pact', patron: 'blood', kind: 'pact', name: 'Crimson Pact', icon: '🩸', flavor: 'Signed in something red.', base: 25, cap: 200, gains: ['+{v}% damage on your hits'], costs: ['+10% damage taken'], apply: (s, v) => { s.player.damageDealtMul *= up(v); s.player.damageTakenMul *= 1.1; } },
  // ——— SAGITTA · crits ———
  { id: 'hunt-aim', patron: 'hunt', kind: 'attack', name: 'Deadly Aim', icon: '🎯', flavor: 'Breathe. Release.', base: 8, cap: 60, gains: ['{v}% chance to crit for double damage'], costs: [], apply: (s, v) => { s.player.critChance += pct(v); } },
  { id: 'hunt-lethal', patron: 'hunt', kind: 'attack', name: 'Lethal Precision', icon: '🏹', flavor: 'Right between the percents.', base: 50, cap: 200, gains: ['Crits deal +{v}% of the hit on top of double damage'], costs: [], requires: ['hunt-aim', 'duo-hunting-wind'], apply: (s, v) => { s.player.critMul += pct(v); } },
  { id: 'hunt-execute', patron: 'hunt', kind: 'attack', name: 'Executioner', icon: '🪓', flavor: 'End the hunt.', base: 20, cap: 150, gains: ['+{v}% damage against foes at 100%+'], costs: [], apply: (s, v) => { s.player.executeMul *= up(v); } },
  { id: 'hunt-opener', patron: 'hunt', kind: 'attack', name: 'Opening Shot', icon: '🗡', flavor: 'First blood matters.', base: 50, cap: 200, gains: ['+{v}% damage against foes at 0%'], costs: [], apply: (s, v) => { s.player.openerMul *= up(v); } },
  // ——— ZEPHYR · mobility ———
  { id: 'gale-stride', patron: 'gale', kind: 'utility', name: 'Swift Stride', icon: '👟', flavor: 'The stick just goes further.', base: 8, cap: 45, gains: ['+{v}% movement speed, ground and air'], costs: [], apply: (s, v) => { s.player.speedMul *= up(v); } },
  { id: 'gale-wings', patron: 'gale', kind: 'utility', name: 'Feather Wings', icon: '🪶', flavor: 'One more flap.', base: 1, fixed: true, minRarity: 'rare', maxLevel: 1, gains: ['+1 midair jump'], costs: [], apply: (s) => { s.player.extraJumps += 1; } },
  { id: 'gale-toll', patron: 'gale', kind: 'utility', name: 'Tailwind Toll', icon: '🪙', flavor: 'Every fall pays the ferryman.', base: 5, gains: ['+{v} coins for every KO you score'], costs: [], apply: (s, v) => { s.coinsPerKo += Math.round(v); } },
  { id: 'gale-time', patron: 'gale', kind: 'utility', name: 'Borrowed Time', icon: '⏳', flavor: 'No rush. Outlast them.', base: 20, cap: 180, gains: ['+{v}s on every floor clock', '+{v10} score per cleared floor'], costs: [], apply: (s, v) => { s.clockBonus += Math.round(v); s.scorePerFloor += Math.round(v) * 10; } },
  // ——— THE RIFT · run edges (treasure, shops, events) ———
  { id: 'rift-heart', patron: 'rift', kind: 'defense', name: 'Hearty Stew', icon: '🍲', flavor: 'Seconds for the road.', base: 1, fixed: true, maxLevel: 1, gains: ['+1 run life (retry a lost floor)'], costs: [], apply: (s) => { s.bonusLives += 1; } },
  { id: 'rift-stock', patron: 'rift', kind: 'defense', name: 'Extra Stock', icon: '●', flavor: 'One more you per floor.', base: 1, fixed: true, minRarity: 'rare', maxLevel: 1, gains: ['+1 match stock every floor'], costs: [], apply: (s) => { s.bonusStocks += 1; } },
  { id: 'rift-warmup', patron: 'rift', kind: 'utility', name: 'Crowd Warmup', icon: '📣', flavor: 'They already love you.', base: 12, cap: 90, gains: ['Rivals start every floor at +{v}%'], costs: [], apply: (s, v) => { s.enemyStartPercent += Math.round(v); } },
  { id: 'rift-underdog', patron: 'rift', kind: 'utility', name: 'Underdog Charm', icon: '🍀', flavor: 'They fight down to you.', base: 1, fixed: true, minRarity: 'rare', maxLevel: 1, gains: ['Rival CPU levels −1 (min 1)'], costs: [], apply: (s) => { s.levelShift -= 1; } },
  { id: 'rift-showboat', patron: 'rift', kind: 'utility', name: 'Showboat', icon: '🌟', flavor: 'The crowd is watching.', base: 150, gains: ['+{v} score per cleared floor'], costs: [], apply: (s, v) => { s.scorePerFloor += Math.round(v); } },
  // ——— CHAOS · pacts ———
  { id: 'chaos-glass', patron: 'chaos', kind: 'pact', name: 'Glass Cannon', icon: '🧨', flavor: 'Hit like a truck. Built like a vase.', base: 35, cap: 200, gains: ['+{v}% damage on your hits'], costs: ['+30% damage taken'], apply: (s, v) => { s.player.damageDealtMul *= up(v); s.player.damageTakenMul *= 1.3; } },
  { id: 'chaos-adrenaline', patron: 'chaos', kind: 'pact', name: 'Adrenaline', icon: '💉', flavor: 'Fast. Fragile. Fun.', base: 15, cap: 45, gains: ['+{v}% movement speed', '+10% launch power'], costs: ['+12% damage taken'], apply: (s, v) => { s.player.speedMul *= up(v); s.player.knockbackMul *= 1.1; s.player.damageTakenMul *= 1.12; } },
  { id: 'chaos-lead', patron: 'chaos', kind: 'pact', name: 'Lead Fists', icon: '🥊', flavor: 'Hands of stone, feet of stone.', base: 22, cap: 80, gains: ['+{v}% launch power on your hits'], costs: ['−8% movement speed'], apply: (s, v) => { s.player.knockbackMul *= up(v); s.player.speedMul *= 0.92; } },
  { id: 'chaos-gambler', patron: 'chaos', kind: 'pact', name: "Gambler's Pact", icon: '🎲', flavor: 'Double or nothing, every floor.', base: 250, gains: ['Rivals start at +40%', '+{v} score per cleared floor'], costs: ['You start every floor at +30%'], apply: (s, v) => { s.enemyStartPercent += 40; s.playerStartPercent += 30; s.scorePerFloor += Math.round(v); } },
  { id: 'chaos-blood-price', patron: 'chaos', kind: 'pact', name: 'Blood Price', icon: '🗝', flavor: 'Sharp eyes, thin skin.', base: 15, cap: 60, gains: ['+{v}% crit chance'], costs: ['You start every floor at +20%'], apply: (s, v) => { s.player.critChance += pct(v); s.playerStartPercent += 20; } },
  { id: 'chaos-frenzy', patron: 'chaos', kind: 'pact', name: 'Rift Frenzy', icon: '👹', flavor: 'They get angrier. So do you.', base: 30, cap: 200, gains: ['+{v}% damage on your hits'], costs: ['Rivals deal +15% damage', 'Rivals move 8% faster'], apply: (s, v) => { s.player.damageDealtMul *= up(v); s.enemyDamageMul *= 1.15; s.enemySpeedMul *= 1.08; } },
  // ——— DUOS · two patrons, one legend ———
  { id: 'duo-surge', patron: 'volt', duo: ['volt', 'tide'], kind: 'duo', name: 'Thunder Surge', icon: '🌩', flavor: 'Storm over open water.', base: 4, fixed: true, maxLevel: 1, gains: ['Your hits arc +4% into the nearest other fighter', '+10% launch power'], costs: [], apply: (s) => { s.player.chainDamage += 4; s.player.knockbackMul *= 1.1; } },
  { id: 'duo-pyre-shot', patron: 'ember', duo: ['ember', 'hunt'], kind: 'duo', name: 'Pyre Shot', icon: '☄', flavor: 'Aimed, lit, delivered.', base: 6, fixed: true, maxLevel: 1, gains: ['Crits doom-mark foes: 1s later they take 6%'], costs: [], apply: (s) => { s.player.critDoom = true; } },
  { id: 'duo-boiling-blood', patron: 'ember', duo: ['ember', 'blood'], kind: 'duo', name: 'Boiling Blood', icon: '🌋', flavor: 'Rage at a rolling boil.', base: 2, fixed: true, maxLevel: 1, gains: ['Blood Rage stacks up to ten', '+10% damage against burning foes'], costs: [], apply: (s) => { s.player.burnBonusMul *= 1.1; } },
  { id: 'duo-static-crit', patron: 'volt', duo: ['volt', 'hunt'], kind: 'duo', name: 'Static Crit', icon: '🔌', flavor: 'The arrow carries the storm.', base: 8, fixed: true, maxLevel: 1, gains: ['Crits arc into the nearest other fighter for double your arc (at least 8%)'], costs: [], apply: (s) => { s.player.critChain = true; } },
  { id: 'duo-tidal-wall', patron: 'aegis', duo: ['aegis', 'tide'], kind: 'duo', name: 'Tidal Wall', icon: '🧱', flavor: 'The sea does not move.', base: 20, fixed: true, maxLevel: 1, gains: ['−20% launch taken', 'Foes that hit you up close take 3% back'], costs: [], apply: (s) => { s.player.knockbackTakenMul *= 0.8; s.player.thorns += 3; } },
  { id: 'duo-hunting-wind', patron: 'hunt', duo: ['hunt', 'gale'], kind: 'duo', name: 'Hunting Wind', icon: '🦅', flavor: 'Strike from above.', base: 15, fixed: true, maxLevel: 1, gains: ['+15% crit chance while airborne'], costs: [], apply: (s) => { s.player.airCritChance += 0.15; } },
  { id: 'duo-sanguine-aegis', patron: 'blood', duo: ['blood', 'aegis'], kind: 'duo', name: 'Sanguine Aegis', icon: '🫀', flavor: 'Blood for the shield.', base: 1, fixed: true, maxLevel: 1, gains: ['+1 Last Stand every floor', 'Heal 6% whenever a rival is KO’d'], costs: [], apply: (s) => { s.player.lastStand += 1; s.player.lifesteal += 6; } },
  { id: 'duo-eye-of-storm', patron: 'gale', duo: ['gale', 'volt'], kind: 'duo', name: 'Eye of the Storm', icon: '🌪', flavor: 'Calm at the center.', base: 10, fixed: true, maxLevel: 1, gains: ['+10% movement speed', 'Arc reach doubled'], costs: [], apply: (s) => { s.player.speedMul *= 1.1; s.player.chainRange *= 2; } },
  { id: 'duo-steam-burst', patron: 'tide', duo: ['tide', 'ember'], kind: 'duo', name: 'Steam Burst', icon: '♨', flavor: 'Water meets fire. Pressure wins.', base: 5, fixed: true, maxLevel: 1, gains: ['Hits doom-mark foes for +5% (1s later)', '+15% launch power against foes at 100%+'], costs: [], apply: (s) => { s.player.doomDamage += 5; s.player.executeKnockbackMul *= 1.15; } },
]);

const BY_ID = new Map(BOON_POOL.map((boon) => [boon.id, boon]));

export function boonById(id: string): BoonDef {
  const boon = BY_ID.get(id);
  if (!boon) throw new Error(`Unknown boon: ${id}`);
  return boon;
}

export function maxLevelOf(boon: BoonDef): number {
  return boon.maxLevel ?? MAX_BOON_LEVEL;
}

const rarityRank = (rarity: BoonRarity): number => RARITIES.indexOf(rarity);
export function atLeastRarity(rarity: BoonRarity, floor: BoonRarity | undefined): BoonRarity {
  if (!floor) return rarity;
  return rarityRank(rarity) >= rarityRank(floor) ? rarity : floor;
}
export function nextRarity(rarity: BoonRarity): BoonRarity {
  return rarity === 'common' ? 'rare' : rarity === 'rare' ? 'epic' : rarity;
}

/** Scaled magnitude: base × rarity × (1 + 0.5 per level past 1). Fixed boons never scale. */
export function boonValue(boon: BoonDef, rarity: BoonRarity, level: number): number {
  if (boon.fixed) return boon.base;
  const scaled = boon.base * RARITY_POWER[rarity] * (1 + 0.5 * (Math.max(1, level) - 1));
  return Math.min(boon.cap ?? Infinity, Math.round(scaled * 10) / 10);
}

export function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

/** Card text with `{v}` (and `{v10}` = rounded ×10) filled for a rarity/level (English source of truth). */
export function describeBoon(boon: BoonDef, rarity: BoonRarity, level: number): { gains: string[]; costs: string[] } {
  const raw = boonValue(boon, rarity, level);
  const fill = (line: string): string => line.replaceAll('{v10}', formatValue(Math.round(raw) * 10)).replaceAll('{v}', formatValue(raw));
  return { gains: boon.gains.map(fill), costs: boon.costs.map(fill) };
}

export function emptyBoonState(): BoonState {
  return {
    bonusLives: 0, bonusStocks: 0, enemyStartPercent: 0, playerStartPercent: 0,
    scorePerFloor: 0, levelShift: 0, clockBonus: 0, coinsPerKo: 0,
    enemyDamageMul: 1, enemySpeedMul: 1,
    player: { ...NEUTRAL_ROGUE_MODS },
  };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The whole build from owned boons, with prototype stacking caps. Pure.
 * `extra` folds in non-boon sources (relics, aspects) before the caps apply. */
export function computeBoonState(owned: readonly OwnedBoon[], extra?: (state: BoonState) => void): BoonState {
  const state = emptyBoonState();
  for (const entry of owned) {
    const boon = boonById(entry.id);
    boon.apply(state, boonValue(boon, entry.rarity, entry.level));
  }
  // Boiling Blood doubles the whole Blood Rage cap, whichever order the boons arrived in.
  if (owned.some((entry) => entry.id === 'duo-boiling-blood')) state.player.rageCap *= 2;
  extra?.(state);
  const p = state.player;
  state.bonusLives = clamp(state.bonusLives, 0, 3);
  state.bonusStocks = clamp(state.bonusStocks, 0, 2);
  state.enemyStartPercent = clamp(state.enemyStartPercent, 0, 90);
  state.playerStartPercent = clamp(state.playerStartPercent, 0, 60);
  state.levelShift = clamp(state.levelShift, -2, 0);
  state.clockBonus = clamp(state.clockBonus, 0, 180);
  state.enemyDamageMul = clamp(state.enemyDamageMul, 1, 1.6);
  state.enemySpeedMul = clamp(state.enemySpeedMul, 1, 1.3);
  p.damageDealtMul = clamp(p.damageDealtMul, 1, 3);
  p.damageTakenMul = clamp(p.damageTakenMul, 0.4, 2);
  p.speedMul = clamp(p.speedMul, 0.8, 1.45);
  p.venomTicks = clamp(p.venomTicks, 0, 20 * 60);
  p.lifesteal = clamp(p.lifesteal, 0, 30);
  p.knockbackMul = clamp(p.knockbackMul, 1, 1.8);
  p.knockbackTakenMul = clamp(p.knockbackTakenMul, 0.55, 1);
  p.critChance = clamp(p.critChance, 0, 0.6);
  p.critMul = clamp(p.critMul, 2, 4);
  p.airCritChance = clamp(p.airCritChance, 0, 0.3);
  p.chainDamage = clamp(p.chainDamage, 0, 16);
  p.chainRange = clamp(p.chainRange, 16, 90);
  p.thorns = clamp(p.thorns, 0, 12);
  p.leech = clamp(p.leech, 0, 0.4);
  p.rage = clamp(p.rage, 0, 0.2);
  p.rageCap = clamp(p.rageCap, 0, 2);
  p.executeMul = clamp(p.executeMul, 1, 2.5);
  p.executeKnockbackMul = clamp(p.executeKnockbackMul, 1, 1.8);
  p.openerMul = clamp(p.openerMul, 1, 3);
  p.burnBonusMul = clamp(p.burnBonusMul, 1, 2);
  p.doomDamage = clamp(p.doomDamage, 0, 30);
  p.weakMul = clamp(p.weakMul, 0.4, 1);
  p.chillMul = clamp(p.chillMul, 0.5, 1);
  p.retaliateMul = clamp(p.retaliateMul, 1, 2.5);
  p.koBlast = clamp(p.koBlast, 0, 30);
  p.lastStand = clamp(p.lastStand, 0, 3);
  p.extraJumps = clamp(p.extraJumps, 0, 2);
  return state;
}

export function ownsPatron(owned: readonly OwnedBoon[], patron: PatronId): boolean {
  return owned.some((entry) => boonById(entry.id).patron === patron && !boonById(entry.id).duo);
}

/** Can this boon be offered to a run holding `owned`? */
export function boonEligible(boon: BoonDef, owned: readonly OwnedBoon[]): boolean {
  if (owned.some((entry) => entry.id === boon.id)) return false;
  if (boon.requires && !boon.requires.some((id) => owned.some((entry) => entry.id === id))) return false;
  if (boon.duo) return boon.duo.every((patron) => ownsPatron(owned, patron));
  return true;
}

/** One card offered to the player. `pom` upgrades an owned boon; `remove` purges one. */
export type OfferCard =
  | { type: 'boon'; id: string; rarity: BoonRarity }
  | { type: 'pom'; id: string; levels: number }
  | { type: 'remove'; id: string };

export interface OfferContext {
  seed: number;
  /** Distinct stream key per offer site (floor, event, shop visit, reroll count). */
  key: number;
  owned: readonly OwnedBoon[];
  /** Door patron; null draws from every door patron. */
  patron: PatronId | null;
  /** Rarity floor (elites/treasure: rare, bosses: epic). */
  minRarity?: BoonRarity;
  /** Rarity luck in probability points (Mirror favor, Compass relic, Rift Compass). */
  luck?: number;
  count?: number;
  /** Explicit pool override (Chaos pacts, rift edges). */
  pool?: readonly PatronId[];
}

/** `luck` is in probability points: +0.1 = +10% RARE+ and +10% EPIC odds. */
function rollRarity(rng: () => number, luck: number): BoonRarity {
  const roll = rng() - luck;
  return roll < 0.12 ? 'epic' : roll < 0.4 ? 'rare' : 'common';
}

const DOOR_POOL: readonly PatronId[] = ['volt', 'tide', 'ember', 'aegis', 'blood', 'hunt', 'gale'];

/** Deterministic Hades-style boon offer: 3 cards from the door patron (a
 * duo replaces the last card ~35% of the time when eligible), topped up from
 * other patrons when the patron is exhausted. */
export function offerBoons(context: OfferContext): OfferCard[] {
  const rng = createRng((context.seed ^ Math.imul(context.key + 1, 0x9e3779b1)) >>> 0);
  const count = context.count ?? 3;
  const luck = context.luck ?? 0;
  const patrons = context.pool ?? (context.patron ? [context.patron] : DOOR_POOL);
  const primary = BOON_POOL.filter((boon) => !boon.duo && patrons.includes(boon.patron) && boonEligible(boon, context.owned));
  const cards: OfferCard[] = [];
  const taken = new Set<string>();
  const draw = (from: readonly BoonDef[]): void => {
    const remaining = from.filter((boon) => !taken.has(boon.id));
    if (!remaining.length) return;
    const boon = remaining[Math.floor(rng() * remaining.length)]!;
    taken.add(boon.id);
    const rolled = atLeastRarity(atLeastRarity(rollRarity(rng, luck), context.minRarity), boon.minRarity);
    cards.push({ type: 'boon', id: boon.id, rarity: boon.duo ? 'legendary' : rolled === 'legendary' ? 'epic' : rolled });
  };
  while (cards.length < count && primary.some((boon) => !taken.has(boon.id))) draw(primary);
  if (!context.pool) {
    const duos = BOON_POOL.filter((boon) => boon.duo && (!context.patron || boon.duo.includes(context.patron)) && boonEligible(boon, context.owned));
    if (duos.length && rng() < 0.35) {
      if (cards.length >= count) { const dropped = cards.pop()!; taken.delete(dropped.id); }
      draw(duos);
    }
    if (cards.length < count) {
      const fallback = BOON_POOL.filter((boon) => !boon.duo && DOOR_POOL.includes(boon.patron) && boonEligible(boon, context.owned));
      while (cards.length < count && fallback.some((boon) => !taken.has(boon.id))) draw(fallback);
    }
  }
  return cards;
}

/** Pom of Power: up to 3 owned boons that can still level (by `levels`). */
export function offerPoms(seed: number, key: number, owned: readonly OwnedBoon[], levels = 1, count = 3): OfferCard[] {
  const rng = createRng((seed ^ Math.imul(key + 3, 0x7feb352d)) >>> 0);
  const upgradable = owned.filter((entry) => !boonById(entry.id).fixed && entry.level < maxLevelOf(boonById(entry.id)));
  const shuffled = [...upgradable].sort(() => rng() - 0.5);
  return shuffled.slice(0, count).map((entry) => ({ type: 'pom', id: entry.id, levels }));
}

/** Purge offer: every owned boon can be removed (Slay the Spire card removal). */
export function offerRemovals(owned: readonly OwnedBoon[]): OfferCard[] {
  return owned.map((entry) => ({ type: 'remove', id: entry.id }));
}

/** Apply a picked card to an owned list. Pure; throws on stale/illegal picks. */
export function takeCard(owned: readonly OwnedBoon[], card: OfferCard): OwnedBoon[] {
  if (card.type === 'boon') {
    const boon = boonById(card.id);
    if (owned.some((entry) => entry.id === boon.id)) throw new Error('You already carry that boon.');
    return [...owned, { id: boon.id, rarity: card.rarity, level: 1 }];
  }
  const index = owned.findIndex((entry) => entry.id === card.id);
  if (index < 0) throw new Error('That boon is not in your build.');
  if (card.type === 'remove') return owned.filter((_, slot) => slot !== index);
  const boon = boonById(card.id);
  const entry = owned[index]!;
  const level = Math.min(maxLevelOf(boon), entry.level + card.levels);
  if (level === entry.level) throw new Error('That boon is already at max level.');
  return owned.map((item, slot) => (slot === index ? { ...item, level } : item));
}

export const SHOP_PRICES: Readonly<Record<BoonRarity, number>> = Object.freeze({ common: 90, rare: 140, epic: 210, legendary: 260 });
export const SHOP_POM_PRICE = 110;
export const SHOP_HEAL_PRICE = 120;
export const SHOP_REMOVE_PRICE = 70;
export const SHOP_REROLL_PRICE = 30;
export function shopPrice(card: OfferCard): number {
  if (card.type === 'boon') return SHOP_PRICES[card.rarity];
  return card.type === 'pom' ? SHOP_POM_PRICE : SHOP_REMOVE_PRICE;
}
