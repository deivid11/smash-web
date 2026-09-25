import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('ledge catch and input regressions', () => {
  let content: GameContent, game: LocalMatch, rig: GameRigs | undefined;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { content = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 120000);
  afterEach(() => { rig?.dispose(); rig = undefined; });
  const p = () => game.fighters[0]!;
  const step = (input: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...input }, neutralInput()]);
  const make = (side = 0) => {
    rig?.dispose(); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    const ledge = content.stage.ledges[side]!, f = p();
    f.x = ledge.x - ledge.facing * 4; f.y = ledge.y - 10;
    f.grounded = false; f.floor = null; f.facing = ledge.facing;
    f.state = 'fall'; f.animation = 'Fall'; f.velocity = { x: 0, y: -0.5 }; rig.sample(f);
    return ledge;
  };
  const hang = (side = 0) => {
    const ledge = make(side); step(); expect(p().animation).toBe('CliffCatch');
    for (let n = 0; p().animation !== 'CliffWait' && n < 60; n++) step();
    expect(p().animation).toBe('CliffWait'); step(); expect(p().combat.ledgeReady).toBe(true);
    return ledge;
  };

  it.each([0, 1])('requires facing toward ledge %i in ordinary fall', side => {
    const ledge = make(side); p().facing = -ledge.facing; step();
    expect(p().combat.ledge).toBeNull();
    p().facing = ledge.facing; step(); expect(p().combat.ledge).toBe(ledge.id);
  });

  it('does not catch while total movement rises despite negative self velocity', () => {
    make(); p().velocity.y = -0.5; p().knockback.y = 2;
    const oldY = p().y; step();
    expect(p().y).toBeGreaterThan(oldY);
    expect(p().combat.ledge).toBeNull();
  });

  it('catches while total movement descends despite positive self velocity', () => {
    const ledge = make(); p().velocity.y = 0.5; p().knockback.y = -2;
    step(); expect(p().combat.ledge).toBe(ledge.id);
  });

  it.each([0, 1])('does not lose a catch when fast horizontal movement exits the snap range on side %i', side => {
    const ledge = make(side), f = p();
    const reach = f.content.profile.ledgeSnap.x * f.content.profile.attributes.modelScale;
    f.x = ledge.x - ledge.facing * (reach - 0.2);
    f.velocity.x = -ledge.facing * 4;
    step(); expect(p().combat.ledge).toBe(ledge.id);
  });

  it.each([0, 1])('C-stick away/down drops from ledge %i instead of attacking', side => {
    let ledge = hang(side); step({ cX: -ledge.facing });
    expect(p()).toMatchObject({ state: 'fall' }); expect(p().combat.ledge).toBeNull();
    ledge = hang(side); step({ cY: -1 });
    expect(p().state).toBe('fall'); expect(p().combat.ledge).toBeNull();
    expect(p().combat.cooldown).toBeGreaterThan(0);
  });

  it.each([0, 1])('C-stick toward ledge %i rolls while C-stick up attacks', side => {
    const ledge = hang(side); step({ cX: ledge.facing });
    expect(p().animation).toBe('CliffEscapeQuick');
    hang(side); step({ cY: 1 }); expect(p().animation).toBe('CliffAttackQuick');
  });

  it('does not turn a C-stick held through CliffCatch into a drop before neutral rearming', () => {
    make(); step(); expect(p().animation).toBe('CliffCatch');
    for (let n = 0; n < 25; n++) step({ cY: -1 });
    expect(p()).toMatchObject({ state: 'ledge', animation: 'CliffWait' });
    expect(p().combat.ledgeReady).toBe(false);
    step(); step({ cY: -1 }); expect(p().state).toBe('fall');
  });

  it.each([0, 1])('uses tap-up to jump, a held/soft up to climb, and inward stick to climb at ledge %i', side => {
    hang(side); step({ y: 1 }); expect(p().animation).toBe('CliffJumpQuick1');
    hang(side); step({ y: content.combat.ledge.tapJump!.threshold - 0.01 });
    expect(p().animation).toBe('CliffClimbQuick');
    const ledge = hang(side); step({ x: ledge.facing }); expect(p().animation).toBe('CliffClimbQuick');
  });

  it.each([0, 1])('does not snap from above the floor-contact height at ledge %i', side => {
    const ledge = make(side); p().y = ledge.y + 2; p().velocity.y = -0.01;
    step(); expect(p().y).toBeGreaterThan(ledge.y); expect(p().combat.ledge).toBeNull();
  });

  it('respects the inclusive down-stick rejection boundary', () => {
    const gate = content.combat.ledge.down;
    make(); step({ y: -gate }); expect(p().combat.ledge).toBeNull();
    const ledge = make(); step({ y: -gate + 0.001 }); expect(p().combat.ledge).toBe(ledge.id);
  });

  it('re-enables a facing catch only after the remaining cooldown expires', () => {
    const ledge = make(); p().combat.cooldown = 2;
    step(); expect(p().combat.ledge).toBeNull(); expect(p().combat.cooldown).toBe(1);
    step(); expect(p().combat.ledge).toBe(ledge.id);
  });

  it('B performs a ledge attack rather than being ignored', () => {
    hang(); step({ special: true }); expect(p().animation).toBe('CliffAttackQuick');
  });

  it('gives attack priority over shield/jump and shield priority over jump', () => {
    hang(); step({ attack: true, shield: true, jump: true }); expect(p().animation).toBe('CliffAttackQuick');
    hang(); step({ shield: true, jump: true }); expect(p().animation).toBe('CliffEscapeQuick');
  });

  it('drops on a steep down-toward diagonal instead of climbing', () => {
    const ledge = hang(); step({ x: ledge.facing * 0.7, y: -1, down: true });
    expect(p().state).toBe('fall'); expect(p().combat.ledge).toBeNull();
  });

  it('replays a C-stick drop and cooldown after restoring the ledge snapshot', () => {
    hang(); const saved = game.captureState();
    const drop = () => { step({ cY: -1 }); expect(p().state).toBe('fall'); step(); return game.stateHash(); };
    const hash = drop(); game.restoreState(saved); expect(drop()).toBe(hash);
  });

  it('still rejects down-held catches, occupied ledges and active aerial attacks', () => {
    make(); step({ down: true, y: -1 }); expect(p().combat.ledge).toBeNull();
    const ledge = make(); game.fighters[1]!.combat.ledge = ledge.id;
    step(); expect(p().combat.ledge).toBeNull();
    make(); step({ attack: true }); expect(p().state).toBe('attack'); expect(p().combat.ledge).toBeNull();
  });
});
