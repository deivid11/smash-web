import { describe, expect, it } from 'vitest';
import { RoomHub, type RoomPeer } from '../../server/rooms.ts';
import { ROOM_PROTOCOL, parseClientMessage, validRoomSummary, validRules, type Fingerprint, type NetInput, type RoomRules, type ServerMessage } from '../../lib/net/protocol.ts';
import { decodeBacklog, decodeRelayMessage, encodeInputMessage, matchTag } from '../../lib/net/input-codec.ts';

const fingerprint: Fingerprint = { game: 'spectate-test', wasm: 'a'.repeat(64), content: 'b'.repeat(64) };
const neutral: NetInput = { x: 0, jump: false, attack: false, strong: false, down: false };
const hash = 'c'.repeat(64);

class Peer implements RoomPeer {
  messages: ServerMessage[] = []; binary: Uint8Array[] = []; closed: { code: number; reason: string } | null = null;
  /** false simulates a congested socket. */
  accept = true;
  send(message: ServerMessage): boolean { if (!this.accept) return false; this.messages.push(structuredClone(message)); return true; }
  close(code: number, reason: string): void { this.closed = { code, reason }; }
  all<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] { return this.messages.filter(message => message.type === type) as Extract<ServerMessage, { type: T }>[]; }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> { return this.all(type).at(-1)!; }
}
class BinaryPeer extends Peer { sendBinary(data: Uint8Array): boolean { if (!this.accept) return false; this.binary.push(data.slice()); return true; } }

/** A lobby of `count` humans; `begin()` readies everyone and starts. Spectators attach at any point. */
function lobby(count = 2, rules?: RoomRules, options: ConstructorParameters<typeof RoomHub>[0] = {}) {
  let now = 10_000, serial = 0;
  const hub = new RoomHub({ now: () => now, token: () => `${++serial}`.padStart(48, '0'), code: () => 'ABC234', seed: () => 7, startDelayMs: 0, ...options });
  const peers = Array.from({ length: count }, () => new Peer());
  const tokens = new Map<Peer, string>();
  const send = (peer: Peer, message: Record<string, unknown>) => hub.receive(peer, JSON.stringify({ ...message, ...(tokens.has(peer) ? { token: tokens.get(peer) } : {}) }));
  peers.forEach((peer, index) => {
    hub.connect(peer);
    hub.receive(peer, JSON.stringify(index ? { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: `P${index}`, fingerprint } : { type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint, ...(rules ? { rules } : {}) }));
    tokens.set(peer, peer.last('joined').token);
  });
  const begin = () => { peers.forEach(peer => send(peer, { type: 'ready', assetsLoaded: true })); send(peers[0]!, { type: 'start' }); return peers[0]!.last('start'); };
  const spectate = <T extends Peer>(peer: T, extra: Record<string, unknown> = {}): T => { hub.connect(peer); hub.receive(peer, JSON.stringify({ type: 'spectate', protocol: ROOM_PROTOCOL, code: 'ABC234', fingerprint, ...extra })); return peer; };
  const frames = (matchId: string, from: number, to: number) => { for (let frame = from; frame <= to; frame++) for (const peer of peers) send(peer, { type: 'input', matchId, frame, input: { ...neutral, x: frame % 2 ? 1 : 0 } }); };
  return { hub, peers, send, begin, spectate, frames, advance: (ms: number) => { now += ms; } };
}

describe('spectator protocol', () => {
  it('accepts strict spectate / unspectate messages only', () => {
    const spectate = { type: 'spectate', protocol: ROOM_PROTOCOL, code: 'ABC234', fingerprint, binary: true };
    expect(parseClientMessage(JSON.stringify(spectate))).toEqual(spectate);
    expect(parseClientMessage(JSON.stringify({ type: 'unspectate' }))).toEqual({ type: 'unspectate' });
    for (const broken of [{ ...spectate, name: 'Watcher' }, { ...spectate, token: '1'.repeat(48) }, { ...spectate, protocol: ROOM_PROTOCOL - 1 }, { ...spectate, code: 'abc' }, { ...spectate, binary: 1 }, { ...spectate, fingerprint: { ...fingerprint, wasm: 'x' } }, { type: 'unspectate', token: '1'.repeat(48) }])
      expect(() => parseClientMessage(JSON.stringify(broken))).toThrow();
  });
  it('accepts hill zones 1|2 in the rules and nothing else', () => {
    const rules = { stage: 'temple', stocks: 3, timeSeconds: 180 };
    expect(validRules(rules)).toBe(true); expect(validRules({ ...rules, hill: 1 })).toBe(true); expect(validRules({ ...rules, hill: 2 })).toBe(true);
    for (const hill of [0, 3, '2', true, null, { zones: 2 }]) expect(validRules({ ...rules, hill })).toBe(false);
    expect(validRules({ ...rules, hill: 2, teams: true })).toBe(false);
    expect(() => parseClientMessage(JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint, rules: { ...rules, hill: 3 } }))).toThrow();
    expect(() => parseClientMessage(JSON.stringify({ type: 'rules', token: '1'.repeat(48), rules: { ...rules, hill: 3 } }))).toThrow();
  });
});

describe('hill rules online', () => {
  it('round-trip create → directory → room → start, and the host can switch them off again', () => {
    const rules: RoomRules = { stage: 'temple', stocks: 3, timeSeconds: 240, hill: 2 };
    const { hub, peers, send, begin } = lobby(2, rules);
    expect(peers[1]!.last('joined').room.rules).toEqual(rules);
    const listed = hub.listRooms(); expect(listed[0]!.rules).toEqual(rules); expect(listed.every(validRoomSummary)).toBe(true);
    send(peers[0]!, { type: 'rules', rules: { ...rules, hill: 1 } }); expect(peers[1]!.last('room').room.rules.hill).toBe(1);
    const start = begin(); expect(start.rules).toEqual({ ...rules, hill: 1 }); expect(peers[1]!.last('start').rules.hill).toBe(1); expect(start.seed).toBe(7);
    send(peers[0]!, { type: 'lobby' }); send(peers[0]!, { type: 'rules', rules: { stage: 'temple', stocks: 3, timeSeconds: 240 } });
    expect(peers[1]!.last('room').room.rules).not.toHaveProperty('hill');
  });
  it('drops a client that sends hill: 3', () => {
    const { hub, peers, send } = lobby(2);
    send(peers[0]!, { type: 'rules', rules: { stage: 'temple', stocks: 3, timeSeconds: 180, hill: 3 } });
    expect(peers[0]!.last('error').code).toBe('BAD_MESSAGE'); expect(peers[0]!.closed).not.toBeNull(); expect(hub.clientCount).toBe(1);
  });
});

describe('spectators', () => {
  it('watch a lobby, then receive room, start, every input and the end', () => {
    const { peers, send, begin, spectate, frames } = lobby(2);
    const watcher = spectate(new Peer());
    const answer = watcher.last('spectating'); expect(answer.room.players).toHaveLength(2); expect(answer.room.spectators).toBe(1);
    expect(watcher.all('joined')).toHaveLength(0);
    expect(peers[0]!.last('room').room.spectators).toBe(1); expect(peers[0]!.last('room').room.players).toHaveLength(2);
    send(peers[1]!, { type: 'choose', fighter: 'Kb' }); expect(watcher.last('room').room.players[1]!.fighter).toBe('Kb');
    const start = begin();
    expect(watcher.last('start')).toEqual({ ...start, spectator: true }); expect(start).not.toHaveProperty('spectator'); expect(peers[1]!.last('start')).not.toHaveProperty('spectator');
    expect(watcher.all('synced')).toHaveLength(0);
    frames(start.matchId, 0, 3);
    const seen = watcher.all('input'); expect(seen).toHaveLength(8);
    for (const slot of [0, 1]) expect(seen.filter(message => message.slot === slot).map(message => message.frame)).toEqual([0, 1, 2, 3]);
    expect(seen.find(message => message.slot === 1 && message.frame === 1)!.input.x).toBe(1);
    send(peers[0]!, { type: 'lobby' });
    expect(watcher.last('end')).toMatchObject({ matchId: start.matchId, code: 'RETURNED_TO_LOBBY' }); expect(watcher.last('room').room.phase).toBe('lobby');
  });
  it('relays binary frames to a binary spectator, including the frames of binary senders', () => {
    const { hub, peers, begin, spectate } = lobby(2);
    const watcher = spectate(new BinaryPeer(), { binary: true }), start = begin(), tag = matchTag(start.matchId);
    hub.receiveBinary(peers[0]!, encodeInputMessage(tag, 0, { ...neutral, x: -1 }, { delay: 2, adv: 1 }));
    expect(watcher.all('input')).toHaveLength(0); expect(watcher.binary).toHaveLength(1);
    expect(decodeRelayMessage(watcher.binary[0]!)).toMatchObject({ tag, slot: 0, frame: 0, meta: { delay: 2, adv: 1 } });
    // The sender itself gets no echo of a binary frame; the JSON peer still does.
    expect(peers[0]!.all('input')).toHaveLength(0); expect(peers[1]!.all('input')).toHaveLength(1);
  });
  it('joining mid-match gets start(spectator), the whole backlog from frame 0, then synced and live frames', () => {
    const { peers, begin, spectate, frames, advance } = lobby(2);
    const start = begin(); frames(start.matchId, 0, 9); advance(500);
    const watcher = spectate(new Peer());
    expect(watcher.messages.map(message => message.type)).toEqual(['hello', 'spectating', 'start', ...Array.from({ length: 20 }, () => 'input'), 'synced', 'room']);
    expect(watcher.last('start')).toMatchObject({ matchId: start.matchId, seed: start.seed, spectator: true, serverNow: 10_500 }); expect(watcher.last('start')).not.toHaveProperty('resume');
    for (const slot of [0, 1]) expect(watcher.all('input').filter(message => message.slot === slot).map(message => message.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(watcher.last('synced').matchId).toBe(start.matchId);
    frames(start.matchId, 10, 10); expect(watcher.all('input')).toHaveLength(22);
    // Members never see a second start or a synced because somebody began to watch.
    expect(peers[0]!.all('start')).toHaveLength(1); expect(peers[0]!.all('synced')).toHaveLength(0);
    const packed = spectate(new BinaryPeer(), { binary: true });
    const backlog = packed.binary.map(chunk => decodeBacklog(chunk)!); expect(backlog.every(Boolean)).toBe(true);
    for (const slot of [0, 1]) expect(backlog.filter(part => part.slot === slot).reduce((sum, part) => sum + part.inputs.length, 0)).toBe(11);
    expect(packed.all('input')).toHaveLength(0); expect(packed.last('synced').matchId).toBe(start.matchId); expect(packed.last('room').room.spectators).toBe(2);
  });
  it('refuses a mismatched build and an unknown room, and can watch an ended room', () => {
    const { hub, peers, send, begin, spectate } = lobby(2);
    const foreign = new Peer(); hub.connect(foreign);
    hub.receive(foreign, JSON.stringify({ type: 'spectate', protocol: ROOM_PROTOCOL, code: 'ABC234', fingerprint: { ...fingerprint, content: 'd'.repeat(64) } }));
    expect(foreign.last('error')).toMatchObject({ code: 'FINGERPRINT_MISMATCH' }); expect(foreign.last('error').message).toContain('content'); expect(foreign.all('spectating')).toHaveLength(0);
    hub.receive(foreign, JSON.stringify({ type: 'spectate', protocol: ROOM_PROTOCOL, code: 'ZZZ999', fingerprint })); expect(foreign.last('error').code).toBe('ROOM_NOT_FOUND');
    begin(); send(peers[0]!, { type: 'leave' });
    expect(peers[1]!.last('room').room.phase).toBe('ended');
    const watcher = spectate(new Peer()); expect(watcher.last('spectating').room).toMatchObject({ phase: 'ended', spectators: 1 }); expect(watcher.all('start')).toHaveLength(0);
  });
  it('caps the gallery at 16 and answers a second spectate with ALREADY_JOINED', () => {
    const { hub, spectate, peers } = lobby(2, undefined, { maxClients: 64 });
    const gallery = Array.from({ length: 16 }, () => spectate(new Peer()));
    expect(gallery.every(peer => peer.all('spectating').length === 1)).toBe(true); expect(peers[0]!.last('room').room.spectators).toBe(16);
    const late = spectate(new Peer()); expect(late.last('error').code).toBe('SPECTATORS_FULL'); expect(late.all('spectating')).toHaveLength(0);
    hub.receive(gallery[0]!, JSON.stringify({ type: 'spectate', protocol: ROOM_PROTOCOL, code: 'ABC234', fingerprint })); expect(gallery[0]!.last('error').code).toBe('ALREADY_JOINED');
    hub.receive(gallery[0]!, JSON.stringify({ type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'Sneak', fingerprint })); expect(gallery[0]!.last('error').code).toBe('ALREADY_JOINED'); expect(gallery[0]!.all('joined')).toHaveLength(0);
  });
  it('cannot choose, ready, start, send input or end the match, even with a stolen token', () => {
    const { hub, peers, begin, spectate, frames } = lobby(2);
    const watcher = spectate(new Peer()), token = peers[0]!.last('joined').token;
    for (const message of [{ type: 'choose', fighter: 'Kb' }, { type: 'ready', assetsLoaded: true }, { type: 'start' }, { type: 'rules', rules: { stage: 'final', stocks: 1, timeSeconds: 60 } }, { type: 'cpu', slot: 3, fighter: 'Fx' }]) {
      hub.receive(watcher, JSON.stringify({ ...message, token })); expect(watcher.last('error').code).toBe('NOT_OWNER');
    }
    expect(watcher.all('error')).toHaveLength(5); expect(watcher.closed).toBeNull();
    expect(peers[0]!.last('room').room).toMatchObject({ phase: 'lobby', rules: { stage: 'battlefield' } }); expect(peers[0]!.last('room').room.players.map(player => player.fighter)).toEqual(['Fx', 'Mr']);
    const start = begin(); frames(start.matchId, 0, 2);
    const errors = watcher.all('error').length;
    for (const message of [{ type: 'input', matchId: start.matchId, frame: 3, input: neutral }, { type: 'hash', matchId: start.matchId, frame: 0, hash }, { type: 'finish', matchId: start.matchId, frame: 2, hash }, { type: 'lobby' }, { type: 'leave' }, { type: 'background' }]) hub.receive(watcher, JSON.stringify({ ...message, token }));
    hub.receiveBinary(watcher, encodeInputMessage(matchTag(start.matchId), 3, neutral));
    expect(watcher.all('error').slice(errors).map(error => error.code)).toEqual(Array.from({ length: 7 }, () => 'NOT_OWNER'));
    expect(watcher.closed).toBeNull(); expect(watcher.all('left')).toHaveLength(0);
    expect(peers[0]!.all('end')).toHaveLength(0); expect(peers[0]!.last('room').room.phase).toBe('playing'); expect(peers[0]!.all('input').filter(message => message.frame === 3)).toHaveLength(0);
    // The match it tried to disturb still runs and still relays to it.
    frames(start.matchId, 3, 3); expect(watcher.all('input').filter(message => message.frame === 3)).toHaveLength(2);
  });
  it('disconnecting, leaving or congesting never ends or holds the match', () => {
    const { hub, peers, begin, spectate, frames, advance } = lobby(2);
    const gone = spectate(new Peer()), polite = spectate(new Peer()), slow = spectate(new Peer()), start = begin();
    frames(start.matchId, 0, 1);
    hub.disconnect(gone);
    expect(peers[0]!.all('end')).toHaveLength(0); expect(peers[0]!.last('room').room).toMatchObject({ phase: 'playing', spectators: 2 }); expect(peers[0]!.last('room').room).not.toHaveProperty('graceEndsAt');
    hub.receive(polite, JSON.stringify({ type: 'unspectate' }));
    expect(polite.last('left')).toEqual({ type: 'left' }); expect(polite.closed).toBeNull(); expect(peers[0]!.last('room').room.spectators).toBe(1);
    hub.receive(polite, JSON.stringify({ type: 'unspectate' })); expect(polite.last('error').code).toBe('NOT_SPECTATING');
    slow.accept = false; frames(start.matchId, 2, 2);
    expect(slow.closed).toMatchObject({ code: 1013 }); expect(peers[0]!.last('room').room).not.toHaveProperty('spectators');
    expect(peers[0]!.all('end')).toHaveLength(0); expect(peers[0]!.last('room').room.players.every(player => player.connected !== false)).toBe(true);
    // Nothing a watcher did counts as a stall either.
    advance(1000); frames(start.matchId, 3, 3); hub.tick(); expect(peers[0]!.all('end')).toHaveLength(0);
    expect(polite.all('input').filter(message => message.frame >= 2)).toHaveLength(0);
  });
  it('is not timed out as a roomless connection, and is not part of the finish or hash quorum', () => {
    const { hub, peers, send, begin, spectate, frames, advance } = lobby(2, undefined, { idleTimeoutMs: 10 * 60_000, inputTimeoutMs: 10 * 60_000 });
    const watcher = spectate(new Peer()), start = begin();
    advance(61_000); hub.tick(); expect(watcher.closed).toBeNull();
    frames(start.matchId, 0, 30);
    peers.forEach(peer => send(peer, { type: 'hash', matchId: start.matchId, frame: 30, hash }));
    expect(peers[0]!.last('hash')).toMatchObject({ frame: 30, hash });
    send(peers[0]!, { type: 'finish', matchId: start.matchId, frame: 30, hash }); expect(peers[0]!.all('end')).toHaveLength(0);
    send(peers[1]!, { type: 'finish', matchId: start.matchId, frame: 30, hash });
    for (const peer of [...peers, watcher]) expect(peer.last('end')).toMatchObject({ matchId: start.matchId, code: 'MATCH_COMPLETE', frame: 30 });
    expect(watcher.last('room').room).toMatchObject({ phase: 'ended', spectators: 1 });
    // An ended room can still be joined to watch the rematch.
    const late = spectate(new Peer()); expect(late.last('spectating').room.phase).toBe('ended'); expect(late.all('start')).toHaveLength(0);
  });
  it('is told the match ended and released when the last member leaves', () => {
    const { hub, peers, send, begin, spectate } = lobby(2);
    const watcher = spectate(new Peer()), start = begin();
    send(peers[0]!, { type: 'leave' });
    expect(watcher.last('end')).toMatchObject({ matchId: start.matchId, code: 'PEER_LEFT' }); expect(hub.roomCount).toBe(1);
    send(peers[1]!, { type: 'leave' });
    expect(hub.roomCount).toBe(0); expect(watcher.last('left')).toEqual({ type: 'left' }); expect(watcher.closed).toBeNull();
    // Released, not orphaned: it may watch (or join) another room on the same socket.
    hub.receive(watcher, JSON.stringify({ type: 'spectate', protocol: ROOM_PROTOCOL, code: 'ABC234', fingerprint })); expect(watcher.last('error').code).toBe('ROOM_NOT_FOUND');
  });
  it('is told when a held match dies with its last member', () => {
    const { hub, peers, begin, spectate, advance } = lobby(1, undefined, { reconnectGraceMs: 1000, idleTimeoutMs: 10 * 60_000 });
    const cpu = { type: 'cpu', slot: 1, fighter: 'Mr' };
    hub.receive(peers[0]!, JSON.stringify({ ...cpu, token: peers[0]!.last('joined').token }));
    const watcher = spectate(new Peer()), start = begin();
    hub.disconnect(peers[0]!); expect(watcher.last('room').room.players[0]!.connected).toBe(false); expect(watcher.all('end')).toHaveLength(0);
    advance(1500); hub.tick();
    expect(hub.roomCount).toBe(0); expect(watcher.last('end')).toMatchObject({ matchId: start.matchId, code: 'PEER_DISCONNECTED', slot: 0 }); expect(watcher.messages.at(-1)).toEqual({ type: 'left' });
  });
});
