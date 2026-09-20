import { describe, expect, it, vi } from 'vitest';
import { PartyClient } from '../../web/src/net/party-client.ts';
import { PARTY_PROTOCOL, type PartyServerMessage, type PartyView } from '../../lib/net/party-protocol.ts';

class FakeSocket {
  readyState = 1; sent: Array<Record<string, unknown>> = [];
  private readonly handlers = new Map<string, Array<(event: { data?: unknown }) => void>>();
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void { this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]); }
  send(data: string): void { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close(): void { this.readyState = 3; this.emit('close'); }
  emit(type: string, data?: unknown): void { for (const handler of this.handlers.get(type) ?? []) handler({ data }); }
  server(message: PartyServerMessage): void { this.emit('message', JSON.stringify(message)); }
}
const me = { id: 7, username: 'dave', displayName: 'Dave', avatar: 'Mr', title: '', createdAt: 0, rift: null };
const view = (members: number[]): PartyView => ({ id: '#lobby', kind: 'channel', name: 'Lobby', topic: '', privacy: 'open', leaderId: null, maxMembers: 8, members: members.map(id => ({ id, name: `U${id}`, avatar: 'Fx', mic: false, activity: 'menu' })) });
function boot(token: string | null = 'a'.repeat(32)) {
  const sockets: FakeSocket[] = [];
  const client = new PartyClient({ token: () => token, url: 'ws://test/api/party', createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; } });
  return { client, sockets };
}
const handshake = (socket: FakeSocket): void => { socket.server({ type: 'hello', protocol: PARTY_PROTOCOL }); socket.server({ type: 'authed', me }); socket.server({ type: 'directory', groups: [] }); socket.server({ type: 'invites', invites: [] }); socket.server({ type: 'party', party: null }); };

describe('party client', () => {
  it('stays offline without a session and authenticates with the account token', () => {
    expect(boot(null).sockets).toHaveLength(0);
    const { client, sockets } = boot(); client.sync();
    sockets[0]!.server({ type: 'hello', protocol: PARTY_PROTOCOL });
    expect(sockets[0]!.sent[0]).toEqual({ type: 'auth', protocol: PARTY_PROTOCOL, token: 'a'.repeat(32) });
    handshake(sockets[0]!);
    expect(client.getState().status).toBe('online');
    client.dispose();
  });
  it('exposes the group as a voice mesh: account ids are mesh ids, signals need a group', () => {
    const { client, sockets } = boot(); client.sync(); handshake(sockets[0]!);
    expect(client.getSnapshot()).toEqual({ slot: null, room: null });
    expect(client.sendVoiceOffer(9, 'v=0\r\n')).toBe(false);
    sockets[0]!.server({ type: 'party', party: view([7, 9]) });
    expect(client.getSnapshot().slot).toBe(7);
    expect(client.getSnapshot().room?.players.map(player => player.slot)).toEqual([7, 9]);
    expect(client.sendVoiceIce(9, '')).toBe(true);
    const heard = vi.fn(); client.onVoice = heard;
    sockets[0]!.server({ type: 'voice-offer', from: 9, sdp: 'v=0\r\n' });
    expect(heard).toHaveBeenCalledWith({ type: 'voice-offer', from: 9, sdp: 'v=0\r\n' });
    client.dispose();
  });
  it('re-sends its status on join and rejoins its group after a dropped socket', () => {
    vi.useFakeTimers();
    const { client, sockets } = boot(); client.sync(); handshake(sockets[0]!);
    client.setStatus(true, 'lan'); client.join('#lobby');
    sockets[0]!.server({ type: 'party', party: view([7]) });
    expect(sockets[0]!.sent.at(-1)).toEqual({ type: 'status', mic: true, activity: 'lan' });
    sockets[0]!.close();
    expect(client.getState().status).toBe('offline'); expect(client.getSnapshot().room).toBeNull();
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(2); handshake(sockets[1]!);
    expect(sockets[1]!.sent.at(-1)).toEqual({ type: 'join', id: '#lobby' });
    client.dispose(); vi.useRealTimers();
  });
  it('does not fight another tab that took the socket over, nor rejoin after a kick or a leave', () => {
    vi.useFakeTimers();
    const { client, sockets } = boot(); client.sync(); handshake(sockets[0]!);
    sockets[0]!.server({ type: 'party', party: view([7]) });
    sockets[0]!.server({ type: 'party', party: null, reason: 'Signed in to party chat from another tab or device.' });
    sockets[0]!.close(); vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.getState().notice).toContain('another tab');
    client.dispose(); vi.useRealTimers();
  });
});
