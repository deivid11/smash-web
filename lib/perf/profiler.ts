/** Span profiler shared by the simulation, rollback and presentation layers.
 *
 * Timing only: nothing here feeds back into gameplay, so determinism, snapshots
 * and rollback hashes are untouched. Disabled calls are a single branch; enabled
 * calls cost one clock read each. Spans accumulate into per-frame totals that the
 * frame owner (web/src/perf/telemetry.ts) drains once per RAF, so work done
 * outside the RAF (network rollback in socket handlers) lands in the next frame.
 *
 * Span names are dotted paths; the report nests a span under the longest
 * registered prefix listed in SPAN_PARENTS. Re-entering an id that is already
 * open is ignored (the outer measurement wins). */

export const MAX_SPANS = 64;

export class SpanProfiler {
  enabled = false;
  readonly names: string[] = [];
  private readonly ids = new Map<string, number>();
  private readonly starts = new Float64Array(MAX_SPANS).fill(-1);
  readonly totals = new Float64Array(MAX_SPANS);
  readonly counts = new Uint32Array(MAX_SPANS);

  constructor(private readonly clock: () => number = () => performance.now()) {}

  /** Registers (or looks up) a span id. Call once at module load, never per frame. */
  span(name: string): number {
    const existing = this.ids.get(name);
    if (existing !== undefined) return existing;
    if (this.names.length >= MAX_SPANS) throw new Error(`Span profiler is limited to ${MAX_SPANS} spans.`);
    const id = this.names.length;
    this.names.push(name); this.ids.set(name, id);
    return id;
  }

  begin(id: number): void {
    if (!this.enabled || this.starts[id]! >= 0) return;
    this.starts[id] = this.clock();
  }

  end(id: number): void {
    if (!this.enabled) return;
    const start = this.starts[id]!;
    if (start < 0) return;
    this.totals[id]! += this.clock() - start;
    this.counts[id]!++;
    this.starts[id] = -1;
  }

  /** Adds an externally measured duration (ms). */
  add(id: number, ms: number): void {
    if (!this.enabled || !(ms >= 0)) return;
    this.totals[id]! += ms;
    this.counts[id]!++;
  }

  /** Copies this frame's totals/counts out and zeroes them. Also closes spans left
   * open by an exception so a stale start can never inflate a later frame. */
  drain(totals: Float32Array | Float64Array, counts: Uint16Array | Uint32Array): void {
    const n = this.names.length;
    for (let id = 0; id < n; id++) {
      totals[id] = this.totals[id]!; counts[id] = this.counts[id]!;
      this.totals[id] = 0; this.counts[id] = 0; this.starts[id] = -1;
    }
  }

  reset(): void {
    this.totals.fill(0); this.counts.fill(0); this.starts.fill(-1);
  }
}

export const profiler = new SpanProfiler();

/** Parent of each span family, used by reports to nest and compute self time.
 * `frame.*` spans are the top level of one RAF tick; `net.receive` runs outside
 * the tick (socket messages) and is attributed to the following frame. Rollback
 * spans (`net.*`) are cross-cutting: they run under frame.sim when predicting and
 * under net.receive when resimulating, so they have no single parent. */
export const SPAN_PARENTS: Readonly<Record<string, string>> = {
  'sim.': 'frame.sim',
  'net.': '',
  /** Pose evaluation (update) and skin palette prep (prepare): shared by sim and render samples. */
  'pose.': '',
  /** React HUD render+commit, flushed in a microtask after frame.hud. */
  'hud.': '',
  'step.': 'sim.step',
  'render.': 'frame.render',
  'render.shadows': 'render.draw',
  'frame.': '',
};

export function spanParent(name: string): string {
  let best = '', bestLength = -1;
  for (const [prefix, parent] of Object.entries(SPAN_PARENTS)) {
    const matches = prefix.endsWith('.') ? name.startsWith(prefix) : name === prefix;
    if (matches && prefix.length > bestLength) { best = parent; bestLength = prefix.length; }
  }
  return best;
}
