import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { floorY } from '../../lib/game/data.ts';
import { matchSpawnPoints } from '../../lib/game/spawns.ts';
import { SUPPORTED_STAGES, stagePlayerLimit } from '../../lib/game/stages.ts';
import { MUSIC_TRACKS } from '../../lib/game/music.ts';
import { parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Hyrule Temple registration', () => {
  it('registers the stage, music, transport names and the uncapped player count', () => {
    const entry = SUPPORTED_STAGES.find(stage => stage.id === 'temple')!;
    expect(entry).toMatchObject({ label: 'Hyrule Temple', asset: 'GrSh.dat', music: 'temple' });
    expect(MUSIC_TRACKS.temple).toBe('audio/shrine.hps');
    for (const name of ['GrSh.dat', 'audio/shrine.hps']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['GrShh.dat', 'audio/hyaku.hps', 'audio/saria.hps']) expect(SERVER_ASSETS).not.toContain(name);
    expect(stagePlayerLimit('temple')).toBe(8);
    const rules = { stage: 'temple', stocks: 3, timeSeconds: 180 };
    expect(parseClientMessage(JSON.stringify({ type: 'rules', token: 't', rules }))).toMatchObject({ rules });
  });
  it('interpolates sloped segments but keeps near-flat segments bit-identical', () => {
    const slope = { a: [0, 0] as [number, number], b: [10, 11] as [number, number] };
    expect(floorY(slope, 5)).toBeCloseTo(5.5);
    expect(floorY(slope, -5)).toBe(0); expect(floorY(slope, 50)).toBeCloseTo(11);
    const flat = { a: [0, 20.25] as [number, number], b: [10, 20.259] as [number, number] };
    expect(floorY(flat, 7)).toBe(20.25);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Hyrule Temple original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = () => {
    rig?.dispose(); content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  const place = (floorId: number, x: number) => {
    const floor = content.stage.floors.find(fl => fl.id === floorId)!;
    f().x = x; f().y = floorY(floor, x); f().grounded = true; f().floor = floorId; f().state = 'idle'; f().animation = 'Wait1'; rig.sample(f());
    return floor;
  };
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'temple'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the original 42-floor collision set with slopes, one-ways and seven native ledges', () => {
    const stage = content.stage;
    expect(stage.scale).toBeCloseTo(0.9);
    expect(stage.floors).toHaveLength(42);
    expect(stage.floors.filter(fl => Math.abs(fl.a[1] - fl.b[1]) > 0.01)).toHaveLength(24);
    expect(stage.floors.filter(fl => fl.oneWay)).toHaveLength(9);
    expect(stage.ledges).toHaveLength(7);
    expect(stage.ledges.map(l => l.floor).sort((a, b) => a - b)).toEqual([0, 13, 14, 20, 37, 38, 40]);
    expect(stage.blast.left).toBeCloseTo(-315, 0); expect(stage.blast.right).toBeCloseTo(315, 0);
    expect(stage.blast.bottom).toBeCloseTo(-257.4, 0); expect(stage.blast.top).toBeCloseTo(207, 0);
    expect(stage.spawns).toHaveLength(4);
    expect(stage.spawns[0]![0]).toBeCloseTo(-92.7, 1); expect(stage.spawns[0]![1]).toBeCloseTo(21.6, 1);
  });
  it('spawns both fighters grounded on original floors at their native points', () => {
    for (const fighter of game.fighters) {
      expect(fighter.grounded).toBe(true);
      const floor = content.stage.floors.find(fl => fl.id === fighter.floor)!;
      expect(fighter.y).toBeCloseTo(floorY(floor, fighter.x), 4);
    }
  });
  it('walks up and down a sloped ramp with y following the original segment', () => {
    // Floor 7 rises from (-109.1, 8.1) to (-99.1, 15.3): slope 0.72.
    const floor = place(7, -108);
    const y0 = f().y;
    ticks(14, { x: 1, walk: true });
    expect(f().grounded).toBe(true);
    expect(f().y).toBeGreaterThan(y0);
    expect(f().y).toBeCloseTo(floorY(content.stage.floors.find(fl => fl.id === f().floor)!, f().x), 4);
    ticks(20, { x: -1, walk: true });
    expect(f().grounded).toBe(true);
    expect(f().y).toBeLessThanOrEqual(y0 + 0.01);
    expect(floor.oneWay).toBe(false);
  });
  it('runs across connected flat and sloped segments without going airborne', () => {
    place(8, -97); // flat courtyard shelf, up ramp 9, onto the long flat 10
    ticks(25, { x: 1 });
    expect(f().grounded).toBe(true);
    expect(f().x).toBeGreaterThan(-80);
    expect(f().y).toBeGreaterThan(16);
    const support = content.stage.floors.find(fl => fl.id === f().floor)!;
    expect(f().y).toBeCloseTo(floorY(support, f().x), 4);
  });
  it('is stopped by the wall step instead of teleporting up it or entering the terrain', () => {
    place(5, -165); // floor 5 ends at x -157.3; floor 6 sits 9.6 units higher behind a wall
    ticks(20, { x: 1 });
    expect(f().floor).toBe(5); // pressed against the step, never up it or inside it
    expect(f().grounded).toBe(true);
    expect(f().x).toBeLessThanOrEqual(-157.2);
    expect(f().y).toBeLessThan(15);
  });
  it('does not slip through the wall-step corner when falling diagonally onto it', () => {
    // A diagonal fall onto the step corner used to cross the floor while the end
    // point sat past the floor and past the wall, teleporting through wall 79 and
    // falling out of the map. It must land on the lower edge, still left of the wall.
    for (const startY of [6, 8, 12]) {
      make();
      f().x = -160; f().y = startY; f().grounded = false; f().floor = null;
      f().state = 'fall'; f().animation = 'Fall'; f().velocity = { x: 0, y: 0 }; f().knockback = { x: 0, y: 0 };
      rig.sample(f());
      ticks(40, { x: 1 });
      expect(f().x).toBeLessThanOrEqual(-157.2);
      expect(f().grounded).toBe(true);
      expect(f().floor).toBe(5);
      expect(f().y).toBeCloseTo(5.18, 1);
    }
  });
  it('lands on a slope at the interpolated height and jumps off it cleanly', () => {
    place(7, -104);
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y += 30;
    ticks(40);
    expect(f().grounded).toBe(true);
    const support = content.stage.floors.find(fl => fl.id === f().floor)!;
    expect(f().y).toBeCloseTo(floorY(support, f().x), 4);
    step({ jump: true }); ticks(6);
    expect(f().grounded).toBe(false);
  });
  it('drops through the one-way upper platform but not through solid ramps', () => {
    // Floor 25 is the one-way platform above the courtyard.
    place(25, -40);
    expect(content.stage.floors.find(fl => fl.id === 25)!.oneWay).toBe(true);
    step({ down: true }); ticks(3, { down: true });
    expect(f().grounded).toBe(false);
    ticks(80);
    expect(f().grounded).toBe(true); expect(f().floor).not.toBe(25);
  });
  it('grabs the original right-tower ledge while falling past it', () => {
    const ledge = content.stage.ledges.find(l => l.floor === 37)!;
    f().x = ledge.x + 2; f().y = ledge.y + 6; f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().facing = -1; f().velocity = { x: 0, y: -1 };
    ticks(20);
    expect(f().state).toBe('ledge');
    expect(f().combat.ledge).toBe(ledge.id);
  });
  it('keeps snapshots deterministic across restore while fighting on slopes', () => {
    place(7, -106);
    step({ x: 1 }); step({ attack: true });
    const state = game.captureState();
    ticks(30, { x: 1 });
    const hash = game.stateHash();
    game.restoreState(state);
    ticks(30, { x: 1 });
    expect(game.stateHash()).toBe(hash);
  });
  it('decodes the registered stage track within the shared music budgets', async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      const { decodeHps, MUSIC_TRACKS, MAX_MUSIC_SAMPLES } = await import('../../lib/game/music.ts');
      const pcm = decodeHps(await session.bytes(MUSIC_TRACKS.temple));
      expect(pcm.rate).toBe(32000);
      expect(pcm.channels.length).toBeGreaterThanOrEqual(1);
      expect(pcm.channels[0]!.length).toBeGreaterThan(0);
      expect(pcm.channels[0]!.length).toBeLessThanOrEqual(MAX_MUSIC_SAMPLES);
      expect(pcm.loop).toBe(true);
      expect(pcm.loopStart).toBeLessThan(pcm.channels[0]!.length);
    } finally { await disc.close(); }
  }, 30000);
  it('seats up to eight fighters on the topmost solid surfaces of the sloped ruins', () => {
    expect(matchSpawnPoints(content.stage, 4)).toHaveLength(4);
    for (const count of [5, 8]) {
      const points = matchSpawnPoints(content.stage, count);
      expect(points).toHaveLength(count);
      expect(new Set(points.map((p) => `${p[0]}:${p[1]}`)).size).toBe(count);
      for (const [x, y] of points) {
        expect(x).toBeGreaterThan(content.stage.blast.left); expect(x).toBeLessThan(content.stage.blast.right);
        const support = content.stage.floors.find((floor) => !floor.oneWay && x >= Math.min(floor.a[0], floor.b[0]) - 0.001 && x <= Math.max(floor.a[0], floor.b[0]) + 0.001 && Math.abs(floorY(floor, x) - y) < 0.01);
        expect(support, `x=${x}`).toBeDefined();
      }
    }
  });
});
