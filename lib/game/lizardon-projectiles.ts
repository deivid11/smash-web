import type { MatchFighter, PoseProvider } from './match.ts';
import type { Projectile } from './projectiles.ts';
import type { LizardonArticles, LizardonSpecialData } from './lizardon-data.ts';
import type { ShotIntent } from './specials.ts';
import { LIZARDON_ROCK_PART } from './lizardon.ts';

/** Charizard's articles (PlLz itFunction items 0-2). `group` is the Item_8026AE60 id the flames
 * of one stream share (xAC4_ignoreItemID: a victim burned by one is burned by all of them);
 * `hitFrames` the frames the hitbox stays up; `variant` the flame's efSync variant (0x1775 + n)
 * or the model child the rock pieces show. */
export interface LizardonProjectileRuntime { group: number; hitFrames: number; variant: number }

const f32 = Math.fround;
function articles(f: MatchFighter): { p: LizardonSpecialData; a: LizardonArticles } {
  const p = f.content.specials.parameters, a = f.content.specials.articles.lizardon;
  if (p.kind !== 'Lz' || !a) throw new Error('Only Charizard spawns Charizard articles.');
  return { p, a };
}
/** Item_ClampAngleReverse (ClampRotation). */
const clampAngle = (value: number) => { let v = value; while (v < -Math.PI) v += Math.PI * 2; while (v > Math.PI) v -= Math.PI * 2; return v; };

/** SpecialN_SpawnFire → SpawnItem_Fire: from the x3C joint plus x34/x38 (model-scaled), the angle
 * rolled in x10..x14 from straight up and mirrored by facing, the speed rolled in x8..xC and scaled
 * by the speed pool, the hitbox scaled by the size pool. Flame_Init/Phys keep that heading. */
export function spawnLizardonFlame(id: number, f: MatchFighter, poses: PoseProvider, random: () => number, intent: ShotIntent): Projectile {
  const { p, a } = articles(f), flame = a.flame, n = p.neutral, scale = f.content.profile.attributes.modelScale;
  const joint = f.content.profile.partJoints[n.bone]!, point = poses.point(f, joint, [0, 0, 0]);
  const x = f32(point[0] + n.offset[0] * scale * f.facing), y = f32(point[1] + n.offset[1] * scale);
  let angle = f32(flame.angleRange[0] + (flame.angleRange[1] - flame.angleRange[0]) * random());
  if (f.facing !== 1) angle = -angle;
  angle = f32(clampAngle(angle));
  const speedRatio = intent.charge ?? 1, sizeRatio = intent.rawCharge ?? 1;
  const speed = f32(f32(flame.speedRange[0] + (flame.speedRange[1] - flame.speedRange[0]) * random()) * speedRatio);
  return {
    id, kind: 'lizardon-flame', owner: f.slot, x, y, vx: f32(Math.sin(angle) * speed), vy: f32(Math.cos(angle) * speed), age: 0, life: Math.ceil(flame.lifetime),
    data: flame, hit: { ...flame.hit!, radius: f32(flame.hit!.radius * sizeRatio) }, reflectionCooldown: 0, victims: new Set(), speed: 0,
    flame: { angle, speed, dirX: f32(Math.sin(angle)), dirY: f32(Math.cos(angle)) },
    lizardon: { group: intent.variant ?? 0, hitFrames: flame.hitFrames, variant: intent.effect ?? 0 },
  };
}
/** Rock and burst both pick their model child from the floor material table (x0 count, x4 list);
 * the port has no stage material data, so every floor reads as material 0. */
const rockVariant = (variants: readonly number[]) => variants[0] ?? 0;

/** SpecialLw_Enter → SpawnItem_Rock: held at part 0x34 (Item_8026AB54), 1200-frame life, no hit. */
export function spawnLizardonRock(id: number, f: MatchFighter, poses: PoseProvider): Projectile {
  const { a } = articles(f), rock = a.rock, point = poses.point(f, f.content.profile.boneMap[LIZARDON_ROCK_PART]!, [0, 0, 0]);
  return {
    id, kind: 'lizardon-rock', owner: f.slot, x: point[0], y: point[1], vx: 0, vy: 0, age: 0, life: Math.ceil(rock.lifetime),
    data: rock, hit: { id: 0, group: 0, bone: 0, damage: 0, radius: 0, offset: [0, 0, 0], angle: 0, growth: 0, weightSet: 0, base: 0, grounded: false, airborne: false },
    reflectionCooldown: 0, victims: new Set(), speed: 0, lizardon: { group: 0, hitFrames: 0, variant: rockVariant(rock.variants) },
  };
}
/** SpecialLw_IASACB → SpawnItem_RockBurst: a fragment from part 0x34, launched x10..x14 degrees
 * from straight up (mirrored by facing) at xC, living x8 frames with no gravity or stage collision. */
export function spawnLizardonBurst(id: number, f: MatchFighter, poses: PoseProvider, random: () => number): Projectile {
  const { a } = articles(f), burst = a.burst, point = poses.point(f, f.content.profile.boneMap[LIZARDON_ROCK_PART]!, [0, 0, 0]);
  const angle = f32((burst.angleRange[0] + (burst.angleRange[1] - burst.angleRange[0]) * random()) * (Math.PI / 180));
  return {
    id, kind: 'lizardon-burst', owner: f.slot, x: point[0], y: point[1], vx: f32(Math.sin(angle) * burst.speed * f.facing), vy: f32(Math.cos(angle) * burst.speed),
    age: 0, life: Math.ceil(burst.lifetime), data: burst, hit: { ...burst.hit! }, reflectionCooldown: 0, victims: new Set(), speed: 0,
    lizardon: { group: 0, hitFrames: Math.ceil(burst.lifetime), variant: rockVariant(burst.variants) },
  };
}
/** The rock's state-0 anim callback: gone once its owner leaves SpecialLw/SpecialAirLw (or is hit
 * or KO'd, SpecialLw_DestroyRock); otherwise it rides part 0x34. Returns false when destroyed. */
export function advanceLizardonRock(item: Projectile, fighters: readonly MatchFighter[], poses: PoseProvider): boolean {
  const owner = fighters[item.owner];
  if (!owner || owner.state !== 'special' || owner.special?.lizardon?.state !== 'Lw') return false;
  const point = poses.point(owner, owner.content.profile.boneMap[LIZARDON_ROCK_PART]!, [0, 0, 0]);
  item.x = point[0]; item.y = point[1];
  return true;
}
