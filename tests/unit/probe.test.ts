import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkRngReplay, rngProbe, type RngProbe } from '../../lib/probe.ts';

let probe: RngProbe;
let module: WebAssembly.Module;
const binary = readFileSync(new URL('../../web/public/wasm/melee-probe.wasm', import.meta.url));
beforeAll(async () => {
  module = await WebAssembly.compile(binary);
  probe = rngProbe(await WebAssembly.instantiate(module, {}));
});

describe('original Melee RNG compiled to WASM', () => {
  it('has no host imports, GPU, or browser dependencies', () => {
    expect(WebAssembly.Module.imports(module)).toEqual([]);
  });
  it.each([0, 1, 0x12345678, 0x80000000, 0xffffffff])('matches unsigned 32-bit arithmetic for seed %s', (seed) => {
    probe.probe_set_seed(seed);
    let state = BigInt(seed);
    for (let index = 0; index < 10_000; index++) {
      state = (state * 214013n + 2531011n) & 0xffffffffn;
      expect(probe.HSD_Rand()).toBe(Number(state >> 16n));
      expect(probe.probe_get_seed() >>> 0).toBe(Number(state));
    }
  });
  it('returns the original binary-fraction float result', () => {
    probe.probe_set_seed(0xffffffff);
    const state = (0xffffffffn * 214013n + 2531011n) & 0xffffffffn;
    expect(probe.HSD_Randf()).toBe(Number(state >> 16n) / 65536);
  });
  it('replays the same RNG sequence after restoring a seed', () => {
    const result = checkRngReplay(probe, 0x12345678, 120);
    expect(result.restored).toBe(true);
    expect(result.values).toHaveLength(120);
    expect(probe.probe_get_seed() >>> 0).toBe(result.state);
  });
  it('keeps WASM module instances isolated', async () => {
    const other = rngProbe(await WebAssembly.instantiate(module, {}));
    other.probe_set_seed(200);
    probe.probe_set_seed(100);
    probe.HSD_Rand();
    expect(other.probe_get_seed()).toBe(200);
  });
  it('records correct binary and untouched source hashes', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../web/public/wasm/probe.build.json', import.meta.url), 'utf8'));
    const source = readFileSync(new URL('../../third_party/melee/src/sysdolphin/baselib/random.c', import.meta.url));
    expect(manifest.wasmSha256).toBe(createHash('sha256').update(binary).digest('hex'));
    expect(manifest.upstreamSourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(manifest.wasmBytes).toBe(binary.length);
  });
});
