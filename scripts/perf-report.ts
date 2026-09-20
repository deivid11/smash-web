/** Client performance report: pulls telemetry uploads (web/src/perf/telemetry.ts →
 * POST /api/perf → JSONL per day) from a game server or local files, merges them per
 * match, groups matches by device class and player count, and explains where frame
 * time goes plus the likely bottleneck.
 *
 *   npx tsx scripts/perf-report.ts --url https://YOUR_HOST --token "$SMASH_PERF_TOKEN" [--days 3]
 *   npx tsx scripts/perf-report.ts private/perf                  # directory or .jsonl files
 *
 * Filters: --players 8  --mode solo|lan  --device <text>  --since 2026-09-17  --match <id>
 * Output:  --matches (list every match)  --json <file> (merged matches + group metrics)
 * Downloads are cached under private/perf-cache/<host>/ (re-fetched when the size changes). */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { root } from './shared.ts';
import { spanParent } from '../lib/perf/profiler.ts';

interface Stat { mean: number; p50: number; p95: number; p99: number; max: number }
interface Window {
  seq: number; t: number; wall: number; frames: number; pausedFrames: number; stalls: number; rendered: number; steps: number; saturated: number;
  skip: [number, number, number]; delta: Stat; hist: number[]; work: Stat; browser: Stat | null; gpu: (Stat & { n: number }) | null;
  spans: Record<string, { mean: number; p95: number; max: number; calls: number; frames: number }>;
  worst: Array<{ t: number; delta: number; work: number; browser: number | null; steps: number; spans: Record<string, number> }>;
  scene: { callsMean: number; callsMax: number; trianglesMean: number; particlesMax: number; projectilesMax: number; itemsMax: number; draws?: Record<string, number> | null };
  heap: { usedMb: number; totalMb: number; limitMb: number } | null;
  net: { rollbacks: number; resimulated: number; prediction: number; latencyMs: number | null } | null;
  loaf: Array<{ duration: number; blocking: number; scripts: Array<{ fn: string; src: string; invoker: string; duration: number }> }>;
  quality: string; pixelRatio: number;
}
interface Device { userAgent: string; platform: string; mobile: boolean | null; model: string; cores: number | null; memoryGb: number | null; dpr: number; gpuRenderer: string; gpuTimer: boolean; androidShell: boolean; bundle: string; timerPrecisionMs: number }
interface Context { mode: string; online: boolean; players: number; humans: number; cpus: number; fighters: string[]; stage: string; rules: string[]; quality: string; graphicsMode: string; pixelRatio: number; buffer: [number, number]; smoothMotion: boolean; shadows: boolean }
interface Upload { receivedAt: string; client: string; session: { id: string }; device: Device | null; match: { id: string; startedAt: string; context: Context }; part: number; windows: Window[]; events: Array<{ t: number; type: string; detail: string }>; summary: unknown; endReason: string | null }
interface Match { id: string; client: string; session: string; startedAt: string; device: Device | null; context: Context; windows: Window[]; events: Upload['events']; endReason: string | null; parts: number }

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const flag = (name: string): boolean => args.includes(`--${name}`);
const positional = args.filter((arg, index) => !arg.startsWith('--') && !(index > 0 && args[index - 1]!.startsWith('--') && !['--matches'].includes(args[index - 1]!)));

async function loadLines(): Promise<string[]> {
  const url = option('url');
  if (url) {
    const token = option('token') ?? process.env.SMASH_PERF_TOKEN;
    if (!token) throw new Error('Pass --token or set SMASH_PERF_TOKEN.');
    const headers = { Authorization: `Bearer ${token}` };
    const listing = await fetch(new URL('/api/perf/files', url), { headers });
    if (!listing.ok) throw new Error(`Listing failed: HTTP ${listing.status} ${await listing.text()}`);
    const { files } = await listing.json() as { files: Array<{ name: string; size: number }> };
    const since = sinceDate();
    const cache = join(root, 'private/perf-cache', new URL(url).host);
    await mkdir(cache, { recursive: true });
    const lines: string[] = [];
    for (const file of files) {
      if (since && file.name.slice(5, 15) < since.slice(0, 10)) continue;
      const path = join(cache, file.name);
      const cached = await stat(path).then(info => info.size, () => -1);
      if (cached !== file.size) {
        const response = await fetch(new URL(`/api/perf/files/${file.name}`, url), { headers });
        if (!response.ok) throw new Error(`Download ${file.name} failed: HTTP ${response.status}`);
        await writeFile(path, Buffer.from(await response.arrayBuffer()));
        console.error(`downloaded ${file.name} (${(file.size / 1024).toFixed(0)} KB)`);
      }
      lines.push(...(await readFile(path, 'utf8')).split('\n'));
    }
    return lines;
  }
  const inputs = positional.length ? positional : [join(root, 'private/perf')];
  const lines: string[] = [];
  for (const input of inputs) {
    const path = resolve(input), info = await stat(path);
    const files = info.isDirectory() ? (await readdir(path)).filter(name => name.endsWith('.jsonl')).sort().map(name => join(path, name)) : [path];
    for (const file of files) lines.push(...(await readFile(file, 'utf8')).split('\n'));
  }
  return lines;
}

function sinceDate(): string | null {
  const since = option('since'), days = option('days');
  if (since) return since;
  if (days) return new Date(Date.now() - Number(days) * 86_400_000).toISOString();
  return null;
}

function mergeMatches(lines: string[]): Match[] {
  const matches = new Map<string, Match & { seqs: Set<number> }>();
  for (const line of lines) {
    if (!line.trim()) continue;
    let upload: Upload;
    try { upload = JSON.parse(line) as Upload; } catch { continue; }
    if (!upload.match?.id || !Array.isArray(upload.windows)) continue;
    let match = matches.get(upload.match.id);
    if (!match) {
      match = { id: upload.match.id, client: upload.client, session: upload.session.id, startedAt: upload.match.startedAt, device: upload.device, context: upload.match.context, windows: [], events: [], endReason: null, parts: 0, seqs: new Set() };
      matches.set(upload.match.id, match);
    }
    match.parts++; match.device ??= upload.device;
    for (const window of upload.windows) if (!match.seqs.has(window.seq)) { match.seqs.add(window.seq); match.windows.push(window); }
    match.events.push(...upload.events);
    if (upload.endReason) match.endReason = upload.endReason;
  }
  const since = sinceDate();
  return [...matches.values()].map(({ seqs: _seqs, ...match }) => ({ ...match, windows: match.windows.sort((a, b) => a.seq - b.seq) }))
    .filter(match => !since || match.startedAt >= since)
    .filter(match => !option('players') || match.context.players === Number(option('players')))
    .filter(match => !option('mode') || match.context.mode === option('mode'))
    .filter(match => !option('match') || match.id.startsWith(option('match')!))
    .filter(match => !option('device') || JSON.stringify(match.device ?? {}).toLowerCase().includes(option('device')!.toLowerCase()))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

interface Metrics {
  frames: number; seconds: number; fps: number; delta: number; deltaP95: number; over17: number; over34: number; over50: number;
  work: number; browser: number; gpu: number | null; stepsPerFrame: number; saturated: number; skipped: number;
  spans: Map<string, { mean: number; calls: number }>; draws: Record<string, number> | null; calls: number;
  heapMb: number | null; rollbacks: number; resimulated: number; latency: number | null; loaf: Window['loaf']; skip: number; quality: string;
}

/** Windows carrying the full measurement set; foreign or partial rows are skipped. */
const complete = (window: Window): boolean => window.frames > 0 && Array.isArray(window.hist) && !!window.delta && !!window.work && !!window.scene;

function metrics(windows: Window[]): Metrics | null {
  const live = windows.filter(complete);
  const frames = live.reduce((sum, window) => sum + window.frames, 0);
  if (!frames) return null;
  const weighted = (pick: (window: Window) => number | null | undefined): number => live.reduce((sum, window) => sum + (pick(window) ?? 0) * window.frames, 0) / frames;
  const hist = live.reduce((acc, window) => acc.map((value, index) => value + (window.hist[index] ?? 0)), new Array<number>(8).fill(0));
  const spans = new Map<string, { mean: number; calls: number }>();
  for (const window of live) for (const [name, span] of Object.entries(window.spans ?? {})) {
    const entry = spans.get(name) ?? { mean: 0, calls: 0 };
    entry.mean += span.mean * window.frames / frames; entry.calls += span.calls * window.frames / frames;
    spans.set(name, entry);
  }
  const gpuWindows = live.filter(window => window.gpu);
  const wall = live.reduce((sum, window) => sum + window.wall, 0);
  const heaps = live.map(window => window.heap?.usedMb).filter((value): value is number => typeof value === 'number');
  const latencies = live.map(window => window.net?.latencyMs).filter((value): value is number => typeof value === 'number');
  const rendered = live.reduce((sum, window) => sum + window.rendered, 0);
  return {
    frames, seconds: wall / 1000, fps: frames / Math.max(0.001, wall / 1000), delta: weighted(window => window.delta.mean), deltaP95: weighted(window => window.delta.p95),
    over17: (hist.slice(3).reduce((a, b) => a + b, 0)) / frames, over34: (hist.slice(5).reduce((a, b) => a + b, 0)) / frames, over50: (hist.slice(6).reduce((a, b) => a + b, 0)) / frames,
    work: weighted(window => window.work.mean), browser: weighted(window => window.browser?.mean),
    gpu: gpuWindows.length ? gpuWindows.reduce((sum, window) => sum + window.gpu!.mean, 0) / gpuWindows.length : null,
    stepsPerFrame: live.reduce((sum, window) => sum + window.steps, 0) / frames,
    saturated: live.reduce((sum, window) => sum + window.saturated, 0) / frames,
    skipped: 1 - rendered / frames,
    spans, draws: live.at(-1)?.scene.draws ?? null, calls: weighted(window => window.scene.callsMean),
    heapMb: heaps.length ? Math.max(...heaps) : null,
    rollbacks: live.reduce((sum, window) => sum + (window.net?.rollbacks ?? 0), 0), resimulated: live.reduce((sum, window) => sum + (window.net?.resimulated ?? 0), 0),
    latency: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    loaf: live.flatMap(window => window.loaf ?? []).sort((a, b) => b.duration - a.duration).slice(0, 5),
    skip: live.reduce((sum, window) => sum + (window.skip?.[1] ?? 0) + (window.skip?.[2] ?? 0), 0),
    quality: `${live.at(-1)!.quality}@${live.at(-1)!.pixelRatio}`,
  };
}

const ms = (value: number | null | undefined, digits = 2): string => value === null || value === undefined ? '   n/a' : value.toFixed(digits).padStart(6);
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const span = (m: Metrics, name: string): number => m.spans.get(name)?.mean ?? 0;

function deviceClass(device: Device | null): string {
  if (!device) return 'unknown device';
  const gpu = device.gpuRenderer.replace(/^ANGLE \(/u, '').replace(/\)$/u, '').replace(/\(0x[0-9A-Fa-f]+\)/gu, '').replace(/Vulkan [\d.]+ |Direct3D11 vs_5_0 ps_5_0, D3D11|OpenGL ES [\d.]+/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 60);
  const kind = device.androidShell ? 'apk' : device.mobile ? 'mobile' : 'desktop';
  return `${device.model || device.platform || '?'} · ${kind} · ${device.cores ?? '?'} cores · ${device.memoryGb ?? '?'} GB · dpr ${device.dpr} · ${gpu || 'gpu ?'}`;
}

function diagnose(m: Metrics): string[] {
  const findings: Array<{ weight: number; text: string }> = [];
  const add = (weight: number, text: string) => findings.push({ weight, text });
  const hud = span(m, 'hud.commit'), receive = span(m, 'net.receive');
  const mainThread = m.work + m.browser + hud + receive;
  const outside = Math.max(0, m.delta - mainThread);
  const slow = m.delta > 17.5 || m.over17 > 0.1;
  if (!slow) add(0, `Holds the frame budget (${ms(m.delta)} ms mean, ${pct(m.over17)} of frames over 17.5 ms).`);
  if (m.gpu !== null && m.gpu > 8) add(m.gpu, `GPU-bound: the main scene takes ${m.gpu.toFixed(1)} ms of GPU time. Lower the render scale/pixel ratio (${m.quality}) or quality preset.`);
  if (mainThread > 12) add(mainThread, `Main-thread CPU-bound: ${mainThread.toFixed(1)} ms per frame (JS tick ${m.work.toFixed(1)}, after-RAF browser work ${m.browser.toFixed(1)}, HUD commit ${hud.toFixed(1)}, network handlers ${receive.toFixed(1)}).`);
  const draw = span(m, 'render.draw');
  if (draw > 0.3 * m.work && draw > 2) add(draw, `WebGL draw submission ${draw.toFixed(1)} ms (${Math.round(m.calls)} draw calls${m.draws ? `: ${Object.entries(m.draws).map(([key, value]) => `${key} ${value}`).join(', ')}` : ''}). Fewer draws/materials per fighter is the lever.`);
  const pose = span(m, 'pose.update') + span(m, 'pose.prepare');
  if (pose > 0.2 * m.work && pose > 1) add(pose, `Pose evaluation + skin palettes ${pose.toFixed(1)} ms (update ${span(m, 'pose.update').toFixed(1)} ×${(m.spans.get('pose.update')?.calls ?? 0).toFixed(1)}, prepare ${span(m, 'pose.prepare').toFixed(1)}).`);
  const sim = span(m, 'sim.step');
  if (sim > 0.25 * m.work && sim > 1) {
    const perStep = sim / Math.max(1, m.spans.get('sim.step')?.calls ?? 1);
    const steps = [...m.spans].filter(([name]) => name.startsWith('step.')).sort((a, b) => b[1].mean - a[1].mean).slice(0, 3).map(([name, value]) => `${name} ${value.mean.toFixed(2)}`).join(', ');
    add(sim, `Simulation ${sim.toFixed(1)} ms per frame (${perStep.toFixed(2)} ms per step; top: ${steps}).`);
  }
  if (m.stepsPerFrame > 1.15) add(m.stepsPerFrame * 2, `Catch-up spiral: ${m.stepsPerFrame.toFixed(2)} simulation steps per frame (slow frames owe extra 60 Hz steps, which makes the next frame slower too).`);
  if (m.saturated > 0.01 || m.skipped > 0.05) add(m.delta, `Overloaded: ${pct(m.saturated)} frames hit the 6-step cap, ${pct(m.skipped)} of frames skipped rendering.`);
  const net = span(m, 'net.hash') + span(m, 'net.resim') + span(m, 'net.snapshot') + receive;
  if (net > 1.5) add(net, `Rollback/netcode ${net.toFixed(1)} ms per frame (hash ${span(m, 'net.hash').toFixed(2)}, resim ${span(m, 'net.resim').toFixed(2)}, snapshot ${span(m, 'net.snapshot').toFixed(2)}); ${m.rollbacks} rollbacks, ${m.resimulated} resimulated frames${m.latency !== null ? `, RTT ${m.latency.toFixed(0)} ms` : ''}.`);
  if (hud > 1) add(hud, `React HUD commits ${hud.toFixed(1)} ms per frame on average.`);
  if (m.browser > 4) add(m.browser, `Browser rendering after the RAF (style/layout/paint/commit, GPU backpressure) ${m.browser.toFixed(1)} ms.`);
  if (slow && outside > 8 && mainThread < 12) add(outside, `${outside.toFixed(1)} ms per frame is spent outside measured main-thread work: vsync/compositor waits, GPU process backpressure, other tabs/tasks or GC.`);
  // usedJSHeapSize counts buffer memory too (decoded textures/geometry), not just objects:
  // see docs/PERF_TELEMETRY.md for splitting it with memory-infra and smashMemorySnapshot().
  if (m.heapMb !== null && m.heapMb > 900) add(1, `Reported JS heap peaks at ${m.heapMb.toFixed(0)} MB (objects plus buffer memory): tab-kill risk on phones.`);
  if (m.loaf.length) add(0.5, `Longest frames: ${m.loaf.slice(0, 3).map(entry => `${entry.duration.toFixed(0)} ms${entry.scripts[0] ? ` (${entry.scripts[0].fn || entry.scripts[0].invoker} ${entry.scripts[0].src} ${entry.scripts[0].duration.toFixed(0)} ms)` : ''}`).join('; ')}.`);
  return findings.sort((a, b) => b.weight - a.weight).map(finding => finding.text);
}

function breakdown(m: Metrics): string[] {
  const rows: string[] = [];
  const names = [...m.spans.keys()];
  const children = (parent: string) => names.filter(name => spanParent(name) === parent).sort((a, b) => span(m, b) - span(m, a));
  const line = (name: string, depth: number, value: number, calls?: number) => rows.push(`${'  '.repeat(depth)}${name.padEnd(22 - depth * 2)} ${ms(value, 3)} ms${calls !== undefined && Math.abs(calls - 1) > 0.05 ? `  ×${calls.toFixed(2)}` : ''}`);
  const walk = (name: string, depth: number) => {
    line(name, depth, span(m, name), m.spans.get(name)?.calls);
    const kids = children(name);
    for (const kid of kids) walk(kid, depth + 1);
    if (kids.length) { const self = span(m, name) - kids.reduce((sum, kid) => sum + span(m, kid), 0); if (self > 0.05) line('(self/other)', depth + 1, self); }
  };
  rows.push(`frame delta            ${ms(m.delta)} ms  (p95 ~${m.deltaP95.toFixed(1)})`);
  rows.push(`  JS tick (work)       ${ms(m.work)} ms`);
  for (const top of children('').filter(name => name.startsWith('frame.'))) walk(top, 2);
  rows.push(`  browser after RAF    ${ms(m.browser)} ms`);
  rows.push(`  GPU (main scene)     ${ms(m.gpu)} ms`);
  const cross = children('').filter(name => !name.startsWith('frame.'));
  if (cross.length) { rows.push('  cross-cutting (overlap the tree above):'); for (const name of cross) line(name, 2, span(m, name), m.spans.get(name)?.calls); }
  return rows;
}

const matches = mergeMatches(await loadLines());
if (!matches.length) { console.log('No matching telemetry.'); process.exit(0); }
const clients = new Set(matches.map(match => match.client)).size;
console.log(`${matches.length} matches from ${clients} clients, ${matches[0]!.startedAt.slice(0, 16)} → ${matches.at(-1)!.startedAt.slice(0, 16)} UTC\n`);

const measured = matches.map(match => ({ match, metrics: metrics(match.windows) })).filter((entry): entry is { match: Match; metrics: Metrics } => entry.metrics !== null);
if (flag('matches') || measured.length <= 12) {
  console.log('when              players mode  stage          quality     fps  delta  >17.5ms  work browser   gpu  draws  device');
  for (const { match, metrics: m } of measured) {
    console.log(`${match.startedAt.slice(5, 16).replace('T', ' ')}  ${String(match.context.players).padStart(7)} ${match.context.mode.padEnd(5)} ${match.context.stage.slice(0, 14).padEnd(14)} ${m.quality.padEnd(9)} ${m.fps.toFixed(1).padStart(5)} ${ms(m.delta, 1)} ${pct(m.over17).padStart(7)} ${ms(m.work, 1)} ${ms(m.browser, 1)} ${ms(m.gpu, 1)} ${String(Math.round(m.calls)).padStart(6)}  ${deviceClass(match.device).slice(0, 70)}`);
  }
  console.log('');
}

const groups = new Map<string, Array<{ match: Match; metrics: Metrics }>>();
for (const entry of measured) {
  const key = `${deviceClass(entry.match.device)}  |  ${entry.match.context.players} players${entry.match.context.online ? ' online' : ''}`;
  groups.set(key, [...(groups.get(key) ?? []), entry]);
}
const report: Array<Record<string, unknown>> = [];
for (const [key, entries] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const combined = metrics(entries.flatMap(entry => entry.match.windows))!;
  console.log(`=== ${key} — ${entries.length} match${entries.length === 1 ? '' : 'es'}, ${combined.seconds.toFixed(0)} s, ${combined.fps.toFixed(1)} fps, ${pct(combined.over17)} frames >17.5 ms, ${pct(combined.over34)} >34 ms`);
  for (const text of diagnose(combined)) console.log(`  • ${text}`);
  console.log('  Frame budget (mean ms per frame):');
  for (const row of breakdown(combined)) console.log(`    ${row}`);
  console.log('');
  report.push({ group: key, matches: entries.map(entry => entry.match.id), metrics: { ...combined, spans: Object.fromEntries(combined.spans) }, findings: diagnose(combined) });
}
const jsonPath = option('json');
if (jsonPath) {
  await writeFile(resolve(jsonPath), JSON.stringify({ generatedAt: new Date().toISOString(), groups: report, matches: measured.map(({ match, metrics: m }) => ({ ...match, metrics: { ...m, spans: Object.fromEntries(m.spans) } })) }, null, 2));
  console.log(`wrote ${jsonPath}`);
}
