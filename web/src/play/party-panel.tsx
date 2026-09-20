/** Party chat UI (Xbox-Live style): a header chip that shows the group at a glance, a
 * dialog with the public channels, open parties, the current group's members and the
 * voice controls, and a tiny in-match overlay naming whoever is talking. The group is
 * global: it survives every scene change. Logic lives in web/src/net/party-client.ts
 * and web/src/net/voice-client.ts; this file only renders and forwards clicks.
 * The dialog carries `options-dialog` so the pad navigation and B already work in it.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CHANNELS, MAX_PARTY_NAME, PARTY_PRIVACIES, PRIVACY_LABELS, type PartyPrivacy, type PartySummary } from '../../../lib/net/party-protocol.ts';
import type { PartyClient } from '../net/party-client.ts';
import type { VoiceClient } from '../net/voice-client.ts';
import type { AccountState } from '../account/account-client.ts';
import './party-panel.css';

export interface PartyRuntime { party: PartyClient; voice: VoiceClient }
const ACTIVITY_LABELS: Readonly<Record<string, string>> = { menu: 'In the menus', local: 'Local battle', lan: 'LAN battle', rift: 'Rift Descent', tourney: 'Tournament' };
const channelIcon = (id: string): string => CHANNELS.find(channel => channel.id === id)?.icon ?? '🎧';

function useParty({ party, voice }: PartyRuntime) {
  return { state: useSyncExternalStore(party.subscribe, party.getState), talk: useSyncExternalStore(voice.subscribe, voice.getSnapshot) };
}

/** Header / home entry: group name, head count, a pulse while someone talks, a badge for invites. */
export function PartyChip({ runtime, account, onOpen, variant }: { runtime: PartyRuntime; account: AccountState; onOpen: () => void; variant: 'home' | 'header' }) {
  const { state, talk } = useParty(runtime);
  if (account.status === 'unavailable') return null;
  const talking = talk.localSpeaking || talk.peers.some(peer => peer.speaking), group = state.party;
  const label = group ? `${group.name} · ${group.members.length}` : 'Party chat';
  return <button id="party-open" type="button" className={`${variant === 'home' ? 'system-entry' : 'system-icon'} party-chip${group ? ' in-party' : ''}${talking ? ' is-talking' : ''}`} aria-label={`Party chat${group ? `: ${label}` : ''}`} title={group ? `${label} — party chat` : 'Party chat: voice channels and parties'} onClick={onOpen}>
    <span className={variant === 'home' ? 'system-glyph' : undefined} aria-hidden="true">🎧</span>
    {variant === 'home' ? <span>{group ? label : 'Party chat'}</span> : group && <small className="party-chip-count">{group.members.length}</small>}
    {state.invites.length > 0 && <em className="party-chip-badge" aria-label={`${state.invites.length} party invites`}>{state.invites.length}</em>}
  </button>;
}

/** In-match: who is talking right now. Never takes input. */
export function PartyOverlay({ runtime }: { runtime: PartyRuntime }) {
  const { state, talk } = useParty(runtime);
  if (!state.party || !talk.enabled) return null;
  const names = [...(talk.localSpeaking ? ['You'] : []), ...talk.peers.filter(peer => peer.speaking).map(peer => peer.name)];
  return <aside className="party-overlay" aria-live="off"><span className="party-overlay-group">🎧 {state.party.name}{talk.muted ? ' · MIC MUTED' : ''}</span>{names.map(name => <span key={name} className="party-overlay-talker">🔊 {name}</span>)}</aside>;
}

export function PartyDialog({ runtime, account, portraits, open, activity, onClose, onSignIn, watchFriends }: { watchFriends?: () => () => void; runtime: PartyRuntime; account: AccountState; portraits: Record<string, string>; open: boolean; activity: string; onClose: () => void; onSignIn: () => void }) {
  const { party, voice } = runtime, { state, talk } = useParty(runtime);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(''), [privacy, setPrivacy] = useState<PartyPrivacy>('friends');
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) { dialog.current.showModal(); party.refresh(); }
    else if (!open) dialog.current?.close();
  }, [open, party]);
  // Online friends (for invites) are only polled while the dialog is up.
  useEffect(() => (open && account.status === 'signed-in' ? watchFriends?.() : undefined), [open, account.status, watchFriends]);
  // The members see an honest mic flag and what this player is up to.
  useEffect(() => { party.setStatus(talk.enabled && !talk.muted, activity); }, [party, talk.enabled, talk.muted, activity]);
  const group = state.party, me = state.me, signedIn = account.status === 'signed-in';
  const leader = !!group && group.kind === 'party' && group.leaderId === me?.id;
  const friends = (account.friends?.friends ?? []).filter(entry => entry.online && !group?.members.some(member => member.id === entry.profile.id));
  const avatar = (kind: string, label: string): ReactNode => <span className="party-avatar">{portraits[kind] ? <img src={portraits[kind]} alt="" draggable={false} /> : <b aria-hidden="true">{label.slice(0, 1).toUpperCase()}</b>}</span>;
  const row = (entry: PartySummary): ReactNode => <li key={entry.id} className={`party-group${group?.id === entry.id ? ' is-current' : ''}${entry.friendInside ? ' has-friend' : ''}`} data-group={entry.id}>
    <span className="party-group-icon" aria-hidden="true">{entry.kind === 'channel' ? channelIcon(entry.id) : '🎉'}</span>
    <span className="party-group-main"><strong>{entry.name}</strong><small>{entry.kind === 'channel' ? entry.topic : `${entry.leaderName ?? 'Party'} · ${PRIVACY_LABELS[entry.privacy]}`}{entry.names.length ? ` · ${entry.names.join(', ')}` : ''}</small></span>
    <span className="party-group-count">{entry.members}/{entry.maxMembers}</span>
    {group?.id === entry.id ? <em>HERE</em> : <button className="secondary" disabled={!entry.joinable} onClick={() => party.join(entry.id)}>{entry.joinable ? 'Join' : entry.members >= entry.maxMembers ? 'Full' : 'Locked'}</button>}
  </li>;
  const channels = state.directory.filter(entry => entry.kind === 'channel'), parties = state.directory.filter(entry => entry.kind === 'party');
  return <dialog ref={dialog} className="options-dialog party-dialog" aria-labelledby="party-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
    <div className="options-heading"><div><span className="options-brand" aria-hidden="true">SMASH<span>WEB</span></span><h2 id="party-title">PARTY CHAT</h2></div><span className={`party-status status-${state.status}`} role="status">{signedIn ? state.status === 'online' ? '● ONLINE' : state.status === 'connecting' ? 'CONNECTING…' : 'OFFLINE' : 'SIGNED OUT'}</span><button className="secondary" aria-label="Close options" id="party-close" onClick={onClose}>✕</button></div>
    {!open ? null : !signedIn ? <div className="party-signin"><p>Party chat follows your account: join a channel or make a party, and keep talking with the same people across menus, LAN battles, tournaments and Rift runs.</p><button className="primary" id="party-signin" onClick={() => { onClose(); onSignIn(); }}>SIGN IN / REGISTER</button></div> : <div className="party-layout">
      {state.invites.length > 0 && <ul className="party-invites" aria-label="Party invites">{state.invites.map(invite => <li key={invite.id}>{avatar(invite.from.avatar, invite.from.displayName)}<span><strong>{invite.from.displayName}</strong> invites you to <strong>{invite.partyName}</strong></span><button className="primary" onClick={() => party.accept(invite)}>Join</button><button className="secondary" onClick={() => party.dismiss(invite.id)}>Dismiss</button></li>)}</ul>}
      <section className="party-browse" aria-label="Channels and parties">
        <h3>CHANNELS</h3>
        <ul className="party-groups">{channels.map(row)}{!channels.length && <li className="party-empty">{state.status === 'online' ? 'Loading channels…' : 'Connecting to party chat…'}</li>}</ul>
        <h3>PARTIES <small>{parties.length}</small></h3>
        <ul className="party-groups">{parties.map(row)}{!parties.length && <li className="party-empty">No open parties. Start one and invite your friends.</li>}</ul>
        <form className="party-create" onSubmit={event => { event.preventDefault(); if (party.create(name.trim() || `${me?.displayName ?? 'My'}'s party`, privacy)) setName(''); }}>
          <input id="party-name" maxLength={MAX_PARTY_NAME} value={name} placeholder={`${me?.displayName ?? 'My'}'s party`} aria-label="Party name" onChange={event => setName(event.target.value)} />
          <select id="party-privacy" value={privacy} aria-label="Who can join" onChange={event => setPrivacy(event.target.value as PartyPrivacy)}>{PARTY_PRIVACIES.map(value => <option key={value} value={value}>{PRIVACY_LABELS[value]}</option>)}</select>
          <button className="primary" id="party-create" type="submit" disabled={state.status !== 'online'}>＋ Start a party</button>
        </form>
      </section>
      <section className="party-current" aria-label="Current group">
        {group ? <>
          <div className="party-current-head"><span className="party-group-icon" aria-hidden="true">{group.kind === 'channel' ? channelIcon(group.id) : '🎉'}</span><div><h3 id="party-current-name">{group.name}</h3><small>{group.kind === 'channel' ? group.topic : PRIVACY_LABELS[group.privacy]} · {group.members.length}/{group.maxMembers}</small></div>
            {leader && <select id="party-privacy-current" value={group.privacy} aria-label="Who can join this party" onChange={event => party.setPrivacy(event.target.value as PartyPrivacy)}>{PARTY_PRIVACIES.map(value => <option key={value} value={value}>{PRIVACY_LABELS[value]}</option>)}</select>}
            <button className="secondary" id="party-leave" onClick={() => { voice.disable(); party.leave(); }}>Leave</button></div>
          <div className="party-voice">
            {!talk.supported ? <p className="room-error">Voice chat is not supported in this browser.</p> : !talk.enabled ? <><button className="primary" id="party-voice-on" disabled={talk.requesting} onClick={() => void voice.enable()}>{talk.requesting ? 'Requesting mic…' : '🎙 Join voice'}</button><small>{talk.secure ? 'You hear the group once you join voice. Your mic is only used while you are in it.' : 'The mic needs HTTPS or localhost.'}</small></>
              : <><button id="party-mute" className={talk.muted ? 'secondary' : 'primary'} aria-pressed={talk.muted} onClick={() => voice.setMuted(!talk.muted)}>{talk.muted ? '🔇 Unmute mic' : '🎙 Mute mic'}</button>
                <label className="check"><input id="party-ptt" type="checkbox" checked={talk.ptt} onChange={event => voice.setPtt(event.target.checked)} /> Push-to-talk</label>
                {talk.ptt && <button id="party-ptt-hold" className={talk.pttHeld ? 'primary' : 'secondary'} aria-pressed={talk.pttHeld} onPointerDown={() => voice.setPttHeld(true)} onPointerUp={() => voice.setPttHeld(false)} onPointerLeave={() => voice.setPttHeld(false)} onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') voice.setPttHeld(true); }} onKeyUp={() => voice.setPttHeld(false)}>{talk.pttHeld ? 'Talking…' : 'Hold to talk'}</button>}
                <button className="secondary" id="party-voice-off" onClick={() => voice.disable()}>Leave voice</button></>}
            {talk.error && <p className="room-error" role="alert">{talk.error}</p>}
          </div>
          <ul className="party-members" aria-label="Members">{group.members.map(member => {
            const self = member.id === me?.id, peer = talk.peers.find(entry => entry.slot === member.id), speaking = self ? talk.localSpeaking : !!peer?.speaking;
            return <li key={member.id} className={`${speaking ? 'is-speaking' : ''}${self ? ' is-me' : ''}`} data-member={member.id}>
              {avatar(member.avatar, member.name)}
              <span className="party-member-main"><strong>{member.name}{group.leaderId === member.id ? ' ★' : ''}{self ? ' (you)' : ''}</strong><small>{ACTIVITY_LABELS[member.activity] ?? member.activity} · {self ? (talk.enabled ? talk.muted ? 'mic muted' : 'mic on' : 'not in voice') : !member.mic ? 'mic off' : !talk.enabled ? 'in voice' : peer?.connected ? speaking ? 'talking' : 'connected' : 'connecting…'}</small></span>
              {!self && peer && <><input type="range" min={0} max={100} value={Math.round(peer.volume * 100)} aria-label={`Volume for ${member.name}`} onChange={event => voice.setRemoteVolume(member.id, Number(event.target.value) / 100)} /><button className="secondary" aria-pressed={peer.muted} onClick={() => voice.setRemoteMuted(member.id, !peer.muted)}>{peer.muted ? 'Unmute' : 'Mute'}</button></>}
              {leader && !self && <button className="secondary party-kick" aria-label={`Remove ${member.name}`} onClick={() => party.kick(member.id)}>✕</button>}
            </li>;
          })}</ul>
          {group.kind === 'party' && <div className="party-invite-row"><span>INVITE ONLINE FRIENDS</span>{friends.length ? friends.slice(0, 10).map(entry => <button key={entry.profile.id} className="secondary" onClick={() => party.invite(entry.profile.id)}>＋ {entry.profile.displayName}</button>) : <small>No other friends online right now.</small>}</div>}
        </> : <div className="party-idle"><span aria-hidden="true">🎧</span><h3>You are not in a group</h3><p>Hop into a channel to meet people, or start a party for your friends. The group stays with you everywhere in the game — even mid-match.</p><button className="primary" id="party-quick-lobby" disabled={state.status !== 'online'} onClick={() => party.join('#lobby')}>Join the Lobby channel</button></div>}
        {state.notice && <p className="party-notice" role="status">{state.notice}</p>}
      </section>
    </div>}
  </dialog>;
}
