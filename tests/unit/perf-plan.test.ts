import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { FrameMonitor, initialSkipState, shouldRender, SKIP_RECOVER_FRAMES, updateSkipState } from '../../web/src/play/frame-monitor.ts';
import {
  AUTO_STEP_P95_MS,
  AUTO_STEP_UP_P95_MS,
  capPixelRatioFor1080,
  chooseInitialQuality,
  clearAutoQuality,
  GRAPHICS_AUTO_KEY,
  GRAPHICS_STORAGE_KEY,
  isTvClassDevice,
  loadAutoQuality,
  loadGraphicsQuality,
  loadManualQuality,
  loadGraphicsMode,
  saveGraphicsMode,
  isGraphicsMode,
  qualityIndex,
  saveAutoQuality,
  saveGraphicsQuality,
  shouldAutoStepDown,
  shouldAutoStepUp,
  stepDownQuality,
} from '../../web/src/render/graphics-quality.ts';
import { prioritizeKinds } from '../../lib/game/load.ts';
import { summarizeBackgroundLoad, portraitPlaceholderKeys, PORTRAIT_MAX_ATTEMPTS } from '../../web/src/play/load-progress.tsx';
import { PREVIEW_CACHE_VERSION, previewCacheKey } from '../../web/src/play/preview-cache.ts';
import { programCacheKey } from '../../web/src/render/texture-tev.ts';
import { RollbackDriver } from '../../lib/game/rollback.ts';
import { neutralInput, type LocalMatch, type MatchEvent, type MatchState, type PlayerInput } from '../../lib/game/match.ts';
import type { PlayerControllerMode } from '../../lib/game/setup.ts';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}
beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => vi.unstubAllGlobals());

describe('Phase 1: render-skip state machine', () => {
  it('renders every RAF until saturated, then drops to 1/2 and 1/3 with hysteretic recovery', () => {
    let state = initialSkipState();
    for (let i = 0; i < 4; i++) { state = updateSkipState(state, true); expect(shouldRender(state)).toBe(true); }
    state = updateSkipState(state, true);
    expect(state.level).toBe(1);
    // Level 1 renders every 2nd RAF by frame counter.
    const renders = [0, 1, 2, 3].map(() => { state = updateSkipState(state, false); return shouldRender(state); });
    expect(renders.filter(Boolean).length).toBeLessThan(4);
    // Five more saturated frames step down to every 3rd.
    for (let i = 0; i < 5; i++) state = updateSkipState(state, true);
    expect(state.level).toBe(2);
    // Recovery needs a clean streak and steps up one level at a time.
    for (let i = 0; i < SKIP_RECOVER_FRAMES; i++) state = updateSkipState(state, false);
    expect(state.level).toBe(1);
    for (let i = 0; i < SKIP_RECOVER_FRAMES; i++) state = updateSkipState(state, false);
    expect(state.level).toBe(0);
    expect(shouldRender(state)).toBe(true);
  });
  it('FrameMonitor reports rolling p50/p95 and the sim/render cost split', () => {
    const monitor = new FrameMonitor(10);
    for (let i = 1; i <= 10; i++) {
      monitor.beginFrame(); monitor.endSim(); monitor.endRender();
      monitor.pushDelta(i, false);
    }
    const stats = monitor.stats();
    expect(stats.frames).toBe(10); expect(stats.p50).toBe(6); expect(stats.p95).toBe(10);
    expect(stats.avgSimMs).toBeGreaterThanOrEqual(0); expect(stats.avgRenderMs).toBeGreaterThanOrEqual(0);
    expect(stats.skipLevel).toBe(0);
    for (let i = 0; i < 5; i++) monitor.pushDelta(33, true);
    expect(monitor.stats().skipLevel).toBe(1);
  });
});

describe('Phase 1: auto-quality policy', () => {
  it('steps down one preset at a time and never below low', () => {
    expect(stepDownQuality('ultra')).toBe('high'); expect(stepDownQuality('high')).toBe('medium');
    expect(stepDownQuality('medium')).toBe('low'); expect(stepDownQuality('low')).toBe('low');
    expect(qualityIndex('low')).toBeLessThan(qualityIndex('high'));
    expect(shouldAutoStepDown(AUTO_STEP_P95_MS + 1)).toBe(true);
    expect(shouldAutoStepDown(AUTO_STEP_P95_MS)).toBe(false);
  });
  it('steps back up toward manual on headroom, with a dead zone between', () => {
    expect(shouldAutoStepUp(AUTO_STEP_UP_P95_MS - 1)).toBe(true);
    expect(shouldAutoStepUp(AUTO_STEP_UP_P95_MS)).toBe(false);
    // Dead zone: neither direction fires, so borderline hardware holds steady.
    for (const p95 of [12, 15, 16.7, 20]) {
      expect(shouldAutoStepDown(p95)).toBe(false);
      expect(shouldAutoStepUp(p95)).toBe(false);
    }
    expect(shouldAutoStepDown(33)).toBe(true);
    expect(shouldAutoStepUp(8)).toBe(true);
  });
  it('starts TV-class and tiny devices at low, everything else at high', () => {
    expect(chooseInitialQuality({ userAgent: 'Mozilla/5.0 Silk/100 (Fire TV)' })).toBe('low');
    expect(chooseInitialQuality({ userAgent: 'Mozilla/5.0 (Linux; Android 9; AFTKA) AppleWebKit' })).toBe('low');
    expect(chooseInitialQuality({ deviceMemory: 2, hardwareConcurrency: 4 })).toBe('low');
    expect(chooseInitialQuality({ hardwareConcurrency: 2 })).toBe('low');
    expect(chooseInitialQuality({ gpu: 'Mali-G31 MC2' })).toBe('low');
    expect(chooseInitialQuality({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', deviceMemory: 8, hardwareConcurrency: 12 })).toBe('high');
    expect(isTvClassDevice({ userAgent: 'Silk' })).toBe(true);
    expect(isTvClassDevice({ userAgent: 'Windows', deviceMemory: 16, hardwareConcurrency: 8 })).toBe(false);
  });
  it('caps TV drawing buffers at 1080p', () => {
    expect(capPixelRatioFor1080(3840, 2160, 2)).toBeLessThan(2);
    expect(capPixelRatioFor1080(3840, 2160, 2) ** 2 * 3840 * 2160).toBeLessThanOrEqual(1920 * 1080 + 1);
    expect(capPixelRatioFor1080(1280, 720, 1)).toBe(1);
  });
  it('pins legacy presets and defaults fresh installs to auto', () => {
    expect(isGraphicsMode('auto')).toBe(true);
    expect(isGraphicsMode('high')).toBe(true);
    expect(isGraphicsMode('insane')).toBe(false);
    // Fresh storage: no mode, no manual -> adaptive auto.
    expect(loadGraphicsMode()).toBe('auto');
    // An explicit past choice stays pinned even without a mode key.
    saveGraphicsQuality('high');
    expect(loadGraphicsMode()).toBe('high');
    // Explicit auto mode sticks too.
    saveGraphicsMode('auto');
    expect(loadGraphicsMode()).toBe('auto');
    saveGraphicsMode('low');
    expect(loadGraphicsMode()).toBe('low');
  });
  it('persists auto decisions separately from the manual key', () => {
    expect(loadGraphicsQuality()).toBe('high'); expect(loadManualQuality()).toBeNull();
    saveGraphicsQuality('ultra'); saveAutoQuality('low');
    expect(localStorage.getItem(GRAPHICS_STORAGE_KEY)).toBe('ultra');
    expect(localStorage.getItem(GRAPHICS_AUTO_KEY)).toBe('low');
    expect(loadGraphicsQuality()).toBe('ultra'); expect(loadManualQuality()).toBe('ultra');
    expect(loadAutoQuality()).toBe('low');
    clearAutoQuality(); expect(loadAutoQuality()).toBeNull();
  });
});

describe('Unified background load progress', () => {
  it('sums fighters, stages and the voice-bank unit', () => {
    expect(summarizeBackgroundLoad({ fightersDone: 0, fightersTotal: 30, stagesDone: 1, stagesTotal: 15, soundDone: false }))
      .toEqual({ loaded: 1, total: 46 });
    expect(summarizeBackgroundLoad({ fightersDone: 30, fightersTotal: 30, stagesDone: 15, stagesTotal: 15, soundDone: true }))
      .toEqual({ loaded: 46, total: 46 });
  });
  it('placeholders only kinds that exhausted capture attempts', () => {
    const failures = new Map([['Zx', PORTRAIT_MAX_ATTEMPTS] as const, ['Wf', 1] as const]);
    expect(portraitPlaceholderKeys(['Zx', 'Wf', 'Fx'], failures)).toEqual(['Zx']);
    expect(portraitPlaceholderKeys([], failures)).toEqual([]);
  });
  it('clamps overruns and negatives instead of showing impossible bars', () => {
    expect(summarizeBackgroundLoad({ fightersDone: 99, fightersTotal: 30, stagesDone: -2, stagesTotal: 15, soundDone: true }))
      .toEqual({ loaded: 31, total: 46 });
    expect(summarizeBackgroundLoad({ fightersDone: 0, fightersTotal: 0, stagesDone: 0, stagesTotal: 0, soundDone: false }))
      .toEqual({ loaded: 0, total: 1 });
  });
});

describe('Phase 2: roster load ordering', () => {
  it('pulls hovered kinds first and keeps Kirby behind its copy sources', () => {
    const pending = ['Fe', 'Dk', 'Ca', 'Ss', 'Fx', 'Kb', 'Pk'] as const;
    expect(prioritizeKinds([...pending], ['Pk'])[0]).toBe('Pk');
    const kirby = prioritizeKinds([...pending], ['Kb']);
    expect(kirby[0]).not.toBe('Kb');
    expect(kirby.indexOf('Fx')).toBeLessThan(kirby.indexOf('Kb'));
    expect(kirby.indexOf('Pk')).toBeLessThan(kirby.indexOf('Kb'));
    // Already-loaded kinds never reappear.
    expect(prioritizeKinds(['Fe', 'Dk'], ['Fx', 'Fe'])).toEqual(['Fe', 'Dk']);
  });
  it('versions preview cache keys by disc fingerprint', () => {
    expect(previewCacheKey('abc')).toContain('abc');
    expect(previewCacheKey('abc')).toContain(String(PREVIEW_CACHE_VERSION));
    expect(previewCacheKey('abc')).not.toBe(previewCacheKey('abd'));
  });
});

describe('Phase 3: shared shader programs', () => {
  it('gives identical TEVs one cache key and plain draws another', () => {
    const tev = { active: 0x40000000, colorIn: [8, 8, 8, 8], colorOp: 0, colorBias: 0, colorScale: 0, colorClamp: true, alphaIn: [4, 4, 4, 4], alphaOp: 0, alphaBias: 0, alphaScale: 0, alphaClamp: true, constant: [0, 0, 0, 0] as [number, number, number, number], register0: [0, 0, 0, 0] as [number, number, number, number], register1: [0, 0, 0, 0] as [number, number, number, number] };
    const a = { flags: 0, uvSet: 0, scale: [1, 1] as [number, number], repeatS: 1, repeatT: 1, translation: [0, 0] as [number, number], wrapS: 0, wrapT: 0, rotation: [0, 0, 0] as [number, number, number], blending: 1, tev, animId: 0, image: {} } as never;
    const b = { ...(a as object) } as never;
    expect(programCacheKey(a, true)).toBe(programCacheKey(b, true));
    expect(programCacheKey(a, false)).toBe('smash:plain');
    expect(programCacheKey(undefined, true)).toBe('smash:plain');
    expect(programCacheKey({ ...(a as object), tev: { ...tev, colorOp: 1 } } as never, true)).not.toBe(programCacheKey(a, true));
  });
});

/** Minimal driver harness (mirrors rollback.test.ts): no keyframe-aware methods,
 * so the pooled/keyframed paths must degrade gracefully. */
function world(count = 2, controllers: readonly PlayerControllerMode[] | null = null): LocalMatch {
  const match = {
    frame: 0, phase: 'ready' as LocalMatch['phase'], events: [] as MatchEvent[], value: 0,
    fighters: Array.from({ length: count }, () => ({ special: null as { serial: number } | null })),
    options: { opponent: 'human', controllers },
    controllerKinds: controllers ?? Array.from({ length: count }, () => 'human' as const),
    start() { this.phase = 'playing'; },
    step(inputs: readonly PlayerInput[]) {
      this.frame++; this.value += inputs.reduce((sum, input, slot) => sum + input.x * (slot + 1), 0);
      this.events = [];
    },
    captureState() { return structuredClone({ frame: this.frame, value: this.value }) as unknown as MatchState; },
    restoreState(state: MatchState) { this.frame = (state as unknown as { frame: number }).frame; this.value = (state as unknown as { value: number }).value; },
    stateHash() { return String(this.value); },
  };
  return match as unknown as LocalMatch;
}

describe('Phase 4: keyframed rollback', () => {
  it('corrects a non-keyframe prediction by replaying from the previous keyframe', () => {
    const match = world(), driver = new RollbackDriver(match, 0, 2);
    for (let frame = 0; frame < 4; frame++) {
      driver.receive(frame, 1, neutralInput());
      expect(driver.advance({ ...neutralInput(), x: 1 })).toBe(true);
    }
    expect(driver.confirmedFrame).toBe(3);
    // Frame 1 is not a keyframe (interval 3): a conflicting late input must
    // still rewind through keyframe 0 and resimulate to the high-water mark.
    const lagging = new RollbackDriver(world(), 0, 2);
    for (let frame = 0; frame < 4; frame++) lagging.advance({ ...neutralInput(), x: 1 });
    lagging.receive(1, 1, { ...neutralInput(), x: 1 });
    expect(lagging.stats.rollbacks).toBe(1);
    expect(lagging.frame).toBe(4);
    for (const frame of [0, 2, 3]) lagging.receive(frame, 1, neutralInput());
    expect(lagging.stateHash(0)).toBe(driver.stateHash(0));
  });
  it('keeps every confirmed frame hashable without a stored post-boundary', () => {
    const match = world(), driver = new RollbackDriver(match, 0, 2);
    for (let frame = 0; frame < 6; frame++) {
      driver.receive(frame, 1, neutralInput());
      driver.advance(neutralInput());
      driver.drainConfirmedEvents();
    }
    for (let frame = 0; frame <= 5; frame++) expect(driver.stateHash(frame)).toBe('0');
  });
});
