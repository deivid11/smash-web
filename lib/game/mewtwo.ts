import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { MewtwoSpecialData, ShadowMewtwoSpecialData } from './mewtwo-data.ts';
import type { SpecialDirection } from './special-data.ts';
import { command, type SpecialRuntime, type SpecialStep } from './specials.ts';

/** Serializable ftMt motion variables; the stored Shadow Ball charge lives on the fighter. */
export interface MewtwoRuntime { iteration: number; full: boolean; warp: number; fired: boolean }
const f32 = Math.fround;
const params = (f: MatchFighter): MewtwoSpecialData | ShadowMewtwoSpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Mt' && p.kind !== 'Sm') throw new Error('Missing Mewtwo parameters.'); return p;
};
/** Shadow Mewtwo voice lines (direct smewtwo.ssm samples; the ACE SEM carries no scripts). */
function smVoice(direction: SpecialRuntime['direction']): number {
  return direction === 'neutral' ? 2029 : direction === 'side' ? 2033 : direction === 'up' ? 2034 : 2042;
}
export function mewtwoSpecialName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const prefix = f.grounded ? 'Special' : 'SpecialAir';
  if (direction === 'neutral') return phase === 'start' ? `${prefix}NStart` : phase === 'loop' ? `${prefix}NLoop${f.special?.mewtwo?.full ? 'Full' : ''}` : phase === 'travel' ? `${prefix}NCancel` : `${prefix}NEnd`;
  if (direction === 'side') return `${prefix}S`;
  // Aerial Teleport zoom shares the grounded SpecialHiLost figatree (ftMt_SM_SpecialHiLost).
  if (direction === 'up') return phase === 'start' ? `${prefix}HiStart` : phase === 'travel' ? 'SpecialHiLost' : `${prefix}Hi`;
  return `${prefix}Lw`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s = f.special!; s.phase = next; s.lastFrame = -1;
  f.animation = mewtwoSpecialName(f, s.direction, next); f.animationFrame = 0; f.animationRate = 1; f.stateFrame = 0; f.animationEpoch++;
  f.attackName = f.animation; f.attackSerial++; f.victims.clear();
}
export function beginMewtwoSpecial(f: MatchFighter, direction: SpecialDirection): void {
  const p = params(f), s = f.special!;
  s.mewtwo = { iteration: 0, full: f.mewtwoCharge >= p.neutral.chargeCycles, warp: 0, fired: false };
  if (direction === 'neutral') {
    s.releaseLag = f.mewtwoCharge === 0 ? p.neutral.releaseLag : 0;
    if (f.grounded) f.velocity.y = 0; else f.velocity.y = f32(f.velocity.y * 0.5);
  }
  if (direction === 'side' && !f.grounded && !f.mewtwoBoostUsed) { f.velocity.y = p.side.airBoost; f.mewtwoBoostUsed = true; }
  if (direction === 'up') {
    if (f.grounded) f.velocity = { x: 0, y: 0 };
    else { f.velocity.x = f32(f.velocity.x / p.up.velDivX); f.velocity.y = f32(f.velocity.y / p.up.velDivY); }
  }
  if (direction === 'down' && !f.grounded) f.velocity.y = 0;
}
/** Original ftMt parameter/script orchestration over the prototype floor solver; Confusion's
 * command grab/flip-throw and Disable's gaze stun are not ported. */
export function stepMewtwoSpecial(f: MatchFighter, input: PlayerInput, pressed: boolean, physics: MeleePhysics, finish: (helpless?: boolean, lag?: number, mobility?: number) => void): SpecialStep {
  const p = params(f), s = f.special!, r = s.mewtwo!, a = f.content.profile.attributes;
  const out: SpecialStep = { handled: true, shots: [], sounds: s.age === 0 && p.kind === 'Sm' ? [smVoice(s.direction)] : [] }; s.age++;
  const end = f.animationFrame >= Math.max(1, f.content.clips.get(f.animation)!.endFrame);
  const events = (f.content.timelines.get(f.animation)?.events ?? []).filter(e => e.frame > s.lastFrame && e.frame <= f.animationFrame); s.lastFrame = f.animationFrame;
  const ordinary = (gravity = a.gravity, terminal = a.terminal, friction = a.airFriction) => {
    f.velocity = f.grounded ? { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 } : physics.customAir(f.slot, f.velocity, gravity, terminal, friction);
  };
  if (s.direction === 'neutral') {
    if (s.phase === 'start' && end) phase(f, r.full ? 'end' : 'loop');
    else if (s.phase === 'loop') {
      s.releaseLag = Math.max(0, s.releaseLag - 1);
      if (!r.full && s.releaseLag === 0 && ++r.iteration > p.neutral.chargeIterations) {
        r.iteration = 0;
        const quarter = Math.floor(4 * f.mewtwoCharge / p.neutral.chargeCycles);
        f.mewtwoCharge = Math.min(p.neutral.chargeCycles, f.mewtwoCharge + 1);
        if (p.kind === 'Mt' && Math.floor(4 * f.mewtwoCharge / p.neutral.chargeCycles) > quarter) out.sounds.push([200121, 200124, 200127, 200130][Math.min(3, quarter)]!);
        if (f.mewtwoCharge >= p.neutral.chargeCycles) {
          // Native LoopFull transition keeps the shared Loop figatree frame.
          r.full = true; f.animation = mewtwoSpecialName(f, 'neutral', 'loop'); f.attackName = f.animation;
        }
      }
      // ftMt_SpecialNLoop_IASA: A or B fires, L/R stores. previous is already this frame's
      // input here, so the attack release is level-triggered rather than edge-triggered.
      if ((pressed || input.attack) && s.releaseLag === 0) phase(f, 'end');
      else if (input.shield) phase(f, 'travel');
      else if (end) phase(f, 'loop');
    } else if (s.phase === 'travel' && end) { finish(); return out; }
    else if (s.phase === 'end') {
      // Shadow Mewtwo's NEnd carries no command-1 event, so it fires once on
      // reaching End (tap fires the level-0 ball).
      if (events.some(e => e.type === 'command' && e.index === 1 && e.value === 1) || (p.kind === 'Sm' && !r.fired)) {
        r.fired = true;
        out.shots.push({ player: f.slot, kind: 'shadow-ball', charge: f.mewtwoCharge });
        out.sounds.push(p.kind === 'Sm' ? smVoice('neutral') : f.mewtwoCharge >= p.neutral.chargeCycles ? 200118 : 200115);
        if (f.grounded) f.velocity.x = f32(f.facing * p.neutral.groundRecoilX * f.mewtwoCharge);
        else f.velocity.x = f32(f.facing * p.neutral.airRecoilX * f.mewtwoCharge);
        f.mewtwoCharge = 0;
      }
      if (end) { finish(!f.grounded && p.neutral.landing > 0, p.neutral.landing, 1); return out; }
    }
    ordinary();
  } else if (s.direction === 'side') {
    // The reflect window is script-owned (cmd var 1); specials.reflector() reads it live.
    if (end) { finish(); return out; }
    ordinary();
  } else if (s.direction === 'up') {
    if (s.phase === 'start') {
      if (end) {
        const x = input.x, y = input.y || (input.down ? -1 : 0);
        let magnitude = Math.min(1, Math.hypot(x, y)), angle = Math.PI / 2;
        if (magnitude >= p.up.stickMin) {
          if (Math.abs(x) > 0.001) f.facing = x > 0 ? 1 : -1;
          angle = Math.atan2(y, x * f.facing);
        } else magnitude = 1;
        const speed = f32(p.up.momentum * magnitude + p.up.momentumAdd);
        f.velocity = { x: f32(Math.cos(angle) * speed * f.facing), y: f32(Math.sin(angle) * speed) };
        r.warp = p.up.duration; f.grounded = false; f.floor = null; f.jumpsUsed = a.maxJumps;
        // ftColl_8007B62C(gobj, 2): the zoom is intangible and invisible for its whole duration.
        f.invulnerable = Math.max(f.invulnerable, p.up.duration + 1);
        phase(f, 'travel');
        f.animationFrame = Math.min(35, f.content.clips.get(f.animation)!.endFrame); f.animationRate = 0;
      } else if (f.grounded) f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 };
      else f.velocity = physics.customAir(f.slot, f.velocity, p.up.gravity, p.up.terminal, 0);
    } else if (s.phase === 'travel') {
      if (--r.warp <= 0) {
        f.velocity = { x: f32(f.velocity.x * p.up.endMul), y: f32(f.velocity.y * p.up.endMul) };
        phase(f, 'end'); f.animationRate = 1;
      }
      // Warp velocity is constant; no gravity or drift during the zoom.
    } else {
      if (end) { finish(true, p.up.landing, p.up.mobility); return out; }
      if (f.grounded) f.velocity = { x: physics.ground(f.slot, f.velocity.x, 0), y: 0 };
      else if (command(f, 0) !== 0) {
        f.velocity = physics.customAir(f.slot, f.velocity, a.gravity, a.terminal, 0);
        const cap = f32(p.up.drift * a.airDriftMax);
        f.velocity.x = Math.max(-cap, Math.min(cap, f.velocity.x));
      } else f.velocity = { x: physics.customAir(f.slot, { x: f.velocity.x, y: 0 }, 0, a.terminal, a.airFriction).x, y: f32(f.velocity.y * 0.9) };
    }
  } else {
    // Shadow Mewtwo's Disable article ships hitless (gaze stun pending), so only
    // fighters with a real Disable hitbox spawn it; the Lw melee hits still land.
    if (events.some(e => e.type === 'command' && e.index === 0 && e.value === 1) && f.content.specials.articles.mewtwo?.disable?.hit) out.shots.push({ player: f.slot, kind: 'disable' });
    if (end) { finish(); return out; }
    ordinary(p.down.gravity, p.down.terminal);
  }
  return out;
}
export function landMewtwoSpecial(f: MatchFighter, finish: () => void): boolean {
  const s = f.special!, p = params(f);
  if (s.direction === 'up' && s.phase !== 'start') {
    finish(); f.animationRate = 1; f.state = 'landing'; f.animation = 'Landing'; f.landingFrames = Math.ceil(p.up.landing); return true;
  }
  f.animation = mewtwoSpecialName(f, s.direction, s.phase); f.attackName = f.animation; return true;
}
