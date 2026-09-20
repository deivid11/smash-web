import { useEffect, useRef, useState } from 'react';
import { checkRngReplay, rngProbe, type RngProbe } from '../../../lib/probe.ts';
import { errorText } from './local-disc.ts';

interface Manifest { upstreamCommit: string; wasmBytes: number; upstreamSource: string }

function RngPlot({ values }: { values: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !values.length) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = '#25342f'; context.lineWidth = 1;
    for (let row = 1; row < 5; row++) {
      context.beginPath(); context.moveTo(0, row * height / 5); context.lineTo(width, row * height / 5); context.stroke();
    }
    const step = width / values.length;
    values.forEach((value, index) => {
      const barHeight = Math.max(3, value / 65535 * (height - 30));
      context.fillStyle = index === values.length - 1 ? '#f5b36c' : '#99f5ce';
      context.fillRect(index * step + 18, height - barHeight, step - 36, barHeight);
    });
    return () => context.clearRect(0, 0, width, height);
  }, [values]);
  return <div className="plot"><canvas ref={canvasRef} id="rng-plot" width="1000" height="300" aria-label="Plot of twelve outputs from Melee's random-number generator" /><div className="plot-label"><span>HSD_Rand()</span><span>12 SAMPLES / UINT16</span></div></div>;
}

export function RngPanel() {
  const probe = useRef<RngProbe | undefined>(undefined);
  const seedRef = useRef('1');
  const [seed, setSeed] = useState('1');
  const [manifest, setManifest] = useState<Manifest>();
  const [status, setStatus] = useState('LOADING');
  const [result, setResult] = useState('Loading the WebAssembly module…');
  const [values, setValues] = useState<number[]>([]);

  function runProbe(valueText: string) {
    if (!probe.current) return;
    const value = Number(valueText);
    if (!valueText || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      setResult('Choose an integer seed between 0 and 4294967295.'); return;
    }
    const replay = checkRngReplay(probe.current, value);
    setResult(replay.restored ? '✓ Seed restored. All 12 outputs match.' : 'Replay mismatch. The probe failed.');
    setValues(replay.values);
  }

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const [binary, manifestResponse] = await Promise.all([
          fetch('/wasm/melee-probe.wasm', { signal }), fetch('/wasm/probe.build.json', { signal }),
        ]);
        if (!binary.ok || !manifestResponse.ok) throw new Error('Build the probe first with npm run wasm:build.');
        const bytes = await binary.arrayBuffer(); signal.throwIfAborted();
        const { instance } = await WebAssembly.instantiate(bytes, {});
        signal.throwIfAborted();
        if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
        const metadata = await manifestResponse.json() as Manifest;
        signal.throwIfAborted();
        probe.current = rngProbe(instance);
        setManifest(metadata); setStatus('WASM READY'); runProbe(seedRef.current);
      } catch (error) {
        if (!signal.aborted) { setStatus('UNAVAILABLE'); setResult(errorText(error)); }
      }
    }
    void load();
    return () => { controller.abort(); probe.current = undefined; };
  }, []);

  return <section className="panel probe-panel" aria-labelledby="probe-title">
    <div className="panel-heading"><div><p className="eyebrow">01 / EXECUTION</p><h2 id="probe-title">The original code, alive.</h2></div><span className={`status${status === 'UNAVAILABLE' ? ' error' : ''}`} id="wasm-status" role="status">{status}</span></div>
    <p className="muted">Melee’s unchanged HSD random-number generator, compiled from the pinned decompilation source.</p>
    <RngPlot values={values} />
    <form id="probe-form" className="probe-controls" onSubmit={(event) => { event.preventDefault(); runProbe(seed); }}>
      <label htmlFor="seed">INITIAL SEED<input id="seed" name="seed" type="number" min="0" max="4294967295" step="1" value={seed} onChange={(event) => { seedRef.current = event.target.value; setSeed(event.target.value); }} required /></label>
      <button id="run-probe" type="submit" disabled={status !== 'WASM READY'}>Run replay check <span>↗</span></button>
    </form>
    <p className="result" id="probe-result" role="status">{result}</p>
    <code id="rng-values" className="values">{values.length ? values.join(' · ') : '—'}</code>
    <p className="fine">The check saves the RNG seed, generates a sequence, restores the seed, and repeats. This verifies only RNG repeatability—not full-game determinism or rollback.</p>
    <div className="source-footer"><span>UPSTREAM</span><a id="source-link" href={manifest ? `https://github.com/doldecomp/melee/blob/${manifest.upstreamCommit}/${manifest.upstreamSource}` : undefined} target="_blank" rel="noreferrer">{manifest ? manifest.upstreamCommit.slice(0, 12) : 'Loading revision…'}</a><span id="wasm-size">{manifest && `${manifest.wasmBytes} B WASM`}</span></div>
  </section>;
}
