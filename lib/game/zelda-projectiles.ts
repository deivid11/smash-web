import { floorY } from './data.ts';
import type { GameContent } from './load.ts';
import type { MatchFighter, MatchEvent, PoseProvider } from './match.ts';
import type { Projectile } from './projectiles.ts';
import { segmentDistanceSquared } from './collision.ts';
import type { V3 } from '../hsd/model.ts';

export interface ZeldaProjectileRuntime {
  sourceOwner: number; serial: number; frames: number; exploded: boolean;
  angle: number; speed: number; spawnFacing: number;
}
/** Owner still guiding: in side-special loop with the same serial (mirrors the
 * PK Flash hold check; 1-frame input lag via previous is deterministic). */
const holdingDin = (source: MatchFighter | undefined, item: Projectile): boolean =>
  !!source && source.state === 'special' && source.special?.direction === 'side' &&
  source.special.phase === 'loop' && source.special.serial === item.zelda?.serial;
const f32 = Math.fround;

/** Din's Fire travel + detonation. Returns false only when the generic
 * bounds/life handling should remove a spent blast (detonation converts). */
export function stepZeldaDin(item: Projectile, content: GameContent, fighters: readonly MatchFighter[], poses: PoseProvider, events: MatchEvent[]): boolean {
  const r = item.zelda!;
  const owner = content.roster.get('Zd')!.specials;
  if (owner.parameters.kind !== 'Zd') throw new Error('Missing Zelda parameters.');
  const p = owner.parameters;
  const source = fighters[r.sourceOwner];
  if (!r.exploded) {
    r.frames = Math.min(p.dins.maxGuide, r.frames + 1);
    // Native steers only while unreflected (xDDC) with the owner's stick;
    // reflection flips velocity, detected here via the facing mismatch.
    if (holdingDin(source, item) && item.reflectionCooldown <= 0 && Math.sign(item.vx) === r.spawnFacing) {
      const sx = source!.previous.x;
      if (Math.abs(sx) > p.dins.steerDead) {
        r.angle = Math.max(-p.dins.steerMax, Math.min(p.dins.steerMax, r.angle + r.spawnFacing * (p.dins.steerGain * sx)));
      }
      r.speed = Math.min(p.dins.maxSpeed, r.speed + p.dins.accel);
      item.vx = f32(r.speed * Math.cos(r.angle));
      item.vy = f32(r.speed * Math.sin(r.angle));
    }
    // Stage contact detonates (native collision inline).
    const crossed = content.stage.floors.some((floor) => {
      const min = Math.min(floor.a[0], floor.b[0]), max = Math.max(floor.a[0], floor.b[0]);
      if (item.x < min || item.x > max) return false;
      return item.y <= floorY(floor, item.x) + 0.5 && item.vy <= 0.01;
    });
    // Fighter contact detonates: manual sweep, the travel capsule is inert.
    let touched = crossed;
    if (!touched) {
      const prev: V3 = [f32(item.x - item.vx), f32(item.y - item.vy), 0];
      const end: V3 = [item.x, item.y, 0];
      for (const victim of fighters) {
        if (victim.slot === item.owner || victim.invulnerable > 0 || victim.state === 'ko' || victim.state === 'respawn') continue;
        for (const hurt of victim.content.profile.hurts) {
          const a = poses.point(victim, hurt.bone, hurt.a), b = poses.point(victim, hurt.bone, hurt.b);
          if (segmentDistanceSquared(prev, end, a, b) <= (2 + hurt.radius) ** 2) { touched = true; break; }
        }
        if (touched) break;
      }
    }
    if (touched || item.life <= 1) {
      r.exploded = true;
      item.vx = 0; item.vy = 0;
      item.life = p.dins.blastLife;
      item.victims.clear();
      // Damage law is exact (guide frames * slope + base); blast radius is
      // priced by its own damage (no radius constant exists in the articles —
      // verified by exhaustive state scans — so the boom grows with its charge
      // instead of an invented size). Knockback SHAPE (angle/growth/element/
      // sounds) is borrowed from Mario's fireball hit (same fire family).
      const marioFire = content.roster.get('Mr')?.specials.articles.projectile?.hit;
      if (!marioFire) throw new Error('Din blast needs Mario fireball knockback shape.');
      const damage = Math.trunc(Math.min(r.frames, p.dins.maxGuide) * p.dins.blastSlope + p.dins.blastDamageBase);
      item.hit = {
        ...marioFire,
        damage,
        radius: Math.fround(damage),
        offset: [0, 0, 0],
      };
      events.push({ type: 'sound', player: item.owner, x: item.x, y: item.y, sound: owner.articles.zelda!.blast.sound });
      return true;
    }
    return true;
  }
  return true;
}
