/** Frame-time telemetry + render-skip state machine (Phase 1).
 * Simulation stays on a fixed 60 Hz accumulator; this module only decides when
 * presentation may skip a render so an overloaded device gets dropped frames,
 * never slow motion. All stepping helpers are pure for unit tests. */

export interface SkipState {
  /** 0 = every RAF renders, 1 = every 2nd RAF, 2 = every 3rd RAF. */
  level: 0 | 1 | 2;
  saturatedStreak: number;
  recoverStreak: number;
  /** Counts every RAF so shouldRender stays deterministic. */
  frame: number;
}

export const SKIP_SATURATE_FRAMES = 5;
// Recover quickly: every skipped level adds up to a rendered frame (~16-33 ms) of purely
// visual latency, so a machine that has caught up should return to full rate fast.
export const SKIP_RECOVER_FRAMES = 12;

export function initialSkipState(): SkipState {
  return { level: 0, saturatedStreak: 0, recoverStreak: 0, frame: 0 };
}

/** Advance the skip level. `saturated` means the accumulator could not catch up
 * this RAF (steps hit the cap with time still owed). Hysteretic: several
 * saturated frames step down, many clean frames step back up. */
export function updateSkipState(state: SkipState, saturated: boolean): SkipState {
  let { level, saturatedStreak, recoverStreak } = state;
  const frame = state.frame + 1;
  if (saturated) {
    saturatedStreak++;
    recoverStreak = 0;
    if (saturatedStreak >= SKIP_SATURATE_FRAMES && level < 2) {
      level = ((level + 1) as 0 | 1 | 2);
      saturatedStreak = 0;
    }
  } else {
    recoverStreak++;
    saturatedStreak = 0;
    if (recoverStreak >= SKIP_RECOVER_FRAMES && level > 0) {
      level = ((level - 1) as 0 | 1 | 2);
      recoverStreak = 0;
    }
  }
  return { level, saturatedStreak, recoverStreak, frame };
}

/** Whether the current RAF (after updateSkipState) should present. */
export function shouldRender(state: SkipState): boolean {
  if (state.level === 0) return true;
  if (state.level === 1) return state.frame % 2 === 0;
  return state.frame % 3 === 0;
}

export interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  avgSimMs: number;
  avgRenderMs: number;
  saturatedStreak: number;
  skipLevel: 0 | 1 | 2;
}

/** Rolling ~120 RAF window of frame deltas plus a sim-vs-render cost split. */
export class FrameMonitor {
  private deltas: number[] = [];
  private simMs = 0;
  private renderMs = 0;
  private samples = 0;
  private simStart = 0;
  private renderStart = 0;
  skip: SkipState = initialSkipState();

  constructor(private readonly windowSize = 120) {}

  get frames(): number {
    return this.deltas.length;
  }

  beginFrame(): void {
    this.simStart = performance.now();
  }

  endSim(): void {
    this.simMs += performance.now() - this.simStart;
    this.renderStart = performance.now();
  }

  endRender(): void {
    this.renderMs += performance.now() - this.renderStart;
    this.samples++;
  }

  /** Record one RAF delta (ms) and the saturated flag for this frame. */
  pushDelta(deltaMs: number, saturated: boolean): void {
    if (Number.isFinite(deltaMs) && deltaMs >= 0 && deltaMs < 1000) {
      this.deltas.push(deltaMs);
      if (this.deltas.length > this.windowSize) this.deltas.shift();
    }
    this.skip = updateSkipState(this.skip, saturated);
  }

  private percentile(sorted: number[], q: number): number {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  }

  stats(): FrameStats {
    const sorted = [...this.deltas].sort((a, b) => a - b);
    return {
      frames: this.deltas.length,
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      avgSimMs: this.samples ? this.simMs / this.samples : 0,
      avgRenderMs: this.samples ? this.renderMs / this.samples : 0,
      saturatedStreak: this.skip.saturatedStreak,
      skipLevel: this.skip.level,
    };
  }

  reset(): void {
    this.deltas = [];
    this.simMs = 0;
    this.renderMs = 0;
    this.samples = 0;
    this.skip = initialSkipState();
  }
}
