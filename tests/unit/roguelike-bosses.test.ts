import { describe, expect, it } from 'vitest';
import {
  applyTreasureBuild, BOSSES, bossById, bossForAct, boostMods, offerTreasures, pickBossFighters, treasureById, TREASURES, treasureStocks,
} from '../../lib/game/roguelike/bosses.ts';
import { emptyBoonState } from '../../lib/game/roguelike/boons.ts';
import { NEUTRAL_ROGUE_MODS } from '../../lib/game/roguelike/sim.ts';

describe('act bosses and boss spoils', () => {
  it('escalates five bosses toward Giga Bowser and the Rift Sovereign', () => {
    expect(BOSSES.map((boss) => boss.id)).toEqual(['warlord', 'twin-terrors', 'titan', 'giga-koopa', 'rift-sovereign']);
    for (let tier = 1; tier < BOSSES.length; tier++) {
      const prev = BOSSES[tier - 1]!, boss = BOSSES[tier]!;
      expect(boss.bounty).toBeGreaterThan(prev.bounty);
      expect(boss.boost.damageDealtMul!).toBeGreaterThanOrEqual(prev.boost.damageDealtMul!);
      expect(boss.boost.damageTakenMul!).toBeLessThanOrEqual(prev.boost.damageTakenMul!);
    }
    expect(bossForAct(3).slots[0]).toMatchObject({ pool: ['Gk'], fallback: 'Kp', giga: true });
    expect(bossForAct(99).id).toBe('rift-sovereign');
    expect(() => bossById('nope')).toThrow();
  });

  it('picks distinct seeded boss fighters that never mirror the player', () => {
    const twins = bossById('twin-terrors');
    for (let seed = 0; seed < 40; seed++) {
      const fighters = pickBossFighters(twins, seed, 'Ms');
      expect(fighters).toHaveLength(2);
      expect(new Set(fighters).size).toBe(2);
      expect(fighters).not.toContain('Ms');
      expect(pickBossFighters(twins, seed, 'Ms')).toEqual(fighters);
    }
    expect(pickBossFighters(bossById('giga-koopa'), 5, 'Gk')).toEqual(['Kp']);
  });

  it('boosts foe mods and keeps speed/crit bounded', () => {
    const boosted = boostMods({ ...NEUTRAL_ROGUE_MODS, damageDealtMul: 2, speedMul: 1.4 }, bossById('rift-sovereign').boost);
    expect(boosted.damageDealtMul).toBeCloseTo(3.8, 6);
    expect(boosted.damageTakenMul).toBeCloseTo(0.5, 6);
    expect(boosted.knockbackTakenMul).toBeCloseTo(0.45, 6);
    expect(boosted.speedMul).toBe(1.5);
    expect(boosted.lastStand).toBe(2);
  });

  it('offers three unowned treasures and applies their build effects', () => {
    const offer = offerTreasures(77, 0, []);
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);
    expect(offerTreasures(77, 0, [])).toEqual(offer);
    expect(offerTreasures(77, 1, offer).some((id) => offer.includes(id))).toBe(false);
    expect(offerTreasures(1, 0, TREASURES.map((treasure) => treasure.id))).toEqual([]);
    const state = emptyBoonState();
    applyTreasureBuild(state, ['executioner-edge', 'aegis-core', 'phoenix-crown', 'storm-eye', 'golden-idol']);
    expect(state.player.damageDealtMul).toBeCloseTo(1.3, 6);
    expect(state.player.damageTakenMul).toBeCloseTo(0.75, 6);
    expect(state.player.lastStand).toBe(1);
    expect(state.player.chainDamage).toBe(4);
    expect(treasureStocks(['war-crown'])).toBe(1);
    expect(treasureStocks([])).toBe(0);
    expect(() => treasureById('nope')).toThrow();
  });
});
