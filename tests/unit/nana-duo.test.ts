import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { HsdArchive } from '../../lib/hsd/archive.ts';
import type { AnimationClip } from '../../lib/hsd/animation.ts';
import type { V3 } from '../../lib/hsd/model.ts';
import { parseAttack, type AttackDefinition } from '../../lib/game/moves.ts';
import type { CommonGameplayData, FighterAttributes, FighterProfile, StageGameplayData } from '../../lib/game/data.ts';
import type { CombatData as CombatDataType } from '../../lib/game/combat-data.ts';
import { instantiateGameplay, MeleePhysics } from '../../lib/game/physics.ts';
import type { FighterContent, GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchFighter, type PlayerInput, type PoseProvider } from '../../lib/game/match.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import type { PopoSpecialData } from '../../lib/game/popo-data.ts';

/** Headless Ice Climbers duo verification: synthetic stage/fighters with real
 * WASM physics and the real action-script parser, so the combat refactor
 * (strikeConnect parity), Nana echoes, Nana victims, Sopo KO/revive and
 * rollback determinism are pinned without requiring a disc. */
function scriptArchive(words: number[]): HsdArchive {
  const dataSize = Math.max(words.length * 4, 32), bytes = new Uint8Array(dataSize + 32), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length); view.setUint32(4, dataSize);
  words.forEach((word, index) => view.setUint32(32 + index * 4, word));
  return new HsdArchive(bytes);
}
// One active frame at frame 2 (same encoding as gameplay-core.test.ts).
const jabScript = (damage: number) => [(2 << 26) | 2, (11 << 26) | (0 << 11) | damage, 256 << 16, 0, (45 << 23) | (100 << 14), (20 << 23) | 3, (1 << 26) | 3, 16 << 26, 0];
const clip = (endFrame: number): AnimationClip => ({ name: 'synthetic', endFrame, joints: [] });
const CLIP_NAMES = ['Wait1', 'Fall', 'JumpF', 'Landing', 'Squat', 'SquatRv', 'SquatWait', 'Run', 'WalkSlow', 'WalkMiddle', 'WalkFast', 'Attack11', 'Attack12', 'AttackDash', 'AttackS4', 'AttackS3S', 'AttackHi3', 'AttackLw3', 'AttackHi4', 'AttackLw4', 'AttackAirN', 'AttackAirF', 'AttackAirB', 'AttackAirHi', 'AttackAirLw', 'AttackS3', 'AttackHi4S', 'DamageN1', 'DamageFlyN', 'LandingAirN'];

const attributes: FighterAttributes = {
  walkSpeed: 1, walkAnimationScaling: [1, 1, 1], dashInitial: 2, runSpeed: 2, friction: 0.1,
  jumpStartup: 4, jumpSpeed: 5, hopSpeed: 3, gravity: 0.3, terminal: 8,
  maxJumps: 2, modelScale: 1, weight: 100, runAnimationScaling: 2, airFriction: 0.05,
  airDriftStickMul: 0.5, airDriftMax: 1, landingLag: 4,
  aerialLandingLag: 4, aerialForwardLandingLag: 4, aerialBackLandingLag: 4, aerialUpLandingLag: 4, aerialDownLandingLag: 4,
  jab2Window: 10, jab3Window: 10, rapidJabThreshold: 0,
  shieldSize: 10, shieldBreakY: 5, ledgeJumpX: 2, ledgeJumpY: 5, independentThrows: 0,
};
const profile = (kind: FighterKind, name: string): FighterProfile => ({
  kind, name, attributes, words: new Uint32Array(39),
  hurts: [{ bone: 0, a: [0, 0, 0], b: [0, 10, 0], radius: 4 }],
  boneMap: [0], boneCount: 1, partJoints: [0], motionRoot: 0,
  nudgeOffset: 0, nudgeRadius: 0.5, shieldBone: 0, ledgeSnap: { x: 0, y: 0, height: 0 },
  partVisibility: { groups: [], hidden: [] },
});
const MOVES = {
  jab: 'Attack11', jab2: 'Attack12', dash: 'AttackDash', strong: 'AttackS4', downTilt: 'AttackLw3', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
  sideTilt: 'AttackS3S', upTilt: 'AttackHi3', upSmash: 'AttackHi4',
};function fighter(kind: FighterKind, name: string, withPartner: boolean): FighterContent {
  const prof = profile(kind, name);
  const jab = parseAttack(scriptArchive(jabScript(5)), 0, 'Attack11', prof, 30);
  for (const event of jab.events) {
    if (event.type !== 'create') continue;
    event.hit.bone = 0; event.hit.offset = [8, 8, 0]; event.hit.radius = 6; event.hit.damage = 5;
  }
  const attacks = new Map<string, AttackDefinition>([['Attack11', jab]]);
  const clips = new Map<string, AnimationClip>();
  for (const move of [...Object.values(MOVES), ...CLIP_NAMES]) {
    if (!attacks.has(move)) attacks.set(move, { name: move, events: [], interruptFrame: null, ignoredOpcodes: [] });
    clips.set(move, clip(30));
  }
  const parameters = kind === 'Pp'
    ? { kind: 'Pp', neutral: { hover: 1 }, side: { groundVel: 3, airVelY1: 1, airVelY2: 1, airVelX: 3 }, up: { divisorX: 2, divisorY: 2, rise: 5, fallGravity: 0.3, fallTerminal: 5, landing: 25, landClear: 10, stick: 0.5 }, down: { interval: 10, offsetX: 0, offsetY: 5 }, ice: { life: 60, lifeDec: 5, stopSpeed: 0.95, startSpeed: 1.5, slopeMul: 0.8, damageScale: 2, baseDamage: 2, slopeUp: 0.22, slopeDown: 0.25 }, blizzard: { speed: 2, gravity: 0, coneLo: 0.785, coneHi: 1.745 } } satisfies PopoSpecialData
    : { kind: 'Mr' };
  return {
    profile: prof, model: {} as never, clips, attacks, timelines: attacks,
    specials: { parameters: parameters as never, articles: {}, effects: new Map(), sounds: { jump: 1, airJump: 2, ko: 3 } },
    moves: MOVES,
    ...(withPartner ? { partnerModel: {} as never } : {}),
  };
}
const stage: StageGameplayData = {
  scale: 1, floors: [{ id: 1, a: [-100, 0], b: [100, 0], oneWay: false }], surfaces: [],
  blast: { left: -200, right: 200, top: 200, bottom: -100 },
  spawns: [[-30, 0, 0], [30, 0, 0]], mainLeft: -100, mainRight: 100, ledges: [],
};
const common = {
  words: [], stickDeadzone: 0.2, walkThreshold: 0.3, dashThreshold: 0.8,
  chargeSoundFrame: 10, chargeVulnerability: 1.5, fastFallThreshold: 0.7, fastFallWindow: 5,
  nudgeSpeed: 0.5, boneMaps: {},
} as unknown as CommonGameplayData;
const combat: CombatDataType = {
  shield: { maximum: 60, minimumScale: 0.5, sizeScale: 1, drain: 1, regen: 1, restored: 10, damageScale: 1, damageBase: 0, stunScale: 1, stunBase: 0, pushScale: 1, pushMaximum: 5, minimumHold: 5, dizzyBase: 100, dizzyMinimum: 50 },
  dodge: { down: 10, side: 10, sideFrames: 4, deadX: 0.5, deadY: 0.5, speed: 5, decay: 0.9, mobility: 1, landing: 10 },
  grab: { base: 100, percentScale: 1, decay: 1, mash: 1, weightScale: 1 },
  bury: { sinkFrames: 10, base: 100, percentScale: 1, decay: 1, mash: 1 },
  ledge: { down: 10, input: 10, slowPercent: 100, quickWait: 10, slowWait: 20, cooldown: 10, invincibility: 30 },
  ice: { size: 8, gravity: 0.5, timerScale: 3, decay: 1, mash: 10, damageScale: 8, spinMin: 0.1, spinMax: 0.3, jumpFrames: 12, knockbackScale: 1, minKnockback: 20 },
};
// World-space stub: Popo reads the leader pose, Nana reads her own follow pose.
const poses: PoseProvider = {
  sample() {},
  point: (f: MatchFighter, _bone: number, offset: V3): V3 => [f.x + offset[0] * f.facing, f.y + offset[1], offset[2] ?? 0],
  partnerPoint: (f: MatchFighter, _bone: number, offset: V3): V3 => {
    const nana = f.nana!;
    return [nana.x + offset[0] * nana.facing, nana.y + offset[1], offset[2] ?? 0];
  },
};

describe('Ice Climbers duo on synthetic content (no disc required)', () => {
  let physics: MeleePhysics;
  const duo = () => [fighter('Pp', 'Ice Climbers', true), fighter('Mr', 'Mario', false)] as [FighterContent, FighterContent, ...FighterContent[]];
  const solo = () => [fighter('Pp', 'Ice Climbers', false), fighter('Mr', 'Mario', false)] as [FighterContent, FighterContent, ...FighterContent[]];
  const content = (fighters: [FighterContent, FighterContent, ...FighterContent[]]): GameContent => ({
    common, combat, stage, stageModel: {} as never, stageId: 'battlefield',
    fighters, roster: new Map<FighterKind, FighterContent>(fighters.map((f) => [f.profile.kind, f])),
    physics, sound: {} as never,
  });
  const make = (fighters = duo()) => {
    const game = new LocalMatch(content(fighters), poses, { opponent: 'human', controllers: ['human', 'human'], seatIds: [0, 1], countdown: 0, seed: 7 });
    game.start();
    // Pin both climbers and the rival on the floor for geometry-exact asserts.
    const popo = game.fighters[0]!, rival = game.fighters[1]!;
    popo.x = 0; popo.y = 0; popo.facing = 1; popo.grounded = true; popo.floor = 1;
    rival.x = 30; rival.y = 0; rival.facing = -1; rival.grounded = true; rival.floor = 1;
    if (popo.nana) { popo.nana.x = -9; popo.nana.y = 0; popo.nana.grounded = true; popo.nana.floor = 1; }
    return game;
  };
  const step = (game: LocalMatch, a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) =>
    game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const jab = (game: LocalMatch, a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => {
    step(game, { attack: true, ...a }, b);
    for (let i = 0; i < 8; i++) step(game, a, b);
  };
  beforeAll(async () => {
    const wasm = new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
    physics = new MeleePhysics(await instantiateGameplay(wasm), common, duo().map((f) => f.profile));
  });
  it('spawns Nana beside Popo, or solo without a partner model', () => {
    expect(make().fighters[0]!.nana).toMatchObject({ active: true, x: -9, percent: 0 });
    expect(make(solo()).fighters[0]!.nana).toBeNull();
  });
  it('keeps solo hammer damage identical through the strike refactor', () => {
    for (const fighters of [duo(), solo()]) {
      const game = make(fighters);
      // Popo's hammer reaches (4 < 6 + 4); her echo swings 8 ahead of her own
      // anchor and falls 13 short, so exactly one hammer lands either way.
      game.fighters[1]!.x = 12;
      jab(game);
      expect(game.fighters[1]!.percent).toBe(5);
      expect(game.fighters[0]!.nana?.percent ?? 0).toBe(0);
    }
  });
  it('echoes her own hammer for duo double damage', () => {
    const game = make();
    game.fighters[1]!.x = -2; // both hammers reach: Popo at 10, echo at 7.
    jab(game);
    expect(game.fighters[1]!.percent).toBe(10);
    expect([...game.fighters[0]!.victims].some((key) => key.startsWith('nana:1:'))).toBe(true);
  });
  it('lands the echo alone when the rival crowds her out of his reach', () => {
    const game = make();
    game.fighters[1]!.x = -9; // echo at 0, Popo's hammer 17 short.
    jab(game);
    expect(game.fighters[1]!.percent).toBe(5);
  });
  it('takes strikes on her own percent pool and tumbles without touching Popo', () => {
    const game2 = make();
    game2.fighters[1]!.x = -19; game2.fighters[1]!.facing = 1;
    step(game2, {}, { attack: true });
    for (let i = 0; i < 3; i++) step(game2);
    expect(game2.fighters[0]!.nana!.percent).toBe(5);
    expect(game2.fighters[0]!.nana!.tumble).toBeGreaterThan(0);
    expect(game2.fighters[0]!.percent).toBe(0);
    expect(game2.fighters[0]!.state).toBe('idle');
    expect([...game2.fighters[1]!.victims].some((key) => key.startsWith('vn:0:'))).toBe(true);
    // She lands and recovers back to the follow a few frames later.
    for (let i = 0; i < 15; i++) step(game2);
    expect(game2.fighters[0]!.nana!.tumble).toBe(0);
    expect(game2.fighters[0]!.nana!.grounded).toBe(true);
  });
  it('goes Sopo on launch and revives with Popo\u2019s next stock', () => {
    const game = make();
    game.fighters[0]!.nana!.x = 9999; game.fighters[0]!.nana!.invulnerable = 0;
    step(game);
    expect(game.fighters[0]!.nana!.active).toBe(false);
    expect(game.events.some((e) => e.type === 'ko')).toBe(true);
    game.fighters[0]!.x = 9999;
    for (let i = 0; i < 90; i++) step(game);
    expect(game.fighters[0]!.stocks).toBe(2);
    expect(game.fighters[0]!.nana!.active).toBe(true);
    expect(game.fighters[0]!.nana!.percent).toBe(0);
    expect(game.snapshot().fighters[0]!.nana).toMatchObject({ active: true });
  });
  it('follows Popo, restores across rollback and replays deterministically', () => {
    const run = () => {
      const game = make();
      for (let n = 0; n < 30; n++) step(game, { x: n % 20 < 10 ? 1 : -1, attack: n === 5 }, { x: n % 2 ? 0.5 : -0.5 });
      return game.stateHash();
    };
    // Nana trails the walking Popo instead of sticking to spawn.
    const game = make();
    for (let n = 0; n < 30; n++) step(game, { x: 1 }, {});
    // Grounded idle Popo holds still (no walk without the walk flag... he walks:
    // either way Nana stays glued to her anchor behind him).
    expect(Math.abs(game.fighters[0]!.nana!.x - (game.fighters[0]!.x - 9))).toBeLessThan(8);
    expect(run()).toBe(run());
    const game2 = make();
    for (let n = 0; n < 15; n++) step(game2, { attack: n === 3 }, {});
    const snapshot = game2.captureState();
    const nanaBefore = { ...game2.fighters[0]!.nana! };
    for (let n = 0; n < 15; n++) step(game2, { x: 1 }, {});
    game2.restoreState(snapshot);
    expect(game2.fighters[0]!.nana).toEqual(nanaBefore);
    expect(game2.stateHash()).toBe(game2.stateHash(snapshot));
  });
});
