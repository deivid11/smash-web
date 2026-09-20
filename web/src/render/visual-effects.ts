/** Screen-space presentation effects layered on top of the original GX/TEV look
 * (see web/src/render/post-processing.ts for the passes themselves).
 *
 * Every effect is cosmetic: simulation, snapshots and hashes never read them.
 * Each one carries its own per-preset tuning, so a phone that forces an effect
 * on still gets the cheap variant of it instead of the desktop one, and the
 * `auto` choice simply follows the preset the device is actually running. */
import type { GraphicsQuality } from './graphics-quality.ts';

export type VisualEffectId = 'bloom' | 'ao' | 'grade' | 'sharpen' | 'vignette';
export const VISUAL_EFFECT_IDS = ['bloom', 'ao', 'grade', 'sharpen', 'vignette'] as const satisfies readonly VisualEffectId[];
/** Per-effect user choice: follow the preset, or pin it on/off everywhere. */
export type VisualEffectChoice = 'auto' | 'on' | 'off';
export type VisualEffectChoices = Readonly<Record<VisualEffectId, VisualEffectChoice>>;
export const DEFAULT_VISUAL_EFFECT_CHOICES: VisualEffectChoices = { bloom: 'auto', ao: 'auto', grade: 'auto', sharpen: 'auto', vignette: 'auto' };

export interface VisualEffectInfo { id: VisualEffectId; label: string; note: string }
/** Menu order, labels and the one-line explanation shown under each control. */
export const VISUAL_EFFECTS: readonly VisualEffectInfo[] = [
  { id: 'bloom', label: 'GLOW', note: 'Light bleeds out of hits, lasers, fire and neon; daylight stays clean.' },
  { id: 'ao', label: 'AMBIENT OCCLUSION', note: 'Contact shading where fighters meet the stage and in crevices.' },
  { id: 'grade', label: 'COLOR GRADE', note: 'Deeper contrast and richer muted colors without changing exposure.' },
  { id: 'sharpen', label: 'SHARPENING', note: 'Restores detail when the render scale is below native.' },
  { id: 'vignette', label: 'VIGNETTE', note: 'Softly darkens the corners so the arena reads as the subject.' },
];

/** One tier's cost/strength tuning. Zero strength means the pass never runs.
 * `*Scale` values are resolution divisors (2 = half the drawing buffer). */
export interface VisualEffectTuning {
  bloomStrength: number; bloomThreshold: number; bloomMargin: number; bloomScale: number; bloomPasses: number;
  aoStrength: number; aoSamples: number; aoRadius: number; aoScale: number;
  gradeStrength: number; gradeContrast: number; gradeVibrance: number;
  sharpenStrength: number;
  vignetteStrength: number;
  /** Multisample count for the offscreen scene target; mirrors the canvas
   * `antialias` flag of the same tier so the picture never loses edges when
   * the chain turns on (low already scales resolution down instead). */
  samples: number;
}
export const VISUAL_EFFECT_TUNING: Readonly<Record<GraphicsQuality, VisualEffectTuning>> = {
  low: { bloomStrength: 0.5, bloomThreshold: 0.72, bloomMargin: 0.28, bloomScale: 4, bloomPasses: 1, aoStrength: 0.4, aoSamples: 6, aoRadius: 7, aoScale: 2, gradeStrength: 0.6, gradeContrast: 0.3, gradeVibrance: 0.25, sharpenStrength: 0.6, vignetteStrength: 0.14, samples: 0 },
  medium: { bloomStrength: 0.55, bloomThreshold: 0.7, bloomMargin: 0.26, bloomScale: 4, bloomPasses: 1, aoStrength: 0.5, aoSamples: 8, aoRadius: 8, aoScale: 2, gradeStrength: 0.7, gradeContrast: 0.3, gradeVibrance: 0.25, sharpenStrength: 0.4, vignetteStrength: 0.16, samples: 4 },
  high: { bloomStrength: 0.65, bloomThreshold: 0.68, bloomMargin: 0.24, bloomScale: 2, bloomPasses: 2, aoStrength: 0.65, aoSamples: 10, aoRadius: 10, aoScale: 2, gradeStrength: 0.85, gradeContrast: 0.32, gradeVibrance: 0.3, sharpenStrength: 0.3, vignetteStrength: 0.18, samples: 4 },
  ultra: { bloomStrength: 0.75, bloomThreshold: 0.66, bloomMargin: 0.22, bloomScale: 2, bloomPasses: 3, aoStrength: 0.8, aoSamples: 12, aoRadius: 12, aoScale: 2, gradeStrength: 1, gradeContrast: 0.34, gradeVibrance: 0.35, sharpenStrength: 0.25, vignetteStrength: 0.2, samples: 4 },
};
/** What `auto` turns on per tier: nothing. The enhancement chain is opt-in —
 * the plain render is the default look on every tier, and each effect is
 * enabled by pinning it On. */
export const VISUAL_EFFECT_DEFAULTS: Readonly<Record<GraphicsQuality, readonly VisualEffectId[]>> = {
  low: [], medium: [], high: [], ultra: [],
};
/** True when the preset itself asks for this effect (what `auto` resolves to). */
export function isEffectDefault(quality: GraphicsQuality, id: VisualEffectId): boolean {
  return VISUAL_EFFECT_DEFAULTS[quality].includes(id);
}

/** Tuning with the disabled effects zeroed out: what the post chain consumes. */
export interface ResolvedVisualEffects extends VisualEffectTuning {
  /** Effects actually running this frame, in menu order. */
  active: readonly VisualEffectId[];
  /** False when nothing is on: the renderer then draws straight to the canvas. */
  enabled: boolean;
}
export function effectEnabled(quality: GraphicsQuality, choices: VisualEffectChoices, id: VisualEffectId): boolean {
  const choice = choices[id] ?? 'auto';
  return choice === 'auto' ? isEffectDefault(quality, id) : choice === 'on';
}
/** Resolves the tier tuning against the user's per-effect choices. Forcing an
 * effect on keeps that tier's own cost profile (sample counts, pass counts and
 * resolution divisors), so a phone never pays desktop prices for it. */
export function resolveVisualEffects(quality: GraphicsQuality, choices: VisualEffectChoices = DEFAULT_VISUAL_EFFECT_CHOICES): ResolvedVisualEffects {
  const tuning = VISUAL_EFFECT_TUNING[quality];
  const on = (id: VisualEffectId): boolean => effectEnabled(quality, choices, id);
  const active = VISUAL_EFFECT_IDS.filter(on);
  return {
    ...tuning,
    bloomStrength: on('bloom') ? tuning.bloomStrength : 0,
    aoStrength: on('ao') ? tuning.aoStrength : 0,
    gradeStrength: on('grade') ? tuning.gradeStrength : 0,
    sharpenStrength: on('sharpen') ? tuning.sharpenStrength : 0,
    vignetteStrength: on('vignette') ? tuning.vignetteStrength : 0,
    active, enabled: active.length > 0,
  };
}

export const VISUAL_EFFECTS_KEY = 'smash-web.effects';
export function isVisualEffectId(value: unknown): value is VisualEffectId { return typeof value === 'string' && (VISUAL_EFFECT_IDS as readonly string[]).includes(value); }
export function isVisualEffectChoice(value: unknown): value is VisualEffectChoice { return value === 'auto' || value === 'on' || value === 'off'; }
function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
/** Stored overrides merged over `auto`; unknown or malformed entries are dropped. */
export function loadVisualEffectChoices(): VisualEffectChoices {
  try {
    const raw = storage()?.getItem(VISUAL_EFFECTS_KEY);
    if (!raw) return DEFAULT_VISUAL_EFFECT_CHOICES;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_VISUAL_EFFECT_CHOICES;
    const choices = { ...DEFAULT_VISUAL_EFFECT_CHOICES } as Record<VisualEffectId, VisualEffectChoice>;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) if (isVisualEffectId(key) && isVisualEffectChoice(value)) choices[key] = value;
    return choices;
  } catch { return DEFAULT_VISUAL_EFFECT_CHOICES; }
}
/** Persists only the explicit choices, so later preset retuning still reaches
 * everyone who left an effect on `auto`. */
export function saveVisualEffectChoices(choices: VisualEffectChoices): void {
  try {
    const explicit: Record<string, VisualEffectChoice> = {};
    for (const id of VISUAL_EFFECT_IDS) if (choices[id] && choices[id] !== 'auto') explicit[id] = choices[id];
    const store = storage();
    if (!store) return;
    if (Object.keys(explicit).length === 0) store.removeItem(VISUAL_EFFECTS_KEY);
    else store.setItem(VISUAL_EFFECTS_KEY, JSON.stringify(explicit));
  } catch { /* private mode: the session value still applies */ }
}
export function withVisualEffect(choices: VisualEffectChoices, id: VisualEffectId, choice: VisualEffectChoice): VisualEffectChoices {
  return { ...choices, [id]: choice };
}
