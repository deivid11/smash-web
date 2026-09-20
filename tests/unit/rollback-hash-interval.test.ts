import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { RollbackDriver, ROLLBACK_HASH_INTERVAL } from '../../lib/game/rollback.ts';
import { neutralInput, type LocalMatch, type MatchEvent, type MatchState, type PlayerInput } from '../../lib/game/match.ts';

/** Minimal deterministic world (same contract harness shape as rollback.test.ts). */
function world(count = 2): LocalMatch & { hashed: number[] } {
  const match = {
    frame: 0, phase: 'ready' as LocalMatch['phase'], events: [] as MatchEvent[], value: 0, hashed: [] as number[],
    fighters: Array.from({ length: count }, () => ({ special: null as { serial: number } | null })), options: { opponent: 'human', controllers: null },
    controllerKinds: Array.from({ length: count }, () => 'human' as const),
    start() { this.phase = 'playing'; },
    step(inputs: readonly PlayerInput[]) {
      this.frame++; this.value += inputs.reduce((sum, input, slot) => sum + input.x * (slot + 1), 0);
      this.events = [];
      if (inputs[1]!.attack) this.phase = 'ended';
    },
    captureState() { return structuredClone({ frame: this.frame, phase: this.phase, events: this.events, remainingFrames: this.value, fighters: this.fighters }) as unknown as MatchState; },
    restoreState(state: MatchState) { this.frame = state.frame; this.phase = state.phase; this.events = structuredClone(state.events); this.value = state.remainingFrames; this.fighters = structuredClone(state.fighters); },
    stateHash() { this.hashed.push(this.frame - 1); return [...sha256(new TextEncoder().encode(JSON.stringify(this.captureState())))].map(b => b.toString(16).padStart(2, '0')).join(''); },
  };
  return match as unknown as LocalMatch & { hashed: number[] };
}

const remote = (frame: number): PlayerInput => ({ ...neutralInput(), x: frame % 7 === 0 ? 0.5 : 0 });

describe('rollback checkpoint hash interval', () => {
  it('hashes only checkpoint frames with the same values as every-frame hashing', () => {
    const sparseWorld = world(), sparse = new RollbackDriver(sparseWorld, 0, 2, { hashInterval: ROLLBACK_HASH_INTERVAL });
    const dense = new RollbackDriver(world(), 0, 2);
    for (let frame = 0; frame < 75; frame++) {
      const local = { ...neutralInput(), x: frame % 5 === 0 ? -1 : 0 };
      for (const driver of [sparse, dense]) { driver.advance(local); driver.receive(frame, 1, remote(frame)); driver.drainConfirmedEvents(); }
    }
    // Checkpoints only (corrections may re-hash a checkpoint they resimulate).
    expect(new Set(sparseWorld.hashed)).toEqual(new Set([0, 30, 60]));
    for (const frame of [0, 30, 60]) expect(sparse.stateHash(frame)).toBe(dense.stateHash(frame));
    expect(() => sparse.stateHash(31)).toThrow('not a checkpoint');
    sparse.checkHash(60, dense.stateHash(60));
    expect(() => sparse.checkHash(30, '0'.repeat(64))).toThrow('desync');
  });

  it('keeps checkpoint hashes exact through late-input corrections', () => {
    const sparse = new RollbackDriver(world(), 0, 2, { hashInterval: 30, maxPrediction: 8 }), dense = new RollbackDriver(world(), 0, 2, { maxPrediction: 8 });
    for (let frame = 0; frame < 64; frame++) {
      for (const driver of [sparse, dense]) {
        driver.advance(neutralInput());
        // Remote input arrives 3 frames late, forcing rollbacks across checkpoint 30.
        if (frame >= 3) driver.receive(frame - 3, 1, remote(frame - 3));
        driver.drainConfirmedEvents();
      }
    }
    expect(sparse.stats.rollbacks).toBeGreaterThan(0);
    expect(sparse.stateHash(30)).toBe(dense.stateHash(30));
  });

  it('always hashes the match-ending frame and rejects peer hashes off the checkpoint cadence', () => {
    const driver = new RollbackDriver(world(), 0, 2, { hashInterval: 30 });
    for (let frame = 0; frame < 12; frame++) { driver.advance(neutralInput()); driver.receive(frame, 1, frame === 11 ? { ...neutralInput(), attack: true } : neutralInput()); driver.drainConfirmedEvents(); }
    expect(driver.ended).toBe(true);
    expect(driver.stateHash(driver.confirmedFrame)).toMatch(/^[0-9a-f]{64}$/u);

    const peer = new RollbackDriver(world(), 0, 2, { hashInterval: 30 });
    peer.checkHash(5, '1'.repeat(64));
    for (let frame = 0; frame < 6; frame++) peer.advance(neutralInput());
    expect(() => { for (let frame = 0; frame < 6; frame++) peer.receive(frame, 1, neutralInput()); }).toThrow('checkpoint intervals differ');
    expect(() => new RollbackDriver(world(), 0, 2, { hashInterval: 0 })).toThrow('hash interval');
  });
});
