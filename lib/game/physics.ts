import type { CommonGameplayData, FighterProfile } from './data.ts';
import type { HitDefinition } from './moves.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from './limits.ts';

interface CoreExports {
  memory: WebAssembly.Memory;
  core_common_ptr(): number; core_common_size(): number;
  core_attrs_ptr(slot: number): number; core_attrs_size(): number;
  core_seed(seed: number): void;
  core_set_velocity(slot: number, x: number, y: number, grounded: number): void;
  core_velocity(slot: number, axis: number): number;
  core_ground(slot: number, stick: number): number;
  core_stationary_ground(slot: number): number;
  core_dash?(slot: number, stick: number): number;
  core_turn_run?(slot: number, stick: number, facing: number): number;
  core_walk(slot: number, stick: number): number;
  core_walk_type(slot: number, velocity: number): number;
  core_smash_damage(slot: number, damage: number, frames: number, limit: number, multiplier: number): number;
  core_air(slot: number, stick: number, fastFall: number): void;
  core_jump(slot: number, stick: number, shortHop: number): void;
  core_air_jump(slot: number, stick: number): void;
  core_hit(slot: number, percent: number, damage: number, growth: number, base: number, weightSet: number, angle: number, air: number, knockbackMultiplier: number): void;
  core_decay(x: number, y: number, grounded: number, friction: number): void;
  core_result(index: number): number;
  core_custom_air(slot: number, gravity: number, terminal: number, friction: number): void;
  core_ascend(slot: number, amount: number, maximum: number): void;
  core_drift(slot: number, stick: number, accel: number, maximum: number): void;
  core_controlled_drift(slot: number, stick: number, accel: number, maximum: number): void;
  core_motion(slot: number, z: number, y: number, facing: number, angle: number, multiplier: number): void;
  HSD_Rand(): number;
}
export interface Velocity { x: number; y: number }
export interface HitResult { knockback: number; angle: number; speed: number; hitstun: number; hitlag: number }

// Compiled modules are immutable resources. Every match instantiates its own memory.
const modules = new WeakMap<WebAssembly.Instance, WebAssembly.Module>();
export class MeleePhysics {
  readonly wasm: CoreExports;
  constructor(private readonly instance: WebAssembly.Instance, private readonly common: CommonGameplayData, profiles: readonly FighterProfile[]) {
    this.wasm = instance.exports as unknown as CoreExports;
    for (const name of ['core_common_ptr', 'core_attrs_ptr', 'core_ground', 'core_walk', 'core_walk_type', 'core_smash_damage', 'core_air', 'core_jump', 'core_hit', 'core_decay']) {
      if (typeof instance.exports[name] !== 'function') throw new Error(`Missing gameplay WASM export ${name}.`);
    }
    if (profiles.length < MIN_MATCH_PLAYERS || profiles.length > MAX_MATCH_PLAYERS || this.wasm.core_attrs_size() !== 0x9c) throw new Error('Unexpected gameplay adapter ABI.');
    const view = new DataView(this.wasm.memory.buffer);
    const base = this.wasm.core_common_ptr(), size = this.wasm.core_common_size();
    for (const [offset, bits] of common.words) {
      if (offset < 0 || offset + 4 > size) throw new Error('Common-data adapter offset out of bounds.');
      view.setUint32(base + offset, bits, true);
    }
    this.configure(profiles);
  }
  /** Independent mutable WASM world, sharing only its compiled module and data. */
  fork(profiles: readonly FighterProfile[]): MeleePhysics {
    const module = modules.get(this.instance);
    if (!module) throw new Error('Independent physics requires instantiateGameplay().');
    return new MeleePhysics(instantiateModule(module), this.common, profiles);
  }
  /** Full fixed-size linear memory includes RNG, fighter scratch, results and C statics.
   * The standalone adapter has no host imports or persistent mutable globals other
   * than its balanced stack pointer. Capture/restore only at synchronous frame boundaries.
   * Phase 4.2: copy into a caller-owned ring buffer instead of allocating per snapshot. */
  captureState(): Uint8Array { return new Uint8Array(this.wasm.memory.buffer).slice(); }
  copyMemoryInto(target: Uint8Array): Uint8Array {
    if (target.byteLength !== this.wasm.memory.buffer.byteLength) throw new Error('Incompatible physics snapshot.');
    target.set(new Uint8Array(this.wasm.memory.buffer));
    return target;
  }
  /** Live view for hashing only: no copy. The caller must hash synchronously
   * at a frame boundary; the view aliases WASM memory. */
  memoryView(): Uint8Array { return new Uint8Array(this.wasm.memory.buffer); }
  restoreState(state: Uint8Array): void {
    if (state.byteLength !== this.wasm.memory.buffer.byteLength) throw new Error('Incompatible physics snapshot.');
    new Uint8Array(this.wasm.memory.buffer).set(state);
  }
  configure(profiles:readonly FighterProfile[]):void {
    if(profiles.length<MIN_MATCH_PLAYERS||profiles.length>MAX_MATCH_PLAYERS)throw Error(`The match requires ${MIN_MATCH_PLAYERS} to ${MAX_MATCH_PLAYERS} fighter profiles.`);
    profiles.forEach((profile, slot) => this.configureSlot(slot, profile));
  }
  /** Rewrite one slot's original attribute prefix (Zelda/Sheik Transform swaps
   * the live profile mid-match; WASM memory snapshots already cover the words). */
  configureSlot(slot:number,profile:FighterProfile):void {
    const view=new DataView(this.wasm.memory.buffer);
    const pointer = this.wasm.core_attrs_ptr(slot);
    if (!pointer) throw new Error('Gameplay WASM lacks the requested fighter slot; rebuild the adapter.');
    if (profile.words.byteLength !== 0x9c) throw new Error('Invalid original attribute prefix.');
    profile.words.forEach((bits, index) => view.setUint32(pointer + index * 4, bits, true));
  }
  seed(value: number): void { this.wasm.core_seed(value >>> 0); }
  random(): number { return this.wasm.HSD_Rand() / 65536; }
  ground(slot: number, x: number, stick: number): number {
    this.wasm.core_set_velocity(slot, x, 0, 1); return this.wasm.core_ground(slot, stick);
  }
  /** ftCo_Dash_Phys: dash acceleration without the run taper (falls back to Run on an older adapter). */
  dash(slot: number, x: number, stick: number): number {
    if (!this.wasm.core_dash) return this.ground(slot, x, stick);
    this.wasm.core_set_velocity(slot, x, 0, 1); return this.wasm.core_dash(slot, stick);
  }
  /** ftCo_TurnRun_Phys: `facing` is the run direction the skid started from. */
  turnRun(slot: number, x: number, stick: number, facing: number): number {
    if (!this.wasm.core_turn_run) return this.ground(slot, x, stick);
    this.wasm.core_set_velocity(slot, x, 0, 1); return this.wasm.core_turn_run(slot, stick, facing);
  }
  stationaryGround(slot: number, x: number): number {
    this.wasm.core_set_velocity(slot,x,0,1); return this.wasm.core_stationary_ground(slot);
  }
  walk(slot: number, x: number, stick: number): number {
    this.wasm.core_set_velocity(slot, x, 0, 1); return this.wasm.core_walk(slot, stick);
  }
  walkType(slot: number, velocity: number): number { return this.wasm.core_walk_type(slot, velocity); }
  smashDamage(slot: number, damage: number, frames: number, limit: number, multiplier: number): number {
    return this.wasm.core_smash_damage(slot, damage, frames, limit, multiplier);
  }
  air(slot: number, velocity: Velocity, stick: number, fastFall: boolean): Velocity {
    this.wasm.core_set_velocity(slot, velocity.x, velocity.y, 0); this.wasm.core_air(slot, stick, +fastFall);
    return this.velocity(slot);
  }
  jump(slot: number, velocity: Velocity, stick: number, shortHop: boolean, aerial = false): Velocity {
    this.wasm.core_set_velocity(slot, velocity.x, velocity.y, +!aerial);
    if (aerial) this.wasm.core_air_jump(slot, stick); else this.wasm.core_jump(slot, stick, +shortHop);
    return this.velocity(slot);
  }
  customAir(slot: number, velocity: Velocity, gravity: number, terminal: number, friction: number): Velocity {
    this.wasm.core_set_velocity(slot, velocity.x, velocity.y, 0); this.wasm.core_custom_air(slot, gravity, terminal, friction); return this.velocity(slot);
  }
  ascend(slot: number, velocity: Velocity, amount: number, maximum: number): Velocity {
    this.wasm.core_set_velocity(slot, velocity.x, velocity.y, 0); this.wasm.core_ascend(slot, amount, maximum); return this.velocity(slot);
  }
  drift(slot: number, velocity: Velocity, stick: number, accel: number, maximum: number): Velocity {
    this.wasm.core_set_velocity(slot, velocity.x, velocity.y, 0); this.wasm.core_drift(slot, stick, accel, maximum); return this.velocity(slot);
  }
  /** ftCommon_8007D344 preserves momentum with aerial friction (Link Spin Attack). */
  controlledDrift(slot: number, velocity: Velocity, stick: number, accel: number, maximum: number): Velocity {
    this.wasm.core_set_velocity(slot, velocity.x, velocity.y, 0); this.wasm.core_controlled_drift(slot, stick, accel, maximum); return this.velocity(slot);
  }
  motion(slot: number, z: number, y: number, facing: number, angle = 0, multiplier = 1): Velocity {
    this.wasm.core_motion(slot, z, y, facing, angle, multiplier); return this.velocity(slot);
  }
  private velocity(slot: number): Velocity { return { x: this.wasm.core_velocity(slot, 0), y: this.wasm.core_velocity(slot, 1) }; }
  hit(slot: number, percent: number, hit: HitDefinition, airborne: boolean, knockbackMultiplier = 1): HitResult {
    this.wasm.core_hit(slot, percent, hit.damage, hit.growth, hit.base, hit.weightSet, hit.angle, +airborne, knockbackMultiplier);
    return { knockback: this.wasm.core_result(0), angle: this.wasm.core_result(1), speed: this.wasm.core_result(2), hitstun: Math.max(1, Math.floor(this.wasm.core_result(3))), hitlag: Math.max(0, Math.floor(this.wasm.core_result(4))) };
  }
  decay(velocity: Velocity, grounded: boolean, friction: number): Velocity {
    this.wasm.core_decay(velocity.x, velocity.y, +grounded, friction);
    return { x: this.wasm.core_result(0), y: this.wasm.core_result(1) };
  }
}

function instantiateModule(module: WebAssembly.Module): WebAssembly.Instance {
  const instance = new WebAssembly.Instance(module, {});
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  modules.set(instance, module);
  return instance;
}
export async function instantiateGameplay(bytes: BufferSource): Promise<WebAssembly.Instance> {
  return instantiateModule(await WebAssembly.compile(bytes));
}
