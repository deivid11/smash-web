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
describe.skipIf(!iso)("Peach's Castle Bill hazard", () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = () => {
    rig?.dispose(); content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
  };
  const step = () => game.step([{ ...neutralInput() }, { ...neutralInput() }]);
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'peach-castle'); }
    finally { await disc.close(); }
  }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('parses Bill tuning from the disc and starts hidden with a spawn timer', () => {
    expect(content.peachBillData).toBeDefined();
    expect(content.peachBillData!.spawnMin).toBe(60);
    expect(content.peachBillData!.spawnMax).toBe(800);
    expect(content.peachBillData!.damage).toBe(16);
    expect(game.peachBill).toBeDefined();
    expect(game.peachBill!.state).toBe(0);
    expect(game.peachBill!.timer).toBeGreaterThanOrEqual(60);
    expect(game.peachBill!.timer).toBeLessThanOrEqual(800);
  });
  it('launches exactly one missile after the window and hides the parked pile', () => {
    expect(content.stageModel.roots.length).toBeGreaterThan(20);
    for (let i = 0; i < 900 && game.peachBill!.state !== 1; i++) step();
    expect(game.peachBill!.state).toBe(1);
    expect(game.peachBill!.slot).toBeGreaterThanOrEqual(0);
    expect(game.peachBill!.slot).toBeLessThanOrEqual(2);
    expect(Math.abs(game.peachBill!.vx)).toBeCloseTo(10, 5);
  });
  it('detonates on fighter contact with a radial blast', () => {
    for (let i = 0; i < 900 && game.peachBill!.state !== 1; i++) step();
    expect(game.peachBill!.state).toBe(1);
    const bill = game.peachBill!;
    const victim = game.fighters[0]!;
    const left = content.stage.blast.left, right = content.stage.blast.right;
    let boomed = false;
    for (let i = 0; i < 120 && !boomed; i++) {
      // Wait until the missile is inside the blast box, then hold the victim on
      // it for one frame (spawn itself is off-screen and would KO a holder).
      if (bill.x >= left && bill.x <= right) {
        victim.x = bill.x; victim.y = bill.y; victim.grounded = false; victim.floor = null;
        victim.state = 'fall'; victim.animation = 'Fall'; victim.velocity = { x: 0, y: 0 }; victim.knockback = { x: 0, y: 0 };
        victim.invulnerable = 0; rig.sample(victim);
      }
      const before = victim.percent;
      step();
      if (bill.state === 2) {
        boomed = true;
        expect(victim.percent).toBeGreaterThan(before);
        expect(game.events.some((e) => e.type === 'gfx')).toBe(true);
      }
    }
    expect(boomed).toBe(true);
  });
  it('snapshots and restores the Bill clock for rollback', () => {
    for (let i = 0; i < 100; i++) step();
    const snap = game.captureState();
    const x = game.peachBill!.x, timer = game.peachBill!.timer, state = game.peachBill!.state;
    for (let i = 0; i < 30; i++) step();
    game.restoreState(snap);
    expect(game.peachBill!.x).toBe(x);
    expect(game.peachBill!.timer).toBe(timer);
    expect(game.peachBill!.state).toBe(state);
    expect(game.stateHash(snap)).toBe(game.stateHash());
  });
});
