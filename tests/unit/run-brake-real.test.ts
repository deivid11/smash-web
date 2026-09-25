import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { commandValue, hasMeleeRun } from '../../lib/game/locomotion.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

// Original ground locomotion (ftCo_Dash / Run / RunBrake / TurnRun) instead of a single
// Run state that stood in Wait1 while sliding and flipped its facing mid-skid.
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original dash, run brake and run turn', () => {
  let base: GameContent, content: GameContent, rig: GameRigs | undefined, game: LocalMatch;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 120000);
  afterEach(() => { rig?.dispose(); rig = undefined; });
  const make = (kind: 'Fx' | 'Mr' | 'Lg' | 'Ms' = 'Fx') => {
    rig?.dispose(); content = rosterPair(base, kind, 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    const floor = content.stage.floors.find((entry) => !entry.oneWay)!;
    game.fighters.forEach((f, i) => { f.x = i ? 70 : -40; f.y = floor.a[1]; f.grounded = true; f.floor = floor.id; f.facing = 1; rig!.sample(f); });
  };
  const step = (input: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...input }, neutralInput()]);
  const ticks = (count: number, input: Partial<PlayerInput> = {}) => { for (let i = 0; i < count; i++) step(input); };
  const p = () => game.fighters[0]!;

  it('loads Dash, RunBrake and TurnRun with their original script commands', () => {
    make();
    const fox = content.fighters[0]!;
    expect(hasMeleeRun(fox)).toBe(true);
    // PlFx: cmd_vars[0] allows Run from Dash frame 12; RunBrake allows turning until frame 15.
    expect(commandValue(fox, 'Dash', 0, 11)).toBe(0);
    expect(commandValue(fox, 'Dash', 0, 12)).toBe(1);
    expect(commandValue(fox, 'RunBrake', 0, 14)).toBe(1);
    expect(commandValue(fox, 'RunBrake', 0, 15)).toBe(0);
    expect(base.common.runBrakeStick).toBeCloseTo(0.625, 5);
    expect(base.common.runTurnStick).toBeCloseTo(-0.375, 5);
  });

  it('dashes at the full initial speed and turns into Run while forward is held', () => {
    make();
    step({ x: 1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Dash', facing: 1 });
    expect(p().velocity.x).toBeCloseTo(p().content.profile.attributes.dashInitial, 4);
    ticks(14, { x: 1 });
    expect(p().animation).toBe('Run');
    expect(p().velocity.x).toBeCloseTo(p().content.profile.attributes.runSpeed, 3);
  });

  it('brakes a released run with the RunBrake skid, then stands', () => {
    make();
    ticks(40, { x: 1 });
    step();
    expect(p()).toMatchObject({ state: 'idle', animation: 'RunBrake', facing: 1 });
    let frames = 1;
    while (p().animation === 'RunBrake' && frames < 60) { step(); frames++; }
    expect(p().animation).toBe('Wait1');
    expect(frames).toBeLessThanOrEqual(31);
    ticks(20);
    expect(p().velocity.x).toBe(0);
  });

  it('crouch cancels the skid', () => {
    make();
    ticks(40, { x: 1 });
    step();
    expect(p().animation).toBe('RunBrake');
    step({ y: -1, down: true });
    expect(p().state).toBe('crouch');
  });

  it('smashing back enters Turn for one frame before a held direction re-dashes (dash dance)', () => {
    make();
    ticks(6, { x: 1 });
    const forward = p().velocity.x;
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'idle', animation: 'Turn', facing: 1 });
    const reduced = Math.fround(forward - Math.fround(forward * content.common.dashExitFriction!));
    expect(p().velocity.x).toBeCloseTo(content.physics.stationaryGround(0, reduced), 4);
    const carried = p().velocity.x;
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Dash', facing: -1 });
    expect(p().link.sideTicks).toBe(254);
    expect(p().velocity.x).toBeCloseTo(carried - p().content.profile.attributes.dashInitial, 4);
    let frames = 1;
    while (p().velocity.x > -0.5 && frames < 20) { step({ x: -1 }); frames++; }
    expect(frames).toBeLessThanOrEqual(8);
  });

  it.each([-1, 0, 1])('requires a fresh reverse flick at the native dash window boundary (%i)', (offset) => {
    make();
    const window = content.common.dashInputWindow!;
    expect(window).toBeGreaterThan(0);
    expect(window).toBeLessThan(content.common.smashInputWindow!);
    ticks(6, { x: 1 });
    // Cross the tilt deadzone without reaching the dash threshold, then push fully back.
    const age = window + offset;
    ticks(age, { x: -0.5 });
    step({ x: -1 });
    expect(p().link.sideTicks).toBe(age);
    expect(p().facing).toBe(1); // facing changes in the next Turn Anim callback, never on entry
    expect(p().animation).toBe(offset < 0 ? 'Turn' : 'Dash');
  });

  it('rearms a reverse flick after returning to neutral and restores its age on rollback', () => {
    make(); ticks(6, { x: 1 });
    ticks(content.common.dashInputWindow!, { x: -0.5 });
    const saved = game.captureState();
    step({ x: -1 }); expect(p().facing).toBe(1);
    const staleHash = game.stateHash();
    game.restoreState(saved); step({ x: -1 });
    expect(game.stateHash()).toBe(staleHash);
    step(); step({ x: -1 });
    expect(p()).toMatchObject({ facing: 1, animation: 'Turn' });
    step({ x: -1 });
    expect(p()).toMatchObject({ facing: -1, animation: 'Dash' });
  });

  it('honors the initial-dash reverse lockout but does not reapply it to a dash entered from Turn', () => {
    make();
    const lockout = content.common.dashInitialLockout!;
    expect(lockout).toBeGreaterThan(0);
    ticks(lockout, { x: 1 }); step({ x: -1 });
    expect(p()).toMatchObject({ animation: 'Dash', facing: 1, dashFromTurn: false });
    step(); step({ x: -1 }); expect(p().animation).toBe('Turn');
    step({ x: -1 }); expect(p()).toMatchObject({ animation: 'Dash', facing: -1, dashFromTurn: true });
    // A new reverse flick on frame 1 of this dash is eligible (native entry arg1=0).
    step({ x: 1 }); expect(p()).toMatchObject({ animation: 'Turn', facing: -1 });
    step({ x: 1 }); expect(p()).toMatchObject({ animation: 'Dash', facing: 1, dashFromTurn: true });
  });

  it.each(['Fx', 'Mr', 'Lg', 'Ms'] as const)('%s pivots on a one-frame reverse flick without starting another dash', kind => {
    for (const direction of [-1, 1]) {
      make(kind); p().facing = direction;
      ticks(6, { x: direction });
      step({ x: -direction });
      expect(p()).toMatchObject({ state: 'idle', animation: 'Turn', facing: direction });
      step();
      expect(p()).toMatchObject({ state: 'idle', animation: 'Turn', facing: -direction });
      // The facing must not toggle again, and Turn must not loop forever.
      for (let n = 0; p().animation === 'Turn' && n < 60; n++) { step(); expect(p().facing).toBe(-direction); }
      expect(p()).toMatchObject({ state: 'idle', animation: 'Wait1', facing: -direction });
    }
  });

  it.each(['attack', 'jump', 'grab', 'shield'] as const)('takes a standing %s on the pivot frame instead of a dash action', action => {
    make(); ticks(6, { x: 1 }); step({ x: -1 });
    step({ [action]: true });
    expect(p().facing).toBe(-1);
    const expected = { attack: 'Attack11', jump: 'Landing', grab: 'Catch', shield: 'GuardOn' };
    expect(p().animation).toBe(expected[action]);
    if (action === 'attack') expect(p().attackName).toBe(p().content.moves.jab);
  });

  it('restores the pending facing flip and both pivot/dash branches on rollback', () => {
    make(); ticks(6, { x: 1 }); step({ x: -1 });
    const pending = game.captureState();
    step(); const pivotHash = game.stateHash();
    step({ attack: true }); const attackHash = game.stateHash();
    game.restoreState(pending); step(); expect(game.stateHash()).toBe(pivotHash);
    step({ attack: true }); expect(game.stateHash()).toBe(attackHash);
    game.restoreState(pending); step({ x: -1 }); const dashHash = game.stateHash();
    expect(p().animation).toBe('Dash');
    game.restoreState(pending); step({ x: -1 }); expect(game.stateHash()).toBe(dashHash);
  });

  it('does not re-dash if the reverse stick is reapplied after the pivot frame', () => {
    make(); ticks(6, { x: 1 }); step({ x: -1 }); step();
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'idle', animation: 'Turn', facing: -1 });
  });

  it('freezes the pending pivot in hitlag and flips facing only after it resumes', () => {
    make(); ticks(6, { x: 1 }); step({ x: -1 });
    p().hitlag = 3;
    ticks(3);
    expect(p()).toMatchObject({ animation: 'Turn', stateFrame: 1, facing: 1 });
    step(); expect(p()).toMatchObject({ animation: 'Turn', facing: -1 });
    step(); expect(p().facing).toBe(-1);
  });

  it('permits a neutral-stick pivot smash facing the new direction', () => {
    make(); ticks(6, { x: 1 }); step({ x: -1 });
    step({ strong: true });
    expect(p()).toMatchObject({ state: 'attack', facing: -1 });
    expect(p().attackName).toBe(p().content.moves.strong);
  });

  it('retains an explicitly non-pivoting reverse-dash fallback without a Turn clip', () => {
    make(); const clips = p().content.clips, turn = clips.get('Turn')!;
    try {
      clips.delete('Turn'); ticks(6, { x: 1 }); step({ x: -1 });
      expect(p()).toMatchObject({ state: 'run', animation: 'Dash', facing: -1 });
    } finally { clips.set('Turn', turn); }
  });

  it('smash-turns a fresh reverse flick from standing; its follow-up dash skips the x44 lockout', () => {
    make(); ticks(3);
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'idle', animation: 'Turn', facing: 1 });
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Dash', facing: -1, dashFromTurn: true });
    step(); step({ x: 1 });
    expect(p()).toMatchObject({ animation: 'Turn', facing: -1 });
    step({ x: 1 });
    expect(p()).toMatchObject({ animation: 'Dash', facing: 1 });
  });

  it('walks on a stale full stick from standing: ftCo_Dash_CheckInput needs a fresh flick (slow Turn is unported)', () => {
    make(); ticks(3);
    p().previous = { ...p().previous, x: -1 }; p().link.sideTicks = 10;
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'walk', facing: -1 });
    // A fresh flick back the other way smash-turns, then dashes.
    step(); step({ x: 1 });
    expect(p()).toMatchObject({ state: 'idle', animation: 'Turn' });
    step({ x: 1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Dash', facing: 1 });
  });

  it('plays the crouch-down out and only dashes from SquatWait on a fresh flick (ftCo_Squat/SquatWait/SquatRv_IASA)', () => {
    // Forward during the crouch-down is ignored; once the clip ends the held stick is stale: stand up, then walk.
    make(); step({ y: -1, down: true });
    expect(p().animation).toBe('Squat');
    step({ x: 1 });
    expect(p().animation).toBe('Squat');
    let frames = 0;
    while (p().animation === 'Squat' && frames < 30) { step({ x: 1 }); frames++; }
    expect(p().animation).toBe('SquatRv');
    step({ x: 1 });
    expect(p().state).toBe('walk');
    // From SquatWait a fresh flick dashes, even rolled from down.
    make(); ticks(20, { y: -1, down: true });
    expect(p().animation).toBe(p().content.motions?.crouchWait ?? 'SquatWait');
    step({ x: 1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Dash' });
  });

  it('cannot grab from SquatWait (no Catch in ftCo_SquatWait_IASA) but can from the crouch-down', () => {
    make(); ticks(20, { y: -1, down: true });
    step({ y: -1, down: true, grab: true });
    expect(p().state).toBe('crouch');
    make(); step({ y: -1, down: true });
    step({ y: -1, down: true, grab: true });
    expect(p().state).toBe('grab');
  });

  // World yaw of YRotN (common bone 3): what is drawn and what the joint-attached hurtboxes use.
  const bodyYaw = () => {
    rig!.sample(p());
    const m = rig!.actors[0]!.jointWorldMatrix(p().content.profile.boneMap[3]!).elements;
    return Math.atan2(m[8]!, m[10]!) * 180 / Math.PI;
  };
  const sweep = (inputs: number[], motion: string) => {
    let last = bodyYaw(), seen = false;
    for (const x of inputs) {
      step({ x });
      const yaw = bodyYaw(), delta = Math.abs(((yaw - last + 540) % 360) - 180);
      seen ||= p().animation === motion;
      expect(delta, `${p().animation} frame ${p().animationFrame}`).toBeLessThan(60);
      last = yaw;
    }
    expect(seen).toBe(true);
    return last;
  };
  it.each(['Fx', 'Mr', 'Lg', 'Ms'] as const)('%s turns its body continuously through a pivot and a run turn (TopN yaw set only on motion change)', kind => {
    make(kind); ticks(6, { x: 1 });
    const pivot = sweep([-1, ...Array(20).fill(0)], 'Turn');
    expect(p()).toMatchObject({ animation: 'Wait1', facing: -1 });
    expect(Math.abs(pivot + 90)).toBeLessThan(20);
    make(kind); ticks(40, { x: 1 });
    const turned = sweep(Array(70).fill(-1), 'TurnRun');
    expect(p()).toMatchObject({ animation: 'Run', facing: -1 });
    expect(Math.abs(turned + 90)).toBeLessThan(25);
  });

  // ftCo_Dash/Run/Turn/TurnRun/RunBrake_IASA each accept a fixed set of actions (runPhaseGate).
  it('holds a Dash through a held crouch and squats on the frame its clip ends (no ftCo_800D5FB0 in Dash_IASA)', () => {
    make(); ticks(3, { x: 1 });
    const end = p().content.clips.get('Dash')!.endFrame;
    let frames = 0;
    while (p().animation === 'Dash' && frames < 60) { step({ y: -1, down: true }); frames++; }
    expect(p().animation).toBe('Squat');
    expect(3 + frames).toBeGreaterThanOrEqual(end);
    make(); ticks(4, { x: 1 }); ticks(4, { x: -1 });
    step({ y: -1, down: true });
    expect(p().animation).toBe('Dash');
  });

  it('turns A with the stick down into the dash attack out of Dash and Run (ftCo_AttackDash_CheckInput)', () => {
    make(); ticks(8, { x: 1 });
    expect(p().animation).toBe('Dash');
    step({ y: -1, down: true, attack: true });
    expect(p().attackName).toBe(p().content.moves.dash);
    make(); ticks(40, { x: 1 });
    expect(p().animation).toBe('Run');
    step({ x: 1, y: 1, attack: true });
    expect(p().attackName).toBe(p().content.moves.dash);
  });

  it('ignores attacks, specials and shield in RunBrake and TurnRun', () => {
    make(); ticks(40, { x: 1 }); step();
    expect(p().animation).toBe('RunBrake');
    step({ attack: true }); expect(p().animation).toBe('RunBrake');
    step({ shield: true }); expect(p().animation).toBe('RunBrake');
    step({ special: true }); expect(p().animation).toBe('RunBrake');
    make(); ticks(40, { x: 1 }); step({ x: -1 });
    expect(p().animation).toBe('TurnRun');
    step({ x: -1, attack: true }); expect(p().animation).toBe('TurnRun');
    step({ x: -1, shield: true }); expect(p().animation).toBe('TurnRun');
  });

  it('rolls forward from a shield held in the first Dash frames (ftCo_80099264, PlCo x48)', () => {
    make(); step({ x: 1 });
    expect(p().animationFrame).toBeLessThanOrEqual(content.common.dashRollWindow!);
    step({ x: 1, shield: true });
    expect(p().animation).toBe('EscapeF');
  });

  it('pulling back from a run skids through TurnRun and faces the new way only once stopped', () => {
    make();
    ticks(40, { x: 1 });
    step({ x: -1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'TurnRun', facing: 1 });
    let frames = 1;
    while (p().facing === 1 && frames < 40) {
      expect(p().velocity.x).toBeGreaterThan(-0.2);
      step({ x: -1 }); frames++;
    }
    expect(p().facing).toBe(-1);
    ticks(20, { x: -1 });
    expect(p()).toMatchObject({ state: 'run', animation: 'Run' });
    expect(p().velocity.x).toBeLessThan(-1);
  });

  it('stops a braking slide at the ledge instead of carrying off the stage (ft_80084280)', () => {
    make();
    // The solid floor that ends at the main stage's right ledge.
    const floor = content.stage.floors.filter((entry) => !entry.oneWay).sort((a, b) => Math.max(b.a[0], b.b[0]) - Math.max(a.a[0], a.b[0]))[0]!;
    const edge = Math.max(floor.a[0], floor.b[0]);
    p().x = Math.max(edge - 70, Math.min(floor.a[0], floor.b[0]) + 1); p().y = Math.max(floor.a[1], floor.b[1]); p().floor = floor.id; rig!.sample(p());
    step();
    let frames = 0;
    while (p().x < edge - 12 && frames < 120) { step({ x: 1 }); frames++; }
    expect(p().grounded).toBe(true);
    ticks(45);
    expect(p()).toMatchObject({ grounded: true, state: 'idle' });
    expect(p().x).toBeLessThanOrEqual(edge);
    expect(p().velocity.x).toBe(0);
  });

  it('doubles standing friction above walk speed (ft_80084F3C), unlike the run brake', () => {
    make();
    const physics = content.physics, fox = content.fighters[0]!.profile.attributes;
    expect(physics.stationaryGround(0, 2.2)).toBeCloseTo(2.2 - 2 * fox.friction, 5);
    expect(physics.ground(0, 2.2, 0)).toBeCloseTo(2.2 - fox.friction, 5);
    expect(physics.stationaryGround(0, 1)).toBeCloseTo(1 - fox.friction, 5);
    // Shielding out of a full run stops sooner than letting it brake.
    const slide = (input: Partial<PlayerInput>) => { make(); ticks(40, { x: 1 }); const start = p().x; ticks(40, input); return p().x - start; };
    expect(slide({ shield: true })).toBeLessThan(slide({}));
  });
});
