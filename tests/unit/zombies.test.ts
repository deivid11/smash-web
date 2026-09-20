import { describe, expect, it } from 'vitest';
import { ZOMBIE_DEALT_MUL, ZOMBIE_TAKEN_MUL, zombieWinner } from '../../lib/game/match.ts';

interface Standing { slot: number; stocks: number; percent: number; infected: boolean }
const fighter = (slot: number, stocks: number, percent = 0, infected = false): Standing => ({ slot, stocks, percent, infected });

describe('zombies result table (infection prototype)', () => {
  it('tunes the horde for pressure over durability', () => {
    expect(ZOMBIE_DEALT_MUL).toBeGreaterThan(1);
    expect(ZOMBIE_TAKEN_MUL).toBeGreaterThan(1);
  });

  it('hands a finished horde win to patient zero', () => {
    expect(zombieWinner([fighter(0, 1, 50, true), fighter(1, 1, 0, true)], 0)).toBe(0);
    expect(zombieWinner([fighter(0, 0, 999), fighter(1, 1, 0, true)], 1)).toBe(1);
  });

  it('ignores infected stocks when ranking clean survivors', () => {
    // The infected keep a permanent stock; it must never outrank the living.
    const table = [fighter(0, 1, 120, true), fighter(1, 1, 40), fighter(2, 2, 0)];
    expect(zombieWinner(table, 0)).toBe(2);
  });

  it('breaks survivor ties by damage, then calls exact ties a draw', () => {
    expect(zombieWinner([fighter(0, 2, 30), fighter(1, 2, 80)], null)).toBe(0);
    expect(zombieWinner([fighter(0, 2, 30), fighter(1, 2, 30)], null)).toBeNull();
  });

  it('returns null with no result when nobody holds a stock or a seed', () => {
    expect(zombieWinner([], null)).toBeNull();
    expect(zombieWinner([fighter(0, 0), fighter(1, 0)], null)).toBeNull();
  });
});
