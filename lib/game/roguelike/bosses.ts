/** Rift Descent act bosses and boss spoils. Pure data + seeded picks.
 *
 * The descent is 50 floors split into five acts of ten; the tenth floor of
 * every act is a boss built from a tier below. Bosses are original fighters
 * run through neutral `RogueMods` boosts (damage, toughness, launch
 * resistance, speed, last stands, crits) plus extra stocks and foe gifts —
 * the same prototype lanes as every other rogue effect, never an edit to
 * original fighter data. Giga Bowser (`Gk`) needs the ACE 2.0 extension
 * disc; without it the controller swaps in its `fallback` (a boosted Bowser).
 *
 * Beating a boss pays spoils: a coin bounty, a full heal, and a pick of one
 * run-long boss treasure (Slay the Spire boss relics).
 */
import { createRng } from './seed.ts';
import type { RogueMods } from './sim.ts';
import type { BoonState } from './boons.ts';
import type { FighterKind } from '../data.ts';

export type BossId = 'warlord' | 'twin-terrors' | 'titan' | 'giga-koopa' | 'rift-sovereign';

export interface BossSlot {
  /** Preferred fighters (seeded pick); `fallback` replaces unavailable kinds. */
  pool: readonly FighterKind[];
  fallback?: FighterKind;
  stocks: number;
  /** Extra "Giga" flavor for this slot (HUD label only). */
  giga?: boolean;
}

export interface BossDef {
  id: BossId;
  tier: number;
  icon: string;
  name: string;
  title: string;
  slots: readonly BossSlot[];
  /** Added CPU levels on top of the act curve (clamped to 9). */
  levelBonus: number;
  affixCount: number;
  /** Multiplicative/additive boosts over the floor's foe mods. */
  boost: Partial<Pick<RogueMods, 'damageDealtMul' | 'damageTakenMul' | 'knockbackTakenMul' | 'speedMul' | 'critChance' | 'lastStand' | 'knockbackMul'>>;
  /** Coin bounty for the kill. */
  bounty: number;
}

export const BOSSES: readonly BossDef[] = Object.freeze([
  { id: 'warlord', tier: 0, icon: '⚔️', name: 'The Warlord', title: 'Keeper of the First Gate', levelBonus: 2, affixCount: 2, bounty: 75,
    slots: [{ pool: ['Gn', 'Dk', 'Kp', 'Ca'], stocks: 3 }],
    boost: { damageDealtMul: 1.25, damageTakenMul: 0.85, knockbackTakenMul: 0.8, speedMul: 1.05 } },
  { id: 'twin-terrors', tier: 1, icon: '👥', name: 'Twin Terrors', title: 'Two Blades, One Will', levelBonus: 1, affixCount: 2, bounty: 150,
    slots: [{ pool: ['Fx', 'Fc', 'Ms', 'Sk'], stocks: 3 }, { pool: ['Ca', 'Mt', 'Lk', 'Zd'], stocks: 3 }],
    boost: { damageDealtMul: 1.3, damageTakenMul: 0.8, knockbackTakenMul: 0.8, speedMul: 1.08 } },
  { id: 'titan', tier: 2, icon: '🗿', name: 'The Titan', title: 'Heart of the Rift', levelBonus: 3, affixCount: 3, bounty: 225,
    slots: [{ pool: ['Mt', 'Gn', 'Dk', 'Kp'], stocks: 4 }],
    boost: { damageDealtMul: 1.5, damageTakenMul: 0.7, knockbackTakenMul: 0.6, speedMul: 1.1, lastStand: 1 } },
  { id: 'giga-koopa', tier: 3, icon: '🐲', name: 'GIGA BOWSER', title: 'King of the Abyss', levelBonus: 9, affixCount: 3, bounty: 300,
    slots: [{ pool: ['Gk'], fallback: 'Kp', stocks: 4, giga: true }],
    boost: { damageDealtMul: 1.6, damageTakenMul: 0.6, knockbackTakenMul: 0.5, knockbackMul: 1.15, critChance: 0.1, lastStand: 1 } },
  { id: 'rift-sovereign', tier: 4, icon: '👑', name: 'Rift Sovereign', title: 'The End of the Descent', levelBonus: 9, affixCount: 4, bounty: 400,
    slots: [{ pool: ['Gk'], fallback: 'Kp', stocks: 5, giga: true }, { pool: ['Gn', 'Mt', 'Ms'], stocks: 3 }],
    boost: { damageDealtMul: 1.9, damageTakenMul: 0.5, knockbackTakenMul: 0.45, knockbackMul: 1.2, speedMul: 1.1, critChance: 0.12, lastStand: 2 } },
]);

export function bossById(id: string): BossDef {
  const found = BOSSES.find((boss) => boss.id === id);
  if (!found) throw new Error(`Unknown boss: ${id}`);
  return found;
}

/** Boss for an act index (0-based); acts past the table reuse the last tier. */
export function bossForAct(act: number): BossDef {
  return BOSSES[Math.max(0, Math.min(BOSSES.length - 1, act))]!;
}

/** Seeded fighter per slot, never the player's own fighter and never repeated. */
export function pickBossFighters(boss: BossDef, seed: number, playerFighter: FighterKind): FighterKind[] {
  const rng = createRng((seed ^ Math.imul(boss.tier + 3, 0x7f4a7c15)) >>> 0);
  const used = new Set<FighterKind>();
  return boss.slots.map((slot) => {
    const options = slot.pool.filter((kind) => kind !== playerFighter && !used.has(kind));
    const pick = options.length ? options[Math.floor(rng() * options.length)]! : slot.fallback ?? slot.pool[0]!;
    used.add(pick);
    return pick;
  });
}

/** Apply a boss boost over already-built foe mods (returns a new object). */
export function boostMods(mods: RogueMods, boost: BossDef['boost']): RogueMods {
  return {
    ...mods,
    damageDealtMul: mods.damageDealtMul * (boost.damageDealtMul ?? 1),
    damageTakenMul: mods.damageTakenMul * (boost.damageTakenMul ?? 1),
    knockbackTakenMul: mods.knockbackTakenMul * (boost.knockbackTakenMul ?? 1),
    knockbackMul: mods.knockbackMul * (boost.knockbackMul ?? 1),
    speedMul: Math.min(1.5, mods.speedMul * (boost.speedMul ?? 1)),
    critChance: Math.min(0.5, mods.critChance + (boost.critChance ?? 0)),
    lastStand: mods.lastStand + (boost.lastStand ?? 0),
  };
}

// ——— Boss spoils: run-long treasures ———

export type TreasureId = 'titan-heart' | 'war-crown' | 'patron-blessing' | 'executioner-edge' | 'aegis-core' | 'golden-idol' | 'phoenix-crown' | 'storm-eye' | 'rift-compass';

export interface TreasureDef {
  id: TreasureId;
  icon: string;
  name: string;
  detail: string;
}

export const TREASURES: readonly TreasureDef[] = Object.freeze([
  { id: 'titan-heart', icon: '💗', name: 'Titan Heart', detail: '+2 max run lives and restore every life.' },
  { id: 'war-crown', icon: '👑', name: 'War Crown', detail: '+1 match stock on every floor.' },
  { id: 'patron-blessing', icon: '✨', name: 'Patron Blessing', detail: 'Every boon you carry gains +1 level.' },
  { id: 'executioner-edge', icon: '🗡️', name: "Executioner's Edge", detail: '+30% damage and +15% launch power.' },
  { id: 'aegis-core', icon: '🛡️', name: 'Aegis Core', detail: '−25% damage taken and −20% launch taken.' },
  { id: 'golden-idol', icon: '🏆', name: 'Golden Idol', detail: '+50% coins from floors and KOs; shop prices −25%.' },
  { id: 'phoenix-crown', icon: '🔥', name: 'Phoenix Crown', detail: '+1 Last Stand on every floor.' },
  { id: 'storm-eye', icon: '🌩️', name: 'Tempest Eye', detail: '+15% crit chance, crits deal +50% of the hit, your hits arc 4%.' },
  { id: 'rift-compass', icon: '🧭', name: 'Rift Compass', detail: '+3 boon rerolls and +20% RARE+ and EPIC boon odds.' },
]);

export function treasureById(id: string): TreasureDef {
  const found = TREASURES.find((treasure) => treasure.id === id);
  if (!found) throw new Error(`Unknown treasure: ${id}`);
  return found;
}

/** Three distinct treasures the run does not already own. */
export function offerTreasures(seed: number, act: number, owned: readonly TreasureId[]): TreasureId[] {
  const rng = createRng((seed ^ Math.imul(act + 41, 0x1b873593)) >>> 0);
  const pool = TREASURES.map((treasure) => treasure.id).filter((id) => !owned.includes(id));
  return [...pool].sort(() => rng() - 0.5).slice(0, 3);
}

/** Build-lane effects of owned treasures (folded in before the boon caps). */
export function applyTreasureBuild(state: BoonState, treasures: readonly TreasureId[]): void {
  const p = state.player;
  for (const id of treasures) {
    switch (id) {
      case 'executioner-edge': p.damageDealtMul *= 1.3; p.knockbackMul *= 1.15; break;
      case 'aegis-core': p.damageTakenMul *= 0.75; p.knockbackTakenMul *= 0.8; break;
      case 'phoenix-crown': p.lastStand += 1; break;
      case 'storm-eye': p.critChance += 0.15; p.critMul += 0.5; p.chainDamage += 4; break;
      default: break; // Run-state treasures (lives, stocks, levels, coins, rerolls).
    }
  }
}
/** Extra match stocks from treasures (applied outside the boon stock cap). */
export function treasureStocks(treasures: readonly TreasureId[]): number {
  return treasures.includes('war-crown') ? 1 : 0;
}
