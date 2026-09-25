// Original AX auxiliary buses for match SFX. lbAudioAx_8002838C
// (third_party/melee/src/melee/lb/lbaudio_ax.c) installs AXFX ReverbStd on aux A
// and AXFX Delay on aux B; AXDriver (src/sysdolphin/baselib/axdriver.c) mixes each
// voice into main/aux A/aux B. The DSP below ports the SDK effect sources in
// third_party/melee/extern/dolphin/src/dolphin/axfx. This is the effect topology
// and parameters, not the AX DSP's fixed-point mixer or its resampler.
import type { StageId } from './stages.ts';

/** AX mixes and runs aux callbacks at 32 kHz in 5 ms (160-sample) frames. */
export const AX_RATE = 32000;
export const AX_FRAME = 160;
/** Aux returns come back one AX frame later; AXFXDelaySettings subtracts these 5 ms. */
export const AUX_RETURN_LATENCY = AX_FRAME / AX_RATE;

/** Aux A: AXDriver_8038E37C ReverbStd defaults with lbAudioAx_8002838C's `time = 1.88F`. */
export const AUX_REVERB = { time: 1.88, preDelay: 0.002, damping: 0.64, coloration: 0.5, mix: 1 } as const;
/** Aux B: AXDriver_8038E37C Delay defaults (ms / percent, left-right-surround), used as-is. */
export const AUX_DELAY = { delay: [0x104, 0x136, 6], feedback: [0x18, 0x18, 0], output: [0x23, 0x23, 0] } as const;

/** AX channel of fighter, item, hit and stage SFX (lbAudioAx_800237A8 / 80023870). */
export const AX_SFX_CHANNEL = 7;

/** One AXFX Delay line after AXFXDelaySettings' integer setup: the ring holds whole
 * 160-sample frames, feedback/output are x/128 gains. `seconds` is the loop length. */
export function delayLine(index: 0 | 1 | 2): { seconds: number; feedback: number; output: number } {
  const size = Math.floor(((AUX_DELAY.delay[index] - 5) * 32 + 0x9f) / 160);
  return { seconds: size * AX_FRAME / AX_RATE, feedback: Math.floor(AUX_DELAY.feedback[index] * 128 / 100) / 128, output: Math.floor(AUX_DELAY.output[index] * 128 / 100) / 128 };
}

/** AXDriver voice mix (axdriver.c 0x80 flag / AXDriver_8038D5B4) for send fractions
 * a = x26·x24[0]/65535 (aux A) and b = x27·x24[1]/65535 (aux B). */
export function auxMix(a: number, b: number): { main: number; auxA: number; auxB: number } {
  const A = Math.max(0, Math.min(1, a)), B = Math.max(0, Math.min(1, b));
  return { main: (1 - A) * Math.sqrt(1 - B), auxA: Math.sqrt(A), auxB: Math.sqrt(B) * Math.sqrt(1 - A) };
}

/** s32_arr_803BB6B0 columns 1/2 (lbaudio_ax.static.h), indexed by GrKind: the aux-B
 * send of AX channels 7/8. Column 1 is loaded when the match starts; grvenom.c and
 * grmutecity.c switch to column 2 in their tunnel phases (not ported). Rows past
 * Final Destination (0x25) are all [0x01, 0x01]. */
export const STAGE_AUX_B: readonly (readonly [number, number])[] = [
  [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x18, 0x18],
  [0x40, 0x40], [0x80, 0x80], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x88],
  [0x01, 0x01], [0x01, 0x01], [0x01, 0x40], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01],
  [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01], [0x01, 0x01],
  [0x48, 0x48], [0x88, 0x88], [0x01, 0x01], [0x01, 0x01], [0x38, 0x38], [0x38, 0x38],
];
/** GrKind (gr/forward.h) of each playable stage, from the archive its gr*.c module loads. */
export const STAGE_GR_KIND: Readonly<Partial<Record<StageId, number>>> = {
  'peach-castle': 0x02, 'jungle-japes': 0x05, temple: 0x07, brinstar: 0x08, 'yoshi-story': 0x0a, 'yoshi-island': 0x0b,
  'fountain-of-dreams': 0x0c, 'green-greens': 0x0d, corneria: 0x0e, venom: 0x0f, stadium: 0x10, 'mute-city': 0x12,
  onett: 0x14, fourside: 0x15, 'mushroom-kingdom': 0x18, 'dream-land': 0x1c, 'kongo-jungle': 0x1e, battlefield: 0x24, final: 0x25,
};

/** Aux-B send level (0-255) new voices on `channel` get: fn_80024654 fixes crowd
 * channels 5/6 at 0x20 and gives 7/8 the stage column; lbl_804D38D8 is 1 outside a
 * stage. Other channels (e.g. 4, the Starman/Hammer loops) never send to aux B. */
export function auxBSend(channel: number, stage: StageId | undefined): number {
  if (channel === 5 || channel === 6) return 0x20;
  if (channel !== 7 && channel !== 8) return 0;
  const kind = stage === undefined ? undefined : STAGE_GR_KIND[stage];
  return kind === undefined ? 0x01 : STAGE_AUX_B[kind]?.[0] ?? 0x01;
}

const REVERB_LENGTHS = [0x6fd, 0x7cf, 0x1b1, 0x95] as const;

/** Impulse response of one ReverbStd channel at 32 kHz: HandleReverb (reverb_std.c)
 * fed a unit impulse, in float32, preceded by the aux-return frame. All three AX
 * channels share this structure, so left and right use the same response. The
 * integer truncation of the aux buffer is omitted (below one LSB of the output). */
export function reverbImpulse(seconds = 2.5): Float32Array {
  const f = Math.fround, { time, preDelay, damping, coloration, mix } = AUX_REVERB;
  const combCoef = [0, 1].map((i) => f(10 ** f(f(REVERB_LENGTHS[i]! * -3) / f(32000 * f(time)))));
  const ring = (lag: number) => ({ data: new Float32Array(lag + 2), in: 0, out: 2 });
  const combs = [ring(REVERB_LENGTHS[0]), ring(REVERB_LENGTHS[1])], passes = [ring(REVERB_LENGTHS[2]), ring(REVERB_LENGTHS[3])];
  const push = (line: ReturnType<typeof ring>, value: number) => { line.data[line.in] = value; line.in = (line.in + 1) % line.data.length; };
  const pull = (line: ReturnType<typeof ring>) => { const value = line.data[line.out]!; line.out = (line.out + 1) % line.data.length; return value; };
  const g = f(coloration), lpCoef = f(1 - f(0.05 + f(0.8 * f(Math.max(0.05, damping))))), wet = f(f(mix) * f(0.6)), dry = f(f(0.6) - wet);
  // The asm wraps preDelayPtr on reaching element preDelayTime-1, so the ring holds one
  // sample fewer than ReverbSTDCreate allocates (63 for the 2 ms pre-delay).
  const preLine = new Float32Array(Math.max(0, Math.floor(f(32000 * f(preDelay))) - 1));
  let prePos = 0, c0 = 0, c1 = 0, a0 = 0, a1 = 0, lp = 0;
  const total = Math.round(seconds * AX_RATE), out = new Float32Array(AX_FRAME + total);
  for (let t = 0; t < total; t++) {
    const x = t === 0 ? 1 : 0;
    let input = x;
    if (preLine.length) { input = preLine[prePos]!; preLine[prePos] = x; prePos = (prePos + 1) % preLine.length; }
    push(combs[0]!, f(combCoef[0]! * c0 + input)); push(combs[1]!, f(combCoef[1]! * c1 + input));
    c0 = pull(combs[0]!); c1 = pull(combs[1]!);
    const sum = f(c0 + c1);
    const v0 = f(g * a0 + sum); push(passes[0]!, v0);
    const o0 = f(a0 - g * v0); a0 = pull(passes[0]!);
    lp = f(lpCoef * lp + f(o0 * f(0.3)));
    const v1 = f(g * a1 + lp); push(passes[1]!, v1);
    const o1 = f(a1 - g * v1); a1 = pull(passes[1]!);
    out[AX_FRAME + t] = f(wet * o1 + f(dry * x));
  }
  return out;
}

/** Band-limited (Blackman-windowed sinc) resampling of an impulse response, scaled by
 * from/to so the convolution keeps the same gain at the new rate. */
export function resampleImpulse(input: Float32Array, from: number, to: number, taps = 16): Float32Array {
  if (from === to) return input.slice();
  const ratio = to / from, cutoff = Math.min(1, ratio), reach = taps / cutoff, scale = from / to;
  const output = new Float32Array(Math.ceil(input.length * ratio));
  for (let n = 0; n < output.length; n++) {
    const center = n / ratio, low = Math.max(0, Math.ceil(center - reach)), high = Math.min(input.length - 1, Math.floor(center + reach));
    let sum = 0;
    for (let k = low; k <= high; k++) {
      const x = (center - k) * cutoff, sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.42 + 0.5 * Math.cos(Math.PI * x / taps) + 0.08 * Math.cos(2 * Math.PI * x / taps);
      sum += input[k]! * cutoff * sinc * w;
    }
    output[n] = sum * scale;
  }
  return output;
}
