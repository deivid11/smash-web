/** Run lifecycle: pure state machine over a `lib/game/roguelike/generator.ts`
 * map plus owned boons from `lib/game/roguelike/boons.ts`. No React, no
 * simulation handles — the web controller in
 * `web/src/play/roguelike-session.ts` drives `GameSession` from this state.
 *
 * blessing → map → (intro → fight → reward | event | rest | shop | treasure)
 *   → map … → antechamber shop → boss → … → victory / gameover
 */
import {
  ACT_SIZE, heatScoreMult, isBossRow, isHeat, modifierUpgradesReward, nodeAt, reachableLanes,
  type FloorPlan, type GeneratedRun, type MapNode, type RogueHeat,
} from './generator.ts';
import { scoreForAffixes, type FoeAffixId } from './affixes.ts';
import {
  boonById, computeBoonState, maxLevelOf, nextRarity, offerBoons, offerPoms, offerRemovals, shopPrice, takeCard,
  SHOP_HEAL_PRICE, SHOP_REMOVE_PRICE, SHOP_REROLL_PRICE,
  type BoonRarity, type BoonState, type OfferCard, type OwnedBoon,
} from './boons.ts';
import { CONSUMABLE_OVERFLOW_COINS, consumableById, MAX_CONSUMABLES, offerConsumable, type ConsumableId } from './consumables.ts';
import { eventById, type EventId } from './events.ts';
import { blessingById, blessingPatron, NO_META_BONUSES, offerBlessings, type BlessingId, type MetaBonuses } from './meta.ts';
import { DOOR_PATRONS, type PatronId } from './patrons.ts';
import { applyLoadoutBuild, relicValue, type EquippedAspect, type EquippedRelic } from './unlocks.ts';
import { applyTreasureBuild, bossById, offerTreasures, treasureById, type TreasureId } from './bosses.ts';
import { createRng } from './seed.ts';
import type { FighterKind } from '../data.ts';

export type RunPhase = 'blessing' | 'map' | 'intro' | 'fight' | 'reward' | 'spoils' | 'shop' | 'event' | 'rest' | 'victory' | 'gameover';
export type FloorOutcome = 'win' | 'lose' | 'draw';
export type OfferSource = 'room' | 'treasure' | 'event' | 'rest' | 'shop-pom' | 'shop-remove';
export interface OfferSpec { patron: PatronId | null; pool?: PatronId[]; minRarity?: BoonRarity }

/** Next-fight consequences from events (Golden Trophy, Rift Storm, Echo). */
export interface PendingFight {
  source: EventId;
  fights: number;
  levelShift: number;
  affixes: FoeAffixId[];
  mirror: boolean;
  rewardBump: boolean;
  scoreBonus: number;
}

export interface ShopState {
  cards: Array<OfferCard | null>;
  pockets: Array<ConsumableId | null>;
  rerolled: boolean;
  healed: boolean;
  removed: boolean;
  pomBought: boolean;
  /** Pre-boss antechamber (leaving opens the boss row) vs a map shop room. */
  antechamber: boolean;
}

/** Last reward/outcome banner for the UI (`kind:detail`, e.g. `coins:120`). */
export type RunToast = string | null;

export interface RogueRun {
  planSeed: number;
  seedLabel: string;
  difficulty: GeneratedRun['difficulty'];
  heat: RogueHeat;
  length: number;
  playerFighter: FighterKind;
  /** Current map row, and the lane entered on it (null while choosing). */
  row: number;
  lane: number | null;
  /** Lanes taken on every finished row. */
  path: number[];
  lives: number;
  maxLives: number;
  score: number;
  coins: number;
  kos: number;
  bossesDown: number;
  flawless: number;
  boons: OwnedBoon[];
  phase: RunPhase;
  blessings: BlessingId[];
  blessing: BlessingId | null;
  offers: OfferCard[];
  offerSource: OfferSource | null;
  /** Stream key for the current offer (rerolls bump it). */
  offerKey: number;
  /** How the current boon offer was drawn, so rerolls keep the same rules. */
  offerSpec: OfferSpec | null;
  rerolls: number;
  shop: ShopState | null;
  event: { id: EventId; outcome: string | null } | null;
  consumables: ConsumableId[];
  pockets: number;
  /** Run-wide Last Stands (Mirror Death Defiance, Lucky Tooth). */
  defiances: number;
  pending: PendingFight[];
  luck: number;
  takenMul: number;
  toast: RunToast;
  /** Rows finished. Victory when this reaches the map length. */
  cleared: number;
  /** Permanent unlocks attached to this run (relics + champion aspect). */
  relics: EquippedRelic[];
  aspect: EquippedAspect | null;
  championRank: number;
  /** Shop price multiplier (Merchant's Ledger). */
  priceMul: number;
  // Run stats reported to the meta layer (achievements, mastery, relic XP).
  fightsWon: number;
  elitesDown: number;
  eventsVisited: number;
  coinsSpent: number;
  /** Boss treasures owned, and the pick currently offered after a boss. */
  treasures: TreasureId[];
  spoils: TreasureId[];
  /** Multiplier on floor/KO coins (Golden Idol). */
  coinMul: number;
}

/** What a run brings from the meta layer: equipped relics, the champion's aspect and mastery perks. */
export interface RunLoadout {
  relics: EquippedRelic[];
  aspect: EquippedAspect | null;
  championRank: number;
  perks: { rerolls: number; coins: number; lives: number };
}
export const EMPTY_LOADOUT: RunLoadout = Object.freeze({ relics: [], aspect: null, championRank: 1, perks: { rerolls: 0, coins: 0, lives: 0 } });

export const BASE_LIVES = 2;
export const MAX_LIVES = 5;
export const MAX_LIVES_CAP = 9;
// Economy: clears pay more than KOs so crowded floors don't flood the purse,
// and shop prices climb per act (runPrice) so every visit is a choice.
export const COINS_PER_CLEAR = 45;
export const COINS_PER_KO = 5;
export const COINS_FLAWLESS = 25;
/** Shop price growth per act past the first (+25% each). */
export const PRICE_GROWTH_PER_ACT = 0.25;
export const VICTORY_SCORE = 5000;

export function createRun(plan: GeneratedRun, bonuses: MetaBonuses = NO_META_BONUSES, loadout: RunLoadout = EMPTY_LOADOUT): RogueRun {
  const base: RogueRun = {
    planSeed: plan.seed,
    seedLabel: plan.seedLabel,
    difficulty: plan.difficulty,
    heat: plan.heat,
    length: plan.length,
    playerFighter: plan.playerFighter,
    row: 0,
    lane: null,
    path: [],
    lives: BASE_LIVES + bonuses.lives,
    maxLives: MAX_LIVES + bonuses.lives,
    score: 0,
    coins: bonuses.coins,
    kos: 0,
    bossesDown: 0,
    flawless: 0,
    boons: [],
    phase: 'blessing',
    blessings: offerBlessings(plan.seed),
    blessing: null,
    offers: [],
    offerSource: null,
    offerKey: 0,
    offerSpec: null,
    rerolls: bonuses.rerolls,
    shop: null,
    event: null,
    consumables: [],
    pockets: MAX_CONSUMABLES + bonuses.pockets,
    defiances: bonuses.defiances,
    pending: [],
    luck: bonuses.luck,
    takenMul: bonuses.takenMul,
    toast: null,
    cleared: 0,
    relics: loadout.relics.map((relic) => ({ ...relic })),
    aspect: loadout.aspect ? { ...loadout.aspect } : null,
    championRank: loadout.championRank,
    priceMul: 1,
    fightsWon: 0,
    elitesDown: 0,
    eventsVisited: 0,
    coinsSpent: 0,
    treasures: [],
    spoils: [],
    coinMul: 1,
  };
  return applyLoadoutStart(base, plan, loadout);
}

/** Run-start relic effects and champion perks (build-lane effects live in `runBuild`). */
function applyLoadoutStart(run: RogueRun, plan: GeneratedRun, loadout: RunLoadout): RogueRun {
  let next: RogueRun = {
    ...run,
    coins: run.coins + loadout.perks.coins,
    rerolls: run.rerolls + loadout.perks.rerolls,
    lives: run.lives + loadout.perks.lives,
    maxLives: Math.min(MAX_LIVES_CAP, run.maxLives + loadout.perks.lives),
  };
  for (const relic of loadout.relics) {
    const value = relicValue(relic.id, relic.level);
    switch (relic.id) {
      case 'lucky-coin': next = { ...next, coins: next.coins + value }; break;
      case 'wanderer-map': next = { ...next, rerolls: next.rerolls + value }; break;
      case 'ledger': next = { ...next, priceMul: next.priceMul * (1 - value / 100) }; break;
      case 'compass': next = { ...next, luck: next.luck + value }; break;
      case 'harpy-feather':
        if (relic.level >= 2) next = { ...next, pockets: next.pockets + 1 };
        for (let count = 0; count < value; count++) next = grantConsumable(next, 'feather');
        break;
      case 'phoenix-heart':
        next = { ...next, defiances: next.defiances + value };
        if (relic.level >= 2) next = { ...next, lives: next.lives + 1, maxLives: Math.min(MAX_LIVES_CAP, next.maxLives + 1) };
        break;
      case 'chaos-shard': {
        const [card] = offerBoons({ seed: plan.seed, key: 9100, owned: next.boons, patron: null, pool: ['chaos'], minRarity: relic.level >= 2 ? 'epic' : 'rare', count: 1 });
        if (card) next = withBoons(next, takeCard(next.boons, card));
        if (relic.level >= 3) next = { ...next, rerolls: next.rerolls + 1 };
        break;
      }
      default: break;
    }
  }
  return { ...next, toast: null };
}

/** Shop price after the run's discounts, +25% per act past the first. */
export function runPrice(run: Pick<RogueRun, 'priceMul' | 'row'>, base: number): number {
  const act = Math.min(4, Math.floor(Math.max(0, run.row) / ACT_SIZE));
  return Math.max(1, Math.round(base * run.priceMul * (1 + PRICE_GROWTH_PER_ACT * act)));
}

/** The full build for this run (boons + Mirror Thick Skin). */
export function runBuild(run: RogueRun): BoonState {
  const state = computeBoonState(run.boons, (build) => {
    applyLoadoutBuild(build, run.relics ?? [], run.aspect ?? null);
    applyTreasureBuild(build, run.treasures ?? []);
  });
  if (run.takenMul !== 1) state.player.damageTakenMul = Math.max(0.4, state.player.damageTakenMul * run.takenMul);
  return state;
}

export function currentNode(plan: GeneratedRun, run: RogueRun): MapNode | null {
  return run.lane === null ? null : nodeAt(plan, run.row, run.lane);
}
export function currentFloor(plan: GeneratedRun, run: RogueRun): FloorPlan {
  const floor = currentNode(plan, run)?.floor;
  if (!floor) throw new Error('No combat room selected.');
  return floor;
}
export function availableLanes(plan: GeneratedRun, run: RogueRun): number[] {
  return reachableLanes(plan, run.row, run.row === 0 ? null : (run.path[run.row - 1] ?? null));
}

// ——— Rewards ———

function grantConsumable(run: RogueRun, id: ConsumableId): RogueRun {
  if (run.consumables.length >= run.pockets) return { ...run, coins: run.coins + CONSUMABLE_OVERFLOW_COINS, toast: `overflow:${id}` };
  return { ...run, consumables: [...run.consumables, id], toast: `pocket:${id}` };
}
/** Spend one pocketed consumable (the match effect itself runs poolside). */
export function removeConsumable(run: RogueRun, id: ConsumableId): RogueRun {
  const index = run.consumables.indexOf(id);
  if (index < 0) throw new Error('No such consumable in your pockets.');
  return { ...run, consumables: run.consumables.filter((_, slot) => slot !== index) };
}

/** Owned list change + run-life delta from Hearty Stew style boons (removing one takes its life back). */
function withBoons(run: RogueRun, boons: OwnedBoon[]): RogueRun {
  const before = computeBoonState(run.boons).bonusLives;
  const after = computeBoonState(boons).bonusLives;
  const delta = after - before;
  if (delta === 0) return { ...run, boons };
  const maxLives = Math.max(1, Math.min(MAX_LIVES_CAP, run.maxLives + delta));
  return { ...run, boons, maxLives, lives: Math.max(1, Math.min(maxLives, run.lives + delta)) };
}

function withOffers(run: RogueRun, offers: OfferCard[], source: OfferSource, key: number, spec: OfferSpec | null = null): RogueRun {
  return { ...run, phase: 'reward', offers, offerSource: source, offerKey: key, offerSpec: spec };
}
/** Draw a boon offer and remember its rules for rerolls. */
function boonOffer(run: RogueRun, plan: GeneratedRun, source: OfferSource, key: number, spec: OfferSpec, count = 3): RogueRun {
  const offers = offerBoons({ seed: plan.seed, key, owned: run.boons, patron: spec.patron, pool: spec.pool, minRarity: spec.minRarity, luck: run.luck, count });
  return withOffers(run, offers, source, key, spec);
}

const randomDoorPatron = (seed: number, key: number): PatronId => {
  const rng = createRng((seed ^ Math.imul(key + 29, 0x632be5ab)) >>> 0);
  return DOOR_PATRONS[Math.floor(rng() * DOOR_PATRONS.length)]!;
};

const upgradable = (run: RogueRun): boolean =>
  run.boons.some((entry) => !boonById(entry.id).fixed && entry.level < maxLevelOf(boonById(entry.id)));

/** Score for clearing a floor: base + enemy budget + modifier/affix bonus + boons. */
export function scoreForFloor(plan: GeneratedRun, floor: FloorPlan, boonState: BoonState, bonus = 0): number {
  const levelSum = floor.enemies.reduce((sum, enemy) => sum + enemy.level, 0);
  const kindBonus = floor.kind === 'boss' ? 1000 * ((floor.act ?? 0) + 1) : floor.kind === 'elite' ? 120 : 0;
  const modifierBonus = floor.modifier?.id === 'showdown' ? 100 : floor.modifier?.id === 'horde' || floor.modifier?.id === 'swarm' ? 150 : 0;
  const base = (floor.index + 1) * 100 + floor.enemies.length * 50 + levelSum * 10 + kindBonus + modifierBonus + scoreForAffixes(floor.affixes) + boonState.scorePerFloor + bonus;
  return Math.round(base * heatScoreMult(plan.heat));
}

// ——— Transitions ———

export function pickBlessing(run: RogueRun, plan: GeneratedRun, id: BlessingId): RogueRun {
  if (run.phase !== 'blessing') throw new Error('Blessings are chosen before the first room.');
  if (!run.blessings.includes(id)) throw new Error('That blessing is not on offer.');
  blessingById(id);
  let next: RogueRun = { ...run, blessing: id, phase: 'map', blessings: [] };
  const rng = createRng((plan.seed ^ 0xb1e55) >>> 0);
  switch (id) {
    case 'coin-purse': next.coins += 120; break;
    case 'lucky-tooth': next.defiances += 1; break;
    case 'second-heart': next.maxLives = Math.min(MAX_LIVES_CAP, next.maxLives + 1); next.lives += 1; break;
    case 'reroll-dice': next.rerolls += 2; break;
    case 'pocket-kit':
      next = grantConsumable(next, offerConsumable(plan.seed, 501));
      next = grantConsumable(next, offerConsumable(plan.seed, 502));
      break;
    case 'patron-sigil': {
      const [card] = offerBoons({ seed: plan.seed, key: 9001, owned: next.boons, patron: blessingPatron(plan.seed), minRarity: 'rare', count: 1 });
      if (card) next = withBoons(next, takeCard(next.boons, card));
      break;
    }
    case 'chaos-seed': {
      const [card] = offerBoons({ seed: plan.seed, key: 9002, owned: next.boons, patron: null, pool: ['chaos'], minRarity: 'epic', count: 1 });
      if (card) next = withBoons(next, takeCard(next.boons, card));
      break;
    }
    case 'sharpened': {
      const choices = ['ember-fury', 'hunt-aim', 'tide-riptide'];
      next = withBoons(next, takeCard(next.boons, { type: 'boon', id: choices[Math.floor(rng() * choices.length)]!, rarity: 'epic' }));
      break;
    }
  }
  return { ...next, toast: `blessing:${id}` };
}

/** Enter a reachable room on the current row. */
export function chooseNode(run: RogueRun, plan: GeneratedRun, lane: number): RogueRun {
  if (run.phase !== 'map') throw new Error('Rooms are chosen from the map.');
  if (!availableLanes(plan, run).includes(lane)) throw new Error('That room is not reachable from your path.');
  const node = nodeAt(plan, run.row, lane);
  const entered: RogueRun = { ...run, lane, toast: null };
  switch (node.kind) {
    case 'battle': case 'elite': case 'boss':
      return { ...entered, phase: 'intro' };
    case 'event':
      return { ...entered, phase: 'event', event: { id: node.event!, outcome: null }, eventsVisited: entered.eventsVisited + 1 };
    case 'rest':
      return { ...entered, phase: 'rest' };
    case 'shop':
      return { ...entered, phase: 'shop', shop: stockShop(entered, plan, false) };
    case 'treasure': {
      const key = run.row * 100 + 7;
      const rng = createRng((plan.seed ^ Math.imul(key, 0x45d9f3b)) >>> 0);
      const patrons = [...DOOR_PATRONS].sort(() => rng() - 0.5);
      const offers = patrons.slice(0, 3).flatMap((patron, index) =>
        offerBoons({ seed: plan.seed, key: key + index, owned: run.boons, patron, minRarity: 'rare', luck: run.luck, count: 1 }));
      return withOffers({ ...entered, coins: entered.coins + 60, toast: 'coins:60' }, offers, 'treasure', key, { patron: null, minRarity: 'rare' });
    }
  }
}

export function toFight(run: RogueRun): RogueRun {
  if (run.phase !== 'intro') throw new Error('Floors start from their intro card.');
  return { ...run, phase: 'fight' };
}

export interface FightResult {
  /** No stock lost (falls === 0). */
  flawless: boolean;
  /** KOs credited to the player. */
  kos: number;
  /** Run-wide Last Stands consumed this fight. */
  defiancesUsed: number;
}

/** Leave a finished room: next row, antechamber before bosses, victory at the end. */
export function advance(run: RogueRun, plan: GeneratedRun): RogueRun {
  if (run.lane === null) throw new Error('No room to leave.');
  const cleared = run.row + 1;
  const base: RogueRun = { ...run, cleared, offers: [], offerSource: null, offerSpec: null, event: null, shop: null };
  if (cleared >= plan.length) return { ...base, path: [...run.path, run.lane], phase: 'victory', score: base.score + VICTORY_SCORE };
  const next: RogueRun = { ...base, row: cleared, lane: null, path: [...run.path, run.lane], phase: 'map' };
  if (isBossRow(cleared, plan.length)) return { ...next, phase: 'shop', shop: stockShop(next, plan, true) };
  return next;
}

/** Resolve a finished match. Wins pay coins/score then open the door reward;
 * losses spend a run life and retry; draws replay without cost. */
export function resolveFloor(run: RogueRun, plan: GeneratedRun, outcome: FloorOutcome, result: FightResult = { flawless: false, kos: 0, defiancesUsed: 0 }): RogueRun {
  if (run.phase !== 'fight') throw new Error('Only a live floor can resolve.');
  const node = currentNode(plan, run);
  const floor = node?.floor;
  if (!node || !floor) throw new Error('No combat room to resolve.');
  const defiances = Math.max(0, run.defiances - result.defiancesUsed);
  if (outcome === 'draw') return { ...run, defiances, phase: 'intro', toast: 'draw' };
  if (outcome === 'lose') {
    if (run.lives - 1 <= 0) return { ...run, defiances, lives: 0, phase: 'gameover' };
    return { ...run, defiances, lives: run.lives - 1, phase: 'intro', toast: 'retry' };
  }
  const build = runBuild(run);
  const bonus = run.pending.reduce((sum, entry) => sum + entry.scoreBonus, 0);
  const bump = run.pending.some((entry) => entry.rewardBump) || modifierUpgradesReward(floor.modifier);
  const kills = Math.max(0, result.kos);
  let next: RogueRun = {
    ...run,
    defiances,
    score: run.score + scoreForFloor(plan, floor, build, bonus),
    coins: run.coins + Math.round((COINS_PER_CLEAR + (COINS_PER_KO + build.coinsPerKo) * kills + (result.flawless ? COINS_FLAWLESS : 0)) * (run.coinMul ?? 1)),
    kos: run.kos + kills,
    flawless: run.flawless + (result.flawless ? 1 : 0),
    fightsWon: run.fightsWon + 1,
    elitesDown: run.elitesDown + (floor.kind === 'elite' ? 1 : 0),
    pending: run.pending.map((entry) => ({ ...entry, fights: entry.fights - 1 })).filter((entry) => entry.fights > 0),
    toast: null,
  };
  if (result.flawless) next = grantConsumable(next, offerConsumable(plan.seed, run.row * 10 + 1));
  if (floor.kind === 'boss') {
    // High recompense: bounty, +1 max life and a full heal, a pocket item, then boss spoils.
    const bounty = Math.round((floor.boss ? bossById(floor.boss).bounty : 75) * (run.coinMul ?? 1));
    const maxLives = Math.min(MAX_LIVES_CAP, next.maxLives + 1);
    next = { ...next, bossesDown: next.bossesDown + 1, coins: next.coins + bounty, maxLives, lives: maxLives, toast: `bounty:${bounty}` };
    next = grantConsumable(next, offerConsumable(plan.seed, run.row * 10 + 2));
    if (run.row + 1 >= plan.length) return advance(next, plan);
    const spoils = offerTreasures(plan.seed, floor.act ?? 0, next.treasures);
    if (spoils.length) return { ...next, phase: 'spoils', spoils, toast: `bounty:${bounty}` };
  }
  if (run.row + 1 >= plan.length) return advance(next, plan);
  const key = run.row * 100 + (run.lane ?? 0);
  const floorRarity: BoonRarity | undefined = floor.kind === 'boss' ? 'epic' : floor.kind === 'elite' ? 'rare' : undefined;
  const minRarity = bump ? nextRarity(floorRarity ?? 'common') : floorRarity;
  switch (node.reward) {
    case 'pom': {
      const poms = offerPoms(plan.seed, key, next.boons, floor.kind === 'elite' || bump ? 2 : 1);
      if (poms.length) return withOffers(next, poms, 'room', key);
      return boonOffer(next, plan, 'room', key, { patron: randomDoorPatron(plan.seed, key), minRarity });
    }
    case 'coins': {
      const coins = Math.round((60 + run.row * 6) * (bump ? 1.5 : 1));
      return advance({ ...next, coins: next.coins + coins, toast: `coins:${coins}` }, plan);
    }
    case 'heart':
      return advance({ ...next, maxLives: Math.min(MAX_LIVES_CAP, next.maxLives + 1), lives: Math.min(MAX_LIVES_CAP, next.lives + 1), toast: 'heart' }, plan);
    case 'pocket':
      return advance(grantConsumable(next, offerConsumable(plan.seed, key + 77)), plan);
    case 'boon':
    default:
      return boonOffer(next, plan, 'room', key, { patron: node.patron, minRarity });
  }
}

/** Take one offered card. Shop sub-offers return to the shop; everything else leaves the room. */
export function pickOffer(run: RogueRun, plan: GeneratedRun, index: number): RogueRun {
  if (run.phase !== 'reward') throw new Error('There is nothing to pick right now.');
  const card = run.offers[index];
  if (!card) throw new Error('Unknown offer.');
  let next = withBoons(run, takeCard(run.boons, card));
  next = { ...next, toast: `${card.type}:${card.id}` };
  if (run.event?.id === 'sparring' && card.type === 'remove') next = { ...next, coins: next.coins + 60 };
  if (run.offerSource === 'shop-pom' || run.offerSource === 'shop-remove') return { ...next, phase: 'shop', offers: [], offerSource: null, offerSpec: null };
  return advance(next, plan);
}

/** Boss spoils: take one treasure, then the boss door's EPIC boon. */
export function pickSpoil(run: RogueRun, plan: GeneratedRun, id: TreasureId): RogueRun {
  if (run.phase !== 'spoils') throw new Error('There are no boss spoils to claim.');
  if (!run.spoils.includes(id)) throw new Error('That treasure is not on offer.');
  treasureById(id);
  let next: RogueRun = { ...run, treasures: [...run.treasures, id], spoils: [], toast: `treasure:${id}` };
  switch (id) {
    case 'titan-heart': {
      const maxLives = Math.min(MAX_LIVES_CAP, next.maxLives + 2);
      next = { ...next, maxLives, lives: maxLives };
      break;
    }
    case 'patron-blessing':
      next = { ...next, boons: next.boons.map((entry) => {
        const boon = boonById(entry.id);
        return boon.fixed ? entry : { ...entry, level: Math.min(maxLevelOf(boon), entry.level + 1) };
      }) };
      break;
    case 'golden-idol': next = { ...next, coinMul: next.coinMul * 1.5, priceMul: next.priceMul * 0.75 }; break;
    case 'rift-compass': next = { ...next, rerolls: next.rerolls + 3, luck: next.luck + 0.2 }; break;
    default: break;
  }
  const node = currentNode(plan, run);
  const key = run.row * 100 + (run.lane ?? 0);
  return boonOffer(next, plan, 'room', key, { patron: node?.patron ?? null, minRarity: 'epic' });
}

/** Skip the offer: rooms pay a small consolation, shop sub-offers refund. */
export function skipOffer(run: RogueRun, plan: GeneratedRun): RogueRun {
  if (run.phase !== 'reward') throw new Error('There is nothing to skip.');
  if (run.offerSource === 'shop-pom' || run.offerSource === 'shop-remove') {
    const refund = runPrice(run, run.offerSource === 'shop-pom' ? shopPrice({ type: 'pom', id: '', levels: 1 }) : SHOP_REMOVE_PRICE);
    const shop = run.shop ? { ...run.shop, pomBought: run.offerSource === 'shop-pom' ? false : run.shop.pomBought, removed: run.offerSource === 'shop-remove' ? false : run.shop.removed } : null;
    return { ...run, coins: run.coins + refund, coinsSpent: Math.max(0, run.coinsSpent - refund), shop, phase: 'shop', offers: [], offerSource: null, offerSpec: null };
  }
  return advance({ ...run, coins: run.coins + 20, toast: 'coins:20' }, plan);
}

/** Fated Authority: redraw boon cards with a fresh stream. */
export function rerollOffers(run: RogueRun, plan: GeneratedRun): RogueRun {
  if (run.phase !== 'reward') throw new Error('Nothing to reroll.');
  if (run.rerolls <= 0) throw new Error('No rerolls left.');
  if (!run.offerSpec || !run.offers.length || run.offers.some((card) => card.type !== 'boon')) throw new Error('Only boon offers can be rerolled.');
  const rerolled = boonOffer(run, plan, run.offerSource!, run.offerKey + 1000, run.offerSpec, run.offers.length);
  if (!rerolled.offers.length) return run;
  return { ...rerolled, rerolls: run.rerolls - 1 };
}

// ——— Rest ———

export function restHeal(run: RogueRun, plan: GeneratedRun): RogueRun {
  if (run.phase !== 'rest') throw new Error('You are not at a rest site.');
  const full = run.lives >= run.maxLives;
  const maxLives = full ? Math.min(MAX_LIVES_CAP, run.maxLives + 1) : run.maxLives;
  return advance({ ...run, maxLives, lives: Math.min(maxLives, run.lives + 1), toast: full ? 'heart' : 'life' }, plan);
}
export function restTemper(run: RogueRun, plan: GeneratedRun): RogueRun {
  if (run.phase !== 'rest') throw new Error('You are not at a rest site.');
  const key = run.row * 100 + 31;
  const poms = offerPoms(plan.seed, key, run.boons, 1);
  if (!poms.length) throw new Error('No boon can be upgraded yet.');
  return withOffers(run, poms, 'rest', key);
}

// ——— Shop (Charon) ———

function stockShop(run: RogueRun, plan: GeneratedRun, antechamber: boolean): ShopState {
  const key = run.row * 100 + 55;
  const rng = createRng((plan.seed ^ Math.imul(key, 0x2c1b3c6d)) >>> 0);
  const patrons = [...DOOR_PATRONS].sort(() => rng() - 0.5);
  const cards = [
    ...offerBoons({ seed: plan.seed, key, owned: run.boons, patron: patrons[0]!, luck: run.luck, count: 1 }),
    ...offerBoons({ seed: plan.seed, key: key + 1, owned: run.boons, patron: patrons[1]!, luck: run.luck, count: 1 }),
    ...offerBoons({ seed: plan.seed, key: key + 2, owned: run.boons, patron: rng() < 0.35 ? null : patrons[2]!, pool: rng() < 0.35 ? ['chaos', 'rift'] : undefined, minRarity: 'rare', luck: run.luck, count: 1 }),
  ];
  // Late runs exhaust the boon pool: empty shelves restock with poms so gold keeps a use.
  if (cards.length < 3) cards.push(...offerPoms(plan.seed, key + 7, run.boons, 1, 3 - cards.length));
  return {
    cards,
    pockets: [offerConsumable(plan.seed, key + 3), offerConsumable(plan.seed, key + 4)],
    rerolled: false, healed: false, removed: false, pomBought: false, antechamber,
  };
}

function requireShop(run: RogueRun): ShopState {
  if (run.phase !== 'shop' || !run.shop) throw new Error('The shop is closed.');
  return run.shop;
}
/** Pay a shop price (discounts applied here) and log it for the meta layer. */
function pay(run: RogueRun, base: number): RogueRun {
  const price = runPrice(run, base);
  if (run.coins < price) throw new Error('Not enough coins.');
  return { ...run, coins: run.coins - price, coinsSpent: run.coinsSpent + price };
}

export function buyShopCard(run: RogueRun, index: number): RogueRun {
  const shop = requireShop(run);
  const card = shop.cards[index];
  if (!card) throw new Error('That shelf is empty.');
  const paid = pay(run, shopPrice(card));
  const next = withBoons(paid, takeCard(paid.boons, card));
  return { ...next, shop: { ...shop, cards: shop.cards.map((entry, slot) => (slot === index ? null : entry)) }, toast: `${card.type}:${card.id}` };
}
export function buyShopPocket(run: RogueRun, index: number): RogueRun {
  const shop = requireShop(run);
  const id = shop.pockets[index];
  if (!id) throw new Error('That shelf is empty.');
  if (run.consumables.length >= run.pockets) throw new Error('Your pockets are full.');
  const paid = pay(run, consumableById(id).price);
  return { ...paid, consumables: [...paid.consumables, id], shop: { ...shop, pockets: shop.pockets.map((entry, slot) => (slot === index ? null : entry)) }, toast: `pocket:${id}` };
}
export function buyHeal(run: RogueRun): RogueRun {
  const shop = requireShop(run);
  if (shop.healed) throw new Error('Charon only patches you up once per visit.');
  if (run.lives >= run.maxLives) throw new Error('Already at full lives.');
  const paid = pay(run, SHOP_HEAL_PRICE);
  return { ...paid, lives: paid.lives + 1, shop: { ...shop, healed: true }, toast: 'life' };
}
export function buyPom(run: RogueRun, plan: GeneratedRun): RogueRun {
  const shop = requireShop(run);
  if (shop.pomBought) throw new Error('The pom is sold out.');
  if (!upgradable(run)) throw new Error('No boon can be upgraded yet.');
  const paid = pay(run, shopPrice({ type: 'pom', id: '', levels: 1 }));
  const key = run.row * 100 + 61;
  return withOffers({ ...paid, shop: { ...shop, pomBought: true } }, offerPoms(plan.seed, key, run.boons, 1), 'shop-pom', key);
}
export function buyRemoval(run: RogueRun): RogueRun {
  const shop = requireShop(run);
  if (shop.removed) throw new Error('Charon only purges once per visit.');
  if (!run.boons.length) throw new Error('You carry no boons.');
  const paid = pay(run, SHOP_REMOVE_PRICE);
  return withOffers({ ...paid, shop: { ...shop, removed: true } }, offerRemovals(run.boons), 'shop-remove', run.row * 100 + 62);
}
export function rerollShop(run: RogueRun, plan: GeneratedRun): RogueRun {
  const shop = requireShop(run);
  if (shop.rerolled) throw new Error('This shop is already rerolled.');
  const paid = pay(run, SHOP_REROLL_PRICE);
  const restocked = stockShop({ ...paid, row: run.row + 17 }, plan, shop.antechamber);
  return { ...paid, shop: { ...shop, cards: restocked.cards, pockets: restocked.pockets, rerolled: true } };
}
export function leaveShop(run: RogueRun, plan: GeneratedRun): RogueRun {
  const shop = requireShop(run);
  if (shop.antechamber) return { ...run, phase: 'map', shop: null, toast: null };
  return advance(run, plan);
}

// ——— Events ———

export function eventOptionAvailable(run: RogueRun, optionId: string): boolean {
  if (!run.event) return false;
  const option = eventById(run.event.id).options.find((entry) => entry.id === optionId);
  if (!option) return false;
  if (option.coins && run.coins < option.coins) return false;
  if (option.lives && run.lives <= option.lives) return false;
  if (option.maxLives && run.maxLives <= option.maxLives + 1) return false;
  if (option.needsBoons && !run.boons.length) return false;
  if (option.needsUpgradable && !upgradable(run)) return false;
  return true;
}

export function chooseEventOption(run: RogueRun, plan: GeneratedRun, optionId: string): RogueRun {
  if (run.phase !== 'event' || !run.event) throw new Error('There is no event here.');
  if (run.event.outcome !== null) throw new Error('This event is already settled.');
  const event = eventById(run.event.id);
  const option = event.options.find((entry) => entry.id === optionId);
  if (!option) throw new Error('Unknown event choice.');
  if (!eventOptionAvailable(run, optionId)) throw new Error('You cannot afford that choice.');
  let next: RogueRun = {
    ...run,
    coins: run.coins - (option.coins ?? 0),
    coinsSpent: run.coinsSpent + (option.coins ?? 0),
    lives: run.lives - (option.lives ?? 0),
    maxLives: run.maxLives - (option.maxLives ?? 0),
  };
  next.lives = Math.min(next.lives, next.maxLives);
  const key = run.row * 100 + 40 + (run.lane ?? 0);
  const settle = (outcome: string, extra: Partial<RogueRun> = {}): RogueRun => ({ ...next, ...extra, event: { id: event.id, outcome } });
  const pend = (entry: Omit<PendingFight, 'source'>): PendingFight[] => [...next.pending, { source: event.id, ...entry }];
  switch (`${event.id}:${optionId}`) {
    case 'charon-well:toss': case 'merchant:supplies': {
      next = grantConsumable(next, offerConsumable(plan.seed, key));
      return settle(next.toast ?? 'nothing');
    }
    case 'charon-well:dive': return settle('coins:160', { coins: next.coins + 160 });
    case 'chaos-gate:enter':
      return boonOffer({ ...next, event: { id: event.id, outcome: 'offer' } }, plan, 'event', key, { patron: null, pool: ['chaos'], minRarity: 'rare' });
    case 'fountain:drink': {
      const full = next.lives >= next.maxLives;
      const maxLives = full ? Math.min(MAX_LIVES_CAP, next.maxLives + 1) : next.maxLives;
      return settle(full ? 'heart' : 'life', { maxLives, lives: Math.min(maxLives, next.lives + 1) });
    }
    case 'fountain:bathe':
      return withOffers({ ...next, event: { id: event.id, outcome: 'offer' } }, offerPoms(plan.seed, key, next.boons, 1), 'event', key);
    case 'trophy:take':
      return settle('coins:160', { coins: next.coins + 160, pending: pend({ fights: 1, levelShift: 1, affixes: ['enraged'], mirror: false, rewardBump: false, scoreBonus: 0 }) });
    case 'blood-altar:offer':
      return boonOffer({ ...next, event: { id: event.id, outcome: 'offer' } }, plan, 'event', key, { patron: null, minRarity: 'epic' });
    case 'hat:wear': {
      const [card] = offerBoons({ seed: plan.seed, key, owned: next.boons, patron: randomDoorPatron(plan.seed, key), luck: next.luck, count: 1 });
      if (!card) return settle('nothing');
      next = withBoons(next, takeCard(next.boons, card));
      return settle(`boon:${card.id}`);
    }
    case 'hat:sell': return settle('coins:90', { coins: next.coins + 90 });
    case 'sparring:meditate':
      return withOffers({ ...next, event: { id: event.id, outcome: 'offer' } }, offerRemovals(next.boons), 'event', key);
    case 'sparring:drill':
      return withOffers({ ...next, event: { id: event.id, outcome: 'offer' } }, offerPoms(plan.seed, key, next.boons, 2), 'event', key);
    case 'storm:embrace':
      return boonOffer({ ...next, event: { id: event.id, outcome: 'offer' }, pending: pend({ fights: 2, levelShift: 1, affixes: ['stormborn'], mirror: false, rewardBump: false, scoreBonus: 0 }) }, plan, 'event', key, { patron: null, minRarity: 'rare' });
    case 'storm:shelter':
      next = grantConsumable(next, 'storm-jar');
      return settle(next.toast ?? 'nothing');
    case 'merchant:mystery':
      return boonOffer({ ...next, event: { id: event.id, outcome: 'offer' } }, plan, 'event', key, { patron: null, minRarity: 'rare' });
    case 'echo:face':
      return settle('echo', { pending: pend({ fights: 1, levelShift: 0, affixes: [], mirror: true, rewardBump: true, scoreBonus: 200 }) });
    default:
      if (optionId === 'leave' || optionId === 'shelter') return settle('leave');
      throw new Error('Unknown event choice.');
  }
}

/** Continue past a settled event. */
export function leaveEvent(run: RogueRun, plan: GeneratedRun): RogueRun {
  if (run.phase !== 'event' || !run.event) throw new Error('There is no event here.');
  if (run.event.outcome === null) throw new Error('Choose an option first.');
  return advance(run, plan);
}

// ——— Best score (localStorage-only) ———

const BEST_KEY = 'smash-roguelike-best';
export interface RogueBest {
  score: number;
  seedLabel: string;
  cleared: number;
  length: number;
  fighter: FighterKind;
  heat: RogueHeat;
}
export function loadBest(): RogueBest | null {
  try {
    const raw = globalThis.localStorage?.getItem(BEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RogueBest;
    if (!Number.isFinite(parsed.score) || !Number.isInteger(parsed.cleared)) return null;
    return { ...parsed, heat: isHeat(parsed.heat) ? parsed.heat : 0 };
  } catch {
    return null;
  }
}
export function recordBest(run: RogueRun): RogueBest | null {
  const entry: RogueBest = { score: run.score, seedLabel: run.seedLabel, cleared: run.cleared, length: run.length, fighter: run.playerFighter, heat: run.heat };
  try {
    const previous = loadBest();
    if (previous && previous.score >= entry.score) return previous;
    globalThis.localStorage?.setItem(BEST_KEY, JSON.stringify(entry));
    return entry;
  } catch {
    return null;
  }
}
