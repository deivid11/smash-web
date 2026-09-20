import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchFighter } from '../../lib/game/match.ts';
import {
  DOOM_DELAY, NEUTRAL_ROGUE_MODS, POISON_TICK_EVERY, RETALIATE_WINDOW, rogueAfterHit, rogueAllied, rogueDefy, rogueHitScale, rogueMoveMul, rogueOnKo, rogueRoll,
  rogueStickMul, rogueTick, rogueVenom, type RogueMods,
} from '../../lib/game/roguelike/sim.ts';

type Actor = Pick<MatchFighter, 'slot' | 'x' | 'y' | 'percent' | 'state' | 'grounded' | 'attackSerial' | 'poison' | 'hex' | 'rogue' | 'special'>;
const actor = (slot: number, x: number, rogue: Partial<RogueMods> = {}): Actor => ({
  slot, x, y: 0, percent: 0, state: 'idle', grounded: true, attackSerial: 1, poison: null, hex: null, special: null, rogue: { ...NEUTRAL_ROGUE_MODS, ...rogue },
});
const as = (value: Actor): MatchFighter => value as unknown as MatchFighter;

describe('rogue sim hooks (neutral by default)', () => {
  it('returns exactly 1 × 1 for neutral fighters', () => {
    const scale = rogueHitScale(10, as(actor(0, 0)), as(actor(1, 5)));
    expect(scale).toEqual({ damageMul: 1, knockbackMul: 1, crit: false });
    const events: MatchEvent[] = [];
    const a = actor(0, 0), v = actor(1, 5);
    rogueAfterHit([as(a), as(v)], events, as(a), as(v), 10, false, false);
    expect(events).toEqual([]);
    expect(v.hex).toBeNull();
    expect(rogueStickMul(as(a))).toBe(1);
  });

  it('folds rage, execute, opener, burn and launch lanes into the multipliers', () => {
    const attacker = actor(0, 0, { damageDealtMul: 1.2, knockbackMul: 1.1, rage: 0.1, rageCap: 0.2, executeMul: 1.5, executeKnockbackMul: 1.3, openerMul: 2, burnBonusMul: 1.25 });
    attacker.percent = 150;
    const victim = actor(1, 5, { damageTakenMul: 0.9, knockbackTakenMul: 0.8 });
    victim.percent = 120;
    victim.poison = { ticks: 10, amount: 1 };
    const scale = rogueHitScale(3, as(attacker), as(victim));
    expect(scale.damageMul).toBeCloseTo(1.2 * 0.9 * 1.2 * 1.5 * 1.25, 6);
    expect(scale.knockbackMul).toBeCloseTo(1.1 * 0.8 * 1.3, 6);
    const fresh = actor(2, 5);
    expect(rogueHitScale(3, as(attacker), as(fresh)).damageMul).toBeCloseTo(1.2 * 1.2 * 2, 6);
  });

  it('crits deterministically at the configured chance', () => {
    const attacker = actor(0, 0, { critChance: 0.25, critMul: 3 });
    const victim = actor(1, 5);
    let crits = 0;
    for (let frame = 0; frame < 4000; frame++) {
      const scale = rogueHitScale(frame, as(attacker), as(victim));
      expect(scale).toEqual(rogueHitScale(frame, as(attacker), as(victim)));
      if (scale.crit) { crits++; expect(scale.damageMul).toBe(3); }
    }
    expect(crits / 4000).toBeGreaterThan(0.2);
    expect(crits / 4000).toBeLessThan(0.3);
    expect(rogueRoll(1, 2, 3, 4)).toBe(rogueRoll(1, 2, 3, 4));
  });

  it('arcs, thorns, leeches, jolts, slows and marks doom', () => {
    const attacker = actor(0, 0, { chainDamage: 4, chainRange: 30, leech: 0.5, doomDamage: 6, weakTicks: 180, weakMul: 0.8, chillTicks: 120, chillMul: 0.6 });
    attacker.percent = 40;
    const victim = actor(1, 5, { thorns: 2 });
    const near = actor(2, 20);
    const far = actor(3, 200);
    const events: MatchEvent[] = [];
    const fighters = [attacker, victim, near, far].map(as);
    rogueAfterHit(fighters, events, as(attacker), as(victim), 10, false, false);
    expect(attacker.percent).toBe(40 - 5 + 2);
    expect(near.percent).toBe(4);
    expect(far.percent).toBe(0);
    expect(victim.hex).toMatchObject({ doomTicks: DOOM_DELAY, doomAmount: 6, weakTicks: 180, weakMul: 0.8, chillTicks: 120, chillMul: 0.6 });
    expect(events.filter((event) => event.type === 'rogue').map((event) => event.rogue)).toEqual(['chain', 'jolt', 'thorns']);
    expect(rogueStickMul(as(victim))).toBeCloseTo(0.6, 6);
    // Jolted victims hit softer.
    expect(rogueHitScale(1, as(victim), as(attacker)).damageMul).toBeCloseTo(0.8, 6);
    // Projectiles never trigger thorns.
    const before = attacker.percent;
    rogueAfterHit(fighters, [], as(attacker), as(victim), 0, true, false);
    expect(attacker.percent).toBe(before);
    // Doom bursts once after the delay, percent only.
    const tickEvents: MatchEvent[] = [];
    for (let frame = 0; frame < DOOM_DELAY; frame++) rogueTick(as(victim), tickEvents);
    expect(victim.percent).toBe(6);
    expect(tickEvents.some((event) => event.rogue === 'doom')).toBe(true);
    expect(victim.hex!.doomTicks).toBe(0);
  });

  it('charges retaliation on being hit and spends it on the next hit', () => {
    const avenger = actor(0, 0, { retaliateMul: 1.5 });
    const bully = actor(1, 5);
    rogueAfterHit([as(avenger), as(bully)], [], as(bully), as(avenger), 5, false, false);
    expect(avenger.hex!.retaliateTicks).toBe(RETALIATE_WINDOW);
    expect(rogueHitScale(1, as(avenger), as(bully)).damageMul).toBeCloseTo(1.5, 6);
    rogueAfterHit([as(avenger), as(bully)], [], as(avenger), as(bully), 5, false, false);
    expect(avenger.hex!.retaliateTicks).toBe(0);
    expect(rogueHitScale(1, as(avenger), as(bully)).damageMul).toBe(1);
  });

  it('defies KOs while stands remain and thunderclaps for the killer', () => {
    const hero = actor(0, 0, { lastStand: 1, koBlast: 8 });
    const events: MatchEvent[] = [];
    expect(rogueDefy(as(hero), events)).toBe(true);
    expect(rogueDefy(as(hero), events)).toBe(false);
    expect(hero.rogue.lastStand).toBe(0);
    const victim = actor(1, 0);
    victim.hex = { doomTicks: 3, doomAmount: 5, doomBy: 0, weakTicks: 0, weakMul: 1, chillTicks: 0, chillMul: 1, retaliateTicks: 0 };
    const bystander = actor(2, 0);
    const knocked = actor(3, 0);
    knocked.state = 'ko';
    rogueOnKo([hero, victim, bystander, knocked].map(as), events, as(victim), 0);
    expect(victim.hex).toBeNull();
    expect(bystander.percent).toBe(8);
    expect(knocked.percent).toBe(0);
    expect(hero.percent).toBe(0);
  });

  it('keeps card numbers exact: flat arcs and doom, Static Crit arcs double (min 8%)', () => {
    const attacker = actor(0, 0, { chainDamage: 3, doomDamage: 6, damageDealtMul: 2, critChain: true });
    const victim = actor(1, 5), near = actor(2, 10);
    const events: MatchEvent[] = [];
    rogueAfterHit([attacker, victim, near].map(as), events, as(attacker), as(victim), 10, false, false);
    expect(near.percent).toBe(3);
    expect(victim.hex?.doomAmount).toBe(6);
    rogueAfterHit([attacker, victim, near].map(as), events, as(attacker), as(victim), 10, false, true);
    expect(near.percent).toBe(3 + 8);
    const arcless = actor(0, 0, { critChain: true });
    const other = actor(2, 10);
    rogueAfterHit([arcless, actor(1, 5), other].map(as), [], as(arcless), as(actor(1, 5)), 10, false, false);
    expect(other.percent).toBe(0);
  });

  it('venom refreshes without postponing the running tick phase', () => {
    const fresh = rogueVenom(null, 360);
    expect(fresh.ticks % POISON_TICK_EVERY).toBe(0);
    const running = { ticks: fresh.ticks - 50, amount: 1 };
    const refreshed = rogueVenom(running, 360);
    expect(refreshed.ticks % POISON_TICK_EVERY).toBe(running.ticks % POISON_TICK_EVERY);
    expect(refreshed.ticks).toBeGreaterThanOrEqual(running.ticks);
  });

  it('scales self-movement only in movement states, never during specials', () => {
    const runner = actor(0, 0, { speedMul: 1.2 });
    runner.state = 'run';
    expect(rogueMoveMul(as(runner))).toBeCloseTo(1.2, 6);
    runner.state = 'attack';
    expect(rogueMoveMul(as(runner))).toBe(1);
    runner.grounded = false;
    expect(rogueMoveMul(as(runner))).toBeCloseTo(1.2, 6);
    runner.state = 'fall';
    (runner as { special: unknown }).special = {};
    expect(rogueMoveMul(as(runner))).toBe(1);
    expect(rogueMoveMul(as(actor(1, 0)))).toBe(1);
  });
});

describe('Rift team floors', () => {
  it('allies only fighters sharing a non-zero team', () => {
    const mods = (team: number) => ({ rogue: { ...NEUTRAL_ROGUE_MODS, team } });
    expect(rogueAllied(mods(2), mods(2))).toBe(true);
    expect(rogueAllied(mods(0), mods(0))).toBe(false);
    expect(rogueAllied(mods(2), mods(0))).toBe(false);
    expect(rogueAllied(mods(1), mods(2))).toBe(false);
    expect(rogueAllied(null, mods(2))).toBe(false);
  });
});
