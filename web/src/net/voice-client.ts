import { immutable, type VoiceSignal } from '../../../lib/net/protocol.ts';

/** What a voice mesh needs from its signaling channel. The LAN room socket (RoomClient) and the
 * global party socket (PartyClient) both fit: `slot` is this browser's mesh id, `players` the
 * group. Ids only need to be stable integers — the lower one offers. */
export interface VoiceTransport {
  onVoice?: (signal: VoiceSignal) => void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): { slot: number | null; room: { players: readonly { slot: number; name: string; control?: string }[] } | null };
  sendVoiceOffer(target: number, sdp: string): boolean;
  sendVoiceAnswer(target: number, sdp: string): boolean;
  sendVoiceIce(target: number, candidate: string, sdpMid?: string, sdpMLineIndex?: number): boolean;
}

let iceConfig: Promise<RTCIceServer[]> | null = null;
/** STUN / TURN servers from the game server (`SMASH_ICE_SERVERS`). Host candidates alone only
 * connect browsers on one LAN; players who meet through a public Internet host sit behind different NATs. */
export function loadIceServers(): Promise<RTCIceServer[]> {
  if (typeof fetch === 'undefined' || typeof location === 'undefined') return Promise.resolve([]);
  iceConfig ??= fetch('/api/voice/config', { cache: 'no-store' })
    .then(response => (response.ok ? response.json() : { iceServers: [] }))
    .then((body: { iceServers?: unknown }) => (Array.isArray(body.iceServers) ? body.iceServers as RTCIceServer[] : []))
    .catch(() => { iceConfig = null; return []; });
  return iceConfig;
}

/** Lower room slot offers to avoid glare; deterministic on stable room slots. */
export function shouldOffer(mySlot: number, remoteSlot: number): boolean {
  return mySlot < remoteSlot;
}

export interface VoicePeerView {
  slot: number; name: string; connected: boolean; speaking: boolean;
  muted: boolean; volume: number;
}
export interface VoiceSnapshot {
  /** False when WebRTC itself is unavailable (very old browser, Node tests). */
  supported: boolean;
  /** getUserMedia requires a secure context (https or localhost). LAN http IPs block the mic. */
  secure: boolean;
  enabled: boolean; requesting: boolean; muted: boolean;
  ptt: boolean; pttHeld: boolean;
  error: string;
  localSpeaking: boolean;
  peers: readonly VoicePeerView[];
}

export interface VoiceClientDeps {
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudio?: () => HTMLAudioElement;
  createAnalyser?: (stream: MediaStream) => { level: () => number; dispose: () => void };
}

interface PeerRecord {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser?: { level: () => number; dispose: () => void };
  remote: MediaStream | null;
  connected: boolean;
  speaking: boolean;
  muted: boolean;
  volume: number;
  /** Offerer only: when the last offer left and how many were sent (see retryOffers). */
  offeredAt?: number;
  offers?: number;
  loudAt?: number;
}

/** An unanswered offer is sent again after this long, then at twice the pace. */
const OFFER_RETRY_MS = 2500;
/** RMS gate of the talk indicators and how long they stay lit after the last loud sample. */
const SPEAKING_LEVEL = 0.03, SPEAKING_HOLD_MS = 700;

/** Mesh P2P voice, room-scoped. Signaling only via the central relay;
 * audio bytes never touch the relay. Simulation, rollback, hashes and match
 * lifecycle are untouched — voice peers close on room leave, never pause. */
export class VoiceClient {
  private readonly listeners = new Set<() => void>();
  private state: Readonly<VoiceSnapshot>;
  private readonly roomClient: VoiceTransport;
  private iceServers: RTCIceServer[] = [];
  private readonly deps: VoiceClientDeps;
  private readonly unsubscribeRoom: () => void;
  private readonly previousOnVoice?: (signal: VoiceSignal) => void;
  private readonly voiceHandler: (signal: VoiceSignal) => void;
  private localStream: MediaStream | null = null;
  private localAnalyser: { level: () => number; dispose: () => void } | null = null;
  private readonly peers = new Map<number, PeerRecord>();
  private readonly names = new Map<number, string>();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private localLoudAt = 0;
  private disposed = false;

  constructor(roomClient: VoiceTransport, deps: VoiceClientDeps = {}) {
    this.roomClient = roomClient;
    this.deps = deps;
    const supported = typeof RTCPeerConnection !== 'undefined' || deps.createPeer !== undefined;
    const secure = typeof window === 'undefined'
      ? true
      : (window.isSecureContext ?? false) && !!(navigator.mediaDevices?.getUserMedia ?? deps.getUserMedia);
    this.state = immutable<VoiceSnapshot>({
      supported, secure, enabled: false, requesting: false, muted: false,
      ptt: false, pttHeld: false, error: '', localSpeaking: false, peers: [],
    });
    this.previousOnVoice = roomClient.onVoice;
    this.voiceHandler = signal => {
      this.previousOnVoice?.(signal);
      void this.handleSignal(signal);
    };
    roomClient.onVoice = this.voiceHandler;
    this.unsubscribeRoom = roomClient.subscribe(() => this.syncRoom());
    this.syncRoom();
  }

  readonly getSnapshot = (): Readonly<VoiceSnapshot> => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<VoiceSnapshot>): void {
    if (this.disposed) return;
    this.state = immutable({ ...this.state, ...patch });
    for (const listener of this.listeners) listener();
  }
  private publishPeers(): void {
    const peers: VoicePeerView[] = [...this.peers.entries()].map(([slot, record]) => ({
      slot, name: this.names.get(slot) ?? `P${slot + 1}`,
      connected: record.connected, speaking: record.speaking,
      muted: record.muted, volume: record.volume,
    })).sort((a, b) => a.slot - b.slot);
    this.update({ peers });
  }

  private micActive(): boolean {
    return this.state.enabled && !this.state.muted && (!this.state.ptt || this.state.pttHeld);
  }
  private applyMicGate(): void {
    const active = this.micActive();
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = active;
  }

  /** User gesture entrypoint: requests the mic, then meshes to higher slots. */
  async enable(): Promise<void> {
    if (this.disposed || this.state.enabled || this.state.requesting) return;
    if (!this.state.supported) { this.update({ error: 'Voice chat is not supported in this browser.' }); return; }
    if (!this.state.secure && !this.deps.getUserMedia) {
      this.update({ error: 'Mic needs HTTPS or localhost. LAN http IPs block getUserMedia — voice stays off.' });
      return;
    }
    const getMedia = this.deps.getUserMedia
      ?? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    this.update({ requesting: true, error: '' });
    try {
      if (!this.deps.createPeer) this.iceServers = await loadIceServers();
      const stream = await getMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (this.disposed) { for (const track of stream.getAudioTracks()) track.stop(); return; }
      this.localStream = stream;
      try {
        this.localAnalyser = this.deps.createAnalyser?.(stream) ?? createLevelAnalyser(stream);
      } catch { this.localAnalyser = null; }
      this.update({ enabled: true, requesting: false, error: '' });
      this.applyMicGate();
      this.startPolling();
      await this.syncRoom();
    } catch (error) {
      this.update({
        requesting: false,
        error: error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Mic permission denied. Allow the mic to talk.'
          : error instanceof Error ? error.message.slice(0, 240) : 'Could not open the mic.',
      });
    }
  }

  disable(): void {
    if (!this.state.enabled && !this.localStream && this.peers.size === 0) return;
    for (const [, record] of this.peers) this.teardownPeer(record);
    this.peers.clear();
    this.names.clear();
    this.localAnalyser?.dispose();
    this.localAnalyser = null;
    for (const track of this.localStream?.getAudioTracks() ?? []) track.stop();
    this.localStream = null;
    this.stopPolling();
    this.update({ enabled: false, requesting: false, muted: false, pttHeld: false, localSpeaking: false, peers: [], error: '' });
  }

  setMuted(muted: boolean): void {
    this.update({ muted });
    this.applyMicGate();
  }
  setPtt(ptt: boolean): void {
    this.update({ ptt, ...(ptt ? {} : { pttHeld: false }) });
    this.applyMicGate();
  }
  setPttHeld(held: boolean): void {
    if (!this.state.ptt) return;
    this.update({ pttHeld: held });
    this.applyMicGate();
  }
  setRemoteMuted(slot: number, muted: boolean): void {
    const record = this.peers.get(slot);
    if (!record) return;
    record.muted = muted;
    try { record.audio.muted = muted; } catch { /* detached test doubles */ }
    this.publishPeers();
  }
  setRemoteVolume(slot: number, volume: number): void {
    const record = this.peers.get(slot);
    if (!record) return;
    const clamped = Math.max(0, Math.min(1, volume));
    record.volume = clamped;
    try { record.audio.volume = clamped; } catch { /* detached test doubles */ }
    this.publishPeers();
  }

  private mySlot(): number | null {
    return this.roomClient.getSnapshot().slot;
  }
  private remoteHumans(): Array<{ slot: number; name: string }> {
    const snapshot = this.roomClient.getSnapshot();
    const room = snapshot.room;
    if (!room || snapshot.slot === null) return [];
    return room.players
      .filter(player => player.slot !== snapshot.slot && (player.control ?? 'human') === 'human')
      .map(player => ({ slot: player.slot, name: player.name }));
  }

  private async syncRoom(): Promise<void> {
    if (this.disposed) return;
    const mySlot = this.mySlot();
    if (mySlot === null || !this.state.enabled || !this.localStream) {
      // Not in a room, or voice off: drop stale peers but keep the mic for rejoin.
      if (mySlot === null && this.peers.size) {
        for (const [, record] of this.peers) this.teardownPeer(record);
        this.peers.clear();
        this.names.clear();
        this.publishPeers();
      } else if (mySlot !== null) {
        const alive = new Set(this.remoteHumans().map(peer => peer.slot));
        let changed = false;
        for (const [slot, record] of [...this.peers]) {
          if (!alive.has(slot)) { this.teardownPeer(record); this.peers.delete(slot); this.names.delete(slot); changed = true; }
        }
        if (changed) this.publishPeers();
      }
      return;
    }
    const remotes = this.remoteHumans();
    for (const remote of remotes) this.names.set(remote.slot, remote.name);
    // Close peers whose slot vanished.
    const alive = new Set(remotes.map(peer => peer.slot));
    let changed = false;
    for (const [slot, record] of [...this.peers]) {
      if (!alive.has(slot)) { this.teardownPeer(record); this.peers.delete(slot); this.names.delete(slot); changed = true; }
    }
    // Lower slot offers; higher slot waits. No glare, no duplicate meshes.
    for (const remote of remotes) {
      if (this.peers.has(remote.slot) || !shouldOffer(mySlot, remote.slot)) continue;
      try {
        await this.offer(remote.slot);
        changed = true;
      } catch (error) {
        this.update({ error: error instanceof Error ? error.message.slice(0, 240) : 'Voice offer failed.' });
      }
    }
    if (changed || this.state.peers.length !== this.peers.size) this.publishPeers();
    else {
      // Refresh display names without rebuilding peers.
      const current = this.state.peers;
      if (current.some(peer => this.names.get(peer.slot) !== peer.name)) this.publishPeers();
    }
  }

  private createConnection(slot: number): RTCPeerConnection {
    const create = this.deps.createPeer
      ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));
    // The server decides (SMASH_ICE_SERVERS): STUN by default, [] keeps a LAN party on host candidates.
    const pc = create({ iceServers: this.iceServers });
    const audio = this.deps.createAudio?.() ?? new Audio();
    try {
      audio.autoplay = true;
      (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audio.muted = this.peers.get(slot)?.muted ?? false;
      audio.volume = this.peers.get(slot)?.volume ?? 1;
    } catch { /* test doubles */ }
    const record: PeerRecord = {
      pc, audio, remote: null, connected: false, speaking: false,
      muted: this.peers.get(slot)?.muted ?? false,
      volume: this.peers.get(slot)?.volume ?? 1,
    };
    this.peers.set(slot, record);
    for (const track of this.localStream?.getTracks() ?? []) {
      try { pc.addTrack(track, this.localStream!); } catch { /* closed mid-join */ }
    }
    pc.onicecandidate = event => {
      if (this.disposed || !this.roomClient.getSnapshot().room) return;
      if (event.candidate?.candidate) {
        this.roomClient.sendVoiceIce(slot, event.candidate.candidate, event.candidate.sdpMid ?? undefined, event.candidate.sdpMLineIndex ?? undefined);
      } else {
        // End-of-candidates: empty string, bounded and schema-valid.
        this.roomClient.sendVoiceIce(slot, '');
      }
    };
    pc.ontrack = event => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      record.remote = stream;
      try {
        audio.srcObject = stream;
        void audio.play().catch(() => { /* autoplay waits for a gesture; enable() already had one */ });
      } catch { /* test doubles */ }
      try {
        record.analyser?.dispose();
        record.analyser = this.deps.createAnalyser?.(stream) ?? createLevelAnalyser(stream);
      } catch { record.analyser = undefined; }
    };
    pc.onconnectionstatechange = () => {
      record.connected = pc.connectionState === 'connected';
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') record.speaking = false;
      this.publishPeers();
    };
    return pc;
  }

  private teardownPeer(record: PeerRecord): void {
    try { record.analyser?.dispose(); } catch { /* ignore */ }
    try { record.pc.onicecandidate = null; record.pc.ontrack = null; record.pc.onconnectionstatechange = null; } catch { /* ignore */ }
    try { record.pc.close(); } catch { /* ignore */ }
    try {
      const src = record.audio.srcObject as MediaStream | null;
      record.audio.pause?.();
      record.audio.srcObject = null;
      void src;
    } catch { /* test doubles */ }
  }

  private async offer(slot: number): Promise<void> {
    const previous = this.peers.get(slot)?.offers ?? 0;
    const pc = this.createConnection(slot);
    const record = this.peers.get(slot)!;
    record.offeredAt = Date.now(); record.offers = previous + 1;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (!pc.localDescription?.sdp) throw new Error('Voice offer has no SDP.');
    this.roomClient.sendVoiceOffer(slot, pc.localDescription.sdp);
    this.publishPeers();
  }

  private async handleSignal(signal: VoiceSignal): Promise<void> {
    if (this.disposed || !this.state.enabled || !this.localStream) return;
    const mySlot = this.mySlot();
    if (mySlot === null) return;
    const known = new Set(this.remoteHumans().map(peer => peer.slot));
    if (!known.has(signal.from)) return;
    this.names.set(signal.from, this.names.get(signal.from) ?? `P${signal.from + 1}`);
    try {
      if (signal.type === 'voice-offer') {
        // A repeated offer means the offerer gave up on the previous attempt: start clean.
        const stale = this.peers.get(signal.from);
        if (stale) { const { muted, volume } = stale; this.teardownPeer(stale); this.peers.set(signal.from, { ...stale, muted, volume }); }
        const pc = this.createConnection(signal.from);
        // Answerer path: higher slot waits for the lower slot's offer.
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (!pc.localDescription?.sdp) throw new Error('Voice answer has no SDP.');
        this.roomClient.sendVoiceAnswer(signal.from, pc.localDescription.sdp);
        this.publishPeers();
      } else if (signal.type === 'voice-answer') {
        const record = this.peers.get(signal.from);
        // A late answer to an offer that was already replaced by a retry is not an error.
        if (!record || record.pc.signalingState !== 'have-local-offer') return;
        await record.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      } else {
        const record = this.peers.get(signal.from);
        if (!record || !signal.candidate) return;
        await record.pc.addIceCandidate(new RTCIceCandidate({
          candidate: signal.candidate,
          sdpMid: signal.sdpMid ?? null,
          sdpMLineIndex: signal.sdpMLineIndex ?? null,
        }));
      }
    } catch (error) {
      // Trickle candidates of a replaced attempt fail harmlessly; only negotiation errors are shown.
      if (signal.type === 'voice-ice') return;
      this.update({ error: error instanceof Error ? error.message.slice(0, 240) : 'Voice negotiation failed.' });
    }
  }

  /** The answering side drops an offer that arrives before its player enabled voice (it has no
   * mic to answer with), and nothing else ever asks again: the lower slot keeps offering until
   * the peer connects. Also heals a lost signal and a failed ICE attempt. */
  private retryOffers(): void {
    const mySlot = this.mySlot();
    if (mySlot === null || !this.state.enabled || !this.localStream) return;
    const now = Date.now();
    for (const [slot, record] of [...this.peers]) {
      if (record.connected || !shouldOffer(mySlot, slot) || record.offeredAt === undefined) continue;
      if (now - record.offeredAt < OFFER_RETRY_MS * ((record.offers ?? 1) > 5 ? 2 : 1)) continue;
      const { muted, volume, offers } = record;
      this.teardownPeer(record);
      // createConnection reads the previous record's mute/volume before replacing it.
      this.peers.set(slot, { ...record, muted, volume, offers });
      void this.offer(slot).catch(() => { /* next tick retries */ });
    }
  }
  private startPolling(): void {
    if (this.pollTimer !== undefined) return;
    this.pollTimer = setInterval(() => {
      if (this.disposed) return;
      try {
        // The ring holds for a moment after the last loud sample: syllables and short sounds are
        // briefer than a poll, and a flickering indicator reads as a broken mic.
        const now = Date.now();
        if (this.micActive() && (this.localAnalyser?.level() ?? 0) > SPEAKING_LEVEL) this.localLoudAt = now;
        const speaking = this.micActive() && now - this.localLoudAt < SPEAKING_HOLD_MS;
        if (speaking !== this.state.localSpeaking) this.update({ localSpeaking: speaking });
        let changed = false;
        for (const [, record] of this.peers) {
          if ((record.analyser?.level() ?? 0) > SPEAKING_LEVEL) record.loudAt = now;
          const voice = record.connected !== false && !record.muted && now - (record.loudAt ?? 0) < SPEAKING_HOLD_MS;
          // Before ontrack fires there is no analyser; keep the last flag.
          if (record.analyser && voice !== record.speaking) { record.speaking = voice; changed = true; }
        }
        if (changed) this.publishPeers();
        this.retryOffers();
      } catch { /* analysis must never break the match */ }
    }, 100);
    if (typeof (this.pollTimer as unknown as { unref?: () => void }).unref === 'function') {
      (this.pollTimer as unknown as { unref: () => void }).unref();
    }
  }
  private stopPolling(): void {
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeRoom();
    if (this.roomClient.onVoice === this.voiceHandler) {
      this.roomClient.onVoice = this.previousOnVoice;
    }
    for (const [, record] of this.peers) this.teardownPeer(record);
    this.peers.clear();
    this.localAnalyser?.dispose();
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      try { track.stop(); } catch { /* ignore */ }
    }
    this.localStream = null;
    this.stopPolling();
    this.listeners.clear();
  }
}

function createLevelAnalyser(stream: MediaStream): { level: () => number; dispose: () => void } {
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is unavailable.');
  const context = new Ctor();
  // Created after the awaited mic prompt, so the gesture may be spent: a suspended context reads silence.
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  return {
    level: () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]! - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / data.length);
    },
    dispose: () => {
      try { source.disconnect(); } catch { /* ignore */ }
      try { void context.close(); } catch { /* ignore */ }
    },
  };
}
