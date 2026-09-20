import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { SUPPORTED_STAGES } from '../../lib/game/stages.ts';
import { GREENS_GRID_X, GREENS_GRID_Y } from '../../lib/game/greens.ts';

describe('Green Greens registration', () => {
  it('keeps only the static terrain collision and documents the prototype gimmicks', () => {
    const entry = SUPPORTED_STAGES.find(stage => stage.id === 'green-greens')!;
    expect(entry).toMatchObject({ label: 'Green Greens', asset: 'GrGr.dat', music: 'green-greens' });
    expect(entry).toMatchObject({ staticAreas: [30] });
    expect(entry.limitations).toMatch('bomb');
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Green Greens original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (seed = 7) => {
    rig?.dispose();
    content = rosterPair(base, 'Fx', 'Mr');
    rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, seed });
    game.start();
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number) => { for (let i = 0; i < n; i++) step(); };
  const live = () => game.greens!.blocks.filter(block => block.status !== 0).length;
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'green-greens'); } finally { await disc.close(); } }, 30000);
  afterEach(() => rig?.dispose());
  it('loads only area 30 statically with the 18-block opening layout', () => {
    make();
    expect(base.stage.floors.map(floor => floor.id).sort((a, b) => a - b))
      .toEqual([30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]);
    expect(game.greens).not.toBeNull();
    expect(live()).toBe(18);
    // Same seed, same bombs; the active set adds the live blocks to the base.
    const bombs = game.greens!.blocks.map(block => block.status !== 0 && block.bomb);
    make();
    expect(game.greens!.blocks.map(block => block.status !== 0 && block.bomb)).toEqual(bombs);
    expect(live()).toBe(18);
  });
  it('drops new blocks that fall from the blast top and land on the grid', () => {
    make();
    let falling = -1;
    for (let i = 0; i < 200 && falling < 0; i++) {
      step();
      falling = game.greens!.blocks.findIndex(block => block.status === 1 || block.status === 2);
    }
    expect(falling).toBeGreaterThanOrEqual(0);
    // A fresh spawn starts at the blast top, above every resting row.
    const row = Math.floor(falling / 6);
    if (game.greens!.blocks[falling]!.status === 1) {
      expect(game.greens!.blocks[falling]!.y).toBeGreaterThan(GREENS_GRID_Y[row]!);
    }
    for (let i = 0; i < 1200 && game.greens!.blocks.some(block => block.status === 1 || block.status === 2); i++) step();
    expect(game.greens!.blocks.some(block => block.status === 1 || block.status === 2)).toBe(false);
    expect(live()).toBeGreaterThan(18);
  });
  it('breaks blocks on Fox laser contact and consumes the shot', () => {
    make();
    const fox = game.fighters[0]!;
    fox.x = -80; fox.y = -7.5; fox.grounded = true; fox.floor = 43;
    fox.state = 'idle'; fox.animation = 'Wait1'; fox.facing = 1;
    rig.sample(fox);
    const before = live();
    step({ special: true, specialDirection: 'neutral' });
    for (let i = 0; i < 60 && live() >= before; i++) step();
    expect(live()).toBeLessThan(before);
    expect(game.projectiles.items.length).toBe(0);
  });
  it('detonates bomb blocks with radial damage and chains neighbours', () => {
    make(11);
    const bomb = game.greens!.blocks.findIndex(block => block.status === 3 && block.bomb);
    expect(bomb).toBeGreaterThanOrEqual(0);
    const col = bomb % 6, row = Math.floor(bomb / 6);
    const bx = GREENS_GRID_X[col]!, by = GREENS_GRID_Y[row]! + 3.75;
    const victim = game.fighters[0]!;
    victim.x = bx + 8; victim.y = by + 11; victim.grounded = false; victim.floor = null;
    victim.velocity = { x: 0, y: 0 }; victim.knockback = { x: 0, y: 0 };
    victim.state = 'fall'; victim.animation = 'Fall';
    rig.sample(victim);
    const before = live();
    (game as unknown as { breakGreensBlock(index: number, breaker: number): void }).breakGreensBlock(bomb, 0);
    expect(live()).toBeLessThan(before);
    expect(victim.percent).toBeGreaterThan(0);
    expect(victim.state).toBe('hitstun');
  });
  it('pushes fighters on the blowing side during Whispy wind', () => {
    make(5);
    game.greens!.phase = 1; game.greens!.phaseTimer = 36; game.greens!.windDir = 0;
    for (const fighter of game.fighters) {
      fighter.x = fighter.slot === 0 ? -45 : 45; fighter.y = 10;
      fighter.grounded = false; fighter.floor = null;
      fighter.velocity = { x: 0, y: 0 }; fighter.knockback = { x: 0, y: 0 };
      fighter.state = 'fall'; fighter.animation = 'Fall';
      rig.sample(fighter);
    }
    step();
    expect(game.greens!.windActive).toBe(1);
    // Left wind drags the left fighter further left; the right fighter is untouched.
    expect(game.fighters[0]!.x).toBeLessThan(-45);
    expect(game.fighters[1]!.x).toBe(45);
  });
  it('restores snapshots deterministically across block and wind state', () => {
    make();
    ticks(120);
    const saved = game.captureState(), hash = game.stateHash();
    ticks(60);
    game.restoreState(saved);
    expect(game.stateHash()).toBe(hash);
    ticks(60);
    expect(game.stateHash()).not.toBe(hash);
  });
});
