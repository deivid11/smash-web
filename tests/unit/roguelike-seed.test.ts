import { describe, expect, it } from 'vitest';
import { createRng, hashSeedString, normalizeSeed, randomSeedLabel } from '../../lib/game/roguelike/seed.ts';

describe('roguelike run RNG (prototype-only, separate from original WASM RNG)', () => {
  it('hashes seed labels deterministically to 32-bit values', () => {
    expect(hashSeedString('RIFT-AB12')).toBe(hashSeedString('RIFT-AB12'));
    expect(hashSeedString('RIFT-AB12')).not.toBe(hashSeedString('RIFT-AB13'));
    expect(hashSeedString('anything')).toBeGreaterThanOrEqual(0);
    expect(hashSeedString('anything')).toBeLessThan(0x100000000);
  });
  it('produces repeatable streams per seed and varies across seeds', () => {
    const first = Array.from({ length: 10 }, createRng(12345));
    void first;
    const stream = (seed: number): number[] => {
      const rng = createRng(seed);
      return Array.from({ length: 10 }, () => rng());
    };
    expect(stream(12345)).toEqual(stream(12345));
    expect(stream(12345)).not.toEqual(stream(54321));
    for (const value of stream(7)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
  it('normalizes labels and generates readable random labels', () => {
    expect(normalizeSeed('  rift-ab12 ')).toMatchObject({ label: 'RIFT-AB12', seed: hashSeedString('RIFT-AB12') });
    const generated = normalizeSeed('');
    expect(generated.label).toMatch(/^RIFT-[A-Z2-9]{4}$/);
    expect(randomSeedLabel()).toMatch(/^RIFT-[A-Z2-9]{4}$/);
  });
});
