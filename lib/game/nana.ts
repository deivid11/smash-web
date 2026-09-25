import type { FighterKind } from './data.ts';
import type { FighterState } from './match.ts';
import type { Floor, StageSurface } from './data.ts';

/** Nana partner state for the Ice Climbers duo (`Pp`). Plain snapshot-owned
 * data: capture/restore/hash carry it automatically with the owning fighter.
 * Nana runs no inputs of her own — she follows Popo with prototype kinematics
 * (see stepNanaState) and mirrors his animation (see nanaMirrorsLeader), so
 * the synced duo both strike while only Popo drives the match flow. */
export interface NanaState {
  /** False while KO'd (solo Popo until his next stock) or hidden with a KO'd Popo. */
  active: boolean;
  x: number; y: number; vx: number; vy: number;
  facing: number; grounded: boolean; floor: number | null;
  /** Her own damage pool: knockback on Nana scales with this, never Popo's. */
  percent: number;
  /** Knockback tumble frames remaining (DamageFlyN, no mirroring, ballistic). */
  tumble: number;
  /** Regroup/spawn protection frames (strikes on Nana are ignored). */
  invulnerable: number;
  /** Last damaging attacker slot, for KO credit when Nana is launched. */
  lastHitBy: number | null;
}
/** Popo snapshot consumed by the Nana stepper (plain values, never the fighter). */
export interface NanaLeader {
  x: number; y: number; facing: number; grounded: boolean; floor: number | null; state: FighterState;
}
export interface NanaWorld {
  floors: Floor[]; surfaces: readonly StageSurface[];
  blast: { left: number; right: number; top: number; bottom: number };
}
export interface NanaTuning { runSpeed: number; jumpSpeed: number; gravity: number; terminal: number }
/** Horizontal gap Nana keeps behind Popo's facing (prototype follow anchor). */
export const NANA_ANCHOR_BACK = 9;
/** Popo height above Nana that makes a grounded Nana jump after him. */
export const NANA_JUMP_DY = 10;
/** Beyond this distance from Popo, Nana regroups beside him (prototype
 * stand-in for her recovery AI; the original flies/ Belays back). */
export const NANA_LOST_DISTANCE = 120;
/** Protection frames after a regroup warp or a revive. */
export const NANA_REGROUP_INVULN = 30;
/** Minimum flinch frames on any connecting strike (uses the real hitstun above it). */
export const NANA_MIN_TUMBLE = 8;
/** Ground-stick tolerance when Nana rides her floor sideways. */
const NANA_FLOOR_STICK = 4;
/** Lower-body height swept against wall lines, mirroring WALL_BODY_HEIGHT in
 * match.ts (the ECB side points sit a few units above the feet). */
const NANA_BODY_HEIGHT = 6;
const f32 = Math.fround;

export function initialNanaState(x: number, y: number, facing: number, floor: number | null): NanaState {
  return {
    active: true, x: f32(x), y: f32(y), vx: 0, vy: 0,
    facing: facing >= 0 ? 1 : -1, grounded: floor !== null, floor,
    percent: 0, tumble: 0, invulnerable: 0, lastHitBy: null,
  };
}
/** States where mirroring Popo would duplicate someone else's body or float:
 * grabs/captures/throws (the victim anchors to Popo), ledges and tethers
 * (Nana has no ledge physics), and the downed/out states. Everywhere else —
 * attacks, specials, shields, hitstun — the synced duo mirrors exactly. */
const NANA_WAIT: ReadonlySet<FighterState> = new Set([
  'grab', 'holding', 'captured', 'throw', 'grab-release',
  'ledge', 'ledge-action', 'ledge-jump', 'tether',
  'ko', 'respawn', 'shield-break', 'dizzy', 'bury',
  // Popo's knockdown/tech is his alone: Nana keeps her own footing and idles.
  'downed', 'tech',
]);
/** True when Nana plays Popo's animation/frame; false when she idles (Wait1/Fall). */
export function nanaMirrorsLeader(state: FighterState): boolean {
  return !NANA_WAIT.has(state);
}
/** Strikes Nana can deal and take. Grabs and Raptor-Boost-style detects need a
 * full fighter on one side (capture state, clash ownership), so Nana neither
 * grabs nor is grabbed — an explicit prototype gap. */
export function nanaStrikeHit(hit: { element?: number }): boolean {
  return hit.element !== 8 && hit.element !== 11;
}
/** Only Ice Climbers with a loaded partner model field a Nana. */
export function fighterHasNana(kind: FighterKind, partnerModel: unknown): boolean {
  return kind === 'Pp' && !!partnerModel;
}

function groundHeight(floor: Pick<Floor, 'a' | 'b'>, x: number): number {
  const [ax, ay] = floor.a, [bx, by] = floor.b;
  if (Math.abs(ay - by) <= 0.01) return ay;
  const t = Math.max(0, Math.min(1, (x - ax) / (bx - ax)));
  return Math.fround(ay + (by - ay) * t);
}
/** Floor Nana stands on while grounded: her own floor while it still spans her,
 * else the highest floor surface near her feet. Null once she walks off. */
function supportFloor(floors: Floor[], nana: NanaState, x: number): Floor | null {
  if (nana.floor !== null) {
    const own = floors.find((floor) => floor.id === nana.floor);
    if (own && x >= Math.min(own.a[0], own.b[0]) - 0.001 && x <= Math.max(own.a[0], own.b[0]) + 0.001
      && Math.abs(groundHeight(own, x) - nana.y) <= NANA_FLOOR_STICK) return own;
  }
  let best: Floor | null = null;
  for (const floor of floors) {
    if (x < Math.min(floor.a[0], floor.b[0]) - 0.001 || x > Math.max(floor.a[0], floor.b[0]) + 0.001) continue;
    const top = groundHeight(floor, x);
    if (Math.abs(top - nana.y) > NANA_FLOOR_STICK) continue;
    if (!best || top > groundHeight(best, x)) best = floor;
  }
  return best;
}
/** Downward floor crossing for a movement segment (lands from above only —
 * the same from-above rule the fighter ground follower uses). */
function landingFloor(floors: Floor[], oldX: number, oldY: number, x: number, y: number): Floor | null {
  let best: Floor | null = null, bestT = 1;
  for (const floor of floors) {
    const fx = floor.b[0] - floor.a[0], fy = floor.b[1] - floor.a[1];
    if (Math.abs(fx) < 0.001) continue;
    const side = (px: number, py: number) => (fx * (py - floor.a[1]) - fy * (px - floor.a[0])) * Math.sign(fx);
    const before = side(oldX, oldY), after = side(x, y);
    if (before < -0.001 || after >= 0) continue;
    const t = before <= 0 ? 0 : before / (before - after);
    const crossX = oldX + (x - oldX) * t;
    if (crossX < Math.min(floor.a[0], floor.b[0]) - 0.2 || crossX > Math.max(floor.a[0], floor.b[0]) + 0.2) continue;
    if (t < bestT) { bestT = t; best = floor; }
  }
  return best;
}
/** True when the movement segment crosses a wall line (extended down by the
 * body height so the feet point sweeps what the body segment would). */
function wallBlocked(surfaces: readonly StageSurface[], oldX: number, oldY: number, x: number, y: number): boolean {
  for (const surface of surfaces) {
    if (surface.kind !== 'wall') continue;
    let ax = surface.a[0], ay = surface.a[1], bx = surface.b[0], by = surface.b[1];
    const dy = by - ay;
    if (Math.abs(dy) >= 1e-6) {
      const dx = bx - ax, k = NANA_BODY_HEIGHT / Math.abs(dy);
      if (dy > 0) { ax -= dx * k; ay -= NANA_BODY_HEIGHT; }
      else { bx += dx * k; by -= NANA_BODY_HEIGHT; }
    }
    const fx = bx - ax, fy = by - ay, mx = x - oldX, my = y - oldY;
    const denom = mx * fy - my * fx;
    if (Math.abs(denom) < 1e-9) continue;
    const ex = ax - oldX, ey = ay - oldY;
    const t = (ex * fy - ey * fx) / denom, s = (ex * my - ey * mx) / denom;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return true;
  }
  return false;
}
/** Ceiling lines stop upward motion (feet-point sweep, like the fighter solver). */
function ceilingBlocked(surfaces: readonly StageSurface[], oldX: number, oldY: number, x: number, y: number): boolean {
  for (const surface of surfaces) {
    if (surface.kind !== 'ceiling') continue;
    const fx = surface.b[0] - surface.a[0], fy = surface.b[1] - surface.a[1];
    const mx = x - oldX, my = y - oldY;
    const denom = mx * fy - my * fx;
    if (Math.abs(denom) < 1e-9) continue;
    const ex = surface.a[0] - oldX, ey = surface.a[1] - oldY;
    const t = (ex * fy - ey * fx) / denom, s = (ex * my - ey * mx) / denom;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return true;
  }
  return false;
}

/** One deterministic Nana frame. Mutates and returns the state; reports
 * whether she stayed in play or crossed a blast line (the caller scores the
 * KO and leaves her inactive until Popo's next stock — Sopo rules). Inactive
 * states are never stepped. No RNG, no wall clock: repeatable by construction. */
export function stepNanaState(nana: NanaState, leader: NanaLeader, world: NanaWorld, tuning: NanaTuning): 'follow' | 'blast' {
  if (!nana.active) return 'follow';
  if (nana.invulnerable > 0) nana.invulnerable--;
  // Launched past a blast line, she is gone before any regroup can save her.
  const blast = world.blast;
  if (nana.x < blast.left || nana.x > blast.right || nana.y < blast.bottom || nana.y > blast.top) return 'blast';
  const anchorX = f32(leader.x - leader.facing * NANA_ANCHOR_BACK);
  if (Math.hypot(nana.x - leader.x, nana.y - leader.y) > NANA_LOST_DISTANCE) {
    // Regroup warp: reappear by Popo's side, briefly protected.
    nana.x = anchorX; nana.y = f32(leader.y); nana.vx = 0; nana.vy = 0;
    nana.facing = leader.facing; nana.grounded = leader.grounded; nana.floor = leader.floor;
    nana.tumble = 0; nana.invulnerable = NANA_REGROUP_INVULN;
    return 'follow';
  }
  if (nana.tumble > 0) {
    nana.tumble--;
    if (nana.grounded) {
      // Weak/flat strikes flinch her in place; a horizontal shove slides her
      // along her floor (walls stop her, walked-off edges drop her back to
      // ballistic flight). She rejoins the mirror when the flinch ends.
      let nextX = f32(nana.x + nana.vx);
      if (wallBlocked(world.surfaces, nana.x, nana.y, nextX, nana.y)) { nextX = nana.x; nana.vx = 0; }
      const floor = supportFloor(world.floors, nana, nextX);
      if (floor) {
        nana.x = nextX; nana.y = f32(groundHeight(floor, nextX)); nana.floor = floor.id;
      } else {
        nana.x = nextX; nana.grounded = false; nana.floor = null;
      }
    } else {
      nana.vy = f32(Math.max(-tuning.terminal, nana.vy - tuning.gravity));
      let nextX = f32(nana.x + nana.vx), nextY = f32(nana.y + nana.vy);
      if (wallBlocked(world.surfaces, nana.x, nana.y, nextX, nextY)) { nextX = nana.x; nana.vx = 0; }
      if (nana.vy > 0 && ceilingBlocked(world.surfaces, nana.x, nana.y, nextX, nextY)) { nextY = nana.y; nana.vy = 0; }
      const floor = landingFloor(world.floors, nana.x, nana.y, nextX, nextY);
      if (floor) {
        nana.x = nextX; nana.y = f32(groundHeight(floor, nextX));
        nana.vx = 0; nana.vy = 0; nana.grounded = true; nana.floor = floor.id; nana.tumble = 0;
      } else {
        nana.x = nextX; nana.y = nextY; nana.grounded = false; nana.floor = null;
      }
    }
  } else {
    // Synced follow: run toward the anchor, jump after a rising Popo, fall
    // off edges and land on whatever floor is below.
    const step = Math.max(-tuning.runSpeed, Math.min(tuning.runSpeed, anchorX - nana.x));
    let nextX = f32(nana.x + step);
    if (wallBlocked(world.surfaces, nana.x, nana.y, nextX, nana.y)) nextX = nana.x;
    nana.facing = leader.facing;
    if (nana.grounded) {
      const floor = supportFloor(world.floors, nana, nextX);
      if (floor) {
        nana.x = nextX; nana.y = f32(groundHeight(floor, nextX)); nana.floor = floor.id;
        nana.vx = 0; nana.vy = 0;
      } else {
        // Walked off: start falling with no vertical speed.
        nana.x = nextX; nana.grounded = false; nana.floor = null; nana.vx = 0; nana.vy = 0;
      }
      if (nana.grounded && leader.y > nana.y + NANA_JUMP_DY) {
        nana.vy = f32(tuning.jumpSpeed); nana.grounded = false; nana.floor = null;
      }
    } else {
      nana.vy = f32(Math.max(-tuning.terminal, nana.vy - tuning.gravity));
      const nextY = f32(nana.y + nana.vy);
      let landX = nextX, landY = nextY;
      if (wallBlocked(world.surfaces, nana.x, nana.y, nextX, nextY)) landX = nana.x;
      if (nana.vy > 0 && ceilingBlocked(world.surfaces, nana.x, nana.y, landX, nextY)) {
        nana.x = landX; nana.vy = 0;
      } else {
        const floor = landingFloor(world.floors, nana.x, nana.y, landX, nextY);
        if (floor) {
          nana.x = landX; nana.y = f32(groundHeight(floor, landX));
          nana.vy = 0; nana.grounded = true; nana.floor = floor.id;
        } else {
          nana.x = landX; nana.y = landY;
        }
      }
    }
  }
  const endBlast = world.blast;
  if (nana.x < endBlast.left || nana.x > endBlast.right || nana.y < endBlast.bottom || nana.y > endBlast.top) return 'blast';
  return 'follow';
}
