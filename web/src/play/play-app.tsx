import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { announcerCue, GameSession } from './game-session.ts';
import type { FighterKind } from '../../../lib/game/data.ts';
import { OnlineSession } from './online-session.ts';
import { ModeSelect } from './mode-select.tsx';
import { RouletteSetup } from './roulette-setup.tsx';
import { GRAPHICS_PRESETS, GRAPHICS_QUALITIES, type GraphicsMode } from '../render/graphics-quality.ts';
import { CAMERA_SHAKE_LEVELS, type CameraShakeLevel } from '../render/camera-shake.ts';
import { VISUAL_EFFECTS, effectEnabled, isEffectDefault, type VisualEffectChoice } from '../render/visual-effects.ts';
import { RUMBLE_LEVELS, type RumbleLevel } from '../../../lib/game/rumble.ts';
import { BattleSelect } from './battle-select.tsx';
import { StageSelect } from './selection-scenes.tsx';
import { activeSeats } from '../../../lib/game/setup.ts';
import { MatchHeader, MatchHud, ArenaOverlay, PerfOverlay } from './match-hud.tsx';
import { GameActions, PauseButton, AudioSettings, DebugSettings, StorageSettings, AppUpdateSettings, TouchControls, FallLogPanel } from './controls.tsx';
import { Credits } from '../credits.tsx';
import { NetworkTelemetry, OnlinePanel, RoomChip } from './online-panel.tsx';
import { useFullscreen } from './fullscreen.ts';
import { hasNativeBridge } from '../android-bridge.ts';
import { ControllerPanel } from './controller-panel.tsx';
import { SystemMenu } from './system-menu.tsx';
import { RogueController, type RogueSettings } from './roguelike-session.ts';
import { handSurface, useGamepadMenuNav } from './gamepad-menu.ts';
import { useMenuHands } from './menu-hands.ts';
import { RogueBlessing, RogueEnd, RogueEvent, RogueIntro, RogueMap, RoguePreparing, RogueReward, RogueRest, RogueSetup, RogueShop, RogueSpoils } from './roguelike-scenes.tsx';
import { RogueBossBar, RogueFxLayer, RoguePockets, RogueRunHud } from './roguelike-hud.tsx';
import { RoguePauseRun } from './roguelike-run-screen.tsx';
import type { ConsumableId } from '../../../lib/game/roguelike/consumables.ts';
import type { LocalControllerCount } from '../input/controller-hub.ts';
import { CUSTOM_PRESENTATIONS } from '../../../lib/custom/registry.ts';
import type { SuspendedRun } from '../../../lib/game/roguelike/suspend.ts';
import { accountClient } from '../account/account-client.ts';
import { matchReport, riftReport } from '../account/game-report.ts';
import { onRunFinished } from './roguelike-session.ts';
import { readPlayersLink, usePlayersRoute } from '../account/players-route.ts';
import { PartyClient } from '../net/party-client.ts';
import { VoiceClient } from '../net/voice-client.ts';
import { PartyChip, PartyDialog, PartyOverlay, type PartyRuntime } from './party-panel.tsx';
import { TournamentController } from './tournament/controller.ts';
import { TournamentRibbon, TournamentScreens } from './tournament/tournament-screens.tsx';
import { AccountEntry, AccountScreens, InviteToast, LanFriendsStrip, useAccount, type AccountScreenName } from '../account/account-screens.tsx';

import { DiscGateOverlay } from './disc-gate.tsx';
import { KeyboardPanel } from './keyboard-panel.tsx';
import type { PlayInput } from '../play-input.ts';
import { analyticsEnabled, setAnalyticsEnabled, trackVisit } from '../analytics/visits.ts';

/** Options → Keyboard. Expanded while no controller is connected; one click away otherwise. */
function KeyboardSettings({ input, players }: { input: PlayInput; players: 1 | 2 }) {
  const controllers = useSyncExternalStore(input.controllers.subscribe, input.controllers.getSnapshot, input.controllers.getSnapshot);
  return <KeyboardPanel input={input} open={controllers.devices.length === 0} players={players} />;
}

/** Options → Privacy: the player's switch for usage statistics. */
function PrivacySettings() {
  const [enabled, setEnabled] = useState(analyticsEnabled);
  return <>
    <label className="check"><input type="checkbox" id="usage-statistics" checked={enabled} onChange={event => { setAnalyticsEnabled(event.target.checked); setEnabled(event.target.checked); }} /> Share usage statistics</label>
    <p className="options-note privacy-note">Helps this fan project know how many people play and what they use. It only counts general things: that a visit happened, the kind of device, browser and screen, language and time zone, which site linked you here, how long the game took to load, and which modes, stages and fighters get played. Visits are told apart by a random visitor number kept in this browser. It never includes your name, account, e-mail, chat, voice, controller inputs, error text or anything from your disc, and your raw IP address is never stored. Turn it off and nothing more is sent from this browser and its visitor number is deleted; statistics the host already stored are not removed by this switch.</p>
  </>;
}

let instance = 0;
/** Fullscreen boot loading screen: brand, phase message and a real completion bar. */
export function LoadingOverlay({ progress, fraction }: { progress: string; fraction: number }) {
  const percent = Math.max(0, Math.min(100, Math.round((Number.isFinite(fraction) ? fraction : 0) * 100)));
  return <div className="loading-overlay" role="status" aria-live="polite">
    <span className="loading-brand" aria-hidden="true">SMASH<span>WEB</span></span>
    <p className="loading-title">LOADING ASSETS</p>
    <div className="loading-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Loading progress">
      <span className="loading-fill" style={{ width: `${percent}%` }} />
    </div>
    <p className="loading-percent">{percent}%</p>
    <p className="loading-detail">{progress}</p>
  </div>;
}

export function PlayRoot() {
  const [runtime, setRuntime] = useState<{ game: GameSession; online: OnlineSession; id: number } | null>(null);
  useEffect(() => {
    const game = new GameSession(), online = new OnlineSession(game), previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; setRuntime({ game, online, id: ++instance });
    const stopTracking = trackVisit(game);
    const dispose = () => { stopTracking(); online.dispose(); game.dispose(); };
    window.addEventListener('pagehide', dispose, { once: true });
    return () => { window.removeEventListener('pagehide', dispose); dispose(); document.body.style.overflow = previousOverflow; };
  }, []);
  return runtime ? <PlayApp key={runtime.id} session={runtime.game} online={runtime.online} /> : <p role="status">Preparing the game…</p>;
}
function PlayApp({ session, online }: { session: GameSession; online: OnlineSession }) {
  const view = useSyncExternalStore(session.ui.subscribe, session.ui.getSnapshot);
  const network = useSyncExternalStore(online.client.subscribe, online.client.getSnapshot), room = network.room;
  const netStats = useSyncExternalStore(online.stats.subscribe, online.stats.getSnapshot);
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null), options = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(false);
  const [, setRogueRev] = useState(0);
  const [rogueSetup, setRogueSetup] = useState(false);
  const rogueRef = useRef<RogueController | null>(null);
  const rogue = rogueRef.current;
  // Accounts: profile / friends screens replace the current menu; friend JOINs land in the LAN panel.
  const account = accountClient();
  const accountState = useAccount(account);
  // PLAYERS screens follow the address bar: /players and /players/<username>.
  const [accountScreen, setAccountScreen] = useState<AccountScreenName | null>(() => (readPlayersLink() ? 'players' : null));
  const [viewedPlayer, setViewedPlayer] = useState<string | null>(() => readPlayersLink()?.username ?? null);
  usePlayersRoute(accountScreen === 'players' ? { username: viewedPlayer } : null, (link) => { setAccountScreen(link ? 'players' : null); setViewedPlayer(link?.username ?? null); });
  // Game history: every finished match and Rift run of a signed-in player lands on their public profile.
  useEffect(() => session.onMatchEnded((ended) => {
    const players = online.client.getSnapshot().room?.players ?? [];
    const report = matchReport(ended.mode === 'lan' ? { ...ended, fighters: ended.fighters.map(fighter => ({ ...fighter, name: fighter.cpu ? fighter.name : players.find(player => player.slot === fighter.seatId)?.name ?? fighter.name })) } : ended);
    if (report) account.reportGame(report);
  }), [session, online, account]);
  useEffect(() => onRunFinished((run) => account.reportGame(riftReport(run))), [account]);
  const [pendingJoin, setPendingJoin] = useState<string | null>(null);
  const resumeAfterOptions = useRef(false), focusControllers = useRef(false);
  // Party chat is global: one socket + one voice mesh for the page, whatever scene is up.
  const partyRuntime = useState<PartyRuntime>(() => { const party = new PartyClient({ token: () => account.sessionToken }); return { party, voice: new VoiceClient(party) }; })[0];
  const [partyOpen, setPartyOpen] = useState(false);
  useEffect(() => () => { partyRuntime.voice.dispose(); partyRuntime.party.dispose(); }, [partyRuntime]);
  useEffect(() => { partyRuntime.party.sync(); if (accountState.status !== 'signed-in') partyRuntime.voice.disable(); }, [partyRuntime, accountState.status, accountState.account?.id]);
  // One microphone at a time: joining party voice leaves room voice and the other way round.
  useEffect(() => {
    let room = online.voice.getSnapshot().enabled, group = partyRuntime.voice.getSnapshot().enabled;
    const offRoom = online.voice.subscribe(() => { const now = online.voice.getSnapshot().enabled; if (now && !room) partyRuntime.voice.disable(); room = now; });
    const offGroup = partyRuntime.voice.subscribe(() => { const now = partyRuntime.voice.getSnapshot().enabled; if (now && !group) online.voice.disable(); group = now; });
    return () => { offRoom(); offGroup(); };
  }, [online, partyRuntime]);
  // Tournaments: the controller outlives its screens (arena and LAN room unmount them).
  const joinRoomRef = useRef<(code: string) => void>(() => undefined);
  const tourney = useState(() => new TournamentController(session, online, account, code => joinRoomRef.current(code)))[0];
  const tourneyUi = useSyncExternalStore(tourney.store.subscribe, tourney.store.getSnapshot);
  useEffect(() => () => tourney.dispose(), [tourney]);
  const { fullscreen, error: fullscreenError, toggle: toggleFullscreen } = useFullscreen(root);
  useGamepadMenuNav(root, session);
  useMenuHands(root, session, () => openSettings());
  const arenaView = view.scene === 'arena', lanMode = view.mode === 'lan';
  const localHumans = session.localHumans;
  const host = !!room && room.hostSlot === network.slot;
  const me = room?.players.find(player => player.slot === network.slot);
  const allReady = !!room && room.players.length >= 2 && room.players.every(player => player.control === 'cpu' || player.ready);
  const lobby = room?.phase === 'lobby';
  useEffect(() => { if (canvas.current) void session.boot(canvas.current); }, [session]);
  useEffect(() => {
    if (view.mode !== 'lan' || view.active) return;
    if (room && view.scene === 'online') session.scene('characters');
    else if (!room && view.scene === 'stages') session.scene('online');
  }, [session, room, view.mode, view.active, view.scene]);
  // Follow-the-host: only the host can change the stage (server-enforced), so
  // a stage change means the host picked one — bring every browser still on
  // the setup screens to the stage screen with them.
  const followedStage = useRef<string | null>(null);
  useEffect(() => {
    if (!room) { followedStage.current = null; return; }
    if (view.mode !== 'lan' || view.active || room.phase !== 'lobby') { followedStage.current = room.rules.stage; return; }
    if (followedStage.current === null) { followedStage.current = room.rules.stage; return; }
    if (followedStage.current !== room.rules.stage) {
      followedStage.current = room.rules.stage;
      if (view.scene === 'characters' || view.scene === 'online') session.scene('stages');
    }
  }, [session, room, view.mode, view.active, view.scene]);
  useEffect(() => {
    if (settings && options.current && !options.current.open) options.current.showModal();
    else if (!settings) options.current?.close();
    if (settings && focusControllers.current) {
      const frame = requestAnimationFrame(() => options.current?.querySelector('.controller-panel')?.scrollIntoView({ block: 'start' }));
      return () => cancelAnimationFrame(frame);
    }
  }, [settings]);
  const openSettings = (controllers = false) => {
    focusControllers.current = controllers;
    resumeAfterOptions.current = view.active && !view.paused && !session.online;
    if (resumeAfterOptions.current) session.pause(true);
    if (session.input) { session.input.clear(); session.input.enabled = false; }
    setSettings(true);
  };
  const closeSettings = () => {
    setSettings(false);
    if (resumeAfterOptions.current) session.pause(false);
    else if (session.input && view.active && !view.paused) session.input.enabled = true;
    resumeAfterOptions.current = false;
    if (arenaView) session.focus();
  };
  useEffect(() => {
    const hub = session.input?.controllers; if (!hub) return;
    // Smash-style Start: pause / resume a local match (L+R+A+Start while paused
    // quits to fighters), READY TO FIGHT on character/stage select (the hands
    // own that press), options everywhere else and online.
    hub.onMenu = () => {
      if (settings) { closeSettings(); return; }
      if (root.current && handSurface(root.current)) return;
      const current = session.ui.getSnapshot();
      if (current.scene === 'arena' && current.active && !current.ended && !session.online) {
        if (current.paused && hub.menuPads().some(pad => pad.leftTrigger && pad.rightTrigger && pad.confirm)) session.changeFighters();
        else session.pause();
        return;
      }
      openSettings();
    };
    return () => { hub.onMenu = undefined; };
  }, [session, settings, view.ready, view.active, view.paused, arenaView]);
  const goHome = () => { if (room || session.online) online.leave(); rogueRef.current?.release(); rogueRef.current = null; setRogueSetup(false); setRogueRev(value => value + 1); session.home(); };
  const startRogue = (config: RogueSettings) => { rogueRef.current?.release(); rogueRef.current = new RogueController(config); setRogueSetup(false); session.cue('confirm'); setRogueRev(value => value + 1); };
  const leaveRogue = () => { rogueRef.current?.release(); rogueRef.current = null; setRogueSetup(false); setRogueRev(value => value + 1); if (!session.online) session.changeFighters(); };
  const fightRogueFloor = () => { if (rogueRef.current?.startFloor(session)) session.cue('confirm'); else session.cue('back'); setRogueRev(value => value + 1); };
  const useRogueConsumable = (id: ConsumableId) => { const rogue = rogueRef.current; if (!rogue) return; try { rogue.useConsumable(session, id); session.cue('select'); } catch { session.cue('back'); } setRogueRev(value => value + 1); };
  const abandonRogue = () => { const current = rogueRef.current; if (!current) return; current.release(); current.abandon(); session.cue('back'); setRogueRev(value => value + 1); };
  const shopRogue = (fn: (rogue: RogueController) => void) => { const rogue = rogueRef.current; if (!rogue) return; try { rogue.floorError = ''; fn(rogue); session.cue('confirm'); } catch (error) { rogue.floorError = error instanceof Error ? error.message : String(error); session.cue('back'); } setRogueRev(value => value + 1); };
  const retryRogueSeed = () => { const current = rogueRef.current; if (!current) return; current.release(); rogueRef.current = new RogueController({ fighter: current.run.playerFighter, seedLabel: current.run.seedLabel, length: current.plan.length, difficulty: current.plan.difficulty, heat: current.run.heat, relics: current.run.relics.map((relic) => relic.id), aspect: current.run.aspect?.id }); session.cue('confirm'); setRogueRev(value => value + 1); };
  const newRogueSeed = () => { rogueRef.current = null; setRogueSetup(true); setRogueRev(value => value + 1); };
  const previewRogueFighter = (kind: FighterKind) => { session.cue(announcerCue(kind)); };
  useEffect(() => {
    const controller = rogueRef.current;
    if (!controller || controller.run.phase !== 'fight' || !view.ended || view.paused || session.online) return;
    if (controller.resolveMatch(session) === null) return;
    // Back from the shared arena to the rogue screen for the spoils.
    session.scene('rogue');
    setRogueRev(value => value + 1);
  }, [session, view.ended, view.paused, view.scene, rogue?.run.phase]);
  // The run is already saved after every step: quitting only drops the live controller.
  const saveQuitRogue = () => { rogueRef.current?.release(); rogueRef.current = null; setRogueSetup(true); session.cue('back'); setRogueRev(value => value + 1); };
  const resumeRogue = (saved: SuspendedRun) => { rogueRef.current?.release(); const next = RogueController.resume(saved); if (!next) { session.cue('back'); return; } rogueRef.current = next; setRogueSetup(false); session.cue('confirm'); setRogueRev(value => value + 1); };
  const openAccount = () => { session.cue('confirm'); setAccountScreen(accountState.status === 'signed-in' ? 'profile' : 'signin'); };
  const joinFriendRoom = (code: string) => {
    setAccountScreen(null);
    if (room?.code === code || view.active || session.online) return;
    rogueRef.current?.release(); rogueRef.current = null; setRogueSetup(false); setRogueRev(value => value + 1);
    if (room) online.leave();
    if (!lanMode) session.chooseMode('lan');
    setPendingJoin(code);
  };
  joinRoomRef.current = joinFriendRoom;
  // A local bracket set ended: record it and come back to the tournament for the result.
  useEffect(() => {
    if (tourneyUi.playing?.scope !== 'local' || session.online) return;
    if (!view.active && !view.ended && tourneyUi.playing.sawActive && view.scene !== 'arena') { tourney.abandonLocal(); if (view.scene !== 'tournament') session.tournamentMenu(); return; }
    if (view.paused) return;
    const timer = setTimeout(() => { if (tourney.trackLocal(view.active, view.ended)) session.tournamentMenu(); }, view.ended ? 2600 : 0);
    return () => clearTimeout(timer);
  }, [session, tourney, tourneyUi.playing, view.active, view.ended, view.paused, view.scene]);
  // Presence for friends lists: what this player is doing and which LAN room they are in.
  useEffect(() => {
    account.setActivity(lanMode ? 'lan' : view.scene === 'rogue' || (!!rogue && view.active) ? 'rift' : view.active ? 'local' : 'menu', lanMode ? room?.code ?? null : null);
  }, [account, lanMode, room?.code, view.scene, view.active, rogue]);
  // Cloud progress replaced this device's Rift save: drop a stale run screen (never a live fight).
  useEffect(() => {
    const current = rogueRef.current;
    if (accountState.epoch === 0 || !current || current.run.phase === 'fight') return;
    current.release(); rogueRef.current = null;
    if (view.scene === 'rogue') setRogueSetup(true);
    setRogueRev(value => value + 1);
  }, [accountState.epoch]);
  const toCharacters = () => { if (lanMode && room) online.setReady(false); session.scene('characters'); };
  // The Android shell already runs immersive fullscreen and its WebView rejects
  // the Fullscreen API ("not allowed"), so the toggle only exists in browsers.
  const fullscreenButton = hasNativeBridge() ? null : <button id="fullscreen-toggle" className="icon-action" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-pressed={fullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => void toggleFullscreen()}><span aria-hidden="true">{fullscreen ? '⊡' : '⛶'}</span><span className="action-label">{fullscreen ? 'Window' : 'Fullscreen'}</span></button>;
  // Local play keeps the live arena to a single pause button: the whole match
  // menu (rematch / fighters / toggles / options / fullscreen) lives in the
  // Melee-style pause overlay instead. Online keeps the classic bar, and the
  // results screen keeps it too, since pausing is unavailable in both.
  const inPauseMenu = arenaView && view.paused && !session.online;
  const compactActions = arenaView && view.active && !view.paused && !view.ended && !session.online;
  const openParty = () => { session.cue('confirm'); if (settings) closeSettings(); setPartyOpen(true); };
  const partyActivity = lanMode ? 'lan' : view.scene === 'tournament' || tourneyUi.playing ? 'tourney' : view.scene === 'rogue' || (!!rogue && view.active) ? 'rift' : view.active ? 'local' : 'menu';
  const systemMenu = (variant: 'home' | 'header') => <SystemMenu session={session} ready={view.ready} variant={variant} onOptions={() => openSettings()} onControllers={() => openSettings(true)} fullscreenButton={fullscreenButton} leading={variant === 'home' ? <><AccountEntry client={account} portraits={view.portraits} onOpen={openAccount} /><PartyChip runtime={partyRuntime} account={accountState} onOpen={openParty} variant="home" /></> : <PartyChip runtime={partyRuntime} account={accountState} onOpen={openParty} variant="header" />} />;
  // Ready waits for this client's own fighters, skins and stage (OnlineSession.setReady).
  const lanReady = network.spectator ? <span className="network-status" id="lan-spectating">👁 SPECTATING</span> : <button id="lan-ready" className={me?.ready ? 'secondary ready-button' : 'battle-next ready-button'} disabled={!view.ready || !lobby} onClick={() => { session.cue('confirm'); online.setReady(!me?.ready && !netStats.preparing); }}>{netStats.preparing && !me?.ready ? 'Loading…' : me?.ready ? 'Not ready' : 'Ready'}</button>;
  return <div ref={root} className={`game-app battle-flow scene-${view.scene} mode-${view.mode ?? 'home'}${arenaView ? ' in-match' : ''}${view.touch ? ' show-touch' : ''}${settings ? ' settings-open' : ''}${accountScreen && !arenaView ? ' account-open' : ''}`}>
    <main className="play-shell"><div className="arena" id="arena">
      <div className="canvas-host" ref={canvas} /><div className="arena-vignette" aria-hidden="true" />
      <div className="arena-chrome" hidden={!arenaView}>
        <MatchHeader session={session} />{rogue && rogue.run.phase === 'fight' && !lanMode && <><RogueRunHud rogue={rogue} session={session} /><RogueBossBar rogue={rogue} session={session} /><RoguePockets rogue={rogue} session={session} onUse={useRogueConsumable} /><RogueFxLayer rogue={rogue} session={session} />{view.paused && <RoguePauseRun rogue={rogue} session={session} />}</>}{!inPauseMenu && (compactActions ? <div className="play-toolbar match-actions match-actions-collapsed" aria-label="Game actions"><PauseButton session={session} view={view} /></div> : <GameActions session={session} view={view} openSettings={() => openSettings()} />)}
        <NetworkTelemetry online={online} /><MatchHud session={session} /><PerfOverlay session={session} /><FallLogPanel session={session} view={view} /><TouchControls session={session} />
        {arenaView && <ArenaOverlay session={session} view={view} openSettings={() => openSettings()} fullscreenButton={inPauseMenu ? fullscreenButton : undefined} />}
        {arenaView && !(compactActions || inPauseMenu) && fullscreenButton && <div className="screen-tools">{fullscreenButton}</div>}
      </div>
      <div className="menu-layer battle-menu-layer" hidden={arenaView}>
        {accountScreen ? <AccountScreens client={account} screen={accountScreen} onScreen={screen => { setAccountScreen(screen); setViewedPlayer(null); }} viewedPlayer={viewedPlayer} onViewPlayer={setViewedPlayer} onClose={() => { session.cue('back'); setAccountScreen(null); setViewedPlayer(null); }} portraits={view.portraits} myRoom={lanMode ? room?.code ?? null : null} onJoinRoom={joinFriendRoom} canJoin={view.ready && !view.active} system={systemMenu('header')} cue={sound => session.cue(sound)} /> : <>
        {view.scene === 'home' && <ModeSelect ready={view.ready} busy={view.loading} error={view.error} onRetry={() => window.location.reload()} system={systemMenu('home')} onSolo={() => session.chooseMode('solo')} onLan={() => session.chooseMode('lan')} onHill={() => session.chooseHill()} onZombies={() => session.chooseZombies()} onRoulette={() => session.chooseRoulette()} rouletteSeconds={view.rouletteSeconds} onRogue={() => { session.rogueMenu(); setRogueSetup(true); }} onTournament={() => { tourney.openHub(); session.tournamentMenu(); }} />}
        {view.scene === 'tournament' && !lanMode && <TournamentScreens controller={tourney} view={view} account={accountState} system={systemMenu('header')} onHome={goHome} onSignIn={openAccount} cue={sound => session.cue(sound)} />}
        {view.mode === 'solo' && view.scene === 'roulette' && <RouletteSetup seats={view.setup.seats} onControl={(slot, control) => session.setSeat(slot, { control })} onLevel={(slot, level) => session.setSeat(slot, { level })} stocks={view.setup.stocks} seconds={view.setup.seconds} items={view.setup.items} onStocks={stocks => session.setRules({ stocks })} onSeconds={seconds => session.setRules({ seconds })} onItems={items => session.setRules({ items })} rouletteSeconds={view.rouletteSeconds} onRouletteSeconds={seconds => session.setRouletteSeconds(seconds)} ready={view.ready} busy={view.loading} onBack={goHome} onNext={() => session.scene('stages')} system={systemMenu('header')} />}
        {view.mode === 'solo' && view.scene === 'characters' && <BattleSelect seats={view.setup.seats} activeSeat={view.activeSeat} onActiveSeat={slot => session.selectSeat(slot)} onFighter={(slot, fighter) => session.setSeat(slot, { fighter })} onCostume={(slot, costume) => session.setSeat(slot, { costume })} onControl={(slot, control) => session.setSeat(slot, { control })} onLevel={(slot, level) => session.setSeat(slot, { level })} canEdit={() => true} mode="local" system={systemMenu('header')} portraits={view.portraits} stocks={view.setup.stocks} seconds={view.setup.seconds} hill={view.setup.hill} teams={view.setup.teams} zombies={view.setup.zombies} items={view.setup.items} itemSwitches={view.setup.itemSwitches} itemPortraits={view.itemPortraits} onRules={rules => session.setRules(rules)} ready={view.ready} busy={view.loading} onPreviewFighter={fighter => session.ensureFighters([fighter])} background={view.background} onBack={goHome} onNext={() => session.scene('stages')} />}
        {lanMode && (view.scene === 'online' || view.scene === 'characters') && <OnlinePanel online={online} view={view} system={systemMenu('header')} onBack={goHome} onNext={() => session.scene('stages')} defaultName={accountState.status === 'signed-in' ? accountState.account?.displayName : undefined} autoJoin={pendingJoin} onAutoJoinDone={() => setPendingJoin(null)} friends={accountState.status === 'unavailable' ? undefined : <LanFriendsStrip client={account} portraits={view.portraits} myRoom={room?.code ?? null} canJoin={view.ready} onJoin={joinFriendRoom} onOpenFriends={() => setAccountScreen('friends')} />} />}
        {view.scene === 'stages' && !lanMode && <StageSelect system={systemMenu('header')} stage={view.setup.stage} previews={view.stagePreviews} disabled={!view.ready || view.loading} playerCount={activeSeats(view.setup.seats).length} canStart={activeSeats(view.setup.seats).length >= 2} onStage={stage => session.setRules({ stage })} onBack={view.roulette ? () => session.scene('roulette') : toCharacters} onStart={view.roulette ? () => session.startRoulette(view.setup.stage) : () => session.start()} background={view.background} rulesSummary={view.setup.hill ? `${activeSeats(view.setup.seats).length} PLAYERS · KOTH ${view.setup.hill.zones > 1 ? 'A+B' : 'A ONLY'}${view.setup.teams ? ' · RED VS BLUE' : ''} · ${Math.floor(view.setup.seconds / 60)}:${String(view.setup.seconds % 60).padStart(2, '0')}` : `${activeSeats(view.setup.seats).length} PLAYERS · ${view.setup.zombies ? 'ZOMBIES · ' : ''}${view.setup.stocks} STOCKS${view.setup.teams ? ' · RED VS BLUE' : ''} · ${Math.floor(view.setup.seconds / 60)}:${String(view.setup.seconds % 60).padStart(2, '0')}`} />}
        {view.scene === 'stages' && lanMode && room && <StageSelect system={systemMenu('header')} stage={room.rules.stage} previews={view.stagePreviews} disabled={!view.ready || view.loading || !host || !lobby} playerCount={room.players.length} canStart={host && allReady && !!lobby} onStage={stage => { online.client.updateRules({ ...room.rules, stage }); session.cue('select'); }} onBack={toCharacters} onStart={() => { session.cue('confirm'); online.client.start(); }} startLabel={host ? 'START MULTIPLAYER' : 'WAITING FOR HOST'} background={view.background} rulesSummary={`${room.players.length} PLAYERS · ${room.rules.stocks} STOCKS · ${Math.floor(room.rules.timeSeconds / 60)}:${String(room.rules.timeSeconds % 60).padStart(2, '0')}`}
          headerAside={<RoomChip code={room.code} detail={`${room.players.filter(player => player.control !== 'cpu').filter(player => player.ready).length}/${room.players.filter(player => player.control !== 'cpu').length} READY`} />}
          footerStart={<button className="secondary" onClick={() => online.leave()}>Leave room</button>}
          side={<ul className="lan-ready-list" aria-label="Player readiness">{room.players.map(player => <li key={player.slot} id={`stage-ready-${player.slot}`} data-ready={String(player.ready)} className={player.ready ? 'is-ready' : 'is-not-ready'}><span className="lan-ready-seat">P{player.slot + 1}</span><span className="lan-ready-name">{player.name}</span><span className="lan-ready-fighter">{player.fighter}{player.control === 'cpu' ? ' · CPU' : ''}</span><span className="lan-ready-state">{player.ready ? 'Ready' : 'Not ready'}</span></li>)}</ul>}
          note={<span className="network-status" role="status">{host ? 'Choose the stage, then everyone marks Ready. Only the host starts the battle.' : 'The host chooses the stage. Mark Ready when your fighter is set.'}</span>}
          alert={network.error ? <p className="room-error" role="alert">{network.error.message}</p> : undefined} footer={lanReady} />}
        {view.scene === 'rogue' && <div className="system-corner">{rogue?.active && !rogueSetup && rogue.run.phase !== 'fight' && <button id="rogue-save-quit" type="button" className="system-icon rogue-save-quit" aria-label="Save and quit" title="Save & quit to the Rift hub: CONTINUE resumes this descent" onClick={saveQuitRogue}><span aria-hidden="true">💾</span></button>}{systemMenu('header')}</div>}
        {view.scene === 'rogue' && !lanMode && !room && (rogueSetup || rogue) && <>
          {(rogueSetup || !rogue) && <RogueSetup key={accountState.epoch} onStart={startRogue} onResume={resumeRogue} onBack={() => { setRogueSetup(false); session.home(); }} onPreviewFighter={previewRogueFighter} portraits={view.portraits} previews={view.stagePreviews} background={view.background} />}
          {!rogueSetup && rogue && rogue.run.phase === 'blessing' && <RogueBlessing rogue={rogue} onPick={(id) => shopRogue((r) => r.pickBlessing(id as Parameters<RogueController['pickBlessing']>[0]))} />}
          {!rogueSetup && rogue && rogue.run.phase === 'map' && <RogueMap rogue={rogue} onEnter={(lane) => shopRogue((r) => r.chooseNode(lane))} onLeave={abandonRogue} portraits={view.portraits} previews={view.stagePreviews} />}
          {!rogueSetup && rogue && rogue.run.phase === 'fight' && <RoguePreparing progress={view.progress} />}
          {!rogueSetup && rogue && rogue.run.phase === 'intro' && <RogueIntro rogue={rogue} error={rogue.floorError} onFight={fightRogueFloor} onLeave={abandonRogue} portraits={view.portraits} previews={view.stagePreviews} />}
          {!rogueSetup && rogue && rogue.run.phase === 'spoils' && <RogueSpoils rogue={rogue} onPick={(id) => shopRogue((r) => r.pickSpoil(id))} />}
          {!rogueSetup && rogue && rogue.run.phase === 'reward' && <RogueReward rogue={rogue} onPick={(index) => shopRogue((r) => r.pickOffer(index))} onReroll={() => shopRogue((r) => r.reroll())} onSkip={() => shopRogue((r) => r.skipOffer())} />}
          {!rogueSetup && rogue && rogue.run.phase === 'event' && <RogueEvent rogue={rogue} onOption={(id) => shopRogue((r) => r.eventOption(id))} onContinue={() => shopRogue((r) => r.leaveEvent())} />}
          {!rogueSetup && rogue && rogue.run.phase === 'rest' && <RogueRest rogue={rogue} error={rogue.floorError} onHeal={() => shopRogue((r) => r.restHeal())} onTemper={() => shopRogue((r) => r.restTemper())} />}
          {!rogueSetup && rogue && rogue.run.phase === 'shop' && <RogueShop rogue={rogue} error={rogue.floorError} onBuyCard={(index) => shopRogue((r) => r.buyShopCard(index))} onBuyPocket={(index) => shopRogue((r) => r.buyShopPocket(index))} onHeal={() => shopRogue((r) => r.buyHeal())} onPom={() => shopRogue((r) => r.buyPom())} onRemove={() => shopRogue((r) => r.buyRemoval())} onReroll={() => shopRogue((r) => r.rerollShop())} onLeave={() => shopRogue((r) => r.leaveShop())} />}
          {!rogueSetup && rogue && rogue.run.phase === 'victory' && <RogueEnd rogue={rogue} victory onRetry={retryRogueSeed} onNewSeed={newRogueSeed} onLeave={leaveRogue} />}
          {!rogueSetup && rogue && rogue.run.phase === 'gameover' && <RogueEnd rogue={rogue} victory={false} onRetry={retryRogueSeed} onNewSeed={newRogueSeed} onLeave={leaveRogue} />}
        </>}
        {view.scene !== 'arena' && <InviteToast client={account} portraits={view.portraits} myRoom={lanMode ? room?.code ?? null : null} canJoin={view.ready && !view.active} onJoin={joinFriendRoom} />}
        </>}
        <p id="load-progress" className="load-progress" role="status">{view.error || (view.loading ? view.progress : 'Original-data prototype · training CPUs · only implemented fighters are selectable.')}</p>
      </div>
      <TournamentRibbon controller={tourney} />
      {arenaView && <PartyOverlay runtime={partyRuntime} />}
      {(view.audioError || view.visualWarning || fullscreenError || (arenaView && view.error)) && <p className="game-warning" role="status">{view.error || fullscreenError || view.visualWarning || `Original audio unavailable: ${view.audioError}`}</p>}
      {view.loading && !view.error && !view.discGate && <LoadingOverlay progress={view.progress} fraction={view.progressFraction} />}
      {view.discGate && !view.error && <DiscGateOverlay gate={view.discGate} onStart={(vanilla, ace) => session.provideDiscs(vanilla, ace)} />}
    </div></main>
    <PartyDialog runtime={partyRuntime} account={accountState} portraits={view.portraits} open={partyOpen} activity={partyActivity} onClose={() => { setPartyOpen(false); session.cue('back'); if (arenaView) session.focus(); }} onSignIn={openAccount} watchFriends={() => account.watchFriends()} />
    <dialog className="options-dialog" ref={options} aria-labelledby="options-title" onCancel={event => { event.preventDefault(); closeSettings(); }} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      <div className="options-heading"><div><span className="options-brand" aria-hidden="true">SMASH<span>WEB</span></span><h2 id="options-title">GAME OPTIONS</h2></div><button className="secondary" aria-label="Close options" onClick={closeSettings}>✕</button></div>
      <section className="options-section" aria-label="Party chat">
        <h3>PARTY CHAT</h3>
        <button className="secondary" id="options-party" type="button" onClick={openParty}>🎧 Channels, parties and voice</button>
      </section>
      <section className="options-section" aria-label="Audio">
        <h3>AUDIO</h3>
        {settings && <AudioSettings session={session} view={view} />}
      </section>
      <section className="options-section" aria-label="Display">
        <h3>DISPLAY</h3>
        <label className="check"><input type="checkbox" checked={view.touch} onChange={event => session.setTouch(event.target.checked)} /> On-screen touch controls</label>
        <label className="check"><input type="checkbox" id="hud-mode-setting" checked={view.hudMode === 'overhead'} onChange={event => session.setHudMode(event.target.checked ? 'overhead' : 'cards')} /> Minimal HUD</label>
        <label className="presentation-setting">GRAPHICS<select id="graphics-quality" value={view.graphicsMode} onChange={event => session.setGraphicsMode(event.target.value as GraphicsMode)}><option key="auto" value="auto">Auto · adapts to this device{view.graphicsMode === 'auto' ? ` (now ${GRAPHICS_PRESETS[view.graphics].label})` : ''}</option>{GRAPHICS_QUALITIES.map(quality => <option key={quality} value={quality}>{GRAPHICS_PRESETS[quality].label} · pinned</option>)}</select></label>
        <details className="effects-settings">
          <summary>VISUAL EFFECTS · {VISUAL_EFFECTS.filter(effect => effectEnabled(view.graphics, view.effects, effect.id)).length} of {VISUAL_EFFECTS.length} on</summary>
          <p className="effects-note">Every effect is off by default. Pin one On to enable it; the graphics preset above sets its strength.</p>
          {VISUAL_EFFECTS.map(effect => <label className="presentation-setting effect-setting" key={effect.id}>
            <span>{effect.label}<small>{effect.note}</small></span>
            <select id={`effect-${effect.id}`} value={view.effects[effect.id]} onChange={event => session.setVisualEffect(effect.id, event.target.value as VisualEffectChoice)}>
              <option value="auto">Auto · {isEffectDefault(view.graphics, effect.id) ? 'on' : 'off'} at {GRAPHICS_PRESETS[view.graphics].label}</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>)}
        </details>
        <label className="check"><input type="checkbox" id="smooth-motion" checked={view.smoothMotion} onChange={event => session.setSmoothMotion(event.target.checked)} /> Smooth high-refresh motion (120/144/165 Hz)</label>
        <label className="presentation-setting">CAMERA SHAKE<select id="camera-shake" value={view.cameraShake} onChange={event => session.setCameraShake(event.target.value as CameraShakeLevel)}>{CAMERA_SHAKE_LEVELS.map(level => <option key={level} value={level}>{level === 'off' ? 'Off' : level === 'reduced' ? 'Reduced' : 'Full'}</option>)}</select></label>
        <label className="presentation-setting">RUMBLE<select id="rumble-level" value={view.rumble} onChange={event => session.setRumble(event.target.value as RumbleLevel)}>{RUMBLE_LEVELS.map(level => <option key={level} value={level}>{level === 'off' ? 'Off' : level === 'subtle' ? 'Subtle' : 'Full'}</option>)}</select></label>
        <button className="secondary" id="rumble-test" type="button" onClick={() => session.rumblePad.pulse({ strong: 0.8, weak: 0.5, durationMs: 120 })}>Test rumble</button>
        {CUSTOM_PRESENTATIONS.length > 0 && <label className="presentation-setting">CUSTOM CHARACTER PRESENTATION<select id="custom-presentation" value={view.presentation} onChange={event => session.setPresentation(event.target.value)}>{CUSTOM_PRESENTATIONS.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label>}
      </section>
      <section className="options-section" aria-label="Downloaded data">
        <h3>DOWNLOADED DATA</h3>
        {settings && <StorageSettings />}
        {settings && <AppUpdateSettings />}
      </section>
      <section className="options-section" aria-label="Privacy">
        <h3>PRIVACY</h3>
        {settings && <PrivacySettings />}
      </section>
      {settings && session.input && <KeyboardSettings input={session.input} players={lanMode || localHumans.length < 2 ? 1 : 2} />}
      {settings && session.input && <ControllerPanel hub={session.input.controllers} online={lanMode} localCount={(lanMode ? 1 : Math.max(1, localHumans.length)) as LocalControllerCount} spectating={!lanMode && localHumans.length === 0} slotLabels={lanMode ? ['Your LAN fighter'] : localHumans.map(seat => `P${seat.slot + 1} · ${session.content?.roster.get(seat.fighter)?.profile.name ?? seat.fighter}`)} />}
      <section className="options-section options-about" aria-label="About">
        <h3>ABOUT</h3>
        <Credits />
        <details className="tools-links"><summary>PORT LAB</summary><a href="/viewer.html">Asset viewer</a><a href="/index.html">Research lab</a></details>
      </section>
      <details className="options-advanced"><summary>Debug tools</summary>
        {settings && <DebugSettings session={session} view={view} />}
        {settings && <FallLogPanel session={session} view={view} />}
      </details>
      <p className="options-note">{session.online ? 'Online match keeps running while options are open.' : 'Local match stays paused while options are open.'}</p>
      <button className="primary" onClick={closeSettings}>{view.active ? 'BACK TO GAME' : 'BACK TO SELECTION'}</button>
    </dialog>
  </div>;
}
