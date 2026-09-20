import {
  MAX_BUFFERED_BYTES, MAX_ROOM_PAYLOAD, RECONNECT_GRACE_MS, ROOM_PROTOCOL, ROOM_SOCKET_PATH, immutable, validRoomSummary,
  type ClientMessage, type Fingerprint, type MatchEnd, type MatchStart, type NetInput,
  type RelayedInput, type RoomFighter, type RoomRules, type RoomSummary, type RoomView, type ServerMessage,
  type VoiceSignal,
} from '../../../lib/net/protocol.ts';
import { MAX_BINARY_MESSAGE, OP_BACKLOG, OP_RELAY, decodeBacklog, decodeInputPayload, decodeRelayMessage, encodeInputMessage, matchTag, type InputMeta } from '../../../lib/net/input-codec.ts';

export type { RoomSummary };
export type { VoiceSignal };

/** Plain same-origin GET for the room browser. Same path as the WebSocket relay;
 * upgrades bypass the JSON handler server-side. Validates every entry so a
 * malformed directory cannot inject room codes or host names into the UI. */
export async function fetchRoomList(signal?: AbortSignal): Promise<RoomSummary[]> {
  const response = await fetch(ROOM_SOCKET_PATH, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`Room list unavailable (${response.status}).`);
  const data = (await response.json()) as unknown;
  if (!data || typeof data !== 'object' || !Array.isArray((data as { rooms?: unknown }).rooms)) throw new Error('Room list response is invalid.');
  const rooms = (data as { rooms: unknown[] }).rooms;
  if (rooms.length > 32) throw new Error('Room list response is invalid.');
  if (!rooms.every(validRoomSummary)) throw new Error('Room list response is invalid.');
  return immutable(rooms as RoomSummary[]) as unknown as RoomSummary[];
}

export interface RoomSnapshot {
  /** `reconnecting`: the socket dropped mid-match and the client is reclaiming its held seat. */
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  room: RoomView | null; slot: number | null; match: MatchStart | null;
  /** Read-only watcher of `room`: no slot, no token, nothing to resume. */
  spectator: boolean;
  error: { code: string; message: string } | null; lastEnd: MatchEnd | null;
  latencyMs: number | null; serverOffsetMs: number;
}
/** What survives a dropped socket or a browser restart: enough to reclaim the held seat. */
export interface ResumeCredential { url: string; code: string; token: string; matchId: string; slot: number; fingerprint: Fingerprint; savedAt: number; aliveAt: number }
type ResumeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface RoomClientOptions {
  url?: string; createSocket?: (url: string) => WebSocket; now?: () => number;
  onStart?: (start: MatchStart) => void; onInput?: (input: RelayedInput) => void;
  onEnd?: (end: MatchEnd) => void;
  onHash?: (message: Extract<ServerMessage, { type: 'hash' }>) => void;
  onVoice?: (signal: VoiceSignal) => void;
  /** The relay finished replaying the input backlog after a resume. */
  onSynced?: () => void;
  /** First input frame a live page still needs when it resumes (confirmed + 1). */
  resumeFrom?: () => number;
  /** false disables mid-match reconnects (a drop closes the match locally, as before v8). */
  reconnect?: boolean;
  /** Where the resume credential lives; defaults to localStorage, null keeps it in memory only. */
  storage?: ResumeStorage | null;
}
const RESUME_KEY = 'smash.room.resume';
/** A credential is only worth trying while its match can still exist (10 min cap + grace). */
const RESUME_MAX_AGE_MS = 12 * 60_000;
/** Another live tab refreshes `aliveAt` this often; a restarted browser waits it out before resuming. */
const ALIVE_BEAT_MS = 2000;
/** Generous on purpose: eight software-rendered browsers on one machine can starve a page's main
 * thread for seconds, and outside a match a false positive costs the room seat. */
const PING_MS = 2000, PING_DEAD_MS = 12_000, CLOCK_SAMPLES = 8;
/** One socket owns one stable room slot. Snapshot identity changes only on updates;
 * all nested payloads are frozen for React useSyncExternalStore subscribers.
 * No simulation, rollback or asset loading here. A socket lost mid-match is reopened and
 * the held seat reclaimed (`resume`); the adapter replays whatever it missed.
 */
export class RoomClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private readonly listeners = new Set<() => void>();
  private state: Readonly<RoomSnapshot> = immutable({ status: 'disconnected', room: null, slot: null, spectator: false, match: null, error: null, lastEnd: null, latencyMs: null, serverOffsetMs: 0 });
  private timer: ReturnType<typeof setInterval> | undefined;
  private pendingPings = new Map<number, number>();
  private clock: Array<{ rtt: number; offset: number }> = [];
  private nonce = 0;
  private url = '';
  private fingerprint: Fingerprint | null = null;
  private credential: ResumeCredential | null = null;
  private tag = 0;
  /** Between a resume and its `synced`: the relay has not yet said which frames it holds, so no
   * frame, hash or finish may be sent (a duplicate frame is a fatal FRAME_ORDER). */
  private resyncing = false;
  private recon: { deadline: number; attempt: number; timer?: ReturnType<typeof setTimeout>; from?: number } | null = null;
  private readonly now: () => number;
  private readonly storage: ResumeStorage | null;
  onStart?: RoomClientOptions['onStart']; onInput?: RoomClientOptions['onInput']; onEnd?: RoomClientOptions['onEnd']; onHash?: RoomClientOptions['onHash']; onVoice?: RoomClientOptions['onVoice']; onSynced?: RoomClientOptions['onSynced'];
  constructor(private readonly options: RoomClientOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onStart = options.onStart; this.onInput = options.onInput; this.onEnd = options.onEnd; this.onHash = options.onHash; this.onVoice = options.onVoice; this.onSynced = options.onSynced;
    let storage: ResumeStorage | null = null;
    if (options.storage !== undefined) storage = options.storage;
    else try { storage = typeof localStorage === 'undefined' ? null : localStorage; } catch { storage = null; }
    this.storage = storage;
  }
  readonly getSnapshot = (): Readonly<RoomSnapshot> => this.state;
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<RoomSnapshot>): void { this.state = immutable({ ...this.state, ...patch }); for (const listener of this.listeners) listener(); }
  /** Approximate server clock from application ping RTT; shared frame IDs, not
   * equal wall clocks, are the authority. The adapter handles late arrival. */
  serverNow(): number { return this.now() + this.state.serverOffsetMs; }
  connect(url = this.options.url): Promise<void> {
    if (this.socket) return Promise.reject(new Error('Disconnect before opening another room socket.'));
    if (!url) {
      if (typeof location === 'undefined') return Promise.reject(new Error('A relay URL is required.'));
      url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${ROOM_SOCKET_PATH}`;
    }
    this.url = url;
    const resuming = this.recon !== null;
    if (resuming) this.update({ status: 'reconnecting' });
    else this.update({ status: 'connecting', error: null, lastEnd: null, latencyMs: null, serverOffsetMs: 0 });
    this.clock = [];
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try { socket = (this.options.createSocket ?? (address => new WebSocket(address)))(url); }
      catch (error) {
        if (resuming) this.closed(); else this.update({ status: 'disconnected', error: { code: 'CONNECT_FAILED', message: 'Could not open the LAN relay.' } });
        reject(error); return;
      }
      try { socket.binaryType = 'arraybuffer'; } catch { /* test doubles */ }
      this.socket = socket;
      const timeout = setTimeout(() => { reject(new Error('LAN relay handshake timed out.')); settled = true; this.abort(); }, resuming ? 5000 : 10_000);
      socket.addEventListener('message', event => {
        if (this.socket !== socket) return;
        try {
          if (typeof event.data !== 'string') {
            if (!settled || !(event.data instanceof ArrayBuffer) || event.data.byteLength > MAX_BINARY_MESSAGE) throw new Error('Invalid relay payload.');
            this.receiveBinary(new Uint8Array(event.data)); return;
          }
          if (event.data.length > MAX_ROOM_PAYLOAD * 4) throw new Error('Invalid relay payload.');
          const message = JSON.parse(event.data) as ServerMessage;
          if (!message || typeof message !== 'object' || typeof message.type !== 'string') throw new Error('Invalid relay message.');
          if (!settled) {
            if (message.type !== 'hello' || message.protocol !== ROOM_PROTOCOL || !Number.isFinite(message.serverNow)) throw new Error('Incompatible relay protocol.');
            settled = true; clearTimeout(timeout);
            this.update({ status: resuming ? 'reconnecting' : 'connected', serverOffsetMs: message.serverNow - this.now() });
            this.timer = setInterval(() => this.beat(), PING_MS);
            if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibility);
            if (typeof window !== 'undefined') window.addEventListener('pagehide', this.pagehide);
            this.ping(); resolve(); return;
          }
          this.receive(message);
        } catch (error) {
          if (!settled) { settled = true; clearTimeout(timeout); reject(error); }
          this.update({ error: { code: 'CLIENT_FAILURE', message: error instanceof Error ? error.message : 'Room client failure.' } });
          // A relay that speaks another protocol will not get better by retrying.
          if (error instanceof Error && error.message === 'Incompatible relay protocol.') this.disconnect(); else this.abort();
        }
      });
      socket.addEventListener('close', () => {
        clearTimeout(timeout);
        if (!settled) { settled = true; reject(new Error('LAN relay closed before handshake.')); }
        if (this.socket === socket) this.closed();
      });
      socket.addEventListener('error', () => {
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('Could not connect to the trusted-LAN relay.')); }
        if (this.socket === socket) { this.update({ error: { code: 'CONNECTION_FAILED', message: 'LAN relay connection failed.' } }); this.abort(); }
      });
    });
  }
  private receiveBinary(bytes: Uint8Array): void {
    const match = this.state.match;
    if (bytes[0] === OP_RELAY) {
      const relay = decodeRelayMessage(bytes);
      if (!relay) throw new Error('Invalid relay input frame.');
      if (match && relay.tag === this.tag) this.onInput?.({ type: 'input', matchId: match.matchId, slot: relay.slot, frame: relay.frame, input: decodeInputPayload(relay.payload), delay: relay.meta.delay, adv: relay.meta.adv });
    } else if (bytes[0] === OP_BACKLOG) {
      const backlog = decodeBacklog(bytes);
      if (!backlog) throw new Error('Invalid relay input backlog.');
      if (match && backlog.tag === this.tag) backlog.inputs.forEach((input, index) => this.onInput?.({ type: 'input', matchId: match.matchId, slot: backlog.slot, frame: backlog.start + index, input }));
    } else throw new Error('Unexpected relay binary message.');
  }
  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'joined': {
        const resumed = this.recon !== null;
        this.token = message.token;
        if (resumed) { clearTimeout(this.recon!.timer); this.recon = null; this.update({ status: 'connected', room: message.room, slot: message.slot, error: null }); }
        else this.update({ room: message.room, slot: message.slot, error: null, match: null, lastEnd: null });
        break;
      }
      case 'spectating': this.update({ room: message.room, slot: null, spectator: true, error: null, match: null, lastEnd: null }); break;
      case 'room':
        this.update({ room: message.room });
        if (message.room.phase !== 'playing' && !this.state.match) this.forget();
        break;
      case 'start':
        this.tag = matchTag(message.matchId);
        this.update({ match: message, lastEnd: null, error: null }); this.remember(message);
        // Converge on the shared clock before the start gate (and again after a resume).
        for (let burst = 1; burst <= 4; burst++) setTimeout(() => { if (this.state.match === message) this.ping(); }, burst * 150);
        this.onStart?.(immutable(message)); break;
      case 'synced': if (message.matchId === this.state.match?.matchId) { this.resyncing = false; this.onSynced?.(); } break;
      case 'input': if (message.matchId === this.state.match?.matchId) this.onInput?.(immutable(message)); break;
      case 'hash': if (message.matchId === this.state.match?.matchId) this.onHash?.(immutable(message)); break;
      case 'end':
        // Congestion can close the shared start before this peer receives start.
        if (message.matchId === this.state.match?.matchId || !this.state.match && this.state.room) { this.forget(); this.update({ match: null, lastEnd: message }); this.onEnd?.(immutable(message)); } break;
      case 'left': this.token = null; this.forget(); this.update({ room: null, slot: null, spectator: false, match: null, error: null }); break;
      case 'error':
        this.update({ error: { code: message.code, message: message.message } });
        // The held seat is gone (match closed, grace expired, build changed): stop retrying.
        if (message.code === 'RESUME_FAILED') { this.forget(); this.giveUp(message.message); }
        break;
      case 'voice-offer': case 'voice-answer': case 'voice-ice':
        // Room-scoped P2P signaling only; never affects simulation, hashes or match state.
        this.onVoice?.(immutable(message)); break;
      case 'pong': {
        const sentAt = this.pendingPings.get(message.nonce);
        if (sentAt !== undefined && Number.isFinite(message.serverNow)) {
          const rtt = Math.max(0, this.now() - sentAt); this.pendingPings.delete(message.nonce);
          // One delayed pong used to drag the whole clock: keep a window and trust its fastest
          // round trip for the offset (least queueing), its median for the displayed latency.
          this.clock.push({ rtt, offset: message.serverNow - (sentAt + this.now()) / 2 });
          if (this.clock.length > CLOCK_SAMPLES) this.clock.shift();
          const best = this.clock.reduce((a, b) => (b.rtt < a.rtt ? b : a)), sorted = this.clock.map(sample => sample.rtt).sort((a, b) => a - b);
          // Every snapshot change re-renders the room UI: only publish a clock that actually moved.
          const latencyMs = sorted[sorted.length >> 1]! / 2;
          if (this.state.latencyMs === null || Math.abs(latencyMs - this.state.latencyMs) >= 1 || Math.abs(best.offset - this.state.serverOffsetMs) >= 2) this.update({ latencyMs, serverOffsetMs: best.offset });
        }
        break;
      }
      default: throw new Error('Unexpected relay message type.');
    }
  }
  private raw(data: string | Uint8Array): boolean {
    if (!this.socket || this.socket.readyState !== 1 || this.state.status !== 'connected' && this.state.status !== 'reconnecting') return false;
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.update({ error: { code: 'CONGESTION', message: 'Connection congested. Reconnecting…' } }); this.abort(); return false;
    }
    try { this.socket.send(data as string | Uint8Array<ArrayBuffer>); return true; }
    catch { this.abort(); return false; }
  }
  private send(message: ClientMessage): boolean { return this.raw(JSON.stringify(message)); }
  private owned(message: Omit<Extract<ClientMessage, { token: string }>, 'token'> | Record<string, unknown>): boolean {
    return this.token !== null && this.state.status === 'connected' && this.send({ ...message, token: this.token } as ClientMessage);
  }
  create(options: { name: string; fingerprint: Fingerprint; rules?: RoomRules }): boolean { this.fingerprint = options.fingerprint; return this.state.status === 'connected' && this.send({ type: 'create', protocol: ROOM_PROTOCOL, ...options, binary: true }); }
  join(options: { code: string; name: string; fingerprint: Fingerprint }): boolean { this.fingerprint = options.fingerprint; return this.state.status === 'connected' && this.send({ type: 'join', protocol: ROOM_PROTOCOL, ...options, code: options.code.trim().toUpperCase(), binary: true }); }
  /** Watch a room in any phase. Answers `spectating`; mid-match the relay follows with
   * start (spectator) → every human's input log → synced. Never yields a token or a slot. */
  spectate(options: { code: string; fingerprint: Fingerprint }): boolean { return this.state.status === 'connected' && !this.state.room && this.send({ type: 'spectate', protocol: ROOM_PROTOCOL, code: options.code.trim().toUpperCase(), fingerprint: options.fingerprint, binary: true }); }
  choose(fighter: RoomFighter, costume = 0): boolean { return this.owned({ type: 'choose', fighter, ...(costume > 0 ? { costume } : {}) }); }
  /** Host-only lobby operation. null opens a CPU seat; never replaces a human. */
  setCpu(slot: number, fighter: RoomFighter | null, level?: number, costume = 0): boolean { return this.owned({ type: 'cpu', slot, fighter, ...(fighter !== null && level !== undefined ? { level } : {}), ...(fighter !== null && costume > 0 ? { costume } : {}) }); }
  updateRules(rules: RoomRules): boolean { return this.owned({ type: 'rules', rules }); }
  /** Caller attests that every selected fighter/stage asset is fully loaded. */
  ready(assetsLoaded = true): boolean { return this.owned({ type: 'ready', assetsLoaded }); }
  start(): boolean { return this.owned({ type: 'start' }); }
  /** Binary frame: the socket owns the seat, so neither token nor match id travels per frame.
   * false while reconnecting; the adapter keeps the frame and resends it after `synced`. */
  sendInput(frame: number, input: NetInput, meta?: Partial<InputMeta>): boolean {
    return this.state.match !== null && this.token !== null && !this.resyncing && this.state.status === 'connected' && this.raw(encodeInputMessage(this.tag, frame, input, meta));
  }
  sendHash(frame: number, hash: string): boolean { return this.state.match !== null && !this.resyncing && this.owned({ type: 'hash', matchId: this.state.match.matchId, frame, hash }); }
  /** All peers must attest the same confirmed final frame/hash before MATCH_COMPLETE. */
  finish(frame: number, hash: string): boolean { return this.state.match !== null && !this.resyncing && this.owned({ type: 'finish', matchId: this.state.match.matchId, frame, hash }); }
  /** Room-scoped WebRTC voice signaling. Relayed peer-to-peer only; never affects
   * simulation, rollback, hashes or match lifecycle. Requires an active room slot. */
  sendVoiceOffer(target: number, sdp: string): boolean { return this.state.room !== null && this.owned({ type: 'voice-offer', target, sdp }); }
  sendVoiceAnswer(target: number, sdp: string): boolean { return this.state.room !== null && this.owned({ type: 'voice-answer', target, sdp }); }
  sendVoiceIce(target: number, candidate: string, sdpMid?: string, sdpMLineIndex?: number): boolean {
    return this.state.room !== null && this.owned({
      type: 'voice-ice', target, candidate,
      ...(sdpMid !== undefined ? { sdpMid } : {}),
      ...(sdpMLineIndex !== undefined ? { sdpMLineIndex } : {}),
    });
  }
  /** Ends the shared match for everyone; never pauses only the local player. */
  returnToLobby(): boolean { this.forget(); return this.owned({ type: 'lobby' }); }
  /** Hidden tab: the relay holds this seat (the others stall) until the next input frame. */
  background(): boolean { return this.owned({ type: 'background' }); }
  /** A spectator owns no token, so it leaves with the token-less `unspectate`; it must also never
   * touch the stored resume credential, which may belong to a seat this browser still holds. */
  leave(): boolean { if (this.state.spectator) return this.state.status === 'connected' && this.send({ type: 'unspectate' }); this.forget(); return this.owned({ type: 'leave' }); }
  ping(): boolean {
    const oldest = Math.min(...this.pendingPings.values());
    if (this.pendingPings.size && this.now() - oldest > PING_DEAD_MS) { this.update({ error: { code: 'TIMEOUT', message: 'LAN relay heartbeat timed out.' } }); this.abort(); return false; }
    const nonce = ++this.nonce; this.pendingPings.set(nonce, this.now());
    if (!this.send({ type: 'ping', nonce })) { this.pendingPings.delete(nonce); return false; } return true;
  }
  private beat(): void { this.ping(); if (this.credential && this.state.match) { this.credential.aliveAt = this.now(); this.persist(); } }
  // ---- held-seat resume ------------------------------------------------------------------
  private persist(): void { try { if (this.credential) this.storage?.setItem(RESUME_KEY, JSON.stringify(this.credential)); } catch { /* private mode / quota */ } }
  private remember(start: MatchStart): void {
    if (!this.token || !this.state.room || this.state.slot === null || !this.fingerprint) return;
    const now = this.now();
    this.credential = { url: this.url, code: this.state.room.code, token: this.token, matchId: start.matchId, slot: this.state.slot, fingerprint: this.fingerprint, savedAt: this.credential?.matchId === start.matchId ? this.credential.savedAt : now, aliveAt: now };
    this.persist();
  }
  /** No-op while spectating: a watcher never owns a credential, and the stored one may be a held seat of this browser. */
  private forget(): void { if (this.state.spectator) return; this.credential = null; try { this.storage?.removeItem(RESUME_KEY); } catch { /* ignore */ } }
  /** A match this browser dropped out of (crash, restart, closed tab) that may still hold its
   * seat. `waitMs` > 0 means another tab looked alive a moment ago: try again after it. */
  storedResume(): { credential: ResumeCredential; waitMs: number } | null {
    try {
      const raw = this.storage?.getItem(RESUME_KEY); if (!raw) return null;
      const value = JSON.parse(raw) as ResumeCredential, now = this.now();
      if (!value || typeof value.code !== 'string' || typeof value.token !== 'string' || typeof value.matchId !== 'string' || typeof value.url !== 'string' || !Number.isFinite(value.savedAt) || now - value.savedAt > RESUME_MAX_AGE_MS || now < value.savedAt - 60_000) { this.storage?.removeItem(RESUME_KEY); return null; }
      return { credential: value, waitMs: Math.max(0, (Number.isFinite(value.aliveAt) ? value.aliveAt : 0) + ALIVE_BEAT_MS * 2 - now) };
    } catch { return null; }
  }
  /** Browser-restart path: reclaim the stored seat from frame 0. The relay answers with
   * joined → start (with `resume`) → the whole input log → synced. */
  resumeStored(fingerprint: Fingerprint): boolean {
    const stored = this.storedResume();
    if (!stored || this.socket || this.recon) return false;
    this.credential = stored.credential; this.fingerprint = fingerprint; this.token = stored.credential.token; this.url = stored.credential.url;
    this.recon = { deadline: this.now() + RECONNECT_GRACE_MS, attempt: 0, from: 0 }; this.resyncing = true;
    this.update({ status: 'reconnecting', error: null, lastEnd: null });
    this.tryResume(); return true;
  }
  private tryResume(): void {
    const credential = this.credential, recon = this.recon;
    if (!credential || !recon || !this.fingerprint) { this.giveUp('The match can no longer be resumed.'); return; }
    const fingerprint = this.fingerprint;
    this.connect(credential.url || undefined).then(() => {
      const from = recon.from ?? Math.max(0, this.options.resumeFrom?.() ?? 0);
      if (!this.send({ type: 'resume', protocol: ROOM_PROTOCOL, code: credential.code, token: credential.token, fingerprint, from, binary: true })) this.abort();
    }).catch(() => { /* closed() already scheduled the next attempt */ });
  }
  private giveUp(message: string): void {
    this.forget();
    if (this.recon) clearTimeout(this.recon.timer);
    this.recon = null;
    const socket = this.socket;
    this.closed(true, message);
    if (socket && socket.readyState < 2) socket.close(1000, 'Client disconnected.');
  }
  private readonly visibility = (): void => { if (document.visibilityState === 'hidden' && this.token) this.background(); };
  /** The page is going away but the match may not be: keep the credential so a reopened
   * browser can resume, and let it do so without waiting out the alive beat. */
  private readonly pagehide = (): void => { if (this.credential) { this.credential.aliveAt = 0; this.persist(); } this.background(); this.disconnect(); };
  /** Deliberate local close: no reconnect from this instance. The stored credential stays (only
   * leave, a finished match or a refused resume clear it), so a reopened browser can still resume. */
  disconnect(): void {
    if (this.recon) clearTimeout(this.recon.timer);
    this.recon = null;
    const socket = this.socket;
    this.closed(true);
    if (socket && socket.readyState < 2) socket.close(1000, 'Client disconnected.');
  }
  /** Involuntary close (failure, congestion, heartbeat): a running match reconnects. */
  private abort(): void {
    const socket = this.socket;
    this.closed();
    if (socket && socket.readyState < 2) socket.close(1000, 'Client disconnected.');
  }
  private closed(final = false, reason?: string): void {
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.pagehide);
    this.socket = null; this.pendingPings.clear();
    if (!final && this.options.reconnect !== false && this.credential && (this.state.match || this.recon)) {
      const now = this.now();
      this.recon ??= { deadline: now + RECONNECT_GRACE_MS, attempt: 0 }; this.resyncing = true;
      if (now < this.recon.deadline) {
        this.update({ status: 'reconnecting' });
        clearTimeout(this.recon.timer);
        this.recon.timer = setTimeout(() => this.tryResume(), Math.min(2000, 250 * 2 ** this.recon.attempt++));
        return;
      }
      reason = 'Could not reconnect to the relay in time. The shared match is closed.'; this.forget();
    }
    if (this.recon) clearTimeout(this.recon.timer);
    this.recon = null; this.token = null; this.credential = null; this.resyncing = false;
    const match = this.state.match;
    const end: MatchEnd | null = match ? { type: 'end', matchId: match.matchId, code: 'CONNECTION_CLOSED', message: reason ?? 'Relay disconnected. The shared match is closed; reconnect through the lobby.' } : null;
    this.update({ status: 'disconnected', room: null, slot: null, spectator: false, match: null, ...(end ? { lastEnd: end } : {}), ...(reason && !end ? { error: { code: 'RESUME_FAILED', message: reason } } : {}) });
    if (end) this.onEnd?.(immutable(end));
  }
}
