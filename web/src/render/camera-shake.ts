import type { PerspectiveCamera } from 'three';
import type { HsdArchive } from '../../../lib/hsd/archive.ts';
import { loadJointAnimation, sampleTrack, type AnimationClip } from '../../../lib/hsd/animation.ts';
import type { MatchEvent } from '../../../lib/game/match.ts';

export type QuakeKind = 'small' | 'medium' | 'large';
export type QuakeClips = Readonly<Partial<Record<QuakeKind, AnimationClip>>>;
/** grdatfiles + grLib_801C9CEC: stage quake_model_set animation slots 1/2/3.
 * These are the original oscillation curves, not random/procedural noise. */
export function parseCameraQuakes(archive?: HsdArchive): QuakeClips {
  if (!archive) return {};
  const descriptor = archive.symbols?.get('quake_model_set');
  if (descriptor === undefined) return {};
  const table = archive.pointer(descriptor + 4), result: Partial<Record<QuakeKind, AnimationClip>> = {};
  for (const [index, kind] of (['small', 'medium', 'large'] as const).entries()) {
    const clip = loadJointAnimation(archive, archive.pointer(table + (index + 1) * 4));
    if (clip && clip.endFrame > 0 && clip.endFrame <= 600) result[kind] = clip;
  }
  return result;
}

const rank: Record<QuakeKind, number> = { small: 0, medium: 1, large: 2 };
/** Cosmetic camera-shake intensity (options menu, persisted). `full` is the
 * historical behavior (KO + every damaging hit); `reduced` keeps KO + strong
 * hits (>= 12 damage) and skips jab-level small quakes; `off` disables all
 * shake. Simulation, snapshots and hashes never read this. */
export type CameraShakeLevel = 'off' | 'reduced' | 'full';
export const CAMERA_SHAKE_LEVELS: readonly CameraShakeLevel[] = ['off', 'reduced', 'full'];
export const CAMERA_SHAKE_STORAGE_KEY = 'smash-camera-shake';
export function isCameraShakeLevel(value: unknown): value is CameraShakeLevel {
  return typeof value === 'string' && (CAMERA_SHAKE_LEVELS as readonly string[]).includes(value);
}
export function loadCameraShakeLevel(): CameraShakeLevel {
  try {
    const raw = globalThis.localStorage?.getItem(CAMERA_SHAKE_STORAGE_KEY);
    if (isCameraShakeLevel(raw)) return raw;
  } catch { /* private mode: session-only */ }
  return 'full';
}
export function saveCameraShakeLevel(level: CameraShakeLevel): void {
  try { globalThis.localStorage?.setItem(CAMERA_SHAKE_STORAGE_KEY, level); } catch { /* Quota or private mode: the session value still applies. */ }
}
export class CameraShake {
  private active: { kind: QuakeKind; age: number } | null = null;
  constructor(private clips: QuakeClips = {}, private level: CameraShakeLevel = 'full') {}
  getLevel(): CameraShakeLevel { return this.level; }
  setLevel(level: CameraShakeLevel): void {
    this.level = level;
    if (level === 'off') this.active = null;
  }
  setClips(clips: QuakeClips): void { this.reset(); this.clips = clips; }
  reset(): void { this.active = null; }
  events(events: readonly MatchEvent[]): void {
    if (this.level === 'off') return;
    const reduced = this.level === 'reduced';
    for (const event of events) {
      if (event.type === 'ko') this.request('large'); // ftCo_Dead* explicitly requests Large.
      // Prototype extension requested for ALL damaging hits. Native damage dispatch
      // chooses from airborne knockback thresholds; we use event damage so confirmed
      // presentation never reads a later/speculative victim's knockback state.
      // `reduced` skips jab-level small quakes; KO + medium/large hits still shake.
      else if (event.type === 'hit' && (event.damage ?? 0) > 0) {
        if (reduced && (event.damage ?? 0) < 12) continue;
        this.request(event.damage! >= 20 ? 'large' : event.damage! >= 12 ? 'medium' : 'small');
      }
    }
  }
  private request(kind: QuakeKind): void {
    if (!this.clips[kind]) return;
    // Bounded strongest-wins overlap, not eight additive screen translations.
    // Do not pin the curve at frame zero during a same-tick/multihit burst.
    if (this.active && (rank[kind] < rank[this.active.kind] || rank[kind] === rank[this.active.kind] && this.active.age < 6)) return;
    this.active = { kind, age: 0 };
  }
  update(frames: number): void {
    if (!this.active) return;
    this.active.age += Number.isFinite(frames) ? Math.max(0, frames) : 0;
    // Camera_RequestQuake's 22-frame bookkeeping is not the animation lifetime:
    // grLib_801C9C40 frees the quake at its actual AObj end (30/30/40 on these stages).
    if (this.active.age >= this.clips[this.active.kind]!.endFrame) this.active = null;
  }
  sample(): { x: number; y: number } {
    if (!this.active || this.level === 'off') return { x: 0, y: 0 };
    const { kind, age } = this.active, joint = this.clips[kind]!.joints[0];
    const channel = (type: number): number => {
      const track = joint?.tracks.find(track => track.type === type);
      return track ? sampleTrack(track.keys, Math.min(age, joint!.endFrame)) ?? 0 : 0;
    };
    return { x: channel(5), y: channel(6) };
  }
  /** Render-pass-only lens shift; restore in finally. Neither the tracking camera,
   * crowd/HUD view offset, authoritative poses nor rollback state are modified.
   * Native Camera_ApplyQuake uses a 10x gain and viewport conversion. Our responsive
   * camera uses a bounded 0.8 depth gain instead of the unported native zoom solver. */
  apply(camera: PerspectiveCamera, width: number, height: number, reducedMotion = false): () => void {
    if (reducedMotion || this.level === 'off' || width <= 0 || height <= 0) return () => {};
    const { x, y } = this.sample();
    if (x === 0 && y === 0) return () => {};
    const scale = Math.min(width / 640, height / 480) * 10 * 0.8;
    const projection = camera.projectionMatrix.clone(), inverse = camera.projectionMatrixInverse.clone();
    camera.projectionMatrix.elements[8]! += x * scale * 2 / width;
    camera.projectionMatrix.elements[9]! += y * scale * 2 / height;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    return () => { camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(inverse); };
  }
}
