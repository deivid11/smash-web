import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchOptions, type PlayerInput } from '../../lib/game/match.ts';
import { RollbackDriver, normalizeInput, type ConfirmedEvents } from '../../lib/game/rollback.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import type { PlayerControllerMode } from '../../lib/game/setup.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('explicit human/CPU roles and sparse seats with original local disc data', () => {
  let content: GameContent;
  const rigs: GameRigs[] = [];
  const make = (count = 8, options: MatchOptions = {}) => {
    const selected = rosterPlayers(content, Array.from({length: count}, (_, slot) => (['Fx', 'Mr', 'Ss', 'Kb'] as const)[slot % 4]!));
    const rig = new GameRigs(selected); rigs.push(rig);
    const match = new LocalMatch(selected, rig, {opponent: 'human', countdown: 0, seed: 8181, ...options}); match.start(); return match;
  };
  const roles = (count: number, humans: readonly number[]): PlayerControllerMode[] => Array.from({length: count}, (_, slot) => humans.includes(slot) ? 'human' : 'cpu');
  const inputs = (count: number) => Array.from({length: count}, () => normalizeInput(neutralInput()));
  const batch = (match: LocalMatch, frame: number): ConfirmedEvents => ({frame, events: structuredClone(match.events), audio: {specialScopes: match.fighters.map(fighter => fighter.special?.serial ?? null), ended: match.phase === 'ended'}});
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { content = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer); }
    finally { await disc.close(); }
  });
  afterEach(() => { rigs.forEach(rig => rig.dispose()); rigs.length = 0; });

  it('retains null/omitted legacy bot P1-to-selected-player input remapping exactly', () => {
    const a = make(2, {opponent: 'bot', player: 1}), b = make(2, {opponent: 'bot', player: 1, controllers: null, seatIds: null});
    expect(a.controllerKinds).toEqual(['cpu', 'human']);
    const controls = [normalizeInput({...neutralInput(), attack: true}), normalizeInput({...neutralInput(), jump: true})];
    a.step(controls); b.step(controls);
    expect(a.fighters[1].previous).toMatchObject({attack: true, jump: false}); expect(a.stateHash()).toBe(b.stateHash());
    expect(() => new RollbackDriver(make(2, {opponent: 'bot', player: 1}), 1, 2)).toThrow('slots');
  });
  it('uses arbitrary dense human slots in an eight-fighter mix and ignores forged local CPU decisions', () => {
    const controllers = roles(8, [1, 6]), a = make(8, {controllers, opponent: 'bot', player: 0}), b = make(8, {controllers, opponent: 'human', player: 6});
    expect(a.controllerKinds).toEqual(controllers); expect(a.stateHash()).toBe(b.stateHash());
    for (let frame = 0; frame < 45; frame++) {
      const raw = inputs(8), clean = inputs(8);
      for (const slot of [1, 6]) raw[slot] = clean[slot] = normalizeInput({...neutralInput(), x: slot === 1 ? -0.3 : 0.3, jump: slot === 6 && frame < 8, attack: frame === 25});
      for (const [slot, role] of controllers.entries()) if (role === 'cpu') raw[slot] = normalizeInput({...neutralInput(), x: -1, jump: true, attack: true, strong: true, special: true});
      a.step(raw); b.step(clean); expect(a.stateHash()).toBe(b.stateHash());
      if (frame === 0) { expect(a.fighters[6]!.previous.jump).toBe(true); expect(a.fighters[1]!.previous.x).toBe(-0.3); }
    }
  });
  it('copies/freezes explicit roles and sparse seat IDs, exposes dense/controller metadata, and rejects incompatible restores atomically', () => {
    const controllers: PlayerControllerMode[] = ['cpu', 'human', 'cpu'], seatIds = [1, 4, 7];
    const match = make(3, {controllers, seatIds, opponent: 'bot', player: 2});
    controllers[0] = 'human'; seatIds[0] = 0;
    expect(match.controllerKinds).toEqual(['cpu', 'human', 'cpu']); expect(match.fighters.map(f => f.seatId)).toEqual([1, 4, 7]);
    expect(Object.isFrozen(match.controllerKinds)).toBe(true); expect(Object.isFrozen(match.options.seatIds)).toBe(true);
    expect(match.snapshot().fighters.map(f => [f.seatId, f.controllerKind])).toEqual([[1, 'cpu'], [4, 'human'], [7, 'cpu']]);
    expect(match.fighters.map(f => f.slot)).toEqual([0, 1, 2]);
    expect(() => { (match.fighters[1] as {seatId: number}).seatId = 0; }).toThrow();
    const state = match.captureState(), hash = match.stateHash();
    expect(() => match.restoreState({...state, fighters: state.fighters.map((f, slot) => ({...f, seatId: slot === 0 ? 2 : f.seatId}))})).toThrow('Incompatible');
    expect(match.stateHash()).toBe(hash);
    expect(() => make(3, {controllers: ['human', 'human', 'cpu'], seatIds: [1, 4, 7]}).restoreState(state)).toThrow('Incompatible');
    expect(() => make(3, {controllers: ['cpu', 'human', 'cpu'], seatIds: [0, 4, 7]}).restoreState(state)).toThrow('Incompatible');
    match.restoreState(state); expect(match.stateHash()).toBe(hash);
  });
  it('rejects OFF/invalid/sparse role arrays and duplicate/out-of-range seat IDs instead of guessing controls', () => {
    const match = make(), selected = match.content, poses = match.poses;
    for (const controllers of [[], ['human'], Array(8), [...roles(8, [0]).slice(0, 7), 'off'], 'cpu']) {
      expect(() => new LocalMatch(selected, poses, {controllers: controllers as MatchOptions['controllers']})).toThrow('controller');
    }
    for (const seatIds of [[], [0, 1], Array(8), Array(8).fill(0), [-1, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 5, 6, 8]]) {
      expect(() => new LocalMatch(selected, poses, {seatIds})).toThrow('seat');
    }
  });
  it('runs a repeatable all-CPU local exhibition with genuine actions/events and complete brain/RNG restore', () => {
    const controllers = roles(8, []), a = make(8, {controllers, seconds: 3}), b = make(8, {controllers, seconds: 3});
    const emitted: ConfirmedEvents[] = [];
    for (let frame = 0; frame < 60; frame++) { a.step(inputs(8)); b.step(inputs(8)); }
    const saved = a.captureState(); expect(saved.bots).toHaveLength(8);
    for (let frame = 60; frame < 180; frame++) {
      a.step(inputs(8)); b.step(Array.from({length: 8}, () => normalizeInput({...neutralInput(), jump: true, attack: true, special: true})));
      emitted.push(batch(a, frame));
    }
    expect(a.phase).toBe('ended'); expect(a.stateHash()).toBe(b.stateHash());
    expect(emitted.some(frame => frame.events.some(event => ['hit', 'jump', 'shot'].includes(event.type)))).toBe(true);
    const hash = a.stateHash(); a.restoreState(saved); for (let frame = 60; frame < 180; frame++) a.step(inputs(8));
    expect(a.stateHash()).toBe(hash);
    expect(() => new RollbackDriver(make(8, {controllers}), 0, 8)).toThrow('human');
  });
  it('preserves copied Kirby and all existing mutable fighter fields while restoring a mixed-role match', () => {
    const match = make(8, {controllers: roles(8, [1, 5]), seatIds: [0, 1, 2, 3, 4, 5, 6, 7]});
    const kirby = match.fighters[3]!; kirby.copyAbility = 'Mr'; kirby.airJumpTurn = 2; kirby.hammerBoostUsed = true;
    kirby.samusCharge = 12; kirby.samusSideTicks = 17; kirby.victims.add('mixed-snapshot');
    const state = match.captureState(), hash = match.stateHash();
    kirby.copyAbility = null; kirby.airJumpTurn = 0; kirby.hammerBoostUsed = false; kirby.samusCharge = 0; kirby.victims.clear();
    match.restoreState(state); expect(match.stateHash()).toBe(hash);
    expect(kirby).toMatchObject({copyAbility: 'Mr', airJumpTurn: 2, hammerBoostUsed: true, samusCharge: 12, samusSideTicks: 17, seatId: 3});
    for (let frame = 0; frame < 30; frame++) match.step(inputs(8)); const after = match.stateHash();
    match.restoreState(state); for (let frame = 0; frame < 30; frame++) match.step(inputs(8)); expect(match.stateHash()).toBe(after);
  });
  it('confirms one human plus seven CPU slots immediately without transmitting any CPU input', () => {
    const controllers = roles(8, [5]), match = make(8, {controllers, opponent: 'bot', player: 5}), reference = make(8, {controllers, player: 0});
    const driver = new RollbackDriver(match, 5, 8), actual: ConfirmedEvents[] = [], expected: ConfirmedEvents[] = [];
    const echoed: {frame: number; input: PlayerInput}[] = [];
    for (let frame = 0; frame < 90; frame++) {
      const input = normalizeInput({...neutralInput(), x: frame % 30 < 10 ? -0.3 : 0, jump: frame % 30 >= 20, attack: frame % 20 === 0});
      expect(driver.advance(input)).toBe(true); const row = inputs(8); row[5] = input; reference.step(row);
      expected.push(batch(reference, frame)); actual.push(...driver.drainConfirmedEvents()); echoed.push({frame, input});
      if (frame >= 5) { const echo = echoed.shift()!; driver.receive(echo.frame, 5, echo.input); }
      expect(driver.confirmedFrame).toBe(frame); expect(driver.stats.predictionFrames).toBe(0); expect(driver.stateHash(frame)).toBe(reference.stateHash());
    }
    for (const echo of echoed) driver.receive(echo.frame, 5, echo.input);
    expect(actual).toEqual(expected); expect(driver.drainConfirmedEvents()).toEqual([]);
  });
  it.each([{count: 8, humans: [1, 6], seatIds: [0, 1, 2, 3, 4, 5, 6, 7]}, {count: 5, humans: [0, 2], seatIds: [0, 2, 4, 6, 7]}])('converges two delayed human peers plus CPUs with dense roles and sparse seats ($count fighters)', ({count, humans, seatIds}) => {
    const controllers = roles(count, humans), total = 90, reference = make(count, {controllers, seatIds, countdown: 3});
    const timeline = Array.from({length: total}, (_, frame) => Array.from({length: count}, (_, slot) => normalizeInput({...neutralInput(), x: frame < 25 ? (slot % 2 ? -0.3 : 0.3) : 0,
      attack: frame % (18 + slot) === 7, jump: frame % 40 >= 29, special: frame === 62, specialDirection: 'neutral'})));
    const expected: ConfirmedEvents[] = [], hashes: string[] = [];
    for (let frame = 0; frame < total; frame++) { reference.step(timeline[frame]!); expected.push(batch(reference, frame)); hashes.push(reference.stateHash()); }
    const drivers = humans.map(localSlot => new RollbackDriver(make(count, {controllers, seatIds, countdown: 3, player: localSlot}), localSlot, count, {historyLimit: 32, maxPrediction: 8}));
    const pending: {due: number; peer: number; frame: number; slot: number; input: PlayerInput}[] = [], received: ConfirmedEvents[][] = [[], []];
    for (let tick = 0; tick < total + 40; tick++) {
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.due <= tick) { const message = pending.splice(i, 1)[0]!; drivers[message.peer]!.receive(message.frame, message.slot, message.input); }
      for (const [peer, driver] of drivers.entries()) {
        const frame = driver.frame, slot = humans[peer]!;
        if (frame < total && driver.advance(timeline[frame]![slot]!)) for (let target = 0; target < drivers.length; target++) pending.push({due: tick + 1 + (frame + peer + target) % 5, peer: target, frame, slot, input: timeline[frame]![slot]!});
        const confirmed = driver.drainConfirmedEvents(); received[peer]!.push(...confirmed);
        for (const frame of confirmed) expect(driver.stateHash(frame.frame)).toBe(hashes[frame.frame]);
      }
      if (!pending.length && drivers.every(driver => driver.confirmedFrame === total - 1)) break;
    }
    drivers.forEach((driver, peer) => {
      expect(driver.confirmedFrame).toBe(total - 1); expect(driver.stats.rollbacks).toBeGreaterThan(0); expect(driver.match.stateHash()).toBe(hashes.at(-1));
      expect(received[peer]).toEqual(expected); expect(driver.stats.historyFrames).toBeLessThanOrEqual(32); expect(driver.failure).toBeNull();
    });
  });
  it('rejects forged CPU packets and CPU local slots without mutating authoritative match state', () => {
    const controllers = roles(8, [5]), match = make(8, {controllers}), driver = new RollbackDriver(match, 5, 8), hash = match.stateHash();
    expect(() => driver.receive(0, 0, normalizeInput({...neutralInput(), attack: true}))).toThrow('CPU');
    expect(driver.failure).toContain('CPU'); expect(match.stateHash()).toBe(hash); expect(() => driver.advance(neutralInput())).toThrow('CPU');
    expect(() => new RollbackDriver(make(8, {controllers}), 0, 8)).toThrow('CPU');
  });
});
