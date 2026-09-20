import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, loadGameStage, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchOptions, type PlayerInput } from '../../lib/game/match.ts';
import { RollbackDriver, normalizeInput, type ConfirmedEvents } from '../../lib/game/rollback.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import { matchSpawnPoints } from '../../lib/game/spawns.ts';
import { MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import type { FighterKind } from '../../lib/game/data.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('five-to-eight-player prototype using original local disc resources', () => {
  let battlefield: GameContent, final: GameContent;
  const rigs: GameRigs[] = [];
  const kinds = (count: number): FighterKind[] => Array.from({length: count}, (_, slot) => (['Fx', 'Mr', 'Kb'] as const)[slot % 3]!);
  const make = (count = 8, stage = battlefield, options: MatchOptions = {}) => {
    const content = rosterPlayers(stage, kinds(count)), rig = new GameRigs(content); rigs.push(rig);
    const match = new LocalMatch(content, rig, {opponent: 'human', countdown: 0, seed: 7007, ...options}); match.start(); return match;
  };
  const idle = (match: LocalMatch, frames = 1) => { for (let frame = 0; frame < frames; frame++) match.step(match.fighters.map(neutralInput)); };
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      battlefield = await loadGameContent(session, new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer);
      final = {...battlefield, ...await loadGameStage(session, 'final')};
    } finally { await disc.close(); }
  });
  afterEach(() => { for (const rig of rigs) rig.dispose(); rigs.length = 0; });

  it.each([5, 6, 7, 8])('places %i fighters distinctly on both supported stages without altering native four-point data', count => {
    for (const stage of [battlefield, final]) {
      const native = structuredClone(stage.stage.spawns), match = make(count, stage), expected = matchSpawnPoints(stage.stage, count);
      expect(match.fighters).toHaveLength(count); expect(match.snapshot().fighters).toHaveLength(count);
      expect(new Set(match.fighters.map(f => `${f.x}:${f.y}`)).size).toBe(count);
      for (const [slot, fighter] of match.fighters.entries()) {
        expect([fighter.x, fighter.y, 0]).toEqual(expected[slot]); expect(fighter.grounded).toBe(true);
        const floor = stage.stage.floors.find(floor => floor.id === fighter.floor)!;
        expect(floor).toBeDefined(); expect(fighter.x).toBeGreaterThanOrEqual(Math.min(floor.a[0], floor.b[0])); expect(fighter.x).toBeLessThanOrEqual(Math.max(floor.a[0], floor.b[0]));
        expect(fighter.y).toBe(floor.a[1]); expect(fighter.x).toBeGreaterThan(stage.stage.blast.left); expect(fighter.x).toBeLessThan(stage.stage.blast.right);
        if (slot > 0) {
          const other = match.fighters[slot - 1]!;
          const gap = Math.abs(fighter.x + fighter.content.profile.nudgeOffset * fighter.facing - other.x - other.content.profile.nudgeOffset * other.facing);
          expect(gap).toBeGreaterThanOrEqual(fighter.content.profile.nudgeRadius + other.content.profile.nudgeRadius);
        }
      }
      idle(match, 2); expect(match.fighters.every(f => f.grounded && f.stocks === 3)).toBe(true);
      expect(stage.stage.spawns).toEqual(native); expect(stage.stage.spawns).toHaveLength(4);
    }
  });
  it.each([5, 6, 7, 8])('keeps %i WASM slots independent and round-trips every full fighter/runtime/memory state', count => {
    const a = make(count), b = make(count), initial = a.captureState();
    expect(initial.fighters).toHaveLength(count); expect(initial.physics.byteLength).toBe(131072);
    expect(a.content.physics.wasm.memory).not.toBe(b.content.physics.wasm.memory);
    const bHash = b.stateHash(); a.content.physics.random();
    for (const f of a.fighters) expect(a.content.physics.air(f.slot, {x: 0, y: 0}, 0, false).y).toBeCloseTo(-f.content.profile.attributes.gravity, 6);
    expect(b.stateHash()).toBe(bHash); a.restoreState(initial); expect(a.stateHash()).toBe(bHash);
    const input = (frame: number, slot: number) => normalizeInput({...neutralInput(), x: frame < 8 ? (slot % 2 ? -0.3 : 0.3) : 0, jump: frame >= 10 && frame < 17, attack: frame === 22, special: frame === 31, specialDirection: 'down'});
    for (let frame = 0; frame < 35; frame++) { const inputs = a.fighters.map(f => input(frame, f.slot)); a.step(inputs); b.step(inputs); }
    expect(a.stateHash()).toBe(b.stateHash());
    const saved = a.captureState(), hash = a.stateHash(); idle(a, 20); const after = a.stateHash(); a.restoreState(saved);
    expect(a.stateHash()).toBe(hash); idle(a, 20); expect(a.stateHash()).toBe(after);
    expect(saved.fighters).toHaveLength(count); expect(saved.soundCursors).toHaveLength(count); expect(saved.bots).toHaveLength(count);
  });
  it('rejects a ninth LocalMatch fighter and RollbackDriver participant before stepping', () => {
    const content = rosterPlayers(battlefield, kinds(8));
    const invalid = {...content, fighters: [...content.fighters, content.fighters[0]] as GameContent['fighters']};
    expect(() => new LocalMatch(invalid, {sample() {}, point: (_fighter, _bone, offset) => offset}, {opponent: 'human'})).toThrow('Invalid');
    expect(() => new RollbackDriver({fighters: Array.from({length: 9}), options: {opponent: 'human'}, frame: 0, phase: 'ready'} as unknown as LocalMatch, 0, 9)).toThrow('slots');
    expect(() => content.physics.configure(invalid.fighters.map(f => f.profile))).toThrow('profiles');
  });
  it('retains slot7 input/events, all eight capture partners and global projectile limits through restore', () => {
    const match = make(); match.step(match.fighters.map(f => ({...neutralInput(), jump: f.slot === 7}))); idle(match, 8);
    expect(match.fighters[7]!.jumpsUsed).toBe(1); expect(match.fighters.slice(0, 7).every(f => f.jumpsUsed === 0)).toBe(true);
    for (let slot = 0; slot < 4; slot++) match.combat.catch(match.fighters[slot]!, match.fighters[slot + 4]!);
    idle(match, 2); const saved = match.captureState();
    expect(saved.fighters.map(f => f.combat.partner)).toEqual([4, 5, 6, 7, 0, 1, 2, 3]);
    match.combat.release(match.fighters[3]!); match.restoreState(saved); expect(match.fighters[7]!.combat.partner).toBe(3);
    for (let shot = 0; shot < 40; shot++) match.projectiles.spawn(match.fighters[7]!, 'fireball', match.poses);
    expect(match.projectiles.items).toHaveLength(32); const projectiles = match.captureState(), projectileHash = match.stateHash();
    match.projectiles.consume(match.projectiles.items[0]!.id); match.restoreState(projectiles);
    expect(match.projectiles.items).toHaveLength(32); expect(match.stateHash()).toBe(projectileHash);
  });
  it('resolves hits against upper slots, not only original four opponents', () => {
    const match = make();
    match.fighters.forEach((fighter, slot) => { fighter.x = slot === 0 ? -6 : slot < 4 ? -60 + slot * 10 : 6 + (slot - 4) * 0.1; fighter.y = 0; fighter.grounded = true; fighter.floor = 1; match.poses.sample(fighter); });
    match.step(match.fighters.map(f => ({...neutralInput(), attack: f.slot === 0}))); idle(match, 12);
    expect(match.fighters.slice(4).every(f => f.percent > 0)).toBe(true);
  });
  it.each([5, 6, 7, 8])('finds the last survivor and all-KO draw across %i slots', count => {
    const match = make(count, battlefield, {stocks: 1});
    match.fighters.slice(0, -1).forEach(f => { f.x = battlefield.stage.blast.right + 10; }); idle(match);
    expect(match.winner).toBe(count - 1); expect(match.phase).toBe('ended');
    const draw = make(count, battlefield, {stocks: 1}); draw.fighters.forEach(f => { f.x = battlefield.stage.blast.right + 10; }); idle(draw);
    expect(draw.winner).toBeNull(); expect(draw.phase).toBe('ended');
  });
  it('converges eight independent rollback worlds to every straight-through hash and confirmed event/audio batch', () => {
    const frames = 80, reference = make(8, battlefield, {countdown: 3});
    const inputs = Array.from({length: frames}, (_, frame) => Array.from({length: 8}, (_, slot): PlayerInput => normalizeInput({...neutralInput(),
      x: frame >= 3 && frame < 23 ? (slot < 4 ? 1 : -1) : 0, jump: frame >= 53 && frame < 61, attack: frame === 26 + slot || frame === 39 + slot % 3,
      strong: frame === 44, special: frame === 67, specialDirection: 'down'})));
    const expected: ConfirmedEvents[] = [], hashes: string[] = [], referenceTimes: number[] = [];
    for (let frame = 0; frame < frames; frame++) {
      const start = performance.now(); reference.step(inputs[frame]!); hashes.push(reference.stateHash()); referenceTimes.push(performance.now() - start);
      expected.push({frame, events: structuredClone(reference.events), audio: {specialScopes: reference.fighters.map(f => f.special?.serial ?? null), ended: reference.phase === 'ended'}});
    }
    const worlds = Array.from({length: MAX_MATCH_PLAYERS}, (_, local) => new RollbackDriver(make(8, battlefield, {countdown: 3}), local, 8, {historyLimit: 32, maxPrediction: 8}));
    expect(new Set(worlds.map(driver => driver.match.content.physics.wasm.memory)).size).toBe(8);
    const received: ConfirmedEvents[][] = worlds.map(() => []);
    const pending: {due: number; target: number; frame: number; slot: number; input: PlayerInput}[] = [];
    const start = performance.now();
    for (let tick = 0; tick < 200; tick++) {
      // Slot-local inputs are broadcast to all worlds, including idempotent local echoes.
      for (let packet = pending.length - 1; packet >= 0; packet--) if (pending[packet]!.due <= tick) {
        const {target, frame, slot, input} = pending.splice(packet, 1)[0]!; worlds[target]!.receive(frame, slot, input);
      }
      for (const [slot, driver] of worlds.entries()) {
        const frame = driver.frame;
        if (frame < frames && driver.advance(inputs[frame]![slot]!)) for (let target = 0; target < worlds.length; target++) pending.push({due: tick + 1 + (frame * 3 + slot + target * 2) % 5, target, frame, slot, input: inputs[frame]![slot]!});
        const batches = driver.drainConfirmedEvents(); received[slot]!.push(...batches);
        for (const batch of batches) expect(driver.stateHash(batch.frame)).toBe(hashes[batch.frame]);
      }
      if (worlds.every(driver => driver.confirmedFrame === frames - 1) && !pending.length) break;
    }
    for (const [slot, driver] of worlds.entries()) {
      expect(driver.frame).toBe(frames); expect(driver.confirmedFrame).toBe(frames - 1); expect(driver.match.stateHash()).toBe(hashes.at(-1));
      expect(received[slot]).toEqual(expected); expect(driver.drainConfirmedEvents()).toEqual([]); expect(driver.stats.historyFrames).toBeLessThanOrEqual(32);
      expect(driver.stats.rollbacks).toBeGreaterThan(0); expect(driver.failure).toBeNull();
    }
    expect(expected.some(batch => batch.events.some(event => event.player >= 4))).toBe(true);
    const sorted = [...referenceTimes].sort((a, b) => a - b);
    const benchmark = {scope: 'Node CPU poses + full snapshot/SHA256; not browser/WAN timing', fighters: 8, worlds: 8, frames,
      referenceMeanMs: +(referenceTimes.reduce((a, b) => a + b, 0) / frames).toFixed(3), referenceP95Ms: +sorted[Math.floor(sorted.length * 0.95)]!.toFixed(3),
      rollbackStressMs: +(performance.now() - start).toFixed(1), resimulatedFrames: worlds.reduce((sum, driver) => sum + driver.stats.resimulatedFrames, 0),
      memoryBytesPerSnapshot: reference.captureState().physics.byteLength, maxRetainedFramesPerWorld: 32};
    console.log('EIGHT_PLAYER_BENCHMARK', JSON.stringify(benchmark));
    if (process.env.SMASH_CAPACITY_BENCHMARK_PATH) writeFileSync(process.env.SMASH_CAPACITY_BENCHMARK_PATH, `${JSON.stringify(benchmark, null, 2)}\n`);
  }, 90_000);
});
