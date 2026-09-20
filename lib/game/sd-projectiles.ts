import type { Projectile } from './projectiles.ts';
import type { GameContent } from './load.ts';
import type { MatchEvent, MatchFighter, PoseProvider } from './match.ts';
import { SD_CODE, type SkullKidBombData } from './sd-data.ts';
import { command } from './specials.ts';
import { traceStage } from './link-hookshot.ts';
import type { V3 } from '../hsd/model.ts';

/** itFunction:0 of PlSd (Skull Kid's bomb). `state` is the item state (0 growing in the hand,
 * 1 held, 2 dropped, 3 thrown, 4 stuck, 5 armed, 6 exploding); `timer` is the item's life timer
 * (xD44) its callbacks count by hand; `blink` the state-5 effect counter; `scale` the joint scale
 * the grow-in writes; `hidden` the teleports' 1e-5 hide of the held item. */
export interface SkullBombRuntime { state: number; timer: number; blink: number; scale: number; hidden: boolean }
export type SkullBombProjectile = Projectile & { skull: SkullBombRuntime };

const f32 = Math.fround;
const bombData = (f: MatchFighter): SkullKidBombData => {
  const data = f.content.specials.articles.projectile as SkullKidBombData | undefined;
  if (!data || f.content.profile.kind !== 'Sd') throw new Error('Only Skull Kid pulls his bomb.');
  return data;
};
const holdPoint = (f: MatchFighter, poses: PoseProvider): V3 =>
  poses.point(f, f.content.profile.itemHoldBone ?? f.content.profile.boneMap[SD_CODE.neutral.spawnPart]!, [0, 0, 0]);

/** fn_03e88: created at FtPart 23 (x2FD4 scale, life x2FD8), handed to Skull Kid (Fighter_GiveItem)
 * in state 0; ft_var52 tracks it. The ammo was spent by the caller. */
export function spawnSkullBomb(id: number, f: MatchFighter, poses: PoseProvider): SkullBombProjectile {
  const data = bombData(f), joint = f.content.profile.boneMap[SD_CODE.neutral.spawnPart];
  const point = joint !== undefined && joint !== 255 ? poses.point(f, joint, [0, 0, 0]) : [f.x, f.y, 0];
  f.skullkid.bomb = id; f.skullkid.bombState = 0; f.skullkid.detonate = false;
  return {
    id, kind: 'skull-bomb', owner: f.slot, x: point[0]!, y: point[1]!, vx: 0, vy: 0, age: 0, life: Number.MAX_SAFE_INTEGER,
    // The article's seven state scripts carry no hitbox: the bomb never touches anyone.
    data, hit: { id: 0, group: 0, bone: 0, damage: 0, radius: 0, offset: [0, 0, 0], angle: 0, growth: 0, weightSet: 0, base: 0, element: 0, soundSeverity: 0, soundKind: 0, grounded: false, airborne: false },
    reflectionCooldown: 0, victims: new Set(), speed: 0,
    skull: { state: 0, timer: SD_CODE.bomb.grow, blink: 0, scale: SD_CODE.bomb.spawnScale, hidden: false },
  };
}

/** Item_Drop → OnDrop (export 4): item state 2 with the holder's drift. */
export function dropSkullBomb(item: SkullBombProjectile, holder: MatchFighter | undefined): void {
  item.skull.state = 2; item.skull.hidden = false;
  item.vx = holder?.velocity.x ?? 0; item.vy = 0;
}

/** One item frame (Anim, then Phys and Coll). Returns false when the bomb is destroyed (OnDestroy
 * clears ft_var52). `owner` is the fighter in ft_var52's slot while it still points at this bomb. */
export function advanceSkullBomb(item: SkullBombProjectile, owner: MatchFighter | undefined, content: GameContent, poses: PoseProvider, events: MatchEvent[]): boolean {
  const r = item.skull, b = SD_CODE.bomb, holder = owner?.skullkid.bomb === item.id ? owner : undefined;
  const destroy = () => { if (holder) { holder.skullkid.bomb = null; holder.skullkid.bombState = 0; holder.skullkid.detonate = false; } return false; };
  const explode = () => {
    r.state = 6; r.timer = b.explodeFrames; item.vx = 0; item.vy = 0;
    // State 6's script: gfx 0x3E9 on the item joint (no hitbox, no sound).
    events.push({ type: 'gfx', player: item.owner, x: item.x, y: item.y, effect: b.explodeEffect, facing: 1 });
  };
  // ptr_02e94 / OnFrame: the fighter's detonation (ItemStateChange 6 + Item_SetLifeTimer x2FDC).
  if (holder?.skullkid.detonate) { holder.skullkid.detonate = false; if (r.state >= 2 && r.state <= 5) explode(); }

  if (r.state <= 1) {
    // Held: the item rides the holder's hand; a KO or a hit makes it fall out (OnDrop).
    if (!holder || ['ko', 'respawn', 'hitstun', 'captured'].includes(holder.state)) {
      if (!holder) return destroy();
      dropSkullBomb(item, holder);
    } else {
      const point = holdPoint(holder, poses); item.x = point[0]; item.y = point[1];
      // sub_037f4 / fn_03b74 shrink the held item to x2FF8 for the teleport; sub_03d14 /
      // sub_03db0 restore it to the fighter's own scale.
      const warping = holder.special?.skullkid?.state === 'SideWarp' || holder.special?.skullkid?.state === 'UpWarp';
      if (warping) r.hidden = true;
      else if (r.hidden) { r.hidden = false; r.scale = holder.content.profile.attributes.modelScale; }
      // State 0 Anim: scale 1 - life · x6E0 while the life lasts, then state 1.
      if (r.state === 0) {
        if (r.timer > 0) { r.scale = f32(1 - r.timer * b.growStep); r.timer--; }
        else r.state = 1;
      }
      // ftCo_80095D5C: the throw releases at the throw script's flag 20, with the common item-throw
      // table (or the cmd0 override), the thrower's multiplier and the item's x4, at the facing
      // captured when the throw began. OnThrow (export 5): state 3, life x6D8, self_vel.y += x6DC.
      const throwing = holder.link.itemThrow;
      if (holder.state === 'item-throw' && throwing?.item === item.id && throwing.bombReady) {
        const table = content.common.itemThrows?.[throwing.throwIndex];
        if (!table) throw new Error('Original item-throw velocity table is missing.');
        const override = command(holder, 0), degrees = (override << 20) >> 20;
        const speed = f32(table.speed * (holder.content.profile.attributes.itemThrowVelocity ?? 1) * (item.data as SkullKidBombData).throwSpeedMul * (override ? 0.01 * ((override >>> 12) & 1023) : 1));
        const angle = override && degrees !== 361 ? degrees * Math.PI / 180 : table.angle;
        item.vx = f32(Math.cos(angle) * speed * throwing.throwFacing); item.vy = f32(f32(Math.sin(angle) * speed) + b.throwLift);
        throwing.bombReady = false;
        r.state = 3; r.timer = b.throwLife; r.hidden = false;
      }
    }
  }
  if (holder) holder.skullkid.bombState = r.state;
  if (r.state <= 1) return true;

  switch (r.state) {
    case 3:
      // ptr_00310: the flight's life runs out → destroyed.
      if (--r.timer === 0) return destroy();
      break;
    case 4:
      // ptr_00430: x6D0 frames stuck, then armed for x6C4.
      if (r.timer !== 0) { r.timer--; return true; }
      r.state = 5; r.timer = b.armedLife - 1; r.blink = 0;
      if (holder) holder.skullkid.bombState = 5;
      return true;
    case 5: {
      // ptr_004d0: blink (effect 0x1A1) every int(life / x6C4 · x6CC) frames, faster as it runs out;
      // at life 0, state 6.
      const period = Math.trunc(r.timer / b.armedLife * b.blinkPeriod);
      if (r.timer === 0) explode();
      r.blink++;
      if (period > 0 && r.blink % period === 0) { r.blink = 0; events.push({ type: 'gfx', player: item.owner, x: item.x, y: item.y, effect: b.blinkEffect, facing: 1 }); }
      r.timer--;
      if (holder) holder.skullkid.bombState = r.state;
      return true;
    }
    case 6:
      // ptr_00630: gone once the life is out.
      if (r.timer > 0) { r.timer--; return true; }
      return destroy();
  }
  // States 2/3 Phys: it_80272860 (gravity x6B8 until past x6B4 / x6BC of fall speed).
  const terminal = r.state === 2 ? b.dropTerminal : b.throwTerminal;
  if (item.vy >= 0 || -item.vy < terminal) item.vy = f32(item.vy - b.gravity);
  const start: V3 = [item.x, item.y, 0], end: V3 = [f32(item.x + item.vx), f32(item.y + item.vy), 0];
  // Coll (fn_00700): touching any wall, ceiling or floor it moves into sticks it there (state 4,
  // x6D0 frames; a thrown one is also set grounded), velocity zeroed.
  const contact = traceStage(content.stage, start, end);
  if (contact) {
    item.x = contact.point[0]; item.y = contact.point[1]; item.vx = 0; item.vy = 0;
    r.state = 4; r.timer = b.stickFrames;
    if (holder) holder.skullkid.bombState = 4;
    return true;
  }
  item.x = end[0]; item.y = end[1];
  const blast = content.stage.blast;
  if (item.y < blast.bottom || item.y > blast.top || item.x < blast.left || item.x > blast.right) return destroy();
  return true;
}
