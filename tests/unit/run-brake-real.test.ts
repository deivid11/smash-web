import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { commandValue, hasMeleeRun } from '../../lib/game/locomotion.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

// Original ground locomotion (ftCo_Dash / Run / RunBrake / TurnRun) instead of a single
// Run state that stood in Wait1 while sliding and flipped its facing mid-skid.
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original dash, run brake and run turn', () => {
  let base: GameContent, content: GameContent, rig: GameRigs | undefined, game: LocalMatch;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 120000);
  afterEach(() => { rig?.dispose(); rig = undefined; });
  const make = (kind: 'Fx' | 'Mr' = 'Fx') => {
    content = rosterPair(base, kind, 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    const floor = content.stage.floors.find((entry) => !entry.oneWay)!;
    game.fighters.forEach((f, i) => { f.x = i ? 70 : -40; f.y = floor.a[1]; f.grounded = true; f.floor = floor.id; f.facing = 1; rig!.sample(f); });
  };
  const step = (input: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...input }, neutralInput()]);
  const ticks = (count: number, input: Partial<PlayerInput> = {}) => { for (let i = 0; i < count; i++) step(input); };
  const p = () => game.fighters[0]!;

  it('loads Dash, RunBrake and TurnRun with their original script commands', () => {
    make();
    const fox = content.fighters[0]!;
    expect(hasMeleeRun(fox)).toBe(true);
    // PlFx: cmd_vars[0] allows Run from Dash frame 12; RunBrake allows turning until frame 15.
    expect(commandValue(fox, 'Dash', 0, 11)).toBe(0);
    expect(commandValue(fox, 'Dash', 0, 12)).toBe(1);
    expect(commandValue(fox, 'RunBrake', 0, 14)).toBe(1);
    expect(commandValue(fox, 'RunBrake', 0, 15)).toBe(0);
    expect(base.common.runBrakeStick).toBeCloseTo(0.625, 5);
    expect(base.common.runTurnStick).toBeCloseTo(-0.375, 5);
  });

  it('dashes at the full initial speed and turns into Run while forward is held', () => {
    make();
    step({ x: 1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Dash', facing: 1 });
    expect(p().velocity.x).toBeCloseTo(p().content.profile.attributes.dashInitial, 4);
    ticks(14, { x: 1 });
    expect(p().animation).toBe('Run');
    expect(p().velocity.x).toBeCloseTo(p().content.profile.attributes.runSpeed, 3);
  });

  it('brakes a released run with the RunBrake skid, then stands', () => {
    make();
    ticks(40, { x: 1 });
    step();
    expect(p()).toMatchObject({ state: 'idle', animation: 'RunBrake', facing: 1 });
    let frames = 1;
    while (p().animation === 'RunBrake' && frames < 60) { step(); frames++; }
    expect(p().animation).toBe('Wait1');
    expect(frames).toBeLessThanOrEqual(31);
    ticks(20);
    expect(p().velocity.x).toBe(0);
  });

  it('crouch cancels the skid', () => {
    make();
    ticks(40, { x: 1 });
    step();
    expect(p().animation).toBe('RunBrake');
    step({ y: -1, down: true });
    expect(p().state).toBe('crouch');
  });

  it('smashing back during the dash re-dashes the other way at once (dash dance)', () => {
    make();
    ticks(6, { x: 1 });
    const forward = p().velocity.x;
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Dash', facing: -1 });
    expect(p().velocity.x).toBeCloseTo(forward - p().content.profile.attributes.dashInitial, 4);
    let frames = 1;
    while (p().velocity.x > -0.5 && frames < 20) { step({ x: -1 }); frames++; }
    expect(frames).toBeLessThanOrEqual(8);
  });

  it('pulling back from a run skids through TurnRun and faces the new way only once stopped', () => {
    make();
    ticks(40, { x: 1 });
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'TurnRun', facing: 1 });
    let frames = 1;
    while (p().facing === 1 && frames < 40) {
      expect(p().velocity.x).toBeGreaterThan(-0.2);
      step({ x: -1 }); frames++;
    }
    expect(p().facing).toBe(-1);
    ticks(20, { x: -1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Run' });
    expect(p().velocity.x).toBeLessThan(-1);
  });

  it('stops a braking slide at the ledge instead of carrying off the stage (ft_80084280)', () => {
    make();
    // The solid floor that ends at the main stage's right ledge.
    const floor = content.stage.floors.filter((entry) => !entry.oneWay).sort((a, b) => Math.max(b.a[0], b.b[0]) - Math.max(a.a[0], a.b[0]))[0]!;
    const edge = Math.max(floor.a[0], floor.b[0]);
    p().x = Math.max(edge - 70, Math.min(floor.a[0], floor.b[0]) + 1); p().y = Math.max(floor.a[1], floor.b[1]); p().floor = floor.id; rig!.sample(p());
    step();
    let frames = 0;
    while (p().x < edge - 12 && frames < 120) { step({ x: 1 }); frames++; }
    expect(p().grounded).toBe(true);
    ticks(45);
    expect(p()).toMatchObject({ grounded: true, state: 'idle' });
    expect(p().x).toBeLessThanOrEqual(edge);
    expect(p().velocity.x).toBe(0);
  });

  it('doubles standing friction above walk speed (ft_80084F3C), unlike the run brake', () => {
    make();
    const physics = content.physics, fox = content.fighters[0]!.profile.attributes;
    expect(physics.stationaryGround(0, 2.2)).toBeCloseTo(2.2 - 2 * fox.friction, 5);
    expect(physics.ground(0, 2.2, 0)).toBeCloseTo(2.2 - fox.friction, 5);
    expect(physics.stationaryGround(0, 1)).toBeCloseTo(1 - fox.friction, 5);
    // Shielding out of a full run stops sooner than letting it brake.
    const slide = (input: Partial<PlayerInput>) => { make(); ticks(40, { x: 1 }); const start = p().x; ticks(40, input); return p().x - start; };
    expect(slide({ shield: true })).toBeLessThan(slide({}));
  });
});
