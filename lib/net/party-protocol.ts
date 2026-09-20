/** Global voice parties and channels ("party chat"): the signaling contract between
 * server/party-hub.ts and web/src/net/party-client.ts. One WebSocket per signed-in
 * browser on PARTY_SOCKET_PATH, independent of LAN rooms, so a group keeps talking
 * across menus, matches, tournaments and Rift runs. Audio is WebRTC mesh P2P (the
 * same web/src/net/voice-client.ts as room voice): only SDP / ICE travel here.
 *
 * CHANNELS are permanent public lounges anyone can hop into; PARTIES are groups a
 * player creates (open / friends only / invite only) and that vanish when empty.
 * A browser sits in at most one group. Members are accounts: ids are user ids.
 */
import type { PublicProfile } from './account-protocol.ts';
import { MAX_VOICE_CANDIDATE, MAX_VOICE_SDP, validVoiceCandidate, validVoiceIceExtras, validVoiceSdp } from './protocol.ts';

export const PARTY_PROTOCOL = 1;
export const PARTY_SOCKET_PATH = '/api/party';
/** GET: `{ iceServers }` for every voice mesh (room voice included). */
export const VOICE_CONFIG_PATH = '/api/voice/config';
export const MAX_PARTY_PAYLOAD = 4096;
/** Mesh P2P: every member uploads to every other one. */
export const MAX_PARTY_MEMBERS = 8;
export const MAX_PARTY_NAME = 28;
export const MAX_PARTIES = 64;
export const PARTY_INVITE_TTL_MS = 5 * 60_000;

export type PartyPrivacy = 'open' | 'friends' | 'invite';
export const PARTY_PRIVACIES: readonly PartyPrivacy[] = ['open', 'friends', 'invite'];
export const PRIVACY_LABELS: Readonly<Record<PartyPrivacy, string>> = { open: 'OPEN', friends: 'FRIENDS ONLY', invite: 'INVITE ONLY' };

export interface ChannelDef { id: string; name: string; topic: string; icon: string }
/** Permanent public lounges. Ids start with `#`; party ids never do. */
export const CHANNELS: readonly ChannelDef[] = [
  { id: '#lobby', name: 'Lobby', topic: 'Hang out and say hi', icon: '🏠' },
  { id: '#lfg', name: 'Looking for Game', topic: 'Find rivals for LAN battles', icon: '⚔' },
  { id: '#tournaments', name: 'Tournaments', topic: 'Bracket talk and set calls', icon: '🏆' },
  { id: '#rift', name: 'Rift Descent', topic: 'Builds, seeds and boss tips', icon: '◈' },
  { id: '#es', name: 'Español', topic: 'Sala en español', icon: '🌎' },
];

export interface PartyMember {
  /** Account id; also the WebRTC mesh id (lower id offers). */
  id: number;
  name: string;
  /** Fighter kind shown as the portrait. */
  avatar: string;
  /** Self-reported: mic open (voice enabled and not muted). */
  mic: boolean;
  /** Self-reported: what the player is doing (`menu`, `local`, `lan`, `rift`). */
  activity: string;
}
export interface PartyView {
  id: string;
  kind: 'channel' | 'party';
  name: string;
  topic: string;
  privacy: PartyPrivacy;
  /** Party only: who may kick, rename and change privacy. Passes on when they leave. */
  leaderId: number | null;
  members: PartyMember[];
  maxMembers: number;
}
/** Directory entry: what a browser may see before joining. */
export interface PartySummary {
  id: string; kind: PartyView['kind']; name: string; topic: string; privacy: PartyPrivacy;
  leaderName: string | null; members: number; maxMembers: number;
  /** A few member names for the card. */
  names: string[];
  /** A friend of the viewer is inside. */
  friendInside: boolean;
  /** The viewer may join right now (privacy, invite, room left). */
  joinable: boolean;
}
export interface PartyInvite { id: string; partyId: string; partyName: string; from: PublicProfile; expiresAt: number }

export type PartyClientMessage =
  | { type: 'auth'; protocol: number; token: string }
  | { type: 'list' }
  | { type: 'create'; name: string; privacy: PartyPrivacy }
  | { type: 'join'; id: string }
  | { type: 'leave' }
  | { type: 'update'; name?: string; privacy?: PartyPrivacy }
  | { type: 'kick'; userId: number }
  | { type: 'invite'; userId: number }
  | { type: 'dismiss'; id: string }
  | { type: 'status'; mic: boolean; activity: string }
  | { type: 'ping'; nonce: number }
  | { type: 'voice-offer' | 'voice-answer'; target: number; sdp: string }
  | { type: 'voice-ice'; target: number; candidate: string; sdpMid?: string; sdpMLineIndex?: number };

export type PartyServerMessage =
  | { type: 'hello'; protocol: number }
  | { type: 'authed'; me: PublicProfile }
  | { type: 'directory'; groups: PartySummary[] }
  /** null: not in a group (left, kicked, or the socket replaced by another tab). */
  | { type: 'party'; party: PartyView | null; reason?: string }
  | { type: 'invites'; invites: PartyInvite[] }
  | { type: 'voice-offer' | 'voice-answer'; from: number; sdp: string }
  | { type: 'voice-ice'; from: number; candidate: string; sdpMid?: string; sdpMLineIndex?: number }
  | { type: 'pong'; nonce: number }
  | { type: 'error'; code: string; message: string };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const userId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
export const ACTIVITY_PATTERN = /^[a-z]{1,12}$/u;
export function cleanPartyName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return text.length >= 1 && text.length <= MAX_PARTY_NAME && !/[\p{Cc}\p{Cf}]/u.test(text) ? text : null;
}
export function validGroupId(value: unknown): value is string {
  return typeof value === 'string' && (/^[A-Z2-9]{6}$/u.test(value) || CHANNELS.some(channel => channel.id === value));
}
/** Strict keys: a client can never smuggle a sender id or a leader flag into a command. */
export function parsePartyMessage(raw: string): PartyClientMessage {
  if (raw.length > MAX_PARTY_PAYLOAD) throw new Error('Payload exceeds the party limit.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Invalid JSON.'); }
  if (!record(value) || typeof value.type !== 'string') throw new Error('Invalid party message.');
  const v = value;
  let valid = false;
  switch (v.type) {
    case 'auth': valid = exact(v, ['type', 'protocol', 'token']) && v.protocol === PARTY_PROTOCOL && typeof v.token === 'string' && /^[A-Za-z0-9_-]{16,128}$/u.test(v.token); break;
    case 'list': case 'leave': valid = exact(v, ['type']); break;
    case 'create': valid = exact(v, ['type', 'name', 'privacy']) && cleanPartyName(v.name) !== null && PARTY_PRIVACIES.includes(v.privacy as PartyPrivacy); break;
    case 'join': valid = exact(v, ['type', 'id']) && validGroupId(v.id); break;
    case 'update': valid = exact(v, ['type', 'name', 'privacy']) && (v.name === undefined || cleanPartyName(v.name) !== null) && (v.privacy === undefined || PARTY_PRIVACIES.includes(v.privacy as PartyPrivacy)) && (v.name !== undefined || v.privacy !== undefined); break;
    case 'kick': case 'invite': valid = exact(v, ['type', 'userId']) && userId(v.userId); break;
    case 'dismiss': valid = exact(v, ['type', 'id']) && typeof v.id === 'string' && /^[a-f0-9]{8,32}$/u.test(v.id); break;
    case 'status': valid = exact(v, ['type', 'mic', 'activity']) && typeof v.mic === 'boolean' && typeof v.activity === 'string' && ACTIVITY_PATTERN.test(v.activity); break;
    case 'ping': valid = exact(v, ['type', 'nonce']) && Number.isSafeInteger(v.nonce) && (v.nonce as number) >= 0; break;
    case 'voice-offer': case 'voice-answer': valid = exact(v, ['type', 'target', 'sdp']) && userId(v.target) && validVoiceSdp(v.sdp); break;
    case 'voice-ice': valid = exact(v, ['type', 'target', 'candidate', 'sdpMid', 'sdpMLineIndex']) && userId(v.target) && validVoiceCandidate(v.candidate) && validVoiceIceExtras(v); break;
  }
  if (!valid) throw new Error('Invalid party protocol, fields, or bounds.');
  return v as unknown as PartyClientMessage;
}
export { MAX_VOICE_CANDIDATE, MAX_VOICE_SDP };
