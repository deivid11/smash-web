import { isStage, type SceneMode, type SceneStats } from './scene.ts';
import type { ViewerController, ViewerState } from './useAssetViewer.ts';

function AssetStats({ stats }: { stats: SceneStats | undefined }) {
  return <div id="asset-stats" className="stats" hidden={!stats}>{stats && Object.entries(stats).map(([name, value]) => <div key={name}><span>{name.toUpperCase()}</span><strong>{value.toLocaleString()}</strong></div>)}</div>;
}

function SourceDetails({ state, chooseLocal }: { state: ViewerState; chooseLocal: () => void }) {
  return <>
    <p id="source-status" className="source-status">{state.sourceStatus}</p>
    <button id="use-local-disc" className="source-button" disabled={state.busy || state.connecting} onClick={chooseLocal}>Use a local ISO instead</button>
    <p className="camera-help">Drag to orbit · wheel to zoom · right-drag to pan.<br />Run/jab controls play animation clips only.</p>
    <AssetStats stats={state.stats} />
    <p id="load-message" className="load-message" role="status">{state.message}</p>
    <details className="limitations"><summary>Rendering limitations</summary><ul id="warnings">{state.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>
    <div className="private-note"><span>↳</span><p><span id="source-privacy">{state.privacy ?? <>Disc bytes stay on your device.<br />No bundled Nintendo assets. No uploads.</>}</span><br /><a href="/licenses/NOTICE.txt" target="_blank" rel="noreferrer">Renderer credits ↗</a></p></div>
  </>;
}

export function ViewerControls({ controller }: { controller: ViewerController }) {
  const { state, select, togglePlaying, seek, resetCamera, saveImage, chooseLocal } = controller;
  const { mode, fighterCount, action } = state.selection;
  const disabled = !state.controlsReady || state.busy || state.connecting;
  return <aside className="controls-pane">
    <p className="eyebrow">SCENE CONTROLS</p><h2>Explore the first render.</h2>
    <label className="field">SCENE<select id="scene-select" value={mode} disabled={disabled} onChange={(event) => select({ mode: event.target.value as SceneMode })}>
      <option value="battlefield">Battlefield</option><option value="final">Final Destination</option><option value="yoshi">Yoshi’s Story</option><option value="fox">Fox · model close-up</option><option value="mario">Mario · model close-up</option><option value="trophy">Mario · original trophy</option>
    </select></label>
    <label className="field">FIGHTER MODELS<select id="fighter-count" value={fighterCount} disabled={disabled || !isStage(mode)} onChange={(event) => select({ fighterCount: event.target.value })}>
      <option value="2">2 models · Fox &amp; Mario</option><option value="4">4 models · scene stress test</option><option value="0">Stage only</option>
    </select></label>
    <label className="field">ORIGINAL ANIMATION<select id="action-select" value={action} disabled={disabled || mode === 'trophy' || (isStage(mode) && fighterCount === '0')} onChange={(event) => select({ action: event.target.value })}>
      <option value="Wait1">Idle · Wait1</option><option value="WalkMiddle">Walk · WalkMiddle</option><option value="Run">Run</option><option value="Attack11">Jab · Attack11</option><option value="AttackAirN">Neutral aerial · AttackAirN</option>
    </select></label>
    <div className="button-row"><button id="play-pause" disabled={disabled} onClick={togglePlaying}>{state.playing ? 'Pause animation' : 'Play animation'}</button><button id="reset-camera" disabled={disabled} onClick={resetCamera}>Reset camera</button></div>
    <label className="field timeline">PREVIEW FRAME<input type="range" id="frame-slider" min="0" max={Math.ceil(state.duration)} step="1" value={state.slider} disabled={disabled} onInput={(event) => seek(Number(event.currentTarget.value))} /></label>
    <button id="save-image" className="primary" disabled={disabled} onClick={saveImage}>Save rendered image ↗</button>
    <SourceDetails state={state} chooseLocal={chooseLocal} />
  </aside>;
}
