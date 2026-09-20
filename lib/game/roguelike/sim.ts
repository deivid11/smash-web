/** PROTOTYPE (roguelike): Rift Descent simulation lanes and hit hooks.
 *
 * `lib/game/match.ts` calls these from a handful of neutral-by-default sites
 * (hit scaling, post-hit triggers, per-frame hex ticks, KO refunds, stick
 * scaling, air-jump budget). Every lane defaults to a no-op value, so versus,
 * online and every other mode multiply by exactly 1 and never allocate a hex:
 * original damage, knockback and physics code paths stay untouched outside
 * Rift Descent. Nothing here is a claim about Melee mechanics.
 *
 * All state lives in plain snapshot-owned fighter fields (`rogue`, `hex`), and
 * every "random" roll hashes (frame, slots, attack serial), so rollback and
 * determinism rules are the same as for any other match data.
 */
import type { MatchEvent, MatchFighter } from '../match.ts';

export interface RogueMods {
  damageDealtMul: number; damageTakenMul: number; speedMul: number;
  /** Poison frames applied to victims on hit (0 = none). */
  venomTicks: number;
  /** Percent healed whenever a rival is KO'd (0 = none). */
  lifesteal: number;
  /** Launch power on your hits / launch taken on theirs (1 = neutral). */
  knockbackMul: number; knockbackTakenMul: number;
  /** Crit roll per landed hit (0..1) and the crit damage multiplier. */
  critChance: number; critMul: number;
  /** Extra crit chance while the attacker is airborne. */
  airCritChance: number;
  /** Percent zapped into the nearest other fighter on each hit (0 = none). */
  chainDamage: number; chainRange: number;
  /** Percent reflected into melee attackers (0 = none). */
  thorns: number;
  /** Fraction of dealt damage healed (0 = none). */
  leech: number;
  /** Damage bonus per 50% of your own damage, capped. */
  rage: number; rageCap: number;
  /** Damage / launch multipliers against victims at 100% or more. */
  executeMul: number; executeKnockbackMul: number;
  /** Damage multiplier against victims sitting at exactly 0%. */
  openerMul: number;
  /** Damage multiplier against poisoned (burning) victims. */
  burnBonusMul: number;
  /** Delayed burst: percent dealt one second after a hit (0 = none). */
  doomDamage: number;
  /** Jolt: victims deal `weakMul` damage for `weakTicks` frames. */
  weakTicks: number; weakMul: number;
  /** Undertow: victims' stick is scaled by `chillMul` for `chillTicks` frames. */
  chillTicks: number; chillMul: number;
  /** After being hit, the next landed hit within 2 s deals this multiplier. */
  retaliateMul: number;
  /** Percent dealt to every other fighter when you score a KO (0 = none). */
  koBlast: number;
  /** Stock refunds left this match (consumed on KO). */
  lastStand: number;
  /** Extra midair jumps on top of the fighter's original budget. */
  extraJumps: number;
  /** Duo triggers: crits apply doom / crits always chain. */
  critDoom: boolean; critChain: boolean;
  /** The run's champion: the match ends the moment this fighter is out of stocks. */
  essential: boolean;
  /** Allied side on team floors (2v1, 3v1…): fighters sharing a non-zero team never hit each other. 0 = no team. */
  team: number;
}

export const NEUTRAL_ROGUE_MODS: RogueMods = Object.freeze({
  damageDealtMul: 1, damageTakenMul: 1, speedMul: 1, venomTicks: 0, lifesteal: 0,
  knockbackMul: 1, knockbackTakenMul: 1, critChance: 0, critMul: 2, airCritChance: 0,
  chainDamage: 0, chainRange: 32, thorns: 0, leech: 0, rage: 0, rageCap: 0,
  executeMul: 1, executeKnockbackMul: 1, openerMul: 1, burnBonusMul: 1, doomDamage: 0,
  weakTicks: 0, weakMul: 1, chillTicks: 0, chillMul: 1, retaliateMul: 1, koBlast: 0,
  lastStand: 0, extraJumps: 0, critDoom: false, critChain: false, essential: false, team: 0,
});

export interface RoguePoison { ticks: number; amount: number }
/** Prototype venom cadence: 1% every 75 frames (1.25 s). */
export const POISON_TICK_EVERY = 75;

/** Per-fighter status inflicted by rogue lanes. Null until first needed. */
export interface RogueHex {
  doomTicks: number; doomAmount: number; doomBy: number;
  weakTicks: number; weakMul: number;
  chillTicks: number; chillMul: number;
  retaliateTicks: number;
}

/** Presentation-only rogue triggers for HUD popups (never read by the sim). */
export type RogueFx = 'crit' | 'chain' | 'doom' | 'defy' | 'thorns' | 'clap' | 'jolt';

export const DOOM_DELAY = 60;
export const RETALIATE_WINDOW = 120;
const MAX_PERCENT = 999;
const f32 = Math.fround;

const emptyHex = (): RogueHex => ({ doomTicks: 0, doomAmount: 0, doomBy: -1, weakTicks: 0, weakMul: 1, chillTicks: 0, chillMul: 1, retaliateTicks: 0 });
const alive = (fighter: MatchFighter): boolean => fighter.state !== 'ko' && fighter.state !== 'respawn';

/** Deterministic [0, 1) roll from frame + slots + attack serial (no RNG stream touched). */
export function rogueRoll(frame: number, attacker: number, victim: number, serial: number): number {
  let hash = Math.imul((frame ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(attacker + 1, 0xc2b2ae35) ^ Math.imul(victim + 7, 0x27d4eb2f) ^ Math.imul(serial + 13, 0x165667b1);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 12;
  return (hash >>> 0) / 4294967296;
}

export interface RogueHitScale { damageMul: number; knockbackMul: number; crit: boolean }

/** Damage/launch multipliers for one landed hit. Neutral fighters return exactly 1/1. */
export function rogueHitScale(frame: number, attacker: MatchFighter | null, victim: MatchFighter): RogueHitScale {
  const a = attacker?.rogue;
  const v = victim.rogue;
  let damageMul = (a?.damageDealtMul ?? 1) * (v?.damageTakenMul ?? 1);
  let knockbackMul = (a?.knockbackMul ?? 1) * (v?.knockbackTakenMul ?? 1);
  let crit = false;
  if (attacker && a) {
    if (attacker.hex && attacker.hex.weakTicks > 0) damageMul *= attacker.hex.weakMul;
    if (attacker.hex && attacker.hex.retaliateTicks > 0 && a.retaliateMul !== 1) damageMul *= a.retaliateMul;
    if (a.rage > 0) damageMul *= 1 + Math.min(a.rageCap, a.rage * (attacker.percent / 50));
    if (victim.percent >= 100) { damageMul *= a.executeMul; knockbackMul *= a.executeKnockbackMul; }
    if (victim.percent === 0) damageMul *= a.openerMul;
    if (victim.poison) damageMul *= a.burnBonusMul;
    const chance = a.critChance + (attacker.grounded ? 0 : a.airCritChance);
    if (chance > 0 && rogueRoll(frame, attacker.slot, victim.slot, attacker.attackSerial) < chance) {
      crit = true;
      damageMul *= a.critMul;
    }
  }
  return { damageMul, knockbackMul, crit };
}

function zap(target: MatchFighter, amount: number, events: MatchEvent[], fx: RogueFx): void {
  if (!(amount > 0)) return;
  target.percent = Math.min(MAX_PERCENT, f32(target.percent + amount));
  // A damage-only spark: hit VFX/sound/shake presentation, never a launch.
  events.push({ type: 'hit', player: target.slot, x: target.x, y: target.y + 8, damage: amount });
  events.push({ type: 'rogue', player: target.slot, x: target.x, y: target.y, damage: amount, rogue: fx });
}

/** Post-hit triggers: leech, thorns, chain sparks, doom marks, jolt, undertow, retaliation. */
export function rogueAfterHit(
  fighters: readonly MatchFighter[], events: MatchEvent[], attacker: MatchFighter | null, victim: MatchFighter,
  damage: number, projectile: boolean, crit: boolean,
): void {
  const a = attacker?.rogue;
  const v = victim.rogue;
  if (crit && attacker) events.push({ type: 'rogue', player: victim.slot, x: victim.x, y: victim.y, damage, rogue: 'crit' });
  if (attacker && a) {
    if (attacker.hex && attacker.hex.retaliateTicks > 0 && a.retaliateMul !== 1) attacker.hex.retaliateTicks = 0;
    if (a.leech > 0 && damage > 0) attacker.percent = Math.max(0, f32(attacker.percent - damage * a.leech));
    // Arcs and doom are flat percents (exactly the card numbers); Static Crit
    // doubles the arc on crits, never below 8%.
    const chainAmount = crit && a.critChain ? Math.max(8, a.chainDamage * 2) : a.chainDamage;
    if (chainAmount > 0) {
      let best: MatchFighter | null = null;
      let bestDistance = a.chainRange * a.chainRange;
      for (const other of fighters) {
        if (other === attacker || other === victim || !alive(other)) continue;
        const dx = other.x - victim.x, dy = other.y - victim.y, distance = dx * dx + dy * dy;
        if (distance <= bestDistance) { best = other; bestDistance = distance; }
      }
      if (best) zap(best, f32(chainAmount), events, 'chain');
    }
    if (alive(victim)) {
      if ((a.doomDamage > 0 || (crit && a.critDoom)) && !(victim.hex && victim.hex.doomTicks > 0)) {
        const hex = (victim.hex ??= emptyHex());
        hex.doomTicks = DOOM_DELAY;
        hex.doomAmount = f32(Math.max(a.doomDamage, crit && a.critDoom ? 6 : 0));
        hex.doomBy = attacker.slot;
      }
      if (a.weakTicks > 0) {
        const hex = (victim.hex ??= emptyHex());
        if (hex.weakTicks <= 0) events.push({ type: 'rogue', player: victim.slot, x: victim.x, y: victim.y, rogue: 'jolt' });
        hex.weakTicks = a.weakTicks; hex.weakMul = a.weakMul;
      }
      if (a.chillTicks > 0) {
        const hex = (victim.hex ??= emptyHex());
        hex.chillTicks = a.chillTicks; hex.chillMul = a.chillMul;
      }
    }
    if (!projectile && v && v.thorns > 0 && alive(attacker)) zap(attacker, v.thorns, events, 'thorns');
  }
  if (v && v.retaliateMul !== 1 && alive(victim)) (victim.hex ??= emptyHex()).retaliateTicks = RETALIATE_WINDOW;
}

/** Per-frame hex countdowns; doom bursts are percent-only and never launch. */
export function rogueTick(fighter: MatchFighter, events: MatchEvent[]): void {
  const hex = fighter.hex;
  if (!hex) return;
  if (hex.weakTicks > 0) hex.weakTicks--;
  if (hex.chillTicks > 0) hex.chillTicks--;
  if (hex.retaliateTicks > 0) hex.retaliateTicks--;
  if (hex.doomTicks > 0 && --hex.doomTicks === 0 && alive(fighter)) zap(fighter, hex.doomAmount, events, 'doom');
}

/** Speed multiplier: speed boons × undertow slow. Exactly 1 for neutral fighters. */
export function rogueStickMul(fighter: MatchFighter): number {
  const base = fighter.rogue?.speedMul ?? 1;
  return fighter.hex && fighter.hex.chillTicks > 0 ? base * fighter.hex.chillMul : base;
}

const MOVE_STATES: ReadonlySet<MatchFighter['state']> = new Set(['walk', 'run', 'jump', 'airjump', 'fall', 'helpless']);

/** Displacement multiplier for self-movement this frame (walk, dash/run, jumps,
 * air drift, aerial drift). Scales only the position step, never the stored
 * velocity, so it cannot compound; knockback, root-motion attacks and special
 * moves are untouched. Exactly 1 for neutral fighters. */
export function rogueMoveMul(fighter: MatchFighter): number {
  const mul = rogueStickMul(fighter);
  if (mul === 1 || fighter.special) return 1;
  return MOVE_STATES.has(fighter.state) || (fighter.state === 'attack' && !fighter.grounded) ? mul : 1;
}

/** Venom on hit: a fresh burn ticks first after one full cadence; a refresh
 * keeps the running tick phase so repeated hits never postpone the burn. */
export function rogueVenom(current: RoguePoison | null, venomTicks: number): RoguePoison {
  const fresh = Math.max(POISON_TICK_EVERY, Math.round(venomTicks / POISON_TICK_EVERY) * POISON_TICK_EVERY);
  if (!current || current.ticks <= 0) return { ticks: fresh, amount: 1 };
  const phase = current.ticks % POISON_TICK_EVERY;
  const ticks = fresh - ((((fresh - phase) % POISON_TICK_EVERY) + POISON_TICK_EVERY) % POISON_TICK_EVERY);
  return { ticks: Math.max(current.ticks, ticks), amount: 1 };
}

/** Rift floors are 1-vs-many: once the champion has no stocks left, the
 * remaining rivals must not keep fighting each other. False for neutral fighters. */
export function rogueEssentialOut(fighters: readonly MatchFighter[]): boolean {
  return fighters.some((fighter) => fighter.rogue?.essential === true && fighter.stocks <= 0);
}

/** Team floors: rivals on the same non-zero team never strike, shoot or target
 * each other. Always false for neutral fighters (versus, free-for-all floors). */
export function rogueAllied(a: Pick<MatchFighter, 'rogue'> | null | undefined, b: Pick<MatchFighter, 'rogue'> | null | undefined): boolean {
  const team = a?.rogue?.team ?? 0;
  return team !== 0 && team === (b?.rogue?.team ?? 0);
}

/** Last Stand: spend a refund instead of the stock. True when the stock is kept. */
export function rogueDefy(fighter: MatchFighter, events: MatchEvent[]): boolean {
  if (!fighter.rogue || fighter.rogue.lastStand <= 0) return false;
  fighter.rogue.lastStand--;
  events.push({ type: 'rogue', player: fighter.slot, x: fighter.x, y: fighter.y, rogue: 'defy' });
  return true;
}

/** KO follow-ups: clear the victim's hexes, then thunder-clap for the killer. */
export function rogueOnKo(fighters: readonly MatchFighter[], events: MatchEvent[], victim: MatchFighter, killer: number | null): void {
  victim.hex = null;
  const scorer = killer !== null && killer !== victim.slot ? fighters[killer] : undefined;
  const blast = scorer?.rogue?.koBlast ?? 0;
  if (!scorer || blast <= 0) return;
  for (const other of fighters) {
    if (other === scorer || other === victim || !alive(other)) continue;
    zap(other, blast, events, 'clap');
  }
}
