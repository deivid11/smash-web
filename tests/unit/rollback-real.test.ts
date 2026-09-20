import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchOptions, type PlayerInput } from '../../lib/game/match.ts';
import { RollbackDriver, normalizeInput, type ConfirmedEvents } from '../../lib/game/rollback.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import { MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('two-to-four fighter state and bounded prototype rollback with real disc data', () => {
  let content: GameContent;
  const rigs: GameRigs[] = [];
  const make = (count = 4, options: MatchOptions = {}) => {
    const selected = rosterPlayers(content, ['Fx', 'Mr', 'Fx', 'Mr'].slice(0, count) as FighterKind[]);
    const rig = new GameRigs(selected); rigs.push(rig);
    const match = new LocalMatch(selected, rig, {opponent: 'human', countdown: 0, seed: 177, ...options});
    match.start(); return match;
  };
  const idle = (match: LocalMatch, count = 1) => { for (let i = 0; i < count; i++) match.step(match.fighters.map(neutralInput)); };
  const close = (match: LocalMatch) => match.fighters.forEach((f, i) => { f.x = i ? 6 + (i - 1) * 0.5 : -6; f.y = 0; f.floor = 1; f.grounded = true; match.poses.sample(f); });
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { content = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer); }
    finally { await disc.close(); }
  });
  afterEach(() => { for (const rig of rigs) rig.dispose(); rigs.length = 0; });

  it.each([2, 3, 4])('allocates %i distinct poses, original spawns and independently configured C slots', count => {
    const match = make(count);
    expect(match.fighters).toHaveLength(count); expect(match.snapshot().fighters).toHaveLength(count);
    expect(new Set(match.fighters.map(f => `${f.x}:${f.y}`)).size).toBe(count);
    for (const f of match.fighters) expect(match.content.physics.air(f.slot, {x: 0, y: 0}, 0, false).y).toBeCloseTo(-f.content.profile.attributes.gravity, 6);
    expect(() => match.content.physics.wasm.core_set_velocity(MAX_MATCH_PLAYERS, 0, 0, 1)).toThrow();
    expect(() => match.step([neutralInput()])).toThrow('one input');
  });
  it('uses one tick clock across countdown without decrementing the match timer', () => {
    const match = make(4, {countdown: 3}); idle(match, 3);
    expect(match.frame).toBe(3); expect(match.phase).toBe('playing'); expect(match.remainingFrames).toBe(180 * 60);
    idle(match); expect(match.frame).toBe(4); expect(match.remainingFrames).toBe(180 * 60 - 1);
  });
  it('hits every overlapping opponent, not only the opposite first-two slot', () => {
    const match = make(); close(match);
    match.step(match.fighters.map((_, i) => ({...neutralInput(), attack: i === 0}))); idle(match, 12);
    expect(match.fighters.slice(1).every(f => f.percent > 0)).toBe(true);
  });
  it('supports disjoint captures and restores partners/anchors without resource cloning', () => {
    const match = make(); close(match);
    match.combat.catch(match.fighters[0], match.fighters[2]!); match.combat.catch(match.fighters[1], match.fighters[3]!);
    idle(match, 2); const saved = match.captureState(), hash = match.stateHash();
    match.combat.release(match.fighters[0]); idle(match, 5); match.restoreState(saved);
    expect(match.stateHash()).toBe(hash); expect(match.fighters.map(f => f.combat.partner)).toEqual([2, 3, 0, 1]);
    expect(match.fighters[0].content).toBe(content.roster.get('Fx'));
    idle(match, 5); const replay = match.stateHash(); match.restoreState(saved); idle(match, 5); expect(match.stateHash()).toBe(replay);
  });
  it('keeps playing after an elimination, ranks all survivors and handles all-KO draws', () => {
    const match = make(4, {stocks: 1});
    match.fighters[0].x = content.stage.blast.right + 1; idle(match); expect(match.phase).toBe('playing');
    idle(match, 50); expect(match.fighters[0].stocks).toBe(0); expect(match.fighters[0].state).toBe('ko');
    match.fighters[1].x = content.stage.blast.right + 1; match.fighters[2]!.x = content.stage.blast.right + 1; idle(match);
    expect(match.winner).toBe(3); expect(match.phase).toBe('ended');
    const draw = make(4, {stocks: 1}); draw.fighters.forEach(f => { f.x = content.stage.blast.right + 1; }); idle(draw);
    expect(draw.winner).toBeNull(); expect(draw.phase).toBe('ended');
    const timeout = make(4, {seconds: 1}); timeout.fighters.forEach((f, i) => { f.percent = i === 2 ? 1 : 20; }); idle(timeout, 60);
    expect(timeout.winner).toBe(2);
  });
  it('does not share WASM RNG, attributes, result buffers or scratch between simultaneous worlds', () => {
    const a = make(), b = make(), c = make();
    expect(a.content.physics.wasm.memory).not.toBe(b.content.physics.wasm.memory);
    const initial = b.stateHash(); a.content.physics.random(); a.content.physics.ground(3, 1, 1);
    expect(b.stateHash()).toBe(initial);
    for (let frame = 0; frame < 20; frame++) { idle(a); idle(b); }
    idle(c, 20); expect(b.stateHash()).toBe(c.stateHash());
    expect(make(4, {seed: 178}).stateHash()).not.toBe(make(4, {seed: 177}).stateHash());
  });
  it('captures all mutable fighter/script/input fields, sound cursors, events, shots, projectile serial and RNG', () => {
    const match = make(); close(match);
    match.step(match.fighters.map((_, i) => ({...neutralInput(), special: i === 0, specialDirection: 'neutral', strong: i === 1})));
    idle(match, 14);
    const projectile = match.projectiles.spawn(match.fighters[1], 'fireball', match.poses);
    const saved = match.captureState(), hash = match.stateHash(), actor = match.fighters[0];
    expect(saved.projectiles.items.find(p => p.id === projectile.id)!.article).toBe('Mr');
    expect(saved.projectiles.items[0]).not.toHaveProperty('data');
    const random = match.content.physics.random(); idle(match, 15); const future = match.stateHash();
    match.restoreState(saved); expect(match.fighters[0]).toBe(actor); expect(match.stateHash()).toBe(hash);
    expect(match.projectiles.items.find(p => p.id === projectile.id)!.data).toBe(projectile.data);
    expect(match.content.physics.random()).toBe(random); idle(match, 15); expect(match.stateHash()).toBe(future);
    match.restoreState(saved); const serial = match.projectiles.spawn(match.fighters[1], 'fireball', match.poses).id;
    match.restoreState(saved); expect(match.projectiles.spawn(match.fighters[1], 'fireball', match.poses).id).toBe(serial);
    const snapshotHash = match.stateHash(saved); match.fighters[0].victims.add('new'); match.fighters[0].previous.x = 1;
    expect(match.stateHash(saved)).toBe(snapshotHash);
    const reordered = {...saved, fighters: saved.fighters.map(f => ({...f, victims: new Set([...f.victims].reverse())}))};
    expect(match.stateHash(reordered)).toBe(snapshotHash);
  });
  it('rebinds projectile resource keys when restoring into another independently loaded resource graph', () => {
    const source = make(); source.projectiles.spawn(source.fighters[1], 'fireball', source.poses);
    const state = source.captureState();
    // Separate article descriptors model an independent asset load; models remain shared.
    const roster = new Map([...content.roster].map(([kind, fighter]) => [kind, {...fighter, specials: {...fighter.specials, articles: {...fighter.specials.articles, projectile: fighter.specials.articles.projectile ? {...fighter.specials.articles.projectile} : undefined}}}]));
    const selected = rosterPlayers({...content, roster}, ['Fx', 'Mr', 'Fx', 'Mr']);
    const rig = new GameRigs(selected); rigs.push(rig);
    const target = new LocalMatch(selected, rig, {opponent: 'human', countdown: 0, seed: 177});
    target.restoreState(state);
    expect(target.projectiles.items[0]!.data).toBe(roster.get('Mr')!.specials.articles.projectile);
    expect(target.projectiles.items[0]!.data).not.toBe(source.projectiles.items[0]!.data);
    expect(target.stateHash()).toBe(source.stateHash()); idle(source, 10); idle(target, 10); expect(target.stateHash()).toBe(source.stateHash());
  });
  it('restores bot cooldowns and RNG while resuming independent 4-player practice worlds', () => {
    const match = make(4, {opponent: 'bot'}); idle(match, 45); const saved = match.captureState();
    idle(match, 80); const hash = match.stateHash(); match.restoreState(saved); idle(match, 80); expect(match.stateHash()).toBe(hash);
  });
  it.each([2, 3, 4])('reconciles delayed/out-of-order %i-player input to straight-through full-state hashes and exactly-once events', count => {
    const match = make(count, {countdown: 3}), reference = make(count, {countdown: 3}); close(match); close(reference);
    const driver = new RollbackDriver(match, 0, count, {maxPrediction: 6, historyLimit: 32});
    const pending: {due: number; frame: number; slot: number; input: PlayerInput}[] = [];
    const emitted: ConfirmedEvents[] = [], expected: ConfirmedEvents[] = [];
    const hashes = new Map<number, string>();
    const input = (frame: number, slot: number) => normalizeInput({...neutralInput(), attack: frame % (13 + slot) === 4, strong: frame % 37 === 20, jump: frame % 53 >= 42, x: frame % 60 < 35 ? 0 : slot % 2 ? -0.3 : 0.3, special: frame % 41 === 30, specialDirection: slot % 2 ? 'side' : 'neutral'});
    for (let tick = 0; tick < 180; tick++) {
      // Reverse order deliberately exercises future input arrival and several resimulations.
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.due <= tick) { const p = pending.splice(i, 1)[0]!; driver.receive(p.frame, p.slot, p.input); }
      if (reference.frame < 100) {
        const frame = driver.frame, local = input(frame, 0);
        if (driver.advance(local)) {
          driver.receive(frame, 0, local); // echoed local input
          const inputs = Array.from({length: count}, (_, slot) => input(frame, slot));
          reference.step(inputs); expected.push({frame, events: structuredClone(reference.events), audio: {specialScopes: reference.fighters.map(f => f.special?.serial ?? null), ended: reference.phase === 'ended'}}); hashes.set(frame, reference.stateHash());
          for (let slot = 1; slot < count; slot++) pending.push({due: tick + 1 + ((frame * 3 + slot) % 5), frame, slot, input: inputs[slot]!});
        }
      }
      const batches = driver.drainConfirmedEvents(); emitted.push(...batches);
      for (const batch of batches) { expect(driver.stateHash(batch.frame)).toBe(hashes.get(batch.frame)); driver.checkHash(batch.frame, hashes.get(batch.frame)!); }
      if (reference.frame === 100 && pending.length === 0) break;
    }
    expect(driver.confirmedFrame).toBe(99); expect(driver.frame).toBe(reference.frame);
    expect(match.stateHash()).toBe(reference.stateHash()); expect(emitted).toEqual(expected);
    expect(emitted.some(batch => batch.events.length)).toBe(true); expect(driver.drainConfirmedEvents()).toEqual([]);
    expect(driver.stats.rollbacks).toBeGreaterThan(0); expect(driver.stats.historyFrames).toBeLessThanOrEqual(32);
    expect(driver.stats.inputFrames).toBeLessThanOrEqual(32);
  });
  it('bounds prediction and handles duplicates, pruned stale input and severe hash mismatch explicitly', () => {
    const match = make(2), driver = new RollbackDriver(match, 0, 2, {maxPrediction: 2, historyLimit: 3});
    expect(driver.advance(neutralInput())).toBe(true); expect(driver.advance(neutralInput())).toBe(true);
    const hash = match.stateHash(); expect(driver.advance(neutralInput())).toBe(false); expect(match.stateHash()).toBe(hash);
    driver.receive(1, 1, neutralInput()); expect(driver.confirmedFrame).toBe(-1); driver.receive(0, 1, neutralInput());
    expect(driver.confirmedFrame).toBe(1); driver.receive(0, 1, neutralInput());
    expect(driver.drainConfirmedEvents()).toHaveLength(2);
    for (let i = 2; i < 7; i++) { driver.advance(neutralInput()); driver.receive(i, 1, neutralInput()); driver.drainConfirmedEvents(); }
    expect(driver.stats.historyFrames).toBe(3); expect(() => driver.receive(0, 1, neutralInput())).toThrow('Stale');
    expect(driver.failure).not.toBeNull(); expect(() => driver.advance(neutralInput())).toThrow();
    const desync = new RollbackDriver(make(2), 0, 2); desync.checkHash(0, '0'.repeat(64)); desync.advance(neutralInput());
    expect(() => desync.receive(0, 1, neutralInput())).toThrow('desync'); expect(desync.failure).toContain('desync');
  });
  it('corrects a predicted nonterminal frame and confirms terminal events once', () => {
    const match = make(2, {stocks: 1}); match.fighters[1].x = content.stage.blast.right - 0.001; match.fighters[1].y = 10; match.fighters[1].grounded = false;
    const driver = new RollbackDriver(match, 0, 2);
    driver.advance(neutralInput()); expect(driver.ended).toBe(false); expect(driver.drainConfirmedEvents()).toEqual([]);
    driver.receive(0, 1, {...neutralInput(), x: 1});
    expect(driver.ended).toBe(true); const events = driver.drainConfirmedEvents(); expect(events.flatMap(batch => batch.events).some(event => event.type === 'end')).toBe(true);
    driver.receive(0, 1, {...neutralInput(), x: 1}); expect(driver.drainConfirmedEvents()).toEqual([]); expect(driver.advance(neutralInput())).toBe(false);
    const predicted = make(2, {stocks: 1}); predicted.fighters[1].x = content.stage.blast.right + 1;
    const pending = new RollbackDriver(predicted, 0, 2); pending.advance(neutralInput());
    expect(predicted.phase).toBe('ended'); expect(pending.ended).toBe(false); expect(pending.drainConfirmedEvents()).toEqual([]);
    pending.receive(0, 1, neutralInput()); expect(pending.ended).toBe(true);
  });
});

describe('rollback canonical input validation', () => {
  it('canonicalizes missing optional buttons and preserves implicit special direction', () => {
    expect(normalizeInput(neutralInput())).toEqual(normalizeInput({...neutralInput(), shield: false, grab: false, walk: false}));
    expect(normalizeInput({...neutralInput(), special: true, x: 1}).specialDirection).toBeUndefined();
  });
  it.each([{x: NaN}, {x: 2}, {y: Infinity}, {jump: 1}, {shield: 'false'}, {specialDirection: 'sideways'}])('rejects malformed input %j', override => {
    expect(() => normalizeInput({...neutralInput(), ...override} as PlayerInput)).toThrow();
  });
});
