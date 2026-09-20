import type { CombatData } from './combat-data.ts';
import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SamusSpecialData } from './samus-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { command, rootDelta, type SpecialRuntime, type SpecialStep } from './specials.ts';

const params = (f: MatchFighter): SamusSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Ss') throw Error('Samus parameters missing.'); return p;
};
export function samusSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir';
  if (direction === 'neutral') return phase === 'start' ? `${prefix}NStart` : phase === 'loop' && f.grounded ? 'SpecialNHold' : phase === 'end' && f.grounded ? 'SpecialNCancel' : `${prefix}N`;
  if (direction === 'side') return `${prefix}S${f.special?.smashMissile ? 'Smash' : ''}`;
  // Ground Screw Attack keeps its root-motion clip in the air (ftSs_SpecialHi_Phys).
  if (direction === 'up') return f.special?.startedAir ? 'SpecialAirHi' : 'SpecialHi';
  return `${prefix}Lw`;
}
/** ftAction_80071D40 / ftParts_80074B0C: script-driven body/transition/ball variants. */
export function samusPartVisibility(f: MatchFighter): number[] {
  let selected = f.content.profile.partVisibility.groups.map(() => 0);
  for (const event of f.content.timelines.get(f.animation)?.events ?? []) {
    if (event.frame > f.animationFrame) break;
    if (event.type === 'model-reset') selected = selected.map(() => event.hidden ? -1 : 0);
    if (event.type === 'model-part' && event.group >= 0 && event.group < selected.length) selected[event.group] = event.alternative;
  }
  return selected;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  f.special!.phase = next; f.special!.lastFrame = -1;
  f.animation = samusSpecialName(f, f.special!.direction, next); f.animationFrame = 0; f.stateFrame = 0; f.animationRate = 1; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
/** ftSs_Unk3_803CE6B8: the five charge-loop cues, picked by how full the shot already is. */
const CHARGE_LOOP_SOUNDS = [260006, 260009, 260012, 260015, 260018];
/** ftCo_8009917C, reached from ftSs_SpecialNHold_IASA: a sideways stick tilt that is still
 * fresh (x670 under x320), or any deflected C-stick (ftCo_800DF8B0), rolls out of the charge.
 * Samus rolls as the Morph Ball. */
function chargeRoll(f: MatchFighter, input: PlayerInput, dodge: CombatData['dodge']): string | null {
  const stick = Math.abs(input.x) >= dodge.side && f.samusSideTicks < dodge.sideFrames ? input.x
    : Math.abs(input.cX ?? 0) >= dodge.side ? input.cX! : 0;
  if (!stick) return null;
  return stick * f.facing >= 0 ? 'EscapeF' : 'EscapeB';
}
export function beginSamusSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p = params(f), s = f.special!;
  s.reversed = false; s.smashMissile = f.samusSideTicks < p.side.smashWindow; s.chargeTicks = 0;
  if (direction === 'side') { f.velocity.x /= p.side.divisor; if (f.grounded) f.velocity.y = 0; }
  if (direction === 'up' && !f.grounded) { f.velocity.y = p.up.airY; f.velocity.x = Math.max(-p.up.maxX, Math.min(p.up.maxX, f.velocity.x)); }
  if (direction === 'down') { f.velocity.x *= f.grounded ? p.down.groundMomentum : p.down.airMomentum; if (!f.grounded) f.velocity.y = p.down.airY; }
}
/** Original ftSs_* state/parameter orchestration over the prototype floor solver.
 * No tether, bomb self-jump, walljump or full ECB/item collision implementation. */
export function stepSamusSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, dodge: CombatData['dodge'], finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  let end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  if (s.direction === 'neutral') {
    if (s.phase === 'start' && end) phase(f, !f.grounded || f.samusCharge === p.neutral.levels ? 'travel' : 'loop');
    else if (s.phase === 'loop') {
      // ftSs_SpecialNHold_Coll fires the shot when the ground runs out; only then does the
      // IASA run, and there the roll outranks B and shield. All three keep the stored level.
      const roll = f.grounded ? chargeRoll(f, input, dodge) : null;
      if (!f.grounded) phase(f, 'travel');
      else if (roll) { finish(); out.roll = roll; return out; }
      else if (pressed) phase(f, 'travel');
      else if (input.shield) phase(f, 'end');
      else {
        s.chargeTicks = (s.chargeTicks ?? 0) + 1;
        if (s.chargeTicks > p.neutral.interval) { s.chargeTicks = 0; f.samusCharge = Math.min(p.neutral.levels, f.samusCharge + 1); }
        if (f.samusCharge === p.neutral.levels) phase(f, 'end');
        else if (end) phase(f, 'loop');
      }
    } else if (end) { finish(!f.grounded && p.neutral.landing > 0, p.neutral.landing, 1); return out; }
  } else if (end) { finish(s.direction === 'up', p.up.landing, p.up.mobility); return out; }
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter(e => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame;
  if (s.direction === 'neutral') {
    // ftSs_SpecialNHold_Anim: the hold script's cmd2 re-cues the loop at the level reached so far.
    if (s.phase === 'loop' && events.some(e => e.type === 'command' && e.index === 2 && e.value === 1))
      out.sounds.push(CHARGE_LOOP_SOUNDS[Math.min(CHARGE_LOOP_SOUNDS.length - 1, Math.floor(CHARGE_LOOP_SOUNDS.length * f.samusCharge / p.neutral.levels))]!);
    if (s.phase === 'travel' && events.some(e => e.type === 'command' && e.index === 1 && e.value === 1)) {
      out.shots.push({ player: f.slot, kind: 'charge', charge: f.samusCharge });
      if (!f.grounded) f.velocity.x = Math.fround(f.facing * p.neutral.recoil * f.samusCharge);
      f.samusCharge = 0;
    }
  } else if (s.direction === 'side') {
    if (s.startedAir !== !f.grounded) { finish(); return out; }
    if (events.some(e => e.type === 'flag' && e.flag === 24)) out.shots.push({ player: f.slot, kind: s.smashMissile ? 'super-missile' : 'missile' });
  } else if (s.direction === 'up') {
    if (!s.reversed && command(f, 1) === 0 && Math.abs(input.x) > p.up.reverse && input.x * f.facing < 0) { f.facing = -f.facing; s.reversed = true; }
    if (!s.startedAir) {
      if (events.some(e => e.type === 'command' && e.index === 0 && e.value !== 0)) { f.grounded = false; f.floor = null; f.velocity.x = Math.fround(p.up.groundX * f.facing); }
      if (!f.grounded) { f.velocity.y = physics.motion(f.slot, 0, rootDelta(f).y, f.facing).y; f.velocity = physics.drift(f.slot, f.velocity, input.x, p.up.accel, p.up.maxX); }
      else f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 };
    } else {
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
      f.velocity = physics.drift(f.slot, f.velocity, input.x, p.up.accel, p.up.maxX);
    }
    if (!f.grounded) f.jumpsUsed = a.maxJumps;
    return out;
  } else {
    if (f.grounded && events.some(e => e.type === 'command' && e.index === 1 && e.value === 1)) { f.grounded = false; f.floor = null; f.velocity.y = p.down.groundY; f.animation = 'SpecialAirLw'; f.attackName = f.animation; }
    if (events.some(e => e.type === 'flag' && e.flag === 24)) out.shots.push({ player: f.slot, kind: 'bomb' });
    if (!f.grounded) {
      f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
      f.velocity = physics.drift(f.slot, f.velocity, input.x, a.airDriftStickMul * p.down.airAccel, a.airDriftMax * p.down.airSpeed); return out;
    }
  }
  if (f.grounded) f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 };
  else f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, s.direction === 'side' ? p.side.friction : a.airFriction);
  return out;
}
