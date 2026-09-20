/** Rift Descent meta progression: the Mirror of the Rift (Hades Mirror of
 * Night) bought with shards earned by every run, plus the Slay the Spire-style
 * starting blessings offered before the first room. Stored in localStorage;
 * signed-in players also mirror it to their cloud save through
 * web/src/account/cloud-save.ts, which listens with `onRogueSaved`.
 */
import { createRng } from './seed.ts';
import { DOOR_PATRONS } from './patrons.ts';
import {
  ASPECTS, aspectById, emptyStats, masteryRank, masteryXpForRun, MAX_RELIC_SLOTS, mergeStats, relicById, relicLevel, RELICS,
  relicXpForRun, type AspectId, type LifetimeStats, type RelicId, type RunSummary,
} from './unlocks.ts';

export type MirrorId = 'resilience' | 'defiance' | 'greed' | 'authority' | 'pockets' | 'favor' | 'skin' | 'satchel';

export interface MirrorDef {
  id: MirrorId;
  icon: string;
  name: string;
  /** Per-rank effect line; `{n}` is the total at that rank. */
  detail: string;
  /** Shard price of each rank (length = max rank). */
  costs: readonly number[];
}

export const MIRROR: readonly MirrorDef[] = Object.freeze([
  { id: 'resilience', icon: '❤', name: 'Resilience', detail: '+{n} starting run life', costs: [40, 120] },
  { id: 'defiance', icon: '✝', name: 'Death Defiance', detail: '{n} run-wide Last Stand (a KO that keeps its stock)', costs: [60, 180] },
  { id: 'greed', icon: '🪙', name: 'Golden Touch', detail: '+{n} starting coins', costs: [20, 45, 90] },
  { id: 'authority', icon: '🎲', name: 'Fated Authority', detail: '+{n} boon rerolls per run', costs: [30, 70, 140] },
  { id: 'pockets', icon: '🎒', name: 'Deep Pockets', detail: '+{n} pocket slot', costs: [80] },
  { id: 'favor', icon: '✨', name: "Patron's Favor", detail: '+{n}% chance for RARE+ and EPIC boons', costs: [50, 110, 200] },
  { id: 'skin', icon: '🪨', name: 'Thick Skin', detail: '−{n}% damage taken', costs: [35, 90] },
  { id: 'satchel', icon: '🧳', name: 'Relic Satchel', detail: '+{n} relic slot in your loadout', costs: [90, 220] },
]);

export interface ChampionRecord {
  xp: number;
  runs: number;
  wins: number;
  /** Last aspect equipped with this champion. */
  aspect: AspectId;
}

export interface RogueMeta {
  shards: number;
  ranks: Record<MirrorId, number>;
  runs: number;
  wins: number;
  /** Highest heat with a completed descent (−1 = none yet). */
  bestHeatWin: number;
  /** 🗝 Rift Keys: earned from bosses and wins, spent to unlock relics early. */
  keys: number;
  /** Unlocked relics (starters included) and their floors-cleared XP. */
  unlocked: RelicId[];
  relicXp: Partial<Record<RelicId, number>>;
  /** Last equipped relics, restored on the next setup screen. */
  loadout: RelicId[];
  champions: Record<string, ChampionRecord>;
  stats: LifetimeStats;
}

export interface MetaBonuses {
  lives: number;
  defiances: number;
  coins: number;
  rerolls: number;
  pockets: number;
  luck: number;
  takenMul: number;
}

const META_KEY = 'smash-roguelike-meta';
const emptyRanks = (): Record<MirrorId, number> => ({ resilience: 0, defiance: 0, greed: 0, authority: 0, pockets: 0, favor: 0, skin: 0, satchel: 0 });
const STARTER_RELICS = (): RelicId[] => RELICS.filter((relic) => relic.starter).map((relic) => relic.id);

export function emptyMeta(): RogueMeta {
  return {
    shards: 0, ranks: emptyRanks(), runs: 0, wins: 0, bestHeatWin: -1,
    keys: 0, unlocked: STARTER_RELICS(), relicXp: {}, loadout: [], champions: {}, stats: emptyStats(),
  };
}

export function mirrorById(id: string): MirrorDef {
  const found = MIRROR.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown mirror talent: ${id}`);
  return found;
}

/** Effect total at a rank, used by the `{n}` placeholder. */
export function mirrorTotal(id: MirrorId, rank: number): number {
  switch (id) {
    case 'resilience': case 'defiance': case 'authority': case 'pockets': case 'satchel': return rank;
    case 'greed': return rank * 50;
    case 'favor': return rank * 10;
    case 'skin': return rank * 5;
    default: return rank;
  }
}

export function metaBonuses(meta: RogueMeta): MetaBonuses {
  const r = meta.ranks;
  return {
    lives: r.resilience,
    defiances: r.defiance,
    coins: mirrorTotal('greed', r.greed),
    rerolls: r.authority,
    pockets: r.pockets,
    luck: r.favor * 0.1,
    takenMul: 1 - mirrorTotal('skin', r.skin) / 100,
  };
}

export const NO_META_BONUSES: MetaBonuses = Object.freeze({ lives: 0, defiances: 0, coins: 0, rerolls: 0, pockets: 0, luck: 0, takenMul: 1 });

export function loadMeta(): RogueMeta {
  try {
    const raw = globalThis.localStorage?.getItem(META_KEY);
    if (!raw) return emptyMeta();
    const parsed = JSON.parse(raw) as Partial<RogueMeta>;
    const meta = emptyMeta();
    meta.shards = Number.isFinite(parsed.shards) ? Math.max(0, Math.floor(parsed.shards!)) : 0;
    meta.runs = Number.isInteger(parsed.runs) ? parsed.runs! : 0;
    meta.wins = Number.isInteger(parsed.wins) ? parsed.wins! : 0;
    meta.bestHeatWin = Number.isInteger(parsed.bestHeatWin) ? parsed.bestHeatWin! : -1;
    for (const def of MIRROR) {
      const rank = parsed.ranks?.[def.id];
      meta.ranks[def.id] = Number.isInteger(rank) ? Math.max(0, Math.min(def.costs.length, rank!)) : 0;
    }
    // Unlock layer (absent in saves from before relics existed).
    meta.keys = Number.isFinite(parsed.keys) ? Math.max(0, Math.floor(parsed.keys!)) : 0;
    const known = (id: unknown): id is RelicId => typeof id === 'string' && RELICS.some((relic) => relic.id === id);
    meta.unlocked = [...new Set([...STARTER_RELICS(), ...(Array.isArray(parsed.unlocked) ? parsed.unlocked.filter(known) : [])])];
    for (const [id, xp] of Object.entries(parsed.relicXp ?? {})) if (known(id) && Number.isFinite(xp)) meta.relicXp[id] = Math.max(0, Math.floor(xp as number));
    meta.loadout = Array.isArray(parsed.loadout) ? parsed.loadout.filter((id) => known(id) && meta.unlocked.includes(id)).slice(0, MAX_RELIC_SLOTS) : [];
    for (const [fighter, record] of Object.entries(parsed.champions ?? {})) {
      if (!record || typeof record !== 'object') continue;
      const aspect = ASPECTS.some((entry) => entry.id === record.aspect) ? record.aspect : 'vanguard';
      meta.champions[fighter] = { xp: Math.max(0, Math.floor(Number(record.xp) || 0)), runs: Math.max(0, Math.floor(Number(record.runs) || 0)), wins: Math.max(0, Math.floor(Number(record.wins) || 0)), aspect };
    }
    const stats = emptyStats();
    for (const key of Object.keys(stats) as Array<keyof LifetimeStats>) {
      const value = parsed.stats?.[key];
      if (Number.isFinite(value)) stats[key] = value as number;
    }
    // Older saves already counted runs/wins at the top level.
    stats.runs = Math.max(stats.runs, meta.runs);
    stats.wins = Math.max(stats.wins, meta.wins);
    stats.bestHeatWin = Math.max(stats.bestHeatWin, meta.bestHeatWin);
    meta.stats = stats;
    return meta;
  } catch {
    return emptyMeta();
  }
}

export function saveMeta(meta: RogueMeta): void {
  try {
    globalThis.localStorage?.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* private mode: session-only progress */
  }
  notifyRogueSaved();
}

export const ROGUE_META_KEY = META_KEY;
const saveListeners = new Set<() => void>();
/** Fires after any Rift Descent progress write (meta, suspended run). */
export function onRogueSaved(listener: () => void): () => void {
  saveListeners.add(listener);
  return () => { saveListeners.delete(listener); };
}
export function notifyRogueSaved(): void {
  for (const listener of saveListeners) listener();
}

export function nextRankCost(meta: RogueMeta, id: MirrorId): number | null {
  const def = mirrorById(id);
  const rank = meta.ranks[id];
  return rank >= def.costs.length ? null : def.costs[rank]!;
}

export function buyRank(meta: RogueMeta, id: MirrorId): RogueMeta {
  const cost = nextRankCost(meta, id);
  if (cost === null) throw new Error('That talent is maxed.');
  if (meta.shards < cost) throw new Error('Not enough shards.');
  return { ...meta, shards: meta.shards - cost, ranks: { ...meta.ranks, [id]: meta.ranks[id] + 1 } };
}

/** Full refund (Hades lets you re-spec the mirror freely). */
export function refundMirror(meta: RogueMeta): RogueMeta {
  let shards = meta.shards;
  for (const def of MIRROR) {
    for (let rank = 0; rank < meta.ranks[def.id]; rank++) shards += def.costs[rank]!;
  }
  return { ...meta, shards, ranks: emptyRanks(), loadout: meta.loadout.slice(0, 1) };
}

/** Shards for a finished run: every run pays, deeper and hotter runs pay more. */
export function shardsForRun(summary: { cleared: number; bossesDown: number; victory: boolean; heat: number }): number {
  // Each act boss pays more than the last (15, 30, 45, 60, 75): deep runs are the real payday.
  const bosses = (summary.bossesDown * (summary.bossesDown + 1)) / 2;
  const base = summary.cleared * 3 + bosses * 15 + (summary.victory ? 250 : 0);
  return Math.round(base * (1 + 0.25 * summary.heat));
}

/** Keys a run pays: the n-th boss pays n keys (1+2+3+4+5), a completed descent 10 more. */
export function keysForRun(summary: Pick<RunSummary, 'bossesDown' | 'victory'>): number {
  return (summary.bossesDown * (summary.bossesDown + 1)) / 2 + (summary.victory ? 10 : 0);
}

export interface RunReport {
  meta: RogueMeta;
  earned: number;
  keys: number;
  mastery: { fighter: string; xp: number; before: number; after: number; rankBefore: number; rankAfter: number };
  relics: Array<{ id: RelicId; xp: number; levelBefore: number; levelAfter: number }>;
  /** Relics unlocked by lifetime achievements this run. */
  unlocked: RelicId[];
}

/** Fold a finished run into the meta: shards, keys, champion mastery, relic XP,
 * lifetime stats and achievement unlocks. Pure; the caller saves. */
export function recordRunInMeta(meta: RogueMeta, summary: RunSummary): RunReport {
  const earned = shardsForRun(summary);
  const keys = keysForRun(summary);
  const stats = mergeStats(meta.stats, summary);
  const champion = meta.champions[summary.fighter] ?? { xp: 0, runs: 0, wins: 0, aspect: 'vanguard' as AspectId };
  const masteryXp = masteryXpForRun(summary);
  const nextChampion: ChampionRecord = { ...champion, xp: champion.xp + masteryXp, runs: champion.runs + 1, wins: champion.wins + (summary.victory ? 1 : 0) };
  const relicXp = { ...meta.relicXp };
  const relicGain = relicXpForRun(summary);
  const relics = summary.relics.map((id) => {
    const before = relicXp[id] ?? 0;
    relicXp[id] = before + relicGain;
    return { id, xp: relicGain, levelBefore: relicLevel(before), levelAfter: relicLevel(before + relicGain) };
  });
  const unlocked = RELICS.filter((relic) => !meta.unlocked.includes(relic.id) && relic.condition?.met(stats)).map((relic) => relic.id);
  return {
    earned,
    keys,
    relics,
    unlocked,
    mastery: { fighter: summary.fighter, xp: masteryXp, before: champion.xp, after: nextChampion.xp, rankBefore: masteryRank(champion.xp), rankAfter: masteryRank(nextChampion.xp) },
    meta: {
      ...meta,
      shards: meta.shards + earned,
      keys: meta.keys + keys,
      runs: meta.runs + 1,
      wins: meta.wins + (summary.victory ? 1 : 0),
      bestHeatWin: summary.victory ? Math.max(meta.bestHeatWin, summary.heat) : meta.bestHeatWin,
      unlocked: [...meta.unlocked, ...unlocked],
      relicXp,
      champions: { ...meta.champions, [summary.fighter]: nextChampion },
      stats,
    },
  };
}

// ——— Relic vault + loadout ———

export function relicSlots(meta: RogueMeta): number {
  return Math.min(MAX_RELIC_SLOTS, 1 + meta.ranks.satchel);
}
export function isRelicUnlocked(meta: RogueMeta, id: RelicId): boolean {
  return meta.unlocked.includes(id);
}
/** Spend keys to unlock a relic before its achievement. */
export function unlockRelicWithKeys(meta: RogueMeta, id: RelicId): RogueMeta {
  const relic = relicById(id);
  if (meta.unlocked.includes(id)) throw new Error('That relic is already yours.');
  if (meta.keys < relic.keyCost) throw new Error('Not enough Rift Keys.');
  return { ...meta, keys: meta.keys - relic.keyCost, unlocked: [...meta.unlocked, id] };
}
/** Toggle a relic in the saved loadout, respecting unlocks and slots. */
export function toggleLoadoutRelic(meta: RogueMeta, id: RelicId): RogueMeta {
  if (!meta.unlocked.includes(id)) throw new Error('That relic is still locked.');
  if (meta.loadout.includes(id)) return { ...meta, loadout: meta.loadout.filter((entry) => entry !== id) };
  if (meta.loadout.length >= relicSlots(meta)) throw new Error('Your relic slots are full.');
  return { ...meta, loadout: [...meta.loadout, id] };
}
export function championRecord(meta: RogueMeta, fighter: string): ChampionRecord {
  return meta.champions[fighter] ?? { xp: 0, runs: 0, wins: 0, aspect: 'vanguard' };
}
/** Choose a champion's aspect (must be unlocked by mastery rank). */
export function chooseAspect(meta: RogueMeta, fighter: string, id: AspectId): RogueMeta {
  const record = championRecord(meta, fighter);
  if (aspectById(id).rank > masteryRank(record.xp)) throw new Error('That aspect needs a higher mastery rank.');
  return { ...meta, champions: { ...meta.champions, [fighter]: { ...record, aspect: id } } };
}

// ——— Starting blessings (Slay the Spire's Neow) ———

export type BlessingId = 'coin-purse' | 'lucky-tooth' | 'patron-sigil' | 'pocket-kit' | 'second-heart' | 'reroll-dice' | 'chaos-seed' | 'sharpened';

export interface BlessingDef {
  id: BlessingId;
  icon: string;
  name: string;
  detail: string;
}

export const BLESSINGS: readonly BlessingDef[] = Object.freeze([
  { id: 'coin-purse', icon: '👛', name: 'Coin Purse', detail: 'Start with +120 coins.' },
  { id: 'lucky-tooth', icon: '🦷', name: 'Lucky Tooth', detail: '+1 run-wide Last Stand: one KO keeps its stock.' },
  { id: 'patron-sigil', icon: '📜', name: 'Patron Sigil', detail: 'Start with a random RARE+ boon.' },
  { id: 'pocket-kit', icon: '🎒', name: 'Pocket Kit', detail: 'Start with 2 random pocket items.' },
  { id: 'second-heart', icon: '💗', name: 'Second Heart', detail: '+1 max run life and +1 run life.' },
  { id: 'reroll-dice', icon: '🎲', name: 'Loaded Dice', detail: '+2 boon rerolls.' },
  { id: 'chaos-seed', icon: '🌀', name: 'Chaos Seed', detail: 'Start with a random Chaos pact at EPIC rarity.' },
  { id: 'sharpened', icon: '🗡', name: 'Sharpened Edge', detail: 'Start with an EPIC Fury, Deadly Aim or Riptide.' },
]);

export function blessingById(id: string): BlessingDef {
  const found = BLESSINGS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown blessing: ${id}`);
  return found;
}

/** Three distinct blessings per seed. */
export function offerBlessings(seed: number): BlessingId[] {
  const rng = createRng((seed ^ 0x6e656f77) >>> 0);
  return [...BLESSINGS].sort(() => rng() - 0.5).slice(0, 3).map((entry) => entry.id);
}

/** Deterministic door patron pick for blessing boons. */
export function blessingPatron(seed: number): (typeof DOOR_PATRONS)[number] {
  const rng = createRng((seed ^ 0x5e1f) >>> 0);
  return DOOR_PATRONS[Math.floor(rng() * DOOR_PATRONS.length)]!;
}
