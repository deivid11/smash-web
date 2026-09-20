import * as THREE from 'three';

/** Melee-style pause camera: while the match is frozen the player takes manual
 * control of an orbit camera (drag to rotate, scroll to zoom, pan, and focus
 * individual fighters). Presentation only — it never touches simulation state,
 * snapshots or hashes, and is only ever driven while `paused` is true. */
const MIN_PITCH = -1.15;   // just under straight-down: keep a sliver of ground
const MAX_PITCH = 1.4;
const MIN_DISTANCE = 22;   // close enough to fill the frame with one fighter
const MAX_DISTANCE = 1800; // wide enough to take in the whole stage
const PAN_RATE = 0.0016;   // world units per screen unit, scaled by distance

interface Seed { yaw: number; pitch: number; distance: number; home: THREE.Vector3 }

export class PauseCamera {
  /** Orbit around the look point: yaw about world +Y, pitch as elevation. */
  yaw = 0;
  pitch = 0.28;
  distance = 200;
  /** Fighter slot the camera is centred on, or null for the free look point. */
  focus: number | null = null;
  /** Free look anchor (seeded from the live shot), the additive pan offset the
   * player builds up, the resolved desired centre and the smoothed centre the
   * camera actually looks at (so focus swaps glide instead of snapping). */
  readonly home = new THREE.Vector3();
  readonly pan = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private seed: Seed | null = null;

  /** Seed the orbit from the live match camera so entering pause never jumps:
   * decompose the current position around the framed target into yaw/pitch/
   * distance, and remember it as the reset pose. */
  begin(camera: THREE.PerspectiveCamera, target: THREE.Vector3): void {
    this.home.copy(target);
    this.pan.set(0, 0, 0);
    this.focus = null;
    this.look.copy(target);
    const dx = camera.position.x - target.x, dy = camera.position.y - target.y, dz = camera.position.z - target.z;
    const dist = Math.hypot(dx, dy, dz) || 200;
    this.distance = THREE.MathUtils.clamp(dist, MIN_DISTANCE, MAX_DISTANCE);
    this.yaw = Math.atan2(dx, dz);
    this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(dy / dist, -1, 1)), MIN_PITCH, MAX_PITCH);
    this.seed = { yaw: this.yaw, pitch: this.pitch, distance: this.distance, home: this.home.clone() };
  }

  /** Restore the entry pose: same orbit, no pan, back to the free look point. */
  reset(): void {
    if (!this.seed) return;
    this.yaw = this.seed.yaw; this.pitch = this.seed.pitch; this.distance = this.seed.distance;
    this.home.copy(this.seed.home); this.pan.set(0, 0, 0); this.focus = null;
  }

  /** Rotate the orbit. Drag right spins the turntable; drag up tilts the eye up. */
  orbit(dYaw: number, dPitch: number): void {
    this.yaw -= dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dPitch, MIN_PITCH, MAX_PITCH);
  }

  /** Multiplicative zoom: factor < 1 moves in, > 1 moves out. */
  zoom(factor: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * (Number.isFinite(factor) && factor > 0 ? factor : 1), MIN_DISTANCE, MAX_DISTANCE);
  }

  /** Slide the look point across the view plane (camera right / up), so a pan
   * feels the same at any orbit angle. `r`/`u` are screen-space amounts. */
  nudge(r: number, u: number, camera: THREE.PerspectiveCamera): void {
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(camera.matrixWorld, 1);
    const k = this.distance * PAN_RATE;
    this.pan.addScaledVector(this.right, r * k).addScaledVector(this.up, u * k);
  }

  /** Place the camera for this frame around `anchor` (a focused fighter or the
   * free look point), plus the accumulated pan, easing the centre for smoothness. */
  apply(camera: THREE.PerspectiveCamera, anchor: THREE.Vector3): void {
    this.desired.copy(anchor).add(this.pan);
    this.look.lerp(this.desired, 0.35);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    camera.position.set(
      this.look.x + this.distance * cp * sy,
      this.look.y + this.distance * sp,
      this.look.z + this.distance * cp * cy,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    camera.updateMatrixWorld(true);
  }
}
