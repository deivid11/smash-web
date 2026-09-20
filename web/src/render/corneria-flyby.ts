import type { HsdArchive } from '../../../lib/hsd/archive.ts';
import { loadJointAnimation, type AnimationClip } from '../../../lib/hsd/animation.ts';
import type { ModelInstance } from './model-instance.ts';

/** Presentation-only replay of Corneria's city flyby (grcorneria.c). The three city
 * strips are map roots 8/9/4 (3200/3200/4800 model units wide); their think procs
 * (grCorneria_801DFC98 / 801DFF20 / 801E01A8) advance x by yakumono_param->x88 world
 * units per frame, cycle 8→9→4 to the left of each other (grCorneria_801E03C8), and
 * take y = -xD0 from the Great Fox's altitude dips (grCorneria_801E2228). The random
 * dip trigger is replaced by a fixed cadence so rendering stays a pure function of
 * the match frame; nothing here touches collision, simulation state or hashes. */
interface Strip { root: number; width: number; start: number }
const STRIPS: readonly Strip[] = [
  { root: 8, width: 3200, start: 0 },      // grCorneria_801E0678: city A at the arena
  { root: 9, width: 3200, start: -3200 },  // city B one strip to the left
  { root: 4, width: 4800, start: 4000 },   // ground strip to the right
];
const BAND = 11200;            // model units; widths chain 3200+4000+4000 per 801E03C8
const WRAP_MARGIN = 1400;      // world units past the half width (801DFC98 thresholds)
const DIP_ACCEL = 0.005;       // grCorneria_801E2228 per-frame ramp
const DIP_HOLD = 0x384;        // frames from dip start until the climb begins
const DIP_PERIOD = 3600;       // prototype cadence replacing the original 1-in-3 roll
const DIP_START = 900;         // cruise first: matches never open on the low pass
/** grCorneria_801DD674: the Great Fox jobj flies base_y = 250 world units above the
 * authored city and the hull collision rides that jobj. Our static hull keeps the raw
 * archive coordinates instead, so the city carries the -250 complement and the dips
 * (y = -xD0) raise it toward the ship exactly as in the original. */
const SHIP_BASE_Y = 250;

/** The near-Arwing escort (map root 2). grCorneria_801DED50 turns the whole root
 * -90° around Y, scales it by yakumono_param->x70·groundScale, and plays banking
 * maneuvers from later slots of its original animation table. Its native flight
 * path (Ground_AnimateStarFoxArwingWithBackground + splines) is not ported: the
 * escort's approach/hold/leave positions below are a supplemental approximation. */
const ARWING_ROOT = 2;
const ARWING_CLIP_SLOT = 2;    // 435-frame banking maneuver from the original table
const ARWING_START = 2500;     // inside the cruise segment, clear of the altitude dip
const ARWING_ENTER = 150;
const ARWING_HOLD = 550;
const ARWING_LEAVE = 180;
const ARWING_FROM = { x: 560, y: 190, z: -430 };
const ARWING_AT = { x: 55, y: 108, z: -150 };
const ARWING_TO = { x: -680, y: 135, z: -400 };

export interface CorneriaFlyby { speed: number; arwingScale: number; arwingClip: AnimationClip | null }
/** yakumono_param x88/x70 (grdatfiles.c loads the symbol from GrCn.dat) and the
 * Arwing banking clip from map root 2's original animation table. */
export function readCorneriaFlyby(archive: HsdArchive): CorneriaFlyby | null {
  if (!archive.symbols.has('yakumono_param') || !archive.symbols.has('map_head')) return null;
  const yakumono = archive.symbol('yakumono_param');
  const speed = archive.f32(yakumono + 0x88), arwingScale = archive.f32(yakumono + 0x70);
  if (!Number.isFinite(speed) || Math.abs(speed) > 100 || !(arwingScale > 0) || arwingScale > 10) return null;
  let arwingClip: AnimationClip | null = null;
  try {
    const descs = archive.pointer(archive.symbol('map_head') + 8);
    const table = archive.pointer(descs + ARWING_ROOT * 0x34 + 4);
    arwingClip = table ? loadJointAnimation(archive, archive.pointer(table + ARWING_CLIP_SLOT * 4)) : null;
  } catch { arwingClip = null; }
  return { speed, arwingScale, arwingClip };
}

/** grCorneria_801E2228 altitude offset xD0 ≤ 0: a 0.005-per-frame ramp down to
 * 50·scale − 250 world units, held until frame 0x384, then the mirrored climb. */
function altitude(frame: number, scale: number): number {
  const depth = 250 - 50 * scale;
  const half = Math.sqrt(depth / DIP_ACCEL); // ramp peak: the 3.0 velocity cap is never reached
  const down = (u: number): number => u <= half ? DIP_ACCEL * u * u / 2
    : u <= 2 * half ? depth - DIP_ACCEL * (2 * half - u) * (2 * half - u) / 2 : depth;
  const u = (frame % DIP_PERIOD) - DIP_START;
  if (u < 0) return 0;
  if (u < DIP_HOLD) return -down(u);
  return -Math.max(0, depth - down(u - DIP_HOLD));
}

const smooth = (t: number): number => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

function arwingState(flyby: CorneriaFlyby, frame: number, scale: number): { offset: [number, number, number]; animationFrame: number } | null {
  if (!flyby.arwingClip) return null;
  const u = (frame % DIP_PERIOD) - ARWING_START;
  if (u < 0 || u >= ARWING_ENTER + ARWING_HOLD + ARWING_LEAVE) return null;
  const mix = (a: typeof ARWING_FROM, b: typeof ARWING_FROM, t: number): [number, number, number] =>
    [(a.x + (b.x - a.x) * t) / scale, (a.y + (b.y - a.y) * t) / scale, (a.z + (b.z - a.z) * t) / scale];
  const offset = u < ARWING_ENTER ? mix(ARWING_FROM, ARWING_AT, smooth(u / ARWING_ENTER))
    : u < ARWING_ENTER + ARWING_HOLD ? mix(ARWING_AT, ARWING_AT, 0)
    : mix(ARWING_AT, ARWING_TO, smooth((u - ARWING_ENTER - ARWING_HOLD) / ARWING_LEAVE) ** 2);
  return { offset, animationFrame: u };
}

export function applyCorneriaFlyby(stage: ModelInstance, flyby: CorneriaFlyby, frame: number, scale: number): void {
  const y = (-SHIP_BASE_Y - altitude(frame, scale)) / scale; // world → model units under the scaled group
  for (const strip of STRIPS) {
    const upper = (strip.width * scale) / 2 + WRAP_MARGIN;         // world despawn threshold
    const world = strip.start * scale + flyby.speed * frame;       // world center, unwrapped
    const band = BAND * scale;
    const wrapped = upper - (((upper - world) % band) + band) % band;
    stage.setObjectOffset(strip.root, wrapped / scale, y, 0);
  }
  const arwing = arwingState(flyby, frame, scale);
  stage.setObjectClip(ARWING_ROOT, flyby.arwingClip);
  stage.setObjectState(ARWING_ROOT, arwing ? {
    offset: arwing.offset, rotationY: -Math.PI / 2, scale: flyby.arwingScale,
    animationFrame: arwing.animationFrame, visible: true,
  } : null);
}
