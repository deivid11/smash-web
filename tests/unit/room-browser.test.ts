import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { RoomHub, type RoomPeer } from '../../server/rooms.ts';
import { createMeleeServer } from '../../server/http.ts';
import { sourceFixture } from './source-fixture.ts';
import {
  ROOM_PROTOCOL,
  validRoomSummary,
  type Fingerprint,
  type ServerMessage,
} from '../../lib/net/protocol.ts';

const fingerprint: Fingerprint = { game: 'room-browser-test', wasm: 'a'.repeat(64), content: 'b'.repeat(64) };

class Peer implements RoomPeer {
  messages: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  send(message: ServerMessage): boolean { this.messages.push(structuredClone(message)); return true; }
  close(code: number, reason: string): void { this.closed = { code, reason }; }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> {
    return this.messages.filter(message => message.type === type).at(-1) as Extract<ServerMessage, { type: T }>;
  }
  get token(): string { return this.last('joined').token; }
}

describe('room browser directory', () => {
  it('validates directory entries and rejects malformed summaries', () => {
    const good = {
      code: 'ABC234', phase: 'lobby', players: 2, humans: 1, maxPlayers: 8,
      hostName: 'Host', rules: { stage: 'battlefield', stocks: 3, timeSeconds: 180 }, fingerprint,
    };
    expect(validRoomSummary(good)).toBe(true);
    expect(validRoomSummary({ ...good, code: 'bad' })).toBe(false);
    expect(validRoomSummary({ ...good, hostName: 'x'.repeat(33) })).toBe(false);
    expect(validRoomSummary({ ...good, players: 0 })).toBe(false);
    expect(validRoomSummary({ ...good, humans: 2, players: 1 })).toBe(false);
    expect(validRoomSummary({ ...good, token: 'secret' })).toBe(false);
  });

  it('lists only lobby rooms sorted by code with counts and no tokens', () => {
    let serial = 0;
    const codes = ['ZZZ999', 'AAA222'];
    const hub = new RoomHub({ token: () => `${++serial}`.padStart(48, '0'), code: () => codes.shift()! });
    const a = new Peer(); hub.connect(a);
    hub.receive(a, JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Zed', fingerprint }));
    const b = new Peer(); hub.connect(b);
    hub.receive(b, JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Amy', fingerprint }));
    const joiner = new Peer(); hub.connect(joiner);
    hub.receive(joiner, JSON.stringify({ type: 'join', protocol: ROOM_PROTOCOL, code: 'AAA222', name: 'Guest', fingerprint }));
    hub.receive(a, JSON.stringify({ type: 'cpu', token: a.token, slot: 3, fighter: 'Kb' }));
    // Start the first room so it leaves the lobby directory.
    for (const peer of [b, joiner]) hub.receive(peer, JSON.stringify({ type: 'ready', token: peer.token, assetsLoaded: true }));
    hub.receive(b, JSON.stringify({ type: 'start', token: b.token }));
    const rooms = hub.listRooms();
    expect(rooms.map(room => room.code)).toEqual(['ZZZ999']);
    const entry = rooms[0]!;
    expect(entry).toMatchObject({ phase: 'lobby', players: 2, humans: 1, maxPlayers: 8, hostName: 'Zed' });
    expect(JSON.stringify(entry)).not.toContain(a.token);
    expect(entry.rules).toMatchObject({ stage: 'battlefield' });
    expect(entry.fingerprint).toEqual(fingerprint);
    hub.shutdown();
  });

  it('deletes the directory entry when its last human leaves', () => {
    const hub = new RoomHub({ code: () => 'ABC234' });
    const host = new Peer(); hub.connect(host);
    hub.receive(host, JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'Solo', fingerprint }));
    expect(hub.listRooms()).toHaveLength(1);
    hub.receive(host, JSON.stringify({ type: 'leave', token: host.token }));
    expect(hub.listRooms()).toHaveLength(0);
    hub.shutdown();
  });
});

describe('room browser HTTP endpoint', () => {
  let server: Server;
  let origin = '';
  beforeAll(async () => {
    server = await createMeleeServer({
      staticRoot: resolve('web'),
      source: { manifest: sourceFixture(), read: async () => new Uint8Array(), close: async () => {} },
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise<void>(done => server.close(() => done()));
  });

  it('serves an empty lobby directory as JSON without disc reads', async () => {
    const response = await fetch(`${origin}/api/rooms`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { rooms: unknown[] };
    expect(body.rooms).toEqual([]);
  });

  it('rejects cross-origin reads like the asset manifest', async () => {
    const response = await fetch(`${origin}/api/rooms`, { headers: { Origin: 'https://other.example' } });
    expect(response.status).toBe(403);
  });
});
