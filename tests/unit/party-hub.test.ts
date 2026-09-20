import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type { PublicProfile } from '../../lib/net/account-protocol.ts';
import {
  CHANNELS, MAX_PARTIES, MAX_PARTY_MEMBERS, PARTY_INVITE_TTL_MS, PARTY_PROTOCOL, PARTY_SOCKET_PATH, VOICE_CONFIG_PATH,
  type PartyServerMessage,
} from '../../lib/net/party-protocol.ts';
import { ROOM_SOCKET_PATH } from '../../lib/net/protocol.ts';
import { PartyHub, REASON_KICKED, REASON_REPLACED, type PartyPeer } from '../../server/party-hub.ts';
import { createMeleeServer } from '../../server/http.ts';
import { sourceFixture } from './source-fixture.ts';

const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=msid:s a\r\n';
const candidate = 'candidate:1 1 udp 2113937151 192.168.1.2 54400 typ host';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const tokenOf = (id: number): string => `token-for-user-${String(id).padStart(4, '0')}`;

class Peer implements PartyPeer {
  messages: PartyServerMessage[] = []; closed: { code: number; reason: string } | null = null; congested = false;
  send(message: PartyServerMessage): boolean { if (this.congested) return false; this.messages.push(structuredClone(message)); return true; }
  close(code: number, reason: string): void { this.closed = { code, reason }; }
  all<T extends PartyServerMessage['type']>(type: T): Array<Extract<PartyServerMessage, { type: T }>> {
    return this.messages.filter(message => message.type === type) as Array<Extract<PartyServerMessage, { type: T }>>;
  }
  last<T extends PartyServerMessage['type']>(type: T): Extract<PartyServerMessage, { type: T }> { return this.all(type).at(-1)!; }
  get party() { return this.last('party').party; }
  get errors(): string[] { return this.all('error').map(error => error.code); }
  group(id: string) { return this.last('directory').groups.find(group => group.id === id); }
  clear(): void { this.messages = []; }
}
/** Users 1..n; `friends` are symmetric pairs. */
function setup(users: number, friends: Array<[number, number]> = []) {
  let clock = 10_000, serial = 0, inviteSerial = 0;
  const pairs = [...friends];
  const hub = new PartyHub({
    now: () => clock, inviteId: () => (++inviteSerial).toString(16).padStart(16, '0'),
    // PART22, PART23, … : 1024 distinct ids, enough for the party cap test.
    id: () => { const index = serial++; return `PART${ALPHABET[(index >> 5) % 32]}${ALPHABET[index % 32]}`; },
    directory: {
      authenticate: token => { const match = /^token-for-user-(\d{4})$/u.exec(token); if (!match || Number(match[1]) > users) throw new Error('bad token'); return Number(match[1]); },
      profile: (id): PublicProfile => ({ id, username: `user${id}`, displayName: `User ${id}`, avatar: 'Mr', title: '', createdAt: 1, rift: null }),
      friendIds: id => pairs.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : [])),
    },
  });
  const send = (peer: Peer, message: object): void => hub.receive(peer, JSON.stringify(message));
  const open = (id: number): Peer => { const peer = new Peer(); hub.connect(peer); send(peer, { type: 'auth', protocol: PARTY_PROTOCOL, token: tokenOf(id) }); return peer; };
  const peers = Array.from({ length: users }, (_, index) => open(index + 1));
  return { hub, peers, send, open, pairs, advance: (ms: number) => { clock += ms; } };
}

describe('party hub: sign-in', () => {
  it('greets, authenticates and sends the initial state in a fixed order', () => {
    const { peers: [peer] } = setup(1);
    expect(peer!.messages.map(message => message.type)).toEqual(['hello', 'authed', 'directory', 'invites', 'party']);
    expect(peer!.last('authed').me).toMatchObject({ id: 1, username: 'user1' });
    expect(peer!.last('invites').invites).toEqual([]);
    expect(peer!.party).toBeNull();
    expect(peer!.last('directory').groups.map(group => group.id)).toEqual(CHANNELS.map(channel => channel.id));
    expect(peer!.group('#lobby')).toMatchObject({ kind: 'channel', privacy: 'open', leaderName: null, members: 0, maxMembers: MAX_PARTY_MEMBERS, joinable: true });
  });
  it('rejects a bad token and closes', () => {
    const { hub, send } = setup(1);
    const peer = new Peer(); hub.connect(peer);
    send(peer, { type: 'auth', protocol: PARTY_PROTOCOL, token: 'not-a-known-token-0000' });
    expect(peer.errors).toEqual(['AUTH_FAILED']); expect(peer.closed?.code).toBe(1008); expect(hub.clientCount).toBe(1);
  });
  it('accepts only auth and ping before sign-in', () => {
    const { hub, send } = setup(0);
    const peer = new Peer(); hub.connect(peer);
    send(peer, { type: 'ping', nonce: 7 });
    expect(peer.last('pong').nonce).toBe(7);
    for (const message of [{ type: 'list' }, { type: 'join', id: '#lobby' }, { type: 'create', name: 'X', privacy: 'open' }, { type: 'voice-offer', target: 2, sdp }]) send(peer, message);
    expect(peer.errors).toEqual(['NOT_AUTHED', 'NOT_AUTHED', 'NOT_AUTHED', 'NOT_AUTHED']);
    expect(peer.closed).toBeNull(); expect(hub.partyCount).toBe(0);
  });
  it('lets a second socket replace the first and keeps the membership, seniority and leadership', () => {
    const { hub, peers: [one, two], send, open } = setup(2);
    send(one!, { type: 'create', name: 'Squad', privacy: 'open' });
    send(two!, { type: 'join', id: 'PART22' });
    send(one!, { type: 'status', mic: true, activity: 'lan' });
    two!.clear();
    const fresh = open(1);
    expect(one!.last('party')).toEqual({ type: 'party', party: null, reason: REASON_REPLACED });
    expect(one!.closed).toEqual({ code: 1000, reason: REASON_REPLACED });
    // The mesh peer sees the member leave, then come back, so it renegotiates with the new browser.
    expect(two!.all('party').map(message => message.party!.members.map(member => member.id))).toEqual([[2], [1, 2]]);
    expect(fresh.messages.map(message => message.type)).toEqual(['hello', 'authed', 'directory', 'invites', 'party']);
    expect(fresh.party).toMatchObject({ id: 'PART22', leaderId: 1, members: [{ id: 1, mic: false }, { id: 2 }] });
    expect(hub.clientCount).toBe(2);
    // The replaced socket is inert; its late close does not evict the new one.
    hub.disconnect(one!); send(one!, { type: 'leave' });
    expect(hub.partyCount).toBe(1); expect(two!.party!.members).toHaveLength(2);
    send(fresh, { type: 'kick', userId: 2 });
    expect(two!.last('party').reason).toBe(REASON_KICKED);
  });
});

describe('party hub: channels and parties', () => {
  it('keeps channels forever and caps them at eight members', () => {
    const { hub, peers, send } = setup(MAX_PARTY_MEMBERS + 1);
    for (const peer of peers) send(peer, { type: 'join', id: '#lfg' });
    expect(peers[7]!.party).toMatchObject({ id: '#lfg', kind: 'channel', leaderId: null, privacy: 'open', maxMembers: 8 });
    expect(peers[7]!.party!.members).toHaveLength(8);
    expect(peers[8]!.errors).toEqual(['GROUP_FULL']); expect(peers[8]!.party).toBeNull();
    expect(peers[8]!.group('#lfg')).toMatchObject({ members: 8, joinable: false });
    for (const peer of peers) send(peer, { type: 'leave' });
    expect(peers[0]!.party).toBeNull();
    expect(peers[8]!.group('#lfg')).toMatchObject({ members: 0, joinable: true });
    expect(hub.partyCount).toBe(0);
  });
  it('creates, joins, switches and leaves', () => {
    const { hub, peers: [one, two], send } = setup(2);
    send(one!, { type: 'create', name: '  Friday   Night ', privacy: 'open' });
    expect(one!.party).toMatchObject({ id: 'PART22', kind: 'party', name: 'Friday Night', leaderId: 1, members: [{ id: 1, name: 'User 1', avatar: 'Mr', mic: false, activity: 'menu' }] });
    send(two!, { type: 'join', id: 'PART99' });
    expect(two!.errors).toEqual(['GROUP_NOT_FOUND']);
    send(two!, { type: 'join', id: 'PART22' });
    expect(one!.party!.members.map(member => member.id)).toEqual([1, 2]);
    // Hopping to a channel leaves the party first; nobody is ever in two groups.
    send(two!, { type: 'join', id: '#lobby' });
    expect(two!.party!.id).toBe('#lobby'); expect(one!.party!.members.map(member => member.id)).toEqual([1]);
    // Creating while in a group leaves it too; the emptied party disappears.
    send(one!, { type: 'create', name: 'Second', privacy: 'friends' });
    expect(one!.party!.id).toBe('PART23'); expect(hub.partyCount).toBe(1); expect(two!.group('PART22')).toBeUndefined();
    send(one!, { type: 'leave' });
    expect(one!.last('party')).toEqual({ type: 'party', party: null }); expect(hub.partyCount).toBe(0);
  });
  it('hands leadership to the longest-standing member and deletes an empty party with its invites', () => {
    const { hub, peers: [one, two, three, four], send } = setup(4, [[2, 4]]);
    send(one!, { type: 'create', name: 'Crew', privacy: 'open' });
    send(two!, { type: 'join', id: 'PART22' }); send(three!, { type: 'join', id: 'PART22' });
    send(two!, { type: 'invite', userId: 4 });
    expect(four!.last('invites').invites).toHaveLength(1);
    hub.disconnect(one!);
    expect(two!.party).toMatchObject({ leaderId: 2, members: [{ id: 2 }, { id: 3 }] });
    expect(three!.group('PART22')!.leaderName).toBe('User 2');
    send(two!, { type: 'leave' }); expect(three!.party!.leaderId).toBe(3);
    send(three!, { type: 'leave' });
    expect(hub.partyCount).toBe(0); expect(four!.last('invites').invites).toEqual([]); expect(four!.group('PART22')).toBeUndefined();
  });
  it('caps the number of parties', () => {
    const { peers, send } = setup(MAX_PARTIES + 1);
    for (const peer of peers) send(peer, { type: 'create', name: 'Full house', privacy: 'open' });
    expect(peers[MAX_PARTIES - 1]!.errors).toEqual([]); expect(peers[MAX_PARTIES]!.errors).toEqual(['PARTY_LIMIT']);
    // Re-creating from a party one is alone in frees that place first.
    send(peers[0]!, { type: 'create', name: 'Again', privacy: 'open' });
    expect(peers[0]!.errors).toEqual([]); expect(peers[0]!.party!.name).toBe('Again');
  });
});

describe('party hub: privacy and invitations', () => {
  it('opens friends-only parties to friends of the LEADER only', () => {
    const { peers: [leader, friend, memberFriend, stranger], send } = setup(4, [[1, 2], [2, 3]]);
    send(leader!, { type: 'create', name: 'Friends', privacy: 'friends' });
    expect(friend!.group('PART22')).toMatchObject({ joinable: true, friendInside: true });
    expect(stranger!.group('PART22')).toMatchObject({ joinable: false, friendInside: false, privacy: 'friends' });
    send(stranger!, { type: 'join', id: 'PART22' }); expect(stranger!.errors).toEqual(['NOT_ALLOWED']);
    send(friend!, { type: 'join', id: 'PART22' }); expect(friend!.party!.members).toHaveLength(2);
    // A friend of a member who is not the leader's friend sees a friend inside but cannot walk in.
    expect(memberFriend!.group('PART22')).toMatchObject({ joinable: false, friendInside: true });
    send(memberFriend!, { type: 'join', id: 'PART22' }); expect(memberFriend!.errors).toEqual(['NOT_ALLOWED']);
    send(friend!, { type: 'invite', userId: 3 });
    expect(memberFriend!.group('PART22')!.joinable).toBe(true);
    send(memberFriend!, { type: 'join', id: 'PART22' }); expect(memberFriend!.party!.members).toHaveLength(3);
  });
  it('runs the invite flow: friends only, refresh, consumed on join, dismiss, TTL', () => {
    const { peers: [one, two, three], send, advance, hub } = setup(3, [[1, 2]]);
    send(one!, { type: 'invite', userId: 2 }); expect(one!.errors).toEqual(['NOT_IN_PARTY']);
    send(one!, { type: 'join', id: '#lobby' }); send(one!, { type: 'invite', userId: 2 }); expect(one!.errors).toEqual(['NOT_IN_PARTY', 'NOT_IN_PARTY']);
    send(one!, { type: 'create', name: 'Secret', privacy: 'invite' });
    send(one!, { type: 'invite', userId: 3 }); expect(one!.errors.at(-1)).toBe('NOT_FRIEND');
    send(two!, { type: 'join', id: 'PART22' }); expect(two!.errors).toEqual(['NOT_ALLOWED']);
    send(one!, { type: 'invite', userId: 2 });
    expect(two!.last('invites').invites).toEqual([{ id: '0000000000000001', partyId: 'PART22', partyName: 'Secret', from: expect.objectContaining({ id: 1 }), expiresAt: 10_000 + PARTY_INVITE_TTL_MS }]);
    // Re-inviting refreshes the same invitation instead of stacking a second one.
    advance(60_000); send(one!, { type: 'invite', userId: 2 });
    expect(two!.last('invites').invites).toEqual([expect.objectContaining({ id: '0000000000000001', expiresAt: 70_000 + PARTY_INVITE_TTL_MS })]);
    // Dismissing someone else's invite does nothing; one's own disappears.
    send(three!, { type: 'dismiss', id: '0000000000000001' }); expect(two!.last('invites').invites).toHaveLength(1);
    send(two!, { type: 'dismiss', id: '0000000000000001' }); expect(two!.last('invites').invites).toEqual([]);
    send(two!, { type: 'join', id: 'PART22' }); expect(two!.errors).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED']);
    // TTL: tick expires it and tells the holder.
    send(one!, { type: 'invite', userId: 2 }); expect(two!.group('PART22')!.joinable).toBe(true);
    advance(PARTY_INVITE_TTL_MS); hub.heartbeat(one!); hub.heartbeat(two!); hub.heartbeat(three!); hub.tick();
    expect(two!.last('invites').invites).toEqual([]);
    send(two!, { type: 'join', id: 'PART22' }); expect(two!.errors).toEqual(['NOT_ALLOWED', 'NOT_ALLOWED', 'NOT_ALLOWED']);
    // Joining consumes it; an already-member cannot be invited.
    send(one!, { type: 'invite', userId: 2 }); send(two!, { type: 'join', id: 'PART22' });
    expect(two!.party!.members).toHaveLength(2); expect(two!.last('invites').invites).toEqual([]);
    send(one!, { type: 'invite', userId: 2 }); expect(one!.errors.at(-1)).toBe('ALREADY_MEMBER');
  });
  it('delivers pending invitations at sign-in', () => {
    const { peers: [one, two], send, open, hub } = setup(2, [[1, 2]]);
    hub.disconnect(two!);
    send(one!, { type: 'create', name: 'Later', privacy: 'invite' }); send(one!, { type: 'invite', userId: 2 });
    const back = open(2);
    expect(back.last('invites').invites).toEqual([expect.objectContaining({ partyId: 'PART22', partyName: 'Later' })]);
    expect(back.group('PART22')!.joinable).toBe(true);
  });
  it('lists invite-only parties to members, invitees and friends of members only', () => {
    const { peers: [one, two, three, four], send } = setup(4, [[1, 2], [1, 3]]);
    send(one!, { type: 'create', name: 'Hidden', privacy: 'invite' });
    expect(one!.group('PART22')).toMatchObject({ joinable: false, members: 1 });
    expect(two!.group('PART22')).toMatchObject({ friendInside: true, joinable: false });
    expect(four!.group('PART22')).toBeUndefined();
    send(four!, { type: 'list' }); expect(four!.group('PART22')).toBeUndefined();
    send(four!, { type: 'join', id: 'PART22' }); expect(four!.errors).toEqual(['NOT_ALLOWED']);
    send(one!, { type: 'update', privacy: 'open' });
    expect(four!.group('PART22')).toMatchObject({ joinable: true, privacy: 'open' });
    expect(three!.last('directory').groups.map(group => group.id)).toEqual([...CHANNELS.map(channel => channel.id), 'PART22']);
  });
  it('sorts channels first, then parties with a friend inside, then by size', () => {
    const { peers: [one, two, three, four, viewer], send } = setup(5, [[5, 4]]);
    send(one!, { type: 'create', name: 'Big', privacy: 'open' }); send(two!, { type: 'join', id: 'PART22' });
    send(three!, { type: 'create', name: 'Small', privacy: 'open' });
    send(four!, { type: 'create', name: 'Friend', privacy: 'open' });
    expect(viewer!.last('directory').groups.slice(CHANNELS.length).map(group => group.name)).toEqual(['Friend', 'Big', 'Small']);
    expect(one!.last('directory').groups.slice(CHANNELS.length).map(group => group.name)).toEqual(['Big', 'Small', 'Friend']);
    expect(viewer!.group('PART22')).toMatchObject({ leaderName: 'User 1', names: ['User 1', 'User 2'], members: 2 });
  });
});

describe('party hub: leader tools, status, directory pushes', () => {
  it('lets only the leader kick and update', () => {
    const { peers: [one, two, three], send } = setup(3);
    send(one!, { type: 'create', name: 'Mine', privacy: 'open' }); send(two!, { type: 'join', id: 'PART22' });
    send(two!, { type: 'kick', userId: 1 }); send(two!, { type: 'update', name: 'Theirs' });
    expect(two!.errors).toEqual(['LEADER_ONLY', 'LEADER_ONLY']);
    send(one!, { type: 'kick', userId: 1 }); send(one!, { type: 'kick', userId: 3 });
    expect(one!.errors).toEqual(['NOT_MEMBER', 'NOT_MEMBER']);
    send(three!, { type: 'kick', userId: 1 }); expect(three!.errors).toEqual(['NOT_MEMBER']);
    send(three!, { type: 'join', id: '#rift' }); send(three!, { type: 'update', name: 'Hijack' }); expect(three!.errors.at(-1)).toBe('LEADER_ONLY');
    send(one!, { type: 'update', name: 'Renamed', privacy: 'friends' });
    expect(two!.party).toMatchObject({ name: 'Renamed', privacy: 'friends' }); expect(three!.group('PART22')).toMatchObject({ name: 'Renamed', joinable: false });
    send(one!, { type: 'kick', userId: 2 });
    expect(two!.last('party')).toEqual({ type: 'party', party: null, reason: REASON_KICKED });
    expect(one!.party!.members.map(member => member.id)).toEqual([1]);
  });
  it('publishes status changes once and never pushes a directory for them', () => {
    const { peers: [one, two, three], send } = setup(3);
    send(one!, { type: 'join', id: '#lobby' }); send(two!, { type: 'join', id: '#lobby' });
    for (const peer of [one!, two!, three!]) peer.clear();
    send(one!, { type: 'status', mic: true, activity: 'rift' }); send(one!, { type: 'status', mic: true, activity: 'rift' });
    expect(two!.all('party')).toHaveLength(1); expect(two!.party!.members[0]).toMatchObject({ id: 1, mic: true, activity: 'rift' });
    expect(three!.messages).toEqual([]);
    send(three!, { type: 'status', mic: true, activity: 'menu' }); expect(three!.messages).toEqual([]);
  });
  it('pushes one directory per connection per change, with per-viewer flags', () => {
    const { peers: [one, two, three], send } = setup(3, [[1, 2]]);
    for (const peer of [one!, two!, three!]) peer.clear();
    send(one!, { type: 'create', name: 'Pushed', privacy: 'friends' });
    for (const peer of [one!, two!, three!]) expect(peer.all('directory')).toHaveLength(1);
    expect(one!.group('PART22')).toMatchObject({ joinable: false, friendInside: false });
    expect(two!.group('PART22')).toMatchObject({ joinable: true, friendInside: true });
    expect(three!.group('PART22')).toMatchObject({ joinable: false, friendInside: false });
    // A switch touches two groups but is still one event.
    send(two!, { type: 'join', id: '#es' }); three!.clear(); send(two!, { type: 'join', id: 'PART22' });
    expect(three!.all('directory')).toHaveLength(1); expect(three!.group('#es')!.members).toBe(0); expect(three!.group('PART22')!.members).toBe(2);
    three!.clear(); send(three!, { type: 'list' }); expect(three!.messages.map(message => message.type)).toEqual(['directory']);
  });
});

describe('party hub: voice signaling', () => {
  it('relays inside one group with a server-assigned sender', () => {
    const { peers: [one, two, three], send } = setup(3);
    send(one!, { type: 'join', id: '#lobby' }); send(two!, { type: 'join', id: '#lobby' }); send(three!, { type: 'join', id: '#lfg' });
    send(one!, { type: 'voice-offer', target: 2, sdp });
    send(two!, { type: 'voice-answer', target: 1, sdp });
    send(one!, { type: 'voice-ice', target: 2, candidate, sdpMid: '0', sdpMLineIndex: 0 });
    expect(two!.last('voice-offer')).toEqual({ type: 'voice-offer', from: 1, sdp });
    expect(one!.last('voice-answer')).toEqual({ type: 'voice-answer', from: 2, sdp });
    expect(two!.last('voice-ice')).toEqual({ type: 'voice-ice', from: 1, candidate, sdpMid: '0', sdpMLineIndex: 0 });
    // Self, another group, offline, and a sender outside any group: refused, nothing closes.
    send(one!, { type: 'voice-offer', target: 1, sdp }); send(one!, { type: 'voice-offer', target: 3, sdp }); send(one!, { type: 'voice-ice', target: 99, candidate });
    expect(one!.errors).toEqual(['VOICE_TARGET', 'VOICE_TARGET', 'VOICE_TARGET']);
    send(two!, { type: 'leave' }); send(two!, { type: 'voice-offer', target: 1, sdp }); expect(two!.errors).toEqual(['VOICE_TARGET']);
    expect(three!.all('voice-offer')).toEqual([]); expect([one!, two!, three!].every(peer => peer.closed === null)).toBe(true);
  });
  it('rejects smuggled fields and malformed payloads, then closes', () => {
    for (const message of [
      { type: 'voice-offer', target: 2, sdp, from: 3 }, { type: 'update', name: 'X', leaderId: 2 }, { type: 'create', name: 'X', privacy: 'open', leaderId: 1 },
      { type: 'status', mic: true, activity: 'menu', id: 2 }, { type: 'join', id: 'party2' }, { type: 'update' }, { type: 'auth', protocol: PARTY_PROTOCOL + 1, token: tokenOf(1) },
    ]) {
      const { peers: [one, two], send, hub } = setup(2);
      send(one!, { type: 'join', id: '#lobby' }); send(two!, { type: 'join', id: '#lobby' });
      send(one!, message);
      expect(one!.errors).toEqual(['BAD_MESSAGE']); expect(one!.closed?.code).toBe(1008);
      expect(two!.all('voice-offer')).toEqual([]); expect(two!.party!.members.map(member => member.id)).toEqual([2]); expect(hub.clientCount).toBe(1);
    }
    const { peers: [one], hub } = setup(1);
    hub.receive(one!, '{nope'); expect(one!.errors).toEqual(['BAD_MESSAGE']);
  });
});

describe('party hub: limits', () => {
  it('rate-limits a flood and refills with time', () => {
    const { peers: [one, two], send, advance } = setup(2);
    // auth cost 10 of 300: 29 more full-price commands fit, the next one is over budget.
    for (let index = 0; index < 29; index++) send(one!, { type: 'list' });
    expect(one!.closed).toBeNull();
    send(one!, { type: 'list' });
    expect(one!.errors).toEqual(['RATE_LIMIT']); expect(one!.closed?.code).toBe(1008);
    // ICE and status are cheap: 140 fit in what is left after auth + join.
    send(two!, { type: 'join', id: '#lobby' });
    for (let index = 0; index < 140; index++) send(two!, { type: 'status', mic: index % 2 === 0, activity: 'menu' });
    expect(two!.closed).toBeNull();
    advance(2000); for (let index = 0; index < 30; index++) send(two!, { type: 'ping', nonce: index });
    expect(two!.closed).toBeNull(); expect(two!.all('pong')).toHaveLength(30);
  });
  it('drops idle sockets after 45 s and unauthenticated ones after 15 s', () => {
    const { hub, peers: [one, two], send, advance } = setup(2);
    send(one!, { type: 'join', id: '#lobby' }); send(two!, { type: 'join', id: '#lobby' });
    const anonymous = new Peer(); hub.connect(anonymous);
    advance(15_001); hub.heartbeat(anonymous); hub.tick();
    expect(anonymous.closed?.code).toBe(1008); expect(anonymous.errors).toEqual(['TIMEOUT']); expect(one!.closed).toBeNull();
    advance(30_000); hub.heartbeat(two!); hub.tick();
    expect(one!.closed?.code).toBe(1008); expect(two!.closed).toBeNull();
    expect(two!.party!.members.map(member => member.id)).toEqual([2]); expect(hub.clientCount).toBe(1);
  });
  it('disconnects a congested peer and refuses connections past the cap', () => {
    const { hub, peers: [one, two], send } = setup(2);
    send(one!, { type: 'join', id: '#lobby' }); send(two!, { type: 'join', id: '#lobby' });
    two!.congested = true; send(one!, { type: 'status', mic: true, activity: 'menu' });
    expect(two!.closed?.code).toBe(1013); expect(one!.party!.members.map(member => member.id)).toEqual([1]);
    const small = new PartyHub({ maxClients: 1, directory: { authenticate: () => 1, profile: () => null, friendIds: () => [] } });
    expect(small.connect(new Peer())).toBe(true);
    const refused = new Peer(); expect(small.connect(refused)).toBe(false); expect(refused.closed?.code).toBe(1013);
    hub.shutdown(); expect(one!.closed?.code).toBe(1001); expect(hub.clientCount).toBe(0);
  });
});

describe('party chat on the real server', () => {
  let server: Server, bare: Server, base: string, directory: string;
  beforeAll(async () => {
    const parent = fileURLToPath(new URL('../../.local/', import.meta.url));
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'party-tests-'));
    await writeFile(join(directory, 'play.html'), '<html><head></head><body></body></html>');
    const source = { manifest: sourceFixture(), read: async () => new Uint8Array(), close: async () => {} };
    server = await createMeleeServer({ source, staticRoot: directory, databasePath: ':memory:' });
    bare = await createMeleeServer({ source, staticRoot: directory, iceServers: [] });
    for (const entry of [server, bare]) await new Promise<void>(resolve => entry.listen(0, '127.0.0.1', resolve));
    base = `127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    for (const entry of [server, bare]) if (entry) await new Promise<void>(resolve => entry.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  /** Resolves with the first `count` JSON messages, or rejects with the refused upgrade's status. */
  const dial = (host: string, path: string, first: object | null, count: number, origin = `http://${host}`) => new Promise<Array<{ type: string; [key: string]: unknown }>>((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}${path}`, { origin }), messages: Array<{ type: string }> = [];
    ws.on('unexpected-response', (_request, response) => { reject(new Error(`HTTP ${response.statusCode}`)); ws.terminate(); });
    ws.on('error', reject);
    ws.on('message', data => {
      messages.push(JSON.parse(data.toString()) as { type: string });
      if (messages.length === 1 && first) ws.send(JSON.stringify(first));
      if (messages.length === count) { ws.close(); resolve(messages); }
    });
  });

  it('serves the voice config', async () => {
    const response = await fetch(`http://${base}${VOICE_CONFIG_PATH}`);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] });
    expect((await fetch(`http://${base}${VOICE_CONFIG_PATH}`, { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
    const lan = `127.0.0.1:${(bare.address() as { port: number }).port}`;
    expect(await (await fetch(`http://${lan}${VOICE_CONFIG_PATH}`)).json()).toEqual({ iceServers: [] });
  });
  it('authenticates a real socket on the party path while the room path still works', async () => {
    const registered = await (await fetch(`http://${base}/api/account/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'partygoer', password: 'http password' }) })).json() as { token: string };
    const messages = await dial(base, PARTY_SOCKET_PATH, { type: 'auth', protocol: PARTY_PROTOCOL, token: registered.token }, 5);
    expect(messages.map(message => message.type)).toEqual(['hello', 'authed', 'directory', 'invites', 'party']);
    expect(messages[1]).toMatchObject({ me: { username: 'partygoer' } });
    expect((await dial(base, ROOM_SOCKET_PATH, null, 1))[0]).toMatchObject({ type: 'hello' });
    await expect(dial(base, PARTY_SOCKET_PATH, null, 1, 'http://evil.example')).rejects.toThrow('HTTP 403');
    await expect(dial(base, '/api/nothing', null, 1)).rejects.toThrow('HTTP 403');
  });
  it('answers 503 on the party path when accounts are disabled', async () => {
    const lan = `127.0.0.1:${(bare.address() as { port: number }).port}`;
    await expect(dial(lan, PARTY_SOCKET_PATH, null, 1)).rejects.toThrow('HTTP 503');
    expect((await dial(lan, ROOM_SOCKET_PATH, null, 1))[0]).toMatchObject({ type: 'hello' });
  });
});
