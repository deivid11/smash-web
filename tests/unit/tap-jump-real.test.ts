import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('tap jump (up-stick flick) like the original', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = () => {
    rig?.dispose(); content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * 30; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, neutralInput()]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('jumps from a fresh upward flick without the jump button', () => {
    step({ y: 1 });
    expect(f().state).toBe('squat');
    ticks(10, { y: 1 });
    expect(f().grounded).toBe(false); expect(f().velocity.y).toBeGreaterThan(0); expect(f().jumpsUsed).toBe(1);
  });
  it('does not retrigger while the stick stays up, and flicking again in the air uses the air jump', () => {
    ticks(12, { y: 1 }); // flick + first jump
    const used = f().jumpsUsed;
    ticks(20, { y: 1 }); // held up: no new edge
    expect(f().jumpsUsed).toBe(used);
    ticks(3); // release to neutral
    step({ y: 1 }); // fresh flick mid-air
    expect(f().jumpsUsed).toBe(used + 1);
  });
  it('short hops on a quick flick-release and full hops when the stick stays held', () => {
    const peak = (inputs: () => Partial<PlayerInput>) => {
      make(); step({ y: 1 });
      let top = 0;
      for (let i = 0; i < 60; i++) { step(inputs()); top = Math.max(top, f().y); if (f().grounded && i > 10) break; }
      return top;
    };
    const short = peak(() => ({}));
    const full = peak(() => ({ y: 1 }));
    expect(short).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(short + 3);
  });
  it('cancels jump squat into an up special, and up+attack in squat becomes an up smash for fighters that have one', () => {
    step({ y: 1 });
    expect(f().state).toBe('squat');
    step({ y: 1, special: true, specialDirection: 'up' });
    expect(f().state).toBe('special');
    make();
    const mario = game.fighters[1];
    game.step([neutralInput(), { ...neutralInput(), y: 1 }]);
    expect(mario.state).toBe('squat');
    game.step([neutralInput(), { ...neutralInput(), y: 1, attack: true }]);
    if (mario.content.moves.upSmash) { expect(mario.state).toBe('attack'); expect(mario.attackName).toBe(mario.content.moves.upSmash); }
  });
  it('keeps plain button jumps and crouch inputs unchanged', () => {
    step({ jump: true });
    expect(f().state).toBe('squat');
    make();
    ticks(5, { down: true, y: -1 });
    expect(f().state).toBe('crouch'); expect(f().grounded).toBe(true);
  });
});
