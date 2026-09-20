import * as THREE from 'three';
import { MAX_MATCH_PLAYERS } from '../../../lib/game/limits.ts';
import { koColors, koPlacement, type KoColors, type KoEffectData } from '../../../lib/game/ko-effect.ts';
import type { StageGameplayData } from '../../../lib/game/data.ts';
import { ModelInstance } from './model-instance.ts';
import { KoParticles } from './ko-particles.ts';

interface Beam { model: ModelInstance; age: number; colors: KoColors; particles: KoParticles; frame: number; cue: number }
/** Presentation only. Fed exactly-once local/confirmed KO events, never speculative
 * fighter state. Its own clock can finish the animation after the final stock. */
export class KoEffects {
  private beams: Beam[] = [];
  private unsupported = new Set<string>();
  private inverse = new THREE.Matrix4();
  private point = new THREE.Vector3();
  get count(): number { return this.beams.length; }
  get particleCount(): number { return this.beams.reduce((sum, beam) => sum + beam.particles.count, 0); }
  get warnings(): readonly string[] { return [...this.unsupported]; }
  /** Brief prototype camera hold around the native visible burst. Without it the
   * tracking camera immediately zooms to the survivor and crops low/side beams. */
  get focusPoints(): readonly { x: number; y: number }[] {
    return this.beams.filter(beam => beam.age < 24).map(beam => {
      // Frame the native shock-ring center rather than the off-screen death root:
      // this keeps the burst visible without pulling the camera unnecessarily far out.
      const center = beam.model.jointPoint(2, [0,0,0], this.point);
      return {x: center.x, y: center.y};
    });
  }
  constructor(private readonly scene: THREE.Scene, private readonly data?: KoEffectData) {}
  spawn(x: number, y: number, seat: number, blast: StageGameplayData['blast']): void {
    if (!this.data) return;
    const placement = koPlacement(x, y, blast); if (!placement) return;
    if (this.beams.length >= MAX_MATCH_PLAYERS) this.release(this.beams.shift()!);
    const model = new ModelInstance(this.data.model, false, true);
    model.group.name = 'native-ko-beam';
    model.animationLoop = false;
    model.group.position.set(placement.x, placement.y, 0);
    model.group.rotation.z = placement.rotation;
    model.group.scale.setScalar(this.data.scale);
    this.scene.add(model.group);
    const colors = koColors(this.data, seat);
    model.setDrawTevColors(0, this.data.colorPart, colors.constant, colors.register0);
    const particles = new KoParticles(this.data.particles); model.group.add(particles.group);
    this.beams.push({ model, colors, particles, age: 0, frame: -1, cue: 0 });
  }
  update(frames: number, camera: THREE.Camera): void {
    if (!this.data) return;
    const elapsed = Number.isFinite(frames) ? Math.max(0, frames) : 0;
    for (const beam of [...this.beams]) {
      beam.age += elapsed;
      if (beam.age >= this.data.duration) {
        this.release(beam); this.beams.splice(this.beams.indexOf(beam), 1); continue;
      }
      // Fixed cosmetic particle ticks: fractional render deltas must neither speed
      // the emitter up at 144 Hz nor freeze it after a final-stock simulation stop.
      while (beam.frame < Math.floor(beam.age)) {
        beam.frame++;
        if (this.data.cues[beam.cue] && this.data.cues[beam.cue]!.frame <= beam.frame) {
          beam.model.update(beam.frame); beam.model.group.updateWorldMatrix(true, false);
          this.inverse.copy(beam.model.group.matrixWorld).invert();
          while (this.data.cues[beam.cue] && this.data.cues[beam.cue]!.frame <= beam.frame) {
            const cue = this.data.cues[beam.cue++]!;
            beam.model.jointPoint(cue.bone, [0,0,0], this.point).applyMatrix4(this.inverse);
            beam.particles.spawn(cue.generator, [this.point.x, this.point.y, this.point.z]);
          }
        }
        beam.particles.step();
      }
      beam.particles.render(camera);
      for (const warning of beam.particles.player.unsupported) this.unsupported.add(warning);
      beam.model.update(beam.age);
      beam.model.setDrawTevColors(0, this.data.colorPart, beam.colors.constant, beam.colors.register0);
      beam.model.applyBillboards(camera, true);
    }
  }
  private release(beam: Beam): void { beam.particles.dispose(); beam.model.dispose(); }
  reset(): void { for (const beam of this.beams) this.release(beam); this.beams = []; this.unsupported.clear(); }
  dispose(): void { this.reset(); }
}
