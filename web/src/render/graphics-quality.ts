/** Cosmetic graphics presets. They change render resolution, the Stadium display
 * feed and the live particle budget only; simulation, snapshots and hashes never
 * read them. `high` is the historical fixed behavior. */
export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';
export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['low', 'medium', 'high', 'ultra'];
export interface GraphicsPreset {
  label: string; note: string;
  /** Device pixel ratio to render at for a given browser ratio. */
  pixelRatio: (devicePixelRatio: number) => number;
  /** Stadium jumbotron feed: capture every N simulation frames at this target size. */
  stadiumInterval: number; stadiumTarget: readonly [number, number];
  /** Maximum live particle sprites; null means every simulated particle is drawn. */
  particleLimit: number | null;
  /** True-silhouette shadow strength on every tier (0 = off): low tiers get a
   * lighter cast so weak devices keep their headroom. Presentation only. */
  shadowStrength: number;
  /** Penumbra taps drawn per part: fewer on low tiers where fill rate is scarce. */
  shadowTaps: number;
  /** Ultra-only rich key+fill+hemisphere shading in the custom GX shader. */
  richLight: boolean;
}
export const GRAPHICS_PRESETS: Readonly<Record<GraphicsQuality, GraphicsPreset>> = {
  low: { label: 'Low', note: '75% render scale, 8-frame stadium feed, 96 particles, light shadows', pixelRatio: ratio => Math.min(ratio, 1) * 0.75, stadiumInterval: 8, stadiumTarget: [256, 128], particleLimit: 96, shadowStrength: 0.35, shadowTaps: 1, richLight: false },
  medium: { label: 'Medium', note: '1× render scale, 4-frame stadium feed, 192 particles, soft shadows', pixelRatio: ratio => Math.min(ratio, 1), stadiumInterval: 4, stadiumTarget: [512, 256], particleLimit: 192, shadowStrength: 0.5, shadowTaps: 2, richLight: false },
  high: { label: 'High', note: 'Native scale up to 2×, 2-frame stadium feed, all particles, soft shadows', pixelRatio: ratio => Math.min(ratio, 2), stadiumInterval: 2, stadiumTarget: [512, 256], particleLimit: null, shadowStrength: 0.7, shadowTaps: 3, richLight: false },
  ultra: { label: 'Extra high', note: '1.5× supersampling up to 3×, per-frame stadium feed at 1024×512, full shadows + rich lighting', pixelRatio: ratio => Math.min(ratio * 1.5, 3), stadiumInterval: 1, stadiumTarget: [1024, 512], particleLimit: null, shadowStrength: 1, shadowTaps: 3, richLight: true },
};
export const GRAPHICS_STORAGE_KEY = 'smash-web.graphics';
/** User-facing graphics mode: `auto` adapts the effective preset to measured
 * frame times (freely between low and ultra); an explicit preset is pinned
 * and the stepper never touches it. Stored separately from the preset. */
export type GraphicsMode = GraphicsQuality | 'auto';
export const GRAPHICS_MODES: readonly GraphicsMode[] = ['auto', 'low', 'medium', 'high', 'ultra'];
export const GRAPHICS_MODE_KEY = 'smash-web.graphics.mode';
export function isGraphicsMode(value: unknown): value is GraphicsMode {
  return value === 'auto' || isGraphicsQuality(value);
}
/** Stored mode, else the legacy stored preset (an explicit past choice stays
 * pinned), else fresh installs start on adaptive `auto`. */
export function loadGraphicsMode(): GraphicsMode {
  try {
    const mode = storage()?.getItem(GRAPHICS_MODE_KEY);
    if (isGraphicsMode(mode)) return mode;
    return loadManualQuality() ?? 'auto';
  } catch {
    return loadManualQuality() ?? 'auto';
  }
}
export function saveGraphicsMode(mode: GraphicsMode): void { try { storage()?.setItem(GRAPHICS_MODE_KEY, mode); } catch { /* session-only */ } }
/** Auto-stepped preset, stored separately so an automatic downgrade never
 * overwrites the user's manual choice. The manual key above always wins.
 * v3: v2 autos were poisoned by boot/menu hitch frames (the old stepper
 * measured loading stutters and ratcheted down permanently with no step-up),
 * so every client re-probes from its manual preset once. */
export const GRAPHICS_AUTO_KEY = 'smash-web.graphics.auto3';
export function isGraphicsQuality(value: unknown): value is GraphicsQuality { return typeof value === 'string' && (GRAPHICS_QUALITIES as readonly string[]).includes(value); }
function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
/** Stored manual preference, or null on first launch (heuristic applies). */
export function loadManualQuality(): GraphicsQuality | null {
  try { const value = storage()?.getItem(GRAPHICS_STORAGE_KEY); return isGraphicsQuality(value) ? value : null; }
  catch { return null; }
}
/** Stored preference, else the first-launch heuristic (TV/small devices start low). */
export function loadGraphicsQuality(): GraphicsQuality {
  const manual = loadManualQuality();
  if (manual) return manual;
  try { return chooseInitialQuality(); } catch { return 'high'; }
}
export function saveGraphicsQuality(quality: GraphicsQuality): void { try { storage()?.setItem(GRAPHICS_STORAGE_KEY, quality); } catch { /* Quota or private mode: the session value still applies. */ } }
/** Last automatic downgrade, if any. Never auto-steps up past the manual preset. */
export function loadAutoQuality(): GraphicsQuality | null {
  try { const value = storage()?.getItem(GRAPHICS_AUTO_KEY); return isGraphicsQuality(value) ? value : null; }
  catch { return null; }
}
export function saveAutoQuality(quality: GraphicsQuality): void { try { storage()?.setItem(GRAPHICS_AUTO_KEY, quality); } catch { /* session-only */ } }
export function clearAutoQuality(): void { try { storage()?.removeItem(GRAPHICS_AUTO_KEY); } catch { /* session-only */ } }
/** One step down the cost ladder; `low` is the floor. */
export function stepDownQuality(quality: GraphicsQuality): GraphicsQuality {
  const index = GRAPHICS_QUALITIES.indexOf(quality);
  return GRAPHICS_QUALITIES[Math.max(0, index - 1)]!;
}
/** Order index for "never step past manual" comparisons. */
export function qualityIndex(quality: GraphicsQuality): number { return GRAPHICS_QUALITIES.indexOf(quality); }

export interface DeviceCaps {
  userAgent?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  gpu?: string;
}
const TV_UA = /(silk|\baft|fire tv|smart-tv|smarttv|googletv|appletv|tizen|webos|viera|bravia|roku|hbbtv)/i;
/** First-launch heuristic: TV shells, tiny memories, few cores or weak mobile
 * GPUs start at `low` instead of the historical `high` default. */
export function chooseInitialQuality(caps: DeviceCaps = {}): GraphicsQuality {
  const ua = caps.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (ua && TV_UA.test(ua)) return 'low';
  if (caps.deviceMemory !== undefined && caps.deviceMemory <= 2) return 'low';
  if (caps.hardwareConcurrency !== undefined && caps.hardwareConcurrency <= 4) return 'low';
  const gpu = (caps.gpu ?? '').toLowerCase();
  if (gpu && /(mali-4|mali-t6|mali-t7|mali-g31|adreno-3|adreno-4|videocore|powervr-sgx)/.test(gpu)) return 'low';
  return 'high';
}
/** True for TV-class devices where the drawing buffer is capped at 1080p
 * regardless of panel size or devicePixelRatio. */
export function isTvClassDevice(caps: DeviceCaps = {}): boolean {
  const ua = caps.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (ua && TV_UA.test(ua)) return true;
  if (caps.deviceMemory !== undefined && caps.deviceMemory <= 2 && (caps.hardwareConcurrency ?? 8) <= 4) return true;
  return false;
}
/** Clamp a pixel ratio so width×height never exceeds 1920×1080. */
export function capPixelRatioFor1080(width: number, height: number, ratio: number): number {
  if (!(width > 0 && height > 0 && ratio > 0)) return ratio;
  const max = 1920 * 1080;
  if (width * height * ratio * ratio <= max) return ratio;
  return Math.sqrt(max / (width * height));
}

/** Auto-step policy: p95 frame time above ~20 ms sustained steps down,
 * below ~12 ms sustained steps back up toward (never past) the manual
 * preset. The dead zone between avoids flip-flopping on borderline hardware.
 * Context-creation flags (antialias/preserveDrawingBuffer, see play-renderer)
 * only apply on the next session/renderer rebuild; resolution, stadium feed
 * and particle budget apply immediately via setQuality. */
export const AUTO_STEP_P95_MS = 20;
export const AUTO_STEP_UP_P95_MS = 12;
export function shouldAutoStepDown(p95Ms: number): boolean { return p95Ms > AUTO_STEP_P95_MS; }
export function shouldAutoStepUp(p95Ms: number): boolean { return p95Ms < AUTO_STEP_UP_P95_MS; }
