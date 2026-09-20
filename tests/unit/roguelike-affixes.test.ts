import { describe, expect, it } from 'vitest';
import { AFFIX_POOL, affixById, affixesForFloor, FOE_AFFIXES, modsForAffixes, rollAffixes, scoreForAffixes } from '../../lib/game/roguelike/affixes.ts';
import { combatFloors, generateRun } from '../../lib/game/roguelike/generator.ts';
import { createRng } from '../../lib/game/roguelike/seed.ts';
import { NEUTRAL_ROGUE_MODS } from '../../lib/game/roguelike/sim.ts';

describe('foe affixes (boss/elite gifts on neutral lanes)', () => {
  it('declares every affix with text and a bounty', () => {
    expect(Object.keys(FOE_AFFIXES).sort()).toEqual([...AFFIX_POOL].sort());
    for (const id of AFFIX_POOL) {
      const affix = affixById(id);
      expect(affix.label.length).toBeGreaterThan(0);
      expect(affix.detail.length).toBeGreaterThan(0);
      expect(affix.scoreBonus).toBeGreaterThan(0);
    }
    expect(() => affixById('nope')).toThrow();
    expect(scoreForAffixes(['vampiric', 'infernal'])).toBe(200);
  });
  it('maps affixes onto rogue mods and stays neutral when empty', () => {
    expect(modsForAffixes([])).toEqual(NEUTRAL_ROGUE_MODS);
    const mods = modsForAffixes(['enraged', 'infernal', 'venomous', 'vampiric', 'swift', 'bulwark', 'thorned', 'titan', 'deadeye', 'stormborn', 'undying']);
    expect(mods.damageDealtMul).toBeCloseTo(1.25 * 1.15, 6);
    expect(mods.venomTicks).toBe(360);
    expect(mods.lifesteal).toBe(6);
    expect(mods.speedMul).toBeCloseTo(1.12, 6);
    expect(mods.damageTakenMul).toBeCloseTo(0.8, 6);
    expect(mods.thorns).toBe(2);
    expect(mods.knockbackTakenMul).toBeCloseTo(0.75, 6);
    expect(mods.critChance).toBeCloseTo(0.12, 6);
    expect(mods.chainDamage).toBe(3);
    expect(mods.lastStand).toBe(1);
    expect(() => modsForAffixes(['nope' as never])).toThrow();
  });
  it('rolls distinct gifts: bosses by tier, elites grow with depth, crowds never undying', () => {
    expect(rollAffixes(createRng(1), 'boss', 9, 50, 0, false, 2)).toHaveLength(2);
    expect(rollAffixes(createRng(1), 'boss', 49, 50, 0, false, 4)).toHaveLength(4);
    expect(rollAffixes(createRng(1), 'elite', 5, 50, 0)).toHaveLength(1);
    expect(rollAffixes(createRng(1), 'elite', 30, 50, 0)).toHaveLength(2);
    expect(rollAffixes(createRng(1), 'elite', 30, 50, 4)).toHaveLength(3);
    expect(rollAffixes(createRng(1), 'battle', 1, 50, 5)).toEqual([]);
    let late = 0;
    for (let seed = 0; seed < 50; seed++) late += rollAffixes(createRng(seed), 'battle', 48, 50, 0).length > 0 ? 1 : 0;
    expect(late).toBeGreaterThan(40);
    for (let seed = 0; seed < 50; seed++) {
      const crowd = rollAffixes(createRng(seed), 'boss', 9, 10, 0, true);
      expect(crowd).not.toContain('undying');
      expect(new Set(crowd).size).toBe(crowd.length);
    }
    expect(affixesForFloor(99, 9, 'boss', 50, 0)).toEqual(affixesForFloor(99, 9, 'boss', 50, 0));
  });
  it('lands on generated elites and bosses', () => {
    const plan = generateRun('RIFT-GIFTS', { heat: 3 });
    for (const floor of combatFloors(plan)) {
      if (floor.kind === 'boss') expect(floor.affixes.length).toBeGreaterThanOrEqual(2);
      if (floor.kind === 'elite') expect(floor.affixes.length).toBeGreaterThanOrEqual(1);
    }
  });
});
