import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { root } from './shared.ts';
import { openIsoSource, type IsoSource } from '../server/iso-source.ts';
import { createMeleeServer } from '../server/http.ts';

// Optional repo-root .env (ignored by Git); variables already in the environment win.
try { process.loadEnvFile(join(root, '.env')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const host = process.env.SMASH_HOST ?? '0.0.0.0';
const port = Number(process.env.SMASH_PORT ?? 5273);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('SMASH_PORT must be an integer from 0 to 65535.');
// Disc policy. `server` (default): this host verifies its own ISO and streams the allowlisted
// assets. `client`: every player must select their own ISO in the browser; no disc is opened
// here and no game asset is served.
const discSource = process.env.SMASH_DISC_SOURCE ?? 'server';
if (discSource !== 'server' && discSource !== 'client') throw new Error('SMASH_DISC_SOURCE must be "server" or "client".');
const clientAce = process.env.SMASH_CLIENT_ACE ?? 'optional';
if (clientAce !== 'optional' && clientAce !== 'required' && clientAce !== 'off') throw new Error('SMASH_CLIENT_ACE must be "optional", "required" or "off".');
let source: IsoSource | undefined;
if (discSource === 'server') {
  let input = process.env.MELEE_ISO;
  if (!input) {
    const report = JSON.parse(await readFile(join(root, 'private/disc-report.json'), 'utf8')) as { input?: unknown };
    if (typeof report.input !== 'string') throw new Error('Set MELEE_ISO or run disc:import first.');
    input = report.input;
  }
  console.log('Verifying the server-side Melee ISO before exposing any assets…');
  const aceInput = process.env.MELEE_ACE_ISO;
  console.log(aceInput ? 'Registering the ACE 2.0 extension disc (allowlisted ACE assets only)…' : 'No MELEE_ACE_ISO: original roster only.');
  source = await openIsoSource(resolve(root, input), aceInput ? resolve(root, aceInput) : undefined);
}
const databasePath = process.env.SMASH_DB_PATH === 'off' ? undefined : resolve(root, process.env.SMASH_DB_PATH ?? 'private/accounts.sqlite');
const analyticsPath = process.env.SMASH_ANALYTICS_DB === 'off' ? undefined : resolve(root, process.env.SMASH_ANALYTICS_DB ?? 'private/analytics.sqlite');
/** Voice ICE servers (JSON array of RTCIceServer). `[]` = LAN-only host candidates; unset = public STUN. */
let iceServers: unknown[] | undefined;
if (process.env.SMASH_ICE_SERVERS) {
  try {
    const parsed: unknown = JSON.parse(process.env.SMASH_ICE_SERVERS);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    iceServers = parsed;
  } catch { console.warn('SMASH_ICE_SERVERS is not a JSON array; using the default public STUN servers.'); }
}
try {
  const server = await createMeleeServer({
    // Explicit host-only staging override; HTTP callers can never select a filesystem root.
    ...(source ? { source } : { clientAce }), staticRoot: process.env.SMASH_DIST_PATH ? resolve(root, process.env.SMASH_DIST_PATH) : join(root, 'dist'),
    allowedHosts: process.env.SMASH_ALLOWED_HOSTS?.split(',').map((host) => host.trim()).filter(Boolean),
    // Android self-update channel directory (host-only; see docs/ANDROID.md).
    androidDir: process.env.SMASH_ANDROID_DIR ? resolve(root, process.env.SMASH_ANDROID_DIR) : undefined,
    // Accounts + cloud saves + friends (SQLite). SMASH_DB_PATH=off disables them.
    databasePath,
    // Client performance telemetry (JSONL per day). SMASH_PERF_DIR=off disables intake;
    // SMASH_PERF_TOKEN enables authenticated downloads for scripts/perf-report.ts.
    perfDir: process.env.SMASH_PERF_DIR === 'off' ? undefined : resolve(root, process.env.SMASH_PERF_DIR ?? 'private/perf'),
    perfToken: process.env.SMASH_PERF_TOKEN || undefined,
    // Visit/usage analytics (SQLite, no dashboard). SMASH_ANALYTICS_DB=off disables them.
    analyticsPath,
    ...(iceServers ? { iceServers } : {}),
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const bound = server.address();
  const actualPort = typeof bound === 'object' && bound ? bound.port : port;
  console.log(source
    ? `Verified ${source.manifest.gameId} USA v1.02. ${source.manifest.files.length} runtime assets available${source.manifest.modded ? ' (original + ACE 2.0)' : ' (original only)'}.`
    : `Client-disc mode: players select their own ISO in the browser (ACE 2.0 ${clientAce}). No disc is opened and no game asset is served here.`);
  console.log(`Listening on ${host}:${actualPort}. Rendering and animation playback stay in the browser.`);
  console.log(`Play: http://127.0.0.1:${actualPort}/play.html`);
  if (host === '0.0.0.0') for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) if (address.family === 'IPv4' && !address.internal && !name.startsWith('br-') && !name.startsWith('docker')) {
      console.log(`Network: http://${address.address}:${actualPort}/play.html (${name})`);
    }
  }
  console.log(process.env.SMASH_PERF_DIR === 'off' ? 'Performance telemetry intake is disabled (SMASH_PERF_DIR=off).' : `Performance telemetry: ${resolve(root, process.env.SMASH_PERF_DIR ?? 'private/perf')}${process.env.SMASH_PERF_TOKEN ? ' (export enabled)' : ' (export disabled: set SMASH_PERF_TOKEN)'}`);
  console.log(databasePath ? `Accounts, cloud saves and friends: ${databasePath}` : 'Accounts are disabled (SMASH_DB_PATH=off).');
  console.log(analyticsPath ? `Visit analytics: ${analyticsPath}` : 'Visit analytics are disabled (SMASH_ANALYTICS_DB=off).');
  console.log('LAN rooms stay trusted-network only; accounts never gate asset reads.');
  console.log('No full-ISO, executable, arbitrary disc-file, or private-directory endpoint exists.');
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    console.log('Closing the asset server and its read-only ISO handle…');
    server.close((error) => {
      void Promise.resolve(source?.close()).then(() => { process.exitCode = error ? 1 : 0; }).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
    });
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
} catch (error) { await source?.close(); throw error; }
