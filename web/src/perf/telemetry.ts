/** In-match performance telemetry: per-RAF span breakdown aggregated into short
 * windows, uploaded in small batches to the game server (POST /api/perf) so
 * real-device bottlenecks can be analysed offline with scripts/perf-report.ts.
 *
 * Cost model: the span profiler is two clock reads per span; everything else
 * runs once per window (5 s). Nothing here reads or writes simulation state, so
 * gameplay, snapshots and rollback hashes are unaffected.
 *
 * Opt-in: nothing is collected until a client asks for it. Modes come from the
 * `?perf=` query and persist in localStorage (`smash-perf-telemetry`):
 *   on    collect and upload
 *   local collect only (benchmarks, devtools via window.smashPerf)
 *   off   (default) no collection at all */
import { MAX_SPANS, profiler } from '../../../lib/perf/profiler.ts';
import { GpuTimer } from './gpu-timer.ts';
import { collectDeviceInfo, refineDeviceModel, type PerfDeviceInfo } from './device-info.ts';

export const PERF_ENDPOINT = '/api/perf';
export const PERF_SCHEMA = 1;
export type PerfMode = 'on' | 'local' | 'off';

const STORAGE_KEY = 'smash-perf-telemetry';
const WINDOW_MS = 5000;
const MAX_WINDOW_FRAMES = 1500;
const UPLOAD_EVERY_MS = 30_000;
const MAX_PENDING_WINDOWS = 72;
const MAX_KEPT_REPORTS = 6;
/** Upper bounds (ms) of the frame-delta histogram; one extra bucket holds the rest. */
export const DELTA_BUCKETS = [8.5, 12, 17.5, 25, 34, 50, 100] as const;
/** Match-level histograms: 0.25 ms bins up to 100 ms plus an overflow bin. */
const FINE_BIN_MS = 0.25, FINE_BINS = 400;

export function loadPerfMode(): PerfMode {
  let mode: string | null = null;
  try {
    const query = new URLSearchParams(location.search).get('perf');
    if (query === 'on' || query === 'local' || query === 'off') { mode = query; localStorage.setItem(STORAGE_KEY, query); }
    else mode = localStorage.getItem(STORAGE_KEY);
  } catch { /* storage blocked: stays off */ }
  return mode === 'on' || mode === 'local' ? mode : 'off';
}

export interface PerfMatchContext {
  mode: string;
  online: boolean;
  players: number;
  humans: number;
  cpus: number;
  fighters: string[];
  cpuLevels: number[];
  stage: string;
  rules: string[];
  quality: string;
  graphicsMode: string;
  pixelRatio: number;
  canvas: [number, number];
  buffer: [number, number];
  smoothMotion: boolean;
  shadows: boolean;
  richLight: boolean;
}

export interface PerfFrame {
  /** RAF timestamp. */
  now: number;
  /** Time since the previous RAF (ms). */
  delta: number;
  /** JS time spent inside this RAF callback (ms). */
  work: number;
  steps: number;
  rendered: boolean;
  saturated: boolean;
  paused: boolean;
  skipLevel: 0 | 1 | 2;
}

export interface PerfScene {
  calls: number;
  triangles: number;
  particles: number;
  projectiles: number;
  items: number;
  alive: number;
}

interface Stat { mean: number; p50: number; p95: number; p99: number; max: number }
export interface PerfSpanStat { mean: number; p95: number; max: number; calls: number; frames: number }
export interface PerfLoaf { t: number; duration: number; blocking: number; render: number; style: number; scripts: Array<{ fn: string; src: string; invoker: string; duration: number; forced: number }> }
export interface PerfWorstFrame { t: number; delta: number; work: number; browser: number | null; steps: number; spans: Record<string, number> }

export interface PerfWindow {
  seq: number;
  /** Window start, ms since the match report began. */
  t: number;
  wall: number;
  frames: number;
  pausedFrames: number;
  stalls: number;
  rendered: number;
  steps: number;
  saturated: number;
  skip: [number, number, number];
  delta: Stat;
  hist: number[];
  work: Stat;
  browser: Stat | null;
  gpu: (Stat & { n: number }) | null;
  spans: Record<string, PerfSpanStat>;
  worst: PerfWorstFrame[];
  scene: { callsMean: number; callsMax: number; trianglesMean: number; trianglesMax: number; particlesMax: number; projectilesMax: number; itemsMax: number; aliveMin: number; aliveMax: number; draws: Record<string, number> | null };
  heap: { usedMb: number; totalMb: number; limitMb: number } | null;
  net: { rollbacks: number; resimulated: number; prediction: number; latencyMs: number | null } | null;
  loaf: PerfLoaf[];
  quality: string;
  pixelRatio: number;
}

export interface PerfSummary {
  frames: number;
  seconds: number;
  fps: number;
  delta: Stat;
  work: Stat;
  browser: Stat | null;
  gpu: Stat | null;
  hist: number[];
  steps: number;
  saturated: number;
  spans: Record<string, { mean: number; max: number }>;
}

export interface PerfMatchReport {
  id: string;
  startedAt: string;
  context: PerfMatchContext;
  windows: PerfWindow[];
  events: Array<{ t: number; type: string; detail: string }>;
  summary: PerfSummary | null;
  endReason: string | null;
}

export interface PerfUpload {
  v: typeof PERF_SCHEMA;
  kind: 'smash-perf';
  session: { id: string; startedAt: string };
  device: PerfDeviceInfo | null;
  match: { id: string; startedAt: string; context: PerfMatchContext };
  part: number;
  windows: PerfWindow[];
  events: PerfMatchReport['events'];
  summary: PerfSummary | null;
  endReason: string | null;
}

function randomId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}
const round = (value: number, digits = 2): number => { const scale = 10 ** digits; return Math.round(value * scale) / scale; };

/** Percentile stats of the first `n` values (sorts the scratch copy in place). */
function stat(values: Float32Array, n: number, scratch: Float32Array): Stat {
  if (n <= 0) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = values[i]!; scratch[i] = v; sum += v; }
  const sorted = scratch.subarray(0, n).sort();
  const at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))]!;
  return { mean: round(sum / n), p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted[n - 1]!) };
}

class FineHistogram {
  readonly bins = new Uint32Array(FINE_BINS + 1);
  count = 0; sum = 0; max = 0;
  push(ms: number): void {
    if (!(ms >= 0)) return;
    this.bins[Math.min(FINE_BINS, Math.floor(ms / FINE_BIN_MS))]!++;
    this.count++; this.sum += ms; if (ms > this.max) this.max = ms;
  }
  stat(): Stat {
    if (!this.count) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const at = (q: number) => {
      const target = q * this.count; let seen = 0;
      for (let bin = 0; bin <= FINE_BINS; bin++) { seen += this.bins[bin]!; if (seen > target) return bin === FINE_BINS ? this.max : (bin + 0.5) * FINE_BIN_MS; }
      return this.max;
    };
    return { mean: round(this.sum / this.count), p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(this.max) };
  }
}

interface MatchAccumulator {
  report: PerfMatchReport;
  startedAt: number;
  delta: FineHistogram; work: FineHistogram; browser: FineHistogram; gpu: FineHistogram;
  hist: number[];
  frames: number; steps: number; saturated: number;
  spanSums: Float64Array; spanMax: Float32Array;
  uploadedWindows: number; uploadedEvents: number; part: number; lastUpload: number;
  lastQuality: string; lastPixelRatio: number;
  netBase: { rollbacks: number; resimulated: number } | null;
}

export class PerfTelemetry {
  readonly mode: PerfMode;
  readonly sessionId = randomId();
  readonly sessionStartedAt = new Date().toISOString();
  device: PerfDeviceInfo | null = null;
  gpu: GpuTimer | null = null;
  /** Visible draw objects by owner, sampled once per window (scene walk). */
  drawProbe: (() => Record<string, number>) | null = null;
  /** Completed and in-progress reports kept in memory for window.smashPerf. */
  readonly reports: PerfMatchReport[] = [];
  uploads = { sent: 0, failed: 0, bytes: 0, disabled: false, lastStatus: 0 };

  private current: MatchAccumulator | null = null;
  private currentKey: unknown = null;
  // Window buffers (reused).
  private readonly deltas = new Float32Array(MAX_WINDOW_FRAMES);
  private readonly works = new Float32Array(MAX_WINDOW_FRAMES);
  private readonly browsers = new Float32Array(MAX_WINDOW_FRAMES);
  private readonly stepsPerFrame = new Uint8Array(MAX_WINDOW_FRAMES);
  private readonly times = new Float32Array(MAX_WINDOW_FRAMES);
  private readonly spanRows = new Float32Array(MAX_WINDOW_FRAMES * MAX_SPANS);
  private readonly callRows = new Uint16Array(MAX_WINDOW_FRAMES * MAX_SPANS);
  private readonly frameTotals = new Float32Array(MAX_SPANS);
  private readonly frameCounts = new Uint16Array(MAX_SPANS);
  private readonly scratch = new Float32Array(MAX_WINDOW_FRAMES);
  private readonly gpuSamples = new Float32Array(256);
  private gpuCount = 0;
  private n = 0;
  private windowStart = 0;
  private windowGeneration = 0;
  private pausedFrames = 0; private stalls = 0; private rendered = 0; private saturated = 0; private steps = 0;
  private skip: [number, number, number] = [0, 0, 0];
  private scene = { callsSum: 0, callsMax: 0, trianglesSum: 0, trianglesMax: 0, particlesMax: 0, projectilesMax: 0, itemsMax: 0, aliveMin: Infinity, aliveMax: 0 };
  private seq = 0;
  private loafs: PerfLoaf[] = [];
  private loafObserver: PerformanceObserver | null = null;
  private readonly channel: MessageChannel | null;
  private pendingPost = { generation: -1, row: -1, tickEnd: 0 };

  constructor(mode: PerfMode = loadPerfMode()) {
    this.mode = mode;
    profiler.enabled = mode !== 'off';
    this.channel = mode !== 'off' && typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
    if (this.channel) this.channel.port1.onmessage = () => this.afterFrame();
    if (mode !== 'off') this.observeLongFrames();
    if (mode === 'on' && typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get enabled(): boolean { return this.mode !== 'off'; }

  attachRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
    if (!this.enabled || this.device) return;
    if (gl) this.gpu = new GpuTimer(gl);
    this.device = collectDeviceInfo(gl, !!this.gpu?.supported);
    void refineDeviceModel(this.device);
  }

  /** Whether a match (identified by `key`) is currently being recorded. */
  recording(key: unknown): boolean { return this.current !== null && this.currentKey === key; }

  beginMatch(key: unknown, context: PerfMatchContext): void {
    if (!this.enabled) return;
    if (this.current) this.endMatch('replaced');
    const report: PerfMatchReport = { id: randomId(), startedAt: new Date().toISOString(), context, windows: [], events: [], summary: null, endReason: null };
    this.current = {
      report, startedAt: performance.now(),
      delta: new FineHistogram(), work: new FineHistogram(), browser: new FineHistogram(), gpu: new FineHistogram(),
      hist: new Array(DELTA_BUCKETS.length + 1).fill(0), frames: 0, steps: 0, saturated: 0,
      spanSums: new Float64Array(MAX_SPANS), spanMax: new Float32Array(MAX_SPANS),
      uploadedWindows: 0, uploadedEvents: 0, part: 0, lastUpload: performance.now(),
      lastQuality: context.quality, lastPixelRatio: context.pixelRatio, netBase: null,
    };
    this.currentKey = key;
    this.reports.push(report);
    while (this.reports.length > MAX_KEPT_REPORTS) this.reports.shift();
    this.resetWindow(performance.now());
    profiler.reset();
  }

  endMatch(reason: string): void {
    const current = this.current;
    if (!current) return;
    this.closeWindow(performance.now());
    current.report.summary = this.summary(current);
    current.report.endReason = reason;
    this.current = null; this.currentKey = null;
    this.upload(current, true, reason === 'unload');
  }

  event(type: string, detail = ''): void {
    const current = this.current;
    if (!current || current.report.events.length >= 200) return;
    current.report.events.push({ t: Math.round(performance.now() - current.startedAt), type, detail: detail.slice(0, 160) });
  }

  /** Record one RAF. Call after the tick's work, with the profiler spans still pending. */
  frame(sample: PerfFrame, scene: PerfScene | null, live: { quality: string; pixelRatio: number }): void {
    const current = this.current;
    if (!current) { profiler.drain(this.frameTotals, this.frameCounts); return; }
    this.gpu?.poll(this.onGpu);
    if (this.n >= MAX_WINDOW_FRAMES || sample.now - this.windowStart >= WINDOW_MS) this.closeWindow(sample.now);
    profiler.drain(this.frameTotals, this.frameCounts);
    if (live.quality !== current.lastQuality || live.pixelRatio !== current.lastPixelRatio) {
      this.event('quality', `${current.lastQuality}@${current.lastPixelRatio} -> ${live.quality}@${round(live.pixelRatio)}`);
      current.lastQuality = live.quality; current.lastPixelRatio = live.pixelRatio;
    }
    if (sample.paused) { this.pausedFrames++; return; }
    if (!(sample.delta < 1000)) { this.stalls++; return; }
    const row = this.n++;
    this.deltas[row] = sample.delta; this.works[row] = sample.work; this.browsers[row] = NaN; this.times[row] = sample.now - current.startedAt;
    this.stepsPerFrame[row] = Math.min(255, sample.steps);
    const base = row * MAX_SPANS, spans = profiler.names.length;
    for (let id = 0; id < spans; id++) {
      const ms = this.frameTotals[id]!;
      this.spanRows[base + id] = ms; this.callRows[base + id] = this.frameCounts[id]!;
      current.spanSums[id]! += ms;
      if (ms > current.spanMax[id]!) current.spanMax[id] = ms;
    }
    if (sample.rendered) this.rendered++;
    if (sample.saturated) this.saturated++;
    this.steps += sample.steps;
    this.skip[sample.skipLevel]!++;
    if (scene) {
      const s = this.scene;
      if (sample.rendered) { s.callsSum += scene.calls; s.trianglesSum += scene.triangles; if (scene.calls > s.callsMax) s.callsMax = scene.calls; if (scene.triangles > s.trianglesMax) s.trianglesMax = scene.triangles; }
      if (scene.particles > s.particlesMax) s.particlesMax = scene.particles;
      if (scene.projectiles > s.projectilesMax) s.projectilesMax = scene.projectiles;
      if (scene.items > s.itemsMax) s.itemsMax = scene.items;
      if (scene.alive < s.aliveMin) s.aliveMin = scene.alive;
      if (scene.alive > s.aliveMax) s.aliveMax = scene.alive;
    }
    current.frames++; current.steps += sample.steps; if (sample.saturated) current.saturated++;
    current.delta.push(sample.delta); current.work.push(sample.work);
    let bucket = 0; while (bucket < DELTA_BUCKETS.length && sample.delta > DELTA_BUCKETS[bucket]!) bucket++;
    current.hist[bucket]!++;
    // Browser rendering (style/layout/paint/commit, including GPU backpressure)
    // runs after the RAF callbacks; a posted message lands once it is done.
    if (this.channel) { const post = this.pendingPost; post.generation = this.windowGeneration; post.row = row; post.tickEnd = performance.now(); this.channel.port2.postMessage(0); }
  }

  private readonly onGpu = (ms: number): void => {
    if (!this.current) return;
    if (this.gpuCount < this.gpuSamples.length) this.gpuSamples[this.gpuCount++] = ms;
    this.current.gpu.push(ms);
  };

  private afterFrame(): void {
    const pending = this.pendingPost;
    if (pending.generation !== this.windowGeneration || pending.row < 0 || !this.current) return;
    const ms = performance.now() - pending.tickEnd;
    this.browsers[pending.row] = ms; this.current.browser.push(ms);
    pending.row = -1;
  }

  private resetWindow(now: number): void {
    this.n = 0; this.windowStart = now; this.windowGeneration++;
    this.pausedFrames = 0; this.stalls = 0; this.rendered = 0; this.saturated = 0; this.steps = 0; this.skip = [0, 0, 0];
    this.scene = { callsSum: 0, callsMax: 0, trianglesSum: 0, trianglesMax: 0, particlesMax: 0, projectilesMax: 0, itemsMax: 0, aliveMin: Infinity, aliveMax: 0 };
    this.gpuCount = 0; this.loafs = [];
  }

  private closeWindow(now: number): void {
    const current = this.current;
    if (!current) return;
    const n = this.n;
    if (n > 0 || this.pausedFrames > 0) {
      const names = profiler.names, spans: Record<string, PerfSpanStat> = {};
      for (let id = 0; id < names.length; id++) {
        let sum = 0, calls = 0, frames = 0;
        for (let row = 0; row < n; row++) {
          const ms = this.spanRows[row * MAX_SPANS + id]!;
          this.scratch[row] = ms; sum += ms; calls += this.callRows[row * MAX_SPANS + id]!;
          if (this.callRows[row * MAX_SPANS + id]! > 0) frames++;
        }
        if (!calls) continue;
        const sorted = this.scratch.subarray(0, n).sort();
        spans[names[id]!] = { mean: round(sum / n, 3), p95: round(sorted[Math.min(n - 1, Math.floor(0.95 * n))]!, 3), max: round(sorted[n - 1]!, 3), calls: round(calls / n, 2), frames };
      }
      // Browser time is only known for frames whose follow-up message arrived.
      let browserCount = 0;
      const browserValues = new Float32Array(n);
      for (let row = 0; row < n; row++) if (!Number.isNaN(this.browsers[row]!)) browserValues[browserCount++] = this.browsers[row]!;
      const worst = this.worstFrames(n);
      const s = this.scene;
      const heapInfo = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      const record: PerfWindow = {
        seq: this.seq++,
        t: Math.round(this.windowStart - current.startedAt), wall: Math.round(now - this.windowStart),
        frames: n, pausedFrames: this.pausedFrames, stalls: this.stalls, rendered: this.rendered, steps: this.steps, saturated: this.saturated, skip: this.skip,
        delta: stat(this.deltas, n, this.scratch),
        hist: this.windowHistogram(n),
        work: stat(this.works, n, this.scratch),
        browser: browserCount ? stat(browserValues, browserCount, this.scratch) : null,
        gpu: this.gpuCount ? { ...stat(this.gpuSamples, this.gpuCount, this.scratch), n: this.gpuCount } : null,
        spans, worst,
        scene: { callsMean: this.rendered ? Math.round(s.callsSum / this.rendered) : 0, callsMax: s.callsMax, trianglesMean: this.rendered ? Math.round(s.trianglesSum / this.rendered) : 0, trianglesMax: s.trianglesMax, particlesMax: s.particlesMax, projectilesMax: s.projectilesMax, itemsMax: s.itemsMax, aliveMin: Number.isFinite(s.aliveMin) ? s.aliveMin : 0, aliveMax: s.aliveMax, draws: this.probeDraws() },
        heap: heapInfo ? { usedMb: round(heapInfo.usedJSHeapSize / 1048576, 1), totalMb: round(heapInfo.totalJSHeapSize / 1048576, 1), limitMb: round(heapInfo.jsHeapSizeLimit / 1048576, 0) } : null,
        net: this.netSample(current),
        loaf: this.loafs.sort((a, b) => b.duration - a.duration).slice(0, 6),
        quality: current.lastQuality, pixelRatio: round(current.lastPixelRatio),
      };
      current.report.windows.push(record);
      if (current.report.windows.length > 2000) current.report.windows.splice(0, current.report.windows.length - 2000);
    }
    this.resetWindow(now);
    if (this.mode === 'on' && now - current.lastUpload >= UPLOAD_EVERY_MS) this.upload(current, false, false);
  }

  private probeDraws(): Record<string, number> | null {
    try { return this.drawProbe?.() ?? null; } catch { return null; }
  }

  private windowHistogram(n: number): number[] {
    const hist = new Array<number>(DELTA_BUCKETS.length + 1).fill(0);
    for (let row = 0; row < n; row++) {
      const delta = this.deltas[row]!;
      let bucket = 0; while (bucket < DELTA_BUCKETS.length && delta > DELTA_BUCKETS[bucket]!) bucket++;
      hist[bucket]!++;
    }
    return hist;
  }

  private worstFrames(n: number): PerfWorstFrame[] {
    const picks: number[] = [];
    for (let row = 0; row < n; row++) {
      if (picks.length < 3) { picks.push(row); picks.sort((a, b) => this.deltas[b]! - this.deltas[a]!); }
      else if (this.deltas[row]! > this.deltas[picks[2]!]!) { picks[2] = row; picks.sort((a, b) => this.deltas[b]! - this.deltas[a]!); }
    }
    const names = profiler.names;
    return picks.map(row => {
      const spans: Record<string, number> = {};
      for (let id = 0; id < names.length; id++) { const ms = this.spanRows[row * MAX_SPANS + id]!; if (ms >= 0.05) spans[names[id]!] = round(ms); }
      const browser = this.browsers[row]!;
      return { t: Math.round(this.times[row]!), delta: round(this.deltas[row]!), work: round(this.works[row]!), browser: Number.isNaN(browser) ? null : round(browser), steps: this.stepsPerFrame[row]!, spans };
    });
  }

  private netSample(current: MatchAccumulator): PerfWindow['net'] {
    if (!current.report.context.online) return null;
    try {
      const snapshot = window.smashNetworkSnapshot?.();
      if (!snapshot) return null;
      const base = current.netBase ?? { rollbacks: 0, resimulated: 0 };
      current.netBase = { rollbacks: snapshot.rollbacks, resimulated: snapshot.resimulatedFrames };
      return { rollbacks: Math.max(0, snapshot.rollbacks - base.rollbacks), resimulated: Math.max(0, snapshot.resimulatedFrames - base.resimulated), prediction: snapshot.predictionFrames, latencyMs: snapshot.latencyMs };
    } catch { return null; }
  }

  private summary(current: MatchAccumulator): PerfSummary {
    const seconds = (performance.now() - current.startedAt) / 1000;
    const names = profiler.names, spans: PerfSummary['spans'] = {};
    for (let id = 0; id < names.length; id++) {
      if (current.spanSums[id]! <= 0) continue;
      spans[names[id]!] = { mean: round(current.spanSums[id]! / Math.max(1, current.frames), 3), max: round(current.spanMax[id]!, 2) };
    }
    const delta = current.delta.stat();
    return {
      frames: current.frames, seconds: round(seconds, 1), fps: delta.mean > 0 ? round(1000 / delta.mean, 1) : 0,
      delta, work: current.work.stat(), browser: current.browser.count ? current.browser.stat() : null, gpu: current.gpu.count ? current.gpu.stat() : null,
      hist: [...current.hist], steps: current.steps, saturated: current.saturated, spans,
    };
  }

  private upload(current: MatchAccumulator, final: boolean, beacon: boolean): void {
    if (this.mode !== 'on' || this.uploads.disabled) return;
    const report = current.report;
    const windows = report.windows.slice(current.uploadedWindows);
    const events = report.events.slice(current.uploadedEvents);
    if (!windows.length && !events.length && !final) return;
    const payload: PerfUpload = {
      v: PERF_SCHEMA, kind: 'smash-perf',
      session: { id: this.sessionId, startedAt: this.sessionStartedAt },
      device: this.device,
      match: { id: report.id, startedAt: report.startedAt, context: report.context },
      part: current.part,
      windows: windows.slice(-MAX_PENDING_WINDOWS), events,
      summary: final ? report.summary : null, endReason: final ? report.endReason : null,
    };
    let body = JSON.stringify(payload);
    if (body.length > 240_000) { for (const record of payload.windows) { record.loaf = []; record.worst = record.worst.slice(0, 1); } body = JSON.stringify(payload); }
    current.uploadedWindows = report.windows.length; current.uploadedEvents = report.events.length; current.part++; current.lastUpload = performance.now();
    this.uploads.bytes += body.length;
    if (beacon && typeof navigator.sendBeacon === 'function' && body.length < 60_000) {
      const queued = navigator.sendBeacon(PERF_ENDPOINT, new Blob([body], { type: 'application/json' }));
      if (queued) this.uploads.sent++; else this.uploads.failed++;
      return;
    }
    void fetch(PERF_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60_000, cache: 'no-store' })
      .then(response => {
        this.uploads.lastStatus = response.status;
        if (response.ok) this.uploads.sent++;
        else { this.uploads.failed++; if (response.status === 404 || response.status === 405 || response.status === 503) this.uploads.disabled = true; }
      })
      .catch(() => { this.uploads.failed++; });
  }

  private observeLongFrames(): void {
    try {
      if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) return;
      this.loafObserver = new PerformanceObserver(list => {
        const current = this.current;
        if (!current) return;
        for (const raw of list.getEntries()) {
          const entry = raw as PerformanceEntry & { blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number; scripts?: Array<{ invoker?: string; sourceURL?: string; sourceFunctionName?: string; duration: number; forcedStyleAndLayoutDuration?: number }> };
          if (this.loafs.length >= 24) this.loafs.sort((a, b) => b.duration - a.duration).length = 12;
          this.loafs.push({
            t: Math.round(entry.startTime - current.startedAt), duration: round(entry.duration, 1), blocking: round(entry.blockingDuration ?? 0, 1),
            render: entry.renderStart ? round(entry.renderStart - entry.startTime, 1) : 0,
            style: entry.styleAndLayoutStart ? round(entry.startTime + entry.duration - entry.styleAndLayoutStart, 1) : 0,
            scripts: [...(entry.scripts ?? [])].sort((a, b) => b.duration - a.duration).slice(0, 4).map(script => ({
              fn: (script.sourceFunctionName ?? '').slice(0, 80), src: (script.sourceURL ?? '').split('/').pop()?.slice(0, 80) ?? '', invoker: (script.invoker ?? '').slice(0, 80),
              duration: round(script.duration, 1), forced: round(script.forcedStyleAndLayoutDuration ?? 0, 1),
            })),
          });
        }
      });
      this.loafObserver.observe({ type: 'long-animation-frame', buffered: false });
    } catch { this.loafObserver = null; }
  }

  private readonly onPageHide = (): void => { if (this.current) this.endMatch('unload'); };
  private readonly onVisibility = (): void => {
    if (document.visibilityState !== 'hidden' || !this.current) return;
    this.event('hidden');
    this.closeWindow(performance.now());
    this.upload(this.current, false, true);
  };

  /** Plain-data view for devtools and benchmark harnesses. */
  snapshot(): { mode: PerfMode; session: string; device: PerfDeviceInfo | null; uploads: PerfTelemetry['uploads']; recording: boolean; reports: PerfMatchReport[] } {
    const current = this.current;
    const reports = this.reports.map(report => report === current?.report ? { ...report, summary: this.summary(current) } : report);
    return structuredClone({ mode: this.mode, session: this.sessionId, device: this.device, uploads: this.uploads, recording: !!current, reports });
  }

  /** Close the open window now (benchmarks call this before reading a snapshot). */
  cut(): void { if (this.current) this.closeWindow(performance.now()); }

  dispose(): void {
    if (this.current) this.endMatch('dispose');
    this.loafObserver?.disconnect(); this.loafObserver = null;
    if (this.channel) { this.channel.port1.onmessage = null; this.channel.port1.close(); }
    this.gpu?.dispose(); this.gpu = null;
    if (typeof window !== 'undefined') { window.removeEventListener('pagehide', this.onPageHide); document.removeEventListener('visibilitychange', this.onVisibility); }
    profiler.enabled = false;
  }
}

declare global { interface Window { smashPerf?: { snapshot: () => ReturnType<PerfTelemetry['snapshot']>; cut: () => void; end: (reason?: string) => void; mode: PerfMode } } }
