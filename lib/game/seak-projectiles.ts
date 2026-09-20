import type { MatchFighter } from './match.ts';
import type { Projectile } from './projectiles.ts';

/** Anchored chain whip: the item sits at the tip (owner plus facing * reach),
 * so the tip hit needs no offset math. Removed when the owner leaves travel. */
export interface SeakWhipRuntime { sourceOwner: number; serial: number; reach: number; tipY: number }
const f32 = Math.fround;

export function stepSeakWhip(item: Projectile, fighters: readonly MatchFighter[]): boolean {
  const r = item.seak!;
  const owner = fighters[r.sourceOwner];
  if (!owner || owner.state !== 'special' || owner.special?.direction !== 'side' ||
      owner.special.phase !== 'travel' || owner.special.serial !== r.serial) {
    return false;
  }
  item.x = f32(owner.x + owner.facing * r.reach);
  item.y = f32(owner.y + r.tipY);
  item.vx = 0; item.vy = 0;
  return true;
}
