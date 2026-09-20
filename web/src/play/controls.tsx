import { memo, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { formatFallEntry, type GameSession, type PlayView } from './game-session.ts';
import { clearDownloadedData, downloadedDataStatus, formatBytes, type DownloadedDataStatus } from '../offline-cache.ts';
import { AppUpdateControl } from './app-update.tsx';
export const PauseButton = memo(function PauseButton({ session, view }: { session: GameSession; view: PlayView }) {
  return <button id="pause-match" className="icon-action" title={view.paused ? 'Resume' : 'Pause'} aria-label={view.paused ? 'Resume' : 'Pause'} disabled={!view.active || session.online} onClick={() => session.pause()}><span aria-hidden="true">{view.paused ? '▶' : 'Ⅱ'}</span><span className="action-label">{view.paused ? 'Resume' : 'Pause'}</span></button>;
});
/** Full match menu. During local play it lives inside the Melee-style pause
 * overlay (the live arena shows only the pause button, for an unobstructed
 * view); online keeps the classic top-right bar since pausing is unavailable
 * there. `trailing` carries extra menu rows (fullscreen) in the pause menu. */
export const GameActions = memo(function GameActions({ session, view, openSettings, trailing }: { session: GameSession; view: PlayView; openSettings: () => void; trailing?: ReactNode }) {
  return <div className="play-toolbar match-actions" aria-label="Game actions">
    <PauseButton session={session} view={view} />
    <button id="reset-match" className="icon-action" title="Rematch" aria-label="Rematch" disabled={!view.ready || view.loading || session.online} onClick={() => session.start(true)}><span aria-hidden="true">↻</span><span className="action-label">Rematch</span></button>
    <button id="change-fighters" className="icon-action" title="Change fighters" aria-label="Change fighters" disabled={!view.ready || session.online} onClick={() => session.changeFighters()}><span aria-hidden="true">⇄</span><span className="action-label">Fighters</span></button>
    <button id="random-swap" className="icon-action" title="Swap P1 to a random fighter (local debug, no restart)" aria-label="Random fighter" disabled={!view.active || view.ended || session.online} onClick={() => session.randomDebugFighter()}><span aria-hidden="true">🎲</span><span className="action-label">Random</span></button>
    <button id="walk-mode" className="icon-action" title="Toggle walk mode" aria-label={`Walk mode: ${view.walk ? 'ON' : 'OFF'}`} disabled={!view.ready} aria-pressed={view.walk} onClick={() => session.setWalk()}><span aria-hidden="true">W</span><span className="action-label">Walk mode: {view.walk ? 'ON' : 'OFF'}</span></button>
    <button className="icon-action" id="touch-toggle" aria-label="Touch controls" aria-pressed={view.touch} title="Touch controls" onClick={() => session.setTouch(!view.touch)}><span aria-hidden="true">✥</span><span className="action-label">Controls</span></button>
    <button className="icon-action" id="hud-toggle" aria-label={`HUD: ${view.hudMode === 'overhead' ? 'minimal' : 'full'}`} aria-pressed={view.hudMode === 'overhead'} title="Toggle minimal HUD (damage above fighters)" onClick={() => session.toggleHud()}><span aria-hidden="true">▤</span><span className="action-label">HUD: {view.hudMode === 'overhead' ? 'Minimal' : 'Full'}</span></button>
    <button className="icon-action" aria-label="Game options" title="Game options" onClick={openSettings}><span aria-hidden="true">⚙</span><span className="action-label">Options</span></button>
    {trailing}
  </div>;
});
export const AudioSettings = memo(function AudioSettings({ session, view }: { session: GameSession; view: PlayView }) {
  return <div className="audio-settings">
    <label className="check"><input type="checkbox" id="sound-enabled" checked={view.sound} onChange={e => session.setSound(e.target.checked)} /> Original SFX</label>
    <label className="check"><input type="checkbox" id="music-enabled" checked={view.music} onChange={e => session.setMusic(e.target.checked)} /> Original music</label>
    <label className="music-volume">VOLUME<input type="range" id="master-volume" aria-label="General volume" min="0" max="1" step="0.05" value={view.masterVolume} onChange={e => session.setMasterVolume(Number(e.target.value))} /><output htmlFor="master-volume">{Math.round(view.masterVolume * 100)}%</output></label>
    <label className="music-volume">MUSIC<input type="range" id="music-volume" aria-label="Music volume" min="0" max="1" step="0.05" value={view.musicVolume} onChange={e => session.setMusicVolume(Number(e.target.value))} /><output htmlFor="music-volume">{Math.round(view.musicVolume * 100)}%</output></label>
  </div>;
});
export const DebugSettings = memo(function DebugSettings({ session, view }: { session: GameSession; view: PlayView }) {
  return <div className="debug-settings">
    <label className="check"><input type="checkbox" id="debug-hits" checked={view.debug} onChange={e => session.setDebug(e.target.checked)} /> Hit/hurt boxes</label>
    <label className="check"><input type="checkbox" id="debug-collision" checked={view.debugCollision} onChange={e => session.setDebugCollision(e.target.checked)} /> Collision lines</label>
    <label className="check"><input type="checkbox" id="fps-counter" checked={view.showFps} onChange={e => session.setShowFps(e.target.checked)} /> FPS counter</label>
    <label className="check"><input type="checkbox" id="perf-stats" checked={view.showPerf} onChange={e => session.setShowPerf(e.target.checked)} /> Performance stats</label>
    <label className="check"><input type="checkbox" id="roulette-mode" checked={view.roulette} onChange={e => session.setRoulette(e.target.checked)} /> Roulette chaos (local)</label>
    {view.roulette && <label className="presentation-setting">ROTATE EVERY<select id="roulette-seconds" value={view.rouletteSeconds} onChange={e => session.setRouletteSeconds(Number(e.target.value))}><option value={10}>10 s</option><option value={30}>30 s</option><option value={60}>60 s</option></select></label>}
    <p className="options-note">Debug: press <kbd>P</kbd> in a local match to hot-swap P1 to the next one in character-select order (<kbd>Shift</kbd>+<kbd>P</kbd> for random) with no restart. Roulette rotates every fighter on its timer; local matches only, never online.</p>
  </div>;
});
export const StorageSettings = memo(function StorageSettings() {
  const [status, setStatus] = useState<DownloadedDataStatus | null>(null);
  const [report, setReport] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void downloadedDataStatus().then((next) => { if (live) setStatus(next); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const clear = () => {
    setBusy(true); setReport('Clearing downloaded data…');
    void clearDownloadedData()
      .then((removed) => {
        setReport(removed.length ? `Cleared ${removed.length} cache${removed.length === 1 ? '' : 's'}. Re-downloads on the next online visit; offline play is unavailable until then.` : 'Nothing downloaded yet.');
        return downloadedDataStatus();
      })
      .then(setStatus, () => {})
      .finally(() => setBusy(false));
  };
  return <div className="storage-settings">
    <p className="options-note">{status === null ? 'Checking downloaded data…' : status.caches.length ? `Downloaded: ${status.caches.length} cache${status.caches.length === 1 ? '' : 's'} (${formatBytes(status.estimatedBytes)} site usage).` : 'Nothing downloaded yet — offline play needs one online visit first.'}</p>
    <button className="secondary" id="clear-downloaded-data" type="button" disabled={busy || status === null || status.caches.length === 0} onClick={clear}>Clear downloaded data</button>
    {report && <p className="options-note" role="status">{report}</p>}
  </div>;
});
/** Android app/game versions + update button in Options; renders nothing outside the APK. */
export const AppUpdateSettings = memo(function AppUpdateSettings() {
  return <AppUpdateControl variant="options" />;
});
export { TouchControls } from './touch-controls.tsx';
export const FallLogPanel = memo(function FallLogPanel({ session, view }: { session: GameSession; view: PlayView }) {
  const fall = useSyncExternalStore(session.fallLog.subscribe, session.fallLog.getSnapshot);
  if (!view.debug) return null;
  const recent = fall.entries.slice(-8).reverse();
  const copy = () => {
    const text = fall.entries.map(formatFallEntry).join('\n') || 'No ground-loss events yet. Walk off a ledge to record one.';
    void navigator.clipboard?.writeText(text).catch(() => {});
  };
  return <details className="fall-log" open={fall.entries.length > 0}><summary>Fall log ({fall.entries.length}) — copy one line to report a bad fall</summary>
    <p className="solo-note">Every grounded-to-air support loss is recorded with stage, frame, fighter, position, floor and reason. When a fall looks wrong, copy its line verbatim.</p>
    {recent.length === 0 ? <p className="solo-note">No falls recorded yet.</p> : <ol>{recent.map((entry, index) => <li key={`${entry.frame}-${entry.player}-${index}`}><code>{formatFallEntry(entry)}</code></li>)}</ol>}
    <div className="play-toolbar"><button className="icon-action" onClick={copy}><span aria-hidden="true">⧉</span><span className="action-label">Copy log</span></button><button className="icon-action" onClick={() => session.clearFallLog()}><span aria-hidden="true">✕</span><span className="action-label">Clear</span></button></div>
  </details>;
});
