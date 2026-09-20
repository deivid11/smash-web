import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import WebSocket, { type ClientOptions } from 'ws';
import { createMeleeServer } from '../../server/http.ts';
import { attachRoomServer } from '../../server/rooms.ts';
import { RoomClient } from '../../web/src/net/room-client.ts';
import { sourceFixture } from './source-fixture.ts';
import { ROOM_PROTOCOL, MAX_ROOM_PAYLOAD, type ServerMessage } from '../../lib/net/protocol.ts';

let server: Server, base: string, origin: string, reads = 0;
const sockets = new Set<WebSocket>();
const fingerprint = { game: 'relay-wire-test', wasm: 'a'.repeat(64), content: 'b'.repeat(64) };
const input = { x: 0, jump: false, attack: false, strong: false, down: false };
beforeAll(async () => {
  server = await createMeleeServer({ reconnectGraceMs: 0, staticRoot: resolve('web'), source: { manifest: sourceFixture(), read: async () => { reads++; throw new Error('No WS asset reads allowed.'); }, close: async () => {} } });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`; base = origin.replace('http:', 'ws:');
});
afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await new Promise<void>(done => server.close(() => done()));
});
function socket(path = '/api/rooms', options: ClientOptions = {}): WebSocket {
  const ws = new WebSocket(base + path, { origin, ...options }); sockets.add(ws); ws.on('error', () => {}); ws.once('close', () => sockets.delete(ws)); return ws;
}
class Wire {
  readonly ws: WebSocket; readonly messages: ServerMessage[] = [];
  private listeners = new Set<() => void>();
  constructor() { this.ws = socket(); this.ws.on('message', data => { this.messages.push(JSON.parse(data.toString()) as ServerMessage); for (const listener of this.listeners) listener(); }); }
  async next<T extends ServerMessage['type']>(type: T, predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((done, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(check); reject(new Error(`No ${type} wire response`)); }, 2000);
      const check = () => {
        const index = this.messages.findIndex(message => message.type === type && predicate(message as Extract<ServerMessage, { type: T }>));
        if (index < 0) return;
        clearTimeout(timer); this.listeners.delete(check); done(this.messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>);
      };
      this.listeners.add(check); check();
    });
  }
  send(message: object): void { this.ws.send(JSON.stringify(message)); }
}
async function denied(path: string, options: ClientOptions): Promise<number | undefined> {
  const ws = socket(path, options);
  return new Promise((done, reject) => {
    ws.once('unexpected-response', (_request, response) => { response.resume(); done(response.statusCode); ws.terminate(); });
    ws.once('open', () => { ws.terminate(); reject(new Error('Unexpected accepted upgrade.')); });
  });
}
async function roomGroup(count: number) {
  const peers = Array.from({ length: count }, () => new Wire()); await Promise.all(peers.map(peer => peer.next('hello')));
  peers[0]!.send({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint });
  const joined = [await peers[0]!.next('joined')];
  for (let slot = 1; slot < count; slot++) {
    peers[slot]!.send({ type: 'join', protocol: ROOM_PROTOCOL, name: `Guest ${slot}`, fingerprint, code: joined[0]!.room.code });
    joined.push(await peers[slot]!.next('joined'));
  }
  const start = async () => {
    peers.forEach((peer, slot) => peer.send({ type: 'ready', token: joined[slot]!.token, assetsLoaded: true }));
    await peers[0]!.next('room', message => message.room.phase === 'lobby' && message.room.players.filter(player => player.control !== 'cpu').length === count && message.room.players.every(player => player.ready));
    peers[0]!.send({ type: 'start', token: joined[0]!.token });
    const starts = await Promise.all(peers.map(peer => peer.next('start'))); starts.forEach(begin => expect(begin).toEqual(starts[0])); return starts[0]!;
  };
  return { peers, joined, start };
}
async function roomPair() {
  const group = await roomGroup(2), start = await group.start();
  return { a: group.peers[0]!, b: group.peers[1]!, aj: group.joined[0]!, bj: group.joined[1]!, start };
}

describe('real same-origin LAN WebSocket server security', () => {
  it.each([
    ['/api/rooms', { origin: 'https://attacker.example' }],
    ['/api/rooms', { origin: undefined }],
    ['/api/rooms', { headers: { Host: 'rebind.example' } }],
    ['/api/rooms', { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
    ['/api/rooms?path=main.dol', {}], ['/api/assets/main.dol', {}], ['/api/disc', {}], ['/../private.iso', {}],
  ] as [string, ClientOptions][])('rejects unauthorized upgrade %# without reading disc bytes', async (path, options) => {
    expect(await denied(path, options)).toBe(403); expect(reads).toBe(0);
  });
  it('uses native WS without negotiated compression and never returns membership tokens in room snapshots', async () => {
    const a = new Wire(); await a.next('hello'); expect(a.ws.extensions).toBe('');
    a.send({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint }); const joined = await a.next('joined');
    const room = await a.next('room'); expect(JSON.stringify(room)).not.toContain(joined.token); expect(reads).toBe(0); a.ws.close();
  });
  it('rejects payloads larger than 4096 bytes and malformed binary frames', async () => {
    const large = new Wire(); await large.next('hello'); const closed = once(large.ws, 'close'); large.ws.send('x'.repeat(4097));
    expect((await closed)[0]).toBe(1009);
    const binary = new Wire(); await binary.next('hello'); const binaryClosed = once(binary.ws, 'close'); binary.ws.send(Buffer.from([1, 2, 3]));
    expect((await binaryClosed)[0]).toBe(1008); expect(reads).toBe(0);
  });
  it.each([[1, 'create'], [1, 'join'], [2, 'create'], [2, 'join'], [3, 'create'], [3, 'join'], [5, 'create'], [5, 'join'], [6, 'create'], [6, 'join'], [7, 'create'], [7, 'join'], [8, 'create'], [8, 'join']] as const)('rejects legacy protocol%i %s commands at handshake', async (protocol, type) => {
    const peer = new Wire(); expect((await peer.next('hello')).protocol).toBe(ROOM_PROTOCOL); expect(ROOM_PROTOCOL).toBe(10);
    peer.send({ type, protocol, name: 'Legacy client', fingerprint, ...(type === 'join' ? { code: 'ABC234' } : {}) });
    expect((await peer.next('error')).code).toBe('BAD_MESSAGE'); peer.ws.close();
  });
  it('admits eight native WS peers, rejects ninth, relays slot7 and requires all eight hashes/finish', async () => {
    const group = await roomGroup(8), { peers, joined } = group, ninth = new Wire();
    try {
      await ninth.next('hello'); ninth.send({ type: 'join', protocol: ROOM_PROTOCOL, name: 'Ninth', fingerprint, code: joined[0]!.room.code });
      expect(await ninth.next('error')).toMatchObject({ code: 'ROOM_FULL', message: 'This room already has 8 players.' });
      expect(joined.map(member => member.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      const begin = await group.start(); expect(Buffer.byteLength(JSON.stringify(begin))).toBeLessThan(MAX_ROOM_PAYLOAD * 4);
      peers.forEach((peer, slot) => peer.send({ type: 'input', token: joined[slot]!.token, matchId: begin.matchId, frame: 0, input: { ...input, x: slot / 8 } }));
      for (const peer of peers) {
        const inputs = await Promise.all(Array.from({ length: 8 }, () => peer.next('input')));
        expect(inputs.sort((a, b) => a.slot - b.slot).map(message => [message.slot, message.frame, message.input.x])).toEqual(Array.from({ length: 8 }, (_, slot) => [slot, 0, slot / 8]));
      }
      const firstSeven = async (type: 'hash' | 'finish', nonce: number) => {
        await Promise.all(peers.slice(0, 7).map(async (peer, slot) => {
          peer.send({ type, token: joined[slot]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
          peer.send({ type: 'ping', nonce }); await peer.next('pong', message => message.nonce === nonce);
        }));
      };
      await firstSeven('hash', 101);
      peers.forEach(peer => expect(peer.messages.some(message => message.type === 'hash')).toBe(false));
      peers[7]!.send({ type: 'hash', token: joined[7]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      for (const peer of peers) expect(await peer.next('hash')).toMatchObject({ matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      await firstSeven('finish', 102);
      peers.forEach(peer => expect(peer.messages.some(message => message.type === 'end')).toBe(false));
      peers[7]!.send({ type: 'finish', token: joined[7]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      for (const peer of peers) expect(await peer.next('end')).toMatchObject({ code: 'MATCH_COMPLETE', frame: 0 });
      await Promise.all(peers.map(async (peer, slot) => {
        for (const type of ['hash', 'finish']) peer.send({ type, token: joined[slot]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
        peer.send({ type: 'ping', nonce: 103 }); await peer.next('pong', message => message.nonce === 103);
        expect(peer.messages.some(message => message.type === 'error')).toBe(false); peer.messages.length = 0;
      }));
      peers[0]!.send({ type: 'lobby', token: joined[0]!.token });
      await Promise.all(peers.map(peer => peer.next('room', message => message.room.phase === 'lobby')));
      const next = await group.start(); expect(next.matchId).not.toBe(begin.matchId);
      peers[7]!.send({ type: 'finish', token: joined[7]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      peers[7]!.send({ type: 'input', token: joined[7]!.token, matchId: next.matchId, frame: 0, input });
      expect(await peers[0]!.next('input')).toMatchObject({ slot: 7, matchId: next.matchId });
      peers[7]!.send({ type: 'hash', token: joined[7]!.token, matchId: 'unrelated', frame: 0, hash: fingerprint.wasm });
      expect((await peers[7]!.next('error')).code).toBe('STALE_MATCH');
    } finally { peers.forEach(peer => peer.ws.terminate()); ninth.ws.terminate(); }
  });
  it.each(['disconnect', 'spoof'])('closes every native eight-peer match on slot7 %s and tolerates legitimate late finish', async reason => {
    const { peers, joined, start } = await roomGroup(8);
    try {
      const begin = await start();
      if (reason === 'disconnect') peers[7]!.ws.terminate();
      else peers[7]!.send({ type: 'input', token: joined[0]!.token, matchId: begin.matchId, frame: 0, input });
      for (const peer of peers.slice(0, 7)) expect(await peer.next('end')).toMatchObject({ code: reason === 'disconnect' ? 'PEER_DISCONNECTED' : 'NOT_OWNER', slot: 7 });
      peers[6]!.send({ type: 'hash', token: joined[6]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      peers[6]!.send({ type: 'finish', token: joined[6]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      peers[6]!.send({ type: 'ping', nonce: 200 }); await peers[6]!.next('pong');
      expect(peers[6]!.messages.some(message => message.type === 'error')).toBe(false);
      expect(reads).toBe(0);
    } finally { peers.forEach(peer => peer.ws.terminate()); }
  });
  it.each([1, 2])('relays only %i human socket(s) for eight mixed fighters and requires no CPU hashes/finish', async humans => {
    const { peers, joined, start } = await roomGroup(humans), extra = new Wire();
    try {
      for (let slot = humans; slot < 8; slot++) peers[0]!.send({ type: 'cpu', token: joined[0]!.token, slot, fighter: 'Kb' });
      peers[0]!.send({ type: 'ping', nonce: 301 }); await peers[0]!.next('pong');
      await extra.next('hello'); extra.send({ type: 'join', protocol: ROOM_PROTOCOL, name: 'Full of CPU seats', fingerprint, code: joined[0]!.room.code });
      expect((await extra.next('error')).code).toBe('ROOM_FULL');
      const begin = await start(); expect(begin.players).toHaveLength(8);
      expect(begin.players.filter(player => player.control === 'human')).toHaveLength(humans);
      expect(begin.players.filter(player => player.control === 'cpu')).toHaveLength(8 - humans);
      peers.forEach((peer, slot) => peer.send({ type: 'input', token: joined[slot]!.token, matchId: begin.matchId, frame: 0, input }));
      for (const peer of peers) {
        const inputs = await Promise.all(Array.from({ length: humans }, () => peer.next('input')));
        expect(inputs.map(message => message.slot).sort()).toEqual(Array.from({ length: humans }, (_, slot) => slot));
      }
      peers.forEach((peer, slot) => peer.send({ type: 'hash', token: joined[slot]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }));
      for (const peer of peers) expect(await peer.next('hash')).toMatchObject({ frame: 0, hash: fingerprint.wasm });
      peers.forEach((peer, slot) => peer.send({ type: 'finish', token: joined[slot]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm }));
      for (const peer of peers) expect((await peer.next('end')).code).toBe('MATCH_COMPLETE');
      peers[0]!.send({ type: 'hash', token: joined[0]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      peers[0]!.send({ type: 'finish', token: joined[0]!.token, matchId: begin.matchId, frame: 0, hash: fingerprint.wasm });
      peers[0]!.send({ type: 'ping', nonce: 302 }); await peers[0]!.next('pong');
      expect(peers[0]!.messages.some(message => message.type === 'error')).toBe(false);
    } finally { peers.forEach(peer => peer.ws.terminate()); extra.ws.terminate(); }
  });
  it('native CPU configuration cannot evict humans or authorize a guest to configure CPUs', async () => {
    const { peers, joined } = await roomGroup(2);
    try {
      peers[1]!.send({ type: 'cpu', token: joined[1]!.token, slot: 7, fighter: 'Kb' }); expect((await peers[1]!.next('error')).code).toBe('HOST_ONLY');
      peers[0]!.send({ type: 'cpu', token: joined[0]!.token, slot: 1, fighter: null }); expect((await peers[0]!.next('error')).code).toBe('SEAT_OCCUPIED');
      peers[0]!.send({ type: 'cpu', token: joined[0]!.token, slot: 7, fighter: 'Kb' });
      const room = await peers[1]!.next('room', message => message.room.players.length === 3);
      expect(room.room.players.map(player => [player.slot, player.control])).toEqual([[0, 'human'], [1, 'human'], [7, 'cpu']]);
      peers[0]!.ws.terminate();
      const transferred = await peers[1]!.next('room', message => message.room.hostSlot === 1);
      expect(transferred.room.players.map(player => [player.slot, player.control])).toEqual([[1, 'human'], [7, 'cpu']]);
    } finally { peers.forEach(peer => peer.ws.terminate()); }
  });
  it('relays immediately, rejects slot spoofing, and closes the shared match', async () => {
    const { a, b, aj, bj, start } = await roomPair();
    b.send({ type: 'input', token: bj.token, matchId: start.matchId, frame: 0, input });
    expect(await a.next('input')).toMatchObject({ slot: 1, frame: 0, input }); expect(await b.next('input')).toMatchObject({ slot: 1 });
    b.send({ type: 'input', token: aj.token, matchId: start.matchId, frame: 1, input });
    expect((await a.next('end')).code).toBe('NOT_OWNER'); a.ws.close(); b.ws.close();
  });
  it.each(['lobby', 'background'])('ignores legitimate in-flight frames after shared %s without lobby errors', async type => {
    const { a, b, aj, bj, start } = await roomPair();
    a.send({ type, token: aj.token }); await a.next('end');
    b.send({ type: 'input', token: bj.token, matchId: start.matchId, frame: 0, input });
    b.send({ type: 'hash', token: bj.token, matchId: start.matchId, frame: 0, hash: fingerprint.wasm });
    b.send({ type: 'ping', nonce: 42 }); await b.next('pong'); // Ordered processing barrier.
    expect(b.messages.filter(message => message.type === 'error')).toEqual([]);
    if (type === 'background') a.send({ type: 'lobby', token: aj.token });
    await a.next('room', message => message.room.phase === 'lobby');
    a.send({ type: 'ready', token: aj.token, assetsLoaded: true }); b.send({ type: 'ready', token: bj.token, assetsLoaded: true });
    await a.next('room', message => message.room.phase === 'lobby' && message.room.players.every(player => player.ready));
    a.send({ type: 'start', token: aj.token }); const next = await a.next('start'); await b.next('start');
    b.send({ type: 'input', token: bj.token, matchId: start.matchId, frame: 0, input });
    b.send({ type: 'hash', token: bj.token, matchId: start.matchId, frame: 0, hash: fingerprint.wasm });
    b.send({ type: 'input', token: bj.token, matchId: next.matchId, frame: 0, input });
    expect(await a.next('input')).toMatchObject({ matchId: next.matchId, frame: 0 });
    b.send({ type: 'ping', nonce: 43 }); await b.next('pong');
    expect(b.messages.filter(message => message.type === 'error')).toEqual([]);
    b.send({ type: 'input', token: bj.token, matchId: 'unrelated-match', frame: 0, input });
    expect((await b.next('error')).code).toBe('STALE_MATCH');
    a.ws.close(); b.ws.close();
  });
  it('treats transport disconnect as shared match closure', async () => {
    const { a, b } = await roomPair(); b.ws.terminate();
    expect((await a.next('end')).code).toBe('PEER_DISCONNECTED'); a.ws.close();
  });
  it('HTTP shutdown closes upgraded sockets instead of hanging ISO-handle release', async () => {
    const service = await createMeleeServer({ staticRoot: resolve('web'), source: { manifest: sourceFixture(), read: async () => new Uint8Array(), close: async () => {} } });
    await new Promise<void>(done => service.listen(0, '127.0.0.1', done));
    const address = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
    const ws = new WebSocket(`${address.replace('http:', 'ws:')}/api/rooms`, { origin: address }); ws.on('error', () => {});
    await once(ws, 'message');
    const closed = once(ws, 'close');
    await Promise.all([closed, new Promise<void>(done => service.close(() => done()))]);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
  it('times out connections that do not answer server heartbeat pings', async () => {
    const http = createServer(), relay = attachRoomServer(http, { authorize: () => true, heartbeatMs: 10, idleTimeoutMs: 35 });
    await new Promise<void>(done => http.listen(0, '127.0.0.1', done));
    const ws = new WebSocket(`ws://127.0.0.1:${(http.address() as { port: number }).port}/api/rooms`, { autoPong: false });
    ws.on('error', () => {});
    try { await once(ws, 'close'); expect(relay.hub.clientCount).toBe(0); }
    finally { ws.terminate(); relay.close(); await new Promise<void>(done => http.close(() => done())); }
  });
});

function until(client: RoomClient, predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('RoomClient state timed out.')); }, 2000);
    const unsubscribe = client.subscribe(() => { if (predicate()) { clearTimeout(timer); unsubscribe(); done(); } });
  });
}
it('RoomClient setCpu publishes immutable mixed roles, opens CPU seats and finishes a one-human match', async () => {
  const client = new RoomClient({ url: `${base}/api/rooms`, createSocket: url => {
    const ws = new WebSocket(url, { origin }); sockets.add(ws); ws.once('close', () => sockets.delete(ws)); return ws as unknown as globalThis.WebSocket;
  } });
  try {
    await client.connect(); client.create({ name: 'Solo host', fingerprint }); await until(client, () => client.getSnapshot().room !== null);
    for (let slot = 1; slot < 8; slot++) expect(client.setCpu(slot, 'Kb')).toBe(true);
    await until(client, () => client.getSnapshot().room!.players.length === 8);
    const full = client.getSnapshot(); expect(Object.isFrozen(full.room!.players[7])).toBe(true);
    expect(full.room!.players.map(player => player.control)).toEqual(['human', 'cpu', 'cpu', 'cpu', 'cpu', 'cpu', 'cpu', 'cpu']);
    client.setCpu(3, null); await until(client, () => client.getSnapshot().room!.players.length === 7);
    expect(full.room!.players).toHaveLength(8); // Old snapshots do not mutate.
    client.setCpu(3, 'Kb'); await until(client, () => client.getSnapshot().room!.players.length === 8);
    client.ready(); client.start(); await until(client, () => client.getSnapshot().match !== null);
    // Binary frames are not echoed to their sender; the accepted hash below proves the relay logged frame 0.
    expect(client.sendInput(0, input)).toBe(true);
    const hashReceived = new Promise<string>(done => { client.onHash = message => done(message.hash); });
    client.sendHash(0, fingerprint.wasm); expect(await hashReceived).toBe(fingerprint.wasm);
    client.finish(0, fingerprint.wasm); await until(client, () => client.getSnapshot().lastEnd?.code === 'MATCH_COMPLETE');
    expect(client.getSnapshot().room!.players.filter(player => player.control === 'cpu')).toHaveLength(7);
  } finally { client.disconnect(); }
});
it.each([2, 4, 8])('runs the browser RoomClient contract over actual ws sockets for %i browsers and rematch', async count => {
  const clients = Array.from({ length: count }, () => new RoomClient({ url: `${base}/api/rooms`, createSocket: url => {
    const ws = new WebSocket(url, { origin }); sockets.add(ws); ws.once('close', () => sockets.delete(ws)); return ws as unknown as globalThis.WebSocket;
  } }));
  try {
    await Promise.all(clients.map(client => client.connect()));
    const host = clients[0]!; host.create({ name: 'Host', fingerprint }); await until(host, () => host.getSnapshot().room !== null);
    const code = host.getSnapshot().room!.code;
    // Sequential join establishes deterministic ordering, not network arrival assumptions.
    for (let i = 1; i < clients.length; i++) { const client = clients[i]!; client.join({ code, name: `Guest${i}`, fingerprint }); await until(client, () => client.getSnapshot().room !== null); }
    clients.forEach(client => client.ready()); await until(host, () => host.getSnapshot().room!.players.every(player => player.ready));
    host.start(); await Promise.all(clients.map(client => until(client, () => client.getSnapshot().match !== null)));
    const id = host.getSnapshot().match!.matchId;
    expect(clients.map(client => client.getSnapshot().slot)).toEqual(Array.from({ length: count }, (_, slot) => slot));
    clients.forEach(client => expect(client.getSnapshot().match!.matchId).toBe(id));
    host.returnToLobby(); await Promise.all(clients.map(client => until(client, () => client.getSnapshot().room?.phase === 'lobby')));
    clients.forEach(client => { expect(client.getSnapshot().match).toBeNull(); expect(client.getSnapshot().lastEnd?.code).toBe('RETURNED_TO_LOBBY'); client.ready(); });
    await until(host, () => host.getSnapshot().room!.players.every(player => player.ready)); host.start();
    await Promise.all(clients.map(client => until(client, () => client.getSnapshot().match !== null)));
    expect(host.getSnapshot().match!.matchId).not.toBe(id);
  } finally { clients.forEach(client => client.disconnect()); }
});
