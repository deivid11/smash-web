import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import { GAMEWATCH_PART_DEFAULTS, type GamewatchSpecialData } from './gamewatch-data.ts';
import { command, rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';
import type { ActiveHit } from './moves.ts';
import type { FighterContent } from './load.ts';
import type { HsdModel, V3 } from '../hsd/model.ts';

/** ftGw motion vars used by the prototype (oil/judge/chef memory persists on
 * the fighter like the native fighter vars). Roll -1 means unrolled. */
export interface GamewatchRuntime { count: number; roll: number; oil: number; aim: number }
const f32 = Math.fround;
const params = (f: MatchFighter): GamewatchSpecialData => {
  const p = f.content.specials.parameters;
  if (p.kind !== 'Gw') throw new Error('Missing Game & Watch parameters.');
  return p;
};
export function gamewatchSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded, r = f.special?.gamewatch;
  if (direction === 'neutral') return air ? 'SpecialAirN' : 'SpecialN';
  if (direction === 'side') {
    // Judgment number is rolled at begin (MS SpecialS1 + roll, anti-repeat).
    const n = Math.max(1, Math.min(9, (r?.roll ?? 0) + 1));
    if (phase === 'start') return air ? `SpecialAirS${n}` : `SpecialS${n}`;
    return air ? `SpecialAirS${n}` : `SpecialS${n}`;
  }
  if (direction === 'up') return air || f.special?.startedAir ? 'SpecialAirHi' : 'SpecialHi';
  if (phase === 'hit') return air ? 'SpecialAirLwShoot' : 'SpecialLwShoot';
  if (phase === 'loop') return air ? 'SpecialAirLwCatch' : 'SpecialLwCatch';
  return air ? 'SpecialAirLw' : 'SpecialLw';
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = gamewatchSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1;
  f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginGamewatchSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, p = params(f);
  s.gamewatch = { count: 0, roll: -1, oil: 0, aim: Math.PI / 2 };
  if (direction === 'side') {
    // Roll happens on the first step (needs simulation RNG); the animation is
    // corrected to SpecialS{roll} before anyone can see frame 0.
    // Aerial judgments keep divided momentum (ground keeps its run).
    if (!f.grounded && p.side.preserve !== 0) f.velocity.x = f32(f.velocity.x / p.side.preserve);
  }
  if (direction === 'down' && f.gwOil >= 3) {
    // Full bucket releases on entry (no catch state).
    s.gamewatch!.oil = f32(f.gwOilDamage * p.down.damageMul + p.down.damageAdd);
    f.gwOil = 0; f.gwOilDamage = 0;
    phase(f, 'hit');
  }
  if (direction === 'up' && !f.grounded) f.velocity.y = 0;
}
/** Selected alternative per part-visibility group (renderer only). Every action
 * starts from the ftGw_Init_OnDeath defaults and replays its own opcode-31
 * events up to the current frame; Oil Panic then shows the bucket and its fill
 * levels like ftGw_SpecialLw_UpdateBucketModel: while the absorb window is open
 * (cmd0, frames 5–37) and for the whole Catch and Shoot actions. */
export function gamewatchPartVisibility(f: MatchFighter): number[] {
  const groups = f.content.profile.partVisibility.groups.length;
  const defaults = Array.from({ length: groups }, (_, group) => GAMEWATCH_PART_DEFAULTS[group] ?? -1);
  let selected = [...defaults];
  for (const event of f.content.timelines.get(f.animation)?.events ?? []) {
    if (event.frame > f.animationFrame) break;
    // Opcode 32 restores the defaults (ftParts_80074A8C), 33 hides every group (ftParts_80074ACC).
    if (event.type === 'model-reset') selected = event.hidden ? defaults.map(() => -1) : [...defaults];
    if (event.type === 'model-part' && event.group >= 0 && event.group < groups) selected[event.group] = event.alternative;
  }
  const s = f.special;
  if (f.state === 'special' && s?.direction === 'down' && groups > 8 && (s.phase === 'loop' || s.phase === 'hit' || command(f, 0) !== 0)) {
    selected[5] = 2;
    for (let level = 0; level < 3; level++) selected[6 + level] = f.gwOil > level ? 0 : -1;
  }
  return selected;
}
/** ftDataGamewatch x4[costume]: the diffuse the fighter spawns with and that
 * it_8027CE64 (it_80278574) writes into every article he creates (sausages,
 * parachute), which otherwise render file-white. Null for other fighters. */
export function gamewatchCostume(content: FighterContent): V3 | null {
  const p = content.specials.parameters;
  return p.kind === 'Gw' ? p.costumes[Math.min(Math.max(content.costume ?? 0, 0), p.costumes.length - 1)]! : null;
}
/** Rim colour of his outline passes (fighter and articles): the TEV stage lerps the
 * costume colour toward GAMEWATCH_OUTLINE.rgb by its alpha. Null for other fighters. */
export function gamewatchRim(content: FighterContent): V3 | null {
  const p = content.specials.parameters, body = gamewatchCostume(content);
  if (p.kind !== 'Gw' || !body) return null;
  return [0, 1, 2].map((i) => f32(body[i]! + (p.outline.color[i]! - body[i]!) * p.outline.alpha)) as V3;
}
/** Outline-hull draw objects to hide: ftParts_80074B6C runs the body's group
 * selection over the outline set too, so only the selected alternatives draw. */
export function gamewatchHiddenOutline(f: MatchFighter, selected: readonly number[]): number[] {
  const hidden: number[] = [];
  params(f).outline.groups.forEach((alternatives, group) => alternatives.forEach((dobjs, alternative) => { if (alternative !== selected[group]) hidden.push(...dobjs); }));
  return hidden;
}
/** FtPart_LThumbNb: Judgment 7's food spawns from the left thumb. */
const FTPART_LTHUMBNB = 31;
/** ftGw_SpecialS_GetRandomInt: cumulative x34 weights over every number except the
 * last two rolled (the memory starts at {1,0}: ftGw_Init_OnDeath), one uniform draw
 * below the total (HSD_Randi). Returns the zero-based number. */
function rollJudgment(f: MatchFighter, p: GamewatchSpecialData, physics: MeleePhysics): number {
  const numbers: number[] = [], bounds: number[] = [];
  let total = 0;
  p.judgeRoll.forEach((weight, judge) => {
    if (judge === f.gwJudge1 || judge === f.gwJudge2) return;
    total += weight; numbers.push(judge); bounds.push(total);
  });
  const draw = Math.floor(physics.random() * total);
  // The original leaves the result undefined when every remaining weight is 0.
  const roll = numbers.find((_, i) => draw < bounds[i]!) ?? p.judgeRoll.findIndex((weight) => weight > 0);
  f.gwJudge2 = f.gwJudge1; f.gwJudge1 = roll;
  return roll;
}
/** The Judgment sign (It_Kind_GameWatch_Judge, renderer only): out from the cmd1 swing
 * (ftGw_SpecialS_ItemJudgementSetup) until he leaves the Judgment actions. `frame` is
 * the pose it_80273670 samples once: number n shows at frame n. */
export function gamewatchJudgeSign(f: MatchFighter): { frame: number; serial: number } | null {
  const s = f.special;
  if (f.content.profile.kind !== 'Gw' || f.state !== 'special' || s?.direction !== 'side' || !s.gamewatch || s.gamewatch.roll < 0) return null;
  return command(f, 1) !== 0 ? { frame: s.gamewatch.roll + 1, serial: s.serial } : null;
}
/** Outline-pass joints of one of his articles (it_266F_ItemVars), null for any other model. */
export function gamewatchArticleOutline(content: FighterContent, model: HsdModel): readonly number[] | null {
  const a = content.specials.articles.gamewatch;
  if (!a) return null;
  return model === a.sausage.model ? a.outlines.sausage : model === a.parachute.model ? a.outlines.parachute : model === a.judge.model ? a.outlines.judge : null;
}
/** Oil release damage (cmd_vars[1]) stamped onto the Shoot capsules. */
export function gwShootHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  const s = f.special;
  if (f.content.profile.kind !== 'Gw' || !s?.gamewatch || s.direction !== 'down' || s.phase !== 'hit') return hits;
  return hits.map((hit) => ({ ...hit, damage: s.gamewatch!.oil }));
}
/** ftGw absorb window (cmd0 nonzero) for the bucket. Called by projectiles. */
export function gamewatchAbsorber(f: MatchFighter): { bone: number; offset: [number, number, number]; radius: number } | null {
  if (f.content.profile.kind !== 'Gw' || f.state !== 'special' || !f.special) return null;
  const s = f.special;
  if (s.direction !== 'down' || (s.phase !== 'start' && s.phase !== 'loop')) return null;
  const p = f.content.specials.parameters;
  if (p.kind !== 'Gw') return null;
  if (command(f, 0) === 0) return null;
  return p.down.absorb;
}
/** Absorb contact switches the bucket to its Catch pose (match hook). */
export function gamewatchAbsorbed(f: MatchFighter): void {
  if (f.content.profile.kind !== 'Gw' || !f.special || f.special.direction !== 'down') return;
  if (f.special.phase === 'hit') return;
  f.special.phase = 'loop'; f.special.lastFrame = -1;
  f.animation = gamewatchSpecialName(f, f.special.direction, 'loop');
  f.animationFrame = 0; f.animationRate = 1; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
/** Original ftGw orchestration over the prototype floor adapter. */
export function stepGamewatchSpecial(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void): SpecialStep {
  const s = f.special!, r = s.gamewatch!, p = params(f), a = f.content.profile.attributes;
  const result: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const ordinary = (gravity = a.gravity, friction = a.airFriction) => {
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 } : physics.customAir(f.slot, f.velocity, gravity, a.terminal, friction);
  };
  const gather = () => { const events = (f.content.timelines.get(f.animation)?.events ?? []).filter((e) => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame; return events; };
  if (s.direction === 'neutral') {
    // Chef: cmd0 spawns a sausage while under the per-use max; type avoids the
    // last two thrown (uniform among the rest, simulation RNG).
    for (const e of gather()) {
      if (e.type !== 'command' || e.index !== 0 || e.value === 0) continue;
      if (r.count >= p.neutral.max) continue;
      r.count++;
      const last = [f.gwChefA, f.gwChefB];
      const options = [0, 1, 2, 3, 4].filter((t) => !last.includes(t));
      const pick = options[Math.floor(physics.random() * options.length)] ?? 0;
      f.gwChefB = f.gwChefA; f.gwChefA = pick;
      result.shots.push({ player: f.slot, kind: 'sausage', variant: pick });
    }
    if (ended()) { finish(false, 0, 1); return result; }
    ordinary();
  } else if (s.direction === 'side') {
    // Judgment ends into a normal fall when airborne, idle grounded.
    if (r.roll < 0) {
      r.roll = rollJudgment(f, p, physics);
      phase(f, 'start');
      return result;
    }
    // Walking off or landing swaps SpecialS<->SpecialAirS on the same frame
    // (transition_flags); hits already landed stay landed.
    const name = gamewatchSpecialName(f, 'side', 'start');
    if (f.animation !== name) { f.animation = name; f.attackName = name; }
    for (const e of gather()) {
      // Judgment 1's ftAction_80072BF4 recoil (12%) lands with the swing, hit or miss.
      if (e.type === 'self-damage') f.percent = f32(Math.max(0, Math.min(999, f.percent + e.damage)));
      // ftGw_SpecialS_ItemJudgementSetup (cmd1): Judgment 7 also drops a food 5 up
      // from his left thumb (it_8028FAF4; only when items are on).
      if (e.type === 'command' && e.index === 1 && e.value !== 0 && r.roll === 6) (result.items ??= []).push({ kind: 'food', part: FTPART_LTHUMBNB, offset: [0, 5, 0] });
    }
    if (ended()) { finish(false, 0, 1); return result; }
    // ftGw_SpecialAirS_Phys: the first frame cmd0 is set (frame 1) hops by x28 when
    // this airtime has not hopped yet (x2234), otherwise stops the rise; from then on
    // Judgment falls by x2C/x30. x24 air friction always. Grounded it only brakes, and
    // the hop is spent there too, so walking off mid-swing never hops.
    const armed = command(f, 0) !== 0;
    if (armed && r.count === 0) {
      r.count = 1;
      if (!f.grounded) { f.velocity = { x: f.velocity.x, y: f.gwJudgeHop ? 0 : p.side.velY }; f.gwJudgeHop = true; }
    }
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 }
      : physics.customAir(f.slot, f.velocity, armed ? p.side.frictionA : a.gravity, armed ? p.side.frictionB : a.terminal, p.side.mul);
  } else if (s.direction === 'up') {
    if (ended()) {
      if (p.up.landing > 0) finish(true, p.up.landing, 1);
      else finish(false, 0, 1);
      return result;
    }
    result.handled = true;
    // Fire Rescue rises on root motion; stick past the range tilts the ascent.
    if (command(f, 0) === 0 && Math.abs(input.x) > p.up.stickRange) {
      const tilt = p.up.angle * ((Math.abs(input.x) - p.up.stickRange) / (1 - p.up.stickRange));
      s.aim = input.x > 0 ? -tilt : tilt;
    }
    const delta = rootDelta(f);
    f.velocity = physics.motion(f.slot, delta.z, delta.y, f.facing, s.aim === Math.PI / 2 ? 0 : s.aim);
    if (f.velocity.y > 0.01) { f.grounded = false; f.floor = null; }
  } else {
    if (s.phase === 'start' && ended()) { finish(false, 0, 1); return result; }
    if (s.phase === 'loop' && ended()) {
      if (input.special) { phase(f, 'start'); return result; }
      finish(false, 0, 1); return result;
    }
    if (s.phase === 'hit' && ended()) { finish(false, 0, 1); return result; }
    ordinary();
  }
  return result;
}
export function landGamewatchSpecial(f: MatchFighter, finish: (helpless: boolean, lag: number, mobility: number) => void): boolean {
  const s = f.special; if (!s) return false;
  const p = params(f);
  if (s.direction === 'up') {
    if (p.up.landing > 0) { finish(false, 0, 1); f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.ceil(p.up.landing); }
    else finish(false, 0, 1);
    return true;
  }
  // ftGw_SpecialAirS_AirToGround: landing mid-Judgment re-arms the aerial hop.
  if (s.direction === 'side') f.gwJudgeHop = false;
  f.animation = gamewatchSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
