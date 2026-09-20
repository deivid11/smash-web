/** Trusted-LAN prototype relay protocol. No simulation or asset bytes travel here. */
import { MAX_MATCH_PLAYERS } from '../game/limits.ts';
import type { PlayerControllerMode } from '../game/setup.ts';
import { isCustomFighter, validPackIdentities, samePacks, packMismatch, type CustomFighterKind, type PackIdentity } from '../custom/identity.ts';

/** v3 distinguished socket-owned humans from host-configured CPU seats; v4 adds the CPU level (1-9) per CPU seat; v5 changes the rollback snapshot cadence (keyframed) and hash capture, so v4 and v5 clients must never cross-hash; v6 adds room-scoped WebRTC voice signaling (offer/answer/ICE) relayed peer-to-peer, so v5 and v6 rooms must never mix; v7 adds the visual-only costume index per seat, so v6 and v7 rooms must never mix (a v6 client would render every skin as default); v8 adds binary input frames (lib/net/input-codec.ts), held seats with `resume` after a dropped connection or a browser restart, and a soft `background`, so v7 clients (which expect a drop to close the match) must never join v8 rooms; v9 adds the optional King of the Hill zones in the rules (a v8 client would simulate a stock battle from the same start and desync) and read-only spectators, so v8 and v9 rooms must never mix. */
/** v10: namespaced installed custom fighters and exact pack-byte identities. */
/** v11 adds the taunt button to the input record and its binary payload bit, so a v10
 * client (which rejects the new payload byte outright) must never join a v11 room. */
export const ROOM_PROTOCOL = 11;
export const ROOM_SOCKET_PATH = '/api/rooms';
export const MAX_ROOM_PAYLOAD = 4096;
export const MAX_BUFFERED_BYTES = 256 * 1024;
export const MAX_MATCH_FRAME = 60 * 600 + 600;
/** How long a running match holds the seat of a human whose socket dropped or whose tab is
 * hidden. Everyone else stalls at the rollback prediction cap until they return. */
export const RECONNECT_GRACE_MS = 90_000;
/** A resumed browser that restarted must replay the whole input log before it sends again. */
export const RESUME_CATCH_UP_MS = 120_000;
/** Voice SDP fits the unchanged 4 KiB inbound budget with JSON overhead to spare.
 * Audio-only Opus offers are typically 0.8-1.5 KiB; trickle ICE keeps them small. */
export const MAX_VOICE_SDP = 3500;
/** A single ICE candidate line; empty string signals end-of-candidates. */
export const MAX_VOICE_CANDIDATE = 1024;
export type RoomFighter = CustomFighterKind | 'Fx' | 'Mr' | 'Kb' | 'Ss' | 'Pk' | 'Fe' | 'Lk' | 'Ca' | 'Dk' | 'Mt' | 'Cl' | 'Pr' | 'Ns' | 'Kp' | 'Pe' | 'Zx' | 'Td' | 'Mk' | 'Sn' | 'Rc' | 'Lz' | 'Fc' | 'Dr' | 'Gn' | 'Pc' | 'Ms' | 'Lg' | 'Pp' | 'Zd' | 'Sk' | 'Gw' | 'Ys' | 'Wf' | 'Dd' | 'De' | 'Wr' | 'Sh' | 'Bl' | 'Lc' | 'Nm' | 'Nt' | 'Da' | 'Fy' | 'Sc' | 'Dl' | 'Kx' | 'Lu' | 'Lc2' | 'Sm' | 'Lb' | 'MM' | 'Sd' | 'Cn' | 'Gk' | 'Ts' | 'Bf' | 'WfU';
export const ROOM_FIGHTERS: readonly RoomFighter[] = ['Fx', 'Mr', 'Kb', 'Ss', 'Pk', 'Fe', 'Lk', 'Ca', 'Dk', 'Mt', 'Cl', 'Pr', 'Ns', 'Kp', 'Pe', 'Zx', 'Td', 'Mk', 'Sn', 'Rc', 'Lz', 'Fc', 'Dr', 'Gn', 'Pc', 'Ms', 'Lg', 'Pp', 'Zd', 'Sk', 'Gw', 'Ys', 'Wf', 'Dd', 'De', 'Wr', 'Sh', 'Bl', 'Lc', 'Nm', 'Nt', 'Da', 'Fy', 'Sc', 'Dl', 'Kx', 'Lu', 'Lc2', 'Sm', 'Lb', 'MM', 'Sd', 'Cn', 'Gk', 'Ts', 'Bf', 'WfU'];
export type RoomStage = 'battlefield' | 'final' | 'corneria' | 'temple' | 'stadium' | 'yoshi-story' | 'dream-land' | 'peach-castle' | 'onett' | 'mute-city' | 'yoshi-island' | 'green-greens' | 'venom' | 'jungle-japes' | 'fourside' | 'brinstar' | 'kongo-jungle' | 'fountain-of-dreams' | 'mushroom-kingdom';
export interface Fingerprint { game: string; wasm: string; content: string; packs?: readonly PackIdentity[] }
export function validRoomFighter(value: unknown): value is RoomFighter { return isCustomFighter(value) || (typeof value === 'string' && (ROOM_FIGHTERS as readonly string[]).includes(value)); }
export function fighterInstalled(fighter: RoomFighter, fingerprint: Fingerprint): boolean { return !isCustomFighter(fighter) || (fingerprint.packs ?? []).some(pack => pack.id === fighter); }
/** `hill` is the King of the Hill zone count; omitted means a stock battle. Every peer builds the
 * zones from the shared seed and hill state is snapshot-owned, so the mode is rollback-safe. */
export interface RoomRules { stage: RoomStage; stocks: number; timeSeconds: number; hill?: 1 | 2 }
export const DEFAULT_ROOM_RULES: Readonly<RoomRules> = Object.freeze({ stage: 'battlefield', stocks: 3, timeSeconds: 180 });
/** Deliberately structural: the relay must not import or run the game engine. */
export interface NetInput {
  x: number; jump: boolean; attack: boolean; strong: boolean; down: boolean;
  y?: number; special?: boolean; specialDirection?: 'neutral' | 'side' | 'up' | 'down';
  shield?: boolean; grab?: boolean; walk?: boolean; taunt?: boolean;
  /** Smash-stick axes (rollback normalizeInput always sends them, default 0). */
  cX?: number; cY?: number;
}
/** Missing control means human only for legacy in-memory fixtures; v3 servers always set it.
 * `level` is the CPU intelligence (1-9) the host chose; humans never carry one.
 * `costume` is the visual-only skin index (0 = default); omitted means 0. */
export interface RoomPlayer { slot: number; name: string; fighter: RoomFighter; ready: boolean; control?: PlayerControllerMode; level?: number; costume?: number;
  /** Only ever present as `false`: a human whose seat is held while they reconnect or return from the background. */
  connected?: boolean }
export interface RoomView {
  code: string; hostSlot: number; phase: 'lobby' | 'playing' | 'ended';
  players: readonly RoomPlayer[]; rules: RoomRules; fingerprint: Fingerprint;
  /** Server time at which the earliest held seat expires and the match closes. */
  graceEndsAt?: number;
  /** Read-only watchers; only present when there is at least one. They never hold a seat. */
  spectators?: number;
}
/** Public lobby directory entry for the room browser. Tokens, slots and match
 * state stay private; only joinable lobby counts, host name, rules and the
 * compatibility fingerprint are exposed. Names are LAN-visible by design. */
export interface RoomSummary {
  code: string; phase: RoomView['phase'];
  players: number; humans: number; maxPlayers: number;
  hostName: string; rules: RoomRules; fingerprint: Fingerprint;
}
export interface MatchStart {
  type: 'start'; matchId: string; seed: number; startAt: number; serverNow: number;
  players: readonly RoomPlayer[]; rules: RoomRules; fingerprint: Fingerprint;
  /** Present when this start answers a `resume`: what the relay already holds from this seat.
   * The input backlog follows, then `synced`. */
  resume?: MatchResume;
  /** Only on the copy a spectator receives. Mid-match, every human's input backlog from frame 0
   * follows, then `synced`. */
  spectator?: true;
}
export interface MatchResume { lastFrame: number; lastHash: number; finished: boolean }
/** `delay`/`adv` are the sender's pacing hints (binary relay only); never simulated. */
export interface RelayedInput { type: 'input'; matchId: string; slot: number; frame: number; input: NetInput; delay?: number; adv?: number }
export interface MatchEnd { type: 'end'; matchId: string; code: string; message: string; slot?: number; frame?: number; hashes?: Record<string, string> }
export type VoiceOfferKind = 'voice-offer' | 'voice-answer';
export interface VoiceIcePayload { candidate: string; sdpMid?: string; sdpMLineIndex?: number }
export type ClientMessage =
  | { type: 'create'; protocol: number; name: string; fingerprint: Fingerprint; rules?: RoomRules; binary?: boolean }
  | { type: 'join'; protocol: number; code: string; name: string; fingerprint: Fingerprint; binary?: boolean }
  /** Reclaims a held seat in a running match. `from` is the first input frame this browser
   * still needs (0 after a restart). The token is the one `joined` issued. */
  | { type: 'resume'; protocol: number; code: string; token: string; fingerprint: Fingerprint; from: number; binary?: boolean }
  /** Read-only watcher of a room in any phase: no name, no seat, no token. Receives the room, the
   * shared start and every human's inputs, and simulates the match locally like a player does. */
  | { type: 'spectate'; protocol: number; code: string; fingerprint: Fingerprint; binary?: boolean }
  /** Token-less leave; only valid on a spectating connection. */
  | { type: 'unspectate' }
  | { type: 'ping'; nonce: number }
  | ({ token: string } & (
    | { type: 'choose'; fighter: RoomFighter; costume?: number }
    | { type: 'cpu'; slot: number; fighter: RoomFighter | null; level?: number; costume?: number }
    | { type: 'rules'; rules: RoomRules }
    | { type: 'ready'; assetsLoaded: boolean }
    | { type: 'start' | 'leave' | 'lobby' | 'background' }
    | { type: 'input'; matchId: string; frame: number; input: NetInput }
    | { type: 'hash' | 'finish'; matchId: string; frame: number; hash: string }
    | { type: VoiceOfferKind; target: number; sdp: string }
    | { type: 'voice-ice'; target: number; candidate: string; sdpMid?: string; sdpMLineIndex?: number }
  ));
export type VoiceSignal =
  | { type: 'voice-offer'; from: number; sdp: string }
  | { type: 'voice-answer'; from: number; sdp: string }
  | { type: 'voice-ice'; from: number; candidate: string; sdpMid?: string; sdpMLineIndex?: number };
export type ServerMessage =
  | { type: 'hello'; protocol: number; serverNow: number }
  | { type: 'joined'; token: string; slot: number; room: RoomView }
  | { type: 'spectating'; room: RoomView }
  | { type: 'room'; room: RoomView }
  | MatchStart | RelayedInput | MatchEnd
  | { type: 'hash'; matchId: string; frame: number; hash: string }
  | { type: 'synced'; matchId: string }
  | VoiceSignal
  | { type: 'left' }
  | { type: 'pong'; nonce: number; serverNow: number }
  | { type: 'error'; code: string; message: string };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export function validFingerprint(value: unknown): value is Fingerprint {
  return record(value) && exact(value, ['game', 'wasm', 'content', 'packs']) && text(value.game, 128) && digest(value.wasm) && digest(value.content) && (value.packs === undefined || validPackIdentities(value.packs));
}
export function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean { return a.game === b.game && a.wasm === b.wasm && a.content === b.content && samePacks(a.packs, b.packs); }
export function fingerprintMismatchMessage(a: Fingerprint, b: Fingerprint): string {
  const packs = packMismatch(a.packs, b.packs);
  if (packs.length) return `Custom character packs missing or different: ${packs.join(', ')}. Install identical packs and rebuild; packs are never downloaded from peers.`;
  const fields = (['game', 'wasm', 'content'] as const).filter(field => a[field] !== b[field]);
  return `Incompatible ${fields.join(', ')} fingerprint. Reload identical game, WASM and gameplay content.`;
}
export function validRoomSummary(value: unknown): value is RoomSummary {
  if (!record(value)) return false;
  if (!exact(value, ['code', 'phase', 'players', 'humans', 'maxPlayers', 'hostName', 'rules', 'fingerprint'])) return false;
  if (typeof value.code !== 'string' || !/^[A-Z2-9]{6}$/u.test(value.code)) return false;
  if (value.phase !== 'lobby' && value.phase !== 'playing' && value.phase !== 'ended') return false;
  if (!integer(value.players, 1, MAX_MATCH_PLAYERS) || !integer(value.humans, 1, MAX_MATCH_PLAYERS)) return false;
  if ((value.humans as number) > (value.players as number)) return false;
  if (value.maxPlayers !== MAX_MATCH_PLAYERS) return false;
  if (typeof value.hostName !== 'string' || value.hostName.length > 32 || /[\u0000-\u001f\u007f]/u.test(value.hostName)) return false;
  return validRules(value.rules) && validFingerprint(value.fingerprint);
}
export function validRules(value: unknown): value is RoomRules {
  return record(value) && exact(value, ['stage', 'stocks', 'timeSeconds', 'hill']) && (value.hill === undefined || value.hill === 1 || value.hill === 2) && (['battlefield', 'final', 'corneria', 'temple', 'stadium', 'yoshi-story', 'dream-land', 'peach-castle', 'onett', 'mute-city', 'yoshi-island', 'green-greens', 'venom', 'jungle-japes', 'fourside', 'brinstar', 'kongo-jungle', 'fountain-of-dreams', 'mushroom-kingdom'] as readonly string[]).includes(value.stage as string) && integer(value.stocks, 1, 9) && integer(value.timeSeconds, 1, 600);
}
export function validNetInput(value: unknown): value is NetInput {
  if (!record(value) || !exact(value, ['x', 'y', 'jump', 'attack', 'strong', 'down', 'special', 'specialDirection', 'shield', 'grab', 'walk', 'taunt', 'cX', 'cY'])) return false;
  if (typeof value.x !== 'number' || !Number.isFinite(value.x) || Math.abs(value.x) > 1) return false;
  if (value.y !== undefined && (typeof value.y !== 'number' || !Number.isFinite(value.y) || Math.abs(value.y) > 1)) return false;
  if (!['jump', 'attack', 'strong', 'down'].every(key => typeof value[key] === 'boolean')) return false;
  if (!['special', 'shield', 'grab', 'walk', 'taunt'].every(key => value[key] === undefined || typeof value[key] === 'boolean')) return false;
  for (const axis of ['cX', 'cY'] as const) if (value[axis] !== undefined && (typeof value[axis] !== 'number' || !Number.isFinite(value[axis] as number) || Math.abs(value[axis] as number) > 1)) return false;
  return value.specialDirection === undefined || ['neutral', 'side', 'up', 'down'].includes(value.specialDirection as string);
}
export function validVoiceSlot(value: unknown): value is number {
  return integer(value, 0, MAX_MATCH_PLAYERS - 1);
}
/** SDP contains CRLF line breaks, so control-char rejection does not apply.
 * Bound the length, require a v=0 header and reject NUL to prevent the relay
 * from becoming generic exfiltration. Targets validate via setRemoteDescription. */
export function validVoiceSdp(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= MAX_VOICE_SDP &&
    value.startsWith('v=0') && !value.includes('\u0000') && value.includes('\r\n');
}
/** Empty candidate signals end-of-candidates; otherwise a single trickle line. */
export function validVoiceCandidate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_VOICE_CANDIDATE &&
    !/[\u0000\u007f]/u.test(value) && !value.includes('\n') && !value.includes('\r');
}
export function validVoiceIceExtras(value: Record<string, unknown>): boolean {
  return (value.sdpMid === undefined || (typeof value.sdpMid === 'string' && value.sdpMid.length > 0 && value.sdpMid.length <= 32 && !/[\u0000-\u001f\u007f]/u.test(value.sdpMid))) &&
    (value.sdpMLineIndex === undefined || integer(value.sdpMLineIndex, 0, 32));
}
/** Strict keys prevent a client from smuggling a slot/seed/host identity into commands. */
export function parseClientMessage(raw: string): ClientMessage {
  if (raw.length > MAX_ROOM_PAYLOAD) throw new Error('Payload exceeds the room limit.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Invalid JSON.'); }
  if (!record(value) || typeof value.type !== 'string') throw new Error('Invalid room message.');
  const v = value;
  let valid = false;
  if (v.type === 'create' || v.type === 'join') {
    valid = exact(v, v.type === 'create' ? ['type', 'protocol', 'name', 'fingerprint', 'rules', 'binary'] : ['type', 'protocol', 'name', 'fingerprint', 'code', 'binary']) && (v.binary === undefined || typeof v.binary === 'boolean') && v.protocol === ROOM_PROTOCOL && text(v.name, 32) && v.name.trim().length > 0 && validFingerprint(v.fingerprint) && (v.type === 'create' ? v.rules === undefined || validRules(v.rules) : typeof v.code === 'string' && /^[A-Z2-9]{6}$/u.test(v.code));
  } else if (v.type === 'resume') {
    valid = exact(v, ['type', 'protocol', 'code', 'token', 'fingerprint', 'from', 'binary']) && v.protocol === ROOM_PROTOCOL && typeof v.code === 'string' && /^[A-Z2-9]{6}$/u.test(v.code) && text(v.token, 64) && validFingerprint(v.fingerprint) && integer(v.from, 0, MAX_MATCH_FRAME) && (v.binary === undefined || typeof v.binary === 'boolean');
  } else if (v.type === 'spectate') {
    valid = exact(v, ['type', 'protocol', 'code', 'fingerprint', 'binary']) && v.protocol === ROOM_PROTOCOL && typeof v.code === 'string' && /^[A-Z2-9]{6}$/u.test(v.code) && validFingerprint(v.fingerprint) && (v.binary === undefined || typeof v.binary === 'boolean');
  } else if (v.type === 'unspectate') {
    valid = exact(v, ['type']);
  } else if (v.type === 'ping') {
    valid = exact(v, ['type', 'nonce']) && integer(v.nonce, 0, Number.MAX_SAFE_INTEGER);
  } else if (text(v.token, 64)) {
    const keys = ['type', 'token'];
    switch (v.type) {
      case 'choose': valid = exact(v, [...keys, 'fighter', 'costume']) && validRoomFighter(v.fighter) && (v.costume === undefined || integer(v.costume, 0, 11)); break;
      case 'cpu': valid = exact(v, [...keys, 'slot', 'fighter', 'level', 'costume']) && integer(v.slot, 0, MAX_MATCH_PLAYERS - 1) && (v.fighter === null || validRoomFighter(v.fighter)) && (v.level === undefined || integer(v.level, 1, 9)) && (v.costume === undefined || integer(v.costume, 0, 11)); break;
      case 'rules': valid = exact(v, [...keys, 'rules']) && validRules(v.rules); break;
      case 'ready': valid = exact(v, [...keys, 'assetsLoaded']) && typeof v.assetsLoaded === 'boolean'; break;
      case 'start': case 'leave': case 'lobby': case 'background': valid = exact(v, keys); break;
      case 'input': case 'hash': case 'finish':
        valid = text(v.matchId, 64) && integer(v.frame, 0, MAX_MATCH_FRAME) && (v.type === 'input'
          ? exact(v, [...keys, 'matchId', 'frame', 'input']) && validNetInput(v.input)
          : exact(v, [...keys, 'matchId', 'frame', 'hash']) && digest(v.hash));
        break;
      case 'voice-offer': case 'voice-answer':
        valid = exact(v, [...keys, 'target', 'sdp']) && validVoiceSlot(v.target) && validVoiceSdp(v.sdp);
        break;
      case 'voice-ice':
        valid = exact(v, [...keys, 'target', 'candidate', 'sdpMid', 'sdpMLineIndex']) &&
          validVoiceSlot(v.target) && validVoiceCandidate(v.candidate) && validVoiceIceExtras(v);
        break;
    }
  }
  if (!valid) throw new Error('Invalid room protocol, fields, or bounds.');
  return v as unknown as ClientMessage;
}

/** Runtime freeze used by external-store subscribers and callback payloads. */
export function immutable<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(child => immutable(child)); Object.freeze(value);
  }
  return value;
}
