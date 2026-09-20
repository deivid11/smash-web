import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)("Peach's Castle brick collision", () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = () => {
    rig?.dispose(); content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
  };
  const step = () => game.step([{ ...neutralInput() }, { ...neutralInput() }]);
  const f = () => game.fighters[0];
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'peach-castle'); }
    finally { await disc.close(); }
  }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('keeps the rest-pose side bricks solid (floors, ceilings and walls)', () => {
    // Prototype addition: tiny top cube (area 0) plus top/side one-way platforms
    // frozen at rest (areas 1-2,9-10,13-14) join the castle/lift/bricks. Only area 0
    // carries a ceiling/walls, so floors grow 18→27, ceilings 5→6, walls 16→18.
    expect(content.stage.floors).toHaveLength(27);
    expect(content.stage.surfaces?.filter(s => s.kind === 'ceiling')).toHaveLength(6);
    expect(content.stage.surfaces?.filter(s => s.kind === 'wall')).toHaveLength(18);
    for (const id of [16, 17, 18, 21, 22]) expect(content.stage.floors.some(fl => fl.id === id)).toBe(true);
    for (const id of [0, 1, 2, 14, 15, 19, 20, 23, 24, 25, 26]) expect(content.stage.floors.some(fl => fl.id === id)).toBe(true);
  });
  it('lands on the upper brick top instead of falling through it', () => {
    f().x = -42; f().y = 130; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
    for (let i = 0; i < 40 && !f().grounded; i++) step();
    expect(f().grounded).toBe(true);
    expect(f().floor).toBe(21);
    expect(f().y).toBeCloseTo(115.06, 1);
  });
  it('is stopped by the upper brick side wall instead of entering it', () => {
    f().x = -52; f().y = 110; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 0, y: 0 }; f().knockback = { x: 3, y: 0 }; rig.sample(f());
    for (let i = 0; i < 4; i++) step();
    expect(f().x).toBeLessThan(-47.0);
  });
  const onFloor = (id: number, x: number) => {
    const fl = content.stage.floors.find(fl => fl.id === id)!;
    const t = (x - fl.a[0]) / (fl.b[0] - fl.a[0]);
    f().x = x; f().y = Math.fround(fl.a[1] + (fl.b[1] - fl.a[1]) * t); f().grounded = true; f().floor = id;
    f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
  };
  const run = (frames: number, x: number) => { for (let i = 0; i < frames; i++) game.step([{ ...neutralInput(), x }, { ...neutralInput() }]); };
  /** x of a wall's base vertex (original walls lean a hair; the base meets the floor). */
  const wallX = (id: number) => { const w = content.stage.surfaces!.find(s => s.id === id)!; return w.a[1] <= w.b[1] ? w.a[0] : w.b[0]; };
  // The tower sides (walls 45/34) rise from the top of the sloped ramps (floors 6/10):
  // a walking fighter's feet sit below the wall base until the very last step, so a
  // feet-only wall test slipped under the wall and dropped into the castle.
  it('stops at the tower wall when running up the left ramp instead of entering the tower', () => {
    onFloor(6, -14); run(40, 1);
    expect(f().grounded).toBe(true); expect(f().floor).toBe(6);
    expect(f().x).toBeLessThanOrEqual(wallX(45)); expect(f().x).toBeGreaterThan(wallX(45) - 0.2);
    expect(f().y).toBeCloseTo(113.57, 1);
  });
  it('stops at the tower wall when running up the right ramp', () => {
    onFloor(10, 14); run(40, -1);
    expect(f().grounded).toBe(true); expect(f().floor).toBe(10);
    expect(f().x).toBeGreaterThanOrEqual(wallX(34)); expect(f().x).toBeLessThan(wallX(34) + 0.2);
  });
  it('keeps grounded knockback along the ramp out of the tower', () => {
    onFloor(6, -12); f().knockback = { x: 2, y: 0 }; run(20, 0);
    expect(f().grounded).toBe(true); expect(f().floor).toBe(6);
    expect(f().x).toBeLessThanOrEqual(wallX(45));
  });
  it.each([
    { side: 'left', floor: 6, x: -14, direction: 1, wall: 45 },
    { side: 'right', floor: 10, x: 14, direction: -1, wall: 34 },
  ])('stays outside the $side tower wall after jumping and sliding back onto the ramp', ({ floor, x, direction, wall }) => {
    onFloor(floor, x); run(4, direction);
    game.step([{ ...neutralInput(), x: direction, jump: true }, { ...neutralInput() }]);
    let airborne = false;
    for (let i = 0; i < 90; i++) {
      run(1, direction);
      airborne ||= !f().grounded;
      if (f().grounded) {
        expect(f().floor).toBe(floor);
        expect((f().x - wallX(wall)) * direction).toBeLessThanOrEqual(0);
      }
    }
    expect(airborne).toBe(true);
    expect(f().grounded).toBe(true); expect(f().floor).toBe(floor);
    const stoppedX = f().x;
    run(10, -direction);
    expect((f().x - stoppedX) * direction).toBeLessThan(-1);
  });
  it('blocks an airborne drift whose feet pass just under the tower wall base', () => {
    f().x = -12; f().y = 113.2; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 1.5, y: 0 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
    run(20, 1);
    expect(f().x).toBeLessThanOrEqual(wallX(45)); expect(f().grounded).toBe(true); expect(f().floor).toBe(6);
  });
  it('still stops flush against the flat-floor wall base and never loses the ground there', () => {
    onFloor(5, -26);
    for (let i = 0; i < 40; i++) { run(1, 1); expect(f().grounded).toBe(true); expect(f().floor).toBe(5); }
    expect(f().x).toBeLessThanOrEqual(wallX(44)); expect(f().x).toBeGreaterThan(wallX(44) - 0.05);
  });
  it('bonks the brick underside instead of jumping through it', () => {
    f().x = -42; f().y = 95; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 0, y: 5 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
    for (let i = 0; i < 6; i++) step();
    expect(f().y).toBeLessThan(105.5);
  });
  it('lands on the frozen top one-way flat instead of falling through it', () => {
    f().x = 42; f().y = 150; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
    for (let i = 0; i < 40 && !f().grounded; i++) step();
    expect(f().grounded).toBe(true);
    expect(f().floor).toBe(20);
    expect(f().y).toBeCloseTo(133.75, 1);
  });
  it('lands on the frozen side-deck extension instead of falling through it', () => {
    f().x = -90; f().y = 100; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
    for (let i = 0; i < 40 && !f().grounded; i++) step();
    expect(f().grounded).toBe(true);
    expect([23, 24]).toContain(f().floor);
    expect(f().y).toBeCloseTo(84.25, 1);
  });
  it('jumps up through the one-way side slope instead of bonking it', () => {
    f().x = -99; f().y = 95; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 0, y: 5 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
    for (let i = 0; i < 6; i++) step();
    expect(f().y).toBeGreaterThan(100);
  });
  it('lands on the tiny top cube instead of falling through it', () => {
    f().x = 0; f().y = 180; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
    for (let i = 0; i < 40 && !f().grounded; i++) step();
    expect(f().grounded).toBe(true);
    expect(f().floor).toBe(0);
    expect(f().y).toBeCloseTo(167.56, 1);
  });
  it('lands on the frozen yellow traveler at dock instead of falling through it', () => {
    // Areas 4-5 ride their owner joints to dock ([-72,102.5]/[72,102.5]): left deck
    // spans x -80.8..-63.2 at y 106.1, right deck mirrored.
    f().x = -72; f().y = 120; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall';
    f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 }; rig.sample(f());
    for (let i = 0; i < 40 && !f().grounded; i++) step();
    expect(f().grounded).toBe(true);
    expect(f().floor).toBe(14);
    expect(f().y).toBeCloseTo(106.1, 1);
  });
});
