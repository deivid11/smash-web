import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AX_FRAME, AX_RATE, auxBSend, auxMix, delayLine, reverbImpulse, resampleImpulse, STAGE_AUX_B, STAGE_GR_KIND } from '../../lib/game/ax-aux.ts';
import { SemTable } from '../../lib/game/audio.ts';
import { SUPPORTED_STAGES } from '../../lib/game/stages.ts';

const melee = new URL('../../third_party/melee/', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, melee), 'utf8');

describe('original AX aux buses', () => {
  it('copies the per-stage aux-B send columns from s32_arr_803BB6B0', () => {
    const body = /s32_arr_803BB6B0\[0x6F\]\[3\] = \{([\s\S]*?)\n\};/.exec(source('src/melee/lb/lbaudio_ax.static.h'))![1]!;
    const rows = [...body.matchAll(/\{\s*(0x[0-9A-F]+),\s*(0x[0-9A-F]+),\s*(0x[0-9A-F]+)\s*\}/g)].map((m) => [Number(m[2]), Number(m[3])]);
    expect(rows).toHaveLength(0x6f);
    expect(STAGE_AUX_B).toEqual(rows.slice(0, STAGE_AUX_B.length));
    expect(rows.slice(STAGE_AUX_B.length, -1).every(([a, b]) => a === 1 && b === 1)).toBe(true);
  });
  it('maps every playable stage to the GrKind whose module loads its archive', () => {
    const kinds = new Map([...source('src/melee/gr/forward.h').matchAll(/\/\* (0x[0-9A-F]{2}) \*\/ Gr_Kind_(\w+),/g)].map((m) => [Number(m[1]), m[2]!.toLowerCase()]));
    for (const stage of SUPPORTED_STAGES) {
      const kind = STAGE_GR_KIND[stage.id];
      expect(kind, stage.id).toBeDefined();
      expect(source(`src/melee/gr/gr${kinds.get(kind!)}.c`), stage.id).toContain(`"/${stage.asset.replace(/\.dat$/, '')}`);
    }
  });
  it('gives match SFX the stage echo send and crowd channels the fixed 0x20', () => {
    expect(auxBSend(7, 'final')).toBe(0x38); expect(auxBSend(7, 'battlefield')).toBe(0x38);
    expect(auxBSend(7, 'temple')).toBe(0x18); expect(auxBSend(7, 'brinstar')).toBe(0x40);
    expect(auxBSend(7, 'corneria')).toBe(0x01); expect(auxBSend(8, 'final')).toBe(0x38);
    expect(auxBSend(5, 'final')).toBe(0x20); expect(auxBSend(6, 'corneria')).toBe(0x20);
    expect(auxBSend(4, 'final')).toBe(0); expect(auxBSend(7, undefined)).toBe(0x01);
  });
  it('mixes sends with the AXDriver square-root law', () => {
    expect(auxMix(0, 0)).toEqual({ main: 1, auxA: 0, auxB: 0 });
    const a = 255 * 20 / 65535, b = 255 * 0x38 / 65535, mix = auxMix(a, b);
    expect(mix.main).toBeCloseTo(Math.sqrt(1 - a) * Math.sqrt(1 - a) * Math.sqrt(1 - b), 12);
    expect(mix.auxA).toBeCloseTo(Math.sqrt(a), 12);
    expect(mix.auxB).toBeCloseTo(Math.sqrt(b) * Math.sqrt(1 - a), 12);
  });
  it('reproduces AXFXDelaySettings integer setup for the default delay', () => {
    expect(delayLine(0)).toEqual({ seconds: 0.255, feedback: 30 / 128, output: 44 / 128 });
    expect(delayLine(1)).toEqual({ seconds: 0.305, feedback: 30 / 128, output: 44 / 128 });
    expect(delayLine(2).output).toBe(0);
  });
  it('ports ReverbStd: silent through pre-delay and the first comb, then a 1.88 s decay', () => {
    const ir = reverbImpulse();
    // 5 ms aux frame + 63-sample pre-delay ring + 1789-sample comb before the first output.
    const onset = AX_FRAME + 63 + 0x6fd;
    expect(ir.subarray(0, onset).every((v) => v === 0)).toBe(true);
    expect(ir[onset]).toBeCloseTo(0.6 * 0.5 * 0.3 * 0.5, 6);
    const energy = (from: number) => { let sum = 0; for (let i = Math.round(from * AX_RATE); i < Math.round((from + 0.1) * AX_RATE); i++) sum += ir[i]! ** 2; return sum; };
    const drop = 10 * Math.log10(energy(0.2) / energy(1.14));
    expect(drop).toBeGreaterThan(60 * 0.94 / 1.88 - 6); expect(drop).toBeLessThan(60 * 0.94 / 1.88 + 6);
  });
  it('resamples an impulse response without changing its gain', () => {
    const input = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(Math.PI * i / 1999) ** 2);
    const sum = (values: Float32Array) => values.reduce((total, v) => total + v, 0);
    for (const rate of [44100, 48000]) expect(sum(resampleImpulse(input, AX_RATE, rate)) / sum(input)).toBeCloseTo(1, 3);
    expect(resampleImpulse(input, AX_RATE, AX_RATE)).toEqual(input);
  });
  it('reads the SEM aux-A send (ops 16/17) and its x26 scale (op 20) into each cue', () => {
    const words = [0x01000064, 0x10000014, 0x110000fb, 0x14000080, 0x060000ff, 0x0e000000];
    const bytes = new Uint8Array(24 + words.length * 4), view = new DataView(bytes.buffer);
    view.setUint32(8, 1); view.setUint32(16, 1); view.setUint32(20, 24);
    words.forEach((word, i) => view.setUint32(24 + i * 4, word));
    expect(new SemTable(bytes).cues(0)).toEqual([{ sample: 100, delay: 0, gain: 1, pitch: 1, auxA: 128 * 15 / 65535 }]);
  });
});
