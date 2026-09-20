import type { HsdArchive } from '../hsd/archive.ts';
import type { FighterContent } from './load.ts';
import { articleModel, itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';

/** Black Sonic / Sonic BM (ACE 2.0 m-ex fighter, PlSc, mexproj 043). The ftFunction block ships
 * without debug symbols; every value below was read out of its compiled PowerPC code
 * (motion n = move_logic entry n - 341; disassembly retained only in private research storage).
 * Only the down special reads `special_attributes` (ftDataBSonic+4); everything else the
 * code loads as literals from its own rodata, listed in BSONIC_CODE. */
export interface BSonicSpecialData {
  kind: 'Sc';
  /** Spin Dash (motions 349-359). M354_Anim caps ft_var52 at x4; M358_Phys rolls at
   * (level·xC + x8)·facing; M358_Anim writes hitbox 0 damage level·x14 + x10. */
  down: { maxLevel: number; rollSpeed: number; rollSpeedPerLevel: number; damage: number; damagePerLevel: number };
}

/** Literals of the compiled ftFunction code, named after the callback that loads them. */
export const BSONIC_CODE = {
  neutral: {
    /** M343_Anim: rivals are searched within x29c8 of fp->pos (strictly nearer wins). */
    searchRadius: 45,
    /** M343_Anim: with no rival the homing point sits x29e0 ahead and x29e4 below. */
    missAhead: 30, missBelow: 15,
    /** M343_Anim: state_var9, the homing frame budget. */
    homingFrames: 30,
    /** M364_Phys: the heading is renormalised to x29a0 every frame. */
    homingSpeed: 3,
    /** M364_Anim: the dash ends once fp->pos is within x29bc of the point. */
    arriveDistance: 2,
    /** M364_Coll: a floor touch only lands after frame x29c4. */
    landAfter: 4,
    /** ptr_03a14 (deal_dmg_cb): bounce 2·(−cos, sin)(x299c) away from the target. */
    bounceAngle: Math.fround(0.85), bounceSpeed: 2,
  },
  side: {
    /** M360_Phys / M361_Phys: self_vel.x = facing · x3610 (double). */
    dashSpeed: 2.6465,
    /** M361_Anim: at flag2 the dash carries on only while the stick holds forward past x3630. */
    holdStick: 0.275,
    /** M363_Phys (SEnd, SEndSpecialFall): ft_80084EEC, then self_vel.x ·= x3640. */
    endDecay: 0.92,
  },
  up: {
    /** M347_Phys: flag1 = 1 (script frame 4) launches at self_vel = (0, x29ac). */
    rise: 3.75,
    /** M347_Anim: before frame x29d4 the stick past ±x3630 turns Sonic around. */
    turnFrames: 6, turnStick: 0.275,
  },
  down: {
    /** M354_Anim: state_var11, the roll's frame budget. */
    rollFrames: 60,
    /** M358_Phys: acceleration toward the roll speed (x29b4) and while turning (x29b0). */
    rollAccel: 0.25, turnAccel: 0.15,
    /** M358_Anim: the stick past ±x3658 against the facing turns the roll. */
    turnStick: 0.2,
    /** M358_IASA: a jump leaves the roll at self_vel.y = x29bc. */
    jumpRise: 2,
    /** sub_0381c: walking off keeps rolling in the air only at |self_vel.x| ≥ x29dc. */
    airborneSpeed: 0.5,
    /** sub_038f8: landing faces the stick past ±x3658. */
    landStick: 0.2,
    /** M359_Anim: ftColl_8007ABD0 damage of the air roll per level 1-4 (others keep the script's). */
    airDamage: [null, 6, 8, 9, 11] as ReadonlyArray<number | null>,
    /** M359_IASA: A or the C-stick past ±x3670 opens ftCo_Fall_IASA_Inner. */
    cStick: 0.31,
    /** M368_Phys: above jump_h_max_velocity the air cancel keeps x3648 of self_vel.x. */
    cancelDecay: 0.9,
  },
  /** M346_Coll / M366_Coll: ftCo_LandingFallSpecial_Enter at x29a8; M363_Anim / M367_Anim enter
   * special fall (ftCo_80096900) with mobility x2994 and the same landing lag. */
  specialLanding: 28, specialFallMobility: 1,
  /** M347_IASA / ptr_02f08: with flag2 (or ft_var51 in Fall) only A, B or the C-stick past x3650 act. */
  iasaCStick: 0.1,
  spring: {
    /** Spawn (ptr_03678+8) and every jump-on (ptr_03bf4): it_80275158(x29cc). */
    lifetime: 175,
    /** ptr_03bf4: another fighter leaves in JumpF/JumpB with self_vel.y += x29d0. */
    otherBounce: 4.5,
    /** ptr_03bf4+0x180: Black Sonic's air Spin Dash re-enters SpecialAirLwLoop with self_vel.y += x29c4. */
    rollBounce: 4,
  },
  /** Code-played sound effects (ft_800881D8). */
  sounds: { charge: 0x138c, spring: 0x138f, roll: 0x1392 },
} as const;

/** ftCo_800C703C: stepping onto an item blends the fighter's motion from (vx, x6D0) over x6CC
 * frames (PlCo ftCommonData, v1.02: 2.3 over 40 frames). The port has no per-fighter velocity
 * blend, so a spring relaunch into SpecialHi starts its four gravity-free frames at x6D0. */
export const ITEM_STEP_RISE = 2.3;
/** ft_80082B1C: a landing faster than −ftCo_800D0EC8 (PlCo x310 = 1 at scale 1) plays Landing,
 * a slower touch goes straight to Wait. */
export const LANDING_SPEED = 1;

export function parseBSonicParameters(arc: HsdArchive): BSonicSpecialData {
  const attrs = arc.pointer(arc.symbol('ftDataBSonic') + 4);
  const f = (o: number) => arc.f32(attrs + o), u = (o: number) => arc.u32(attrs + o) | 0;
  const p: BSonicSpecialData = {
    kind: 'Sc',
    down: { maxLevel: u(4), rollSpeed: f(8), rollSpeedPerLevel: f(0xc), damage: u(0x10), damagePerLevel: u(0x14) },
  };
  const d = p.down;
  if (d.maxLevel < 1 || d.maxLevel > 20 || !(d.rollSpeed > 0 && d.rollSpeed < 20) || !(d.rollSpeedPerLevel >= 0 && d.rollSpeedPerLevel < 5)
    || d.damage < 0 || d.damage > 100 || d.damagePerLevel < 0 || d.damagePerLevel > 50)
    throw new Error('Unsupported original Black Sonic special parameters.');
  return p;
}

/** Article 0 (itFunction item 0): the spring. State 0 idles on the floor (no hit, jump-on
 * enabled by the spawn's xDD0 flag); state 1 is the airborne spring, whose script hitbox rides
 * it down and through its floor rebound. `top`/`halfWidth` come from the common attributes'
 * itECB (x20 top/bottom, x28 right/x2C left): the stomp line (it_80274D6C) sits at the top.
 * Articles 1 (after-image trail) and 2 (homing reticle) are visual-only and not ported. */
export interface BSonicSpringData extends ArticleData { top: number; halfWidth: number; airHit: ArticleData['hit'] }
export interface BSonicArticles { spring: BSonicSpringData }

export function parseBSonicArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataBSonic') + 0x48);
  const article = arc.pointer(table), common = arc.pointer(article), states = arc.pointer(article + 12);
  if (!common || !states) throw new Error('Black Sonic spring article is incomplete.');
  const c = (o: number) => { const v = arc.f32(common + o); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw new Error('Invalid Black Sonic spring attribute.'); return v; };
  const script = arc.pointer(states + 0x10 + 12), airHit = script ? itemHit(arc, script) : null;
  if (!airHit) throw new Error('The Black Sonic air spring carries no original hit.');
  const top = c(0x20), bottom = c(0x24), halfWidth = Math.max(Math.abs(c(0x28)), Math.abs(c(0x2c)));
  const spring: BSonicSpringData = {
    model: articleModel(arc, article, 'bsonic-spring', states), hit: airHit, speed: 0, angle: 0, lifetime: BSONIC_CODE.spring.lifetime,
    gravity: c(0x10), terminal: c(0x14), bounce: c(0x58), minSpeed: 0, scale: c(0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0,
    top: Math.fround(top - bottom), halfWidth, airHit,
  };
  if (!(spring.gravity > 0) || !(spring.terminal > 0) || !(spring.top > 0 && spring.top < 50) || !(halfWidth > 0 && halfWidth < 50) || !(spring.bounce >= 0 && spring.bounce <= 1))
    throw new Error('Unsupported Black Sonic spring bounds.');
  return { bsonic: { spring } };
}

/** m-ex action table (anim id − 51). Duplicates: Wait1 x2 (primary 2), Landing x3 (primary 13). */
export const BSONIC_ACTION_KEYS: ReadonlyArray<{ key: string; index: number; figatree: string }> = [
  { key: 'Wait1', index: 2, figatree: 'Wait1' },
  { key: 'Landing', index: 13, figatree: 'Landing' },
  { key: 'SpecialNStart', index: 244, figatree: 'SpecialNStart' },
  { key: 'SpecialAirNStart', index: 245, figatree: 'SpecialAirNStart' },
  { key: 'SpecialN', index: 263, figatree: 'SpecialN' },
  { key: 'SpecialNLanding', index: 264, figatree: 'SpecialNLanding' },
  { key: 'SpecialNEnd', index: 265, figatree: 'SpecialNEnd' },
  { key: 'SpecialNEndSpecialFall', index: 266, figatree: 'SpecialNEndSpecialFall' },
  { key: 'SpecialSStart', index: 246, figatree: 'SpecialSStart' },
  { key: 'SpecialAirSStart', index: 247, figatree: 'SpecialAirSStart' },
  { key: 'SpecialS', index: 260, figatree: 'SpecialS' },
  { key: 'SpecialAirS', index: 259, figatree: 'SpecialAirS' },
  { key: 'SpecialSCancel', index: 261, figatree: 'SpecialSCancel' },
  { key: 'SpecialSEnd', index: 268, figatree: 'SpecialSEnd' },
  { key: 'SpecialSEndSpecialFall', index: 262, figatree: 'SpecialSEndSpecialFall' },
  { key: 'SpecialHi', index: 248, figatree: 'SpecialHi' },
  { key: 'SpecialAirHi', index: 249, figatree: 'SpecialAirHi' },
  { key: 'SpecialLwStart', index: 250, figatree: 'SpecialLwStart' },
  { key: 'SpecialAirLwStart', index: 251, figatree: 'SpecialAirLwStart' },
  { key: 'SpecialLwHold', index: 253, figatree: 'SpecialLwHold' },
  { key: 'SpecialLwCancel', index: 254, figatree: 'SpecialLwCancel' },
  { key: 'SpecialAirLwHold', index: 255, figatree: 'SpecialAirLwHold' },
  { key: 'SpecialLwEnd', index: 256, figatree: 'SpecialLwEnd' },
  { key: 'SpecialLwLoop', index: 257, figatree: 'SpecialLwLoop' },
  { key: 'SpecialAirLwLoop', index: 258, figatree: 'SpecialAirLwLoop' },
  { key: 'SpecialAirLwCancel', index: 267, figatree: 'SpecialAirLwCancel' },
];

export const BSONIC_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13',
  dash: 'AttackDash', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  strong: 'AttackS4S', upSmash: 'AttackHi4', downSmash: 'AttackLw4',
  neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};

/** The compiled PlSc ftFunction's spawn routine (block offsets 0x104-0x190) calls ftParts_80074A4C(gobj, group, alternative) for groups 1-9 before any script
 * runs. Group 9 is the Spin Dash ball (dobj 17, a 9.6 sphere): without these defaults every
 * single-alternative group shows its only object, so the ball, both eyelids and all three
 * variants of the mouth/hand overlays draw at once over the standing body. */
export const BSONIC_PART_DEFAULTS: readonly number[] = [0, 1, 1, 0, 1, 1, 0, 1, 1, 1];
