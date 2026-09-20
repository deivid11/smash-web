import { useSyncExternalStore } from 'react';
import type { VoiceClient } from '../net/voice-client.ts';

/** Experimental LAN-only mesh voice. P2P Opus audio; signaling only via the
 * central relay. Never touches simulation, rollback, hashes or match flow. */
export function VoicePanel({ voice, compact }: { voice: VoiceClient; compact?: boolean }) {
  const state = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  if (!state.supported) {
    return <p className="network-status" role="status">Voice chat is not supported in this browser.</p>;
  }
  if (!state.enabled) {
    return <section className={compact ? 'voice-panel voice-compact' : 'voice-panel'} aria-label="Voice chat">
      <div className="voice-heading">
        <strong>VOICE CHAT · EXPERIMENTAL</strong>
        <span>P2P mesh · 2–8 browsers · trusted LAN only</span>
      </div>
      {!state.secure && <p className="room-error" role="alert">Mic needs HTTPS or localhost. LAN http IPs block getUserMedia — voice stays off.</p>}
      <button
        className="secondary"
        disabled={state.requesting}
        onClick={() => void voice.enable()}
      >
        {state.requesting ? 'Requesting mic…' : 'Enable voice'}
      </button>
      {state.error && <p className="room-error" role="alert">{state.error}</p>}
      {!compact && <p className="network-status" role="status">Off by default. Enable to talk; mute anytime. Voice never pauses or affects the match.</p>}
    </section>;
  }
  return <section className={compact ? 'voice-panel voice-compact' : 'voice-panel'} aria-label="Voice chat">
    <div className="voice-heading">
      <strong>VOICE {state.localSpeaking ? '· TALKING' : ''}</strong>
      <span>{state.peers.length} peer{state.peers.length === 1 ? '' : 's'} · mesh P2P</span>
    </div>
    <div className="voice-controls">
      <button
        id={compact ? 'voice-mute-compact' : 'voice-mute'}
        className={state.muted ? 'secondary' : 'battle-next'}
        onClick={() => voice.setMuted(!state.muted)}
        aria-pressed={state.muted}
      >
        {state.muted ? 'Unmute mic' : 'Mute mic'}
      </button>
      <label className="check">
        <input type="checkbox" checked={state.ptt} onChange={event => voice.setPtt(event.target.checked)} />
        Push-to-talk
      </label>
      {state.ptt && <button
        id={compact ? 'voice-ptt-compact' : 'voice-ptt'}
        className={state.pttHeld ? 'battle-next' : 'secondary'}
        onPointerDown={() => voice.setPttHeld(true)}
        onPointerUp={() => voice.setPttHeld(false)}
        onPointerLeave={() => voice.setPttHeld(false)}
        onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') voice.setPttHeld(true); }}
        onKeyUp={() => voice.setPttHeld(false)}
        aria-pressed={state.pttHeld}
      >
        {state.pttHeld ? 'Talking…' : 'Hold to talk'}
      </button>}
      <button className="secondary" onClick={() => voice.disable()}>Turn off</button>
    </div>
    {state.peers.length === 0
      ? <p className="network-status" role="status">No other voice peers yet. Others enable voice from the same room.</p>
      : <ul className="voice-list" aria-label="Voice peers">
        {state.peers.map(peer => <li key={peer.slot} className={peer.speaking ? 'is-speaking' : ''} data-slot={peer.slot}>
          <span className="voice-peer-name">P{peer.slot + 1} · {peer.name}</span>
          <span className="voice-peer-state">{peer.speaking ? 'Speaking' : peer.connected ? 'Connected' : 'Connecting…'}</span>
          <label className="voice-volume">Vol
            <input
              type="range" min={0} max={100} value={Math.round(peer.volume * 100)}
              onChange={event => voice.setRemoteVolume(peer.slot, Number(event.target.value) / 100)}
              aria-label={`Volume for player ${peer.slot + 1}`}
            />
          </label>
          <button className="secondary" onClick={() => voice.setRemoteMuted(peer.slot, !peer.muted)} aria-pressed={peer.muted}>
            {peer.muted ? 'Unmute' : 'Mute'}
          </button>
        </li>)}
      </ul>}
    {state.error && <p className="room-error" role="alert">{state.error}</p>}
  </section>;
}
