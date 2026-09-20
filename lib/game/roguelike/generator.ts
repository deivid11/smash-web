/** Procedural run plans: the Slay the Spire-style descent map for one run.
 * Pure data + seeded RNG only. No simulation, no assets, no original code paths.
 *
 * The descent is 50 floors in five acts of ten. The tenth floor of each act is
 * a boss from `lib/game/roguelike/bosses.ts`. Every floor is harder than the
 * last: CPU levels climb to 9, then foes keep scaling through damage,
 * toughness, launch resistance, speed, extra stocks, crowd size and gifts —
 * the late acts are meant to be nearly impossible.
 *
 * A plan is `length` rows of up to three lanes. Rows hold combat rooms
 * (battle / elite / boss) and non-combat rooms (event / rest / shop /
 * treasure); edges only connect neighbouring lanes and never cross, so a
 * route is a real decision made with the whole map in view. Combat rooms show
 * their reward door up front (Hades): a patron boon, a pom, coins, a heart or
 * a pocket item. Stage collision stays original except for the bounded
 * one-way-platform remixes in `lib/game/roguelike/procedural-stage.ts`.
 */
import { createRng, normalizeSeed } from './seed.ts';
import { affixesForFloor, type FoeAffixId } from './affixes.ts';
import { DOOR_PATRONS, type PatronId } from './patrons.ts';
import { EVENT_IDS, type EventId } from './events.ts';
import { bossForAct, pickBossFighters, type BossId } from './bosses.ts';
import type { CpuLevel } from '../cpu.ts';
import type { FighterKind } from '../data.ts';
import type { StageId } from '../stages.ts';

export type RogueDifficulty = 'ember' | 'flame' | 'inferno';
export type RogueRunLength = 50;
export type FloorKind = 'battle' | 'elite' | 'boss';
export type NodeKind = FloorKind | 'event' | 'rest' | 'shop' | 'treasure';
export type RewardKind = 'boon' | 'pom' | 'coins' | 'heart' | 'pocket';

export interface RogueEnemy {
  fighter: FighterKind;
  level: CpuLevel;
  /** Match stocks for this foe (defaults to the floor's stocks). */
  stocks?: number;
  /** Boss slot: receives the boss boost; `fallback` replaces an unavailable fighter. */
  boss?: boolean;
  fallback?: FighterKind;
  giga?: boolean;
}

/** Setup-safe floor modifiers: every effect maps to legal match-setup changes
 * (timer, stocks, starting percents, enemy count) applied by the
 * `lib/game/roguelike/apply.ts` wrapper. No physics/combat edits. */
export type FloorModifierId = 'frenzy' | 'showdown' | 'endurance' | 'gauntlet' | 'horde' | 'swarm';
export interface FloorModifier {
  id: FloorModifierId;
  label: string;
  detail: string;
}
export const FLOOR_MODIFIERS: Readonly<Record<FloorModifierId, Omit<FloorModifier, 'id'>>> = Object.freeze({
  frenzy: { label: 'FRENZY', detail: 'Rivals start at +30% damage. Fast KOs, fast floor.' },
  showdown: { label: 'SHOWDOWN', detail: '60-second clock. +100 score for clearing.' },
  endurance: { label: 'ENDURANCE', detail: 'You fight with 2 stocks. The reward is upgraded.' },
  gauntlet: { label: 'GAUNTLET', detail: 'One extra rival at −2 levels.' },
  horde: { label: 'HORDE', detail: 'Five to seven rookie rivals at +40%. Survive the crowd: the reward is upgraded.' },
  swarm: { label: 'SWARM', detail: 'Seven low-level rookies at +40%. Survive the graduation party: the reward is upgraded.' },
});
/** Starting-damage handicap a modifier grants (prototype balancing, not Melee). */
export function handicapFor(modifier: FloorModifier | null): number {
  if (modifier?.id === 'frenzy') return 30;
  if (modifier?.id === 'horde' || modifier?.id === 'swarm') return 40;
  return 0;
}
/** Modifiers that upgrade the room's reward (rarity +1, coins ×1.5). */
export function modifierUpgradesReward(modifier: FloorModifier | null): boolean {
  return modifier?.id === 'endurance' || modifier?.id === 'horde' || modifier?.id === 'swarm';
}

/** Who fights whom: a duel, an allied rival team against you (2v1, 3v1…), or a free-for-all. */
export type FloorFormat = 'duel' | 'team' | 'ffa';

export interface FloorPlan {
  /** Map row. */
  index: number;
  kind: FloorKind;
  stage: StageId;
  enemies: RogueEnemy[];
  timeSeconds: number;
  playerStocks: number;
  modifier: FloorModifier | null;
  /** Enemy starting percent from the floor modifier (stacks with boons). */
  handicap: number;
  /** Enemy damage multiplier: climb rage × heat (prototype balancing). */
  foeDamage: number;
  /** Prototype foe gifts: boss/elite abilities riding neutral RogueMods lanes. */
  affixes: FoeAffixId[];
  /** Seeded remix flag: one-way platforms are procedurally shifted (prototype). */
  rift: boolean;
  seed: number;
  /** Act index (0-based, ten floors each). */
  act: number;
  /** Depth scaling on the foe side: toughness, launch resistance, speed (1 = neutral). */
  foeTakenMul: number;
  foeKnockbackTakenMul: number;
  foeSpeedMul: number;
  /** Act boss on boss floors. */
  boss: BossId | null;
  /** Team floors ally every rival (they never hit each other); free-for-all floors don't. */
  format: FloorFormat;
}

export interface MapNode {
  row: number;
  lane: number;
  kind: NodeKind;
  /** Reachable lanes in the next row (empty on the last row). */
  next: number[];
  /** Combat rooms only: the door reward and its patron (boon doors). */
  reward: RewardKind | null;
  patron: PatronId | null;
  floor: FloorPlan | null;
  event: EventId | null;
}

export type RogueHeat = 0 | 1 | 2 | 3 | 4 | 5;
export const HEAT_LEVELS: readonly RogueHeat[] = [0, 1, 2, 3, 4, 5];
export function isHeat(value: unknown): value is RogueHeat {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 5;
}
/** Heat score bounty: +25% per point, the Hades incentive for suffering. */
export function heatScoreMult(heat: number): number {
  return 1 + 0.25 * heat;
}

export interface GeneratedRun {
  seedLabel: string;
  seed: number;
  length: RogueRunLength;
  difficulty: RogueDifficulty;
  heat: RogueHeat;
  playerFighter: FighterKind;
  /** `map[row]` holds that row's rooms ordered by lane. */
  map: MapNode[][];
}

export const RUN_LENGTHS: readonly RogueRunLength[] = [50];
/** Floors per act; the last floor of each act is its boss. */
export const ACT_SIZE = 10;
export const DIFFICULTIES: readonly RogueDifficulty[] = ['ember', 'flame', 'inferno'];
export const LANES = 3;
export const BOSS_LANE = 1;

/** Enemy pool: base-disc fighters. Custom packs remain opt-in player choices in v1. */
const ENEMY_POOL: readonly FighterKind[] = [
  'Fx', 'Mr', 'Kb', 'Ss', 'Pk', 'Fe', 'Lk', 'Ca', 'Dk', 'Mt', 'Cl', 'Pr', 'Ns', 'Kp', 'Pe',
  'Fc', 'Dr', 'Gn', 'Pc', 'Ms', 'Lg', 'Ys', 'Pp', 'Zd', 'Sk', 'Gw',
];
/** ACE 2.0 champions join the rival pool; each carries a base-disc stand-in used
 * when the game source has no extension disc. Giga Bowser stays a boss. */
export const ACE_ENEMY_FALLBACKS: Readonly<Partial<Record<FighterKind, FighterKind>>> = Object.freeze({
  Zx: 'Lk', Td: 'Pe', Mk: 'Kb', Sn: 'Fx', Rc: 'Pk', Lz: 'Kp', Wf: 'Fc', Dd: 'Dk', De: 'Kp', Wr: 'Mr',
  Sh: 'Fx', Bl: 'Kp', Lc: 'Ns', Nm: 'Fx', Nt: 'Ns', Da: 'Pe', Fy: 'Fc', Sc: 'Fx', Dl: 'Lg', Kx: 'Ca',
  Lu: 'Ms', Lc2: 'Ns', Sm: 'Mt', Lb: 'Lg', MM: 'Mr', Sd: 'Cl', Cn: 'Sk',
});
const ACE_POOL = Object.keys(ACE_ENEMY_FALLBACKS) as FighterKind[];
/** Share of regular rivals drawn from the ACE champions. */
export const ACE_RIVAL_CHANCE = 0.35;
/** Chance that a regular 2-3 rival floor is a free-for-all instead of a team (crowds always brawl). */
export const FFA_CHANCE = 0.35;

/** Seeded format for a combat floor. Kept off the floor's main RNG stream. */
function rollFormat(seed: number, row: number, lane: number, count: number, modifier: FloorModifier | null): FloorFormat {
  if (count <= 1) return 'duel';
  // Seven allied rookies hunting one champion is a wall, not a fight: crowds brawl.
  if (modifier?.id === 'swarm' || modifier?.id === 'horde') return 'ffa';
  return createRng((seed ^ Math.imul(row * 13 + lane + 5, 0x27d4eb2d)) >>> 0)() < FFA_CHANCE ? 'ffa' : 'team';
}

/** Fielded matchup for presentation: rival count (plus extra foes such as the gauntlet
 * twin or the Echo mirror) and whether they team up. Older plans default to teams. */
export function floorVersus(floor: Pick<FloorPlan, 'enemies' | 'format' | 'modifier'>, extraFoes = 0): { format: FloorFormat; foes: number } {
  const foes = floor.enemies.length + (floor.modifier?.id === 'gauntlet' && floor.enemies.length ? 1 : 0) + Math.max(0, extraFoes);
  return { format: foes <= 1 ? 'duel' : floor.format === 'ffa' ? 'ffa' : 'team', foes };
}
const STAGE_POOL: readonly StageId[] = ['battlefield', 'final', 'corneria', 'temple', 'stadium', 'yoshi-story', 'dream-land', 'peach-castle', 'onett', 'mute-city', 'yoshi-island', 'green-greens', 'venom', 'jungle-japes', 'fourside', 'brinstar', 'kongo-jungle', 'fountain-of-dreams', 'mushroom-kingdom'];
const BOSS_STAGES: readonly StageId[] = ['stadium', 'temple', 'final', 'peach-castle', 'venom'];

const difficultyBonus = (difficulty: RogueDifficulty): number =>
  difficulty === 'ember' ? 0 : difficulty === 'flame' ? 1 : 2;

const clampLevel = (value: number): CpuLevel =>
  Math.max(1, Math.min(9, Math.round(value))) as CpuLevel;

const pick = <T,>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

/** Boss rows: the tenth floor of every act, and the last floor. */
export function isBossRow(row: number, length: number): boolean {
  return row === length - 1 || (row + 1) % ACT_SIZE === 0;
}
export function actOf(row: number): number {
  return Math.floor(row / ACT_SIZE);
}
const depthOf = (row: number, length: number): number => (length <= 1 ? 1 : row / (length - 1));

function levelFor(row: number, length: number, kind: FloorKind, difficulty: RogueDifficulty, heat: number, rng: () => number): number {
  const depth = depthOf(row, length);
  const base = 1 + 8 * Math.pow(depth, 0.8) + difficultyBonus(difficulty) + heat;
  const bump = kind === 'boss' ? 2 : kind === 'elite' ? 1 : 0;
  return base + bump + (rng() * 1.2 - 0.6);
}

/** Depth scaling for every foe on a floor (prototype balancing, not Melee).
 * Levels cap at 9 around the fourth act; these keep climbing to the end. */
export function foeScaling(row: number, length: number, kind: FloorKind, heat: number): { damage: number; taken: number; knockbackTaken: number; speed: number } {
  const depth = depthOf(row, length);
  const kindBonus = kind === 'boss' ? 0.15 : kind === 'elite' ? 0.08 : 0;
  return {
    damage: (1 + 0.05 * actOf(row) + 1.1 * Math.pow(depth, 1.3) + kindBonus) * (1 + 0.08 * heat),
    taken: Math.max(0.45, (1 - 0.45 * Math.pow(depth, 1.5)) * (1 - 0.02 * heat)),
    knockbackTaken: Math.max(0.5, (1 - 0.4 * Math.pow(depth, 1.4)) * (1 - 0.02 * heat)),
    speed: 1 + 0.12 * depth + 0.01 * heat,
  };
}

function rollModifier(rng: () => number, kind: FloorKind, row: number): FloorModifier | null {
  if (row === 0 || kind !== 'battle') return null;
  const roll = rng();
  if (row >= 1 && roll < 0.1) return { id: 'swarm', ...FLOOR_MODIFIERS.swarm };
  if (roll > 0.42) return null;
  const ids: FloorModifierId[] = ['frenzy', 'showdown', 'endurance', 'gauntlet'];
  if (row >= 3) ids.push('horde');
  const id = pick(rng, ids);
  return { id, ...FLOOR_MODIFIERS[id] };
}

function enemyCount(row: number, kind: FloorKind, modifier: FloorModifier | null, rng: () => number): number {
  if (modifier?.id === 'swarm') return 7;
  if (modifier?.id === 'horde') return 5 + Math.floor(rng() * 3);
  const act = actOf(row);
  if (kind === 'elite') return act >= 3 ? 2 : act >= 1 && rng() < 0.35 ? 2 : 1;
  if (row < 2) return 1;
  switch (act) {
    case 0: return rng() < 0.25 ? 2 : 1;
    case 1: return rng() < 0.5 ? 2 : 1;
    case 2: return rng() < 0.3 ? 3 : 2;
    case 3: return rng() < 0.55 ? 3 : 2;
    default: return rng() < 0.4 ? 4 : 3;
  }
}

function makeFloor(seed: number, row: number, lane: number, kind: FloorKind, length: number, difficulty: RogueDifficulty, heat: number, playerFighter: FighterKind): FloorPlan {
  const rng = createRng((seed ^ Math.imul(row * 7 + lane + 1, 0x6d2b79f5)) >>> 0);
  const act = actOf(row);
  const scaling = foeScaling(row, length, kind, heat);
  const floorSeed = (): number => Math.floor(rng() * 0xffffffff);
  if (kind === 'boss') {
    const boss = bossForAct(act);
    const fighters = pickBossFighters(boss, seed, playerFighter);
    const enemies: RogueEnemy[] = boss.slots.map((slot, index) => ({
      fighter: fighters[index]!,
      level: clampLevel(levelFor(row, length, kind, difficulty, heat, rng) + boss.levelBonus),
      stocks: slot.stocks,
      boss: true,
      ...(slot.fallback ? { fallback: slot.fallback } : {}),
      ...(slot.giga ? { giga: true } : {}),
    }));
    const totalStocks = enemies.reduce((sum, enemy) => sum + (enemy.stocks ?? 3), 0);
    return {
      index: row, kind, act, boss: boss.id, format: enemies.length > 1 ? 'team' : 'duel',
      stage: pick(rng, BOSS_STAGES),
      enemies,
      timeSeconds: Math.min(600, 60 + 60 * totalStocks),
      playerStocks: 3,
      modifier: null,
      handicap: 0,
      foeDamage: scaling.damage,
      foeTakenMul: scaling.taken,
      foeKnockbackTakenMul: scaling.knockbackTaken,
      foeSpeedMul: scaling.speed,
      affixes: affixesForFloor(seed, row, kind, length, heat, false, lane, boss.affixCount),
      rift: false,
      seed: floorSeed(),
    };
  }
  const modifier = rollModifier(rng, kind, row);
  const horde = modifier?.id === 'horde';
  const swarm = modifier?.id === 'swarm';
  const count = Math.min(7, enemyCount(row, kind, modifier, rng));
  const used = new Set<FighterKind>([playerFighter]);
  const enemies: RogueEnemy[] = [];
  const eliteStocks = kind === 'elite' && act >= 3 ? 4 : undefined;
  for (let slot = 0; slot < count; slot++) {
    const source = rng() < ACE_RIVAL_CHANCE ? ACE_POOL : ENEMY_POOL;
    const pool = source.filter((fighter) => !used.has(fighter));
    const fighter = pick(rng, pool.length ? pool : source);
    used.add(fighter);
    const level = swarm ? 1 + act : levelFor(row, length, kind, difficulty, heat, rng) - (horde ? 3 : 0);
    const fallback = ACE_ENEMY_FALLBACKS[fighter];
    enemies.push({ fighter, level: clampLevel(level), ...(eliteStocks ? { stocks: eliteStocks } : {}), ...(fallback ? { fallback } : {}) });
  }
  const stage = pick(rng, STAGE_POOL);
  const rift = row > 0 && rng() < 0.3;
  return {
    index: row,
    kind,
    act,
    boss: null,
    stage,
    enemies,
    timeSeconds: modifier?.id === 'showdown' ? 60 : eliteStocks ? 180 : 120,
    playerStocks: modifier?.id === 'endurance' ? 2 : 3,
    modifier,
    handicap: handicapFor(modifier),
    foeDamage: scaling.damage,
    foeTakenMul: scaling.taken,
    foeKnockbackTakenMul: scaling.knockbackTaken,
    foeSpeedMul: scaling.speed,
    affixes: affixesForFloor(seed, row, kind, length, heat, count > 3, lane),
    rift,
    seed: floorSeed(),
    format: rollFormat(seed, row, lane, count, modifier),
  };
}

const ROOM_WEIGHTS: ReadonlyArray<readonly [NodeKind, number]> = [
  ['battle', 0.42], ['elite', 0.14], ['event', 0.22], ['rest', 0.08], ['shop', 0.07], ['treasure', 0.07],
];
function rollRoom(rng: () => number): NodeKind {
  let roll = rng();
  for (const [kind, weight] of ROOM_WEIGHTS) {
    if ((roll -= weight) < 0) return kind;
  }
  return 'battle';
}

function rollReward(rng: () => number, kind: FloorKind, row: number): RewardKind {
  if (kind === 'boss') return 'boon';
  const roll = rng();
  if (kind === 'elite') return roll < 0.78 || row < 2 ? 'boon' : 'pom';
  if (roll < 0.54) return 'boon';
  if (roll < 0.68) return row >= 2 ? 'pom' : 'boon';
  if (roll < 0.82) return 'coins';
  if (roll < 0.91) return 'heart';
  return 'pocket';
}

/** Room kinds for one non-boss row with the pacing rules applied. */
function rowKinds(rng: () => number, row: number, length: number, treasureSeen: boolean): NodeKind[] {
  if (row === 0) return ['battle', 'battle', 'battle'];
  const preBoss = isBossRow(row + 1, length);
  const kinds: NodeKind[] = [];
  for (let lane = 0; lane < LANES; lane++) {
    let kind = rollRoom(rng);
    if (kind === 'elite' && row < 2) kind = 'battle';
    if (kind === 'rest' && row < 2) kind = 'event';
    // The pre-boss antechamber already sells: no shop rooms right before a boss.
    if (kind === 'shop' && preBoss) kind = 'rest';
    if (kind === 'treasure' && treasureSeen) kind = 'event';
    if ((kind === 'rest' || kind === 'shop' || kind === 'treasure') && kinds.includes(kind)) kind = 'battle';
    if (kind === 'treasure') treasureSeen = true;
    kinds.push(kind);
  }
  // Every row keeps at least one fight so a route never skips the tower entirely.
  if (!kinds.some((kind) => kind === 'battle' || kind === 'elite')) kinds[Math.floor(rng() * LANES)] = 'battle';
  return kinds;
}

/** Deterministic run generation: same seed label + options always yield the same map. */
export function generateRun(
  seedInput: string,
  options: { length?: RogueRunLength; difficulty?: RogueDifficulty; playerFighter?: FighterKind; heat?: RogueHeat } = {},
): GeneratedRun {
  const length = options.length ?? 50;
  const difficulty = options.difficulty ?? 'flame';
  const playerFighter = options.playerFighter ?? 'Fx';
  const heat = options.heat ?? 0;
  if (!RUN_LENGTHS.includes(length)) throw new Error('The descent is 50 floors.');
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('Unknown roguelike difficulty.');
  if (!isHeat(heat)) throw new Error('Heat must be 0 to 5.');
  const { seed, label } = normalizeSeed(seedInput || 'RIFT');
  const rng = createRng(seed);
  const map: MapNode[][] = [];
  const usedEvents = new Set<EventId>();
  let treasureAct = -1;
  for (let row = 0; row < length; row++) {
    if (isBossRow(row, length)) {
      map.push([{ row, lane: BOSS_LANE, kind: 'boss', next: [], reward: 'boon', patron: pick(rng, DOOR_PATRONS), floor: makeFloor(seed, row, BOSS_LANE, 'boss', length, difficulty, heat, playerFighter), event: null }]);
      continue;
    }
    const act = actOf(row);
    const kinds = rowKinds(rng, row, length, treasureAct === act);
    if (kinds.includes('treasure')) treasureAct = act;
    const rowPatrons = [...DOOR_PATRONS].sort(() => rng() - 0.5);
    map.push(kinds.map((kind, lane): MapNode => {
      if (kind === 'battle' || kind === 'elite') {
        const reward = rollReward(rng, kind, row);
        return { row, lane, kind, next: [], reward, patron: reward === 'boon' ? rowPatrons[lane]! : null, floor: makeFloor(seed, row, lane, kind, length, difficulty, heat, playerFighter), event: null };
      }
      if (kind === 'event') {
        const fresh = EVENT_IDS.filter((id) => !usedEvents.has(id));
        const event = pick(rng, fresh.length ? fresh : EVENT_IDS);
        usedEvents.add(event);
        return { row, lane, kind, next: [], reward: null, patron: null, floor: null, event };
      }
      return { row, lane, kind, next: [], reward: null, patron: null, floor: null, event: null };
    }));
  }
  // Edges: straight down always, diagonals sometimes, never crossing.
  for (let row = 0; row < length - 1; row++) {
    const current = map[row]!;
    const below = map[row + 1]!;
    if (below.length === 1) {
      for (const node of current) node.next = [below[0]!.lane];
      continue;
    }
    if (current.length === 1) {
      current[0]!.next = below.map((node) => node.lane);
      continue;
    }
    for (const node of current) {
      const next = new Set<number>([node.lane]);
      const left = current.find((other) => other.lane === node.lane - 1);
      if (node.lane > 0 && rng() < 0.35 && !left?.next.includes(node.lane)) next.add(node.lane - 1);
      if (node.lane < LANES - 1 && rng() < 0.35) next.add(node.lane + 1);
      node.next = [...next].sort((a, b) => a - b);
    }
  }
  return { seedLabel: label, seed, length, difficulty, heat, playerFighter, map };
}

export function nodeAt(plan: GeneratedRun, row: number, lane: number): MapNode {
  const node = plan.map[row]?.find((entry) => entry.lane === lane);
  if (!node) throw new Error('No room at that map position.');
  return node;
}

/** Lanes the player may enter on `row`, given the lane taken on the row above. */
export function reachableLanes(plan: GeneratedRun, row: number, previousLane: number | null): number[] {
  const nodes = plan.map[row];
  if (!nodes) return [];
  if (row === 0 || previousLane === null) return nodes.map((node) => node.lane);
  return nodeAt(plan, row - 1, previousLane).next.filter((lane) => nodes.some((node) => node.lane === lane));
}

/** Combat rooms left on the map (preview/test helper). */
export function combatFloors(plan: GeneratedRun): FloorPlan[] {
  return plan.map.flat().flatMap((node) => (node.floor ? [node.floor] : []));
}
