import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { SUPPORTED_STAGES, stagePlayerLimit } from '../../lib/game/stages.ts';
import { MUSIC_TRACKS } from '../../lib/game/music.ts';
import { validRules } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import {
  applyOnettRuntime, parkOnettCars, readOnettTraffic, type OnettLayout,
} from '../../web/src/render/onett-traffic.ts';
import { ONETT_LANE_LTR, ONETT_LANE_RTL, createOnettRuntime, type OnettRuntime } from '../../lib/game/onett.ts';
import type { MeleePhysics } from '../../lib/game/physics.ts';

const fakePhysics = { random: () => 0.5 } as unknown as MeleePhysics;

describe('Onett registration', () => {
  it('registers the stage, its music, SFX bank, joint-local areas and player cap', () => {
    const stage = SUPPORTED_STAGES.find(entry => entry.id === 'onett')!;
    expect(stage.asset).toBe('GrOt.dat');
    // Areas 0/1 (canopies) and 3/4 (rooftop) are joint-local; baked to rest poses.
    expect('staticAreas' in stage).toBe(false);
    expect('areaOffsets' in stage && [...stage.areaOffsets!]).toEqual([
      [0, -97.2, 50.22], [1, -44.55, 67.5], [3, 8.1, 35.55], [4, 8.1, 35.55],
    ]);
    // Map root 1 is never instantiated by the original init (gobjs 0/2/5/4/3 only).
    expect('hiddenObjects' in stage && [...stage.hiddenObjects!]).toEqual([1]);
    expect(MUSIC_TRACKS.onett).toBe('audio/onetto.hps');
    expect(SERVER_ASSETS).toContain('audio/us/onett.ssm');
    expect(validRules({ stage: 'onett', stocks: 3, timeSeconds: 180 })).toBe(true);
    expect(stagePlayerLimit('onett')).toBe(8);
  });
});

function syntheticLayout(): OnettLayout {
  return {
    carRoot: 3, carJoints: [11, 1, 6, 16], mirrorChild: [12, 2, 7, 17],
    restX: [-40, -10, 20, 60], restZ: [31.5, 31.5, 31.5, 31.5],
    carOfDraw: [0, 0, 1, 1, 2, 2, 3, 3],
    townRoot: 5, awningJoints: [14, 15], buildingRoot: 4,
    blinkJoints: [5, 2, 4], buildingClips: [null, { endFrame: 100, joints: [] } as never, null, { endFrame: 140, joints: [] } as never, { endFrame: 90, joints: [] } as never, null],
  };
}
interface JointCall { root: number; joint: number; value: unknown }
function drive(layout: OnettLayout, rt: OnettRuntime) {
  const translations: JointCall[] = [], rotations: JointCall[] = [], vis: JointCall[] = [];
  const hidden = new Map<string, boolean>();
  let clip: unknown = null, state: unknown = null;
  const stub = {
    setDrawHidden: (root: number, draw: number, value: boolean) => { hidden.set(`${root}:${draw}`, value); },
    setJointTranslationOverride: (root: number, joint: number, offset: [number, number, number]) => { translations.push({ root, joint, value: offset }); },
    setJointRotationOverride: (root: number, joint: number, rotation: [number, number, number]) => { rotations.push({ root, joint, value: rotation }); },
    setJointVisibilityOverride: (root: number, joint: number, value: boolean) => { vis.push({ root, joint, value }); },
    setObjectClip: (_root: number, value: unknown) => { clip = value; },
    setObjectState: (_root: number, value: unknown) => { state = value; },
  };
  applyOnettRuntime(stub as never, layout, rt);
  return { translations, rotations, vis, hidden, clip, state };
}

describe('Onett authoritative presentation', () => {
  it('parks every car hidden for menus and pre-match frames', () => {
    const layout = syntheticLayout();
    const hidden = new Map<string, boolean>();
    const stub = {
      setDrawHidden: (root: number, draw: number, value: boolean) => { hidden.set(`${root}:${draw}`, value); },
      setObjectState: () => {},
    };
    parkOnettCars(stub as never, layout);
    expect(hidden.size).toBe(8);
    expect([...hidden.values()].every((value) => value)).toBe(true);
  });
  it('places the crossing car from runtime state and hides the idle models', () => {
    const layout = syntheticLayout();
    const rt = createOnettRuntime(fakePhysics);
    rt.a.state = 5; rt.a.car = 1; rt.a.x = 100; rt.a.visible = true;
    const out = drive(layout, rt);
    expect([...out.hidden.values()]).toEqual([true, true, false, false, true, true, true, true]);
    const car = out.translations.find((call) => call.joint === 1);
    expect(car?.value).toEqual([110, 0, ONETT_LANE_RTL - 31.5]);
    const mirror = out.rotations.find((call) => call.joint === 2);
    expect(mirror?.value).toEqual([0, 0, 0]);
  });
  it('mirrors the left-to-right car and spins the post-hit car', () => {
    const layout = syntheticLayout();
    const rt = createOnettRuntime(fakePhysics);
    rt.b.state = 5; rt.b.car = 2; rt.b.x = -100; rt.b.visible = true;
    rt.a.state = 4; rt.a.car = 0; rt.a.x = 0; rt.a.spin = 0.5; rt.a.visible = true;
    const out = drive(layout, rt);
    const ltr = out.rotations.find((call) => call.joint === 7);
    expect((ltr?.value as number[])[1]).toBeCloseTo(Math.PI, 10);
    const spin = out.rotations.find((call) => call.joint === 12);
    expect((spin?.value as number[])[1]).toBeCloseTo(0.5, 10);
    const parked = out.translations.find((call) => call.joint === 6);
    expect(parked?.value).toEqual([-120, 0, ONETT_LANE_LTR - 31.5]);
  });
  it('drives awning joints from spring state and blinks the rebuild', () => {
    const layout = syntheticLayout();
    const rt = createOnettRuntime(fakePhysics);
    rt.awnings[0]!.velocity = -2.5; rt.awnings[0]!.accumulator = -1;
    rt.building.state = 7; rt.building.timer = 3; rt.building.anim = 1;
    const out = drive(layout, rt);
    const awning = out.translations.find((call) => call.root === 5 && call.joint === 14);
    expect(awning?.value).toEqual([0, -3.5, 0]);
    expect(out.vis.filter((call) => call.root === 4).map((call) => call.value)).toEqual([false, false, false]);
    expect(out.clip).toBe(layout.buildingClips[1]);
    expect((out.state as { animationFrame: number }).animationFrame).toBeLessThanOrEqual(100);
  });
});

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Onett original ISO presentation', () => {
  let base: GameContent;
  let layout: OnettLayout | null;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)),
        new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'onett');
    } finally { await disc.close(); }
    layout = readOnettTraffic(base.stageModel);
  }, 60000);
  it('resolves the original joint wiring (Ground_801C3FA4 depths)', () => {
    expect(layout).not.toBeNull();
    expect(layout!.carRoot).toBe(3);
    // Driven base joints at depths 0xB/0x1/0x6/0x10 with their rest offsets.
    expect([...layout!.carJoints]).toEqual([11, 1, 6, 16]);
    expect([...layout!.restX]).toEqual([-40, -10, 20, 60]);
    expect([...layout!.restZ]).toEqual([31.5, 31.5, 31.5, 31.5]);
    // Awning springs at depths 0xE/0xF of the town root: both canopies.
    expect(layout!.townRoot).toBe(5);
    expect([...layout!.awningJoints]).toEqual([14, 15]);
    // Center-building root with playable collapse slots.
    expect(layout!.buildingRoot).toBe(4);
    expect(layout!.buildingClips[1]?.endFrame).toBeGreaterThan(0);
    expect(layout!.buildingClips[3]?.endFrame).toBeGreaterThan(0);
    expect(layout!.buildingClips[4]?.endFrame).toBeGreaterThan(0);
    expect(layout!.buildingClips[5]?.endFrame).toBeGreaterThan(0);
    expect(layout!.carOfDraw).toHaveLength(26);
    expect(new Set(layout!.carOfDraw)).toEqual(new Set([0, 1, 2, 3]));
  });
  it('bakes joint-local areas onto their owner meshes', () => {
    const floors = base.stage.floors;
    const box = (ids: number[]) => {
      const xs: number[] = [], ys: number[] = [];
      for (const id of ids) {
        const floor = floors.find((line) => line.id === id)!;
        xs.push(floor.a[0], floor.b[0]); ys.push(floor.a[1], floor.b[1]);
      }
      return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
    };
    // Canopy 1 under its mesh (world x −122…−94, y 44…56).
    const first = box([0, 1, 2, 3, 4, 5]);
    expect(first.x[0]).toBeGreaterThan(-125); expect(first.x[1]).toBeLessThan(-80);
    expect(first.y[0]).toBeGreaterThan(40); expect(first.y[1]).toBeLessThan(60);
    // Canopy 2 under its mesh (world x −62…−37, y 68…82).
    const second = box([6, 7, 8, 9, 10, 11]);
    expect(second.x[0]).toBeGreaterThan(-65); expect(second.x[1]).toBeLessThan(-30);
    expect(second.y[0]).toBeGreaterThan(60); expect(second.y[1]).toBeLessThan(85);
    // Rooftop lines stacked on the center building (world y ≈ 35.5).
    for (const id of [46, 47]) {
      const floor = floors.find((line) => line.id === id)!;
      expect(floor.a[1]).toBeCloseTo(35.55, 1); expect(floor.b[1]).toBeCloseTo(35.55, 1);
    }
    expect(floors.map((floor) => floor.id)).toEqual(Array.from({ length: 48 }, (_, id) => id));
  });
});
