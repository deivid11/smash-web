import type { HsdArchive } from '../hsd/archive.ts';
import { loadJointAnimation } from '../hsd/animation.ts';
import { loadModel, type HsdModel, type V3 } from '../hsd/model.ts';
import type { StageGameplayData } from './data.ts';
import { playerPresentation } from './player-colors.ts';
import { ParticleBank } from '../hsd/particle-bank.ts';

export interface KoColors { constant: V3; register0: V3 }
export interface KoEffectData {
  model: HsdModel; duration: number; scale: number; colorPart: number;
  colors: readonly KoColors[];
  particles: ParticleBank;
  cues: readonly { frame: number; generator: number; bone: number }[];
}
/** efAsync_Dispatch(0x42B) -> effCommonDataTable[0x19]. No extracted assets
 * are shipped: the model, textures, curves and player colors come from the user's disc. */
export function parseKoEffect(effects: HsdArchive, common: HsdArchive): KoEffectData {
  const entry = effects.symbol('effCommonDataTable') + 8 + 0x19 * 20;
  const model = loadModel(effects, { name: 'native-ko-beam', offset: effects.pointer(entry + 4),
    animation: effects.pointer(entry + 8), materialAnimation: effects.pointer(entry + 12) });
  const root = model.roots[0];
  const animation = root && loadJointAnimation(effects, root.animationPointer);
  const duration = animation?.endFrame;
  // efLib_SetTevKonstColor touches only the first child JObj's first DObj/TObj.
  const colorPart = root?.parts.findIndex(part => part.owner === 1) ?? -1;
  const table = common.symbol('ftLoadCommonData'), parameters = common.pointer(table);
  const scale = common.f32(parameters + 0x4f4);
  if (!duration || duration > 600 || colorPart < 0 || !root?.joints[2] || !Number.isFinite(scale) || scale <= 0 || scale > 10) throw Error('Unsupported original KO effect descriptor.');
  const rgb = (tableIndex: number, player: number): V3 => {
    const pointer = common.pointer(table + tableIndex * 4) + player * 4;
    return [common.u8(pointer) / 255, common.u8(pointer + 1) / 255, common.u8(pointer + 2) / 255];
  };
  const cues: Array<{ frame: number; generator: number; bone: number }> = [], bits = new DataView(new ArrayBuffer(4));
  animation?.joints.forEach((joint, bone) => {
    const seen = new Set<string>();
    for (const track of joint.tracks) if (track.type === 40) for (const key of track.keys) {
      // JObjAnim's dptcl callback reads the integer member of the animation union.
      bits.setFloat32(0, key.p0); const value = bits.getUint32(0), bank = value & 63, generator = value >>> 6 & 0xffffff;
      if (bank !== 0) throw Error('Unsupported KO particle bank.');
      const stamp = `${key.time}:${generator}`;
      if (key.time >= 0 && key.time < duration && !seen.has(stamp)) { cues.push({frame:key.time, generator, bone}); seen.add(stamp); }
    }
  });
  if (cues.length > 64) throw Error('KO particle cue budget exceeded.');
  cues.sort((a,b) => a.frame - b.frame);
  const effectTable = effects.symbol('effCommonDataTable');
  return { model, duration, scale, colorPart, cues,
    particles: new ParticleBank(effects, effects.pointer(effectTable), effects.pointer(effectTable + 4)),
    // The pinned native call evaluates the two va_arg expressions right-to-left:
    // first argument -> r6/tev0, second -> r5/konst (efAsync_Dispatch 0x80065998).
    // Reversing these loses the bright core and produces a flat player-color bar.
    colors: Array.from({ length: 4 }, (_, player) => ({ constant: rgb(19, player), register0: rgb(18, player) })) };
}

/** ftCo_800D3158 boundary priority and ftCo_Dead{Left,Right,Down,Up}
 * effect orientation/clamping. The beam points inward from the death position.
 * Star/screen KO selection is not ported; this handles the prototype's blast KOs. */
export function koPlacement(x: number, y: number, blast: StageGameplayData['blast']): { x: number; y: number; rotation: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
  if (x > blast.right) return { x, y: clamp(y, blast.bottom, blast.top), rotation: Math.PI / 2 };
  if (x < blast.left) return { x, y: clamp(y, blast.bottom, blast.top), rotation: -Math.PI / 2 };
  if (y > blast.top) return { x: clamp(x, blast.left, blast.right), y, rotation: Math.PI };
  if (y < blast.bottom) return { x: clamp(x, blast.left, blast.right), y, rotation: 0 };
  return null;
}

/** A KO that crossed the top blast line within the side bounds — the upward
 * launch that earns a Star KO instead of the boundary burst beam. Mirrors
 * koPlacement's priority: left/right win the corners, so this is a pure top exit. */
export function isTopBlastKO(x: number, y: number, blast: StageGameplayData['blast']): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && y > blast.top && x >= blast.left && x <= blast.right;
}

export function koColors(data: KoEffectData, seat: number): KoColors {
  if (data.colors[seat]) return data.colors[seat]!;
  // Explicit 5–8-seat prototype addition; original Melee has four effect palettes.
  const color = playerPresentation(seat).color;
  const register0: V3 = [(color >>> 16 & 255) / 255, (color >>> 8 & 255) / 255, (color & 255) / 255];
  return { register0, constant: register0.map(c => 0.7 + c * 0.3) as V3 };
}
