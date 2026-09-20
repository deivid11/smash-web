import { floorY } from './data.ts';
import type { GameContent } from './load.ts';
import type { Projectile } from './projectiles.ts';

/** Solo Ice Shot slide (itClimbersIce, UnkMotion2): slope acceleration from the
 * floor normal, dynamic damage |vel| * scale + base while sliding, removal
 * below the minimum speed. Airborne blocks fall with article gravity. */
export function stepPopoIce(item: Projectile, content: GameContent): boolean {
  const owner = content.roster.get('Pp')!.specials;
  const params = owner.parameters;
  if (params.kind !== 'Pp') throw new Error('Missing Popo parameters.');
  const { ice } = params;
  const support = content.stage.floors
    .filter((floor) => item.x >= Math.min(floor.a[0], floor.b[0]) && item.x <= Math.max(floor.a[0], floor.b[0]))
    .sort((a, b) => floorY(b, item.x) - floorY(a, item.x))[0];
  const surface = support ? floorY(support, item.x) : null;
  if (surface !== null && item.y <= surface + 0.5 && item.vy <= 0.01) {
    item.y = surface;
    item.vy = 0;
    const dx = support!.b[0] - support!.a[0], dy = support!.b[1] - support!.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const velSign = item.vx < 0 ? -1 : 1, normalSign = nx < 0 ? -1 : 1;
    const accel = (velSign !== normalSign ? ice.slopeUp : ice.slopeDown) * (nx * ice.slopeMul);
    item.vx = Math.fround(item.vx + accel);
    if (Math.abs(item.vx) < ice.stopSpeed) return false;
    item.hit = { ...item.hit, damage: Math.trunc(Math.abs(item.vx * ice.damageScale) + ice.baseDamage) };
    return true;
  }
  item.vy = Math.fround(item.vy - item.data.gravity);
  if (item.vy < -item.data.terminal) item.vy = Math.fround(-item.data.terminal);
  return true;
}
