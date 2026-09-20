import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { clampCpuLevel, isCpuLevel } from '../../../lib/game/cpu.ts';
import { MAX_MATCH_PLAYERS } from '../../../lib/game/limits.ts';
import { defaultSeats, type PlayerSeat, type SeatControl } from '../../../lib/game/setup.ts';
import type { FighterKind } from '../../../lib/game/data.ts';
import type { OnlineSession } from './online-session.ts';
import { announcerCue, type PlayView } from './game-session.ts';
import { BattleSelect } from './battle-select.tsx';
import { VoicePanel } from './voice-panel.tsx';
import { fetchRoomList } from '../net/room-client.ts';
import { sameFingerprint, type RoomSummary } from '../../../lib/net/protocol.ts';
import { ROSTER_CHOICES } from '../../../lib/game/roster.ts';

export interface OnlinePanelProps {
  online: OnlineSession; view: PlayView; onBack?: () => void; onNext?: () => void; /** Settings icons at the end of the header. */ system?: ReactNode;
  /** Signed-in display name used as the default player name. */
  defaultName?: string;
  /** Room code to join as soon as the panel can (friend JOIN / invite). */
  autoJoin?: string | null;
  onAutoJoinDone?: () => void;
  /** Online friends strip (web/src/account/account-screens.tsx). */
  friends?: ReactNode;
}

/** Room authorization remains in the client/server; this adapter only exposes
 * editable human ownership and host-owned CPU seats to the shared setup view. */
export function OnlinePanel({ online, view, onBack, onNext, system, defaultName, autoJoin, onAutoJoinDone, friends }: OnlinePanelProps) {
  const state = useSyncExternalStore(online.client.subscribe, online.client.getSnapshot);
  const stats = useSyncExternalStore(online.stats.subscribe, online.stats.getSnapshot);
  const [name, setName] = useState(defaultName || 'Player');
  useEffect(() => { if (defaultName) setName((current) => (current === 'Player' || !current.trim() ? defaultName : current)); }, [defaultName]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeSeat, setActiveSeat] = useState(0);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [roomsError, setRoomsError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (state.slot !== null) setActiveSeat(state.slot); }, [state.slot]);
  const room = state.room;
  const host = room?.hostSlot === state.slot;
  const lobby = room?.phase === 'lobby';
  const refreshRooms = useCallback(async () => {
    setRefreshing(true); setRoomsError('');
    try { setRooms(await fetchRoomList()); }
    catch (error) { setRoomsError(error instanceof Error ? error.message : String(error)); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => {
    if (room || view.mode !== 'lan' || (view.scene !== 'online' && view.scene !== 'characters')) return;
    void refreshRooms();
    const timer = setInterval(() => { void refreshRooms(); }, 5000);
    return () => clearInterval(timer);
  }, [room, view.mode, view.scene, refreshRooms]);
  const enter = async (join: boolean, targetCode?: string) => {
    if (busy) return;
    setBusy(true); setError(''); online.game.cue('confirm');
    try {
      if (!name.trim()) throw new Error('Choose a player name.');
      const finalCode = (targetCode ?? code).trim().toUpperCase();
      if (join && !/^[A-Z2-9]{6}$/u.test(finalCode)) throw new Error('Enter the six-character room code.');
      if (join) setCode(finalCode);
      await online.connect();
      const sent = join
        ? online.client.join({ code: finalCode, name: name.trim(), fingerprint: online.game.fingerprint })
        : online.client.create({ name: name.trim(), fingerprint: online.game.fingerprint });
      if (!sent) throw new Error('The room connection is not ready.');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!autoJoin || room || busy || !view.ready || view.mode !== 'lan') return;
    onAutoJoinDone?.();
    void enter(true, autoJoin);
  }, [autoJoin, room, busy, view.ready, view.mode]);
  if (view.mode !== 'lan' || (view.scene !== 'online' && view.scene !== 'characters')) return null;
  const seats: PlayerSeat[] = defaultSeats().map(seat => {
    const player = room?.players.find(player => player.slot === seat.slot);
    return { slot: seat.slot, fighter: player?.fighter ?? seat.fighter, control: player ? player.control ?? 'human' : 'off', level: clampCpuLevel(player?.level), costume: player?.costume ?? 0 };
  });
  const canEdit = (slot: number, field: 'fighter' | 'control') => {
    if (!lobby) return false;
    const seat = seats[slot]!;
    return field === 'control' ? !!host && seat.control !== 'human' : slot === state.slot || (!!host && seat.control === 'cpu');
  };
  const choose = (slot: number, fighter: FighterKind) => {
    if (!canEdit(slot, 'fighter')) return;
    const supported = ROSTER_CHOICES.find(kind => kind === fighter);
    if (!supported) { setError('This fighter is not available in the current room build.'); return; }
    if (slot === state.slot) online.client.choose(supported, seats[slot]!.costume);
    else online.client.setCpu(slot, supported, seats[slot]!.level, seats[slot]!.costume);
    online.game.cue(announcerCue(fighter));
  };
  const costume = (slot: number, index: number) => {
    if (!canEdit(slot, 'fighter')) return;
    const seat = seats[slot]!;
    const supported = ROSTER_CHOICES.find(kind => kind === seat.fighter);
    if (!supported) { setError('This fighter is not available in the current room build.'); return; }
    if (slot === state.slot) online.client.choose(supported, index);
    else online.client.setCpu(slot, supported, seat.level, index);
    online.game.cue('select');
  };
  const control = (slot: number, kind: SeatControl) => {
    if (!canEdit(slot, 'control') || kind === 'human') return;
    if (kind !== 'cpu') { online.client.setCpu(slot, null); return; }
    const supported = ROSTER_CHOICES.find(fighter => fighter === seats[slot]!.fighter);
    if (!supported) { setError('This fighter is not available in the current room build.'); return; }
    online.client.setCpu(slot, supported, seats[slot]!.level);
  };
  const level = (slot: number, value: number) => {
    const seat = seats[slot]!;
    if (!canEdit(slot, 'control') || seat.control !== 'cpu' || !isCpuLevel(value)) return;
    const supported = ROSTER_CHOICES.find(fighter => fighter === seat.fighter);
    if (supported) online.client.setCpu(slot, supported, value);
  };
  const me = room?.players.find(player => player.slot === state.slot);
  const alert = <p className="room-error" role="alert">{error || state.error?.message || stats.error}</p>;
  const status = state.lastEnd?.message || (room && lobby ? 'Choose fighters and Human/CPU seats, then select the stage. Every human marks Ready before the host starts.' : stats.status);
  if (room) {
    // The room IS the character select: room code rides in the header, room tools in the footer.
    return <section className="online-scene battle-online play-screen-host" aria-label="LAN battle setup">
      <BattleSelect seats={seats} activeSeat={activeSeat} onActiveSeat={setActiveSeat} onFighter={choose} onCostume={costume} onControl={control} onLevel={level} canEdit={canEdit} mode="lan" portraits={view.portraits} stocks={room.rules.stocks} seconds={room.rules.timeSeconds} ready={view.ready} busy={busy || view.loading} onRules={host && lobby ? patch => online.client.updateRules({ ...room.rules, ...(patch.stocks === undefined ? {} : { stocks: patch.stocks }), ...(patch.seconds === undefined ? {} : { timeSeconds: patch.seconds }) }) : undefined} onBack={onBack} onNext={lobby ? onNext : undefined} seatNames={Object.fromEntries(room.players.map(player => [player.slot, player.name]))} readySlots={room.players.filter(player => player.ready).map(player => player.slot)}
        headerAside={<RoomChip code={room.code} detail={`${room.players.length}/${MAX_MATCH_PLAYERS} players · ${room.phase}`} status={state.status} />}
        footerStart={<div className="room-tools"><button className="secondary" onClick={() => online.leave()}>Leave room</button>{online.voice && <ScreenPopover id="room-voice-toggle" label="🎙 VOICE" title="Voice chat">{<VoicePanel voice={online.voice} compact />}</ScreenPopover>}{friends && <ScreenPopover id="room-friends-toggle" label="👥 FRIENDS" title="Friends">{friends}</ScreenPopover>}</div>}
        note={status} alert={alert}
        footer={state.spectator ? <span className="network-status" id="lan-spectating">👁 SPECTATING{room.spectators ? ` · ${room.spectators} watching` : ''}</span> : lobby ? <button id="lan-ready" className={me?.ready ? 'secondary ready-button' : 'battle-next ready-button'} disabled={!view.ready || busy} onClick={() => { online.game.cue('confirm'); online.setReady(!me?.ready && !stats.preparing); }}>{stats.preparing && !me?.ready ? 'Loading…' : me?.ready ? 'Not ready' : 'Ready'}</button> : <button className="secondary" onClick={() => online.returnToLobby()}>Return to lobby</button>} />
    </section>;
  }
  // Gateway: create / join on the left, the live open-room browser on the right; one viewport, no scroll.
  return <section className="online-scene battle-online play-screen play-screen-lan" aria-labelledby="online-title">
    <header className="battle-select-heading"><div className="battle-logo"><h2 id="online-title">MULTIPLAYER</h2></div><div className="battle-rule-title">CONNECT YOUR BROWSERS</div>{onBack && <button className="battle-back" id="back-to-mode" onClick={onBack}>◀ BACK</button>}{system}</header>
    <div className="play-screen-body lan-gateway-body">
      <div className="room-gateway">
        <div className="room-gateway-intro"><span className="room-gateway-mark" aria-hidden="true">VS</span><p>Up to {MAX_MATCH_PLAYERS} humans and CPUs. Each human joins from their own browser; the host fills empty seats with CPUs.</p></div>
        <div className="room-entry">
          <label className="room-entry-name">YOUR NAME<input id="player-name" maxLength={32} value={name} onChange={event => setName(event.target.value)} autoComplete="nickname" /></label>
          <div className="room-entry-action room-entry-create"><button className="battle-next" disabled={!view.ready || busy} onClick={() => void enter(false)}>Create room</button><small>Host a new room · share its code</small></div>
          <span className="or-divider">OR</span>
          <div className="room-entry-action room-entry-join"><label>ROOM CODE<input id="room-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} placeholder="ABC234" /></label><button className="battle-next" disabled={!view.ready || busy} onClick={() => void enter(true)}>Join room</button></div>
        </div>
        {friends}
      </div>
      <div className="room-browser" id="room-browser" aria-label="Available rooms">
        <div className="room-browser-heading"><span>OPEN ROOMS{rooms ? ` (${rooms.length})` : ''}</span><button id="room-refresh" className="secondary" disabled={refreshing} onClick={() => void refreshRooms()}>{refreshing ? 'Refreshing…' : '↻ Refresh'}</button></div>
        {roomsError ? <p className="room-browser-error" role="alert">{roomsError}</p>
          : rooms === null ? <p className="room-browser-empty" role="status"><span aria-hidden="true">📡</span>Looking for open rooms…</p>
          : rooms.length === 0 ? <div className="room-browser-empty" role="status"><span aria-hidden="true">📡</span><p>No open rooms right now. Create one and it shows up here for everyone on the network.</p>
            <ol className="room-steps" aria-label="How a LAN battle works"><li><b>1</b><span><strong>Create a room</strong><small>You host it; its code shows in the header.</small></span></li><li><b>2</b><span><strong>Friends join</strong><small>Pick it from this list or type the code.</small></span></li><li><b>3</b><span><strong>Ready up</strong><small>Everyone picks a fighter, the host picks the stage and starts.</small></span></li></ol></div>
          : <ul className="room-list">{rooms.map(summary => {
            const full = summary.players >= summary.maxPlayers;
            const compatible = sameFingerprint(summary.fingerprint, online.game.fingerprint);
            return <li key={summary.code} className="room-row" data-room={summary.code}>
              <div className="room-row-main"><strong>{summary.code}</strong><span>{summary.hostName || 'Host'} · {summary.humans} human{summary.humans === 1 ? '' : 's'} · {summary.players}/{summary.maxPlayers} seats · {summary.rules.stage} · {summary.rules.stocks} stock{summary.rules.stocks === 1 ? '' : 's'}</span>{!compatible && <span className="room-incompatible">Different version</span>}{full && <span className="room-full">Full</span>}</div>
              <button id={`join-room-${summary.code}`} className="battle-next" disabled={!view.ready || busy || full} onClick={() => void enter(true, summary.code)}>Join</button>
            </li>;
          })}</ul>}
      </div>
      <div className="play-screen-alert">{alert}</div>
    </div>
    <footer className="play-screen-foot lan-foot"><p className="network-status" role="status">{status}</p><p className="lan-warning">Trusted LAN only. Connected humans own their fighters; everyone must be ready before the host starts.</p></footer>
  </section>;
}

/** Room code + connection chip for the LAN room and LAN stage headers. */
export function RoomChip({ code, detail, status }: { code: string; detail: ReactNode; status?: string }) {
  return <div className="room-chip" title="Trusted LAN only. The host may fill empty seats with the training CPU; connected humans own their fighters.">
    <span className="room-chip-label">ROOM</span><strong id="active-room-code">{code}</strong><span className="room-chip-detail">{detail}</span>{status && <span className="connection-state">{status.toUpperCase()}</span>}
  </div>;
}

/** Footer button that opens a small panel above it (voice, friends) without taking screen space. */
function ScreenPopover({ id, label, title, children }: { id: string; label: ReactNode; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    const outside = (event: PointerEvent): void => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside, true); };
  }, [open]);
  return <div className="screen-popover" ref={box}>
    <button id={id} className="secondary screen-popover-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>{label}</button>
    {open && <div className="screen-popover-panel" role="group" aria-label={title}>{children}</div>}
  </div>;
}

export function NetworkTelemetry({ online }: { online: OnlineSession }) {
  const state = useSyncExternalStore(online.client.subscribe, online.client.getSnapshot);
  const stats = useSyncExternalStore(online.stats.subscribe, online.stats.getSnapshot);
  if (!state.room) return null;
  return <><NetworkNotice online={online} /><aside className="network-telemetry" aria-label="Network statistics"><strong>ROOM {state.room.code}</strong><span>RTT ≈ {state.latencyMs === null ? '—' : Math.round(state.latencyMs * 2)} ms</span><span>Delay {stats.inputDelay}f</span><span>Prediction {stats.predictionFrames}/8 frames</span><span>Rollbacks {stats.rollbacks}</span><span>Confirmed {stats.confirmedFrame}</span><span>{stats.status}</span><button className="secondary" onClick={() => online.returnToLobby()}>Return to lobby</button></aside>{online.voice && <VoicePanel voice={online.voice} compact />}</>;
}

/** Why a running match is frozen: this browser is reconnecting or catching up, or the relay is
 * holding another human's seat. The countdown follows the relay's own grace deadline. */
function NetworkNotice({ online }: { online: OnlineSession }) {
  const state = useSyncExternalStore(online.client.subscribe, online.client.getSnapshot);
  const stats = useSyncExternalStore(online.stats.subscribe, online.stats.getSnapshot);
  const [, tick] = useState(0);
  const away = state.room?.phase === 'playing' ? state.room.players.filter(player => player.connected === false && player.slot !== state.slot) : [];
  const busy = state.status === 'reconnecting' || stats.catchUp !== null || away.length > 0;
  useEffect(() => { if (!busy) return; const timer = setInterval(() => tick(value => value + 1), 500); return () => clearInterval(timer); }, [busy]);
  if (!busy || (!state.match && state.status !== 'reconnecting')) return null;
  const left = state.room?.graceEndsAt === undefined ? null : Math.max(0, Math.ceil((state.room.graceEndsAt - online.client.serverNow()) / 1000));
  const title = state.status === 'reconnecting' ? 'CONNECTION LOST' : stats.catchUp !== null ? 'REJOINING THE MATCH' : 'MATCH ON HOLD';
  const detail = state.status === 'reconnecting' ? 'Reconnecting to the room… your seat is being held.'
    : stats.catchUp !== null ? `Catching up with the match… ${Math.floor(stats.catchUp * 100)}%`
    : `Waiting for ${away.map(player => player.name).join(', ')} to come back${left === null ? '…' : ` · ${left}s`}`;
  return <aside className="network-notice" id="network-notice" role="status" aria-live="polite">
    <strong>{title}</strong><span>{detail}</span>
    {stats.catchUp !== null && <span className="network-notice-bar" aria-hidden="true"><i style={{ width: `${Math.floor(stats.catchUp * 100)}%` }} /></span>}
    <button className="secondary" onClick={() => (state.status === 'reconnecting' ? online.leave() : online.returnToLobby())}>{state.status === 'reconnecting' ? 'Give up' : 'End match'}</button>
  </aside>;
}
