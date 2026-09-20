import type { PadRecord } from '../../lib/input/gamepad-profiles.ts';

/** Native Android bridge (SmashPad WebView interface).
 *
 * Mobile browsers and Android WebViews do not expose the HTML5 Gamepad API,
 * so controllers paired to a phone (Switch Pro, Xbox, PlayStation, USB OTG)
 * are invisible to navigator.getGamepads. The native shell in android/
 * tracks Android InputDevice key/motion events and exposes a snapshot plus
 * vibrators through a `window.SmashPad` JavascriptInterface:
 * - getPads(): JSON [{id,name,buttons:[0/1 x17],axes:[float x4],vibrator}]
 * - rumbleAll(strong, weak, durationMs): all gamepad vibrators (0..1 floats)
 * - vibrateCsv("ms" | "on,off,..." | "0"): phone handset, 0 cancels
 * Button/axis order is the browser-standard layout (see docs/CONTROLLERS.md):
 * 0 south/jump, 1 east/special, 2 west/attack, 3 north, 4 LB/grab, 5 RB/strong,
 * 6 LT/shield, 7 RT/shield, 8 select, 9 start/menu, 10 L3, 11 R3, 12-15 D-pad
 * up/down/left/right, 16 home; axes LX/LY/RX/RY in raw Gamepad convention
 * (up/left negative — the mapping flips Y, the shell never pre-flips).
 * This module is a pure parser/adapter: no DOM access except the optional
 * window.SmashPad handle, so unit tests inject snapshots directly. */
export interface AndroidPadSnapshot {
  id: number;
  name: string;
  buttons: number[];
  axes: number[];
  vibrator: boolean;
  /** USB/Bluetooth vendor/product ids; 0 or absent when the platform hides them. */
  vendor?: number;
  product?: number;
}
export interface SmashPadJs {
  getPads(): string;
  rumbleAll(strong: number, weak: number, durationMs: number): void;
  vibrateCsv(pattern: string): void;
}
/** Native self-update controls (android AppUpdater), absent outside the APK. */
export interface SmashUpdateJs {
  /** Installed app + active game-code bundle, e.g. "app 2026.09.16-2340 · game 2026.09.17-0200". */
  version(): string;
  /** Manual check: the shell answers with its own dialog or toast. */
  check(): void;
  /** Update state JSON (see {@link parseAppUpdateState}); absent on shells before 2026.09.17. */
  state?(): string;
  /** Reload into ready game code, install a newer app, or check now. Absent on older shells. */
  apply?(): void;
}

export type AppUpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'app-update' | 'up-to-date' | 'error' | 'unknown';
/** What the page shows next to its update button. */
export interface AppUpdateState {
  app: string;
  game: string;
  phase: AppUpdatePhase;
  message: string;
  /** Game-code version downloaded and waiting for a reload. */
  ready: string | null;
  /** Newer app version offered by the APK channel. */
  appUpdate: string | null;
  done: number;
  total: number;
  /** True when the shell can report state and apply updates (not just check). */
  interactive: boolean;
}
const PHASES: readonly AppUpdatePhase[] = ['idle', 'checking', 'downloading', 'ready', 'app-update', 'up-to-date', 'error'];

/** Reads the shell's update state; older shells only expose "app X · game Y" + check(). */
export function parseAppUpdateState(updater: SmashUpdateJs): AppUpdateState {
  const text = (value: unknown, max = 120) => (typeof value === 'string' ? value.slice(0, max) : '');
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
  if (typeof updater.state === 'function') {
    try {
      const data = JSON.parse(updater.state()) as Record<string, unknown>;
      const phase = PHASES.includes(data.phase as AppUpdatePhase) ? data.phase as AppUpdatePhase : 'idle';
      return {
        app: text(data.app, 40), game: text(data.game, 60), phase, message: text(data.message, 240),
        ready: typeof data.ready === 'string' ? data.ready.slice(0, 40) : null,
        appUpdate: typeof data.appUpdate === 'string' ? data.appUpdate.slice(0, 40) : null,
        done: count(data.done), total: count(data.total), interactive: typeof updater.apply === 'function',
      };
    } catch { /* fall through to the version string */ }
  }
  let version = '';
  try { version = updater.version(); } catch { /* shell without a version */ }
  const match = /^app\s+(.+?)\s+·\s+game\s+(.+)$/u.exec(version);
  return { app: match?.[1] ?? version, game: match?.[2] ?? '', phase: 'unknown', message: '', ready: null, appUpdate: null, done: 0, total: 0, interactive: false };
}
declare global {
  interface Window {
    SmashPad?: SmashPadJs;
    SmashUpdate?: SmashUpdateJs;
  }
}
export function androidUpdater(): SmashUpdateJs | null {
  try {
    const updater = globalThis.window?.SmashUpdate;
    return updater && typeof updater.version === 'function' && typeof updater.check === 'function' ? updater : null;
  } catch {
    return null;
  }
}

/** Native bridge contract the game code needs from the Android shell. Bump it when web
 * code starts calling a new native method: the shell refuses downloaded web bundles that
 * require a newer API, and the APK update channel delivers the matching shell first. */
export const ANDROID_SHELL_API = 1;
/** Per-bundle manifest (versioned, per-file SHA-256) written by scripts/web-bundle-manifest.ts. */
export const WEB_BUNDLE_MANIFEST = 'web-bundle.json';

/** Browser indices 0..31 stay reserved for navigator.getGamepads; native pads
 * live at 32..63 so the two sources never collide inside ControllerHub. */
export const ANDROID_PAD_INDEX_BASE = 32;

/** True inside the native shell (gamepad bridge present): authorizes server-mode
 * boot without the LAN server's meta stamp (see game-session boot). */
export function hasNativeBridge(): boolean {
  try {
    return !!(globalThis.window as Window & { SmashPad?: unknown } | undefined)?.SmashPad;
  } catch {
    return false;
  }
}

export function androidBridge(): SmashPadJs | null {
  try {
    const bridge = globalThis.window?.SmashPad;
    if (!bridge || typeof bridge.getPads !== 'function') return null;
    return bridge;
  } catch {
    return null;
  }
}

/** Parse one native snapshot into a validated record. Returns null for
 * malformed entries (out-of-range counts, nonfinite axes, bad id). */
export function androidSnapshotToPad(snapshot: unknown): PadRecord | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const record = snapshot as Partial<AndroidPadSnapshot>;
  if (!Number.isInteger(record.id) || record.id! < 0 || record.id! > 1023) return null;
  if (!Array.isArray(record.buttons) || record.buttons.length > 64) return null;
  if (!Array.isArray(record.axes) || record.axes.length > 32) return null;
  const buttons = record.buttons.map((value) => ({ pressed: value === 1, value: value === 1 ? 1 : 0 }));
  if (buttons.length < 17 || !buttons.every((button) => typeof button.pressed === 'boolean')) return null;
  const axes = record.axes.map((value) => (Number.isFinite(value) ? Math.max(-1, Math.min(1, value as number)) : 0));
  if (axes.length < 4 || axes.some((axis) => !Number.isFinite(axis))) return null;
  const name = typeof record.name === 'string' ? record.name.slice(0, 160) : '';
  // Same shape Chrome gives desktop pads ("Name (STANDARD GAMEPAD Vendor: 054c
  // Product: 09cc)"), so family identification works from the ids even when the
  // name is generic (Sony pads are just "Wireless Controller" over Bluetooth).
  const hex = (value: unknown) => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0xffff ? (value as number).toString(16).padStart(4, '0') : '';
  const vendor = hex(record.vendor), product = hex(record.product);
  const label = name || `Android controller ${record.id}`;
  return {
    index: ANDROID_PAD_INDEX_BASE + (record.id! % 32),
    id: vendor ? `${label} (STANDARD GAMEPAD Vendor: ${vendor}${product ? ` Product: ${product}` : ''})` : label,
    mapping: 'standard',
    connected: true,
    buttons,
    axes,
  };
}

export function parseAndroidPads(json: string): PadRecord[] {
  if (!json || json.length > 65536) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data) || data.length > 8) return [];
  const pads: PadRecord[] = [];
  for (const snapshot of data) {
    const pad = androidSnapshotToPad(snapshot);
    if (pad) pads.push(pad);
  }
  return pads;
}

/** Live native pads through window.SmashPad; [] everywhere else (desktop,
 * iOS, mobile browsers without the shell). Never throws. */
export function androidPads(bridge?: SmashPadJs | null): PadRecord[] {
  let handle = bridge;
  if (handle === undefined) handle = androidBridge();
  if (!handle) return [];
  try {
    return parseAndroidPads(handle.getPads());
  } catch {
    return [];
  }
}

/** Rumble every native gamepad vibrator (Switch Pro / Xbox / PS paired to the
 * phone). Returns true when the call reached the shell. Never throws. */
export function androidRumbleAll(strong: number, weak: number, durationMs: number, bridge?: SmashPadJs | null): boolean {
  let handle = bridge;
  if (handle === undefined) handle = androidBridge();
  if (!handle || typeof handle.rumbleAll !== 'function') return false;
  try {
    handle.rumbleAll(
      Math.min(1, Math.max(0, strong)),
      Math.min(1, Math.max(0, weak)),
      Math.max(0, Math.min(1000, Math.round(durationMs))),
    );
    return true;
  } catch {
    return false;
  }
}

/** Phone-handset vibration through the shell (works inside the WebView even
 * where navigator.vibrate is throttled). Pattern follows navigator.vibrate
 * semantics; 0 cancels. Returns true when the shell accepted it. */
export function androidVibrate(pattern: number | number[], bridge?: SmashPadJs | null): boolean {
  let handle = bridge;
  if (handle === undefined) handle = androidBridge();
  if (!handle || typeof handle.vibrateCsv !== 'function') return false;
  const csv = Array.isArray(pattern) ? pattern.map((value) => Math.max(0, Math.round(value))).join(',') : String(Math.max(0, Math.round(pattern)));
  if (csv.length > 256) return false;
  try {
    handle.vibrateCsv(csv);
    return true;
  } catch {
    return false;
  }
}
