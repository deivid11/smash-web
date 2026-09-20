/** Global party chat socket (lib/net/party-protocol.ts): one connection per signed-in
 * browser, independent of LAN rooms, so a group keeps talking across menus, matches,
 * tournaments and Rift runs. Also the signaling transport of the party voice mesh
 * (VoiceTransport): mesh ids are account ids. No audio, no simulation here.
 */
import { immutable, type VoiceSignal } from '../../../lib/net/protocol.ts';
import {
  MAX_PARTY_PAYLOAD, PARTY_PROTOCOL, PARTY_SOCKET_PATH,
  type PartyClientMessage, type PartyInvite, type PartyPrivacy, type PartyServerMessage, type PartySummary, type PartyView,
} from '../../../lib/net/party-protocol.ts';
import type { PublicProfile } from '../../../lib/net/account-protocol.ts';
import type { VoiceTransport } from './voice-client.ts';

export interface PartySnapshot {
  status: 'offline' | 'connecting' | 'online';
  me: PublicProfile | null;
  party: PartyView | null;
  directory: readonly PartySummary[];
  invites: readonly PartyInvite[];
  /** Why the last group was lost (kicked, replaced by another tab) or the last command failed. */
  notice: string;
}
export interface PartyClientOptions {
  token: () => string | null;
  url?: string;
  createSocket?: (url: string) => WebSocket;
  /** false: never reconnect (tests). */
  reconnect?: boolean;
}
/** The server says this when another tab took the party socket over: reconnecting would make the two fight. */
const REPLACED = 'another tab or device';
const LAST_GROUP_KEY = 'smash-party-last';

export class PartyClient implements VoiceTransport {
  onVoice?: (signal: VoiceSignal) => void;
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<() => void>();
  private state: Readonly<PartySnapshot> = immutable<PartySnapshot>({ status: 'offline', me: null, party: null, directory: [], invites: [], notice: '' });
  private voiceView: ReturnType<VoiceTransport['getSnapshot']> = { slot: null, room: null };
  private wanted = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private pinger: ReturnType<typeof setInterval> | undefined;
  private attempt = 0;
  private nonce = 0;
  /** Group to return to after a dropped connection. */
  private rejoin: string | null = null;
  private status = { mic: false, activity: 'menu' };
  constructor(private readonly options: PartyClientOptions) {}

  readonly getState = (): Readonly<PartySnapshot> => this.state;
  /** VoiceTransport view: my account id and the group's members. */
  readonly getSnapshot = (): ReturnType<VoiceTransport['getSnapshot']> => this.voiceView;
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<PartySnapshot>): void {
    this.state = immutable({ ...this.state, ...patch });
    const { me, party } = this.state;
    this.voiceView = { slot: me && party ? me.id : null, room: me && party ? { players: party.members.map(member => ({ slot: member.id, name: member.name, control: 'human' })) } : null };
    for (const listener of this.listeners) listener();
  }

  /** Keeps a socket open while signed in; call again after sign-in / sign-out. */
  sync(): void {
    const token = this.options.token();
    if (!token) { this.wanted = false; this.close(); return; }
    this.wanted = true;
    if (!this.socket) this.open();
  }
  private open(): void {
    const token = this.options.token();
    if (!token || this.socket || typeof WebSocket === 'undefined' && !this.options.createSocket) return;
    clearTimeout(this.retry);
    const url = this.options.url ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${PARTY_SOCKET_PATH}`;
    let socket: WebSocket;
    try { socket = (this.options.createSocket ?? (address => new WebSocket(address)))(url); } catch { this.schedule(); return; }
    this.socket = socket;
    this.update({ status: 'connecting' });
    socket.addEventListener('message', event => {
      if (this.socket !== socket || typeof event.data !== 'string' || event.data.length > MAX_PARTY_PAYLOAD * 16) return;
      let message: PartyServerMessage;
      try { message = JSON.parse(event.data) as PartyServerMessage; } catch { return; }
      if (message && typeof message === 'object') this.receive(message, token);
    });
    const gone = (): void => { if (this.socket === socket) this.dropped(); };
    socket.addEventListener('close', gone);
    socket.addEventListener('error', gone);
  }
  private receive(message: PartyServerMessage, token: string): void {
    switch (message.type) {
      case 'hello':
        if (message.protocol !== PARTY_PROTOCOL) { this.wanted = false; this.update({ notice: 'Party chat needs a newer game version. Reload the page.' }); this.close(); return; }
        this.send({ type: 'auth', protocol: PARTY_PROTOCOL, token }); break;
      case 'authed':
        this.attempt = 0;
        this.update({ status: 'online', me: message.me });
        clearInterval(this.pinger);
        this.pinger = setInterval(() => this.send({ type: 'ping', nonce: ++this.nonce }), 20_000);
        break;
      case 'directory': this.update({ directory: message.groups }); break;
      case 'invites': this.update({ invites: message.invites }); break;
      case 'party': {
        if (message.party) { this.rejoin = message.party.id; this.remember(message.party.id); }
        else if (message.reason) { this.rejoin = null; this.remember(null); if (message.reason.includes(REPLACED)) this.wanted = false; }
        const joined = !!message.party && this.state.party?.id !== message.party.id;
        this.update({ party: message.party, ...(message.reason ? { notice: message.reason } : message.party ? { notice: '' } : {}) });
        // Auth answers `party: null` unless the membership moved here: go back to the group a drop interrupted.
        if (!message.party && !message.reason && this.rejoin) { const id = this.rejoin; this.rejoin = null; this.send({ type: 'join', id }); }
        // The server resets the self-reported flags on every (re)join.
        if (joined) this.send({ type: 'status', ...this.status });
        break;
      }
      case 'voice-offer': case 'voice-answer': case 'voice-ice': this.onVoice?.(immutable(message)); break;
      case 'error':
        if (message.code === 'AUTH_FAILED') this.wanted = false;
        if (message.code === 'GROUP_NOT_FOUND') { this.rejoin = null; this.remember(null); }
        this.update({ notice: message.message }); break;
      case 'pong': break;
    }
  }
  private dropped(): void {
    this.socket = null;
    clearInterval(this.pinger);
    // Members are gone for the voice mesh while offline; `rejoin` brings the group back.
    this.update({ status: 'offline', party: null, directory: [], me: this.state.me });
    if (this.wanted && this.options.reconnect !== false) this.schedule();
  }
  private schedule(): void {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => { if (this.wanted && !this.socket) this.open(); }, Math.min(15_000, 1000 * 2 ** Math.min(4, this.attempt++)));
  }
  private close(): void {
    clearTimeout(this.retry); clearInterval(this.pinger);
    const socket = this.socket; this.socket = null; this.rejoin = null;
    if (socket && socket.readyState < 2) socket.close(1000, 'Signed out.');
    this.update({ status: 'offline', me: null, party: null, directory: [], invites: [] });
  }
  private send(message: PartyClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(message)); return true; } catch { return false; }
  }
  private command(message: PartyClientMessage): boolean {
    if (this.state.status !== 'online') { this.update({ notice: 'Party chat is offline. Reconnecting…' }); if (!this.wanted) { this.wanted = true; } if (!this.socket) this.open(); return false; }
    return this.send(message);
  }
  private remember(id: string | null): void { try { if (id) sessionStorage.setItem(LAST_GROUP_KEY, id); else sessionStorage.removeItem(LAST_GROUP_KEY); } catch { /* private mode */ } }

  refresh(): boolean { return this.command({ type: 'list' }); }
  create(name: string, privacy: PartyPrivacy): boolean { return this.command({ type: 'create', name, privacy }); }
  join(id: string): boolean { return this.command({ type: 'join', id }); }
  leave(): boolean { this.rejoin = null; this.remember(null); return this.command({ type: 'leave' }); }
  rename(name: string): boolean { return this.command({ type: 'update', name }); }
  setPrivacy(privacy: PartyPrivacy): boolean { return this.command({ type: 'update', privacy }); }
  kick(userId: number): boolean { return this.command({ type: 'kick', userId }); }
  invite(userId: number): boolean { return this.command({ type: 'invite', userId }); }
  dismiss(id: string): boolean { return this.command({ type: 'dismiss', id }); }
  accept(invite: PartyInvite): boolean { return this.join(invite.partyId); }
  /** Self-reported flags shown on the member row; only sent when they change. */
  setStatus(mic: boolean, activity: string): void {
    if (this.status.mic === mic && this.status.activity === activity) return;
    this.status = { mic, activity };
    if (this.state.party) this.send({ type: 'status', mic, activity });
  }
  sendVoiceOffer(target: number, sdp: string): boolean { return !!this.state.party && this.send({ type: 'voice-offer', target, sdp }); }
  sendVoiceAnswer(target: number, sdp: string): boolean { return !!this.state.party && this.send({ type: 'voice-answer', target, sdp }); }
  sendVoiceIce(target: number, candidate: string, sdpMid?: string, sdpMLineIndex?: number): boolean {
    return !!this.state.party && this.send({ type: 'voice-ice', target, candidate, ...(sdpMid !== undefined ? { sdpMid } : {}), ...(sdpMLineIndex !== undefined ? { sdpMLineIndex } : {}) });
  }
  dispose(): void { this.wanted = false; this.close(); this.listeners.clear(); }
}
