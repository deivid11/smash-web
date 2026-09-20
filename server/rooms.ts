import { randomBytes, randomInt } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from '../lib/game/limits.ts';
import {
  DEFAULT_ROOM_RULES, MAX_BUFFERED_BYTES, MAX_ROOM_PAYLOAD, RECONNECT_GRACE_MS, RESUME_CATCH_UP_MS, ROOM_PROTOCOL, ROOM_SOCKET_PATH,
  parseClientMessage, sameFingerprint, fingerprintMismatchMessage, fighterInstalled,
  type ClientMessage, type Fingerprint, type MatchEnd, type MatchStart, type NetInput,
  type RoomPlayer, type RoomRules, type RoomSummary, type RoomView, type ServerMessage,
} from '../lib/net/protocol.ts';
import { PARTY_SOCKET_PATH } from '../lib/net/party-protocol.ts';
import { decodeInputMessage, decodeInputPayload, encodeBacklog, encodeInputPayload, encodeRelayMessage, matchTag, type InputMeta } from '../lib/net/input-codec.ts';

/** Intentionally LAN-only. Tokens bind membership to one socket at a time. While a match
 * runs, the same token also reclaims that held seat (`resume`) after a dropped connection
 * or a browser restart; they are still not accounts, encryption, or Internet authentication. */
export interface RoomPeer {
  send(message: ServerMessage): boolean;
  /** Binary input frames (lib/net/input-codec.ts). `bulk` is a one-off reconnect backlog
   * that may exceed the per-frame congestion budget. Peers without it receive JSON. */
  sendBinary?(data: Uint8Array, bulk?: boolean): boolean;
  close(code: number, reason: string): void;
}
interface CpuSeat extends RoomPlayer { control: 'cpu'; ready: true; level: number }
interface Member extends RoomPlayer {
  control: 'human'; token: string; fingerprint: Fingerprint; lastFrame: number; lastHash: number; inputAt: number;
  /** null while the seat is held for a reconnect. */
  peer: RoomPeer | null; binary: boolean;
  /** Canonical input payload per frame of the running match: what a resumed browser replays. */
  log: Uint8Array[];
  droppedAt?: number; awayAt?: number; resumedAt?: number;
}
interface RunningMatch { id: string; tag: number; startAt: number; start: MatchStart; hashes: Map<number, Map<number, string>>; finishes: Map<number, { frame: number; hash: string }>;
  /** Wall time the match has spent waiting for held seats; excluded from its bounded duration. */
  heldAt?: number; heldMs: number }
/** Transport losses hold the seat; protocol violations and explicit leaves never do. */
const HELD_CODES: readonly string[] = ['PEER_DISCONNECTED', 'TIMEOUT', 'CONGESTION'];
/** Watchers cost relay fan-out per input frame, so they are bounded per room. */
const MAX_SPECTATORS = 16;
/** Read-only watcher: no seat, no token, no quorum. `binary` mirrors Member.binary. */
interface Spectator { peer: RoomPeer; binary: boolean }
interface Room { code: string; hostSlot: number; phase: RoomView['phase']; members: Map<number, Member>; cpus: Map<number, CpuSeat>; rules: RoomRules; fingerprint: Fingerprint; match?: RunningMatch; justClosedMatchId?: string;
  /** Keyed by peer so a closed socket is removed without a scan. Never part of `members`. */
  spectators: Map<RoomPeer, Spectator> }
interface Connection { room?: Room; member?: Member;
  /** Set instead of room/member for a read-only watcher. */
  spectating?: Room; connectedAt: number; activeAt: number; budgetAt: number; budget: number }
export interface RoomHubOptions {
  now?: () => number; token?: () => string; code?: () => string; seed?: () => number;
  maxRooms?: number; maxClients?: number; startDelayMs?: number; idleTimeoutMs?: number; inputTimeoutMs?: number;
  /** 0 restores the old behaviour: any drop or hidden tab closes the shared match at once. */
  reconnectGraceMs?: number; catchUpMs?: number;
}
export class RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Map<RoomPeer, Connection>();
  private readonly now: () => number;
  private readonly token: () => string;
  private readonly newCode: () => string;
  constructor(private readonly options: RoomHubOptions = {}) {
    this.now = options.now ?? Date.now;
    this.token = options.token ?? (() => randomBytes(24).toString('hex'));
    this.newCode = options.code ?? (() => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''));
  }
  get roomCount(): number { return this.rooms.size; }
  get clientCount(): number { return this.connections.size; }
  /** Public lobby directory for the room browser. Only lobby-phase rooms are
   * listed; membership tokens, slot ownership and match state stay private.
   * Sorted by code for a stable browser order. */
  listRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter(room => room.phase === 'lobby')
      .map(room => ({
        code: room.code,
        phase: room.phase,
        players: room.members.size + room.cpus.size,
        humans: room.members.size,
        maxPlayers: MAX_MATCH_PLAYERS,
        hostName: room.members.get(room.hostSlot)?.name ?? '',
        rules: { ...room.rules },
        fingerprint: { ...room.fingerprint },
      }))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }
  connect(peer: RoomPeer): boolean {
    if (this.connections.size >= (this.options.maxClients ?? 64)) { peer.close(1013, 'Relay is full.'); return false; }
    const now = this.now();
    this.connections.set(peer, { connectedAt: now, activeAt: now, budgetAt: now, budget: 240 });
    this.send(peer, { type: 'hello', protocol: ROOM_PROTOCOL, serverNow: now }); return this.connections.has(peer);
  }
  private send(peer: RoomPeer, message: ServerMessage): void {
    if (this.connections.has(peer) && !peer.send(message)) this.drop(peer, 'CONGESTION', 'Connection congested; match cannot continue.', 1013);
  }
  private error(peer: RoomPeer, code: string, message: string): void { this.send(peer, { type: 'error', code, message }); }
  private view(room: Room): RoomView {
    const held = [...room.members.values()].filter(member => this.held(member));
    return { code: room.code, hostSlot: room.hostSlot, phase: room.phase, rules: { ...room.rules }, fingerprint: { ...room.fingerprint }, players: [...room.members.values(), ...room.cpus.values()].sort((a, b) => a.slot - b.slot).map(player => { const { slot, name, fighter, ready, control, level, costume } = player; return { slot, name, fighter, ready, control, ...(control === 'cpu' ? { level } : {}), ...(costume ? { costume } : {}), ...(control === 'human' && this.held(player as Member) ? { connected: false } : {}) }; }),
      ...(held.length ? { graceEndsAt: Math.min(...held.map(member => (member.droppedAt ?? member.awayAt)! + this.grace)) } : {}), ...(room.spectators.size ? { spectators: room.spectators.size } : {}) };
  }
  private get grace(): number { return this.options.reconnectGraceMs ?? RECONNECT_GRACE_MS; }
  private held(member: Member): boolean { return member.droppedAt !== undefined || member.awayAt !== undefined; }
  private broadcast(room: Room, message: ServerMessage): void {
    const phase = room.phase, matchId = room.match?.id, size = room.members.size;
    for (const member of [...room.members.values()]) {
      // send() can synchronously remove a congested peer and publish an end.
      // Never deliver an obsolete start/playing snapshot after that nested end.
      if (room.phase !== phase || room.match?.id !== matchId || room.members.size !== size) break;
      if (member.peer) this.send(member.peer, message);
    }
    // Same staleness rule as above: a nested end already reached the watchers.
    if (room.phase === phase && room.match?.id === matchId && room.members.size === size) this.watch(room, message);
  }
  /** Spectators get the same room/start/end stream after the members. A congested one is simply
   * dropped (dropSpectator never touches the match), so no re-entrancy guard is needed here. */
  private watch(room: Room, message: ServerMessage): void {
    if (!room.spectators.size) return;
    const copy: ServerMessage = message.type === 'start' ? { ...message, spectator: true } : message;
    for (const spectator of [...room.spectators.values()]) if (!spectator.peer.send(copy)) this.dropSpectator(room, spectator.peer, 'Connection congested.', 1013);
  }
  private dropSpectator(room: Room, peer: RoomPeer, reason?: string, closeCode = 1008): void {
    const connection = this.connections.get(peer);
    if (!room.spectators.delete(peer)) return;
    if (connection) connection.spectating = undefined;
    if (reason !== undefined) { this.connections.delete(peer); peer.close(closeCode, reason); }
    if (this.rooms.get(room.code) === room && room.members.size) this.publish(room);
  }
  /** The last member left: tell the watchers why the picture stopped, then release them. */
  private dissolve(room: Room, end?: MatchEnd): void {
    this.rooms.delete(room.code);
    for (const spectator of [...room.spectators.values()]) {
      room.spectators.delete(spectator.peer);
      const connection = this.connections.get(spectator.peer); if (!connection) continue;
      // Back to an unattached connection: the 60 s roomless idle rule restarts from here.
      connection.spectating = undefined; connection.connectedAt = this.now();
      if (end) this.send(spectator.peer, end);
      this.send(spectator.peer, { type: 'left' });
    }
  }
  private publish(room: Room): void { this.broadcast(room, { type: 'room', room: this.view(room) }); }
  private unready(room: Room): void { for (const member of room.members.values()) member.ready = false; }
  private end(room: Room, code: string, message: string, details: Partial<Pick<MatchEnd, 'slot' | 'frame' | 'hashes'>> = {}): void {
    if (room.phase !== 'playing' || !room.match) return;
    const matchId = room.match.id;
    room.justClosedMatchId = matchId;
    room.phase = 'ended'; room.match = undefined; this.unready(room);
    // Held seats existed only for this match: nobody can resume a closed one.
    for (const member of [...room.members.values()]) {
      member.log = []; member.awayAt = undefined; member.resumedAt = undefined;
      if (!member.peer) room.members.delete(member.slot);
    }
    if (!room.members.size) { this.dissolve(room, { type: 'end', matchId, code, message, ...details }); return; }
    if (!room.members.has(room.hostSlot)) room.hostSlot = Math.min(...room.members.keys());
    this.broadcast(room, { type: 'end', matchId, code, message, ...details }); this.publish(room);
  }
  disconnect(peer: RoomPeer, code = 'PEER_DISCONNECTED', message = 'A player disconnected. The shared match is closed.'): void {
    const connection = this.connections.get(peer);
    if (!connection) return;
    this.connections.delete(peer);
    // A watcher is never held and never ends anything: it just stops receiving.
    if (connection.spectating) { this.dropSpectator(connection.spectating, peer); return; }
    const { room, member } = connection;
    if (room && member && room.phase === 'playing' && room.match && this.grace > 0 && HELD_CODES.includes(code)) {
      // Hold the seat: the others stall at their prediction cap until this human resumes.
      connection.room = undefined; connection.member = undefined;
      member.peer = null; member.droppedAt = this.now(); member.awayAt = undefined; member.resumedAt = undefined;
      room.match.heldAt ??= member.droppedAt;
      this.publish(room); return;
    }
    this.removeMember(connection, code, message);
  }
  private drop(peer: RoomPeer, code: string, message: string, closeCode = 1008): void {
    this.disconnect(peer, code, message); peer.close(closeCode, message);
  }
  private removeMember(connection: Connection, code: string, message: string): void {
    const { room, member } = connection;
    if (!room || !member) return;
    room.members.delete(member.slot); connection.room = undefined; connection.member = undefined;
    this.end(room, code, message, { slot: member.slot });
    if (!room.members.size) { if (this.rooms.get(room.code) === room) this.dissolve(room); return; }
    if (!room.members.has(room.hostSlot)) room.hostSlot = Math.min(...room.members.keys());
    this.unready(room); this.publish(room);
  }
  /** Called by transport pong, not arbitrary traffic from another connection. */
  heartbeat(peer: RoomPeer): void { const connection = this.connections.get(peer); if (connection) connection.activeAt = this.now(); }
  tick(): void {
    const now = this.now();
    for (const [peer, connection] of [...this.connections]) {
      if (now - connection.activeAt > (this.options.idleTimeoutMs ?? 30_000) || (!connection.room && !connection.spectating && now - connection.connectedAt > 60_000)) {
        this.drop(peer, 'TIMEOUT', 'A player timed out. The shared match is closed.');
      }
    }
    for (const room of this.rooms.values()) {
      if (room.phase !== 'playing' || !room.match) continue;
      const members = [...room.members.values()];
      const expired = members.find(member => this.held(member) && now - (member.droppedAt ?? member.awayAt)! > this.grace);
      if (expired) { this.end(room, expired.droppedAt !== undefined ? 'PEER_DISCONNECTED' : 'PEER_BACKGROUND', `${expired.name} did not come back in time. The shared match is closed.`, { slot: expired.slot, frame: expired.lastFrame }); continue; }
      const slow = members.find(member => member.resumedAt !== undefined && now - member.resumedAt > (this.options.catchUpMs ?? RESUME_CATCH_UP_MS));
      if (slow) { this.end(room, 'RESUME_TIMEOUT', `${slow.name} could not catch up with the match. The shared match is closed.`, { slot: slow.slot, frame: slow.lastFrame }); continue; }
      // Nobody can send frames while a seat is held or replaying, so that wait is not an input stall
      // and does not count against the match's bounded duration.
      if (members.some(member => this.held(member) || member.resumedAt !== undefined)) { room.match.heldAt ??= now; continue; }
      if (room.match.heldAt !== undefined) { room.match.heldMs += now - room.match.heldAt; room.match.heldAt = undefined; for (const member of members) member.inputAt = now; continue; }
      const stalled = [...room.members.values()].find(member => now - Math.max(member.inputAt, room.match!.startAt) > (this.options.inputTimeoutMs ?? 10_000));
      if (stalled) this.end(room, 'INPUT_TIMEOUT', 'A player stopped sending frames. The shared match is closed; no unilateral pause.', { slot: stalled.slot, frame: stalled.lastFrame });
      else if (now - room.match.startAt - room.match.heldMs > (room.rules.timeSeconds + 30) * 1000) this.end(room, 'MATCH_TIMEOUT', 'The shared match exceeded its bounded duration.');
    }
  }
  shutdown(): void { for (const peer of [...this.connections.keys()]) this.drop(peer, 'SERVER_CLOSED', 'LAN relay shut down.', 1001); }
  private spend(peer: RoomPeer, connection: Connection, now: number, cost: number): boolean {
    connection.budget = Math.min(240, connection.budget + Math.max(0, now - connection.budgetAt) * 0.12); connection.budgetAt = now;
    if (connection.budget < cost) { this.drop(peer, 'RATE_LIMIT', 'Room message rate limit exceeded.'); return false; }
    connection.budget -= cost; return true;
  }
  /** Binary input frame (lib/net/input-codec.ts). The socket owns the seat, so no token travels per frame. */
  receiveBinary(peer: RoomPeer, bytes: Uint8Array): void {
    const connection = this.connections.get(peer); if (!connection) return;
    const now = this.now(), decoded = bytes.length <= MAX_ROOM_PAYLOAD ? decodeInputMessage(bytes) : null;
    if (!this.spend(peer, connection, now, 1)) return;
    if (connection.spectating) { this.error(peer, 'NOT_OWNER', 'Spectators cannot send input.'); return; }
    const { room, member } = connection;
    if (!decoded || !room || !member) { this.error(peer, 'BAD_MESSAGE', 'Invalid binary input frame.'); this.drop(peer, 'BAD_MESSAGE', 'Invalid room message.'); return; }
    if (room.justClosedMatchId !== undefined && decoded.tag === matchTag(room.justClosedMatchId)) return;
    if (room.phase !== 'playing' || !room.match || room.match.tag !== decoded.tag) { this.error(peer, 'STALE_MATCH', 'Frame belongs to a closed or different match.'); return; }
    this.acceptInput(peer, room, member, now, decoded.frame, decoded.payload, undefined, decoded.meta);
  }
  /** Ordered, bounded, logged and relayed. JSON senders keep their echo; binary senders already
   * own their frame and only the other humans receive it. */
  private acceptInput(peer: RoomPeer, room: Room, member: Member, now: number, frame: number, payload: Uint8Array, json: NetInput | undefined, meta?: InputMeta): void {
    const match = room.match!;
    const maxElapsedFrame = Math.max(0, Math.floor((now - match.startAt) * 0.06)) + 120;
    const minFrame = Math.min(...[...room.members.values()].map(player => player.lastFrame));
    if (frame !== member.lastFrame + 1 || frame > maxElapsedFrame || frame > minFrame + 120) {
      this.error(peer, 'FRAME_ORDER', `Slot ${member.slot} expected frame ${member.lastFrame + 1}; received ${frame}, maximum ${Math.min(maxElapsedFrame, minFrame + 120)}.`);
      this.drop(peer, 'FRAME_ORDER', 'Invalid input frame order or lead.'); return;
    }
    member.lastFrame = frame; member.inputAt = now; member.log[frame] = payload;
    // The first frame after a return lifts this seat's hold.
    const returned = member.awayAt !== undefined || member.resumedAt !== undefined;
    member.awayAt = undefined; member.resumedAt = undefined;
    let binary: Uint8Array | undefined, text: ServerMessage | undefined;
    const phase = room.phase, size = room.members.size;
    for (const target of [...room.members.values()]) {
      if (room.phase !== phase || room.match !== match || room.members.size !== size) break;
      if (!target.peer || (target === member && !json)) continue;
      if (target.binary && target.peer.sendBinary) {
        binary ??= encodeRelayMessage(match.tag, member.slot, frame, payload, meta);
        if (this.connections.has(target.peer) && !target.peer.sendBinary(binary)) this.drop(target.peer, 'CONGESTION', 'Connection congested; match cannot continue.', 1013);
      } else {
        text ??= { type: 'input', matchId: match.id, slot: member.slot, frame, input: json ?? decodeInputPayload(payload) };
        this.send(target.peer, text);
      }
    }
    // Watchers simulate every human, the sender included. Losing one never touches the match.
    if (room.match === match) for (const spectator of [...room.spectators.values()]) {
      let sent: boolean;
      if (spectator.binary && spectator.peer.sendBinary) sent = spectator.peer.sendBinary(binary ??= encodeRelayMessage(match.tag, member.slot, frame, payload, meta));
      else sent = spectator.peer.send(text ??= { type: 'input', matchId: match.id, slot: member.slot, frame, input: json ?? decodeInputPayload(payload) });
      if (!sent) this.dropSpectator(room, spectator.peer, 'Connection congested.', 1013);
    }
    if (returned && room.match === match) this.publish(room);
  }
  /** One source's logged frames from `from` on: run-length binary chunks or plain JSON. false = congested. */
  private backlog(peer: RoomPeer, binary: boolean, match: RunningMatch, source: Member, from: number): boolean {
    const payloads = source.log.slice(from);
    if (!payloads.length) return true;
    if (binary && peer.sendBinary) { for (const chunk of encodeBacklog(match.tag, source.slot, from, payloads)) if (!peer.sendBinary(chunk, true)) return false; return true; }
    return payloads.every((payload, index) => peer.send({ type: 'input', matchId: match.id, slot: source.slot, frame: from + index, input: decodeInputPayload(payload) }));
  }
  private spectate(peer: RoomPeer, connection: Connection, message: Extract<ClientMessage, { type: 'spectate' }>, now: number): void {
    if (connection.room || connection.spectating) { this.error(peer, 'ALREADY_JOINED', 'Leave the current room first.'); return; }
    const room = this.rooms.get(message.code);
    if (!room) { this.error(peer, 'ROOM_NOT_FOUND', 'Room code not found.'); return; }
    // A watcher runs the same deterministic simulation from the same inputs, so it needs the same build.
    if (!sameFingerprint(room.fingerprint, message.fingerprint)) {
      this.error(peer, 'FINGERPRINT_MISMATCH', fingerprintMismatchMessage(room.fingerprint, message.fingerprint)); return;
    }
    if (room.spectators.size >= MAX_SPECTATORS) { this.error(peer, 'SPECTATORS_FULL', `This room already has ${MAX_SPECTATORS} spectators.`); return; }
    const binary = !!message.binary, match = room.match;
    room.spectators.set(peer, { peer, binary }); connection.spectating = room;
    this.send(peer, { type: 'spectating', room: this.view(room) });
    if (room.phase === 'playing' && match) {
      // Mid-match: the shared start, every human's log from frame 0, then `synced`; live frames follow.
      this.send(peer, { ...match.start, serverNow: now, spectator: true });
      for (const source of room.members.values()) {
        if (!room.spectators.has(peer)) return;
        if (!this.backlog(peer, binary, match, source, 0)) { this.dropSpectator(room, peer, 'Connection congested while catching up.', 1013); return; }
      }
      this.send(peer, { type: 'synced', matchId: match.id });
    }
    if (room.spectators.has(peer)) this.publish(room);
  }
  private resume(peer: RoomPeer, connection: Connection, message: Extract<ClientMessage, { type: 'resume' }>, now: number): void {
    if (connection.room || connection.spectating) { this.error(peer, 'ALREADY_JOINED', 'Leave the current room first.'); return; }
    const room = this.rooms.get(message.code), member = room && [...room.members.values()].find(player => player.token === message.token), match = room?.match;
    if (!room || !member || !match || room.phase !== 'playing') { this.error(peer, 'RESUME_FAILED', 'That match is no longer running; join the room again from the lobby.'); return; }
    if (!sameFingerprint(room.fingerprint, message.fingerprint)) { this.error(peer, 'RESUME_FAILED', 'This browser now runs a different game build than the match it left.'); return; }
    if (member.peer && member.peer !== peer) {
      // The old socket may still look alive to the relay (half-open TCP): the token holder wins.
      const stale = member.peer, old = this.connections.get(stale);
      if (old) { old.room = undefined; old.member = undefined; this.connections.delete(stale); }
      stale.close(1000, 'Replaced by a resumed connection.');
    }
    member.peer = peer; member.binary = !!message.binary; member.droppedAt = undefined; member.awayAt = undefined; member.resumedAt = now;
    connection.room = room; connection.member = member;
    this.send(peer, { type: 'joined', token: member.token, slot: member.slot, room: this.view(room) });
    this.send(peer, { ...match.start, serverNow: now, resume: { lastFrame: member.lastFrame, lastHash: member.lastHash, finished: match.finishes.has(member.slot) } });
    for (const source of room.members.values()) {
      if (member.peer !== peer || !this.connections.has(peer)) return;
      if (!this.backlog(peer, member.binary, match, source, message.from)) { this.drop(peer, 'CONGESTION', 'Connection congested during resume.', 1013); return; }
    }
    this.send(peer, { type: 'synced', matchId: match.id });
    if (room.match === match) this.publish(room);
  }
  receive(peer: RoomPeer, raw: string): void {
    const connection = this.connections.get(peer); if (!connection) return;
    const now = this.now();
    let message: ClientMessage;
    try { message = parseClientMessage(raw); }
    catch { this.error(peer, 'BAD_MESSAGE', 'Invalid room protocol, fields, or bounds.'); this.drop(peer, 'BAD_MESSAGE', 'Invalid room message.'); return; }
    if (!this.spend(peer, connection, now, message.type === 'input' ? 1 : message.type === 'voice-ice' ? 4 : 12)) return;
    if (message.type === 'resume') { this.resume(peer, connection, message, now); return; }
    if (message.type === 'spectate') { this.spectate(peer, connection, message, now); return; }
    if (message.type === 'unspectate') {
      if (!connection.spectating) { this.error(peer, 'NOT_SPECTATING', 'This connection is not spectating a room.'); return; }
      // Unattached again: restart the roomless idle window instead of timing out at once.
      this.dropSpectator(connection.spectating, peer); connection.connectedAt = now; this.send(peer, { type: 'left' }); return;
    }
    if (message.type === 'ping') { this.send(peer, { type: 'pong', nonce: message.nonce, serverNow: now }); return; }
    if (message.type === 'create' || message.type === 'join') {
      if (connection.room || connection.spectating) { this.error(peer, 'ALREADY_JOINED', 'Leave the current room first.'); return; }
      let room: Room;
      if (message.type === 'create') {
        if (this.rooms.size >= (this.options.maxRooms ?? 32)) { this.error(peer, 'ROOM_LIMIT', 'LAN room limit reached.'); return; }
        let code = '';
        for (let attempt = 0; attempt < 32; attempt++) { code = this.newCode(); if (!this.rooms.has(code)) break; }
        if (this.rooms.has(code)) { this.error(peer, 'ROOM_LIMIT', 'Could not allocate a room code.'); return; }
        room = { code, hostSlot: 0, phase: 'lobby', members: new Map(), cpus: new Map(), rules: { ...(message.rules ?? DEFAULT_ROOM_RULES) }, fingerprint: { ...message.fingerprint }, spectators: new Map() };
        this.rooms.set(code, room);
      } else {
        const found = this.rooms.get(message.code);
        if (!found) { this.error(peer, 'ROOM_NOT_FOUND', 'Room code not found.'); return; }
        room = found;
        if (room.phase !== 'lobby') { this.error(peer, 'ROOM_BUSY', 'This room is not in the lobby.'); return; }
        if (room.members.size + room.cpus.size >= MAX_MATCH_PLAYERS) { this.error(peer, 'ROOM_FULL', `This room already has ${MAX_MATCH_PLAYERS} players.`); return; }
        if (!sameFingerprint(room.fingerprint, message.fingerprint)) {
          this.error(peer, 'FINGERPRINT_MISMATCH', fingerprintMismatchMessage(room.fingerprint, message.fingerprint)); return;
        }
      }
      const slot = Array.from({ length: MAX_MATCH_PLAYERS }, (_, index) => index).find(value => !room.members.has(value) && !room.cpus.has(value))!;
      const member: Member = { peer, binary: !!message.binary, log: [], slot, control: 'human', token: this.token(), name: message.name.trim(), fighter: slot % 2 === 0 ? 'Fx' : 'Mr', costume: 0, ready: false, fingerprint: { ...message.fingerprint }, lastFrame: -1, lastHash: -1, inputAt: now };
      connection.room = room; connection.member = member; room.members.set(slot, member); this.unready(room);
      this.send(peer, { type: 'joined', token: member.token, slot, room: this.view(room) }); this.publish(room); return;
    }
    // Everything below is token-owned. A watcher owns nothing; refusing must not disturb the match it watches.
    if (connection.spectating) { this.error(peer, 'NOT_OWNER', 'Spectators cannot change the room or the match.'); return; }
    const { room, member } = connection;
    if (!room || !member || message.token !== member.token) { this.error(peer, 'NOT_OWNER', 'Membership token does not own this socket.'); this.drop(peer, 'NOT_OWNER', 'Invalid membership ownership.'); return; }
    if (message.type === 'leave') {
      this.end(room, 'PEER_LEFT', 'A player left. The shared match is closed.', { slot: member.slot });
      this.removeMember(connection, 'PEER_LEFT', 'A player left. The shared match is closed.'); this.send(peer, { type: 'left' }); return;
    }
    if (message.type === 'background') {
      if (room.phase === 'playing' && room.match && this.grace > 0) {
        // A hidden tab stops simulating. Hold the seat like a dropped socket; its next frame lifts the hold.
        if (member.awayAt === undefined) { member.awayAt = now; room.match.heldAt ??= now; this.publish(room); }
        return;
      }
      member.ready = false;
      this.end(room, 'PEER_BACKGROUND', 'A player backgrounded the browser. The shared match is closed; no unilateral pause.', { slot: member.slot }); this.publish(room); return;
    }
    if (message.type === 'lobby') {
      this.end(room, 'RETURNED_TO_LOBBY', 'A player ended the shared match and requested the lobby.', { slot: member.slot });
      room.phase = 'lobby'; room.match = undefined; this.unready(room); this.publish(room); return;
    }
    if (message.type === 'voice-offer' || message.type === 'voice-answer' || message.type === 'voice-ice') {
      // Room-scoped P2P voice signaling only. Never closes the shared match,
      // never changes readiness, works in lobby/playing/ended while the room lives.
      // The sender slot is server-assigned; targets cannot be spoofed via payload.
      const target = room.members.get(message.target);
      if (message.target === member.slot || !target?.peer) { this.error(peer, 'VOICE_TARGET', 'Voice target must be a different connected human in this room.'); return; }
      if (message.type === 'voice-ice') {
        this.send(target.peer, {
          type: 'voice-ice', from: member.slot, candidate: message.candidate,
          ...(message.sdpMid !== undefined ? { sdpMid: message.sdpMid } : {}),
          ...(message.sdpMLineIndex !== undefined ? { sdpMLineIndex: message.sdpMLineIndex } : {}),
        });
      } else {
        this.send(target.peer, { type: message.type, from: member.slot, sdp: message.sdp });
      }
      return;
    }
    if (message.type === 'input' || message.type === 'hash' || message.type === 'finish') {
      // Frames already in flight when another peer closes the match are normal.
      // Keep only one tombstone; schema, rate and socket ownership checks above
      // still apply. Never relay these frames or mutate the rematch's counters.
      if (message.matchId === room.justClosedMatchId) return;
      if (room.phase !== 'playing' || !room.match || room.match.id !== message.matchId) { this.error(peer, 'STALE_MATCH', 'Frame belongs to a closed or different match.'); return; }
      if (message.type === 'finish') {
        const confirmedInput = Math.min(...[...room.members.values()].map(player => player.lastFrame));
        if (message.frame > confirmedInput || confirmedInput - message.frame > 120 || room.match.finishes.has(member.slot)) {
          this.error(peer, 'FINISH_FRAME', 'Completion requires one retained fully received frame per member.'); return;
        }
        room.match.finishes.set(member.slot, { frame: message.frame, hash: message.hash });
        const finishes = [...room.match.finishes.values()];
        if (finishes.some(finish => finish.frame !== message.frame || finish.hash !== message.hash)) {
          this.end(room, 'DESYNC', `Players disagree about the completed match state at frame ${message.frame}.`, { frame: message.frame, hashes: Object.fromEntries([...room.match.finishes].map(([slot, finish]) => [slot, `${finish.frame}:${finish.hash}`])) }); return;
        }
        if (finishes.length === room.members.size) this.end(room, 'MATCH_COMPLETE', 'All players confirmed the same completed match state.', { frame: message.frame });
        return;
      }
      if (message.type === 'input') this.acceptInput(peer, room, member, now, message.frame, encodeInputPayload(message.input), message.input);
      else {
        const confirmedInput = Math.min(...[...room.members.values()].map(player => player.lastFrame));
        if (message.frame <= member.lastHash || message.frame > confirmedInput || confirmedInput - message.frame > 120 || room.match.hashes.size >= 120 && !room.match.hashes.has(message.frame)) {
          this.error(peer, 'HASH_FRAME', 'Hash must advance within the retained, fully received input history.'); this.drop(peer, 'HASH_FRAME', 'Invalid canonical hash frame.'); return;
        }
        member.lastHash = message.frame;
        const hashes = room.match.hashes.get(message.frame) ?? new Map<number, string>(); hashes.set(member.slot, message.hash); room.match.hashes.set(message.frame, hashes);
        if (new Set(hashes.values()).size > 1) {
          this.end(room, 'DESYNC', `Canonical state mismatch after frame ${message.frame}; slots ${[...hashes.keys()].join(', ')} disagree. Match closed.`, { frame: message.frame, hashes: Object.fromEntries(hashes) }); return;
        }
        if (hashes.size === room.members.size) {
          this.broadcast(room, { type: 'hash', matchId: room.match.id, frame: message.frame, hash: message.hash }); room.match?.hashes.delete(message.frame);
        }
        if (room.match) for (const frame of room.match.hashes.keys()) if (confirmedInput - frame > 120) {
          this.end(room, 'HASH_TIMEOUT', `Missing peer canonical hash after frame ${frame}.`, { frame }); break;
        }
      }
      return;
    }
    if (room.phase !== 'lobby') { this.error(peer, 'NOT_LOBBY', 'Return all players to the lobby before changing selections or starting.'); return; }
    if ((message.type === 'choose' || message.type === 'cpu') && message.fighter !== null && !fighterInstalled(message.fighter, room.fingerprint)) { this.error(peer, 'PACK_NOT_INSTALLED', 'This character pack is not installed by every player in this room.'); return; }
    if (message.type === 'cpu') {
      if (room.hostSlot !== member.slot) { this.error(peer, 'HOST_ONLY', 'Only the host may configure CPU seats.'); return; }
      if (room.members.has(message.slot)) { this.error(peer, 'SEAT_OCCUPIED', 'This seat belongs to a connected human. CPU commands cannot replace or remove humans.'); return; }
      if (message.fighter === null) room.cpus.delete(message.slot);
      else room.cpus.set(message.slot, { slot: message.slot, name: `CPU ${message.slot + 1}`, fighter: message.fighter, control: 'cpu', ready: true, level: message.level ?? room.cpus.get(message.slot)?.level ?? 5, costume: message.costume ?? room.cpus.get(message.slot)?.costume ?? 0 });
      this.unready(room); this.publish(room);
    } else if (message.type === 'choose') { member.fighter = message.fighter; member.costume = message.costume ?? 0; this.unready(room); this.publish(room); }
    else if (message.type === 'rules') {
      if (room.hostSlot !== member.slot) { this.error(peer, 'HOST_ONLY', 'Only the host may change rules.'); return; }
      room.rules = { ...message.rules }; this.unready(room); this.publish(room);
    } else if (message.type === 'ready') { member.ready = message.assetsLoaded; this.publish(room); }
    else if (message.type === 'start') {
      if (room.hostSlot !== member.slot) { this.error(peer, 'HOST_ONLY', 'Only the host may start.'); return; }
      const total = room.members.size + room.cpus.size;
      if (room.members.size < 1 || total < MIN_MATCH_PLAYERS || total > MAX_MATCH_PLAYERS || ![...room.members.values()].every(player => player.ready && sameFingerprint(player.fingerprint, room.fingerprint))) { this.error(peer, 'NOT_READY', `${MIN_MATCH_PLAYERS} to ${MAX_MATCH_PLAYERS} fighters and at least one human are required; every human must have identical fingerprints and all gameplay assets loaded.`); return; }
      const startAt = now + (this.options.startDelayMs ?? 1500);
      const matchId = this.token();
      for (const player of room.members.values()) { player.lastFrame = -1; player.lastHash = -1; player.inputAt = startAt; player.log = []; player.droppedAt = undefined; player.awayAt = undefined; player.resumedAt = undefined; }
      const start: MatchStart = { type: 'start', matchId, seed: (this.options.seed ?? (() => randomInt(0x100000000)))() >>> 0, startAt, serverNow: now, players: this.view(room).players, rules: { ...room.rules }, fingerprint: { ...room.fingerprint } };
      room.match = { id: matchId, tag: matchTag(matchId), startAt, start, hashes: new Map(), finishes: new Map(), heldMs: 0 }; room.phase = 'playing';
      this.publish(room);
      // A congested peer may have ended the match during publication.
      if (room.phase === 'playing') this.broadcast(room, start);
    }
  }
}

/** A resumed browser may receive a whole match log at once (run-length encoded, normally a few KiB). */
const MAX_BULK_BUFFERED_BYTES = 8 * 1024 * 1024;
export interface RoomServerOptions extends RoomHubOptions { authorize: (request: IncomingMessage) => boolean; heartbeatMs?: number }
/** Attaches only one curated upgrade route to the existing asset HTTP server. */
export function attachRoomServer(server: Server, options: RoomServerOptions): { hub: RoomHub; close: () => void } {
  const hub = new RoomHub(options);
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_ROOM_PAYLOAD, clientTracking: true });
  const peers = new Map<WebSocket, RoomPeer>();
  server.on('upgrade', (request, socket, head) => {
    // Party chat owns its own upgrade listener (server/party-hub.ts); answering here would race it.
    if (request.url === PARTY_SOCKET_PATH) return;
    if (request.url !== ROOM_SOCKET_PATH || request.method !== 'GET' || !options.authorize(request) || hub.clientCount >= (options.maxClients ?? 64)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    (socket as Socket).setNoDelay(true);
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  wss.on('connection', ws => {
    const peer: RoomPeer = {
      send: message => {
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) return false;
        ws.send(JSON.stringify(message), { compress: false }, error => { if (error) { hub.disconnect(peer); ws.terminate(); } });
        return ws.bufferedAmount <= MAX_BUFFERED_BYTES;
      },
      sendBinary: (data, bulk = false) => {
        const limit = bulk ? MAX_BULK_BUFFERED_BYTES : MAX_BUFFERED_BYTES;
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > limit) return false;
        ws.send(data, { binary: true, compress: false }, error => { if (error) { hub.disconnect(peer); ws.terminate(); } });
        return ws.bufferedAmount <= limit;
      },
      close: (code, reason) => { if (ws.readyState === WebSocket.OPEN) ws.close(code, reason); ws.terminate(); },
    };
    peers.set(ws, peer); hub.connect(peer);
    ws.on('pong', () => hub.heartbeat(peer));
    ws.on('message', (data, binary) => {
      if (binary) { hub.receiveBinary(peer, Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data); return; }
      hub.receive(peer, data.toString());
    });
    ws.on('error', () => { hub.disconnect(peer); ws.terminate(); });
    ws.on('close', () => { hub.disconnect(peer); peers.delete(ws); });
  });
  const timer = setInterval(() => {
    hub.tick();
    for (const [ws, peer] of peers) if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) { hub.disconnect(peer, 'CONGESTION', 'Connection congested. The shared match is closed.'); ws.terminate(); }
      else ws.ping();
    }
  }, options.heartbeatMs ?? 5000);
  timer.unref();
  let closed = false;
  const close = () => { if (closed) return; closed = true; clearInterval(timer); hub.shutdown(); wss.close(); };
  server.once('close', close);
  return { hub, close };
}
