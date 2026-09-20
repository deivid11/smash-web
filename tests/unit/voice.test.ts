import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  MAX_VOICE_CANDIDATE, MAX_VOICE_SDP, ROOM_PROTOCOL,
  parseClientMessage, validVoiceCandidate, validVoiceSdp, validVoiceSlot,
  type Fingerprint,
} from '../../lib/net/protocol.ts';
import { RoomHub, type RoomPeer } from '../../server/rooms.ts';
import { RoomClient } from '../../web/src/net/room-client.ts';
import { VoiceClient, shouldOffer } from '../../web/src/net/voice-client.ts';
import type { ServerMessage } from '../../lib/net/protocol.ts';

const fingerprint: Fingerprint = { game: 'voice-test-v1', wasm: 'a'.repeat(64), content: 'b'.repeat(64) };
const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=msid:s a\r\n';
const candidate = 'candidate:1 1 udp 2113937151 192.168.1.2 54400 typ host';

class Peer implements RoomPeer {
  messages: ServerMessage[] = []; closed: { code: number; reason: string } | null = null;
  send(message: ServerMessage): boolean { this.messages.push(structuredClone(message)); return true; }
  close(code: number, reason: string): void { this.closed = { code, reason }; }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> {
    return this.messages.filter(message => message.type === type).at(-1) as Extract<ServerMessage, { type: T }>;
  }
  get token(): string { return this.last('joined').token; }
}
function setup(count = 2) {
  let serial = 0;
  const hub = new RoomHub({ now: () => 10_000, token: () => `${++serial}`.padStart(48, '0'), code: () => 'ABC234', seed: () => 1, startDelayMs: 0, reconnectGraceMs: 0 });
  const peers = Array.from({ length: count }, () => new Peer());
  peers.forEach(peer => hub.connect(peer));
  const send = (peer: Peer, message: object) => hub.receive(peer, JSON.stringify({
    ...message,
    ...('type' in message && !['create', 'join', 'ping'].includes(message.type as string) ? { token: peer.token } : {}),
  }));
  send(peers[0]!, { type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint });
  peers.slice(1).forEach((peer, index) => send(peer, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: `Guest ${index}`, fingerprint }));
  return { hub, peers, send };
}

describe('voice protocol validation', () => {
  it('requires v10, including installed character-pack identities', () => expect(ROOM_PROTOCOL).toBe(10));
  it('accepts bounded offers, answers and trickle ICE', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'voice-offer', token: 't', target: 1, sdp }))).toMatchObject({ type: 'voice-offer', target: 1 });
    expect(parseClientMessage(JSON.stringify({ type: 'voice-answer', token: 't', target: 0, sdp }))).toMatchObject({ type: 'voice-answer' });
    expect(parseClientMessage(JSON.stringify({ type: 'voice-ice', token: 't', target: 1, candidate }))).toMatchObject({ type: 'voice-ice' });
    expect(parseClientMessage(JSON.stringify({ type: 'voice-ice', token: 't', target: 1, candidate: '', sdpMid: '0', sdpMLineIndex: 0 }))).toMatchObject({ candidate: '' });
  });
  it.each([
    JSON.stringify({ type: 'voice-offer', token: 't', target: 1, sdp: 'too-short' }),
    JSON.stringify({ type: 'voice-offer', token: 't', target: 1, sdp: 'x'.repeat(16) }),
    JSON.stringify({ type: 'voice-offer', token: 't', target: 1, sdp: `v=0 no-crlf-${'x'.repeat(20)}` }),
    JSON.stringify({ type: 'voice-offer', token: 't', target: 1, sdp: `v=0\r\n${'\u0000'.repeat(20)}` }),
    JSON.stringify({ type: 'voice-offer', token: 't', target: 1, sdp: `v=0\r\n${'x'.repeat(MAX_VOICE_SDP)}` }),
    JSON.stringify({ type: 'voice-offer', token: 't', target: 8, sdp }),
    JSON.stringify({ type: 'voice-offer', token: 't', target: -1, sdp }),
    JSON.stringify({ type: 'voice-offer', token: 't', target: 1, sdp, from: 0 }),
    JSON.stringify({ type: 'voice-offer', token: 't', target: 1 }),
    JSON.stringify({ type: 'voice-answer', token: 't', target: 1, sdp: '' }),
    JSON.stringify({ type: 'voice-ice', token: 't', target: 1, candidate: `x\r\n injected` }),
    JSON.stringify({ type: 'voice-ice', token: 't', target: 1, candidate: 'x'.repeat(MAX_VOICE_CANDIDATE + 1) }),
    JSON.stringify({ type: 'voice-ice', token: 't', target: 1, candidate, sdpMid: '' }),
    JSON.stringify({ type: 'voice-ice', token: 't', target: 1, candidate, sdpMLineIndex: 99 }),
    JSON.stringify({ type: 'voice-ice', token: 't', target: 1, candidate, slot: 0 }),
  ])('rejects invalid voice payload %#', raw => expect(() => parseClientMessage(raw)).toThrow());
  it('validates voice helpers directly', () => {
    expect(validVoiceSlot(7)).toBe(true); expect(validVoiceSlot(8)).toBe(false);
    expect(validVoiceSdp(sdp)).toBe(true); expect(validVoiceSdp('v=0 short')).toBe(false);
    expect(validVoiceCandidate('')).toBe(true); expect(validVoiceCandidate(candidate)).toBe(true);
    expect(validVoiceCandidate('a\nb')).toBe(false);
  });
  it('lower slot offers to avoid glare', () => {
    expect(shouldOffer(0, 1)).toBe(true); expect(shouldOffer(1, 0)).toBe(false);
    expect(shouldOffer(2, 2)).toBe(false); expect(shouldOffer(0, 7)).toBe(true);
  });
});

describe('room hub voice relay', () => {
  it('relays offers only to the target with the server-assigned sender', () => {
    const { peers, send } = setup(3);
    send(peers[0]!, { type: 'voice-offer', target: 2, sdp });
    expect(peers[2]!.last('voice-offer')).toMatchObject({ from: 0, sdp });
    expect(peers[1]!.messages.some(message => message.type === 'voice-offer')).toBe(false);
    // Spoofed from fields never survive parsing.
    expect(() => parseClientMessage(JSON.stringify({ type: 'voice-offer', token: 't', target: 1, sdp, from: 2 }))).toThrow();
  });
  it('relays answers and ICE with extras intact', () => {
    const { peers, send } = setup();
    send(peers[1]!, { type: 'voice-answer', target: 0, sdp });
    expect(peers[0]!.last('voice-answer')).toMatchObject({ from: 1, sdp });
    send(peers[0]!, { type: 'voice-ice', target: 1, candidate, sdpMid: '0', sdpMLineIndex: 0 });
    expect(peers[1]!.last('voice-ice')).toMatchObject({ from: 0, candidate, sdpMid: '0', sdpMLineIndex: 0 });
    send(peers[1]!, { type: 'voice-ice', target: 0, candidate: '' });
    expect(peers[0]!.last('voice-ice')).toMatchObject({ from: 1, candidate: '' });
  });
  it('rejects self, missing and CPU targets without closing the match', () => {
    const { peers, send } = setup();
    peers.forEach(peer => send(peer, { type: 'ready', assetsLoaded: true }));
    send(peers[0]!, { type: 'start' });
    const begin = peers[0]!.last('start');
    expect(begin.players).toHaveLength(2);
    send(peers[0]!, { type: 'voice-offer', target: 0, sdp });
    expect(peers[0]!.last('error').code).toBe('VOICE_TARGET');
    send(peers[0]!, { type: 'voice-offer', target: 7, sdp });
    expect(peers[0]!.last('error').code).toBe('VOICE_TARGET');
    // Match still lives; inputs still relay.
    send(peers[0]!, { type: 'input', matchId: begin.matchId, frame: 0, input: { x: 0, jump: false, attack: false, strong: false, down: false } });
    expect(peers[1]!.last('input')).toMatchObject({ slot: 0, frame: 0 });
    expect(peers[0]!.last('room').room.phase).toBe('playing');
  });
  it('rejects CPU seats as voice targets', () => {
    const { peers, send } = setup(1);
    send(peers[0]!, { type: 'cpu', slot: 7, fighter: 'Kb' });
    send(peers[0]!, { type: 'voice-offer', target: 7, sdp });
    expect(peers[0]!.last('error').code).toBe('VOICE_TARGET');
  });
  it('keeps voice alive across playing and lobby without unreadying', () => {
    const { peers, send } = setup();
    peers.forEach(peer => send(peer, { type: 'ready', assetsLoaded: true }));
    expect(peers[0]!.last('room').room.players.every(player => player.ready)).toBe(true);
    send(peers[0]!, { type: 'voice-offer', target: 1, sdp });
    expect(peers[0]!.last('room').room.players.every(player => player.ready)).toBe(true);
    send(peers[0]!, { type: 'start' });
    send(peers[1]!, { type: 'voice-answer', target: 0, sdp });
    expect(peers[0]!.last('voice-answer')).toMatchObject({ from: 1 });
    expect(peers[0]!.last('room').room.phase).toBe('playing');
    send(peers[0]!, { type: 'lobby' });
    send(peers[1]!, { type: 'voice-ice', target: 0, candidate });
    expect(peers[0]!.last('voice-ice')).toMatchObject({ from: 1 });
  });
  it('isolates voice by room and charges trickle ICE less than commands', () => {
    const { hub, peers, send } = setup(2);
    const other = new Peer(); hub.connect(other);
    hub.receive(other, JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Other', fingerprint }));
    send(peers[0]!, { type: 'voice-offer', target: 1, sdp });
    expect(other.messages.some(message => message.type === 'voice-offer')).toBe(false);
    // Prior create (12) + offer (12) leave 216; 50 trickle candidates (200) still
    // fit while 20 full-cost commands (240) would not. Trickle ICE costs 4.
    for (let i = 0; i < 50; i++) send(peers[0]!, { type: 'voice-ice', target: 1, candidate });
    expect(peers[0]!.closed).toBeNull();
    for (let i = 0; i < 10; i++) send(peers[0]!, { type: 'voice-ice', target: 1, candidate });
    expect(peers[0]!.closed?.reason).toContain('rate limit');
  });
});

class DelayedSocket extends EventTarget {
  readyState = 1; bufferedAmount = 0; readonly peer: RoomPeer;
  constructor(readonly hub: RoomHub, readonly delay: number) {
    super();
    this.peer = {
      send: message => { setTimeout(() => { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }, delay); return true; },
      close: () => this.close(),
    };
    hub.connect(this.peer);
  }
  send(data: string): void { setTimeout(() => { if (this.readyState === 1) this.hub.receive(this.peer, data); }, this.delay); }
  close(): void { if (this.readyState === 3) return; this.readyState = 3; this.hub.disconnect(this.peer); this.dispatchEvent(new Event('close')); }
}
afterEach(() => vi.useRealTimers());

describe('RoomClient voice signaling', () => {
  it('sends offers only with a room and delivers immutable signals', async () => {
    vi.useFakeTimers();
    const hub = new RoomHub({ startDelayMs: 0 });
    const received: ServerMessage[] = [];
    const sockets: DelayedSocket[] = [];
    const clients = [0, 1].map(() => new RoomClient({
      url: 'ws://test/api/rooms',
      createSocket: () => { const socket = new DelayedSocket(hub, 1); sockets.push(socket); return socket as unknown as WebSocket; },
      onVoice: signal => received.push(signal),
    }));
    const connecting = clients.map(client => client.connect());
    await vi.advanceTimersByTimeAsync(20); await Promise.all(connecting);
    expect(clients[0]!.sendVoiceOffer(1, sdp)).toBe(false);
    clients[0]!.create({ name: 'Host', fingerprint }); await vi.advanceTimersByTimeAsync(20);
    const code = clients[0]!.getSnapshot().room!.code;
    clients[1]!.join({ code, name: 'Guest', fingerprint }); await vi.advanceTimersByTimeAsync(20);
    expect(clients[0]!.sendVoiceOffer(1, sdp)).toBe(true);
    expect(clients[0]!.sendVoiceIce(1, candidate, '0', 0)).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ type: 'voice-offer', from: 0 });
    expect(Object.isFrozen(received[0])).toBe(true);
    clients.forEach(client => client.disconnect()); hub.shutdown();
  });
});

// Minimal WebRTC doubles for VoiceClient mesh logic (no browser media in unit tests).
function fakeMediaStream(): MediaStream {
  const track = { enabled: true, stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack;
  return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}
interface FakePeer {
  instance: {
    addTrack: ReturnType<typeof vi.fn>; createOffer: ReturnType<typeof vi.fn>;
    createAnswer: ReturnType<typeof vi.fn>; setLocalDescription: ReturnType<typeof vi.fn>;
    setRemoteDescription: ReturnType<typeof vi.fn>; addIceCandidate: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>; connectionState: string;
    localDescription: { sdp: string } | null;
    onicecandidate: ((event: { candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null }) => void) | null;
    ontrack: ((event: { streams: MediaStream[] }) => void) | null;
    onconnectionstatechange: (() => void) | null;
  };
}
function fakePeerFactory(created: FakePeer[]): (config: RTCConfiguration) => RTCPeerConnection {
  return () => {
    const instance: FakePeer['instance'] = {
      addTrack: vi.fn(), close: vi.fn(),
      createOffer: vi.fn(async () => ({ type: 'offer', sdp })),
      createAnswer: vi.fn(async () => ({ type: 'answer', sdp })),
      setLocalDescription: vi.fn(async (desc: { sdp?: string }) => { instance.localDescription = { sdp: desc.sdp ?? sdp }; }),
      setRemoteDescription: vi.fn(async () => {}),
      addIceCandidate: vi.fn(async () => {}),
      connectionState: 'new', localDescription: null,
      onicecandidate: null, ontrack: null, onconnectionstatechange: null,
    };
    created.push({ instance });
    return instance as unknown as RTCPeerConnection;
  };
}
function stubRoomClient(slot: number | null, players: Array<{ slot: number; name: string; control?: 'human' | 'cpu' }>) {
  const listeners = new Set<() => void>();
  const sent: Array<{ kind: string; target: number }> = [];
  const room = slot === null ? null : { code: 'ABC234', hostSlot: 0, phase: 'lobby' as const, rules: { stage: 'battlefield' as const, stocks: 3, timeSeconds: 180 }, fingerprint, players: players.map(player => ({ ...player, fighter: 'Fx' as const, ready: true })) };
  const stub = {
    onVoice: undefined as ((signal: ServerMessage) => void) | undefined,
    getSnapshot: () => ({ status: 'connected' as const, room, slot, match: null, error: null, lastEnd: null, latencyMs: null as number | null, serverOffsetMs: 0 }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    sendVoiceOffer: (target: number, offer: string) => { sent.push({ kind: 'offer', target }); void offer; return true; },
    sendVoiceAnswer: (target: number, answer: string) => { sent.push({ kind: 'answer', target }); void answer; return true; },
    sendVoiceIce: (target: number) => { sent.push({ kind: 'ice', target }); return true; },
    emit: () => { for (const listener of listeners) listener(); },
  };
  return { stub, sent };
}

describe('VoiceClient mesh ownership', () => {
  it('lower slots offer, higher slots wait, and leave closes peers', async () => {
    const created: FakePeer[] = [];
    const audio = { autoplay: false, muted: false, volume: 1, srcObject: null as unknown, play: vi.fn(async () => {}), pause: vi.fn() } as unknown as HTMLAudioElement;
    const { stub, sent } = stubRoomClient(0, [{ slot: 0, name: 'Host' }, { slot: 1, name: 'Guest' }, { slot: 2, name: 'CPU', control: 'cpu' }]);
    const voice = new VoiceClient(stub as unknown as RoomClient, {
      createPeer: fakePeerFactory(created),
      getUserMedia: async () => fakeMediaStream(),
      createAudio: () => audio,
      createAnalyser: () => ({ level: () => 0, dispose: () => {} }),
    });
    await voice.enable();
    expect(voice.getSnapshot().enabled).toBe(true);
    expect(created).toHaveLength(1);
    expect(sent).toMatchObject([{ kind: 'offer', target: 1 }]);
    // CPU slot 2 never meshes.
    expect(sent.some(entry => entry.target === 2)).toBe(false);
    // Answer path creates the return peer without an extra offer.
    const higher = stubRoomClient(1, [{ slot: 0, name: 'Host' }, { slot: 1, name: 'Guest' }]);
    const higherCreated: FakePeer[] = [];
    const higherVoice = new VoiceClient(higher.stub as unknown as RoomClient, {
      createPeer: fakePeerFactory(higherCreated),
      getUserMedia: async () => fakeMediaStream(),
      createAudio: () => ({ ...audio } as unknown as HTMLAudioElement),
      createAnalyser: () => ({ level: () => 0, dispose: () => {} }),
    });
    await higherVoice.enable();
    expect(higherCreated).toHaveLength(0);
    expect(higher.sent).toEqual([]);
    await higher.stub.onVoice?.({ type: 'voice-offer', from: 0, sdp } as ServerMessage);
    // handleSignal is fire-and-forget async (setRemoteDescription/createAnswer).
    for (let i = 0; i < 10 && higher.sent.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(higherCreated).toHaveLength(1);
    expect(higher.sent).toMatchObject([{ kind: 'answer', target: 0 }]);
    // Mute gates the mic track; remote volume/mute apply locally only.
    voice.setMuted(true);
    expect(voice.getSnapshot().muted).toBe(true);
    voice.setRemoteVolume(1, 0.5);
    expect(voice.getSnapshot().peers[0]?.volume).toBe(0.5);
    voice.setRemoteMuted(1, true);
    expect(voice.getSnapshot().peers[0]?.muted).toBe(true);
    voice.disable();
    expect(voice.getSnapshot().enabled).toBe(false);
    expect(created[0]!.instance.close).toHaveBeenCalled();
    voice.dispose(); higherVoice.dispose();
  });
  it('requires a secure context for the mic unless injected', async () => {
    const { stub } = stubRoomClient(0, [{ slot: 0, name: 'A' }]);
    const voice = new VoiceClient(stub as unknown as RoomClient, { createPeer: fakePeerFactory([]) });
    // Node has no window: constructor treats it as secure-capable.
    expect(voice.getSnapshot().supported).toBe(true);
    voice.dispose();
  });
});
