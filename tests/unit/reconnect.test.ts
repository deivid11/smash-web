import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { RoomHub, type RoomPeer } from '../../server/rooms.ts';
import { ROOM_PROTOCOL, parseClientMessage, type Fingerprint, type MatchStart, type NetInput, type ServerMessage } from '../../lib/net/protocol.ts';
import { decodeBacklog, decodeInputMessage, decodeInputPayload, decodeRelayMessage, encodeBacklog, encodeInputMessage, encodeInputPayload, encodeRelayMessage, inputPayloadLength, matchTag } from '../../lib/net/input-codec.ts';
import { RollbackDriver, normalizeInput } from '../../lib/game/rollback.ts';
import { neutralInput, type LocalMatch, type MatchEvent, type MatchState, type PlayerInput } from '../../lib/game/match.ts';
import { RoomClient } from '../../web/src/net/room-client.ts';

const fingerprint: Fingerprint = { game: 'reconnect-test', wasm: 'a'.repeat(64), content: 'b'.repeat(64) };
const neutral: NetInput = { x: 0, jump: false, attack: false, strong: false, down: false };

class Peer implements RoomPeer {
  messages: ServerMessage[] = []; closed: { code: number; reason: string } | null = null;
  send(message: ServerMessage): boolean { this.messages.push(structuredClone(message)); return true; }
  close(code: number, reason: string): void { this.closed = { code, reason }; }
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] { return this.messages.filter(message => message.type === type) as Extract<ServerMessage, { type: T }>[]; }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> { return this.all(type).at(-1)!; }
}
function room(count = 2, options: ConstructorParameters<typeof RoomHub>[0] = {}) {
  let now = 10_000, serial = 0;
  const hub = new RoomHub({ now: () => now, token: () => `${++serial}`.padStart(48, '0'), code: () => 'ABC234', seed: () => 7, startDelayMs: 0, ...options });
  const peers = Array.from({ length: count }, () => new Peer());
  const tokens = new Map<Peer, string>();
  const send = (peer: Peer, message: Record<string, unknown>) => hub.receive(peer, JSON.stringify({ ...message, ...(['create', 'join', 'ping', 'resume'].includes(message.type as string) ? {} : { token: tokens.get(peer) }) }));
  peers.forEach((peer, index) => {
    hub.connect(peer);
    send(peer, index ? { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: `P${index}`, fingerprint } : { type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint });
    tokens.set(peer, peer.last('joined').token);
  });
  peers.forEach(peer => send(peer, { type: 'ready', assetsLoaded: true })); send(peers[0]!, { type: 'start' });
  const start = peers[0]!.last('start');
  const resume = (token: string, from = 0) => { const peer = new Peer(); hub.connect(peer); tokens.set(peer, token); send(peer, { type: 'resume', protocol: ROOM_PROTOCOL, code: 'ABC234', token, fingerprint, from }); return peer; };
  // Fake peers answer no transport pings: keep every still-open one alive across clock jumps.
  return { hub, peers, tokens, send, start, resume, advance: (ms: number) => { now += ms; for (const peer of tokens.keys()) if (!peer.closed) hub.heartbeat(peer); } };
}

describe('binary input codec', () => {
  const analog: NetInput = { x: 0.4375, y: -0.71, jump: true, attack: false, strong: true, down: false, special: true, specialDirection: 'side', shield: false, grab: true, walk: false, cX: -1, cY: 0.123456789 };
  it('round-trips canonical inputs exactly, digital frames in three bytes', () => {
    expect(encodeInputPayload(neutral)).toHaveLength(3);
    expect(encodeInputPayload({ ...neutral, x: -1, y: 1, jump: true })).toHaveLength(3);
    expect(decodeInputPayload(encodeInputPayload(analog))).toEqual(analog);
    // The codec and the rollback driver agree on the canonical record (absent → false/0, -0 → 0).
    for (const input of [neutral, analog, { ...neutral, x: -0, cX: -0, cY: -0 }]) {
      const decoded = decodeInputPayload(encodeInputPayload(input));
      expect(decoded).toEqual(normalizeInput(input as PlayerInput));
      for (const axis of ['x', 'y', 'cX', 'cY'] as const) expect(Object.is(decoded[axis], -0)).toBe(false);
    }
  });
  it('is an order of magnitude smaller than the JSON frame and keeps pacing hints out of the payload', () => {
    const json = JSON.stringify({ type: 'input', token: '0'.repeat(48), matchId: '1'.repeat(48), frame: 12345, input: normalizeInput(neutral as PlayerInput) });
    const binary = encodeInputMessage(matchTag('1'.repeat(48)), 12345, neutral, { delay: 2, adv: -3 });
    expect(binary.length).toBe(14); expect(json.length / binary.length).toBeGreaterThan(15);
    expect(decodeInputMessage(binary)).toMatchObject({ tag: matchTag('1'.repeat(48)), frame: 12345, meta: { delay: 2, adv: -3 } });
    const relay = decodeRelayMessage(encodeRelayMessage(9, 7, 42, encodeInputPayload(analog), { delay: 1, adv: 5 }))!;
    expect(relay).toMatchObject({ tag: 9, slot: 7, frame: 42, meta: { delay: 1, adv: 5 } }); expect(decodeInputPayload(relay.payload)).toEqual(analog);
  });
  it('rejects truncated, oversized-axis and trailing-garbage frames', () => {
    const good = encodeInputMessage(1, 0, analog);
    expect(decodeInputMessage(good.slice(0, good.length - 1))).toBeNull();
    expect(decodeInputMessage(new Uint8Array([...good, 0]))).toBeNull();
    const bad = encodeInputPayload({ ...neutral, x: 0.5 }); new DataView(bad.buffer).setFloat64(3, 1.5, true);
    expect(inputPayloadLength(bad, 0)).toBe(-1);
    const direction = encodeInputPayload(neutral); direction[1] = 5; expect(inputPayloadLength(direction, 0)).toBe(-1);
  });
  it('run-length encodes a whole match log into bounded chunks', () => {
    const frames = Array.from({ length: 10_800 }, (_, frame) => encodeInputPayload(frame % 600 < 590 ? { ...neutral, x: 1 } : { ...analog, x: (frame % 7) / 8 }));
    const chunks = encodeBacklog(3, 1, 100, frames);
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBeLessThan(8000);
    let next = 100; const decoded: NetInput[] = [];
    for (const chunk of chunks) { const part = decodeBacklog(chunk)!; expect(part.start).toBe(next); expect(part.slot).toBe(1); next += part.inputs.length; decoded.push(...part.inputs); }
    expect(decoded).toHaveLength(frames.length);
    decoded.forEach((input, index) => expect(encodeInputPayload(input)).toEqual(frames[index]));
  });
});

describe('held seats and resume on the relay', () => {
  it('validates the resume command strictly', () => {
    const resume = { type: 'resume', protocol: ROOM_PROTOCOL, code: 'ABC234', token: 't'.repeat(48), fingerprint, from: 0 };
    expect(parseClientMessage(JSON.stringify(resume))).toEqual(resume);
    for (const broken of [{ ...resume, from: -1 }, { ...resume, code: 'abc' }, { ...resume, protocol: 7 }, { ...resume, slot: 1 }, { ...resume, token: '' }]) expect(() => parseClientMessage(JSON.stringify(broken))).toThrow();
  });
  it('holds a dropped seat, reports it, and replays the log to the token holder', () => {
    const { hub, peers, tokens, send, start, resume, advance } = room();
    const [a, b] = peers as [Peer, Peer];
    for (let frame = 0; frame < 5; frame++) { send(a, { type: 'input', matchId: start.matchId, frame, input: { ...neutral, x: frame / 8 } }); if (frame < 3) send(b, { type: 'input', matchId: start.matchId, frame, input: { ...neutral, jump: frame === 1 } }); }
    hub.disconnect(b);
    expect(a.all('end')).toHaveLength(0);
    const held = a.last('room').room; expect(held.phase).toBe('playing'); expect(held.players[1]).toMatchObject({ slot: 1, connected: false }); expect(held.graceEndsAt).toBe(10_000 + 90_000);
    // Waiting for a held seat is neither an input stall nor match time.
    advance(60_000); hub.tick(); expect(a.all('end')).toHaveLength(0);
    const stranger = resume('f'.repeat(48)); expect(stranger.last('error').code).toBe('RESUME_FAILED');
    const back = resume(tokens.get(b)!, 1);
    expect(back.last('joined')).toMatchObject({ slot: 1, token: tokens.get(b) });
    expect(back.last('start')).toMatchObject({ matchId: start.matchId, seed: 7, resume: { lastFrame: 2, lastHash: -1, finished: false } });
    const log = back.all('input'); expect(log.filter(input => input.slot === 0).map(input => input.frame)).toEqual([1, 2, 3, 4]); expect(log.filter(input => input.slot === 1).map(input => input.frame)).toEqual([1, 2]);
    expect(log.find(input => input.slot === 0 && input.frame === 3)!.input.x).toBe(3 / 8); expect(log.find(input => input.slot === 1 && input.frame === 1)!.input.jump).toBe(true);
    expect(back.messages.at(-2)).toEqual({ type: 'synced', matchId: start.matchId });
    expect(a.last('room').room.players[1]!.connected).toBeUndefined();
    // The resumed socket owns the seat again and continues its own frame sequence.
    send(back, { type: 'input', matchId: start.matchId, frame: 3, input: neutral });
    expect(a.last('input')).toMatchObject({ slot: 1, frame: 3 });
    advance(9000); hub.tick(); advance(9000); hub.tick(); expect(a.all('end')).toHaveLength(0);
    advance(11_000); hub.tick(); expect(a.last('end').code).toBe('INPUT_TIMEOUT');
  });
  it('closes the match and frees the seat when the grace period runs out', () => {
    const { hub, peers, tokens, resume, advance } = room();
    hub.disconnect(peers[1]!); advance(90_001); hub.tick();
    expect(peers[0]!.last('end')).toMatchObject({ code: 'PEER_DISCONNECTED', slot: 1 });
    expect(peers[0]!.last('room').room.players.map(player => player.slot)).toEqual([0]);
    expect(resume(tokens.get(peers[1]!)!).last('error').code).toBe('RESUME_FAILED');
  });
  it('keeps a room alive for its only human, then deletes it when nobody comes back', () => {
    const { hub, peers, advance } = room();
    hub.disconnect(peers[0]!); hub.disconnect(peers[1]!);
    expect(hub.roomCount).toBe(1); expect(hub.clientCount).toBe(0);
    advance(90_001); hub.tick(); expect(hub.roomCount).toBe(0);
  });
  it('lets a resumed socket take over a half-open one and never resumes a hard leave', () => {
    const { hub, peers, tokens, send, resume } = room(3);
    const takeover = resume(tokens.get(peers[2]!)!);
    expect(peers[2]!.closed?.reason).toContain('Replaced'); expect(takeover.last('start').resume).toBeDefined(); expect(peers[0]!.all('end')).toHaveLength(0);
    hub.disconnect(peers[2]!); expect(peers[0]!.last('room').room.players[2]!.connected).toBeUndefined();
    send(peers[1]!, { type: 'leave' }); expect(peers[0]!.last('end').code).toBe('PEER_LEFT');
    expect(resume(tokens.get(peers[1]!)!).last('error').code).toBe('RESUME_FAILED');
  });
  it('treats a hidden tab as a hold that the next input frame lifts', () => {
    const { hub, peers, send, start, advance } = room();
    send(peers[1]!, { type: 'background' });
    expect(peers[0]!.all('end')).toHaveLength(0); expect(peers[0]!.last('room').room.players[1]!.connected).toBe(false);
    advance(30_000); hub.tick(); expect(peers[0]!.all('end')).toHaveLength(0);
    send(peers[1]!, { type: 'input', matchId: start.matchId, frame: 0, input: neutral });
    expect(peers[0]!.last('room').room.players[1]!.connected).toBeUndefined();
    send(peers[1]!, { type: 'background' }); advance(90_001); hub.tick();
    expect(peers[0]!.last('end').code).toBe('PEER_BACKGROUND');
  });
  it('relays binary frames to binary peers without echo and rejects a wrong match tag', () => {
    const hub = new RoomHub({ startDelayMs: 0, code: () => 'ABC234' });
    class BinaryPeer extends Peer { frames: Uint8Array[] = []; sendBinary(data: Uint8Array): boolean { this.frames.push(data.slice()); return true; } }
    const a = new BinaryPeer(), b = new BinaryPeer(); hub.connect(a); hub.connect(b);
    hub.receive(a, JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'A', fingerprint, binary: true }));
    hub.receive(b, JSON.stringify({ type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'B', fingerprint, binary: true }));
    for (const peer of [a, b]) hub.receive(peer, JSON.stringify({ type: 'ready', assetsLoaded: true, token: peer.last('joined').token }));
    hub.receive(a, JSON.stringify({ type: 'start', token: a.last('joined').token }));
    const tag = matchTag(a.last('start').matchId);
    hub.receiveBinary(a, encodeInputMessage(tag, 0, { ...neutral, x: 0.25 }, { delay: 2, adv: 1 }));
    expect(a.frames).toHaveLength(0); expect(b.frames).toHaveLength(1); expect(b.all('input')).toHaveLength(0);
    const relay = decodeRelayMessage(b.frames[0]!)!; expect(relay).toMatchObject({ tag, slot: 0, frame: 0, meta: { delay: 2, adv: 1 } }); expect(decodeInputPayload(relay.payload).x).toBe(0.25);
    hub.receiveBinary(b, encodeInputMessage(tag ^ 1, 0, neutral)); expect(b.last('error').code).toBe('STALE_MATCH');
    hub.receiveBinary(b, new Uint8Array([1, 2, 3])); expect(b.closed?.reason).toContain('Invalid');
  });
});

function world(count = 2): LocalMatch {
  const match = {
    frame: 0, phase: 'ready' as LocalMatch['phase'], events: [] as MatchEvent[], value: 0,
    fighters: Array.from({ length: count }, () => ({ special: null as { serial: number } | null })), options: { opponent: 'human', controllers: null },
    controllerKinds: Array.from({ length: count }, () => 'human' as const),
    start() { this.phase = 'playing'; },
    step(inputs: readonly PlayerInput[]) { this.frame++; this.value = (this.value * 31 + inputs.reduce((sum, input, slot) => sum + Math.round(input.x * 8) * (slot + 1) + (input.jump ? 5 : 0), 0)) % 1_000_003; this.events = []; },
    captureState() { return structuredClone({ frame: this.frame, phase: this.phase, events: this.events, remainingFrames: this.value, fighters: this.fighters }) as unknown as MatchState; },
    restoreState(state: MatchState) { this.frame = state.frame; this.phase = state.phase; this.events = structuredClone(state.events); this.value = state.remainingFrames; this.fighters = structuredClone(state.fighters); },
    stateHash() { return [...sha256(new TextEncoder().encode(JSON.stringify(this.captureState())))].map(byte => byte.toString(16).padStart(2, '0')).join(''); },
  };
  return match as unknown as LocalMatch;
}

describe('rollback driver input delay and replay', () => {
  it('schedules local input `delay` frames ahead and hands every frame to the relay once, in order', () => {
    const driver = new RollbackDriver(world(), 0, 2, { inputDelay: 2 });
    expect(driver.advance({ ...neutralInput(), x: 1 })).toBe(true);
    expect(driver.drainOutgoing().map(out => [out.frame, out.input.x])).toEqual([[0, 0], [1, 0], [2, 1]]);
    expect(driver.advance({ ...neutralInput(), x: -1 })).toBe(true);
    expect(driver.drainOutgoing().map(out => [out.frame, out.input.x])).toEqual([[3, -1]]); expect(driver.drainOutgoing()).toEqual([]);
    expect(() => new RollbackDriver(world(), 0, 2, { inputDelay: 8 })).toThrow();
  });
  it('a delayed remote frame that arrives before it is simulated needs no rollback', () => {
    const driver = new RollbackDriver(world(), 0, 2, { inputDelay: 0 });
    driver.receive(0, 1, { ...neutralInput(), x: 1 }); driver.receive(1, 1, { ...neutralInput(), x: 1 });
    driver.advance(neutralInput()); driver.advance(neutralInput());
    expect(driver.stats.rollbacks).toBe(0); expect(driver.confirmedFrame).toBe(1);
  });
  it('a restarted peer replays the relay log to the identical state and keeps its logged local frames', () => {
    const live = new RollbackDriver(world(), 0, 2, { hashInterval: 10 }), log: PlayerInput[][] = [[], []];
    for (let frame = 0; frame < 95; frame++) {
      log[0]![frame] = { ...neutralInput(), x: ((frame * 3) % 9 - 4) / 8, jump: frame % 11 === 0 }; log[1]![frame] = { ...neutralInput(), x: ((frame * 5) % 7 - 3) / 8 };
      live.advance(log[0]![frame]!); live.receive(frame, 1, log[1]![frame]!);
    }
    // The relay holds five more local frames than remote ones (the ragged tail of a real drop).
    for (let frame = 95; frame < 100; frame++) { log[0]![frame] = { ...neutralInput(), x: 0.5 }; live.advance(log[0]![frame]!); }
    const rebuilt = new RollbackDriver(world(), 0, 2, { hashInterval: 10, inputDelay: 1 });
    for (let frame = 0; frame < 95; frame++) { rebuilt.preload(frame, 0, log[0]![frame]!); rebuilt.preload(frame, 1, log[1]![frame]!); expect(rebuilt.replayStep(95 - frame > 12)).toBe(true); rebuilt.drainConfirmedEvents(); }
    expect(rebuilt.replayStep()).toBe(false);
    for (let frame = 95; frame < 100; frame++) rebuilt.preload(frame, 0, log[0]![frame]!);
    expect(rebuilt.confirmedFrame).toBe(94); expect(rebuilt.stateHash(90)).toBe(live.stateHash(90));
    // Live again: the pad is ignored for frames the relay already holds, and only new frames go out.
    for (let frame = 95; frame < 100; frame++) expect(rebuilt.advance({ ...neutralInput(), x: -1 })).toBe(true);
    expect(rebuilt.drainOutgoing().map(out => out.frame)).toEqual([100]);
    for (let frame = 95; frame < 100; frame++) { const input = { ...neutralInput(), x: 0.25 }; rebuilt.receive(frame, 1, input); live.receive(frame, 1, input); }
    expect(rebuilt.confirmedFrame).toBe(99); expect(live.confirmedFrame).toBe(99);
    live.advance({ ...neutralInput(), x: -1 }); live.receive(100, 1, neutralInput()); rebuilt.advance(neutralInput()); rebuilt.receive(100, 1, neutralInput());
    expect(rebuilt.stateHash(100)).toBe(live.stateHash(100));
    expect(() => rebuilt.preload(3, 1, neutralInput())).toThrow();
  });
});

/** In-memory socket pair: ordered, delayed, and killable without a close handshake. */
class Link extends EventTarget {
  readyState = 1; bufferedAmount = 0; binaryType = 'blob'; readonly peer: RoomPeer;
  constructor(readonly hub: RoomHub, readonly delay = 5) {
    super();
    const deliver = (data: unknown) => setTimeout(() => { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data })); }, delay);
    this.peer = { send: message => { deliver(JSON.stringify(message)); return true; }, sendBinary: data => { deliver(data.slice().buffer); return true; }, close: () => this.close() };
    hub.connect(this.peer);
  }
  send(data: string | Uint8Array): void { const copy = typeof data === 'string' ? data : data.slice(); setTimeout(() => { if (this.readyState !== 1) return; if (typeof copy === 'string') this.hub.receive(this.peer, copy); else this.hub.receiveBinary(this.peer, copy); }, this.delay); }
  close(): void { if (this.readyState === 3) return; this.readyState = 3; this.hub.disconnect(this.peer); this.dispatchEvent(new Event('close')); }
}
function memoryStorage() { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; }

afterEach(() => vi.useRealTimers());
describe('RoomClient reconnect', () => {
  async function pair() {
    vi.useFakeTimers(); vi.setSystemTime(500_000);
    const hub = new RoomHub({ startDelayMs: 0 }), links: Link[][] = [[], []], inputs: number[][] = [[], []], synced = [0, 0], starts: MatchStart[][] = [[], []], storages = [memoryStorage(), memoryStorage()];
    const make = (index: number) => new RoomClient({ url: 'ws://test/api/rooms', storage: storages[index]!, createSocket: () => { const link = new Link(hub); links[index]!.push(link); return link as unknown as WebSocket; }, onInput: message => inputs[index]!.push(message.frame), onSynced: () => { synced[index]!++; }, onStart: start => starts[index]!.push(start), resumeFrom: () => 2 });
    const clients = [make(0), make(1)];
    const connecting = clients.map(client => client.connect()); await vi.advanceTimersByTimeAsync(50); await Promise.all(connecting);
    clients[0]!.create({ name: 'Host', fingerprint }); await vi.advanceTimersByTimeAsync(50);
    clients[1]!.join({ code: clients[0]!.getSnapshot().room!.code, name: 'Guest', fingerprint }); await vi.advanceTimersByTimeAsync(50);
    clients.forEach(client => client.ready()); await vi.advanceTimersByTimeAsync(50); clients[0]!.start(); await vi.advanceTimersByTimeAsync(50);
    return { hub, clients, links, inputs, synced, starts, storages, make };
  }
  it('reopens a socket lost mid-match, reclaims the seat and only sends again after synced', async () => {
    const { hub, clients, links, inputs, synced, starts } = await pair();
    for (let frame = 0; frame < 4; frame++) clients.forEach(client => expect(client.sendInput(frame, neutral)).toBe(true));
    await vi.advanceTimersByTimeAsync(50); expect(inputs[1]).toEqual([0, 1, 2, 3]);
    links[1]![0]!.close();
    expect(clients[1]!.getSnapshot()).toMatchObject({ status: 'reconnecting' }); expect(clients[1]!.getSnapshot().match).not.toBeNull();
    expect(clients[1]!.sendInput(4, neutral)).toBe(false);
    clients[0]!.sendInput(4, neutral); await vi.advanceTimersByTimeAsync(100);
    expect(clients[0]!.getSnapshot().room!.players[1]!.connected).toBe(false); expect(clients[0]!.getSnapshot().match).not.toBeNull();
    await vi.advanceTimersByTimeAsync(400);
    expect(clients[1]!.getSnapshot().status).toBe('connected'); expect(links[1]).toHaveLength(2); expect(synced[1]).toBe(1);
    expect(starts[1]!.at(-1)!.resume).toEqual({ lastFrame: 3, lastHash: -1, finished: false });
    // Backlog from resumeFrom() = 2: both seats' frames 2.., including the frame sent while this client was away.
    expect(inputs[1]!.slice(4).sort((a, b) => a - b)).toEqual([2, 2, 3, 3, 4]);
    expect(clients[1]!.sendInput(4, neutral)).toBe(true); await vi.advanceTimersByTimeAsync(50);
    expect(clients[0]!.getSnapshot().room!.players[1]!.connected).toBeUndefined(); expect(inputs[0]!.at(-1)).toBe(4);
    clients.forEach(client => client.disconnect()); hub.shutdown();
  });
  it('resumes from a stored credential after a browser restart and forgets it when the match is gone', async () => {
    const { hub, clients, storages, make, links } = await pair();
    clients.forEach(client => client.sendInput(0, { ...neutral, x: 1 })); await vi.advanceTimersByTimeAsync(2100);
    // The tab dies without a goodbye; a fresh page finds the credential the old one kept alive.
    links[1]![0]!.readyState = 3; hub.disconnect(links[1]![0]!.peer); clients[1]!.disconnect();
    const log: Array<[number, number, number]> = []; let done = 0;
    const reborn = make(1); reborn.onInput = message => log.push([message.slot, message.frame, message.input.x]); reborn.onSynced = () => { done++; };
    const stored = reborn.storedResume()!; expect(stored.credential).toMatchObject({ slot: 1, code: clients[0]!.getSnapshot().room!.code }); expect(stored.waitMs).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(stored.waitMs + 10); expect(reborn.storedResume()!.waitMs).toBe(0);
    expect(reborn.resumeStored(fingerprint)).toBe(true); await vi.advanceTimersByTimeAsync(100);
    expect(reborn.getSnapshot()).toMatchObject({ status: 'connected', slot: 1 }); expect(reborn.getSnapshot().match!.resume).toMatchObject({ lastFrame: 0 });
    expect(done).toBe(1); expect(log.sort()).toEqual([[0, 0, 1], [1, 0, 1]]);
    clients[0]!.returnToLobby(); await vi.advanceTimersByTimeAsync(100);
    expect(storages[1]!.getItem('smash.room.resume')).toBeNull();
    const late = make(1); expect(late.storedResume()).toBeNull();
    reborn.disconnect(); clients[0]!.disconnect(); hub.shutdown();
  });
  it('gives up with a clear end when the relay refuses the resume', async () => {
    const { hub, clients, links } = await pair();
    const ends: string[] = []; clients[1]!.onEnd = end => ends.push(end.code);
    links[1]![0]!.readyState = 3; hub.disconnect(links[1]![0]!.peer); clients[0]!.returnToLobby(); await vi.advanceTimersByTimeAsync(20);
    links[1]![0]!.dispatchEvent(new Event('close')); await vi.advanceTimersByTimeAsync(1000);
    expect(clients[1]!.getSnapshot()).toMatchObject({ status: 'disconnected', match: null, room: null }); expect(ends).toEqual(['CONNECTION_CLOSED']);
    clients[0]!.disconnect(); hub.shutdown();
  });
});
