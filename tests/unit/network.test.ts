import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomHub, type RoomPeer } from '../../server/rooms.ts';
import { parseClientMessage, ROOM_PROTOCOL, MAX_ROOM_PAYLOAD, MAX_MATCH_FRAME, type Fingerprint, type MatchStart, type ServerMessage } from '../../lib/net/protocol.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';
import { contentFingerprint, sha256Hex } from '../../lib/net/fingerprint.ts';
import { RoomClient } from '../../web/src/net/room-client.ts';

const fingerprint: Fingerprint = { game: 'prototype-test-v1', wasm: 'a'.repeat(64), content: 'b'.repeat(64) };
const input = { x: 0.5, jump: false, attack: true, strong: false, down: false };
class Peer implements RoomPeer {
  messages: ServerMessage[] = []; closed: { code: number; reason: string } | null = null; congested = false; rejectType?: ServerMessage['type'];
  send(message: ServerMessage): boolean { if (this.congested || message.type === this.rejectType) return false; this.messages.push(structuredClone(message)); return true; }
  close(code: number, reason: string): void { this.closed = { code, reason }; }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> { return this.messages.filter(message => message.type === type).at(-1) as Extract<ServerMessage, { type: T }>; }
  get token(): string { return this.last('joined').token; }
}
function setup(count = 2) {
  let now = 10_000, serial = 0;
  const hub = new RoomHub({ now: () => now, token: () => `${++serial}`.padStart(48, '0'), code: () => 'ABC234', seed: () => 123, startDelayMs: 0, reconnectGraceMs: 0 });
  const peers = Array.from({ length: count }, () => new Peer());
  peers.forEach(peer => hub.connect(peer));
  const send = (peer: Peer, message: object) => hub.receive(peer, JSON.stringify({ ...message, ...('type' in message && !['create', 'join', 'ping'].includes(message.type as string) ? { token: peer.token } : {}) }));
  send(peers[0]!, { type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint });
  peers.slice(1).forEach((peer, index) => send(peer, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: `Player ${index + 1}`, fingerprint }));
  const advance = (ms: number) => { now += ms; };
  const start = () => { peers.forEach(peer => send(peer, { type: 'ready', assetsLoaded: true })); send(peers[0]!, { type: 'start' }); return peers[0]!.last('start'); };
  return { hub, peers, send, advance, start };
}

describe('bounded room protocol and fingerprints', () => {
  it.each([
    'null', '[]', '{}', '{', JSON.stringify({ type: 'ping', nonce: -1 }), JSON.stringify({ type: 'ping', nonce: 1, slot: 1 }),
    JSON.stringify({ type: 'input', token: 'abc', matchId: 'x', frame: 0, input: { ...input, x: 2 } }),
    JSON.stringify({ type: 'input', token: 'abc', matchId: 'x', frame: 0, input: { ...input, jump: 1 } }),
    JSON.stringify({ type: 'input', token: 'abc', matchId: 'x', frame: 0, input: { ...input, extra: true } }),
    JSON.stringify({ type: 'input', token: 'abc', matchId: 'x', frame: 0.5, input }),
    JSON.stringify({ type: 'input', token: 'abc', matchId: 'x', frame: 9999999, input }),
    JSON.stringify({ type: 'create', protocol: 999, name: 'x', fingerprint }),
    JSON.stringify({ type: 'create', protocol: 1, name: 'Legacy four-slot client', fingerprint }),
    JSON.stringify({ type: 'create', protocol: 2, name: 'Legacy human-only client', fingerprint }),
    ...[-1, 8, 1.5, '1', null].map(slot => JSON.stringify({ type: 'cpu', token: 'abc', slot, fighter: 'Fx' })),
    ...[undefined, 'Unknown', 0].map(fighter => JSON.stringify({ type: 'cpu', token: 'abc', slot: 1, fighter })),
    JSON.stringify({ type: 'cpu', token: 'abc', slot: 1, fighter: 'Fx', control: 'human' }),
    ...[0, 10, 1.5, '5', null].map(level => JSON.stringify({ type: 'cpu', token: 'abc', slot: 1, fighter: 'Fx', level })),
    JSON.stringify({ type: 'create', protocol: 3, name: 'Legacy no-CPU-level client', fingerprint }),
    JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'x', fingerprint: { ...fingerprint, content: '/private/file.iso' } }),
    ' '.repeat(4097),
  ])('rejects invalid payload %#', raw => expect(() => parseClientMessage(raw)).toThrow());
  it('accepts bounded full original input fields without simulation imports', () => {
    const payload = { type: 'input', token: 'abc', matchId: 'match', frame: 0, input: { ...input, y: -1, special: true, specialDirection: 'side', shield: false, grab: true, walk: false } };
    expect(parseClientMessage(JSON.stringify(payload))).toEqual(payload);
  });
  it('hashes bytes locally, canonicalizes name order and prevents ambiguous concatenation', () => {
    const a = new Uint8Array([1, 2]), b = new Uint8Array([3]);
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(contentFingerprint([['a', a], ['b', b]])).toBe(contentFingerprint([['b', b], ['a', a]]));
    expect(contentFingerprint([['a', a], ['b', b]])).not.toBe(contentFingerprint([['a', b], ['b', a]]));
    expect(() => contentFingerprint([])).toThrow(); expect(() => contentFingerprint([['a', a], ['a', b]])).toThrow();
  });
});

describe('simulation-independent room state machine', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('starts %i browsers with the same seed, start, rules and stable owned slots', count => {
    const { peers, start, send } = setup(count), begin = start();
    expect(begin.seed).toBe(123); expect(begin.startAt).toBe(10000); expect(begin.players.map(player => player.slot)).toEqual(Array.from({ length: count }, (_, i) => i));
    peers.forEach(peer => expect(peer.last('start')).toEqual(begin));
    peers.forEach((peer, slot) => send(peer, { type: 'input', matchId: begin.matchId, frame: 0, input: { ...input, x: slot / count } }));
    for (const peer of peers) expect(peer.messages.filter(message => message.type === 'input')).toHaveLength(count);
    expect(JSON.stringify(peers[0]!.last('room'))).not.toContain(peers[0]!.token);
  });
  it('requires two players, all readiness and host ownership', () => {
    const { peers, send } = setup(), [host, guest] = peers as [Peer, Peer];
    send(host, { type: 'start' }); expect(host.last('error').code).toBe('NOT_READY');
    send(guest, { type: 'start' }); expect(guest.last('error').code).toBe('HOST_ONLY');
    send(guest, { type: 'rules', rules: { stage: 'final', stocks: 4, timeSeconds: 60 } }); expect(guest.last('error').code).toBe('HOST_ONLY');
    send(host, { type: 'ready', assetsLoaded: true }); send(guest, { type: 'ready', assetsLoaded: true });
    send(host, { type: 'rules', rules: { stage: 'final', stocks: 4, timeSeconds: 60 } });
    expect(host.last('room').room.players.every(player => !player.ready)).toBe(true);
    send(host, { type: 'start' }); expect(host.last('error').code).toBe('NOT_READY');
  });
  it('requires a fresh asset-ready attestation after character changes', () => {
    const { peers, send } = setup();
    peers.forEach(peer => send(peer, { type: 'ready', assetsLoaded: true }));
    send(peers[1]!, { type: 'choose', fighter: 'Kb' });
    expect(peers[0]!.last('room').room.players.map(player => player.ready)).toEqual([false, false]);
  });
  it('keeps survivor slots stable, transfers host, and fills the first vacant slot', () => {
    const { hub, peers, send } = setup(4);
    send(peers[0]!, { type: 'leave' });
    expect(peers[1]!.last('room').room.hostSlot).toBe(1);
    expect(peers[1]!.last('room').room.players.map(player => player.slot)).toEqual([1, 2, 3]);
    const next = new Peer(); hub.connect(next); send(next, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'Replacement', fingerprint });
    expect(next.last('joined').slot).toBe(0); expect(next.last('joined').room.hostSlot).toBe(1);
  });
  it('rejects a ninth browser and mismatched actual content identity', () => {
    const { hub, send } = setup(MAX_MATCH_PLAYERS); const extra = new Peer(); hub.connect(extra);
    send(extra, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'Extra', fingerprint }); expect(extra.last('error')).toMatchObject({ code: 'ROOM_FULL', message: 'This room already has 8 players.' });
    const pair = setup(2), mismatch = new Peer(); pair.hub.connect(mismatch);
    pair.send(mismatch, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'Wrong content', fingerprint: { ...fingerprint, content: 'c'.repeat(64) } });
    expect(mismatch.last('error')).toMatchObject({ code: 'FINGERPRINT_MISMATCH', message: expect.stringContaining('content') });
  });
  it.each([2, 8])('does not accept another socket token with %i owned room slots', count => {
    const { hub, peers, start } = setup(count), begin = start(), intruder = peers[count - 1]!;
    hub.receive(intruder, JSON.stringify({ type: 'input', token: peers[0]!.token, matchId: begin.matchId, frame: 0, input }));
    expect(intruder.closed).not.toBeNull(); expect(peers[0]!.last('end').code).toBe('NOT_OWNER');
    expect(peers[0]!.messages.some(message => message.type === 'input')).toBe(false);
  });
  it.each([2, 8])('rejects spoofed slot fields instead of relaying them in a %i-peer room', count => {
    const { hub, peers, start } = setup(count), begin = start(), intruder = peers[count - 1]!;
    hub.receive(intruder, JSON.stringify({ type: 'input', token: intruder.token, matchId: begin.matchId, slot: 0, frame: 0, input }));
    expect(peers[0]!.last('end').code).toBe('BAD_MESSAGE');
  });
  it.each([1, 500])('rejects skipped or runaway frame %i', frame => {
    const { peers, start, send } = setup(), begin = start();
    send(peers[1]!, { type: 'input', matchId: begin.matchId, frame, input });
    expect(peers[1]!.last('error').code).toBe('FRAME_ORDER'); expect(peers[0]!.last('end').code).toBe('FRAME_ORDER');
  });
  it('compares canonical confirmed hashes and closes all peers with useful diagnostics', () => {
    const { peers, start, send } = setup(), begin = start();
    peers.forEach(peer => send(peer, { type: 'input', matchId: begin.matchId, frame: 0, input }));
    send(peers[0]!, { type: 'hash', matchId: begin.matchId, frame: 0, hash: 'a'.repeat(64) });
    send(peers[1]!, { type: 'hash', matchId: begin.matchId, frame: 0, hash: 'b'.repeat(64) });
    expect(peers[0]!.last('end')).toMatchObject({ code: 'DESYNC', frame: 0, hashes: { 0: 'a'.repeat(64), 1: 'b'.repeat(64) } });
    expect(peers[1]!.last('room').room.phase).toBe('ended');
  });
  it.each([2, 8])('requires all %i canonical hashes and final-state attestations for clean completion', count => {
    const { peers, start, send } = setup(count), begin = start(), last = peers[count - 1]!;
    peers.forEach(peer => send(peer, { type: 'input', matchId: begin.matchId, frame: 0, input }));
    peers.slice(0, -1).forEach(peer => send(peer, { type: 'hash', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }));
    peers.forEach(peer => expect(peer.messages.some(message => message.type === 'hash')).toBe(false));
    send(last, { type: 'hash', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
    peers.forEach(peer => expect(peer.last('hash')).toMatchObject({ frame: 0, hash: fingerprint.wasm }));
    peers.slice(0, -1).forEach(peer => send(peer, { type: 'finish', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }));
    expect(peers[0]!.last('room').room.phase).toBe('playing');
    send(last, { type: 'finish', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
    peers.forEach(peer => expect(peer.last('end').code).toBe('MATCH_COMPLETE'));
  });
  it.each(['leave', 'background', 'lobby'])('%s closes the match for everyone rather than pausing one browser', type => {
    const { peers, start, send } = setup(); start(); send(peers[1]!, { type });
    expect(peers[0]!.last('end').code).toBe({ leave: 'PEER_LEFT', background: 'PEER_BACKGROUND', lobby: 'RETURNED_TO_LOBBY' }[type]);
    expect(peers[0]!.last('room').room.phase).not.toBe('playing');
  });
  it.each(['lobby', 'background'])('discards only the just-closed match in-flight frames after %s and through rematch', type => {
    const { peers, start, send, advance } = setup(), first = start();
    send(peers[0]!, { type });
    const late = () => {
      send(peers[1]!, { type: 'input', matchId: first.matchId, frame: 0, input });
      send(peers[1]!, { type: 'hash', matchId: first.matchId, frame: 0, hash: fingerprint.wasm });
      send(peers[1]!, { type: 'finish', matchId: first.matchId, frame: 0, hash: fingerprint.wasm });
    };
    late();
    if (type === 'background') send(peers[0]!, { type: 'lobby' });
    advance(1000);
    const next = start(); expect(next.matchId).not.toBe(first.matchId); late();
    for (const peer of peers) expect(peer.messages.filter(message => ['error', 'input', 'hash'].includes(message.type))).toEqual([]);
    send(peers[1]!, { type: 'input', matchId: next.matchId, frame: 0, input });
    expect(peers[0]!.last('input')).toMatchObject({ matchId: next.matchId, frame: 0 });
    send(peers[1]!, { type: 'hash', matchId: 'unrelated-match', frame: 0, hash: fingerprint.wasm });
    expect(peers[1]!.last('error').code).toBe('STALE_MATCH');
    // Only one bounded tombstone is retained, not an ever-growing match history.
    advance(1000); send(peers[0]!, { type: 'lobby' });
    send(peers[1]!, { type: 'input', matchId: first.matchId, frame: 0, input });
    expect(peers[1]!.messages.filter(message => message.type === 'error')).toHaveLength(2);
    expect(peers[1]!.last('error').code).toBe('STALE_MATCH');
  });
  it('still validates ownership, bounds and rate limits for just-closed traffic', () => {
    const { hub, peers, start, send } = setup(), first = start(); send(peers[0]!, { type: 'lobby' });
    hub.receive(peers[1]!, JSON.stringify({ type: 'input', token: peers[0]!.token, matchId: first.matchId, frame: 0, input }));
    expect(peers[1]!.last('error').code).toBe('NOT_OWNER');
    const invalid = setup(), second = invalid.start(); invalid.send(invalid.peers[0]!, { type: 'lobby' });
    invalid.send(invalid.peers[1]!, { type: 'input', matchId: second.matchId, frame: 0, input: { ...input, x: 2 } });
    expect(invalid.peers[1]!.last('error').code).toBe('BAD_MESSAGE');
    for (let i = 0; i < 300; i++) send(peers[0]!, { type: 'input', matchId: first.matchId, frame: 0, input });
    expect(peers[0]!.closed?.reason).toContain('rate limit');
  });
  it('closes disconnected and congested matches, and deletes empty rooms', () => {
    const { hub, peers, start, send } = setup(); const begin = start();
    peers[1]!.congested = true;
    send(peers[0]!, { type: 'input', matchId: begin.matchId, frame: 0, input });
    expect(peers[0]!.last('end').code).toBe('CONGESTION'); expect(peers[1]!.closed?.code).toBe(1013);
    hub.disconnect(peers[0]!); expect(hub.roomCount).toBe(0); expect(hub.clientCount).toBe(0);
  });
  it('never delivers an obsolete start after a nested congestion end', () => {
    const { peers, start } = setup(4);
    peers[1]!.rejectType = 'start'; start();
    expect(peers[0]!.last('end').code).toBe('CONGESTION');
    for (const peer of peers.slice(2)) {
      expect(peer.last('end').code).toBe('CONGESTION');
      expect(peer.messages.some(message => message.type === 'start')).toBe(false);
      expect(peer.last('room').room.phase).toBe('ended');
    }
  });
  it('requires the eighth asset-ready member and retains the two-player minimum', () => {
    expect(MIN_MATCH_PLAYERS).toBe(2); expect(MAX_MATCH_PLAYERS).toBe(8);
    const single = setup(1); single.start(); expect(single.peers[0]!.last('error').code).toBe('NOT_READY');
    const { peers, send } = setup(8);
    send(peers[7]!, { type: 'choose', fighter: 'Kb' });
    peers.slice(0, 7).forEach(peer => send(peer, { type: 'ready', assetsLoaded: true }));
    send(peers[0]!, { type: 'start' }); expect(peers[0]!.last('error').code).toBe('NOT_READY');
    expect(peers[7]!.messages.some(message => message.type === 'start')).toBe(false);
    send(peers[7]!, { type: 'ready', assetsLoaded: true }); send(peers[0]!, { type: 'start' });
    expect(peers[0]!.last('start').players[7]).toMatchObject({ slot: 7, fighter: 'Kb', ready: true });
  });
  it('preserves slot seven ownership across sparse membership, replacement and host transfer', () => {
    const { hub, peers, send } = setup(8);
    send(peers[7]!, { type: 'choose', fighter: 'Kb' });
    for (const slot of [0, 3, 5]) send(peers[slot]!, { type: 'leave' });
    expect(peers[7]!.last('room').room).toMatchObject({ hostSlot: 1, players: [1, 2, 4, 6, 7].map(slot => ({ slot })) });
    const replacement = new Peer(); hub.connect(replacement);
    send(replacement, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'Replacement', fingerprint });
    expect(replacement.last('joined').slot).toBe(0); expect(replacement.last('joined').room.hostSlot).toBe(1);
    const survivors = [replacement, ...peers.filter((_, slot) => ![0, 3, 5].includes(slot))];
    survivors.forEach(peer => send(peer, { type: 'ready', assetsLoaded: true })); send(peers[1]!, { type: 'start' });
    const begin = peers[7]!.last('start'); expect(begin.players.map(player => player.slot)).toEqual([0, 1, 2, 4, 6, 7]);
    send(peers[7]!, { type: 'input', matchId: begin.matchId, frame: 0, input });
    survivors.forEach(peer => expect(peer.last('input')).toMatchObject({ slot: 7, frame: 0, input }));
  });
  it.each(['hash', 'finish'])('includes slot seven in divergent canonical %s diagnostics', type => {
    const { peers, send, start } = setup(8), begin = start();
    peers.forEach(peer => send(peer, { type: 'input', matchId: begin.matchId, frame: 0, input }));
    peers.slice(0, 7).forEach(peer => send(peer, { type, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }));
    send(peers[7]!, { type, matchId: begin.matchId, frame: 0, hash: fingerprint.content });
    peers.forEach(peer => { expect(peer.last('end')).toMatchObject({ code: 'DESYNC', frame: 0 }); expect(peer.last('end').hashes?.['7']).toContain(fingerprint.content); });
  });
  it('closes all eight peers on slot-seven loss and discards only the just-closed late hashes/finish', () => {
    const { hub, peers, send, start, advance } = setup(8), begin = start();
    hub.disconnect(peers[7]!);
    for (const peer of peers.slice(0, 7)) {
      expect(peer.last('end')).toMatchObject({ code: 'PEER_DISCONNECTED', slot: 7 });
      for (const type of ['hash', 'finish']) send(peer, { type, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      expect(peer.messages.some(message => message.type === 'error')).toBe(false);
    }
    send(peers[0]!, { type: 'lobby' }); advance(1000);
    peers.slice(0, 7).forEach(peer => send(peer, { type: 'ready', assetsLoaded: true })); send(peers[0]!, { type: 'start' });
    const next = peers[0]!.last('start'); expect(next.players).toHaveLength(7); expect(next.matchId).not.toBe(begin.matchId);
    send(peers[6]!, { type: 'finish', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
    send(peers[6]!, { type: 'input', matchId: next.matchId, frame: 0, input }); expect(peers[0]!.last('input').matchId).toBe(next.matchId);
    send(peers[6]!, { type: 'hash', matchId: 'unrelated', frame: 0, hash: fingerprint.wasm }); expect(peers[6]!.last('error').code).toBe('STALE_MATCH');
  });
  it('fits worst-case eight-member room/start JSON and full inputs in existing payload bounds', () => {
    // Lone surrogates maximize JSON escaping (six ASCII bytes per allowed code unit).
    const maximum = { ...fingerprint, game: '\ud800'.repeat(128) }, name = '\ud800'.repeat(32), hub = new RoomHub();
    const peers = Array.from({ length: 8 }, () => new Peer()); peers.forEach(peer => hub.connect(peer));
    hub.receive(peers[0]!, JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name, fingerprint: maximum, rules: { stage: 'battlefield', stocks: 9, timeSeconds: 600 } }));
    const code = peers[0]!.last('joined').room.code;
    for (const peer of peers.slice(1)) hub.receive(peer, JSON.stringify({ type: 'join', protocol: ROOM_PROTOCOL, name, fingerprint: maximum, code }));
    peers.forEach(peer => hub.receive(peer, JSON.stringify({ type: 'ready', token: peer.token, assetsLoaded: true })));
    hub.receive(peers[0]!, JSON.stringify({ type: 'start', token: peers[0]!.token }));
    for (const peer of peers) for (const message of [peer.last('joined'), peer.last('room'), peer.last('start')]) {
      const json = JSON.stringify(message);
      expect(Buffer.byteLength(json)).toBeLessThanOrEqual(MAX_ROOM_PAYLOAD); // Stronger than client's unchanged 4x guard.
      expect(json.length).toBeLessThanOrEqual(MAX_ROOM_PAYLOAD * 4);
    }
    const fullInput = { type: 'input', token: 't'.repeat(64), matchId: 'm'.repeat(64), frame: MAX_MATCH_FRAME, input: { x: -Number.MIN_VALUE, y: Number.MIN_VALUE, jump: false, attack: false, strong: false, down: false, special: false, specialDirection: 'neutral', shield: false, grab: false, walk: false } };
    expect(parseClientMessage(JSON.stringify(fullInput))).toEqual(fullInput);
    expect(Buffer.byteLength(JSON.stringify(fullInput))).toBeLessThan(MAX_ROOM_PAYLOAD);
    hub.shutdown();
  });
  it('keeps global defaults bounded to 64 connections and 32 rooms', () => {
    const hub = new RoomHub(), peers = Array.from({ length: 64 }, () => new Peer()); peers.forEach(peer => hub.connect(peer));
    const extra = new Peer(); expect(hub.connect(extra)).toBe(false); expect(extra.closed?.code).toBe(1013);
    peers.slice(0, 33).forEach(peer => hub.receive(peer, JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint })));
    expect(hub.clientCount).toBe(64); expect(hub.roomCount).toBe(32); expect(peers[32]!.last('error').code).toBe('ROOM_LIMIT'); hub.shutdown();
  });
  it.each([1, 2])('starts %i human(s) plus CPUs up to eight, with human-only input/hash/finish/liveness', humans => {
    const { hub, peers, send, start, advance } = setup(humans);
    for (let slot = humans; slot < 8; slot++) send(peers[0]!, { type: 'cpu', slot, fighter: slot % 2 ? 'Kb' : 'Fx' });
    const begin = start(); expect(begin.players).toHaveLength(8); expect(hub.clientCount).toBe(humans);
    expect(begin.players.map(player => player.control)).toEqual([...Array(humans).fill('human'), ...Array(8 - humans).fill('cpu')]);
    for (const player of begin.players.slice(humans)) expect(player).toMatchObject({ name: `CPU ${player.slot + 1}`, ready: true, control: 'cpu' });
    // A CPU has no transport input/heartbeat and cannot stall human progress.
    advance(11000);
    peers.forEach(peer => { hub.heartbeat(peer); send(peer, { type: 'input', matchId: begin.matchId, frame: 0, input }); }); hub.tick();
    expect(peers[0]!.last('room').room.phase).toBe('playing');
    peers.forEach(peer => expect(peer.messages.filter(message => message.type === 'input').map(message => message.slot)).toEqual(Array.from({ length: humans }, (_, slot) => slot)));
    peers.forEach(peer => send(peer, { type: 'hash', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }));
    peers.forEach(peer => expect(peer.last('hash')).toMatchObject({ frame: 0, hash: fingerprint.wasm }));
    peers.forEach(peer => send(peer, { type: 'finish', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }));
    peers.forEach(peer => expect(peer.last('end').code).toBe('MATCH_COMPLETE'));
    // Completion races remain harmless with no CPU hash/finish packets expected.
    peers.forEach(peer => { send(peer, { type: 'hash', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }); send(peer, { type: 'finish', matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }); expect(peer.messages.some(message => message.type === 'error')).toBe(false); });
  });
  it('CPU edits are host-only lobby operations and cannot replace or remove an occupied human', () => {
    const { peers, send, start } = setup(2), host = peers[0]!, guest = peers[1]!;
    send(guest, { type: 'cpu', slot: 7, fighter: 'Kb' }); expect(guest.last('error').code).toBe('HOST_ONLY');
    for (const fighter of ['Fx', null]) { send(host, { type: 'cpu', slot: 1, fighter }); expect(host.last('error').code).toBe('SEAT_OCCUPIED'); }
    expect(host.last('room').room.players.map(player => player.control)).toEqual(['human', 'human']);
    peers.forEach(peer => send(peer, { type: 'ready', assetsLoaded: true }));
    send(host, { type: 'cpu', slot: 7, fighter: 'Kb' });
    expect(host.last('room').room.players.map(player => player.ready)).toEqual([false, false, true]);
    send(host, { type: 'cpu', slot: 7, fighter: 'Ss' }); expect(host.last('room').room.players.at(-1)?.fighter).toBe('Ss');
    start(); send(host, { type: 'cpu', slot: 7, fighter: null }); expect(host.last('error').code).toBe('NOT_LOBBY');
    expect(host.last('room').room.players.at(-1)).toMatchObject({ slot: 7, control: 'cpu', fighter: 'Ss' });
  });
  it('joins skip CPU slots and a removed CPU becomes an open human seat without renumbering', () => {
    const { hub, peers, send } = setup(1), host = peers[0]!;
    for (const slot of [1, 3, 7]) send(host, { type: 'cpu', slot, fighter: 'Mr' });
    const join = (name: string) => { const peer = new Peer(); hub.connect(peer); send(peer, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name, fingerprint }); return peer; };
    const second = join('Second'); expect(second.last('joined').slot).toBe(2);
    send(host, { type: 'ready', assetsLoaded: true }); send(second, { type: 'ready', assetsLoaded: true });
    send(host, { type: 'cpu', slot: 1, fighter: null });
    expect(host.last('room').room.players.map(player => [player.slot, player.ready])).toEqual([[0, false], [2, false], [3, true], [7, true]]);
    const third = join('Third'); expect(third.last('joined').slot).toBe(1);
    expect(second.last('room').room.players.map(player => [player.slot, player.control])).toEqual([[0, 'human'], [1, 'human'], [2, 'human'], [3, 'cpu'], [7, 'cpu']]);
    expect(second.last('joined').slot).toBe(2);
  });
  it('counts CPU seats toward capacity and admits a human only after the host opens a seat', () => {
    const { hub, peers, send } = setup(2);
    for (let slot = 2; slot < 8; slot++) send(peers[0]!, { type: 'cpu', slot, fighter: 'Kb' });
    const extra = new Peer(); hub.connect(extra);
    const join = () => send(extra, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'Extra human', fingerprint });
    join(); expect(extra.last('error').code).toBe('ROOM_FULL'); expect(peers[0]!.last('room').room.players).toHaveLength(8);
    send(peers[0]!, { type: 'cpu', slot: 5, fighter: null }); join();
    expect(extra.last('joined')).toMatchObject({ slot: 5, room: { players: expect.arrayContaining([{ slot: 5, name: 'Extra human', fighter: 'Mr', ready: false, control: 'human' }]) } });
    expect(extra.last('joined').room.players).toHaveLength(8);
  });
  it('transfers human host ownership without losing CPUs, and deletes a CPU-filled room when its last human leaves', () => {
    const { hub, peers, send } = setup(2);
    for (let slot = 2; slot < 8; slot++) send(peers[0]!, { type: 'cpu', slot, fighter: 'Kb' });
    send(peers[0]!, { type: 'leave' }); expect(peers[1]!.last('room').room).toMatchObject({ hostSlot: 1, players: expect.arrayContaining([{ slot: 7, name: 'CPU 8', fighter: 'Kb', ready: true, control: 'cpu', level: 5 }]) });
    send(peers[1]!, { type: 'cpu', slot: 0, fighter: 'Fx' }); expect(peers[1]!.last('room').room.players).toHaveLength(8);
    send(peers[1]!, { type: 'ready', assetsLoaded: true }); send(peers[1]!, { type: 'start' }); expect(peers[1]!.last('start').players[0]?.control).toBe('cpu');
    hub.disconnect(peers[1]!); expect(hub.roomCount).toBe(0);
    const stranger = new Peer(); hub.connect(stranger); send(stranger, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'No ghost CPUs', fingerprint }); expect(stranger.last('error').code).toBe('ROOM_NOT_FOUND');
  });
  it('lets only the host set a CPU level per seat, defaults and preserves it, and ships it with the start message', () => {
    const { peers, send, start } = setup(2);
    send(peers[0]!, { type: 'cpu', slot: 2, fighter: 'Kb', level: 9 }); send(peers[0]!, { type: 'cpu', slot: 3, fighter: 'Fx' });
    expect(peers[1]!.last('room').room.players.filter(player => player.control === 'cpu').map(player => [player.slot, player.level])).toEqual([[2, 9], [3, 5]]);
    send(peers[0]!, { type: 'cpu', slot: 2, fighter: 'Mr' });
    expect(peers[1]!.last('room').room.players.find(player => player.slot === 2)).toMatchObject({ fighter: 'Mr', level: 9 });
    send(peers[1]!, { type: 'cpu', slot: 2, fighter: 'Mr', level: 1 }); expect(peers[1]!.last('error').code).toBe('HOST_ONLY');
    expect(peers[1]!.last('room').room.players.every(player => player.control !== 'human' || player.level === undefined)).toBe(true);
    const begin = start(); expect(begin.players.map(player => player.level ?? null)).toEqual([null, null, 9, 5]);
  });
  it.each(['hash', 'finish'])('closes a mixed room when its two humans disagree about canonical %s', type => {
    const { peers, send, start } = setup(2);
    for (let slot = 2; slot < 8; slot++) send(peers[0]!, { type: 'cpu', slot, fighter: 'Kb' });
    const begin = start(); peers.forEach(peer => send(peer, { type: 'input', matchId: begin.matchId, frame: 0, input }));
    send(peers[0]!, { type, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
    send(peers[1]!, { type, matchId: begin.matchId, frame: 0, hash: fingerprint.content });
    peers.forEach(peer => { expect(peer.last('end')).toMatchObject({ code: 'DESYNC', frame: 0 }); expect(Object.keys(peer.last('end').hashes!)).toEqual(['0', '1']); });
  });
  it('rejects an attempted input for a CPU slot instead of granting host CPU input ownership', () => {
    const { hub, peers, send, start } = setup(1), host = peers[0]!;
    send(host, { type: 'cpu', slot: 7, fighter: 'Kb' }); const begin = start();
    send(host, { type: 'input', matchId: begin.matchId, frame: 0, input }); expect(host.last('input').slot).toBe(0);
    hub.receive(host, JSON.stringify({ type: 'input', token: host.token, matchId: begin.matchId, slot: 7, frame: 1, input }));
    expect(host.last('error').code).toBe('BAD_MESSAGE'); expect(host.closed).not.toBeNull(); expect(hub.roomCount).toBe(0);
  });
  it('bounds clients, rooms and message rate', () => {
    const hub = new RoomHub({ maxClients: 1 }), a = new Peer(), b = new Peer(); hub.connect(a); hub.connect(b); expect(b.closed?.code).toBe(1013);
    for (let i = 0; i < 21; i++) hub.receive(a, JSON.stringify({ type: 'ping', nonce: i }));
    expect(a.closed?.reason).toContain('rate limit');
    const empty = new RoomHub({ maxRooms: 0 }), c = new Peer(); empty.connect(c);
    empty.receive(c, JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint })); expect(c.last('error').code).toBe('ROOM_LIMIT');
  });
  it('terminates nonresponsive sockets and closes input stalls even if transport pongs continue', () => {
    const { hub, peers, start, advance } = setup(); start();
    advance(11000); peers.forEach(peer => hub.heartbeat(peer)); hub.tick(); expect(peers[0]!.last('end').code).toBe('INPUT_TIMEOUT');
    advance(31000); hub.tick(); expect(hub.clientCount).toBe(0);
  });
});

/** Deterministic per-link delay injection; preserves ordered WebSocket delivery. */
class DelayedSocket extends EventTarget {
  readyState = 1; bufferedAmount = 0; readonly peer: RoomPeer;
  constructor(readonly hub: RoomHub, readonly delay: number) {
    super();
    this.peer = {
      send: message => { setTimeout(() => { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }, delay); return true; },
      sendBinary: data => { const copy = data.slice().buffer; setTimeout(() => { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: copy })); }, delay); return true; },
      close: () => this.close(),
    };
    hub.connect(this.peer);
  }
  send(data: string | Uint8Array): void { setTimeout(() => { if (this.readyState !== 1) return; if (typeof data === 'string') this.hub.receive(this.peer, data); else this.hub.receiveBinary(this.peer, data); }, this.delay); }
  close(): void { if (this.readyState === 3) return; this.readyState = 3; this.hub.disconnect(this.peer); this.dispatchEvent(new Event('close')); }
}
afterEach(() => vi.useRealTimers());
describe('RoomClient immutable store under injected network latency', () => {
  it.each([4, 8])('relays all %i peers with 10–80ms links, matches hashes and closes on background', async count => {
    vi.useFakeTimers(); vi.setSystemTime(100000);
    const hub = new RoomHub({ startDelayMs: 500, reconnectGraceMs: 0 });
    const starts: MatchStart[] = [], received: number[][] = Array.from({ length: count }, () => []);
    const delays = count === 4 ? [10, 25, 50, 80] : [10, 20, 25, 35, 45, 50, 65, 80];
    const clients = delays.map((delay, slot) => new RoomClient({ url: 'ws://test/api/rooms', createSocket: () => new DelayedSocket(hub, delay) as unknown as WebSocket, onStart: start => starts.push(start), onInput: message => received[slot]!.push(message.slot) }));
    const promises = clients.map(client => client.connect()); await vi.advanceTimersByTimeAsync(240); await Promise.all(promises);
    const notifications = vi.fn(), unsubscribe = clients[0]!.subscribe(notifications);
    clients[0]!.create({ name: 'Host', fingerprint }); await vi.advanceTimersByTimeAsync(100);
    const old = clients[0]!.getSnapshot(); expect(Object.isFrozen(old.room?.players)).toBe(true);
    const code = old.room!.code;
    clients.slice(1).forEach((client, index) => client.join({ code, name: `Guest ${index}`, fingerprint })); await vi.advanceTimersByTimeAsync(250);
    expect(old.room!.players).toHaveLength(1); expect(clients[0]!.getSnapshot().room!.players).toHaveLength(count);
    clients.forEach(client => client.ready()); await vi.advanceTimersByTimeAsync(250);
    clients[0]!.start(); await vi.advanceTimersByTimeAsync(200);
    expect(starts).toHaveLength(count); starts.forEach(start => expect(start).toEqual(starts[0]));
    expect(clients[count - 1]!.getSnapshot().latencyMs).toBe(80);
    expect(clients[0]!.serverNow()).toBe(Date.now());
    clients.forEach(client => client.sendInput(0, input)); await vi.advanceTimersByTimeAsync(200);
    // Binary frames are never echoed: every client hears each OTHER seat exactly once.
    received.forEach((slots, own) => expect(slots.slice().sort()).toEqual(Array.from({ length: count }, (_, slot) => slot).filter(slot => slot !== own)));
    clients.forEach(client => client.sendHash(0, fingerprint.wasm)); await vi.advanceTimersByTimeAsync(200);
    clients[count - 1]!.background(); await vi.advanceTimersByTimeAsync(200);
    clients.forEach(client => { expect(client.getSnapshot().lastEnd?.code).toBe('PEER_BACKGROUND'); expect(client.getSnapshot().match).toBeNull(); });
    expect(notifications).toHaveBeenCalled(); unsubscribe(); clients.forEach(client => client.disconnect()); hub.shutdown();
  });
  it('signals local congestion instead of silently dropping a frame', async () => {
    vi.useFakeTimers();
    const hub = new RoomHub(); let socket!: DelayedSocket;
    const client = new RoomClient({ url: 'ws://test/api/rooms', createSocket: () => (socket = new DelayedSocket(hub, 1)) as unknown as WebSocket });
    const connecting = client.connect(); await vi.advanceTimersByTimeAsync(10); await connecting;
    socket.bufferedAmount = 300000; expect(client.ping()).toBe(false);
    expect(client.getSnapshot().status).toBe('disconnected'); expect(client.getSnapshot().error?.code).toBe('CONGESTION'); hub.shutdown();
  });
});
