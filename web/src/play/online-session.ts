import { RoomClient } from '../net/room-client.ts';
import { VoiceClient } from '../net/voice-client.ts';
import { DEFAULT_CPU_LEVEL } from '../../../lib/game/cpu.ts';
import { RollbackDriver, ROLLBACK_HASH_INTERVAL, type OutgoingInput } from '../../../lib/game/rollback.ts';
import { rosterPlayers, selectLineup } from '../../../lib/game/roster.ts';
import type { MatchResume, MatchStart, NetInput, RelayedInput } from '../../../lib/net/protocol.ts';
import { MAX_INPUT_DELAY } from '../../../lib/net/input-codec.ts';
import type { GameSession } from './game-session.ts';
import { Store } from './store.ts';
import { profiler } from '../../../lib/perf/profiler.ts';

/** Relay input handling (rollback corrections run here, outside the RAF tick). */
const SPAN_RECEIVE = profiler.span('net.receive');

export interface OnlineStats { confirmedFrame: number; frame: number; rollbacks: number; resimulatedFrames: number; predictionFrames: number; status: string; error: string;
  /** The local Ready is waiting on this client's own assets (see setReady). */
  preparing: boolean;
  /** Local input delay of the running match, in frames. */
  inputDelay: number;
  /** Replay progress (0-1) while a restarted browser catches up with the match; null otherwise. */
  catchUp: number | null }

/** Local frames kept for a resend after a reconnect: far more than the prediction cap plus delay. */
const OUTBOX_FRAMES = 600;
/** Replay slice per task while catching up, so the page keeps painting. */
const REPLAY_BUDGET_MS = 12;
/** Spectator pacing, in fully received frames waiting to be shown. A few frames of buffer hide
 * relay jitter at 1 step per tick; past these marks the picture speeds up (x2, x4) to stay near
 * live, and a tab that slept through whole seconds fast-forwards silently instead. */
const WATCH_HURRY_FRAMES = 12, WATCH_RUSH_FRAMES = 30, WATCH_SKIP_FRAMES = 240;
/** Input delay from the measured round trip: one frame on a LAN, one more per ~33 ms. A delayed
 * local frame reaches the peers before they simulate it, which removes most rollbacks (visible
 * as teleports) for a latency players already accept in Melee netplay. `?netDelay=N` or
 * localStorage `smash.net.inputDelay` (0-7) overrides it. */
export function chooseInputDelay(rttMs: number | null): number {
  let forced: string | null = null;
  try { forced = new URLSearchParams(location.search).get('netDelay') ?? localStorage.getItem('smash.net.inputDelay'); } catch { /* no DOM */ }
  if (forced !== null && /^[0-7]$/u.test(forced)) return Number(forced);
  return Math.min(4, Math.max(1, Math.round((rttMs ?? 0) / 33) + 1));
}
const WATCH_LIVE = 'Spectating · live', WATCH_WAITING = 'Spectating · waiting for the match to start';
/** Wires transport to rollback without either knowing about React or DOM nodes. */
export class OnlineSession {
  readonly stats = new Store<OnlineStats>({ confirmedFrame: -1, frame: 0, rollbacks: 0, resimulatedFrames: 0, predictionFrames: 0, status: 'Create or join a trusted-LAN room.', error: '', preparing: false, inputDelay: 0, catchUp: null });
  readonly client: RoomClient;
  readonly voice: VoiceClient;
  private driver?: RollbackDriver;
  private start?: MatchStart;
  private sentFinish = false;
  private lastStats = 0;
  private disposed = false;
  private checkpoints: Array<{ frame: number; hash: string }> = [];
  /** Local frames the relay may not hold yet, oldest first (see pump). */
  private outbox: OutgoingInput[] = [];
  /** Highest local frame the relay is known to have accepted or been handed. */
  private sentThrough = -1;
  /** Set between a resume's `start` and its `synced`: nothing is sent until the relay says what it holds. */
  private resumeInfo: MatchResume | null = null;
  /** Restarted browser: the relay's input log per room slot, replayed once assets and `synced` are in. */
  private rebuild: { start: MatchStart; log: Map<number, NetInput[]>; synced: boolean; replaying: boolean; lastHash: number } | null = null;
  /** Frame-advantage time sync: per remote room slot, how far this sim runs ahead of it (frames, smoothed). */
  private readonly skew = new Map<number, { offset: number; sim: number }>();
  private lastSkip = 0;
  /** Why the last simulation tick did or did not advance (diagnostics in smashNetworkSnapshot). */
  private gate = 'idle';
  private ticks = 0;
  /** Spectator only: per dense human index, the highest input frame received (the relay orders them per seat). */
  private readonly watched = new Map<number, number>();
  private bootTimer: ReturnType<typeof setTimeout> | undefined;
  private releaseBoot: (() => void) | undefined;
  /** Last lobby selection prepared, so repeated room updates do not re-queue the same assets. */
  private preparedSelection = '';
  /** Selection the local Ready click applies to. The relay is told this client is ready only
   * once that selection's fighters, skins and stage are actually resident here, which is what
   * `assetsLoaded` promises the room; the server drops every ready on any selection change. */
  private readyFor = '';
  constructor(readonly game: GameSession) {
    this.client = new RoomClient({
      onStart: start => this.begin(start),
      onInput: message => {
        profiler.begin(SPAN_RECEIVE);
        this.guard(() => {
          // A restarted browser collects the relay's log first and replays it in slices.
          if (this.rebuild) { const log = this.rebuild.log.get(message.slot) ?? []; log[message.frame] = message.input; this.rebuild.log.set(message.slot, log); return; }
          // A spectator predicts nothing: every frame is authoritative and waits for watch() to step it.
          if (this.client.getSnapshot().spectator) {
            const dense = this.start?.players.findIndex(player => player.slot === message.slot) ?? -1;
            if (!this.driver || dense < 0) return;
            this.driver.preload(message.frame, dense, message.input); this.watched.set(dense, Math.max(this.watched.get(dense) ?? -1, message.frame)); return;
          }
          const slot = this.start?.players.findIndex(player => player.slot === message.slot) ?? -1;
          if (!this.driver || slot < 0) throw new Error('Input has no active simulation slot.');
          this.observe(message);
          this.driver.receive(message.frame, slot, message.input); this.flush();
        });
        profiler.end(SPAN_RECEIVE);
      },
      onSynced: () => this.guard(() => this.synced()),
      resumeFrom: () => (this.driver ? this.driver.confirmedFrame + 1 : 0),
      // A spectator may trail the players by more than the retained history; it never attests state.
      onHash: message => this.guard(() => { if (!this.client.getSnapshot().spectator) this.driver?.checkHash(message.frame, message.hash); }),
      onEnd: end => {
        if (end.code === 'MATCH_COMPLETE') { this.game.finishOnline(); this.stats.update({ status: 'Match complete · all peers verified the final state.' }); }
        else { this.game.stopOnline(end.message); this.stats.update({ status: end.message }); }
        this.driver = undefined; this.start = undefined; this.rebuild = null; this.resumeInfo = null; this.stats.update({ catchUp: null });
      },
    });
    window.smashNetworkSnapshot = () => ({ prepared: this.preparedSelection, gate: this.gate, ticks: this.ticks, sentThrough: this.sentThrough, transport: this.client.getSnapshot().status, clockOffsetMs: this.client.getSnapshot().serverOffsetMs, ...this.stats.getSnapshot(), room: this.client.getSnapshot().room, slot: this.client.getSnapshot().slot, spectator: this.client.getSnapshot().spectator, latencyMs: this.client.getSnapshot().latencyMs, lastEnd: this.client.getSnapshot().lastEnd, confirmedHashes: this.checkpoints.map(checkpoint => ({ ...checkpoint })) });
    // Assets load on demand, so the room's own picks are what this client must hold: follow
    // every room update and hand the selection to the session, which loads what is missing and
    // pins it against the warm-set eviction. Without it the host's Start bounced the whole
    // room back to character select ("the next start will join").
    this.client.subscribe(() => {
      if (this.disposed) return;
      const room = this.client.getSnapshot().room;
      if (!room) { this.preparedSelection = ''; this.readyFor = ''; this.game.setRoomSelection(null); this.stats.update({ preparing: false }); return; }
      // Spectators follow the same selection, so what they watch is loaded and pinned before it starts.
      if (this.client.getSnapshot().spectator && room.phase === 'lobby' && !this.driver && !this.rebuild && this.stats.getSnapshot().status !== WATCH_WAITING) this.stats.update({ error: '', status: WATCH_WAITING });
      const picks = room.players.map(player => ({ fighter: player.fighter, costume: player.costume ?? 0 }));
      const wanted = `${picks.map(pick => `${pick.fighter}:${pick.costume}`).sort().join(',')}|${room.rules.stage}`;
      if (wanted === this.preparedSelection) return;
      this.preparedSelection = wanted;
      // Any selection change unreadies the whole room on the server, so a pending local Ready
      // for the previous selection is dropped here too.
      if (this.readyFor && this.readyFor !== wanted) { this.readyFor = ''; this.stats.update({ preparing: false }); }
      this.game.setRoomSelection({ picks, stage: room.rules.stage });
      this.publishReady();
    });
    this.game.onAssetsSettled = () => { this.publishReady(); this.guard(() => this.replay()); };
    this.voice = new VoiceClient(this.client);
    const previousSnapshot = window.smashNetworkSnapshot;
    window.smashNetworkSnapshot = () => ({ ...previousSnapshot(), voice: this.voice.getSnapshot() });
    // A browser that restarted (or crashed) mid-match still owns a held seat: reclaim it as
    // soon as the game can simulate again, before the relay's grace period runs out.
    const boot = (): void => {
      if (this.disposed || !this.game.ui.getSnapshot().ready || this.bootTimer !== undefined) return;
      const stored = this.client.storedResume();
      this.releaseBoot?.(); this.releaseBoot = undefined;
      if (!stored || this.client.getSnapshot().status !== 'disconnected') return;
      this.bootTimer = setTimeout(() => {
        if (this.disposed || this.game.online || this.game.ui.getSnapshot().active || this.client.getSnapshot().status !== 'disconnected') return;
        this.game.chooseMode('lan');
        if (this.client.resumeStored(this.game.fingerprint)) this.stats.update({ error: '', status: 'Rejoining the match you dropped from…' });
      }, stored.waitMs);
    };
    if (this.client.storedResume()) { this.releaseBoot = this.game.ui.subscribe(boot); boot(); }
  }
  async connect(): Promise<void> {
    if (!this.game.ui.getSnapshot().ready) throw new Error('Wait for all original assets to load.');
    if (this.client.getSnapshot().status === 'connected') return;
    await this.client.connect();
  }
  /** Watch a room read-only, in any phase. Leave with `leave()`. */
  async spectate(code: string): Promise<void> {
    await this.connect();
    if (!this.client.spectate({ code, fingerprint: this.game.fingerprint })) throw new Error('Leave the current room before spectating another one.');
  }
  private guard(action: () => void): void {
    if (this.disposed) return;
    try { action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A spectator's failure is its own: the players' match must go on untouched.
      if (this.client.getSnapshot().spectator) { this.stats.update({ error: message, status: 'Spectating stopped · this browser could not follow the match.', catchUp: null }); this.game.stopOnline(message); this.driver = undefined; this.start = undefined; this.rebuild = null; return; }
      this.stats.update({ error: message, status: 'Match stopped to prevent divergent gameplay.' });
      this.game.stopOnline(message); this.driver = undefined; this.start = undefined;
      this.client.returnToLobby();
    }
  }
  /** Frame-advantage sync. Each relayed frame carries the sender's sim frame (frame - delay) and
   * how far ahead IT believes it runs. Half the difference of both one-sided views cancels the
   * latency and leaves the true offset between the two simulations. */
  private observe(message: RelayedInput): void {
    if (message.delay === undefined || message.adv === undefined || !this.driver) return;
    const sim = message.frame - message.delay, entry = this.skew.get(message.slot) ?? { offset: 0, sim };
    const sample = ((this.driver.frame - sim) - message.adv) / 2;
    entry.offset += (sample - entry.offset) * 0.1; entry.sim = Math.max(entry.sim, sim);
    this.skew.set(message.slot, entry);
  }
  /** Sent with every local frame: this sim's lead over the slowest remote, latency included. */
  private advantage(): number {
    let slowest = Infinity;
    for (const entry of this.skew.values()) slowest = Math.min(slowest, entry.sim);
    return Number.isFinite(slowest) && this.driver ? this.driver.frame - slowest : 0;
  }
  /** Hands queued local frames to the relay strictly in order; keeps them while reconnecting. */
  private pump(): void {
    if (this.resumeInfo || this.rebuild) return;
    const meta = { delay: this.driver?.inputDelay ?? 0, adv: this.advantage() };
    for (const out of this.outbox) {
      if (out.frame <= this.sentThrough) continue;
      if (out.frame !== this.sentThrough + 1) throw new Error('Local input history no longer reaches the relay; cannot resume.');
      if (!this.client.sendInput(out.frame, out.input, meta)) break;
      this.sentThrough = out.frame;
    }
    if (this.outbox.length > OUTBOX_FRAMES) this.outbox.splice(0, this.outbox.length - OUTBOX_FRAMES);
  }
  /** The relay replayed everything this client asked for after a resume. */
  private synced(): void {
    if (this.rebuild) { this.rebuild.synced = true; this.replay(); return; }
    const info = this.resumeInfo, driver = this.driver;
    if (!info || !driver) return;
    this.resumeInfo = null; this.sentThrough = info.lastFrame;
    // Frames first: the relay only accepts a hash (or finish) for a frame whose inputs it holds from
    // every human, this seat included. A hash ahead of the resent frames is a fatal HASH_FRAME.
    this.pump();
    for (const checkpoint of this.checkpoints) if (checkpoint.frame > info.lastHash && checkpoint.frame <= this.sentThrough) this.client.sendHash(checkpoint.frame, checkpoint.hash);
    if (this.sentFinish && !info.finished) this.client.finish(driver.confirmedFrame, driver.stateHash(driver.confirmedFrame));
    this.flush();
    this.stats.update({ error: '', status: 'Reconnected · live again.' });
  }
  /** Restarted browser: rebuild the match from the shared start and replay the relay's input log
   * (deterministic simulation, no state transfer), a slice per task, then go live. */
  private replay(): void {
    const rebuild = this.rebuild;
    if (!rebuild || !rebuild.synced || rebuild.replaying || this.disposed) return;
    const start = rebuild.start, picks = start.players.map(player => ({ fighter: player.fighter, costume: player.costume ?? 0 }));
    const verb = this.client.getSnapshot().spectator ? 'Spectating' : 'Rejoining';
    if (!this.game.matchAssetsReady(picks, start.rules.stage)) {
      this.game.ensureFighters(picks.map(pick => pick.fighter)); this.game.ensureStage(start.rules.stage); this.game.ensureCostumes(picks);
      this.stats.update({ error: '', status: `${verb} · loading the match’s fighters and stage…`, catchUp: 0 });
      setTimeout(() => this.guard(() => this.replay()), 1000); return;
    }
    rebuild.replaying = true;
    const driver = this.launch(start), humans = start.players.map((player, dense) => ({ dense, log: (player.control ?? 'human') === 'human' ? rebuild.log.get(player.slot) ?? [] : null })).filter((entry): entry is { dense: number; log: NetInput[] } => entry.log !== null);
    // Only fully logged frames replay; the ragged tail (peers a few frames ahead, this seat's own
    // in-flight frames) is preloaded afterwards and consumed by normal play.
    const target = Math.min(...humans.map(human => { let length = 0; while (human.log[length] !== undefined) length++; return length; }));
    const slice = (): void => {
      if (this.disposed || this.rebuild !== rebuild || this.driver !== driver) return;
      let done = false;
      this.guard(() => {
        const began = performance.now();
        while (!done && performance.now() - began < REPLAY_BUDGET_MS) {
          const frame = driver.frame;
          if (frame >= target) { done = true; break; }
          for (const human of humans) driver.preload(frame, human.dense, human.log[frame]!);
          if (!driver.replayStep(target - frame > 12)) { done = true; break; }
          for (const batch of driver.drainConfirmedEvents()) {
            if (batch.frame % ROLLBACK_HASH_INTERVAL !== 0) continue;
            const hash = driver.stateHash(batch.frame);
            this.checkpoints.push({ frame: batch.frame, hash }); if (this.checkpoints.length > 8) this.checkpoints.shift();
            if (batch.frame > rebuild.lastHash) this.client.sendHash(batch.frame, hash);
          }
        }
        if (!done) { this.stats.update({ frame: driver.frame, confirmedFrame: driver.confirmedFrame, catchUp: target ? driver.frame / target : 1, status: `${verb} · catching up ${Math.floor(100 * driver.frame / Math.max(1, target))}%` }); return; }
        for (const human of humans) for (let frame = driver.frame; frame < human.log.length; frame++) if (human.log[frame] !== undefined) driver.preload(frame, human.dense, human.log[frame]!);
        for (const human of humans) this.watched.set(human.dense, human.log.length - 1);
        this.rebuild = null;
        this.game.audio.syncScopes(driver.match.fighters.map(fighter => fighter.special?.serial ?? null), driver.match.phase === 'ended');
        this.stats.update({ error: '', catchUp: null, status: verb === 'Spectating' ? WATCH_LIVE : 'Rejoined · live again.' });
        this.game.publishHud(); this.flush();
      });
      if (!done && this.rebuild === rebuild) setTimeout(slice, 0);
    };
    slice();
  }
  /** Builds the simulation and its rollback driver for a shared start (fresh or rebuilt). */
  private launch(start: MatchStart): RollbackDriver {
    if (this.client.getSnapshot().spectator) return this.launchWatch(start);
    const slot = start.players.findIndex(player => player.slot === this.client.getSnapshot().slot);
    if (slot < 0) throw new Error('Room did not assign a local player.');
    const picks = start.players.map(player => ({ fighter: player.fighter, costume: player.costume ?? 0 }));
    const content = selectLineup(rosterPlayers(this.game.getStageContent(start.rules.stage), start.players.map(player => player.fighter)), picks, this.game.costumeModels);
    const match = this.game.beginOnline(content, start.rules, start.seed, slot, input => this.advance(input), () => this.client.background(), start.players.map(player => player.control ?? 'human'), start.players.map(player => player.slot), start.players.map(player => player.level ?? DEFAULT_CPU_LEVEL));
    const inputDelay = Math.min(MAX_INPUT_DELAY, chooseInputDelay(this.client.getSnapshot().latencyMs === null ? null : this.client.getSnapshot().latencyMs! * 2));
    // Only checkpoint frames are hashed (and exchanged): hashing every frame cost ~3x the simulation.
    this.driver = new RollbackDriver(match, slot, start.players.length, { maxPrediction: 8, historyLimit: 120, hashInterval: ROLLBACK_HASH_INTERVAL, inputDelay });
    this.stats.update({ inputDelay });
    return this.driver;
  }
  /** Spectator build: same deterministic match, no local seat. The driver still wants a human
   * `localSlot`, so it borrows the first one, but advance() is never called: frames only ever
   * come from the relay (preload) and are stepped fully confirmed (replayStep). */
  private launchWatch(start: MatchStart): RollbackDriver {
    const borrowed = start.players.findIndex(player => (player.control ?? 'human') === 'human');
    if (borrowed < 0) throw new Error('Spectated match has no human player.');
    const picks = start.players.map(player => ({ fighter: player.fighter, costume: player.costume ?? 0 }));
    const content = selectLineup(rosterPlayers(this.game.getStageContent(start.rules.stage), start.players.map(player => player.fighter)), picks, this.game.costumeModels);
    // The hidden-tab abort is a no-op: a watcher has no seat for the relay to hold.
    const match = this.game.beginOnline(content, start.rules, start.seed, -1, () => this.watch(), () => {}, start.players.map(player => player.control ?? 'human'), start.players.map(player => player.slot), start.players.map(player => player.level ?? DEFAULT_CPU_LEVEL));
    this.driver = new RollbackDriver(match, borrowed, start.players.length, { maxPrediction: 8, historyLimit: 120, hashInterval: ROLLBACK_HASH_INTERVAL, inputDelay: 0 });
    this.stats.update({ inputDelay: 0 });
    return this.driver;
  }
  /** Spectator tick: the local pad is ignored; show the next fully received frame, faster while
   * the buffer is deep. false (nothing to show yet) lets the session drop its owed time. */
  private watch(): boolean {
    const driver = this.driver;
    if (!driver || !this.start || this.rebuild) return false;
    let stepped = false;
    this.guard(() => {
      let through = Infinity;
      for (const frame of this.watched.values()) through = Math.min(through, frame);
      const buffered = Number.isFinite(through) ? through - driver.frame + 1 : 0;
      if (buffered > WATCH_SKIP_FRAMES) {
        // Slept through seconds of play (hidden tab): fast-forward without sound, like a mid-match join.
        const began = performance.now();
        while (performance.now() - began < REPLAY_BUDGET_MS && through - driver.frame >= WATCH_RUSH_FRAMES && driver.replayStep(through - driver.frame > WATCH_RUSH_FRAMES + 12)) { driver.drainConfirmedEvents(); stepped = true; }
        this.game.audio.syncScopes(driver.match.fighters.map(fighter => fighter.special?.serial ?? null), driver.match.phase === 'ended');
      } else for (let steps = buffered > WATCH_RUSH_FRAMES ? 4 : buffered > WATCH_HURRY_FRAMES ? 2 : 1; steps > 0 && driver.replayStep(); steps--) { stepped = true; this.flush(); }
      if (driver.ended) this.flush();
    });
    return stepped;
  }
  private begin(start: MatchStart): void {
    this.guard(() => {
      if (this.client.getSnapshot().spectator) {
        // Live start or mid-match join, one path: collect the relay's log, load whatever is missing
        // (never bounce the room to the lobby, that is a player's privilege), replay, then follow.
        // A live start has no backlog and no `synced` coming, so it is synced by definition.
        const live = start.serverNow < start.startAt;
        this.driver = undefined; this.start = start; this.sentFinish = false; this.checkpoints = []; this.outbox = []; this.skew.clear(); this.watched.clear(); this.resumeInfo = null;
        this.rebuild = { start, log: new Map(), synced: live, replaying: false, lastHash: Infinity };
        this.stats.update({ error: '', status: live ? WATCH_LIVE : 'Spectating · receiving the match so far…', catchUp: live ? null : 0, frame: 0, confirmedFrame: -1, rollbacks: 0, resimulatedFrames: 0, predictionFrames: 0 });
        if (live) this.replay();
        return;
      }
      const slot = start.players.findIndex(player => player.slot === this.client.getSnapshot().slot);
      if (slot < 0) throw new Error('Room did not assign a local player.');
      if (start.resume) {
        // Same page, new socket: the simulation is intact. Hold the outbox until `synced`, then
        // resend whatever the relay never received. Otherwise this browser restarted: rebuild.
        if (this.driver && this.start?.matchId === start.matchId) { this.resumeInfo = start.resume; this.stats.update({ error: '', status: 'Reconnected · syncing missed frames…' }); return; }
        this.driver = undefined; this.start = start; this.sentFinish = start.resume.finished; this.checkpoints = []; this.outbox = []; this.skew.clear(); this.resumeInfo = null;
        this.sentThrough = start.resume.lastFrame;
        this.rebuild = { start, log: new Map(), synced: false, replaying: false, lastHash: start.resume.lastHash };
        this.stats.update({ error: '', status: 'Rejoining · receiving the match so far…', catchUp: 0, frame: 0, confirmedFrame: -1, rollbacks: 0, resimulatedFrames: 0, predictionFrames: 0 });
        return;
      }
      this.start = start; this.sentFinish = false; this.checkpoints = []; this.outbox = []; this.sentThrough = -1; this.skew.clear(); this.lastSkip = 0; this.resumeInfo = null; this.rebuild = null;
      // Phase 2.1: the host may not have this stage/fighters loaded yet when
      // the room fires start (background prefetch still running). Prepare
      // them and wait for the next start instead of failing the room.
      const kinds = start.players.map(player => player.fighter);
      const picks = start.players.map(player => ({ fighter: player.fighter, costume: player.costume ?? 0 }));
      if (!this.game.matchAssetsReady(picks, start.rules.stage)) {
        this.game.ensureFighters(kinds); this.game.ensureStage(start.rules.stage); this.game.ensureCostumes(picks);
        this.stats.update({ error: '', status: 'Preparing stage and fighters… the next start will join.' });
        this.client.returnToLobby();
        this.start = undefined;
        return;
      }
      this.launch(start);
      this.stats.update({ error: '', status: 'Synchronized start · waiting for the room clock.', frame: 0, confirmedFrame: -1, rollbacks: 0, resimulatedFrames: 0, predictionFrames: 0, catchUp: null });
      this.game.publishHud();
    });
  }
  private advance(input: NetInput): boolean {
    this.ticks++;
    if (!this.driver || !this.start || this.rebuild) { this.gate = this.rebuild ? 'rebuild' : 'no-driver'; return false; }
    if (this.client.serverNow() < this.start.startAt) { this.gate = `clock ${Math.round(this.client.serverNow() - this.start.startAt)}ms`; return false; }
    // A hidden tab told the relay to hold this seat; it must not keep feeding frames that lift the hold.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { this.gate = 'hidden'; return false; }
    // Running ahead of a peer means predicting all of its inputs (every correction is ours) and
    // stalling at the prediction cap. Give back one tick at a time until the simulations align.
    let lead = 0;
    for (const entry of this.skew.values()) lead = Math.max(lead, entry.offset);
    if (lead > 0.75 && this.driver.frame - this.lastSkip >= 12) {
      this.lastSkip = this.driver.frame;
      for (const entry of this.skew.values()) entry.offset -= 1;
      this.gate = 'sync-skip'; return false;
    }
    let advanced = false;
    this.guard(() => {
      advanced = this.driver!.advance(input); this.gate = advanced ? 'live' : 'prediction-cap';
      if (advanced) { this.outbox.push(...this.driver!.drainOutgoing()); this.pump(); }
      this.flush();
    });
    return advanced;
  }
  private flush(): void {
    const driver = this.driver; if (!driver) return;
    // A spectator presents the confirmed timeline like a player but never attests it (no hash, no finish).
    const spectator = this.client.getSnapshot().spectator;
    for (const batch of driver.drainConfirmedEvents()) {
      this.game.present(batch.events);
      this.game.audio.syncScopes(batch.audio.specialScopes, batch.audio.ended);
      if (spectator) continue;
      if (batch.frame % ROLLBACK_HASH_INTERVAL === 0) {
        const hash = driver.stateHash(batch.frame);
        this.checkpoints.push({ frame: batch.frame, hash });
        if (this.checkpoints.length > 8) this.checkpoints.shift();
        this.client.sendHash(batch.frame, hash);
      }
    }
    if (driver.ended && !this.sentFinish) {
      this.sentFinish = true;
      if (!spectator) this.client.finish(driver.confirmedFrame, driver.stateHash(driver.confirmedFrame));
      this.game.finishOnline();
    }
    const now = performance.now();
    if (now - this.lastStats > 100 || driver.ended) {
      this.lastStats = now;
      const network = this.client.getSnapshot(), away = network.room?.players.filter(player => player.connected === false && player.slot !== network.slot).map(player => player.name) ?? [];
      this.stats.update({ frame: driver.frame, confirmedFrame: driver.confirmedFrame, rollbacks: driver.stats.rollbacks, resimulatedFrames: driver.stats.resimulatedFrames, predictionFrames: driver.stats.predictionFrames, status: spectator ? (driver.ended ? 'Spectating · match over.' : WATCH_LIVE) : driver.ended ? 'Verifying shared result…' : network.status === 'reconnecting' ? 'Connection lost · reconnecting…' : away.length ? `Waiting for ${away.join(', ')} to reconnect…` : driver.stats.predictionFrames >= 8 ? 'Waiting for late input · bounded prediction.' : 'Live · local prediction + confirmed state checks.' });
    }
  }
  /** Ready button: records the intent, then tells the relay as soon as this client can
   * actually start the room's current selection. Reporting `ready` while a fighter, skin or
   * stage is still loading is what used to bounce the whole room back to character select. */
  setReady(ready: boolean): void {
    const room = this.client.getSnapshot().room;
    if (!ready || !room) { this.readyFor = ''; this.stats.update({ preparing: false }); this.client.ready(false); return; }
    this.readyFor = this.selectionKey(room);
    this.publishReady();
  }
  private selectionKey(room: NonNullable<ReturnType<RoomClient['getSnapshot']>['room']>): string {
    return `${room.players.map(player => `${player.fighter}:${player.costume ?? 0}`).sort().join(',')}|${room.rules.stage}`;
  }
  private publishReady(): void {
    if (this.disposed || !this.readyFor) return;
    const room = this.client.getSnapshot().room;
    if (!room || this.readyFor !== this.selectionKey(room)) return;
    const picks = room.players.map(player => ({ fighter: player.fighter, costume: player.costume ?? 0 }));
    if (!this.game.matchAssetsReady(picks, room.rules.stage)) {
      const blocked = this.game.unloadableKinds(picks.map(pick => pick.fighter));
      this.stats.update({ preparing: true, status: blocked.length
        ? `${blocked.join(', ')} could not load on this browser · choose another fighter to start.`
        : 'Loading this room’s fighters, skins and stage…' });
      return;
    }
    this.readyFor = '';
    this.stats.update({ preparing: false });
    this.client.ready(true);
  }
  returnToLobby(): void { this.client.returnToLobby(); this.game.stopOnline('Back in the room. Choose fighters, mark ready and start again.'); this.driver = undefined; this.start = undefined; this.rebuild = null; this.resumeInfo = null; this.stats.update({ catchUp: null }); }
  /** Leaving while the socket is down cannot reach the relay: drop the connection (and the held seat's credential) locally. */
  leave(): void { if (!this.client.leave()) this.client.disconnect(); this.game.stopOnline('You left the room.'); this.driver = undefined; this.start = undefined; this.rebuild = null; this.resumeInfo = null; this.stats.update({ catchUp: null }); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    clearTimeout(this.bootTimer); this.releaseBoot?.(); this.releaseBoot = undefined; this.rebuild = null;
    this.game.setRoomSelection(null);
    if (this.game.onAssetsSettled) delete this.game.onAssetsSettled;
    this.voice.dispose(); this.client.disconnect(); this.driver = undefined; this.stats.clear(); delete window.smashNetworkSnapshot;
  }
}
declare global { interface Window { smashNetworkSnapshot?: () => OnlineStats & { gate: string; ticks: number; sentThrough: number; transport: string; clockOffsetMs: number; /** Room selection already prepared on this client (`Kind:costume,… |stage`). */ prepared: string; room: ReturnType<RoomClient['getSnapshot']>['room']; slot: number | null; /** Read-only watcher of `room`. */ spectator: boolean; latencyMs: number | null; lastEnd: ReturnType<RoomClient['getSnapshot']>['lastEnd']; confirmedHashes: Array<{ frame: number; hash: string }> } } }
