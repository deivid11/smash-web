import { describe, expect, it } from 'vitest';
import { RoomHub, type RoomPeer } from '../../server/rooms.ts';
import { ROOM_PROTOCOL, MAX_ROOM_PAYLOAD, parseClientMessage, sameFingerprint, validFingerprint, type Fingerprint, type ServerMessage } from '../../lib/net/protocol.ts';

const identity = { id: 'custom:example.dummy' as const, hash: 'c'.repeat(64) };
const fingerprint: Fingerprint = { game: 'pack-test', wasm: 'a'.repeat(64), content: 'b'.repeat(64), packs: [identity] };
class Peer implements RoomPeer {
  messages: ServerMessage[] = [];
  send(message: ServerMessage) { this.messages.push(structuredClone(message)); return true; }
  close() {}
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> { return this.messages.filter(m => m.type === type).at(-1) as Extract<ServerMessage, { type: T }>; }
}
function room() {
  let serial = 0;
  const hub = new RoomHub({ now: () => 1000, code: () => 'ABC234', token: () => String(++serial).padStart(48, '0'), startDelayMs: 0, reconnectGraceMs: 90_000 });
  const send = (peer: Peer, value: object) => hub.receive(peer, JSON.stringify(value));
  const host = new Peer(); hub.connect(host);
  send(host, { type: 'create', protocol: ROOM_PROTOCOL, name: 'Host', fingerprint });
  const connect = () => { const peer = new Peer(); hub.connect(peer); return peer; };
  return { hub, host, send, connect };
}
describe('custom-pack multiplayer compatibility', () => {
  it('compares pack hashes even when the game, WASM and base content match', () => {
    expect(sameFingerprint(fingerprint, structuredClone(fingerprint))).toBe(true);
    expect(sameFingerprint(fingerprint, { ...fingerprint, packs: [] })).toBe(false);
    expect(sameFingerprint(fingerprint, { ...fingerprint, packs: [{ ...identity, hash: 'd'.repeat(64) }] })).toBe(false);
    expect(validFingerprint({ ...fingerprint, packs: [identity, identity] })).toBe(false);
    expect(validFingerprint({ ...fingerprint, packs: [{ ...identity, url: 'https://example.org/mod.js' }] })).toBe(false);
  });
  it.each(['join', 'spectate'] as const)('rejects missing, different, and extra packs before %s membership', type => {
    for (const packs of [[], [{ ...identity, hash: 'd'.repeat(64) }], [identity, { id: 'custom:other.pack' as const, hash: 'e'.repeat(64) }]]) {
      const { host, send, connect } = room(), peer = connect();
      send(peer, { type, protocol: ROOM_PROTOCOL, code: 'ABC234', ...(type === 'join' ? { name: 'Guest' } : {}), fingerprint: { ...fingerprint, packs } });
      expect(peer.last('error').code).toBe('FINGERPRINT_MISMATCH');
      expect(peer.last('error').message).toContain('Custom character packs');
      expect(peer.last('error').message).not.toContain('/private/');
      expect(peer.messages.some(m => m.type === 'joined' || m.type === 'spectating')).toBe(false);
      expect(host.last('joined').room.players).toHaveLength(1);
    }
  });
  it('allows exact matching humans, CPU seats and spectators, but rejects undeclared fighters', () => {
    const { host, send, connect } = room(), guest = connect();
    send(guest, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'Guest', fingerprint });
    const hostToken = host.last('joined').token, guestToken = guest.last('joined').token;
    send(host, { type: 'choose', token: hostToken, fighter: identity.id });
    send(host, { type: 'cpu', token: hostToken, slot: 2, fighter: identity.id });
    expect(host.last('room').room.players.filter(p => p.fighter === identity.id)).toHaveLength(2);
    for (const type of ['choose', 'cpu']) {
      send(host, { type, token: hostToken, fighter: 'custom:absent.character', ...(type === 'cpu' ? { slot: 3 } : {}) });
      expect(host.last('error').code).toBe('PACK_NOT_INSTALLED');
    }
    send(host, { type: 'ready', token: hostToken, assetsLoaded: true }); send(guest, { type: 'ready', token: guestToken, assetsLoaded: true });
    send(host, { type: 'start', token: hostToken });
    expect(host.last('start').fingerprint.packs).toEqual([identity]);
    expect(host.last('start').players[0]?.fighter).toBe(identity.id);
    const spectator = connect(); send(spectator, { type: 'spectate', protocol: ROOM_PROTOCOL, code: 'ABC234', fingerprint });
    expect(spectator.last('spectating').room.fingerprint.packs).toEqual([identity]);
  });
  it('refuses a held-seat resume when the returning installation changed its packs', () => {
    const { hub, host, send, connect } = room(), guest = connect();
    send(guest, { type: 'join', protocol: ROOM_PROTOCOL, code: 'ABC234', name: 'Guest', fingerprint });
    const token = guest.last('joined').token;
    send(host, { type: 'ready', token: host.last('joined').token, assetsLoaded: true }); send(guest, { type: 'ready', token, assetsLoaded: true });
    send(host, { type: 'start', token: host.last('joined').token }); hub.disconnect(guest);
    const returning = connect();
    send(returning, { type: 'resume', protocol: ROOM_PROTOCOL, code: 'ABC234', token, from: 0, fingerprint: { ...fingerprint, packs: [] } });
    expect(returning.last('error').code).toBe('RESUME_FAILED');
    expect(returning.messages.some(m => m.type === 'start')).toBe(false);
  });
  it('fits a maximum-sized pack advertisement inside the existing input payload bound', () => {
    const packs = Array.from({ length: 16 }, (_, index) => ({ id: `custom:${'n'.repeat(24)}.${'c'.repeat(22)}${String(index).padStart(2, '0')}`, hash: 'd'.repeat(64) }));
    const raw = JSON.stringify({ type: 'create', protocol: ROOM_PROTOCOL, name: 'x'.repeat(32), fingerprint: { game: 'g'.repeat(128), wasm: 'a'.repeat(64), content: 'b'.repeat(64), packs } });
    expect(raw.length).toBeLessThan(MAX_ROOM_PAYLOAD);
    expect(parseClientMessage(raw).type).toBe('create');
  });
  it('rejects legacy protocol and malformed custom identifiers at the transport boundary', () => {
    expect(() => parseClientMessage(JSON.stringify({ type: 'create', protocol: 9, name: 'Old client', fingerprint }))).toThrow();
    for (const fighter of ['custom:../secret', 'custom:example', 'custom:Example.dummy', 'custom:a.b/c']) expect(() => parseClientMessage(JSON.stringify({ type: 'choose', token: 'token', fighter }))).toThrow();
  });
});
