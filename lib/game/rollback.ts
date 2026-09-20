import { LocalMatch, neutralInput, type MatchEvent, type MatchState, type PlayerInput } from './match.ts';
import { profiler } from '../perf/profiler.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from './limits.ts';

/** Rollback cost spans (timing only; see lib/perf/profiler.ts). */
const SPAN_STEP = profiler.span('sim.step'), SPAN_SNAPSHOT = profiler.span('net.snapshot'), SPAN_RESTORE = profiler.span('net.restore'), SPAN_EVENTS = profiler.span('net.events'), SPAN_HASH = profiler.span('net.hash'), SPAN_RESIM = profiler.span('net.resim');

export interface RollbackOptions { historyLimit?: number; maxPrediction?: number; keyframeInterval?: number;
  /** Hash every Nth post-frame state (frame % N === 0) plus the match-ending frame; 1 (default)
   * hashes every frame. Peers only exchange checkpoint hashes, so N must match the checkpoint
   * cadence (ROLLBACK_HASH_INTERVAL online): the full-state hash costs ~3x a simulation step. */
  hashInterval?: number;
  /** Local input delay in frames (0-7, default 0). advance() schedules the polled input for
   * frame + delay, so it reaches the peers before they simulate that frame and they predict
   * (and roll back) far less. Purely local: peers may run different delays. */
  inputDelay?: number }
export interface OutgoingInput { readonly frame: number; readonly input: PlayerInput }
export interface ConfirmedAudio { readonly specialScopes: readonly (number | null)[]; readonly ended: boolean }
export interface ConfirmedEvents { readonly frame: number; readonly events: readonly Readonly<MatchEvent>[]; readonly audio: ConfirmedAudio }
interface FrameRecord {
  /** Pre-frame snapshot on keyframes only; null on predicted frames between
   * keyframes (Phase 4.1). Corrections restore the previous keyframe and
   * resimulate with stored inputs (already retained for prediction). */
  before: MatchState | null;
  inputs: PlayerInput[]; events: MatchEvent[];
  /** Eager post-frame hash (Phase 4.3 live hash, no clone) on checkpoint frames
   * (see RollbackOptions.hashInterval) and the ending frame; null elsewhere. */
  hash: string | null;
  audio: ConfirmedAudio;
}
/** Phase 4.1: snapshot every Nth frame; non-keyframes resimulate from the
 * previous keyframe with stored inputs on correction. */
export const KEYFRAME_INTERVAL = 3;
/** Online checkpoint cadence: peers send and verify post-frame hashes on these frames only. */
export const ROLLBACK_HASH_INTERVAL = 30;
export class RollbackError extends Error { override name = 'RollbackError'; }

/** Canonical wire input: no hidden properties, non-finite axes or coercive booleans.
 * Missing direction deliberately stays absent so stick-based special selection works. */
export function normalizeInput(input: PlayerInput): PlayerInput {
  if (!input || typeof input !== 'object' || !Number.isFinite(input.x) || Math.abs(input.x) > 1 || (input.y !== undefined && (!Number.isFinite(input.y) || Math.abs(input.y) > 1))) throw new RollbackError('Invalid input axes.');
  for (const name of ['cX', 'cY'] as const) if (input[name] !== undefined && (!Number.isFinite(input[name]) || Math.abs(input[name]!) > 1)) throw new RollbackError('Invalid smash-stick axes.');
  for (const name of ['jump', 'attack', 'strong', 'down'] as const) if (typeof input[name] !== 'boolean') throw new RollbackError('Invalid input button.');
  for (const name of ['special', 'shield', 'grab', 'walk'] as const) if (input[name] !== undefined && typeof input[name] !== 'boolean') throw new RollbackError('Invalid optional input button.');
  if (input.specialDirection !== undefined && !['neutral', 'side', 'up', 'down'].includes(input.specialDirection)) throw new RollbackError('Invalid special direction.');
  return { x: input.x || 0, y: input.y || 0, jump: input.jump, attack: input.attack, strong: input.strong, down: input.down,
    special: input.special ?? false, shield: input.shield ?? false, grab: input.grab ?? false, walk: input.walk ?? false,
    // `|| 0` folds -0 like x/y: the binary relay codec cannot carry it and atan2 can tell them apart.
    cX: (Number.isFinite(input.cX) ? input.cX! : 0) || 0, cY: (Number.isFinite(input.cY) ? input.cY! : 0) || 0,
    ...(input.specialDirection === undefined ? {} : {specialDirection: input.specialDirection}) };
}
const equal = (a: PlayerInput, b: PlayerInput) => a.x===b.x&&a.y===b.y&&(a.cX??0)===(b.cX??0)&&(a.cY??0)===(b.cY??0)&&a.jump===b.jump&&a.attack===b.attack&&a.strong===b.strong&&a.down===b.down&&a.special===b.special&&a.shield===b.shield&&a.grab===b.grab&&a.walk===b.walk&&a.specialDirection===b.specialDirection;

/** Bounded rollback for this prototype's deterministic frame-boundary state.
 * Not a competitive/anti-cheat system, original Melee rollback, or a cross-engine
 * floating-point equivalence claim. Own the match exclusively while attached.
 *
 * Frames identify INPUT ticks (0 is the first countdown tick); confirmed hashes
 * describe the state AFTER that tick. Speculative events must never drive audio
 * or permanent statistics: consume drainConfirmedEvents() instead.
 */
export class RollbackDriver {
  readonly historyLimit: number;
  readonly maxPrediction: number;
  readonly keyframeInterval: number;
  private readonly hashInterval: number;
  readonly inputDelay: number;
  /** Local frames scheduled by advance() that the relay has not been handed yet. */
  private outgoing: OutgoingInput[] = [];
  /** Highest local frame supplied by the relay log (preload): those inputs win over the pad. */
  private preloadedThrough = -1;
  confirmedFrame = -1;
  failure: string | null = null;
  private readonly history = new Map<number, FrameRecord>();
  private readonly actual = new Map<number, Array<PlayerInput | undefined>>();
  private readonly cpuSlots: readonly boolean[];
  private readonly pendingHashes = new Map<number, string>();
  private confirmedEvents: ConfirmedEvents[] = [];
  /** Phase 4.2: ring of reusable WASM buffers, one slot per retained frame.
   * Slots recycle modulo historyLimit, slower than the prune window. */
  private readonly wasmPool: (Uint8Array | undefined)[] = [];
  private wasmKeyframeCount = 0;
  private rollbacks = 0;
  private resimulated = 0;
  private highWater = 0; // Highest already-sent timeline, even if a correction ends earlier.

  constructor(readonly match: LocalMatch, readonly localSlot: number, readonly playerCount: number, options: RollbackOptions = {}) {
    this.historyLimit = options.historyLimit ?? 120;
    this.maxPrediction = options.maxPrediction ?? 8;
    if (!Number.isInteger(playerCount) || playerCount < MIN_MATCH_PLAYERS || playerCount > MAX_MATCH_PLAYERS || playerCount !== match.fighters.length || !Number.isInteger(localSlot) || localSlot < 0 || localSlot >= playerCount || (match.options.controllers == null && match.options.opponent !== 'human') || match.frame !== 0 || match.phase === 'ended') this.fail('Invalid rollback match or player slots.');
    if (!match.controllerKinds || match.controllerKinds.length !== playerCount || match.controllerKinds.some(kind => kind !== 'human' && kind !== 'cpu')) this.fail('Invalid rollback controller roles.');
    this.cpuSlots = Object.freeze(match.controllerKinds.map(kind => kind === 'cpu'));
    if (this.cpuSlots[localSlot]) this.fail('Local rollback slot must be human, not CPU.');
    if (!Number.isInteger(this.historyLimit) || this.historyLimit < 2 || this.historyLimit > 600 || !Number.isInteger(this.maxPrediction) || this.maxPrediction < 1 || this.maxPrediction > this.historyLimit) this.fail('Invalid rollback history bounds.');
    this.keyframeInterval = options.keyframeInterval ?? KEYFRAME_INTERVAL;
    this.hashInterval = options.hashInterval ?? 1;
    if (!Number.isInteger(this.hashInterval) || this.hashInterval < 1 || this.hashInterval > 120) this.fail('Invalid rollback hash interval.');
    if (!Number.isInteger(this.keyframeInterval) || this.keyframeInterval < 2 || this.keyframeInterval > 4) this.fail('Invalid rollback keyframe interval.');
    this.inputDelay = options.inputDelay ?? 0;
    if (!Number.isInteger(this.inputDelay) || this.inputDelay < 0 || this.inputDelay > 7) this.fail('Invalid rollback input delay.');
    match.start();
  }
  get frame(): number { return this.match.frame; }
  get stats() { return { rollbacks: this.rollbacks, resimulatedFrames: this.resimulated, predictionFrames: this.frame - this.confirmedFrame - 1, historyFrames: this.history.size, inputFrames: this.actual.size }; }
  get ended(): boolean { return this.match.phase === 'ended' && this.confirmedFrame === this.frame - 1; }
  private fail(message: string): never { this.failure ??= message; throw new RollbackError(this.failure); }
  private healthy(): void { if (this.failure) throw new RollbackError(this.failure); }
  private input(input: PlayerInput): PlayerInput { try { return normalizeInput(input); } catch (error) { return this.fail(error instanceof Error ? error.message : 'Invalid input.'); } }
  private oldest(): number { return Math.max(0, this.confirmedFrame - this.historyLimit + 1); }
  private validFrame(frame: number): void {
    if (!Number.isSafeInteger(frame) || frame < this.oldest()) this.fail('Stale or invalid rollback frame; resynchronization required.');
    if (frame > this.frame + this.historyLimit) this.fail('Input/hash exceeds bounded future history.');
  }
  private row(frame: number): Array<PlayerInput | undefined> {
    let row = this.actual.get(frame);
    if (!row) {
      // CPU decisions never arrive over the relay: LocalMatch deterministically
      // regenerates them from saved brains/RNG during both stepping and replay.
      row = Array.from({length: this.playerCount}, (_, slot) => this.cpuSlots[slot] ? normalizeInput(neutralInput()) : undefined);
      this.actual.set(frame, row);
    }
    return row;
  }
  /** Returns false without consuming input on prediction cap or provisional end.
   * Send input to the relay only on true, using the frame captured BEFORE advance. */
  advance(input: PlayerInput): boolean {
    this.healthy();
    if (this.match.phase === 'ended' || this.frame - this.confirmedFrame - 1 >= this.maxPrediction) return false;
    const normalized = this.input(input), target = this.frame + this.inputDelay;
    // Every local frame up to the delayed target must exist before it is simulated or sent:
    // the opening frames (and a resumed seat's gap) repeat the previous local input.
    for (let frame = this.frame; frame <= target; frame++) {
      const row = this.row(frame), existing = row[this.localSlot];
      if (existing) { if (frame === target && frame > this.preloadedThrough && !equal(existing, normalized)) this.fail('Conflicting local input.'); continue; }
      const value = frame === target ? normalized : {...(this.actual.get(frame - 1)?.[this.localSlot] ?? normalizeInput(neutralInput()))};
      row[this.localSlot] = value; this.outgoing.push({frame, input: value});
    }
    this.simulate(); this.confirm();
    return true;
  }
  /** Local frames to hand to the relay, in order, exactly once. With no input delay this is
   * the frame advance() just simulated. */
  drainOutgoing(): OutgoingInput[] { const outgoing = this.outgoing; this.outgoing = []; return outgoing; }
  /** Reconnect catch-up: the relay's authoritative log for a frame this driver has not
   * simulated yet. Any human slot, including the local one (a restarted browser replays its
   * own past inputs). Unbounded ahead: the caller feeds the log in step with replayStep. */
  preload(frame: number, slot: number, input: PlayerInput): void {
    this.healthy();
    if (!Number.isSafeInteger(frame) || frame < this.frame) this.fail('Preloaded input targets an already simulated frame.');
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.playerCount) this.fail('Invalid rollback slot.');
    if (this.cpuSlots[slot]) this.fail('Network input for a CPU slot is forbidden.');
    const normalized = this.input(input), row = this.row(frame), existing = row[slot];
    if (existing && !equal(existing, normalized)) this.fail('Conflicting authoritative input.');
    row[slot] = normalized;
    if (slot === this.localSlot) this.preloadedThrough = Math.max(this.preloadedThrough, frame);
  }
  /** Steps one fully preloaded frame with no prediction, confirming it at once. `light` skips
   * the keyframe snapshot; run the last dozen frames heavy so live rollback has a keyframe.
   * Returns false when the current frame's row is incomplete (catch-up is over). */
  replayStep(light = false): boolean {
    this.healthy();
    if (this.match.phase === 'ended') return false;
    if (this.frame !== this.confirmedFrame + 1) this.fail('Replay requires a fully confirmed timeline.');
    const row = this.actual.get(this.frame);
    if (!row || !row.every(input => input !== undefined)) return false;
    this.simulate(light); this.confirm();
    return true;
  }
  /** Exact duplicates (including local relay echoes) are idempotent while retained.
   * Unknown/pruned stale input fails closed, never silently changes confirmed state. */
  receive(frame: number, slot: number, input: PlayerInput): void {
    this.healthy(); this.validFrame(frame);
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.playerCount) this.fail('Invalid rollback slot.');
    if (this.cpuSlots[slot]) this.fail('Network input for a CPU slot is forbidden.');
    const normalized = this.input(input), row = this.row(frame), existing = row[slot];
    if (existing) { if (!equal(existing, normalized)) this.fail('Conflicting authoritative input.'); return; }
    if (frame <= this.confirmedFrame) this.fail('Input attempted to revise a confirmed frame.');
    if (slot === this.localSlot) this.fail('Unexpected input for unsent local frame.');
    row[slot] = normalized;
    const record = this.history.get(frame);
    if (record && !equal(record.inputs[slot]!, normalized)) {
      const target = this.highWater;
      profiler.begin(SPAN_RESIM);
      this.restorePreFrame(frame); this.rollbacks++;
      while (this.frame < target && this.match.phase !== 'ended') { this.simulate(); this.resimulated++; }
      profiler.end(SPAN_RESIM);
      // A corrected terminal frame can end earlier than its predicted branch.
      for (const key of this.history.keys()) if (key >= this.frame) this.history.delete(key);
    } else if (frame < this.frame && !record) this.fail('Rollback state no longer available.');
    this.confirm();
  }
  /** Restore the pre-frame boundary: keyframes restore directly, other frames
   * restore the previous keyframe and resimulate with stored inputs. */
  private restorePreFrame(frame: number): void {
    const direct = this.history.get(frame);
    if (direct?.before) { profiler.begin(SPAN_RESTORE); this.match.restoreState(direct.before); profiler.end(SPAN_RESTORE); return; }
    let keyframe = frame - (frame % this.keyframeInterval);
    if (keyframe === frame) keyframe -= this.keyframeInterval;
    for (; keyframe >= this.oldest(); keyframe -= this.keyframeInterval) {
      const record = this.history.get(keyframe);
      if (record?.before) break;
    }
    const base = this.history.get(keyframe);
    if (keyframe < this.oldest() || !base?.before) this.fail('Rollback state no longer available.');
    profiler.begin(SPAN_RESTORE); this.match.restoreState(base!.before!); profiler.end(SPAN_RESTORE);
    while (this.frame < frame && this.match.phase !== 'ended') { this.simulate(); this.resimulated++; }
    if (this.frame !== frame) this.fail('Rollback resimulation did not reach the corrected frame.');
  }
  /** Pre-frame snapshot into the pooled WASM ring slot (keyframe frames only).
   * Slots cycle per keyframe capture; historyLimit keyframes span at least
   * historyLimit*2 frames, beyond the retained window, so live slots never alias. */
  private captureBefore(frame: number): MatchState {
    void frame;
    const maybe = this.match as unknown as { captureStateInto?: (target: Uint8Array) => MatchState };
    if (typeof maybe.captureStateInto !== 'function') return this.match.captureState();
    const slot = (this.wasmKeyframeCount++) % this.historyLimit;
    const size = this.match.content.physics.wasm.memory.buffer.byteLength;
    let buffer = this.wasmPool[slot];
    if (!buffer || buffer.byteLength !== size) { buffer = new Uint8Array(size); this.wasmPool[slot] = buffer; }
    return this.match.captureStateInto(buffer);
  }
  /** Eager post-frame hash without cloning (Phase 4.3 live hash). */
  private liveHash(): string {
    const maybe = this.match as unknown as { liveStateHash?: () => string };
    if (typeof maybe.liveStateHash === 'function') return maybe.liveStateHash();
    return this.match.stateHash();
  }
  private simulate(light = false): void {
    const frame = this.frame, old = this.history.get(frame), previous = this.history.get(frame - 1), row = this.actual.get(frame);
    const inputs = Array.from({length: this.playerCount}, (_, slot) => ({...(row?.[slot] ?? previous?.inputs[slot] ?? old?.inputs[slot] ?? normalizeInput(neutralInput()))}));
    // Keyframes snapshot; intermediate frames keep inputs/events/hash only.
    profiler.begin(SPAN_SNAPSHOT);
    const before = !light && frame % this.keyframeInterval === 0 ? this.captureBefore(frame) : null;
    profiler.end(SPAN_SNAPSHOT);
    try {
      profiler.begin(SPAN_STEP); this.match.step(inputs); profiler.end(SPAN_STEP);
      if (this.frame !== frame + 1) this.fail('Simulation frame did not advance exactly once.');
      this.highWater = Math.max(this.highWater, this.frame);
      const audio: ConfirmedAudio = Object.freeze({specialScopes: Object.freeze(this.match.fighters.map(fighter => fighter.special?.serial ?? null)), ended: this.match.phase === 'ended'});
      profiler.begin(SPAN_EVENTS); const events = structuredClone(this.match.events); profiler.end(SPAN_EVENTS);
      let hash: string | null = null;
      if (frame % this.hashInterval === 0 || this.match.phase === 'ended') { profiler.begin(SPAN_HASH); hash = this.liveHash(); profiler.end(SPAN_HASH); }
      this.history.set(frame, {before, inputs, events, hash, audio});
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Simulation failed.'); }
  }
  private confirm(): void {
    while (this.confirmedFrame + 1 < this.frame) {
      const frame = this.confirmedFrame + 1, row = this.actual.get(frame), record = this.history.get(frame);
      if (!row || !row.every(input => input !== undefined)) break;
      if (!record) this.fail('Confirmed frame history missing.');
      const expected = this.pendingHashes.get(frame);
      if (expected !== undefined && record.hash === null) this.fail(`Peer hash for unhashed frame ${frame}; checkpoint intervals differ.`);
      if (expected !== undefined && expected !== record.hash) this.fail(`Severe state desync at frame ${frame}.`);
      this.pendingHashes.delete(frame);
      if (this.confirmedEvents.length >= this.historyLimit) this.fail('Confirmed event consumer exceeded bounded history.');
      this.confirmedFrame = frame;
      this.confirmedEvents.push(Object.freeze({frame, events: Object.freeze(record.events.map(event => Object.freeze({...event}))), audio: record.audio}));
    }
    const oldest = this.oldest();
    for (const key of this.history.keys()) if (key < oldest) this.history.delete(key);
    for (const key of this.actual.keys()) if (key < oldest) this.actual.delete(key);
    for (const key of this.pendingHashes.keys()) if (key < oldest) this.pendingHashes.delete(key);
  }
  drainConfirmedEvents(): ConfirmedEvents[] {
    this.healthy(); const events = this.confirmedEvents; this.confirmedEvents = []; return events;
  }
  /** Only retained confirmed POST-frame hashes are externally authoritative.
   * Hashes are captured eagerly at simulate time (Phase 4.3), so every
   * retained frame stays hashable without a stored post-boundary. */
  stateHash(frame: number = this.confirmedFrame): string {
    this.healthy(); this.validFrame(frame);
    const record = this.history.get(frame);
    if (frame > this.confirmedFrame || !record) throw new RollbackError('Hash frame is not confirmed/retained.');
    if (record.hash === null) throw new RollbackError('Hash frame is not a checkpoint.');
    return record.hash;
  }
  /** Peers can confirm earlier: queue bounded future hashes until locally confirmed. */
  checkHash(frame: number, hash: string): void {
    this.healthy(); this.validFrame(frame);
    if (!/^[0-9a-f]{64}$/.test(hash)) this.fail('Invalid state hash.');
    if (frame <= this.confirmedFrame) {
      if (hash !== this.stateHash(frame)) this.fail(`Severe state desync at frame ${frame}.`);
    } else {
      const old = this.pendingHashes.get(frame);
      if (old !== undefined && old !== hash) this.fail(`Conflicting peer hashes at frame ${frame}.`);
      this.pendingHashes.set(frame, hash);
    }
  }
}
