import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { RollbackDriver } from '../../lib/game/rollback.ts';
import { neutralInput, type LocalMatch, type MatchEvent, type MatchState, type PlayerInput } from '../../lib/game/match.ts';
import type { PlayerControllerMode } from '../../lib/game/setup.ts';

/** Tiny contract harness, not replacement gameplay physics. Real C/data/pose
 * convergence is tested separately in tests/unit/rollback-real.test.ts. */
function world(count = 3, controllers: readonly PlayerControllerMode[] | null = null): LocalMatch {
  const match = {
    frame: 0, phase: 'ready' as LocalMatch['phase'], events: [] as MatchEvent[], value: 0,
    fighters: Array.from({length: count}, () => ({special: null as {serial: number} | null})), options: {opponent: 'human', controllers},
    controllerKinds: controllers ?? Array.from({length: count}, () => 'human' as const),
    start() { this.phase = 'playing'; },
    step(inputs: readonly PlayerInput[]) {
      this.fighters.forEach((fighter, slot) => { fighter.special = inputs[slot]!.special ? {serial: slot + 1} : null; });
      this.frame++; this.value += inputs.reduce((sum, input, slot) => sum + input.x * (slot + 1), 0);
      this.events = inputs.flatMap((input, player) => input.jump ? [{type: 'jump' as const, player, x: this.value, y: 0}] : []);
      if (inputs[1]!.attack && !inputs[2]?.shield) { this.phase = 'ended'; this.events.push({type: 'end', player: 0, x: 0, y: 0}); }
    },
    captureState() { return structuredClone({frame: this.frame, phase: this.phase, events: this.events, remainingFrames: this.value, fighters: this.fighters}) as unknown as MatchState; },
    restoreState(state: MatchState) { this.frame = state.frame; this.phase = state.phase; this.events = structuredClone(state.events); this.value = state.remainingFrames; this.fighters = structuredClone(state.fighters); },
    stateHash() { return [...sha256(new TextEncoder().encode(JSON.stringify(this.captureState())))].map(b => b.toString(16).padStart(2, '0')).join(''); },
  };
  return match as unknown as LocalMatch;
}

describe('bounded rollback driver contract without private assets', () => {
  it('resumes the already-sent high-water frame after correcting an earlier provisional end', () => {
    const match = world(), driver = new RollbackDriver(match, 0, 3);
    for (let frame = 0; frame < 3; frame++) expect(driver.advance(neutralInput())).toBe(true);
    driver.receive(1, 1, {...neutralInput(), attack: true});
    expect(driver.frame).toBe(2); expect(match.phase).toBe('ended'); expect(driver.ended).toBe(false);
    expect(driver.advance(neutralInput())).toBe(false); expect(driver.drainConfirmedEvents()).toEqual([]);
    driver.receive(1, 2, {...neutralInput(), shield: true});
    expect(driver.frame).toBe(3); expect(match.phase).toBe('playing');
    expect(driver.advance({...neutralInput(), x: 1})).toBe(true); expect(driver.frame).toBe(4);
  });
  it('copies remote input and returns confirmed events independently exactly once', () => {
    const driver = new RollbackDriver(world(2), 0, 2);
    const input = {...neutralInput(), jump: true}; driver.receive(0, 1, input); input.jump = false;
    driver.advance(neutralInput()); const batches = driver.drainConfirmedEvents();
    expect(batches[0]!.events).toHaveLength(1); const hash = driver.stateHash(0);
    expect(() => { (batches[0]!.events[0]! as MatchEvent).x = 999; }).toThrow();
    expect(Object.isFrozen(batches[0]!.audio.specialScopes)).toBe(true);
    expect(driver.stateHash(0)).toBe(hash); expect(driver.drainConfirmedEvents()).toEqual([]);
  });
  it('delivers post-confirmed audio scopes rather than speculative live scope/end state', () => {
    const match = world(2), driver = new RollbackDriver(match, 0, 2);
    driver.advance({...neutralInput(), special: true}); driver.advance(neutralInput());
    expect(match.fighters[0].special).toBeNull();
    driver.receive(0, 1, neutralInput()); const first = driver.drainConfirmedEvents()[0]!;
    expect(first.audio).toEqual({specialScopes: [1, null], ended: false});
    driver.receive(1, 1, {...neutralInput(), attack: true}); const last = driver.drainConfirmedEvents()[0]!;
    expect(last.audio).toEqual({specialScopes: [null, null], ended: true});
  });
  it('fails closed on conflicting known input, invalid slots/axes and far-future input', () => {
    const conflict = new RollbackDriver(world(2), 0, 2); conflict.receive(0, 1, neutralInput());
    expect(() => conflict.receive(0, 1, {...neutralInput(), jump: true})).toThrow('Conflicting');
    const invalid = new RollbackDriver(world(2), 0, 2);
    expect(() => invalid.receive(0, 2, neutralInput())).toThrow('slot'); expect(invalid.failure).not.toBeNull();
    const future = new RollbackDriver(world(2), 0, 2, {historyLimit: 4, maxPrediction: 2});
    expect(() => future.receive(5, 1, neutralInput())).toThrow('future');
    const axis = new RollbackDriver(world(2), 0, 2); expect(() => axis.advance({...neutralInput(), x: NaN})).toThrow('axes');
  });
  it('bounds undrained confirmed events instead of leaking or dropping audio/statistics', () => {
    const driver = new RollbackDriver(world(2), 0, 2, {historyLimit: 2, maxPrediction: 2});
    for (let frame = 0; frame < 2; frame++) { driver.receive(frame, 1, neutralInput()); driver.advance(neutralInput()); }
    driver.receive(2, 1, neutralInput()); expect(() => driver.advance(neutralInput())).toThrow('event consumer');
    expect(driver.failure).not.toBeNull();
  });
  it('accepts a matching future hash and permanently fails conflicting or mismatching hashes', () => {
    const reference = new RollbackDriver(world(2), 0, 2); reference.receive(0, 1, neutralInput()); reference.advance(neutralInput());
    const driver = new RollbackDriver(world(2), 0, 2); driver.checkHash(0, reference.stateHash(0));
    driver.advance(neutralInput()); driver.receive(0, 1, neutralInput()); expect(driver.failure).toBeNull();
    expect(() => driver.checkHash(0, '0'.repeat(64))).toThrow('desync');
    const future = new RollbackDriver(world(2), 0, 2); future.checkHash(0, '0'.repeat(64));
    expect(() => future.checkHash(0, '1'.repeat(64))).toThrow('Conflicting');
  });
  it('preconfirms CPU placeholders but never accepts network CPU input, even an identical neutral echo', () => {
    const driver = new RollbackDriver(world(3, ['cpu', 'human', 'cpu']), 1, 3);
    expect(driver.advance({...neutralInput(), jump: true})).toBe(true); expect(driver.confirmedFrame).toBe(0);
    expect(driver.stats.predictionFrames).toBe(0); expect(driver.drainConfirmedEvents()[0]!.events).toHaveLength(1);
    expect(() => driver.receive(0, 0, neutralInput())).toThrow('CPU'); expect(driver.failure).not.toBeNull();
  });
  it('waits for each human slot but not CPUs and rejects a CPU local source', () => {
    const driver = new RollbackDriver(world(4, ['cpu', 'human', 'cpu', 'human']), 3, 4);
    driver.advance(neutralInput()); expect(driver.confirmedFrame).toBe(-1);
    driver.receive(0, 1, neutralInput()); expect(driver.confirmedFrame).toBe(0);
    expect(() => new RollbackDriver(world(3, ['cpu', 'human', 'cpu']), 0, 3)).toThrow('CPU');
  });
  it('validates construction, and never exposes a speculative hash as confirmed', () => {
    expect(() => new RollbackDriver(world(), 3, 3)).toThrow('slots');
    expect(() => new RollbackDriver(world(), 0, 3, {historyLimit: 601})).toThrow('bounds');
    const driver = new RollbackDriver(world(), 0, 3); driver.advance(neutralInput());
    expect(() => driver.stateHash(0)).toThrow('not confirmed'); expect(driver.failure).toBeNull();
  });
});
