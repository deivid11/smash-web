import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, rosterPlayers } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { RollbackDriver, normalizeInput } from '../../lib/game/rollback.ts';
import { floorY, MAX_FLOOR_SLOPE } from '../../lib/game/data.ts';
import { SUPPORTED_STAGES, stagePlayerLimit } from '../../lib/game/stages.ts';
import { MUSIC_TRACKS } from '../../lib/game/music.ts';
import { matchSpawnPoints } from '../../lib/game/spawns.ts';
import { validRules } from '../../lib/net/protocol.ts';
import { readCorneriaFlyby, applyCorneriaFlyby } from '../../web/src/render/corneria-flyby.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Corneria registration', () => {
  it('registers the stage, its music, bounded assets, verified static area and player cap', () => {
    const stage = SUPPORTED_STAGES.find(entry => entry.id === 'corneria')!;
    expect(stage.asset).toBe('GrCn.dat');
    // grcorneria.c disables collision joints 0–2 and 5–7 at load (mpLib_80057BC0); 3 (hull) and 4 (nose floor) stay live.
    expect('staticAreas' in stage && [...stage.staticAreas]).toEqual([3, 4]);
    expect(MUSIC_TRACKS.corneria).toBe('audio/corneria.hps');
    for (const name of ['GrCn.dat', 'audio/corneria.hps']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['GrCn.usd', 'audio/vl_corneria.hps', 'audio/corneria.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(validRules({ stage: 'corneria', stocks: 3, timeSeconds: 180 })).toBe(true);
    expect(stagePlayerLimit('corneria')).toBe(8);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Corneria original ISO integration', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)),
        new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'corneria');
    } finally { await disc.close(); }
  }, 30000);
  afterEach(() => rig?.dispose());
  const make = (kinds: readonly ('Ca' | 'Fx' | 'Mr')[] = ['Ca', 'Fx']) => {
    rig?.dispose();
    const content = kinds.length === 2 ? rosterPair(base, kinds[0]!, kinds[1]!) : rosterPlayers(base, kinds);
    rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 });
    game.start();
    return game;
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  it('keeps the always-active Great Fox hull (area 3) and nose floor (area 4) with the original ledges', () => {
    const stage = base.stage;
    expect(stage.floors.map(floor => floor.id)).toEqual([...Array.from({ length: 18 }, (_, i) => 9 + i), 27, 28, 29]);
    expect(stage.floors.filter(floor => floor.id >= 27).every(floor => floor.oneWay)).toBe(true); // the nose floor is a drop-through platform
    for (const floor of stage.floors) {
      const run = Math.abs(floor.a[0] - floor.b[0]), rise = Math.abs(floor.a[1] - floor.b[1]);
      expect(run).toBeGreaterThan(0.001);
      expect(rise / run).toBeLessThanOrEqual(MAX_FLOOR_SLOPE);
    }
    expect(stage.ledges).toHaveLength(3);
    const sorted = [...stage.ledges].sort((a, b) => a.x - b.x);
    expect(sorted[0]!.x).toBeCloseTo(-148.4, 1); expect(sorted[0]!.facing).toBe(1);
    expect(sorted[2]!.x).toBeCloseTo(128.8, 1); expect(sorted[2]!.facing).toBe(-1);
    expect(stage.spawns.length).toBeGreaterThanOrEqual(4);
    expect(stage.blast.bottom).toBeLessThan(0); expect(stage.blast.top).toBeGreaterThan(100);
  });
  it('spawns grounded on the sloped deck and follows the slope while walking', () => {
    make();
    const f = game.fighters[0];
    expect(f.grounded).toBe(true);
    const floor = base.stage.floors.find(floor => floor.id === f.floor)!;
    expect(f.y).toBeCloseTo(floorY(floor, f.x), 3);
    const before = { x: f.x, y: f.y };
    for (let i = 0; i < 30; i++) step({ x: -1, walk: true });
    expect(f.grounded).toBe(true);
    expect(f.x).toBeLessThan(before.x);
    expect(f.y).not.toBeCloseTo(before.y, 1); // The deck is sloped: walking changes height.
    const support = base.stage.floors.find(floor => floor.id === f.floor)!;
    expect(f.y).toBeCloseTo(floorY(support, f.x), 3);
  });
  it('lands from a hop back onto the slope it left', () => {
    make();
    const f = game.fighters[0];
    step({ jump: true });
    for (let i = 0; i < 10 && !f.grounded; i++) step({ jump: true });
    for (let i = 0; i < 60 && !f.grounded; i++) step();
    expect(f.grounded).toBe(true);
    const support = base.stage.floors.find(floor => floor.id === f.floor)!;
    expect(f.y).toBeCloseTo(floorY(support, f.x), 3);
  });
  it('grabs the original nose ledge when falling beside it', () => {
    make();
    const f = game.fighters[0];
    const nose = [...base.stage.ledges].sort((a, b) => a.x - b.x)[0]!;
    f.grounded = false; f.floor = null; f.state = 'fall'; f.animation = 'Fall';
    f.x = nose.x - 3; f.y = nose.y + 6; f.velocity = { x: 0, y: -0.5 }; f.facing = 1;
    const state = () => game.fighters[0].state;
    for (let i = 0; i < 40 && state() !== 'ledge'; i++) step();
    expect(state()).toBe('ledge');
    expect(f.combat.ledge).toBe(nose.id);
  });
  it('seats eight fighters on the sloped hull and four on native points', () => {
    const eight = matchSpawnPoints(base.stage, 8);
    expect(eight).toHaveLength(8);
    expect(new Set(eight.map((p) => `${p[0]}:${p[1]}`)).size).toBe(8);
    for (const [x] of eight) { expect(x).toBeGreaterThan(base.stage.blast.left); expect(x).toBeLessThan(base.stage.blast.right); }
    make(['Ca', 'Fx', 'Mr', 'Mr']);
    for (const fighter of game.fighters) expect(Number.isFinite(fighter.x) && Number.isFinite(fighter.y)).toBe(true);
    for (let i = 0; i < 30; i++) game.step(game.fighters.map(() => neutralInput()));
    expect(game.fighters.filter(fighter => fighter.stocks > 0)).toHaveLength(4);
    make(['Ca', 'Fx', 'Mr', 'Mr', 'Ca', 'Fx', 'Mr', 'Mr']);
    expect(game.fighters).toHaveLength(8);
    expect(game.fighters.every(fighter => fighter.grounded)).toBe(true);
    for (let i = 0; i < 30; i++) game.step(game.fighters.map(() => neutralInput()));
    expect(game.fighters.filter(fighter => fighter.stocks > 0)).toHaveLength(8);
  });
  it('replays the original city conveyor: 2/frame scroll, 8→9→4 chain, bounded altitude dips', () => {
    const flyby = readCorneriaFlyby(base.stageModel.archive)!;
    expect(flyby.speed).toBe(2); // yakumono_param->x88
    const scale = base.stage.scale, offsets = new Map<number, [number, number, number]>();
    const stub = { setObjectOffset: (index: number, x: number, y: number, z: number) => { offsets.set(index, [x, y, z]); }, setObjectClip: () => {}, setObjectState: () => {} };
    const at = (frame: number) => { offsets.clear(); applyCorneriaFlyby(stub as never, flyby, frame, scale); return new Map(offsets); };
    const zero = at(0);
    expect([...zero.keys()].sort()).toEqual([4, 8, 9]); // grCorneria_801E0678 battle layout
    expect(zero.get(8)![0]).toBeCloseTo(0, 3); expect(zero.get(9)![0]).toBeCloseTo(-3200, 3); expect(zero.get(4)![0]).toBeCloseTo(4000, 3);
    const early = at(60);
    expect((early.get(8)![0] - zero.get(8)![0]) * scale).toBeCloseTo(120, 2); // 2 world units per frame
    for (const frame of [0, 500, 1500, 5000, 20000]) for (const [root, [x, y]] of at(frame)) {
      const width = root === 4 ? 4800 : 3200;
      expect(x * scale).toBeLessThanOrEqual(width * scale / 2 + 1400 + 0.01); // despawn threshold
      expect(x * scale).toBeGreaterThan(width * scale / 2 + 1400 - 11200 * scale - 0.01);
      expect(y * scale).toBeGreaterThanOrEqual(-250 - 0.01); // cruising 250 below the hull (801DD674)
      expect(y * scale).toBeLessThanOrEqual(-50 * scale + 0.01); // dips close to 50·scale under it (801E2228)
    }
    expect(at(300).get(8)![1] * scale).toBeCloseTo(-250, 2); // matches open cruising, not on the low pass
    expect(at(1200).get(8)![1]).toBeGreaterThan(at(0).get(8)![1]); // mid-dip: the city has risen toward the ship
    expect(at(3599).get(8)![1] * scale).toBeCloseTo(-250, 2); // and settles before the cycle repeats
  });
  it('schedules the Arwing escort with the original model transform and banking clip', () => {
    const flyby = readCorneriaFlyby(base.stageModel.archive)!;
    expect(flyby.arwingScale).toBe(0.5); // yakumono_param->x70
    expect(flyby.arwingClip?.endFrame).toBe(435); // original banking maneuver, slot 2
    const scale = base.stage.scale;
    const states = new Map<number, unknown>();
    const stub = {
      setObjectOffset: () => {},
      setObjectClip: () => {},
      setObjectState: (index: number, state: unknown) => { states.set(index, state); },
    };
    const at = (frame: number) => { states.clear(); applyCorneriaFlyby(stub as never, flyby, frame, scale); return states.get(2) as { rotationY: number; scale: number; visible: boolean; animationFrame: number } | null; };
    expect(at(2400)).toBeNull(); // cruising alone
    const mid = at(2700)!;
    expect(mid.visible).toBe(true);
    expect(mid.rotationY).toBeCloseTo(-Math.PI / 2, 5); // grCorneria_801DED50
    expect(mid.scale).toBe(0.5);
    expect(mid.animationFrame).toBe(200);
    expect(at(3400)).toBeNull(); // gone again before the cycle repeats
  });
  it('captures, restores and reconciles late inputs deterministically on the slopes', () => {
    make();
    for (let i = 0; i < 45; i++) step({ x: 1 }, { x: -1 });
    const state = game.captureState(), hash = game.stateHash();
    for (let i = 0; i < 20; i++) step({ attack: i % 3 === 0 });
    game.restoreState(state);
    expect(game.stateHash()).toBe(hash);
    const selected = rosterPlayers(base, ['Ca', 'Fx']);
    const ra = new GameRigs(selected), rb = new GameRigs(selected);
    try {
      const match = new LocalMatch(selected, ra, { opponent: 'human', countdown: 0, seed: 31 });
      const reference = new LocalMatch(selected, rb, { opponent: 'human', countdown: 0, seed: 31 });
      match.start(); reference.start();
      const driver = new RollbackDriver(match, 0, 2, { maxPrediction: 6, historyLimit: 32 });
      const pending: Array<{ due: number; frame: number; input: PlayerInput }> = [];
      const input = (frame: number, slot: number) => normalizeInput({ ...neutralInput(), x: slot ? -0.6 : 0.9, jump: (frame + slot * 7) % 24 === 0, attack: frame % 31 === 0 });
      for (let tick = 0; tick < 260; tick++) {
        for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.due <= tick) { const p = pending.splice(i, 1)[0]!; driver.receive(p.frame, 1, p.input); }
        if (reference.frame < 140) {
          const frame = driver.frame, local = input(frame, 0);
          if (driver.advance(local)) {
            driver.receive(frame, 0, local);
            reference.step([local, input(frame, 1)]);
            pending.push({ due: tick + 1 + frame % 4, frame, input: input(frame, 1) });
          }
        }
        driver.drainConfirmedEvents();
        if (reference.frame === 140 && pending.length === 0) break;
      }
      expect(driver.confirmedFrame).toBe(139);
      expect(match.stateHash()).toBe(reference.stateHash());
      expect(driver.stats.rollbacks).toBeGreaterThan(0);
    } finally { ra.dispose(); rb.dispose(); }
  });
});
