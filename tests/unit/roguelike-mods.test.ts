import { describe, expect, it } from 'vitest';
import { buildStats, describeBuild, scaledDamage } from '../../lib/game/roguelike/mods.ts';
import { computeBoonState, emptyBoonState } from '../../lib/game/roguelike/boons.ts';

describe('roguelike sim math (prototype multipliers)', () => {
  it('passes neutral damage through untouched and scales the rest', () => {
    expect(scaledDamage(7, 1, 1)).toBe(7);
    expect(scaledDamage(7, 1.35, 1)).toBeCloseTo(9.45, 4);
    expect(scaledDamage(8, 1.2, 0.82)).toBeCloseTo(8 * 1.2 * 0.82, 4);
    expect(() => scaledDamage(5, 0, 1)).toThrow();
    expect(() => scaledDamage(5, NaN, 1)).toThrow();
  });
  it('lists every non-neutral stat with good/bad tones', () => {
    expect(buildStats(emptyBoonState())).toEqual([]);
    expect(describeBuild(emptyBoonState())).toEqual([]);
    const state = computeBoonState([
      { id: 'ember-fury', rarity: 'rare', level: 1 },
      { id: 'hunt-aim', rarity: 'common', level: 1 },
      { id: 'chaos-glass', rarity: 'common', level: 1 },
      { id: 'aegis-defiance', rarity: 'rare', level: 1 },
      { id: 'volt-arc', rarity: 'common', level: 1 },
    ]);
    const stats = buildStats(state);
    const byKey = new Map(stats.map((stat) => [stat.key, stat]));
    expect(byKey.get('dmg')?.value).toBe('+55%');
    expect(byKey.get('taken')).toMatchObject({ value: '+30%', tone: 'bad' });
    expect(byKey.get('crit')?.value).toBe('8% ×2');
    expect(byKey.get('stand')?.value).toBe('✝×1');
    expect(byKey.get('arc')?.value).toContain('3%');
    const es = buildStats(state, true);
    expect(es.find((stat) => stat.key === 'dmg')?.label).toBe('Daño');
    expect(describeBuild(state)[0]).toBe('DAMAGE +55%');
  });
});
