import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPHICS_QUALITIES } from '../../web/src/render/graphics-quality.ts';
import {
  DEFAULT_VISUAL_EFFECT_CHOICES, VISUAL_EFFECTS, VISUAL_EFFECTS_KEY, VISUAL_EFFECT_DEFAULTS, VISUAL_EFFECT_IDS, VISUAL_EFFECT_TUNING,
  effectEnabled, isEffectDefault, loadVisualEffectChoices, resolveVisualEffects, saveVisualEffectChoices, withVisualEffect,
  type VisualEffectChoices,
} from '../../web/src/render/visual-effects.ts';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  } as Storage;
}
beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('visual effect presets', () => {
  it('keeps every effect off on Auto at every preset (the chain is opt-in)', () => {
    for (const quality of GRAPHICS_QUALITIES) {
      const resolved = resolveVisualEffects(quality, DEFAULT_VISUAL_EFFECT_CHOICES);
      expect(VISUAL_EFFECT_DEFAULTS[quality]).toEqual([]);
      expect(resolved.active).toEqual([]);
      expect(resolved.enabled).toBe(false);
    }
  });
  it('zeroes the strength of every effect that is switched off', () => {
    const off = resolveVisualEffects('ultra', { bloom: 'off', ao: 'off', grade: 'off', sharpen: 'off', vignette: 'off' });
    expect(off.enabled).toBe(false);
    expect(off.active).toEqual([]);
    expect([off.bloomStrength, off.aoStrength, off.gradeStrength, off.sharpenStrength, off.vignetteStrength]).toEqual([0, 0, 0, 0, 0]);
  });
  it('keeps the tier cost profile when a weak device forces an effect on', () => {
    const forced = resolveVisualEffects('low', { ...DEFAULT_VISUAL_EFFECT_CHOICES, ao: 'on', bloom: 'on' });
    expect(forced.active).toContain('ao');
    expect(forced.aoSamples).toBe(VISUAL_EFFECT_TUNING.low.aoSamples);
    // Low pays less for the same effects than Extra high does.
    expect(forced.aoSamples).toBeLessThan(VISUAL_EFFECT_TUNING.ultra.aoSamples);
    expect(forced.bloomScale).toBeGreaterThan(VISUAL_EFFECT_TUNING.ultra.bloomScale);
    expect(forced.bloomPasses).toBeLessThan(VISUAL_EFFECT_TUNING.ultra.bloomPasses);
    expect(forced.samples).toBe(0);
  });
  it('pins an effect against the preset in both directions', () => {
    expect(effectEnabled('ultra', { ...DEFAULT_VISUAL_EFFECT_CHOICES, bloom: 'off' }, 'bloom')).toBe(false);
    expect(effectEnabled('low', { ...DEFAULT_VISUAL_EFFECT_CHOICES, bloom: 'on' }, 'bloom')).toBe(true);
    expect(isEffectDefault('low', 'bloom')).toBe(false);
    expect(isEffectDefault('ultra', 'bloom')).toBe(false);
  });
  it('describes every effect exactly once in the menu', () => {
    expect(VISUAL_EFFECTS.map(effect => effect.id).sort()).toEqual([...VISUAL_EFFECT_IDS].sort());
    for (const effect of VISUAL_EFFECTS) { expect(effect.label.length).toBeGreaterThan(2); expect(effect.note.length).toBeGreaterThan(10); }
  });
});

describe('visual effect persistence', () => {
  it('stores only explicit choices so later preset tuning still reaches Auto', () => {
    saveVisualEffectChoices(withVisualEffect(DEFAULT_VISUAL_EFFECT_CHOICES, 'ao', 'on'));
    expect(JSON.parse(localStorage.getItem(VISUAL_EFFECTS_KEY)!)).toEqual({ ao: 'on' });
    expect(loadVisualEffectChoices()).toEqual({ ...DEFAULT_VISUAL_EFFECT_CHOICES, ao: 'on' });
  });
  it('drops the entry once everything is back on Auto', () => {
    saveVisualEffectChoices({ ...DEFAULT_VISUAL_EFFECT_CHOICES, bloom: 'off' });
    saveVisualEffectChoices(DEFAULT_VISUAL_EFFECT_CHOICES);
    expect(localStorage.getItem(VISUAL_EFFECTS_KEY)).toBeNull();
    expect(loadVisualEffectChoices()).toEqual(DEFAULT_VISUAL_EFFECT_CHOICES);
  });
  it('ignores malformed or unknown stored values', () => {
    localStorage.setItem(VISUAL_EFFECTS_KEY, '{"bloom":"maybe","nope":"on","ao":"off"}');
    expect(loadVisualEffectChoices()).toEqual({ ...DEFAULT_VISUAL_EFFECT_CHOICES, ao: 'off' });
    localStorage.setItem(VISUAL_EFFECTS_KEY, 'not json');
    expect(loadVisualEffectChoices()).toEqual(DEFAULT_VISUAL_EFFECT_CHOICES);
  });
  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
    expect(loadVisualEffectChoices()).toEqual(DEFAULT_VISUAL_EFFECT_CHOICES);
    expect(() => saveVisualEffectChoices({ ...DEFAULT_VISUAL_EFFECT_CHOICES, bloom: 'off' } as VisualEffectChoices)).not.toThrow();
  });
});
