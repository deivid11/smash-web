/** Roguelike run RNG: a tiny seeded PRNG strictly separate from the original
 * Melee RNG compiled to WASM (`engine/gameplay/core.c`,
 * `third_party/melee/src/sysdolphin/baselib/random.c`).
 * Run generation repeatability is a prototype-only claim; it says nothing about
 * GameCube behavior or full-engine determinism.
 */

/** FNV-1a 32-bit hash of an arbitrary seed label. */
export function hashSeedString(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32: deterministic [0, 1) stream for one run seed. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A short human-readable seed label, e.g. `RIFT-4K7Q`. */
export function randomSeedLabel(rng: () => number = Math.random): string {
  let suffix = '';
  for (let index = 0; index < 4; index++) {
    suffix += SEED_ALPHABET[Math.floor(rng() * SEED_ALPHABET.length)]!;
  }
  return `RIFT-${suffix}`;
}

/** Canonicalize free-form seed input: trimmed upper-case label plus numeric seed. */
export function normalizeSeed(input: string): { seed: number; label: string } {
  const label = input.trim().toUpperCase() || randomSeedLabel();
  return { seed: hashSeedString(label), label };
}
