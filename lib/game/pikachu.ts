import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { SpecialDirection } from './special-data.ts';
import type { PikachuSpecialData } from './pikachu-data.ts';
import type { PichuSpecialData } from './pichu-data.ts';
import type { RaichuSpecialData } from './raichu-data.ts';
import type { SpecialRuntime, SpecialStep } from './specials.ts';
import { command } from './specials.ts';
import type { ActiveHit } from './moves.ts';

/** Serializable ftPk motion variables. No presentation state determines special outcomes. */
export interface PikachuRuntime {
  charge: number; launched: boolean; zipCount: number; zipTicks: number; zipX: number; zipY: number; zipChecked: boolean;
  thunderSpawned: boolean; thunderDone: boolean; thunderHit: boolean; thunderWait: number;
}
const f32 = Math.fround;
/** Raichu (PlRc) runs the same decomp ftPk callbacks for neutral/up/down; his side
 * special is his own compiled roll (lib/game/raichu.ts), never the branches here. */
const params = (f: MatchFighter): PikachuSpecialData | PichuSpecialData | RaichuSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Pk' && p.kind !== 'Pc' && p.kind !== 'Rc') throw new Error('Missing Pikachu-family parameters.'); return p;
};
const sideParams = (p: PikachuSpecialData | PichuSpecialData | RaichuSpecialData): PikachuSpecialData['side'] => {
  if (p.kind === 'Rc') throw new Error('Raichu side special is the roll.'); return p.side;
};
export function pikachuSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir';
  if (direction === 'neutral') return `${prefix}N`;
  if (direction === 'side') return `${prefix}S${phase === 'start' ? 'Start' : phase === 'loop' ? 'Hold' : phase === 'end' ? 'End' : 'Launch'}`;
  // Native first and second zip use the two Start entries at frame 13, frozen.
  if (direction === 'up') return `${prefix}Hi${phase === 'end' ? 'End' : phase === 'travel' && (f.special?.pikachu?.zipCount ?? 0) > 1 ? 'Travel' : 'Start'}`;
  return `${prefix}Lw${phase === 'start' ? 'Start' : phase === 'loop' ? 'Loop' : phase === 'hit' ? 'Hit' : 'End'}`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = pikachuSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginPikachuSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const s = f.special!, p = params(f);
  s.pikachu = { charge: 0, launched: false, zipCount: 0, zipTicks: 0, zipX: 0, zipY: 0, zipChecked: false, thunderSpawned: false, thunderDone: false, thunderHit: false, thunderWait: 0 };
  if (direction === 'side' && p.kind !== 'Rc') { f.velocity.x = f32(f.velocity.x / p.side.divisor); if (!f.grounded) f.velocity.y = 0; }
  if (direction === 'up') { f.velocity = { x: 0, y: 0 }; s.delay = p.up.delay; }
}
function launchZip(f: MatchFighter, input: PlayerInput, physics: MeleePhysics): void {
  const p = params(f).up, r = f.special!.pikachu!;
  let magnitude = Math.min(0.999, Math.hypot(input.x, input.y ?? 0)), x = input.x, y = input.y ?? 0;
  if (magnitude <= p.threshold) { magnitude = 0.999; x = 0; y = magnitude; }
  r.zipX = x; r.zipY = y; r.zipCount++; r.zipTicks = p.frames; r.zipChecked = false;
  if (Math.abs(x) > 0.001) f.facing = Math.sign(x);
  // On this prototype's horizontal solid floors, non-upward input keeps a grounded zip.
  if (!f.grounded || y > 0 || Math.abs(x) < 0.001) { f.grounded = false; f.floor = null; }
  const speed = f32((p.slope * magnitude + p.speed) * (r.zipCount > 1 ? p.secondDecay : 1));
  f.velocity = f.grounded ? { x: f32(speed * f.facing), y: 0 } : physics.motion(f.slot, speed, 0, 1, Math.atan2(y, x));
  f.jumpsUsed = f.content.profile.attributes.maxJumps;
  phase(f, 'travel'); f.animationFrame = 13; f.animationRate = 0;
}
/** ftPk native parameter/script-driven orchestration, not a whole-engine equivalence claim. */
export function stepPikachuSpecial(f: MatchFighter, input: PlayerInput, physics: MeleePhysics, finish: (helpless: boolean, lag: number, mobility: number) => void): SpecialStep {
  const s = f.special!, r = s.pikachu!, p = params(f), a = f.content.profile.attributes;
  const result: SpecialStep = { handled: true, shots: [], sounds: [] }; s.age++;
  const ended = () => f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const ordinary = (gravity = a.gravity, friction = a.airFriction) => {
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 } : physics.customAir(f.slot, f.velocity, gravity, a.terminal, friction);
  };
  const gather = () => { const events = (f.content.timelines.get(f.animation)?.events ?? []).filter(e => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame; return events; };
  if (s.direction === 'neutral') {
    if (ended()) { finish(p.neutral.landing > 0, p.neutral.landing, 1); return result; }
    if (!r.thunderSpawned && gather().some(e => e.type === 'command' && e.index === 0 && e.value === 1)) {
      r.thunderSpawned = true; result.shots.push({ player: f.slot, kind: p.kind === 'Rc' ? 'raichu-jolt' : 'tjolt' });
      if (p.kind !== 'Rc') result.sounds.push(f.content.profile.kind === 'Pc' ? 230067 : 240076);
    }
    ordinary();
  } else if (s.direction === 'side') {
    const side = sideParams(p);
    if (s.phase === 'start' && ended()) phase(f, 'loop');
    if (s.phase === 'loop') {
      r.charge = Math.min(side.maxCharge + 1, r.charge + 1);
      if (!input.special || r.charge > side.maxCharge) phase(f, 'travel');
      else if (ended()) phase(f, 'loop');
    }
    if (s.phase === 'travel') {
      if (!r.launched && command(f, 0) !== 0) {
        r.launched = true; f.grounded = false; f.floor = null;
        f.velocity = { x: f32((side.speed + side.speedPerFrame * r.charge) * f.facing), y: f32(side.lift * (0.5 + 0.5 * r.charge / side.maxCharge)) };
      }
      if (ended()) { phase(f, 'end'); f.velocity.x = f32(f.velocity.x / side.endDivisor); }
      else if (r.launched) {
        // ftPk_SpecialAirS1 runs the shared travel script (cmd0 at 24) while preserving launch hitboxes.
        const late = (f.content.timelines.get('SpecialSTravel')?.events ?? []).some(e => e.type === 'command' && e.index === 0 && e.value !== 0 && e.frame <= f.animationFrame);
        f.velocity = physics.customAir(f.slot, f.velocity, late ? side.endGravity : side.travelGravity, side.terminal, late ? side.endFriction : 0);
      } else ordinary();
    } else if (s.phase === 'end') {
      if (ended()) { finish(false, 0, 1); return result; }
      ordinary(side.endGravity, side.endFriction);
    } else if (s.phase === 'start') {
      f.velocity = physics.customAir(f.slot, f.velocity, !f.grounded && command(f, 0) ? side.gravity : 0, a.terminal, side.friction);
      if (f.grounded) f.velocity.y = 0;
    } else ordinary();
  } else if (s.direction === 'up') {
    if (s.phase === 'start') {
      if (ended()) launchZip(f, input, physics);
      else { ordinary(s.delay > 0 ? 0 : p.up.gravity); s.delay = Math.max(0, s.delay - 1); }
    } else if (s.phase === 'travel') {
      if (--r.zipTicks <= 0) {
        f.velocity = { x: f32(f.velocity.x * p.up.endMomentum), y: f32(f.velocity.y * p.up.endMomentum) }; phase(f, 'end');
      }
    } else {
      if (!r.zipChecked && command(f, 0) === 1) {
        r.zipChecked = true;
        const dot = r.zipX * input.x + r.zipY * (input.y ?? 0), magnitude = Math.hypot(r.zipX, r.zipY) * Math.hypot(input.x, input.y ?? 0);
        if (r.zipCount === 1 && Math.hypot(input.x, input.y ?? 0) >= p.up.threshold && magnitude > 0 && Math.acos(Math.max(-1, Math.min(1, dot / magnitude))) > p.up.angleDifference * Math.PI / 180) {
          launchZip(f, input, physics); return result;
        }
      }
      if (ended()) { finish(!f.grounded, p.up.landing, p.up.mobility); return result; }
      if (command(f, 0)) { ordinary(); if (!f.grounded) f.velocity.x = f32(Math.max(-a.airDriftMax * p.up.endDrift, Math.min(a.airDriftMax * p.up.endDrift, f.velocity.x))); }
      else if (!f.grounded) { f.velocity.y = f32(f.velocity.y * 8 / 9); f.velocity.x = physics.customAir(f.slot, { x: f.velocity.x, y: 0 }, 0, a.terminal, a.airFriction).x; }
    }
  } else {
    if (s.phase === 'start' && ended()) phase(f, 'loop');
    if (s.phase === 'loop') {
      // Bounded cleanup if the global article budget evicted the first segment.
      if (r.thunderSpawned && ++r.thunderWait > f.content.specials.articles.pikachu!.thunder.lifetime + p.down.count * p.down.delay) r.thunderDone = true;
      if (!r.thunderSpawned && gather().some(e => e.type === 'flag' && e.flag === 24)) {
        r.thunderSpawned = true; result.shots.push({ player: f.slot, kind: 'thunder' });
      }
      if (r.thunderHit) { phase(f, 'hit'); if (!f.grounded) f.velocity.y = p.down.boost; }
      else if (r.thunderDone) phase(f, 'end');
      // Native LwLoop waits for its linked article; hold final pose without replaying the spawn script.
      else if (ended()) { f.animationFrame = f.content.clips.get(f.animation)!.endFrame; f.animationRate = 0; }
    } else if (s.phase === 'hit' && ended()) phase(f, 'end');
    else if (s.phase === 'end' && ended()) { finish(false, 0, 1); return result; }
    ordinary(s.phase === 'hit' ? p.down.gravity : a.gravity);
  }
  return result;
}
export function landPikachuSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'up' && s.phase !== 'start') {
    finish(); f.animationRate = 1; f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.ceil(p.up.landing); return true;
  }
  if (s.direction === 'side' && s.phase === 'travel' && s.pikachu!.launched) { phase(f, 'end'); f.velocity.x = f32(f.velocity.x / sideParams(p).endDivisor); }
  else { f.animation = pikachuSpecialName(f, s.direction, s.phase); f.attackName = f.animation; }
  return true;
}
/** ftPk_SpecialS0_Anim updates only the Skull Bash capsule's damage. */
export function pikachuHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  const s = f.special;
  if ((f.content.profile.kind !== 'Pk' && f.content.profile.kind !== 'Pc') || !s?.pikachu || s.direction !== 'side' || s.phase !== 'travel') return hits;
  const p = sideParams(params(f)); return hits.map(hit => hit.id === 0 ? { ...hit, damage: f32(p.damage + s.pikachu!.charge * p.damagePerFrame) } : hit);
}
/** Native deal_dmg_cb ends Skull Bash on contact instead of passing through an opponent. */
export function pikachuHitLanded(f: MatchFighter): void {
  if ((f.content.profile.kind !== 'Pk' && f.content.profile.kind !== 'Pc') || f.special?.direction !== 'side' || f.special.phase !== 'travel') return;
  f.velocity.x = 0; f.velocity.y = Math.min(0, f.velocity.y); phase(f, 'end');
}
