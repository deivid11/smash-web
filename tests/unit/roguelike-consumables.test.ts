import { describe, expect, it } from 'vitest';
import {
  applyConsumable, consumableById, CONSUMABLES, CONSUMABLE_OVERFLOW_COINS,
  MAX_CONSUMABLES, offerConsumable,
} from '../../lib/game/roguelike/consumables.ts';
import type { RogueHex } from '../../lib/game/roguelike/sim.ts';

describe('pocket consumables (plain-number relief, no engine)', () => {
  it('defines the documented pocket items', () => {
    expect(CONSUMABLES.map((item) => item.id)).toEqual(['draught', 'smoke', 'star', 'feather', 'storm-jar']);
    expect(MAX_CONSUMABLES).toBe(3);
    expect(CONSUMABLE_OVERFLOW_COINS).toBe(40);
    for (const item of CONSUMABLES) {
      expect(item.detail.length).toBeGreaterThan(0);
      expect(item.price).toBeGreaterThan(0);
    }
    expect(consumableById('draught').name).toBe('Healing Draught');
    expect(() => consumableById('nope')).toThrow();
  });
  it('deals deterministic rewards per site', () => {
    expect(offerConsumable(42, 2)).toBe(offerConsumable(42, 2));
    const spread = new Set(Array.from({ length: 60 }, (_, seed) => offerConsumable(seed, 0)));
    expect(spread.size).toBe(CONSUMABLES.length);
  });
  it('heals, bombs, wishes, defies and jolts within caps', () => {
    const player = { percent: 80, stocks: 2, rogue: { lastStand: 0 } };
    const foes: Array<{ percent: number; state?: string; hex?: RogueHex | null }> = [{ percent: 10, hex: null }, { percent: 990, hex: null }, { percent: 5, state: 'ko', hex: null }];
    const target = { player, foes, stockCap: 3 };
    applyConsumable(target, 'draught');
    expect(player.percent).toBe(20);
    applyConsumable(target, 'draught');
    expect(player.percent).toBe(0);
    applyConsumable(target, 'smoke');
    expect(foes[0]!.percent).toBe(35);
    expect(foes[1]!.percent).toBe(999);
    expect(foes[2]!.percent).toBe(5);
    applyConsumable(target, 'star');
    expect(player.stocks).toBe(3);
    expect(() => applyConsumable(target, 'star')).toThrow();
    applyConsumable(target, 'feather');
    expect(player.rogue.lastStand).toBe(1);
    // Feathers stack on top of any stands already held (never trim them).
    player.rogue.lastStand = 4;
    applyConsumable(target, 'feather');
    expect(player.rogue.lastStand).toBe(5);
    player.rogue.lastStand = 1;
    applyConsumable(target, 'storm-jar');
    expect(foes[0]!.percent).toBe(47);
    expect(foes[0]!.hex).toMatchObject({ weakTicks: 300, weakMul: 0.7 });
    expect(foes[2]!.hex).toBeNull();
    expect(() => applyConsumable(target, 'nope' as never)).toThrow();
  });
});
