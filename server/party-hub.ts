import { randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import type { PublicProfile } from '../lib/net/account-protocol.ts';
import {
  CHANNELS, MAX_PARTIES, MAX_PARTY_MEMBERS, MAX_PARTY_PAYLOAD, PARTY_INVITE_TTL_MS, PARTY_PROTOCOL, PARTY_SOCKET_PATH,
  cleanPartyName, parsePartyMessage,
  type PartyClientMessage, type PartyInvite, type PartyMember, type PartyPrivacy, type PartyServerMessage, type PartySummary, type PartyView,
} from '../lib/net/party-protocol.ts';

/** Global voice parties and channels: signaling only (SDP / ICE), audio is mesh P2P.
 * Unlike LAN rooms this socket IS account-bound: every command runs as the user the
 * bearer token resolved to, and one user owns at most one live socket. */
export interface PartyPeer { send(message: PartyServerMessage): boolean; close(code: number, reason: string): void }
/** Everything the hub needs from accounts; tests inject a fake. */
export interface PartyDirectory {
  /** Throws when the token is invalid or expired. */
  authenticate(token: string): number;
  profile(userId: number): PublicProfile | null;
  friendIds(userId: number): number[];
}
export interface PartyHubOptions {
  directory: PartyDirectory; now?: () => number;
  /** 6 chars of ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (never starts with `#`, so it cannot shadow a channel). */
  id?: () => string;
  /** Lowercase hex, 8–32 chars (the `dismiss` parser bound). */
  inviteId?: () => string;
  maxClients?: number;
}
/** Map order is join order: the first remaining member inherits leadership. */
interface Group { id: string; kind: PartyView['kind']; name: string; topic: string; privacy: PartyPrivacy; leaderId: number | null; members: Map<number, PartyMember> }
interface Invite { id: string; partyId: string; from: number; to: number; expiresAt: number }
interface Connection {
  peer: PartyPeer; connectedAt: number; activeAt: number; budgetAt: number; budget: number;
  /** Set by a successful `auth`; everything but auth/ping is refused before. */
  profile?: PublicProfile; group?: Group;
  /** Already got a directory inside this event (auth / list): skip the coalesced push. */
  fresh?: boolean;
}
const IDLE_MS = 45_000, UNAUTHED_MS = 15_000, MAX_INVITES_PER_TARGET = 20, BUDGET = 300, REFILL_PER_MS = 0.15;
export const REASON_REPLACED = 'Signed in to party chat from another tab or device.';
export const REASON_KICKED = 'The party leader removed you.';

export class PartyHub {
  private readonly groups = new Map<string, Group>();
  private readonly connections = new Map<PartyPeer, Connection>();
  /** The one live socket per account. */
  private readonly users = new Map<number, Connection>();
  private readonly invites = new Map<string, Invite>();
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly newInviteId: () => string;
  /** Publication is deferred to the end of the outermost event: a congested peer dropped while
   * publishing re-dirties its group instead of letting a stale view overtake a fresh one. */
  private depth = 0;
  private readonly dirtyGroups = new Set<Group>();
  private readonly dirtyInvites = new Set<number>();
  private dirtyDirectory = false;
  constructor(private readonly options: PartyHubOptions) {
    this.now = options.now ?? Date.now;
    this.newId = options.id ?? (() => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''));
    this.newInviteId = options.inviteId ?? (() => randomBytes(8).toString('hex'));
    for (const channel of CHANNELS) this.groups.set(channel.id, { id: channel.id, kind: 'channel', name: channel.name, topic: channel.topic, privacy: 'open', leaderId: null, members: new Map() });
  }
  get clientCount(): number { return this.connections.size; }
  get partyCount(): number { return this.groups.size - CHANNELS.length; }

  // ——— Event scope + deferred publication ———

  private run(work: () => void): void {
    this.depth++;
    try { work(); } finally { if (--this.depth === 0) this.flush(); }
  }
  private flush(): void {
    this.depth++;
    try {
      // Every extra pass needs a connection dropped by the previous one, so this terminates.
      while (this.dirtyGroups.size || this.dirtyInvites.size || this.dirtyDirectory) {
        const groups = [...this.dirtyGroups], invitees = [...this.dirtyInvites], directory = this.dirtyDirectory;
        this.dirtyGroups.clear(); this.dirtyInvites.clear(); this.dirtyDirectory = false;
        for (const group of groups) {
          if (this.groups.get(group.id) !== group) continue;
          const message: PartyServerMessage = { type: 'party', party: this.view(group) };
          for (const id of [...group.members.keys()]) { const connection = this.users.get(id); if (connection?.group === group) this.send(connection, message); }
        }
        for (const id of invitees) { const connection = this.users.get(id); if (connection) this.send(connection, { type: 'invites', invites: this.invitesFor(id) }); }
        if (directory) for (const connection of [...this.connections.values()]) if (connection.profile && !connection.fresh) this.sendDirectory(connection);
      }
    } finally { this.depth--; for (const connection of this.connections.values()) connection.fresh = undefined; }
  }
  /** Membership, name or privacy changed: members get the view, everyone a directory. */
  private touch(group: Group): void { this.dirtyGroups.add(group); this.dirtyDirectory = true; }

  // ——— Transport ———

  private send(connection: Connection, message: PartyServerMessage): void {
    if (this.connections.get(connection.peer) === connection && !connection.peer.send(message)) this.drop(connection, 1013, 'Connection congested.');
  }
  private error(connection: Connection, code: string, message: string): void { this.send(connection, { type: 'error', code, message }); }
  /** Forget the socket, leave its group, close it. Safe to call re-entrantly from send(). */
  private drop(connection: Connection, closeCode: number, reason: string): void {
    this.forget(connection); connection.peer.close(closeCode, reason);
  }
  private forget(connection: Connection): void {
    if (this.connections.get(connection.peer) !== connection) return;
    this.connections.delete(connection.peer);
    const id = connection.profile?.id;
    if (id !== undefined && this.users.get(id) === connection) { this.users.delete(id); this.leaveGroup(connection); }
  }
  connect(peer: PartyPeer): boolean {
    if (this.connections.size >= (this.options.maxClients ?? 256)) { peer.close(1013, 'Party chat is full.'); return false; }
    const now = this.now(), connection: Connection = { peer, connectedAt: now, activeAt: now, budgetAt: now, budget: BUDGET };
    this.connections.set(peer, connection);
    this.run(() => this.send(connection, { type: 'hello', protocol: PARTY_PROTOCOL }));
    return this.connections.has(peer);
  }
  disconnect(peer: PartyPeer): void { const connection = this.connections.get(peer); if (connection) this.run(() => this.forget(connection)); }
  /** Called by transport pong, not by arbitrary traffic. */
  heartbeat(peer: PartyPeer): void { const connection = this.connections.get(peer); if (connection) connection.activeAt = this.now(); }
  tick(): void {
    const now = this.now();
    this.run(() => {
      for (const connection of [...this.connections.values()]) {
        if (now - connection.activeAt > IDLE_MS || (!connection.profile && now - connection.connectedAt > UNAUTHED_MS)) {
          this.error(connection, 'TIMEOUT', connection.profile ? 'Party chat connection timed out.' : 'Sign in to party chat within 15 seconds.');
          this.drop(connection, 1008, 'Party chat connection timed out.');
        }
      }
      for (const invite of [...this.invites.values()]) if (invite.expiresAt <= now) this.removeInvite(invite);
    });
  }
  shutdown(): void { this.run(() => { for (const connection of [...this.connections.values()]) this.drop(connection, 1001, 'Party chat shut down.'); }); }
  private spend(connection: Connection, now: number, cost: number): boolean {
    connection.budget = Math.min(BUDGET, connection.budget + Math.max(0, now - connection.budgetAt) * REFILL_PER_MS); connection.budgetAt = now;
    if (connection.budget < cost) { this.error(connection, 'RATE_LIMIT', 'Party message rate limit exceeded.'); this.drop(connection, 1008, 'Party message rate limit exceeded.'); return false; }
    connection.budget -= cost; return true;
  }

  // ——— Views ———

  private view(group: Group, without?: number): PartyView {
    return { id: group.id, kind: group.kind, name: group.name, topic: group.topic, privacy: group.privacy, leaderId: group.leaderId, maxMembers: MAX_PARTY_MEMBERS,
      members: [...group.members.values()].filter(member => member.id !== without).map(member => ({ ...member })) };
  }
  private live(invite: Invite): boolean { return invite.expiresAt > this.now() && this.groups.has(invite.partyId); }
  private invited(userId: number, group: Group): boolean {
    for (const invite of this.invites.values()) if (invite.to === userId && invite.partyId === group.id && this.live(invite)) return true;
    return false;
  }
  private invitesFor(userId: number): PartyInvite[] {
    const list: PartyInvite[] = [];
    for (const invite of this.invites.values()) {
      if (invite.to !== userId || !this.live(invite)) continue;
      const from = this.options.directory.profile(invite.from);
      if (from) list.push({ id: invite.id, partyId: invite.partyId, partyName: this.groups.get(invite.partyId)!.name, from, expiresAt: invite.expiresAt });
    }
    return list.sort((a, b) => a.expiresAt - b.expiresAt || (a.id < b.id ? -1 : 1));
  }
  /** `friends` is the VIEWER's set: friendship is symmetric, so "friend of the leader" needs no second lookup. */
  private mayJoin(userId: number, friends: ReadonlySet<number>, group: Group): boolean {
    if (group.kind === 'channel' || group.privacy === 'open') return true;
    if (this.invited(userId, group)) return true;
    return group.privacy === 'friends' && group.leaderId !== null && friends.has(group.leaderId);
  }
  private sendDirectory(connection: Connection): void {
    const me = connection.profile!.id, friends = new Set(this.options.directory.friendIds(me));
    const order = new Map(CHANNELS.map((channel, index) => [channel.id, index]));
    const groups: PartySummary[] = [];
    for (const group of this.groups.values()) {
      const inside = group.members.has(me), friendInside = [...group.members.keys()].some(id => friends.has(id));
      // Invite-only parties stay off the public list: members, invitees and friends of members only.
      if (group.kind === 'party' && group.privacy === 'invite' && !inside && !friendInside && !this.invited(me, group)) continue;
      groups.push({ id: group.id, kind: group.kind, name: group.name, topic: group.topic, privacy: group.privacy,
        leaderName: group.leaderId === null ? null : group.members.get(group.leaderId)?.name ?? null,
        members: group.members.size, maxMembers: MAX_PARTY_MEMBERS, names: [...group.members.values()].slice(0, 4).map(member => member.name), friendInside,
        joinable: !inside && group.members.size < MAX_PARTY_MEMBERS && this.mayJoin(me, friends, group) });
    }
    groups.sort((a, b) => {
      const ca = order.get(a.id), cb = order.get(b.id);
      if (ca !== undefined || cb !== undefined) return (ca ?? Infinity) - (cb ?? Infinity);
      return Number(b.friendInside) - Number(a.friendInside) || b.members - a.members || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    connection.fresh = true;
    this.send(connection, { type: 'directory', groups });
  }

  // ——— Membership ———

  private removeInvite(invite: Invite): void {
    if (!this.invites.delete(invite.id)) return;
    // An invite can be what lists an invite-only party for its holder.
    this.dirtyInvites.add(invite.to); this.dirtyDirectory = true;
  }
  /** Removes the socket's user from its group; never talks to the leaver. */
  private leaveGroup(connection: Connection): void {
    const group = connection.group, id = connection.profile?.id;
    if (!group || id === undefined) return;
    connection.group = undefined; group.members.delete(id);
    if (group.kind === 'party') {
      if (!group.members.size) {
        this.groups.delete(group.id); this.dirtyGroups.delete(group);
        for (const invite of [...this.invites.values()]) if (invite.partyId === group.id) this.removeInvite(invite);
      } else if (group.leaderId === id) group.leaderId = group.members.keys().next().value!;
    }
    this.touch(group);
  }
  private enter(connection: Connection, group: Group): void {
    const { id, displayName, username, avatar } = connection.profile!;
    group.members.set(id, { id, name: displayName || username, avatar, mic: false, activity: 'menu' });
    connection.group = group;
    for (const invite of [...this.invites.values()]) if (invite.to === id && invite.partyId === group.id) this.removeInvite(invite);
    this.touch(group);
  }
  private auth(connection: Connection, token: string): void {
    if (connection.profile) { this.error(connection, 'ALREADY_AUTHED', 'This connection is already signed in.'); return; }
    let profile: PublicProfile | null = null;
    try { profile = this.options.directory.profile(this.options.directory.authenticate(token)); } catch { profile = null; }
    if (!profile) { this.error(connection, 'AUTH_FAILED', 'Sign in again to use party chat.'); this.drop(connection, 1008, 'Party chat sign-in failed.'); return; }
    const old = this.users.get(profile.id), group = old?.group;
    if (old) {
      // One live socket per account; the newest sign-in wins (the old one may be a half-open TCP).
      // The membership MOVES: seniority and leadership survive, only the socket changes.
      old.group = undefined; this.users.delete(profile.id); this.connections.delete(old.peer);
      old.peer.send({ type: 'party', party: null, reason: REASON_REPLACED }); old.peer.close(1000, REASON_REPLACED);
    }
    connection.profile = profile; this.users.set(profile.id, connection);
    if (group) {
      // The mesh peers must tear down the dead RTCPeerConnection and negotiate with the new
      // browser: they see the member leave now and come back in the deferred publication.
      const gone: PartyServerMessage = { type: 'party', party: this.view(group, profile.id) };
      for (const id of [...group.members.keys()]) { const other = id === profile.id ? undefined : this.users.get(id); if (other?.group === group) this.send(other, gone); }
      const { displayName, username, avatar } = profile;
      group.members.set(profile.id, { id: profile.id, name: displayName || username, avatar, mic: false, activity: 'menu' });
      if (this.groups.get(group.id) === group) { connection.group = group; this.dirtyGroups.add(group); }
    }
    this.send(connection, { type: 'authed', me: profile });
    this.sendDirectory(connection);
    this.send(connection, { type: 'invites', invites: this.invitesFor(profile.id) });
    // A moved membership arrives with the deferred publication, right after these.
    if (!connection.group) this.send(connection, { type: 'party', party: null });
  }
  receive(peer: PartyPeer, raw: string): void {
    const connection = this.connections.get(peer); if (!connection) return;
    this.run(() => this.handle(connection, raw));
  }
  private handle(connection: Connection, raw: string): void {
    const now = this.now();
    let message: PartyClientMessage;
    try { message = parsePartyMessage(raw); }
    catch { this.error(connection, 'BAD_MESSAGE', 'Invalid party protocol, fields, or bounds.'); this.drop(connection, 1008, 'Invalid party message.'); return; }
    if (!this.spend(connection, now, message.type === 'voice-ice' || message.type === 'status' ? 2 : 10)) return;
    if (message.type === 'ping') { this.send(connection, { type: 'pong', nonce: message.nonce }); return; }
    if (message.type === 'auth') { this.auth(connection, message.token); return; }
    const me = connection.profile;
    if (!me) { this.error(connection, 'NOT_AUTHED', 'Sign in to party chat first.'); return; }
    const directory = this.options.directory, group = connection.group;
    switch (message.type) {
      case 'list': this.sendDirectory(connection); return;
      case 'create': {
        // Leaving a party alone in it frees its place, so that one does not count against the cap.
        const frees = group?.kind === 'party' && group.members.size === 1 ? 1 : 0;
        if (this.partyCount - frees >= MAX_PARTIES) { this.error(connection, 'PARTY_LIMIT', 'Too many parties are open right now. Join a channel or try again soon.'); return; }
        let id = '';
        for (let attempt = 0; attempt < 32; attempt++) { id = this.newId(); if (!this.groups.has(id)) break; }
        if (this.groups.has(id)) { this.error(connection, 'PARTY_LIMIT', 'Could not allocate a party id.'); return; }
        this.leaveGroup(connection);
        const party: Group = { id, kind: 'party', name: cleanPartyName(message.name)!, topic: '', privacy: message.privacy, leaderId: me.id, members: new Map() };
        this.groups.set(id, party); this.enter(connection, party); return;
      }
      case 'join': {
        const target = this.groups.get(message.id);
        if (!target) { this.error(connection, 'GROUP_NOT_FOUND', 'That party is gone.'); return; }
        // Re-joining the current group just re-sends it (a client that lost its state).
        if (target === group) { this.dirtyGroups.add(target); return; }
        if (target.members.size >= MAX_PARTY_MEMBERS) { this.error(connection, 'GROUP_FULL', `${target.name} already has ${MAX_PARTY_MEMBERS} members.`); return; }
        if (!this.mayJoin(me.id, new Set(directory.friendIds(me.id)), target)) { this.error(connection, 'NOT_ALLOWED', target.privacy === 'friends' ? 'Only friends of the party leader can join.' : 'This party is invite only.'); return; }
        this.leaveGroup(connection); this.enter(connection, target); return;
      }
      case 'leave': this.leaveGroup(connection); this.send(connection, { type: 'party', party: null }); return;
      case 'update': case 'kick': {
        if (!group) { this.error(connection, 'NOT_MEMBER', 'You are not in a party.'); return; }
        if (group.kind !== 'party' || group.leaderId !== me.id) { this.error(connection, 'LEADER_ONLY', 'Only the party leader can do that.'); return; }
        if (message.type === 'update') {
          const name = message.name === undefined ? group.name : cleanPartyName(message.name)!, privacy = message.privacy ?? group.privacy;
          if (name === group.name && privacy === group.privacy) return;
          // Pending invitations show the party name.
          if (name !== group.name) for (const invite of this.invites.values()) if (invite.partyId === group.id) this.dirtyInvites.add(invite.to);
          group.name = name; group.privacy = privacy; this.touch(group); return;
        }
        const target = message.userId === me.id ? undefined : this.users.get(message.userId);
        if (!target || target.group !== group) { this.error(connection, 'NOT_MEMBER', 'That player is not in your party.'); return; }
        this.leaveGroup(target); this.send(target, { type: 'party', party: null, reason: REASON_KICKED }); return;
      }
      case 'invite': {
        if (group?.kind !== 'party') { this.error(connection, 'NOT_IN_PARTY', 'Create or join a party before inviting friends.'); return; }
        if (!directory.friendIds(me.id).includes(message.userId)) { this.error(connection, 'NOT_FRIEND', 'You can only invite friends.'); return; }
        if (group.members.has(message.userId)) { this.error(connection, 'ALREADY_MEMBER', 'That friend is already in your party.'); return; }
        const pending = [...this.invites.values()].filter(invite => invite.to === message.userId && this.live(invite));
        // One per (party, target): inviting again refreshes it, whoever sent the first one.
        const existing = pending.find(invite => invite.partyId === group.id);
        if (existing) { existing.from = me.id; existing.expiresAt = now + PARTY_INVITE_TTL_MS; }
        else {
          if (pending.length >= MAX_INVITES_PER_TARGET) { this.error(connection, 'INVITE_LIMIT', 'That friend has too many pending invitations.'); return; }
          const id = this.newInviteId();
          this.invites.set(id, { id, partyId: group.id, from: me.id, to: message.userId, expiresAt: now + PARTY_INVITE_TTL_MS });
        }
        this.dirtyInvites.add(message.userId); this.dirtyDirectory = true; return;
      }
      case 'dismiss': {
        const invite = this.invites.get(message.id);
        if (invite?.to === me.id) this.removeInvite(invite); else this.dirtyInvites.add(me.id);
        return;
      }
      case 'status': {
        const member = group?.members.get(me.id);
        if (!group || !member || (member.mic === message.mic && member.activity === message.activity)) return;
        // Flags only: the directory does not show them, so no directory push.
        member.mic = message.mic; member.activity = message.activity; this.dirtyGroups.add(group); return;
      }
      case 'voice-offer': case 'voice-answer': case 'voice-ice': {
        // Group-scoped signaling. `from` is the authenticated account of this socket, never
        // a payload field. A bad target is a normal race with someone leaving: never closes.
        const target = message.target === me.id ? undefined : this.users.get(message.target);
        if (!group || !target || target.group !== group) { this.error(connection, 'VOICE_TARGET', 'Voice target must be another online member of your group.'); return; }
        if (message.type === 'voice-ice') this.send(target, { type: 'voice-ice', from: me.id, candidate: message.candidate,
          ...(message.sdpMid !== undefined ? { sdpMid: message.sdpMid } : {}), ...(message.sdpMLineIndex !== undefined ? { sdpMLineIndex: message.sdpMLineIndex } : {}) });
        else this.send(target, { type: message.type, from: me.id, sdp: message.sdp });
        return;
      }
    }
  }
}

/** Signaling is tiny; a socket this far behind is dead weight. */
const MAX_PARTY_BUFFERED_BYTES = 256 * 1024;
const refuse = (socket: { end(data: string): unknown }, status: string): void => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
/** Owns exactly PARTY_SOCKET_PATH on the shared HTTP server and ignores every other upgrade
 * (server/rooms.ts leaves this path alone in return). `hub: null` = accounts are disabled:
 * the path answers a clean 503 instead of hanging an unanswered upgrade. */
export function attachPartyServer(server: Server, options: { hub: PartyHub | null; authorize: (request: IncomingMessage) => boolean; heartbeatMs?: number }): { close(): void } {
  const hub = options.hub;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_PARTY_PAYLOAD, clientTracking: true });
  const peers = new Map<WebSocket, PartyPeer>();
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== PARTY_SOCKET_PATH) return;
    if (!hub) { refuse(socket, '503 Service Unavailable'); return; }
    if (request.method !== 'GET' || !options.authorize(request)) { refuse(socket, '403 Forbidden'); return; }
    (socket as Socket).setNoDelay(true);
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  if (!hub) return { close: () => wss.close() };
  wss.on('connection', ws => {
    const peer: PartyPeer = {
      send: message => {
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_PARTY_BUFFERED_BYTES) return false;
        ws.send(JSON.stringify(message), { compress: false }, error => { if (error) { hub.disconnect(peer); ws.terminate(); } });
        return ws.bufferedAmount <= MAX_PARTY_BUFFERED_BYTES;
      },
      // No terminate() here: the closing handshake lets the last error / reason frame reach the browser.
      close: (code, reason) => { if (ws.readyState === WebSocket.OPEN) ws.close(code, reason); else ws.terminate(); },
    };
    peers.set(ws, peer); hub.connect(peer);
    ws.on('pong', () => hub.heartbeat(peer));
    ws.on('message', (data, binary) => {
      // The contract is JSON text only; the hub answers BAD_MESSAGE and closes.
      hub.receive(peer, binary ? '' : data.toString());
    });
    ws.on('error', () => { hub.disconnect(peer); ws.terminate(); });
    ws.on('close', () => { hub.disconnect(peer); peers.delete(ws); });
  });
  const timer = setInterval(() => {
    hub.tick();
    for (const [ws, peer] of peers) if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > MAX_PARTY_BUFFERED_BYTES) { hub.disconnect(peer); ws.terminate(); } else ws.ping();
    }
  }, options.heartbeatMs ?? 5000);
  timer.unref();
  let closed = false;
  const close = () => { if (closed) return; closed = true; clearInterval(timer); hub.shutdown(); for (const ws of peers.keys()) ws.terminate(); wss.close(); };
  server.once('close', close);
  return { close };
}
