import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

// Input-to-landing prototype regressions, NOT a Dolphin/GameCube distance oracle.
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('end-to-end wavedash inputs', () => {
  let base: GameContent, content: GameContent, game: LocalMatch, rig: GameRigs | undefined;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 120000);
  afterEach(() => { rig?.dispose(); rig = undefined; });
  const p = () => game.fighters[0]!;
  const step = (input: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...input }, neutralInput()]);
  const make = (kind: 'Fx' | 'Lg' | 'Mr' | 'Ms') => {
    rig?.dispose(); content = rosterPair(base, kind, 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    const floor = content.stage.floors.find(f => !f.oneWay)!;
    game.fighters.forEach((f, i) => { f.x = i ? 70 : 0; f.y = floor.a[1]; f.grounded = true; f.floor = floor.id; rig!.sample(f); });
  };
  const hop = () => {
    step({ jump: true });
    expect(p().state).toBe('squat');
    for (let n = 0; p().grounded && n < 12; n++) step();
    expect(p()).toMatchObject({ grounded: false, state: 'jump', shortHop: true });
  };
  const dodgeToLand = (x: number, y: number) => {
    step({ shield: true, x, y });
    expect(p().velocity.x).toBeCloseTo(content.combat.dodge.speed * content.combat.dodge.decay * x / Math.hypot(x, y), 4);
    for (let n = 0; !p().grounded && n < 60; n++) step();
    expect(p()).toMatchObject({ grounded: true, state: 'landing', landingFrames: content.combat.dodge.landing });
    expect(p().landingFrames).toBe(10);
    expect(p().velocity.x * Math.sign(x)).toBeGreaterThan(0);
  };

  it.each(['Fx', 'Lg', 'Mr', 'Ms'] as const)('%s jumps, dodges down-diagonally and slides through exactly ten landing frames', kind => {
    make(kind); hop(); dodgeToLand(1, -1);
    const landedX = p().x;
    for (let n = 1; n < 10; n++) {
      step({ attack: n % 2 === 1, jump: n % 2 === 1 });
      expect(p().state).toBe('landing');
    }
    step(); expect(p().state).toBe('idle');
    expect(p().x).toBeGreaterThan(landedX);
  });

  it.each([-1, 1])('a shallower angle produces more travel in direction %i', direction => {
    const distance = (y: number) => {
      make('Fx'); hop(); const start = p().x;
      dodgeToLand(direction, y);
      for (let n = 0; n < 10; n++) step();
      return (p().x - start) * direction;
    };
    expect(distance(-0.3)).toBeGreaterThan(distance(-1));
  });

  it('replays jump-to-dodge landing and sliding deterministically after restoring a snapshot', () => {
    make('Lg'); hop(); const saved = game.captureState();
    const run = () => { dodgeToLand(-1, -0.5); for (let n = 0; n < 10; n++) step(); return game.stateHash(); };
    const hash = run(); game.restoreState(saved); expect(run()).toBe(hash);
  });
});
