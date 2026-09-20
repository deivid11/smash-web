import type { ViewerController } from './useAssetViewer.ts';

export function ViewerStage({ controller, server }: { controller: ViewerController; server: boolean }) {
  const { state, viewportRef, fileRef, inspect } = controller;
  return <section className="stage-pane">
    <div className="stage-heading"><div><p className="eyebrow">FROM YOUR GAMECUBE DISC · RENDERED LOCALLY</p><h1 id="scene-title">{state.title}</h1></div><span className={`badge${state.error ? ' error' : ''}`} id="viewer-status" role="status">{state.status}</span></div>
    <div id="viewport">
      <div className="empty-state" id="empty-state" hidden={state.hasScene}>
        <span className="disc-glyph">◎</span><h2>Original worlds. Original fighters.</h2>
        <p id="source-intro">{server ? 'Loading the server’s Melee disc. Models and animations will render in this browser.' : <>Select your own USA v1.02 disc to render its<br />actual models, textures, and animation tracks.</>}</p>
        <label className="primary file-picker" hidden={state.connecting}>Select local ISO<input value="" ref={fileRef} type="file" id="viewer-disc" accept=".iso,.gcm" aria-label="Select local ISO" disabled={state.busy || state.connecting} onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file); }} /></label>
        <small>Nothing is uploaded. Extract 7z archives first.</small>
      </div>
      <div ref={viewportRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
    <div className="viewer-caption"><span><i /> ORIGINAL-ASSET VIEWER — NOT GAMEPLAY</span><span id="frame-info">FRAME {state.frame.toString().padStart(4, '0')}</span></div>
    <p className="scope">These are original Melee assets, animated from the disc. Combat, movement physics, original camera logic, audio, and multiplayer are not running. Materials and lighting are approximated.</p>
  </section>;
}
