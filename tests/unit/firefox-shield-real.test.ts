import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Fire Fox ground flight vs shield', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = () => {
    rig?.dispose(); content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    const floor = content.stage.floors.find((f) => !f.oneWay)!.id;
    game.fighters.forEach((f, i) => { f.x = i ? 8 : -20; f.y = 0; f.grounded = true; f.floor = floor; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('keeps the flight hitbox alive along the floor and lands the 14% shield knock', () => {
    const fox = game.fighters[0]!, mario = game.fighters[1]!;
    step({ special: true, specialDirection: 'up' });
    // Charge out holding a horizontal aim; the launch skims the floor.
    let flightShield = false, travelFrames = 0;
    for (let i = 0; i < 120; i++) {
      step({ x: 1 }, { shield: true });
      if (fox.special?.direction === 'up' && fox.special.phase === 'travel') {
        travelFrames++;
        flightShield ||= game.events.some((e) => e.type === 'shield');
      }
    }
    // The travel used to collapse into the hitbox-less SpecialHiLanding slide on its
    // first frame; now the ground flight persists and its 14% hit reaches the shield.
    expect(travelFrames).toBeGreaterThan(5);
    expect(flightShield).toBe(true);
    expect(mario.percent).toBe(0); // blocked, never launched
    expect(mario.combat.shield).toBeLessThan(40); // charge chips + the 14% flight knock
  });
});
