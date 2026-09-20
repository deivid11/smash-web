import { memo, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { GameActions } from './controls.tsx';
import { stackLabels } from './label-layout.ts';
import { playerPresentation } from '../../../lib/game/player-colors.ts';
import { portraitFor } from '../../../lib/game/costumes.ts';
import { HILL_TEAM_COLORS, HILL_TEAM_NAMES } from '../../../lib/game/hill.ts';
import { SUPPORTED_STAGES } from '../../../lib/game/stages.ts';
import type { GameSession, FighterHud, HillHud as HillHudState, PlayView } from './game-session.ts';

const FighterCard = memo(function FighterCard({ fighter, slot, maximum, portrait, hill }: { fighter: FighterHud; slot: number; maximum: number; portrait?: string; hill: boolean }) {
  const seatId = fighter.seatId ?? slot;
  const control = fighter.control ?? 'human';
  const presentation = playerPresentation(seatId);
  return <div className={`fighter-card player-${presentation.key}`} style={{ '--player-color': presentation.css } as CSSProperties} role="group" aria-label={`Player ${seatId + 1}: ${fighter.name}${control === 'cpu' ? ' (CPU)' : ''}`} data-player={seatId + 1} data-seat-id={seatId} data-controller-kind={control} data-damage={fighter.percent >= 100 ? 'danger' : fighter.percent >= 60 ? 'high' : 'normal'}>
    {portrait && <img className="hud-portrait" src={portrait} alt="" draggable={false} />}
    <span className="hud-slot">P{seatId + 1}{control === 'cpu' && <small>{fighter.level ? `CPU L${fighter.level}` : 'CPU'}</small>}</span>
    <div className="hud-fighter-info"><span className="player-label" id={`p${slot + 1}-label`}>{control === 'cpu' ? 'CPU' : fighter.label}</span><strong id={`fighter-name-${slot}`}>{fighter.name.toUpperCase()}</strong><span className="stock-dots" id={`stocks-${slot}`}>{hill || fighter.infected ? '∞' : '● '.repeat(Math.max(0, fighter.stocks)).trim() || '—'}</span>
      {fighter.infected && <span className="zombie-badge" id={`zombie-badge-${slot}`} role="status" aria-label={`${fighter.name} is infected`}>🧟 INFECTED</span>}
      {hill && <span className="hill-points" id={`hill-points-${slot}`} aria-label={`${fighter.name} hill points`}>{fighter.team !== null && fighter.team !== undefined ? <span className="hill-team-dot" style={{ backgroundColor: HILL_TEAM_COLORS[fighter.team] }} aria-hidden="true" /> : null}⛰ {fighter.hillPoints}</span>}
      {!hill && fighter.team !== null && fighter.team !== undefined && <span className="hill-team-dot" id={`team-dot-${slot}`} style={{ backgroundColor: HILL_TEAM_COLORS[fighter.team] }} title={`${fighter.team === 0 ? 'RED' : 'BLUE'} TEAM`} aria-label={`${fighter.name} on the ${fighter.team === 0 ? 'red' : 'blue'} team`} />}
      <meter className="shield-meter" id={`shield-${slot}`} min={0} max={maximum} value={fighter.shield} aria-label={`${fighter.name} shield energy`} />
      <meter className="charge-meter" id={`charge-${slot}`} min={0} max={fighter.chargeMax} value={fighter.charge} aria-label={`${fighter.name} smash charge`} hidden={!fighter.charging} />
      <small className="combat-state" id={`combat-${slot}`}>{fighter.combat}</small></div><div className="percent" id={`percent-${slot}`}>{fighter.percent}<span>%</span>{fighter.nana && <small className="nana-percent" id={`nana-${slot}`} aria-label={`Nana damage ${fighter.nana.active ? fighter.nana.percent : 'KO'}${fighter.nana.active ? ' percent' : ''}`}>NN {fighter.nana.active ? fighter.nana.percent : '—'}<span>%</span></small>}</div>
  </div>;
});
export function MatchHud({ session }: { session: GameSession }) {
  const hud = useSyncExternalStore(session.hud.subscribe, session.hud.getSnapshot);
  const view = useSyncExternalStore(session.ui.subscribe, session.ui.getSnapshot);
  // Minimal HUD: ArenaOverlay carries the percents. King of the Hill still needs its
  // zones and score, so that one keeps a slim strip instead of the full panel.
  if (view.hudMode === 'overhead') {
    return hud.hill ? <div className="fighters-hud hud-minimal" data-player-count={hud.fighters.length} aria-label="Hill status"><HillHud hill={hud.hill} fighters={hud.fighters} compact /></div> : null;
  }
  return <div className={`fighters-hud count-${hud.fighters.length}${hud.fighters.length > 4 ? ' many-players' : ''}`} data-player-count={hud.fighters.length} aria-label="Fighter status">
    {hud.fighters.map((fighter, slot) => <FighterCard key={slot} fighter={fighter} slot={slot} maximum={hud.shieldMax} portrait={fighter.kind ? portraitFor(view.portraits, fighter.kind, fighter.costume ?? 0) : undefined} hill={!!hud.hill} />)}
    {hud.hill && <HillHud hill={hud.hill} fighters={hud.fighters} />}
    <div className="hud-center"><span id="mode-label">{hud.mode}</span><small id="source-label">SERVER ISO · C/WASM PHYSICS</small><small id="frame-label">FRAME {hud.frame}</small>{(view.debug || view.showFps) && hud.fps !== undefined && <small id="fps-label">{hud.fps} FPS</small>}</div>
  </div>;
}
export function HillHud({ hill, fighters, compact = false }: { hill: HillHudState; fighters: readonly FighterHud[]; compact?: boolean }) {
  const shiftIn = Math.max(0, Math.ceil(hill.relocateIn / 60));
  const seatLabel = (dense: number) => `P${(fighters[dense]?.seatId ?? dense) + 1}`;
  const best = hill.points.length ? hill.points.indexOf(Math.max(...hill.points)) : -1;
  return <div className={`hill-hud${compact ? ' compact' : ''}`} id="hill-hud" role="status" aria-label="King of the Hill scores">
    {hill.zones.map(zone => {
      const sideLabel = (side: number) => hill.teams ? HILL_TEAM_NAMES[side as 0 | 1] : seatLabel(side);
      // Everyone in the circle fills their own meter, so the line names the
      // fighter closest to taking it and counts the rest of the racers.
      const lead = zone.claims[0];
      const rivals = zone.claims.length - 1;
      return <span key={zone.id} className="hill-zone" id={`hill-zone-${zone.id}`} data-holder={zone.holder === null ? 'none' : String(zone.holder)} data-capturing={lead ? String(lead.slot) : undefined}>
        <strong>{zone.id}</strong>
        <span>{lead ? `${seatLabel(lead.slot)} ${Math.round(lead.progress * 100)}%${rivals > 0 ? ` +${rivals}` : ''}` : zone.holder === null ? 'OPEN' : `${sideLabel(zone.holder)} HOLDS`}</span>
        {lead && <span className="hill-capture" aria-hidden="true" style={{ '--capture': `${Math.round(lead.progress * 100)}%` } as CSSProperties} />}
      </span>;
    })}
    {hill.teams
      ? <span className="hill-teams" id="hill-teams"><span style={{ color: HILL_TEAM_COLORS[0] }}>RED {hill.teamPoints[0]}</span><span aria-hidden="true">·</span><span style={{ color: HILL_TEAM_COLORS[1] }}>BLUE {hill.teamPoints[1]}</span></span>
      : <span className="hill-leader" id="hill-leader">LEADER {best >= 0 ? `${seatLabel(best)} · ${hill.points[best]}` : '—'}</span>}
    <span className="hill-shift" id="hill-shift">ZONES SHIFT {Math.floor(shiftIn / 60)}:{String(shiftIn % 60).padStart(2, '0')}</span>
  </div>;
}
export function PerfOverlay({ session }: { session: GameSession }) {
  const hud = useSyncExternalStore(session.hud.subscribe, session.hud.getSnapshot);
  const view = useSyncExternalStore(session.ui.subscribe, session.ui.getSnapshot);
  if (!view.showPerf || !hud.perf) return null;
  const perf = hud.perf;
  return <div className="perf-overlay" id="perf-overlay" role="status" aria-label="Performance statistics">
    <span><strong>{perf.fps}</strong> FPS</span><span>p50 {perf.p50}ms · p95 {perf.p95}ms</span>
    <span>render 1/{perf.skip + 1} · interp {perf.smooth ? 'on' : 'off'}</span><span>{perf.quality}</span>
    <span>{perf.calls} calls · {(perf.triangles / 1000).toFixed(1)}k tris · {perf.programs} progs</span>
    <span>{perf.particles} particles · cam {perf.cam}</span>
  </div>;
}
export function MatchHeader({ session }: { session: GameSession }) {
  const hud = useSyncExternalStore(session.hud.subscribe, session.hud.getSnapshot);
  const view = useSyncExternalStore(session.ui.subscribe, session.ui.getSnapshot);
  const stage = hud.stage ?? view.setup.stage;
  return <div className="match-top hud-top"><div className="match-identity"><span className="in-game-brand">SMASH<span>WEB</span></span><h1>{(SUPPORTED_STAGES.find(entry => entry.id === stage)?.label ?? 'Battlefield').toUpperCase()}</h1><span id="game-status" className="game-status" role="status">{hud.status}</span></div><div className="clock" id="match-clock" aria-label={`Time remaining ${hud.clock}`}>{hud.clock}</div>{hud.rouletteIn !== null && hud.rouletteIn !== undefined && <span id="roulette-countdown" className="roulette-countdown" role="status" aria-label={`Next roulette swap in ${hud.rouletteIn} seconds`}>🎲 {hud.rouletteIn}s</span>}</div>;
}
/** Ultimate-style finish: a GAME! splash, then results. Solo (one local human)
 * goes straight to a winner card whose primary action is character select;
 * multi-human rooms list per-fighter stats and each human agrees before the
 * whole room returns to character select. Online keeps the legacy card. */
export function ResultsOverlay({ session, fighters, winner, winnerSlot, ready }: { session: GameSession; fighters: readonly FighterHud[]; winner: string; winnerSlot: number | null; ready: boolean }) {
  const [splashGone, setSplashGone] = useState(false);
  const [agreed, setAgreed] = useState<number[]>([]);
  const humans = fighters.filter(fighter => (fighter.control ?? 'human') === 'human');
  const solo = humans.length <= 1;
  useEffect(() => {
    if (splashGone) return;
    const timer = window.setTimeout(() => setSplashGone(true), 2600);
    return () => window.clearTimeout(timer);
  }, [splashGone]);
  const missing = humans.filter(fighter => !agreed.includes(fighter.seatId ?? -1));
  useEffect(() => {
    if (resultsReady(humans.map(fighter => fighter.seatId ?? -1), agreed)) session.changeFighters();
  });
  const toggle = (seatId: number) => setAgreed(previous => previous.includes(seatId) ? previous.filter(seat => seat !== seatId) : [...previous, seatId]);
  return <>
  {!splashGone && <div className="center-overlay game-splash-wrap" id="game-splash" role="status" aria-label="Game!" onClick={() => setSplashGone(true)}><span className="game-splash-text" aria-hidden="true">GAME!</span></div>}
  <div className="center-overlay ending-overlay" id="center-overlay"><div className="overlay-card results-card">
    <p className="eyebrow" id="overlay-eyebrow">RESULTS</p>
    <h2 id="overlay-title" className="results-winner">{winner}</h2>
    {solo
      ? <p id="overlay-message">Head back to character select for the next battle — or run it back right away.</p>
      : <><div className="results-table-wrap"><table className="results-table" id="results-table" aria-label="Match results by fighter">
        <thead><tr><th scope="col">Fighter</th><th scope="col">KOs</th><th scope="col">Falls</th><th scope="col">DMG</th><th scope="col">Stocks</th><th scope="col">Ready</th></tr></thead>
        <tbody>{fighters.map((fighter, slot) => {
          const seatId = fighter.seatId ?? slot, human = (fighter.control ?? 'human') === 'human', isWinner = winnerSlot !== null && slot === winnerSlot, isAgreed = agreed.includes(seatId);
          return <tr key={slot} data-winner={isWinner} data-seat-id={seatId}>
            <td><strong>P{seatId + 1}</strong> {fighter.name.toUpperCase()} <small>{human ? fighter.label : (fighter.level ? `CPU L${fighter.level}` : 'CPU')}</small></td>
            <td>{fighter.kos}</td><td>{fighter.falls}</td><td>{fighter.damage}</td><td>{fighter.stocks}</td>
            <td>{human ? <button className="agree-btn" id={`agree-${seatId}`} aria-pressed={isAgreed} onClick={() => toggle(seatId)}>{isAgreed ? 'READY ✓' : 'AGREE'}</button> : <span aria-hidden="true">—</span>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="results-hint" id="results-hint">{missing.length ? `Waiting for ${missing.map(fighter => `P${(fighter.seatId ?? 0) + 1}`).join(' + ')} to agree…` : 'Everyone agreed — to character select!'}</p></>}
    <div className="results-actions">
      {solo && <button className="primary" id="choose-fighters" disabled={!ready} onClick={() => session.changeFighters()}>Choose fighters ↗</button>}
      {solo && <button className="secondary" id="start-match" disabled={!ready} onClick={() => void session.start()}>Play again</button>}
    </div>
  </div></div></>;
}
/** Pure transition check for the agree gate (unit-tested): every local human agreed. */
export function resultsReady(humanSeatIds: readonly number[], agreed: readonly number[]): boolean {
  return humanSeatIds.length > 1 && humanSeatIds.every(seat => agreed.includes(seat));
}
export function ArenaOverlay({ session, view, openSettings = () => {}, fullscreenButton }: { session: GameSession; view: PlayView; openSettings?: () => void; fullscreenButton?: ReactNode }) {
  const hud = useSyncExternalStore(session.hud.subscribe, session.hud.getSnapshot);
  // A pause no longer dims the arena: the scene stays fully visible and frozen
  // behind the Melee-style pause frame (see PauseOverlay), so the card is only
  // for boot/error/pre-match/results states.
  const show = !!view.error || view.loading || !view.active;
  const title = view.error ? 'Game data unavailable' : view.loading ? 'Loading the match…' : view.ended ? hud.winner : 'Ready to play.';
  // Crowded shots stack overlapping head labels (tag, plus the percent in minimal HUD) in rows.
  const overhead = view.hudMode === 'overhead';
  const lifts = stackLabels(hud.fighters.map((fighter) => ({ ...fighter.position, priority: fighter.tag === 'YOU' })), overhead ? 66 : 62, overhead ? 48 : 16);
  return <>
    {hud.fighters.map((fighter, slot) => {
      const seatId = fighter.seatId ?? slot;
      const presentation = playerPresentation(seatId);
      return <span key={slot} className={`fighter-tag tag-${presentation.key}`} data-seat-id={seatId} id={`fighter-tag-${slot}`} hidden={!fighter.position.visible} style={{ left: fighter.position.x, top: fighter.position.y - lifts[slot]!, backgroundColor: presentation.css, color: presentation.ink }}>{fighter.control === 'cpu' && fighter.level ? `${fighter.tag} · L${fighter.level}` : fighter.tag}</span>;
    })}
    {overhead && hud.fighters.map((fighter, slot) => {
      const seatId = fighter.seatId ?? slot;
      return <span key={`overhead-${slot}`} className="overhead-percent" id={`overhead-percent-${slot}`} data-seat-id={seatId} data-damage={fighter.percent >= 100 ? 'danger' : fighter.percent >= 60 ? 'high' : 'normal'} hidden={!fighter.position.visible} style={{ left: fighter.position.x, top: fighter.position.y - 18 - lifts[slot]!, '--player-color': playerPresentation(seatId).css } as CSSProperties} aria-label={`${fighter.name} damage ${fighter.percent} percent`}>
        <span className="overhead-value">{fighter.percent}<span>%</span></span>{fighter.nana && <small className="overhead-nana" aria-label={`Nana damage ${fighter.nana.active ? fighter.nana.percent : 'KO'}${fighter.nana.active ? ' percent' : ''}`}>NN {fighter.nana.active ? fighter.nana.percent : '—'}%</small>}<small className="overhead-stocks">{'●'.repeat(Math.max(0, fighter.stocks))}</small>
      </span>;
    })}
    {show && (view.ended && !view.error && !session.online
      ? <ResultsOverlay key={`${hud.frame}-${hud.winner}`} session={session} fighters={hud.fighters} winner={hud.winner} winnerSlot={hud.winnerSlot} ready={view.ready} />
      : <div className={`center-overlay${view.ended && !view.error ? ' ending-overlay' : ''}`} id="center-overlay"><div className="overlay-card">
      <p className="eyebrow" id="overlay-eyebrow">{view.error ? 'THE MATCH COULD NOT START' : view.loading ? 'LOADING ASSETS' : view.ended ? 'MATCH COMPLETE' : view.setup.hill ? 'KING OF THE HILL · PROTOTYPE' : view.setup.zombies ? 'ZOMBIES · PROTOTYPE' : view.setup.teams ? 'STOCK TEAMS · PROTOTYPE' : 'LOCAL STOCK MATCH'}</p>
      <h2 id="overlay-title">{title}</h2><p id="overlay-message">{view.error || (view.loading ? view.progress : view.ended ? 'Play again, or change your fighters and stage.' : `${hud.fighters.map(f => f.name).join(' vs. ')}. Return to battle setup to choose fighters and a stage, or start with these settings.`)}</p>
      <button className="primary" id="start-match" disabled={!view.ready || view.loading || !!view.error || session.online} onClick={() => void session.start()}>{view.error ? 'Unavailable' : view.ended ? 'Play again ↗' : 'Start match ↗'}</button>
    </div></div>)}
    {view.paused && <PauseOverlay session={session} view={view} openSettings={openSettings} fullscreenButton={fullscreenButton} />}
    <div className="countdown" id="countdown" hidden={hud.phase !== 'countdown'}>{hud.countdown}</div><div className="match-banner" id="match-banner" hidden={!hud.banner}>{hud.banner}</div>
    <div className="match-banner onett-warning" id="onett-warning" role="status" aria-label="Car crossing warning" hidden={!hud.onettWarning}>⚠ CAR — CLEAR THE STREET</div>
  </>;
}
/** Melee-style pause frame: corner brackets, a "PAUSE" flag, the full match
 * menu (rematch / fighters / walk / touch / HUD / options) and camera hints,
 * all drawn over the still-visible frozen arena. The player orbits/zooms/pans a
 * free camera (mouse + keyboard, wired in PauseCameraControls); the Resume
 * button and Escape both resume. Only buttons capture pointer events, so drags
 * anywhere else on the arena reach the canvas and move the camera. */
export function PauseOverlay({ session, view, openSettings = () => {}, fullscreenButton }: { session: GameSession; view: PlayView; openSettings?: () => void; fullscreenButton?: ReactNode }) {
  const focus = view.pauseFocus;
  return <div className="pause-overlay" id="pause-overlay" role="group" aria-label="Match paused — camera controls">
    <span className="pause-corner tl" aria-hidden="true" /><span className="pause-corner tr" aria-hidden="true" />
    <span className="pause-corner bl" aria-hidden="true" /><span className="pause-corner br" aria-hidden="true" />
    <div className="pause-flag" aria-hidden="true"><span className="pause-mark">❚❚</span> PAUSE{focus && <em> · {focus.name.toUpperCase()}</em>}</div>
    <div className="pause-toolbar">
      <GameActions session={session} view={view} openSettings={openSettings} trailing={fullscreenButton} />
      <div className="pause-footer">
        <p className="pause-hints"><strong>Drag</strong> orbit · <strong>Scroll</strong> zoom · <strong>WASD</strong> pan · <strong>Q/E</strong> rotate · <strong>Tab</strong> focus{focus ? ` · ${focus.name}` : ''} · <strong>R</strong> reset · 🎮 <strong>Right stick</strong> orbit · <strong>RT/LT</strong> zoom · <strong>Start</strong> resume · <strong>L+R+A+Start</strong> quit</p>
        <button className="primary pause-resume" id="start-match" disabled={!view.ready || session.online} onClick={() => void session.start()}>Resume ↗</button>
      </div>
    </div>
  </div>;
}
