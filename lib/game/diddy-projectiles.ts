import type { Projectile } from './projectiles.ts';
import type { GameContent } from './load.ts';
import type { MatchEvent, MatchFighter, PoseProvider } from './match.ts';
import type { ShotIntent } from './specials.ts';
import { DIDDY_BANANA, DIDDY_FX, type DiddySpecialData } from './diddy-data.ts';
import { floorY } from './data.ts';
import { traceStage } from './link-hookshot.ts';
import type { V3 } from '../hsd/model.ts';

/** PlDd itFunction:2, the banana. `state` is the item state: 0 SpawnThrown (tossed by Diddy),
 * 1 Wait (grounded, trips rivals), 2 Fall (walked off), 3 Held (in Diddy's hand before the toss),
 * 5 FlyUp (popped by a trip; gone when it lands). `life` is xD44 (420 at OnSpawn, counted by every
 * state's Anim but Held's); `tripped` is var3. The Thrown state (a rival picking it up) is not
 * ported: nobody can pick the banana up. */
export interface DiddyBananaRuntime { state: 0 | 1 | 2 | 3 | 5; life: number; tripped: boolean }
export type DiddyBananaProjectile = Projectile & { banana: DiddyBananaRuntime };

const f32 = Math.fround;
const lerp = (range: readonly [number, number], t: number) => f32(f32(f32(range[1] - range[0]) * t) + range[0]);
const params = (f: MatchFighter): DiddySpecialData => {
  const p = f.content.specials.parameters; if (p.kind !== 'Dd') throw new Error('Only Diddy owns Diddy articles.'); return p;
};
const articles = (f: MatchFighter) => {
  const a = f.content.specials.articles.diddy; if (!a) throw new Error('Diddy articles are missing.'); return a;
};
const holdPoint = (f: MatchFighter, poses: PoseProvider): V3 =>
  poses.point(f, f.content.profile.itemHoldBone ?? f.content.profile.boneMap[49]!, [0, 0, 0]);

/** Gun_Shoot: item 1 from the held gun's joint 7, facing Diddy's way, at speed x4..x8 by
 * `charge` (charge / ft_var1) and angle xC..x10 by `rawCharge` (capped charge / (ft_var1 · x0));
 * it_80272460 then rewrites its hit: damage x14..x18, base x1C..x20 and growth x24..x28 by `charge`. */
export function spawnDiddyPeanut(id: number, f: MatchFighter, poses: PoseProvider, intent: ShotIntent | undefined, lifetime: number): Projectile {
  const n = params(f).neutral, a = articles(f), data = a.peanut;
  if (!data.hit) throw new Error('Diddy peanut article has no hitbox.');
  const charge = intent?.charge ?? 0, capped = intent?.rawCharge ?? 0;
  const point = poses.point(f, f.content.profile.partJoints[n.gunPart] ?? f.content.profile.boneMap[49]!, a.muzzle);
  const speed = lerp(n.speed, charge), angle = lerp(n.angle, capped);
  const hit = { ...data.hit, damage: Math.trunc(lerp(n.damage, charge)), base: Math.trunc(lerp(n.base, charge)), growth: Math.trunc(lerp(n.growth, charge)) };
  return { id, kind: 'diddy-peanut', owner: f.slot, x: point[0], y: point[1], vx: f32(f32(Math.cos(angle) * speed) * f.facing), vy: f32(Math.sin(angle) * speed),
    age: 0, life: lifetime, data, hit, reflectionCooldown: 0, victims: new Set(), speed: 0 };
}
/** Item_CollAir_NoCB on anything: the peanut is gone with its 0x1772 puff. */
export function peanutTouchesStage(item: Projectile, from: V3, content: GameContent, events: MatchEvent[]): boolean {
  const contact = traceStage(content.stage, from, [item.x, item.y, 0]);
  if (!contact) return false;
  events.push({ type: 'gfx', player: item.owner, x: contact.point[0], y: contact.point[1], effect: DIDDY_FX.peanut, facing: 1 });
  return true;
}

/** Banana_Spawn: item 2 straight into Diddy's hand (Fighter_GiveItem), 420 frames of life. */
export function spawnDiddyBanana(id: number, f: MatchFighter, poses: PoseProvider): DiddyBananaProjectile {
  const data = articles(f).banana, point = holdPoint(f, poses);
  if (!data.hit) throw new Error('Diddy banana article has no hitbox.');
  return { id, kind: 'diddy-banana', owner: f.slot, x: point[0], y: point[1], vx: 0, vy: 0, age: 0, life: Number.MAX_SAFE_INTEGER, data, hit: { ...data.hit },
    reflectionCooldown: 0, victims: new Set(), speed: 0, banana: { state: 3, life: DIDDY_BANANA.life, tripped: false } };
}
/** Banana_Release: Item_8026AC74 from the hand at (cos x60 · x5C · facing, sin x60 · x5C), then
 * SpawnThrown (trips armed). */
export function releaseDiddyBanana(item: DiddyBananaProjectile, f: MatchFighter, poses: PoseProvider): void {
  const d = params(f).down, point = holdPoint(f, poses);
  item.x = point[0]; item.y = point[1];
  item.vx = f32(f32(f32(Math.cos(d.tossAngle) * d.tossSpeed)) * f.facing); item.vy = f32(d.tossSpeed * Math.sin(d.tossAngle));
  item.banana.state = 0; item.victims.clear();
}
/** Only SpawnThrown and Fall run the article's state-0 script (its 3% box). */
export const bananaHits = (item: DiddyBananaProjectile) => item.banana.state === 0 || item.banana.state === 2;
/** OnGiveDamage → itColl_BounceOffVictim: x *= ItCo x58, y = y · x5C + x60. */
export function bounceDiddyBanana(item: DiddyBananaProjectile, content: GameContent): void {
  const c = content.items?.common;
  if (!c) return;
  item.vx = f32(item.vx * c.shieldBounceX); item.vy = f32(f32(item.vy * c.shieldBounceY) + c.shieldBounceLift);
}

/** One item frame. Returns false when the banana is gone (OnDestroy clears Diddy's ft_var2, which
 * `bananaOut` reads from the live items). `trip` is the rival Trip_Check caught this frame. */
export function advanceDiddyBanana(item: DiddyBananaProjectile, fighters: readonly MatchFighter[], content: GameContent, poses: PoseProvider, allies: (a: number, b: number) => boolean): { alive: boolean; trip?: MatchFighter } {
  const b = item.banana, owner = fighters[item.owner];
  if (b.state === 3) {
    // Held until Banana_Release; Banana_OnHit (take-damage / death callbacks) destroys it if the
    // special ends first.
    if (!owner || owner.special?.diddy?.banana !== true || (owner.special.diddy.motion !== 'SpecialLw' && owner.special.diddy.motion !== 'SpecialAirLw')) return { alive: false };
    const point = holdPoint(owner, poses); item.x = point[0]; item.y = point[1];
    return { alive: true };
  }
  // Item_DecLifeTimer in every other state's Anim.
  if (--b.life <= 0) return { alive: false };
  if (b.state === 1) {
    // Wait_Coll: a floor that ends under it drops it (Fall_Enter).
    const floor = content.stage.floors.find((candidate) => item.x >= Math.min(candidate.a[0], candidate.b[0]) && item.x <= Math.max(candidate.a[0], candidate.b[0]) && Math.abs(floorY(candidate, item.x) - item.y) < 0.5);
    if (!floor) { b.state = 2; return { alive: true }; }
    item.y = floorY(floor, item.x);
    // Trip_Check (proc 0xD, only in Wait): the first grounded, vulnerable, ungrabbed rival whose
    // jostle point stands within 5.5 + jostle_range / 2 across and 1.0 up/down, and who owns a
    // MissFoot animation. The banana pops away (facing · 0.5, 1.7) into FlyUp.
    for (const v of fighters) {
      if (v.slot === item.owner || allies(v.slot, item.owner) || v.invulnerable > 0 || !v.grounded || v.combat.partner !== null) continue;
      if (['ko', 'respawn', 'captured', 'holding', 'throw', 'bury', 'frozen', 'ledge', 'ledge-action'].includes(v.state) || !v.content.clips.has('MissFoot')) continue;
      const profile = v.content.profile, reach = f32(DIDDY_BANANA.reachX + profile.nudgeRadius * 0.5);
      if (Math.abs(f32(v.x + profile.nudgeOffset) - item.x) >= reach || Math.abs(v.y - item.y) >= DIDDY_BANANA.reachY) continue;
      item.vx = f32(v.facing * DIDDY_BANANA.popX); item.vy = DIDDY_BANANA.popY;
      b.state = 5; b.tripped = true;
      return { alive: true, trip: v };
    }
    return { alive: true };
  }
  // SpawnThrown / Fall / FlyUp Phys: Item_ProjectileVelocityCalculate(x10, x14).
  item.vy = Math.max(-item.data.terminal, f32(item.vy - item.data.gravity));
  const start: V3 = [item.x, item.y, 0], end: V3 = [f32(item.x + item.vx), f32(item.y + item.vy), 0];
  const contact = traceStage(content.stage, start, end);
  if (contact?.surface.kind === 'floor') {
    // Item_CollAir_Land: a tripped banana is done (Thrown_OnLand / SpawnThrown_OnLand var3);
    // otherwise it settles upright (Wait).
    if (b.tripped) return { alive: false };
    item.x = contact.point[0]; item.y = contact.point[1]; item.vx = 0; item.vy = 0; b.state = 1;
    return { alive: true };
  }
  if (contact) {
    // Walls and ceilings stop the motion into them.
    item.x = contact.point[0]; item.y = contact.point[1];
    if (contact.surface.kind === 'wall') item.vx = 0; else item.vy = Math.min(0, item.vy);
    return { alive: true };
  }
  item.x = end[0]; item.y = end[1];
  const blast = content.stage.blast;
  if (item.y < blast.bottom || item.y > blast.top || item.x < blast.left || item.x > blast.right) return { alive: false };
  return { alive: true };
}
