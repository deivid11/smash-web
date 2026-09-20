import type { MatchFighter } from './match.ts';
import type { Projectile } from './projectiles.ts';
import type { NessArticles } from './ness-data.ts';
import type { GameContent } from './load.ts';

/** Snapshot-owned Ness item variables (itnesspkflash/itnesspkthunderball ItemVars). */
export interface NessProjectileRuntime {
  sourceOwner: number; serial: number;
  /** PK Flash charge counter (xDD8) and the explosion latch. */
  charge: number; exploding: boolean; detached: boolean;
  /** PK Thunder heading (angles[0]) and the recent head positions for the tail. */
  angle: number; trail: Array<[number, number]>;
}
export type NessProjectile = Projectile & { ness: NessProjectileRuntime };
const f32 = Math.fround;
const TAU = Math.PI * 2;
export function nessArticles(content: GameContent): NessArticles {
  const articles = content.roster.get('Ns')?.specials.articles.ness;
  if (!articles) throw new Error('Ness projectile content is missing.');
  return articles;
}
export function initializeNessProjectile(item: NessProjectile, f: MatchFighter, articles: NessArticles): void {
  item.ness = { sourceOwner: f.slot, serial: f.special?.serial ?? 0, charge: 0, exploding: false, detached: false, angle: 0, trail: [] };
  if (item.kind === 'pk-thunder') {
    item.ness.angle = f32((articles.ball.spawnAngle * Math.PI) / 180);
    item.vx = f32(Math.cos(item.ness.angle) * articles.ball.speed);
    item.vy = f32(Math.sin(item.ness.angle) * articles.ball.speed);
  }
  if (item.kind === 'pk-flash') {
    // it_802AAA80: launch straight up, tilted x10 degrees toward the facing.
    const angle = f32((0.017453292 * articles.flash.launchAngle * f.facing) + Math.PI / 2);
    item.vx = f32(-articles.flash.rise * Math.cos(angle));
    item.vy = f32(articles.flash.rise * Math.sin(angle));
  }
}
const holdingFlash = (source: MatchFighter | undefined, item: NessProjectile): boolean =>
  !!source && source.state === 'special' && source.special?.direction === 'neutral' && source.special.phase === 'loop' && source.special.serial === item.ness.serial;
const holdingThunder = (source: MatchFighter | undefined, item: NessProjectile): boolean =>
  !!source && source.state === 'special' && source.special?.direction === 'up' && source.special.phase === 'loop' && source.special.serial === item.ness.serial;
/** Turns the flying PK Flash into its stationary explosion; damage/radius follow the charge. */
export function explodeNessFlash(item: NessProjectile, articles: NessArticles): void {
  if (item.ness.exploding) return;
  const explosion = articles.explosion;
  item.ness.exploding = true;
  item.kind = 'pk-flash'; item.vx = 0; item.vy = 0;
  item.data = explosion;
  item.life = Math.ceil(articles.flash.explosionDelay);
  // itNesspkflashexplode: hit damage = charge·x10 + xC; the radius follows the graphic scale.
  const scale = f32(0.3 + item.ness.charge * ((1.7 - 0.3) / Math.max(1, articles.flash.chargeCap)));
  item.hit = { ...explosion.hit!, damage: Math.max(1, Math.trunc(item.ness.charge * explosion.damagePerCharge + explosion.baseDamage)), radius: f32(explosion.hit!.radius * scale) };
  item.victims.clear();
}
/** Original itnessln item callbacks in restricted 2D form. Returns false to delete the item. */
export function advanceNessProjectile(item: NessProjectile, fighters: readonly MatchFighter[], articles: NessArticles, content: GameContent): boolean {
  const source = fighters[item.ness.sourceOwner];
  if (item.kind === 'pk-fire') {
    // itnesspkfire has no Phys callback: straight flight, lifetime only.
    return item.life > 0;
  }
  if (item.kind === 'pk-fire-pillar') {
    item.vx = 0; item.vy = 0;
    // The native script opens with one 3% strike, idles `openFrames`, then loops a 2% hit every
    // `rehit` frames. Re-arming faster than that is what turned one bolt into a 50% trap.
    const pillar = articles.pillar;
    if (item.age >= pillar.openFrames && (item.age - pillar.openFrames) % pillar.rehit === 0) {
      item.victims.clear();
      item.hit = { ...item.hit, damage: pillar.rehitDamage };
    }
    return item.life > 0;
  }
  if (item.kind === 'pk-flash') {
    if (item.ness.exploding) return item.life > 0;
    const flash = articles.flash;
    item.ness.charge = Math.min(flash.chargeCap, item.ness.charge + 1);
    if (!item.ness.detached && holdingFlash(source, item)) {
      const stick = source!.previous.x;
      if (Math.abs(stick) > 0.2) {
        item.vx = f32(item.vx + stick * flash.control);
        if (Math.abs(item.vx) > flash.maxDrift) item.vx = f32(Math.sign(item.vx) * flash.maxDrift);
      }
    } else if (!item.ness.detached) {
      // B released (or the owner lost the special): detonate after the native delay.
      explodeNessFlash(item, articles);
      notifyBallGone(source, item);
      return true;
    }
    item.vy = f32(item.vy - flash.gravity);
    if (item.vy < -flash.maxFall) item.vy = -flash.maxFall;
    if (item.life <= 1) { explodeNessFlash(item, articles); notifyBallGone(source, item); return true; }
    return true;
  }
  // PK Thunder head: stick steering with the original 45° proportional turn law.
  const ball = articles.ball;
  if (holdingThunder(source, item)) {
    const stick = { x: source!.previous.x, y: source!.previous.y ?? (source!.previous.down ? -1 : 0) };
    if (Math.abs(stick.x) > ball.stickThreshold || Math.abs(stick.y) > ball.stickThreshold) {
      const desired = Math.atan2(stick.y, stick.x);
      let delta = desired - item.ness.angle;
      while (delta > Math.PI) delta -= TAU;
      while (delta < -Math.PI) delta += TAU;
      const turn = (ball.turnRadius * Math.PI) / 180;
      const angleAbs = Math.abs(delta);
      const step = angleAbs >= Math.PI / 4 ? turn : angleAbs / ((Math.PI / 4) / turn);
      item.ness.angle += Math.sign(delta) * Math.min(step, angleAbs);
      while (item.ness.angle < -TAU) item.ness.angle += TAU;
      while (item.ness.angle > TAU) item.ness.angle -= TAU;
      item.vx = f32(ball.speed * Math.cos(item.ness.angle));
      item.vy = f32(ball.speed * Math.sin(item.ness.angle));
    }
    // ftNs_SpecialHi_ItemPKThunder_CheckNessCollide: an axis-aligned 8.33 x 12.33 box around
    // the owner's centre + 5·scale, not a hitbox sweep. It starts disarmed because the ball
    // spawns inside that box, arms the frame it leaves, and fires on the next re-entry.
    const runtime = source!.special?.ness;
    if (runtime) {
      const cx = source!.x, cy = f32(source!.y + 5 * source!.content.profile.attributes.modelScale);
      const inside = Math.abs(item.x - cx) < 8.333333015441895 && Math.abs(item.y - cy) < 12.333333015441895;
      if (runtime.thunderColl === 1) { if (!inside) runtime.thunderColl = 0; }
      else if (runtime.thunderColl === 0 && inside) {
        runtime.thunderColl = 2;
        runtime.selfHit = { x: item.x, y: item.y };
        return false;
      }
    }
  } else if (source?.special?.ness && source.special.serial === item.ness.serial) {
    // The owner dropped out of the hold (hit, landed badly): the ball dies with it.
    return false;
  }
  item.ness.trail.unshift([item.x, item.y]);
  if (item.ness.trail.length > 16) item.ness.trail.pop();
  // Dies against original stage lines (walls/floors/ceilings) via the shared floor check below,
  // and reports its end to the owner's control loop.
  if (item.life <= 0) { notifyBallGone(source, item); return false; }
  const stage = content.stage;
  for (const floor of stage.floors) {
    if (item.x >= Math.min(floor.a[0], floor.b[0]) && item.x <= Math.max(floor.a[0], floor.b[0])) {
      const y = floor.a[1] + (floor.b[1] - floor.a[1]) * ((item.x - floor.a[0]) / Math.max(1e-6, floor.b[0] - floor.a[0]));
      if (Math.abs(item.y - y) < 1 && !floor.oneWay) { notifyBallGone(source, item); return false; }
    }
  }
  return true;
}
export function notifyBallGone(source: MatchFighter | undefined, item: NessProjectile): void {
  if (source?.special?.ness && source.special.serial === item.ness.serial) source.special.ness.ballGone = true;
}
