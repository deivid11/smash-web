import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchFighter, type PlayerInput } from '../../lib/game/match.ts';
import type { HitDefinition } from '../../lib/game/moves.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;

// ftCo_Damage recovery inputs on original PlCo data: the hitstun jump buffer (x1D0)
// and the meteor cancel (x7E8-x7F0 angle range + lockout, x1C anti-mash gap).
describe.skipIf(!iso)('original-data hitstun jump buffer and meteor cancel', () => {
  let content: GameContent;
  let rig: GameRigs | null = null;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      content = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer);
    } finally {
      await disc.close();
    }
  });
  afterEach(() => { rig?.dispose(); rig = null; });

  const hit = (angle: number): HitDefinition => ({ id: 0, group: 0, bone: 0, damage: 12, radius: 3, offset: [0, 0, 0], angle, growth: 80, weightSet: 0, base: 40, grounded: true, airborne: true });
  /** Launches an airborne P1 (one midair jump left) and returns a stepper that reports P1's state. */
  const launch = (angle: number, offstage: boolean) => {
    rig = new GameRigs(content);
    const game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 });
    game.start();
    const [victim, attacker] = game.fighters as [MatchFighter, MatchFighter];
    victim.grounded = false; victim.floor = null; victim.state = 'fall'; victim.animation = 'Fall'; victim.jumpsUsed = 1;
    if (offstage) victim.x = content.stage.mainRight + 25;
    victim.y = offstage ? 10 : 60;
    victim.percent = offstage ? 60 : 40;
    game['applyHit'](attacker, victim, hit(angle), [victim.x, victim.y, 0], 1);
    const step = (input: Partial<PlayerInput> = {}) => { game.step([{ ...neutralInput(), ...input }, neutralInput()]); return victim; };
    return { victim, step, hitlag: victim.hitlag, hitstun: victim.hitstun };
  };

  it('reads the original recovery constants', () => {
    expect(content.common.hitstunRecovery).toEqual({ jumpBuffer: 20, pressGap: 40, meteorAngleMin: 260, meteorAngleMax: 280, meteorLockout: 8 });
  });

  it('buffers a jump pressed in the last 20 frames of hitstun onto the first actionable frame', () => {
    const late = launch(70, false);
    const end = late.hitlag + late.hitstun - 1;
    for (let frame = 0; frame < end; frame++) late.step({ jump: frame === end - 10 });
    expect(late.victim.state).toBe('hitstun');
    expect(late.step().state).toBe('airjump');
    expect(late.victim.jumpsUsed).toBe(2);

    const early = launch(70, false);
    for (let frame = 0; frame < end; frame++) early.step({ jump: frame === end - 30 });
    expect(early.step().state).toBe('fall');
    expect(early.victim.jumpsUsed).toBe(1);
  });

  it('meteor-cancels a downward launch with a fresh jump or up-special after the lockout', () => {
    const jump = launch(270, true);
    expect(jump.victim.hitstunInput.meteorLock).toBe(8);
    for (let frame = 0; frame < jump.hitlag + 10; frame++) jump.step();
    expect(jump.step({ jump: true }).state).toBe('airjump');
    expect(jump.victim.knockback).toEqual({ x: 0, y: 0 });
    expect(jump.victim.hitstun).toBe(0);

    const upSpecial = launch(270, true);
    for (let frame = 0; frame < upSpecial.hitlag + 10; frame++) upSpecial.step();
    expect(upSpecial.step({ special: true, y: 1 }).state).toBe('special');
    expect(upSpecial.victim.special?.direction).toBe('up');
    expect(upSpecial.victim.knockback).toEqual({ x: 0, y: 0 });
  });

  it('refuses meteor cancels inside the lockout, after a mashed press, or on non-meteor launches', () => {
    const lockout = launch(270, true);
    for (let frame = 0; frame < lockout.hitlag + 3; frame++) lockout.step();
    expect(lockout.step({ jump: true }).state).toBe('hitstun');

    const mashed = launch(270, true);
    for (let frame = 0; frame < mashed.hitlag + 12; frame++) mashed.step({ jump: frame === mashed.hitlag + 2 });
    expect(mashed.step({ jump: true }).state).toBe('hitstun');
    expect(mashed.victim.knockback.y).toBeLessThan(0);

    const sideways = launch(0, false);
    for (let frame = 0; frame < sideways.hitlag + 12; frame++) sideways.step();
    expect(sideways.step({ jump: true }).state).toBe('hitstun');
  });
});
