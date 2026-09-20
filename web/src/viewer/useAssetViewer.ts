import { useEffect, useRef, useState } from 'react';
import { verifyMeleeDisc } from '../../../lib/disc.ts';
import { HsdAssetSession } from '../../../lib/hsd/session.ts';
import { connectServerSource } from '../../../lib/hsd/server-source.ts';
import { AssetViewer } from '../render/viewer.ts';
import { errorText, localDiscReader } from '../lab/local-disc.ts';
import { buildScene, cameraKind, type SceneSelection, type SceneStats, type SceneMode } from './scene.ts';

export interface ViewerState {
  selection: SceneSelection;
  title: string; status: string; error: boolean; message: string;
  busy: boolean; connecting: boolean; hasScene: boolean; controlsReady: boolean;
  sourceMode: 'local' | 'server' | undefined; sourceStatus: string; privacy: string | undefined;
  frame: number; slider: number; duration: number; playing: boolean;
  stats: SceneStats | undefined; warnings: string[]; sceneReady: SceneMode | undefined;
}
function initialState(server: boolean): ViewerState {
  return {
    selection: { mode: 'battlefield', fighterCount: '2', action: 'Wait1' },
    title: 'Melee, in the browser.', status: server ? 'CONNECTING TO SERVER' : 'SELECT YOUR DISC', error: false,
    message: server ? 'Checking the verified server-side ISO…' : 'Waiting for your local disc.',
    busy: false, connecting: server, hasScene: false, controlsReady: false,
    sourceMode: undefined, sourceStatus: 'SOURCE · LOCAL ISO', privacy: undefined,
    frame: 0, slider: 0, duration: 120, playing: true, stats: undefined, sceneReady: undefined,
    warnings: ['This is an asset renderer, not the complete GX pipeline or game engine.'],
  };
}
interface Runtime {
  lifetime: AbortController; source: AbortController; viewer: AssetViewer | undefined;
  session: HsdAssetSession | undefined; sourceMode: 'local' | 'server';
  selection: SceneSelection; busy: boolean; duration: number;
}

export function useAssetViewer(server: boolean) {
  // React owns the host, never its imperative renderer-owned children.
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const runtime = useRef<Runtime | undefined>(undefined);
  const [state, setState] = useState(() => initialState(server));
  const patch = (rt: Runtime, next: Partial<ViewerState>) => {
    if (!rt.lifetime.signal.aborted) setState((previous) => ({ ...previous, ...next }));
  };
  const fail = (rt: Runtime, error: unknown) => patch(rt, { status: 'RENDER ERROR', error: true, message: errorText(error) });

  async function loadScene(rt: Runtime) {
    if (!rt.session || rt.busy || rt.lifetime.signal.aborted) return;
    rt.busy = true;
    const signal = rt.source.signal;
    const selection = { ...rt.selection };
    patch(rt, { busy: true, controlsReady: false, sceneReady: undefined, error: false, status: rt.sourceMode === 'server' ? 'LOADING SERVER ASSETS' : 'READING LOCAL ASSETS' });
    let built: Awaited<ReturnType<typeof buildScene>> | undefined;
    let transferred = false;
    try {
      built = await buildScene(rt.session, selection, signal, (message) => patch(rt, { message }));
      signal.throwIfAborted();
      if (!rt.viewer) {
        if (!viewportRef.current) throw new Error('The renderer viewport is unavailable.');
        rt.viewer = new AssetViewer(viewportRef.current);
        rt.viewer.onError = (error) => fail(rt, error);
        rt.viewer.onFrame = (frame) => {
          if (rt.lifetime.signal.aborted) return;
          const value = Math.floor(frame % rt.duration);
          setState((previous) => {
            const slider = rt.viewer?.playing ? value : previous.slider;
            return previous.frame === value && previous.slider === slider ? previous : { ...previous, frame: value, slider };
          });
        };
      }
      const active = rt.viewer;
      rt.duration = built.duration;
      active.setCamera(cameraKind(selection.mode));
      // replace owns the instances even if its first draw throws.
      transferred = true; active.replace(built.instances); active.playing = true;
      patch(rt, { hasScene: true, title: built.title, status: 'COMPILING GPU SHADERS' });
      if (active.renderer.extensions.has('KHR_parallel_shader_compile')) await active.renderer.compileAsync(active.scene, active.camera);
      else active.renderer.compile(active.scene, active.camera);
      signal.throwIfAborted(); active.draw();
      patch(rt, {
        stats: built.stats, warnings: built.warnings,
        message: `${rt.sourceMode === 'server' ? 'Read from server' : 'Read locally'}: ${built.loaded.join(', ')}. No gameplay simulation.`,
        status: 'ORIGINAL ASSETS RENDERING', playing: true, duration: built.duration, sceneReady: selection.mode,
      });
    } catch (error) {
      if (!transferred) for (const instance of built?.instances ?? []) instance.dispose();
      if (!signal.aborted) fail(rt, error);
    } finally {
      rt.busy = false;
      patch(rt, { busy: false, controlsReady: !!rt.viewer?.instances.length });
    }
  }

  useEffect(() => {
    const rt: Runtime = {
      lifetime: new AbortController(), source: new AbortController(), viewer: undefined, session: undefined,
      sourceMode: 'local', selection: initialState(server).selection, busy: false, duration: 120,
    };
    runtime.current = rt; setState(initialState(server));
    async function connect() {
      try {
        // Keep the signal on *every* asset fetch, not only /api/source.
        const sourceSignal = rt.source.signal;
        const connected = await connectServerSource((input, init) => fetch(input, { ...init, signal: sourceSignal }), sourceSignal);
        sourceSignal.throwIfAborted();
        if (!connected) throw new Error('This server has no configured disc source. You can still choose a local ISO.');
        rt.session = connected.session; rt.sourceMode = 'server';
        patch(rt, {
          sourceMode: 'server', sourceStatus: `SOURCE · SERVER ISO · ${connected.manifest.gameId}`,
          privacy: 'Selected assets stream from the server. Rendering stays in this browser. The full ISO is not exposed.',
        });
        await loadScene(rt);
      } catch (error) {
        if (!rt.source.signal.aborted) fail(rt, error);
      } finally { patch(rt, { connecting: false }); }
    }
    if (server) void connect();
    const dispose = () => {
      if (rt.lifetime.signal.aborted) return;
      rt.lifetime.abort(); rt.source.abort();
      if (rt.viewer) { rt.viewer.onFrame = undefined; rt.viewer.onError = undefined; rt.viewer.dispose(); rt.viewer = undefined; }
      rt.session = undefined;
    };
    window.addEventListener('pagehide', dispose);
    return () => { window.removeEventListener('pagehide', dispose); dispose(); if (runtime.current === rt) runtime.current = undefined; };
  }, [server]);

  // Public compatibility markers live outside the React root, not in renderer DOM.
  useEffect(() => {
    if (state.sourceMode) document.body.dataset.sourceMode = state.sourceMode;
    else delete document.body.dataset.sourceMode;
    if (state.sceneReady) document.body.dataset.sceneReady = state.sceneReady;
    else delete document.body.dataset.sceneReady;
    return () => { delete document.body.dataset.sourceMode; delete document.body.dataset.sceneReady; };
  }, [state.sourceMode, state.sceneReady]);

  async function inspect(file: File) {
    const rt = runtime.current;
    if (!rt || rt.busy || state.connecting || rt.lifetime.signal.aborted) return;
    // Keep the previous source usable if verification of the replacement fails.
    const candidate = new AbortController();
    const abortCandidate = () => candidate.abort();
    rt.lifetime.signal.addEventListener('abort', abortCandidate, { once: true });
    const signal = candidate.signal;
    rt.busy = true; patch(rt, { busy: true, status: 'VERIFYING DISC' });
    try {
      const reader = localDiscReader(file, signal), info = await verifyMeleeDisc(reader);
      signal.throwIfAborted();
      rt.source.abort(); rt.source = candidate;
      rt.session = new HsdAssetSession(reader, info); rt.sourceMode = 'local';
      patch(rt, { sourceMode: 'local', sourceStatus: 'SOURCE · LOCAL ISO', privacy: 'Disc bytes stay in this browser. No uploads.' });
      rt.busy = false; await loadScene(rt);
    } catch (error) { if (!signal.aborted) fail(rt, error); }
    finally {
      rt.lifetime.signal.removeEventListener('abort', abortCandidate);
      if (rt.source !== candidate) candidate.abort();
      rt.busy = false; patch(rt, { busy: false });
    }
  }

  function select(next: Partial<SceneSelection>) {
    const rt = runtime.current;
    if (!rt || rt.busy || rt.lifetime.signal.aborted) return;
    rt.selection = { ...rt.selection, ...next }; patch(rt, { selection: rt.selection }); void loadScene(rt);
  }
  function togglePlaying() {
    const rt = runtime.current;
    if (!rt?.viewer || rt.lifetime.signal.aborted) return;
    rt.viewer.playing = !rt.viewer.playing; patch(rt, { playing: rt.viewer.playing });
  }
  function seek(frame: number) {
    const rt = runtime.current;
    if (!rt?.viewer || rt.lifetime.signal.aborted) return;
    try {
      rt.viewer.playing = false; rt.viewer.seek(frame);
      patch(rt, { playing: false, frame: Math.floor(rt.viewer.frame), slider: frame });
    } catch (error) { fail(rt, error); }
  }
  function resetCamera() {
    const rt = runtime.current;
    if (!rt?.viewer || rt.lifetime.signal.aborted) return;
    try { rt.viewer.setCamera(cameraKind(rt.selection.mode)); } catch (error) { fail(rt, error); }
  }
  function saveImage() {
    const rt = runtime.current;
    if (!rt?.viewer || rt.lifetime.signal.aborted) return;
    void rt.viewer.screenshot(rt.lifetime.signal).catch((error: unknown) => fail(rt, error));
  }
  return { state, viewportRef, fileRef, inspect, select, togglePlaying, seek, resetCamera, saveImage, chooseLocal: () => fileRef.current?.click() };
}
export type ViewerController = ReturnType<typeof useAssetViewer>;
