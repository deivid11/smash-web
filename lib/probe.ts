export interface RngProbe {
  probe_set_seed(seed: number): void;
  probe_get_seed(): number;
  HSD_Rand(): number;
  HSD_Randf(): number;
}

export function rngProbe(instance: WebAssembly.Instance): RngProbe {
  for (const name of ['probe_set_seed', 'probe_get_seed', 'HSD_Rand', 'HSD_Randf']) {
    if (typeof instance.exports[name] !== 'function') throw new Error(`Missing WASM export: ${name}`);
  }
  return instance.exports as unknown as RngProbe;
}

export function checkRngReplay(probe: RngProbe, seed: number, count = 12): { values: number[]; restored: boolean; state: number } {
  probe.probe_set_seed(seed >>> 0);
  const saved = probe.probe_get_seed();
  const values = Array.from({ length: count }, () => probe.HSD_Rand());
  const state = probe.probe_get_seed() >>> 0;
  probe.probe_set_seed(saved);
  const repeated = Array.from({ length: count }, () => probe.HSD_Rand());
  return { values, state, restored: values.every((value, index) => value === repeated[index]) };
}
