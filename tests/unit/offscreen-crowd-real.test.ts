import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchEvent, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { CROWD_REACTION_CHANNEL } from '../../lib/game/crowd.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original camera range, magnifier data and crowd (real disc)', () => {
  let base: GameContent;
  const rigs: GameRigs[] = [];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  afterAll(() => rigs.forEach((rig) => rig.dispose()));

  it('reads Final Destination camera points 0x94-0x96 and its magnifier colours', () => {
    const stage = base.stage;
    expect(stage.camera).toEqual({ left: -170, right: 170, bottom: -80, top: 114 });
    expect(stage.blast).toEqual({ left: -246, right: 246, bottom: -140, top: 188 });
    expect(stage.magnifyColors).toHaveLength(9);
    expect(stage.magnifyColors![0]).toBe(0x0c0628ff); // the navy lupe background
    expect(stage.magnifyColors![4]).toBe(0x780628ff);
  });
  it('reads PlCo gCrowdConfig (ftLoadCommonData[21])', () => {
    const crowd = base.common.crowd!;
    expect([crowd.kbLow, crowd.kbMid, crowd.kbHigh]).toEqual([100, 130, 160]);
    expect(crowd.angleMin).toBeCloseTo(75 * Math.PI / 180, 5); expect(crowd.angleMax).toBeCloseTo(115 * Math.PI / 180, 5);
    expect(crowd).toMatchObject({ comboFrames: 60, chantPercent: 100, cheerLimit: 1200, chantInterruptAfter: 3, maxChants: 9, edgeMargin: 15, recoveryHigh: -10, recoveryMid: -30, recoveryLow: -80, nearBlastCount: 3, blastOffset: -30 });
  });
  it('reads the fighter camera box, camera bone and chant', () => {
    const mario = base.roster.get('Mr')!.profile;
    expect(mario.cameraBox).toMatchObject({ yOffset: 10, front: 22, back: -9, top: 16, bottom: -9 });
    expect(mario.cameraBox!.magnify).toBeCloseTo(10.8, 5);
    expect(mario.cameraBox!.offset).toEqual([0, 2, 0]);
    expect(mario.cameraBox!.joint).toBe(mario.partJoints[5]);
    expect(mario.chantSound).toBe(180000);
  });
  it('times crowd voices from their SSM samples', () => {
    for (const id of [0x13d, 0x140, 0x141, 0x144, 96]) expect(base.sound.durationFrames(id), `sfx ${id}`).toBeGreaterThan(10);
    expect(base.sound.durationFrames(540000)).toBe(0);
  });
  it('makes the crowd react to a strong launch in a real match, on its own channel', () => {
    const content = rosterPair(base, 'Mr', 'Mr'), rig = new GameRigs(content); rigs.push(rig);
    const game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    const floor = content.stage.floors.find((f) => !f.oneWay)!.id;
    game.fighters.forEach((f, i) => { f.x = i ? 14 : 0; f.y = 0; f.grounded = true; f.floor = floor; f.facing = i ? -1 : 1; rig.sample(f); });
    game.fighters[1]!.percent = 180;
    const events: MatchEvent[] = [];
    const step = (a: Partial<PlayerInput> = {}) => { game.step([{ ...neutralInput(), ...a }, neutralInput()]); events.push(...game.events); };
    step({ cX: 1 });
    for (let i = 0; i < 60 && !events.some((e) => e.type === 'hit'); i++) step();
    expect(events.some((e) => e.type === 'hit'), 'forward smash connects').toBe(true);
    step();
    const crowd = events.filter((e) => e.type === 'sound' && e.channel === CROWD_REACTION_CHANNEL);
    expect(crowd.length).toBeGreaterThan(0);
    expect([0x144, 0x145, 0x146]).toContain(crowd[0]!.sound);
    // Snapshot/restore covers the crowd: replaying from a capture reproduces the state hash.
    const state = game.captureState(), hash = game.stateHash();
    for (let i = 0; i < 30; i++) step();
    const after = game.stateHash();
    game.restoreState(state);
    expect(game.stateHash()).toBe(hash);
    for (let i = 0; i < 30; i++) step();
    expect(game.stateHash()).toBe(after);
  });
});
