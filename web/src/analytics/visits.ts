/** Visit and usage beacon for the host's statistics (server/analytics.ts, POST /api/visit).
 *
 * It only observes the play UI store — it never touches simulation, rollback or input — and
 * reports one page session: a coarse device summary at start, `engaged` on the first real
 * input, and usage events derived from view changes (ready, scene, mode, match start/end).
 * Reports are batched, sent on a slow heartbeat while the tab is visible, and flushed with
 * sendBeacon when the page hides. A 404 means the host disabled statistics: reporting stops.
 *
 * What leaves the browser is deliberately general: the page CLASS (never the path, which can
 * carry a username), the referring site's HOST (never its URL), a short campaign slug, and
 * error CLASSES (never messages). No names, account ids, inputs or chat are ever sent.
 * The data is pseudonymous rather than anonymous: a random visitor number kept in localStorage
 * tells new from returning visits. Browsers asking not to be tracked (DNT / Global Privacy
 * Control) send no visitor number and say so, and the server then stores no address hash.
 * The player's own switch (Options → Privacy) stops all reporting and deletes that number;
 * it cannot delete rows the host already stored. */
import type { GameSession, PlayView } from '../play/game-session.ts';
import { activeSeats } from '../../../lib/game/setup.ts';
import { hasNativeBridge } from '../android-bridge.ts';

const ENDPOINT = '/api/visit';
const VISITOR_KEY = 'smash-visitor';
const HEARTBEAT_MS = 60_000;
const MAX_QUEUE = 40;

interface VisitEvent { type: string; data?: Record<string, unknown> }

function randomId(): string {
  const bytes = new Uint8Array(12);
  (globalThis.crypto ?? { getRandomValues: (array: Uint8Array) => { for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256); return array; } }).getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

/** Persistent random visitor id, or null when tracking is declined or storage is unavailable. */
function visitorId(): { id: string | null; returning: boolean } {
  if (optedOut()) return { id: null, returning: false };
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored && /^[a-f0-9]{24}$/u.test(stored)) return { id: stored, returning: true };
    const created = randomId();
    localStorage.setItem(VISITOR_KEY, created);
    return { id: created, returning: false };
  } catch { return { id: null, returning: false }; }
}

const OPT_OUT_KEY = 'smash-analytics';
let stopActive: (() => void) | null = null;
/** The player's own switch (Options → Privacy). Off = nothing is ever sent from this browser. */
export function analyticsEnabled(): boolean {
  try { return localStorage.getItem(OPT_OUT_KEY) !== 'off'; } catch { return true; }
}
/** Persists the choice. Turning it off stops this session at once, without a farewell report. */
export function setAnalyticsEnabled(enabled: boolean): void {
  try { if (enabled) localStorage.removeItem(OPT_OUT_KEY); else { localStorage.setItem(OPT_OUT_KEY, 'off'); localStorage.removeItem(VISITOR_KEY); } } catch { /* private mode: session-only */ }
  if (!enabled) { stopActive?.(); stopActive = null; }
}

/** Page class only: a path can carry a username (/players/<name>). */
export function visitPageClass(path: string): 'play' | 'players' | 'viewer' | 'other' {
  if (path === '/players' || path.startsWith('/players/')) return 'players';
  if (path === '/' || path === '/play' || path === '/play.html') return 'play';
  if (path === '/viewer' || path === '/viewer.html') return 'viewer';
  return 'other';
}
/** The referring site's host, never its URL (queries can carry secrets); null for same-site. */
function referrerHost(): string | null {
  try {
    if (!document.referrer) return null;
    const host = new URL(document.referrer).host;
    return host && host !== location.host ? host : null;
  } catch { return null; }
}
/** Link tag (?ref= / ?utm_source=) as a short slug, else nothing. */
function campaignSlug(): string | null {
  const params = new URLSearchParams(location.search), value = params.get('utm_source') ?? params.get('ref');
  return value && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$/u.test(value) ? value : null;
}
/** Error class only: messages can contain file names and addresses. */
function errorKind(message: string): 'source' | 'wasm' | 'webgl' | 'other' {
  if (/wasm/iu.test(message)) return 'wasm';
  if (/webgl|gpu|context/iu.test(message)) return 'webgl';
  if (/disc|iso|asset|manifest|server|game data|source/iu.test(message)) return 'source';
  return 'other';
}

/** Starts reporting for this page session; the returned function stops it (flushing once). */
export function trackVisit(session: GameSession): () => void {
  // Only hosts running the game server have the endpoint; static builds stay silent.
  if (document.querySelector('meta[name="smash-source"]')?.getAttribute('content') !== 'server' || !analyticsEnabled()) return () => {};
  const visit = randomId(), opened = performance.now();
  const visitor = visitorId();
  let start: Record<string, unknown> | null = {
    visitor: visitor.id, returning: visitor.returning, dnt: optedOut(), page: visitPageClass(location.pathname),
    referrerHost: referrerHost(), campaign: campaignSlug(),
    language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenW: screen.width, screenH: screen.height, pixelRatio: devicePixelRatio,
    touch: navigator.maxTouchPoints > 0, standalone: matchMedia('(display-mode: standalone)').matches,
    nativeApp: hasNativeBridge(), webdriver: navigator.webdriver === true,
  };
  let queue: VisitEvent[] = [], engaged = false, disabled = false, stopped = false;
  let activeMs = 0, visibleSince: number | null = document.visibilityState === 'visible' ? performance.now() : null;
  const active = () => Math.round(activeMs + (visibleSince === null ? 0 : performance.now() - visibleSince));

  const flush = (beacon = false): void => {
    if (disabled) return;
    const body = JSON.stringify({ v: 1, visit, ...(start ? { start } : {}), engaged, activeMs: active(), events: queue });
    queue = [];
    if (beacon && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) { start = null; return; }
    const hadStart = start !== null; start = null;
    void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' })
      .then((response) => { if (response.status === 404 || response.status === 405) disabled = true; })
      .catch(() => { if (hadStart) disabled = true; });
  };
  const push = (type: string, data?: Record<string, unknown>): void => {
    if (disabled || stopped) return;
    if (queue.length < MAX_QUEUE) queue.push(data ? { type, data } : { type });
    // Milestones go out promptly; the heartbeat carries the rest.
    if (type === 'ready' || type === 'match_start' || type === 'match_end') flush();
  };

  const engage = (): void => {
    if (engaged) return;
    engaged = true;
    for (const name of ['pointerdown', 'keydown', 'touchstart']) removeEventListener(name, engage, true);
    removeEventListener('gamepadconnected', engage);
    flush();
  };
  for (const name of ['pointerdown', 'keydown', 'touchstart']) addEventListener(name, engage, { capture: true, passive: true });
  addEventListener('gamepadconnected', engage);

  // Usage events, derived from view transitions only.
  let previous: PlayView = session.ui.getSnapshot(), matchStarted = 0;
  const matchData = (view: PlayView): Record<string, unknown> => {
    const seats = activeSeats(view.setup.seats);
    return {
      mode: session.online ? (session.spectating ? 'online-spectate' : 'online') : view.scene === 'rogue' ? 'rogue' : view.scene === 'tournament' ? 'tournament' : view.mode ?? 'solo',
      stage: view.setup.stage, players: seats.length, humans: seats.filter((seat) => seat.control === 'human').length,
      fighters: seats.map((seat) => seat.fighter), stocks: view.setup.stocks, items: view.setup.items > 0, teams: !!(view.setup as { teams?: unknown }).teams, hill: !!view.setup.hill,
    };
  };
  const unsubscribe = session.ui.subscribe(() => {
    const view = session.ui.getSnapshot(), before = previous;
    previous = view;
    if (view.ready && !before.ready) push('ready', { ms: Math.round(performance.now() - opened), graphics: view.graphics, discGate: before.discGate !== null });
    if (view.error && !before.error) push('error', { kind: errorKind(view.error) });
    if (view.discGate && !before.discGate) push('disc_gate', { ace: view.discGate.ace });
    if (view.scene !== before.scene) push('scene', { scene: view.scene, from: before.scene });
    if (view.mode !== before.mode && view.mode) push('mode', { mode: view.mode });
    if (view.active && !before.active) { matchStarted = performance.now(); push('match_start', matchData(view)); }
    if (!view.active && before.active) push('match_end', { seconds: Math.round((performance.now() - matchStarted) / 1000), finished: before.ended || view.ended });
  });

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') { visibleSince ??= performance.now(); return; }
    if (visibleSince !== null) { activeMs += performance.now() - visibleSince; visibleSince = null; }
    flush(true);
  };
  const onHide = (): void => { if (visibleSince !== null) { activeMs += performance.now() - visibleSince; visibleSince = null; } flush(true); };
  document.addEventListener('visibilitychange', onVisibility);
  addEventListener('pagehide', onHide);
  const heartbeat = setInterval(() => { if (document.visibilityState === 'visible') flush(); }, HEARTBEAT_MS);
  flush();

  const stop = (report = true): void => {
    if (stopped) return;
    if (report) flush(true); else disabled = true;
    stopped = true;
    clearInterval(heartbeat); unsubscribe();
    document.removeEventListener('visibilitychange', onVisibility); removeEventListener('pagehide', onHide);
    for (const name of ['pointerdown', 'keydown', 'touchstart']) removeEventListener(name, engage, true);
    removeEventListener('gamepadconnected', engage);
  };
  stopActive = () => stop(false);
  return () => stop();
}
