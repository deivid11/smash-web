/** Rift Descent foe affixes: prototype-only boss/elite powers.
 * Pure data + seeded picks. No simulation, no original code paths.
 *
 * Affixes reuse the same neutral-by-default `RogueMods` lanes the player boons
 * use (`lib/game/roguelike/sim.ts`): damage and launch multipliers couple
 * through the original hit pipeline like natively stronger/weaker moves, venom
 * and arcs are percent-only and never KO by themselves, lifesteal heals on
 * rival KOs, last stands refund a stock. Versus play stays neutral.
 */
import { createRng } from './seed.ts';
import { NEUTRAL_ROGUE_MODS, type RogueMods } from './sim.ts';

type AffixFloorKind = 'battle' | 'elite' | 'boss';

export type FoeAffixId = 'vampiric' | 'venomous' | 'enraged' | 'swift' | 'bulwark' | 'infernal' | 'thorned' | 'titan' | 'deadeye' | 'stormborn' | 'undying';

export interface FoeAffix {
  id: FoeAffixId;
  label: string;
  icon: string;
  detail: string;
  /** Score bounty for beating this gift (prototype balancing). */
  scoreBonus: number;
}

export const FOE_AFFIXES: Readonly<Record<FoeAffixId, Omit<FoeAffix, 'id'>>> = Object.freeze({
  vampiric: { label: 'VAMPIRIC', icon: '🩸', detail: 'Rivals heal 6% whenever anyone is KO’d.', scoreBonus: 75 },
  venomous: { label: 'VENOMOUS', icon: '☠', detail: 'Rival hits poison you for 6s (+1% every 1.25s, never KOs).', scoreBonus: 75 },
  enraged: { label: 'ENRAGED', icon: '😡', detail: 'Rivals deal +25% damage.', scoreBonus: 75 },
  swift: { label: 'SWIFT', icon: '💨', detail: 'Rivals move 12% faster.', scoreBonus: 50 },
  bulwark: { label: 'BULWARK', icon: '🛡', detail: 'Rivals take −20% damage.', scoreBonus: 75 },
  infernal: { label: 'INFERNAL', icon: '👹', detail: 'Rivals deal +15% damage and poison for 4s.', scoreBonus: 125 },
  thorned: { label: 'THORNED', icon: '🌵', detail: 'Hitting rivals up close stings you for 2%.', scoreBonus: 75 },
  titan: { label: 'TITAN', icon: '🗿', detail: 'Rivals take −25% launch.', scoreBonus: 100 },
  deadeye: { label: 'DEADEYE', icon: '🎯', detail: 'Rival hits crit 12% of the time for double damage.', scoreBonus: 100 },
  stormborn: { label: 'STORMBORN', icon: '⚡', detail: 'Rival hits arc 3% into the nearest other fighter.', scoreBonus: 75 },
  undying: { label: 'UNDYING', icon: '✝', detail: 'Each rival shrugs off its first KO.', scoreBonus: 150 },
});

export function affixById(id: string): FoeAffix {
  const found = (FOE_AFFIXES as Record<string, Omit<FoeAffix, 'id'> | undefined>)[id];
  if (!found) throw new Error(`Unknown foe affix: ${id}`);
  return { id: id as FoeAffixId, ...found };
}

/** Combined sim-lane mods for a set of affixes (multiplicative muls, max venom, capped lifesteal). */
export function modsForAffixes(ids: readonly FoeAffixId[]): RogueMods {
  const mods: RogueMods = { ...NEUTRAL_ROGUE_MODS };
  for (const id of ids) {
    switch (id) {
      case 'vampiric': mods.lifesteal = Math.min(15, mods.lifesteal + 6); break;
      case 'venomous': mods.venomTicks = Math.max(mods.venomTicks, 6 * 60); break;
      case 'enraged': mods.damageDealtMul *= 1.25; break;
      case 'swift': mods.speedMul *= 1.12; break;
      case 'bulwark': mods.damageTakenMul *= 0.8; break;
      case 'infernal': mods.damageDealtMul *= 1.15; mods.venomTicks = Math.max(mods.venomTicks, 4 * 60); break;
      case 'thorned': mods.thorns += 2; break;
      case 'titan': mods.knockbackTakenMul *= 0.75; break;
      case 'deadeye': mods.critChance += 0.12; break;
      case 'stormborn': mods.chainDamage += 3; break;
      case 'undying': mods.lastStand = Math.max(mods.lastStand, 1); break;
      default: throw new Error(`Unknown foe affix: ${id as string}`);
    }
  }
  return mods;
}

/** Score bounty for a set of affixes (flat prototype bonus, heated later). */
export function scoreForAffixes(ids: readonly FoeAffixId[]): number {
  return ids.reduce((sum, id) => sum + affixById(id).scoreBonus, 0);
}

export const AFFIX_POOL: readonly FoeAffixId[] = ['vampiric', 'venomous', 'enraged', 'swift', 'bulwark', 'infernal', 'thorned', 'titan', 'deadeye', 'stormborn', 'undying'];
/** Crowds never roll `undying` (seven refunds would stall a horde floor). */
const CROWD_SAFE: readonly FoeAffixId[] = AFFIX_POOL.filter((id) => id !== 'undying');

/** Deterministic affix roll: elites carry 1 gift, bosses 2 (3 on the finale),
 * late battles sometimes grow fangs. Distinct picks, stable per seed+floor. */
export function rollAffixes(
  rng: () => number,
  kind: AffixFloorKind,
  index: number,
  length: number,
  heat: number,
  crowd = false,
  bossCount?: number,
): FoeAffixId[] {
  const take = (count: number): FoeAffixId[] => {
    const pool = [...(crowd ? CROWD_SAFE : AFFIX_POOL)].sort(() => rng() - 0.5);
    return pool.slice(0, count);
  };
  const depth = length <= 1 ? 1 : index / (length - 1);
  if (kind === 'boss') return take(bossCount ?? (index === length - 1 ? 3 : 2));
  if (kind === 'elite') return take(1 + (depth >= 0.5 ? 1 : 0) + (heat >= 4 ? 1 : 0));
  // Battle floors: gifts grow with depth — rare early, nearly certain in the last act.
  const chance = depth < 0.08 ? 0 : 0.05 + 0.9 * depth + 0.04 * heat;
  if (rng() >= chance) return [];
  return take(depth >= 0.6 && rng() < depth - 0.3 ? 2 : 1);
}

/** Deterministic helper for tests/UI previews (fresh stream per floor). */
export function affixesForFloor(seed: number, floorIndex: number, kind: AffixFloorKind, length: number, heat: number, crowd = false, salt = 0, bossCount?: number): FoeAffixId[] {
  const rng = createRng((seed ^ Math.imul(floorIndex + 11, 0x51ed2703) ^ Math.imul(salt + 1, 0x2545f491)) >>> 0);
  return rollAffixes(rng, kind, floorIndex, length, heat, crowd, bossCount);
}
