import { describe, expect, it, vi } from 'vitest';
import { DIRECT_SAMPLE_TRIM, PlayAudio, directSampleLevel } from '../../web/src/play-audio.ts';
import type { LocalMatch } from '../../lib/game/match.ts';

describe('confirmed original gameplay sound events', () => {
  it('uses jump sound captured at event tick rather than speculative future jump count', () => {
    const audio = new PlayAudio(), play = vi.spyOn(audio as unknown as { play(id: number, player: number): void }, 'play').mockImplementation(() => {});
    const match = { fighters: [{ jumpsUsed: 2, content: { specials: { sounds: { jump: 10, airJump: 20 } } } }] } as unknown as LocalMatch;
    audio.event({ type: 'jump', player: 0, x: 0, y: 0, sound: 10 }, match);
    expect(play).toHaveBeenCalledWith(10, 0); audio.dispose();
  });
  it('preserves the local fallback for older jump events without sound metadata', () => {
    const audio = new PlayAudio(), play = vi.spyOn(audio as unknown as { play(id: number, player: number): void }, 'play').mockImplementation(() => {});
    const match = { fighters: [{ jumpsUsed: 2, content: { specials: { sounds: { jump: 10, airJump: 20 } } } }] } as unknown as LocalMatch;
    audio.event({ type: 'jump', player: 0, x: 0, y: 0 }, match);
    expect(play).toHaveBeenCalledWith(20, 0); audio.dispose();
  });
  it('trims unspec\'d direct samples to vanilla voice staging without touching cue math', () => {
    // Hottest vanilla voice path: 0.8-peak sample x 0.8 cue gain x mono comp.
    const vanillaCeiling = 0.8 * 0.8 * Math.SQRT2;
    expect(DIRECT_SAMPLE_TRIM).toBeGreaterThan(0); expect(DIRECT_SAMPLE_TRIM).toBeLessThanOrEqual(1);
    // A full-scale mono extension sample must land at or below that ceiling.
    expect(directSampleLevel(1)).toBeLessThanOrEqual(vanillaCeiling);
    expect(directSampleLevel(1)).toBeGreaterThan(0);
    // Stereo passes through with trim only; volume scales and clamps like before.
    expect(directSampleLevel(2)).toBe(DIRECT_SAMPLE_TRIM);
    expect(directSampleLevel(1, 0)).toBe(0);
    expect(directSampleLevel(1, 63.5)).toBeCloseTo(directSampleLevel(1) / 2, 10);
    expect(directSampleLevel(1, 1000)).toBe(directSampleLevel(1));
    expect(directSampleLevel(1, -5)).toBe(0);
  });
  it('retains confirmed loop scopes and stops only ended or replaced owners', () => {
    const audio = new PlayAudio();
    type ScopedVoice = { owner: number; scope: number; loop: boolean };
    const internals = audio as unknown as { voices: Set<ScopedVoice>; stop(voice: ScopedVoice): void };
    const stop = vi.spyOn(internals, 'stop').mockImplementation(voice => { internals.voices.delete(voice); });
    const live = { owner: 0, scope: 7, loop: true }, replaced = { owner: 1, scope: 8, loop: true };
    const absent = { owner: 3, scope: 9, loop: true }, oneShot = { owner: 1, scope: 8, loop: false };
    [live, replaced, absent, oneShot].forEach(voice => internals.voices.add(voice));
    const scopes = Object.freeze([7, null]);
    audio.syncScopes(scopes, false);
    expect(stop.mock.calls.map(([voice]) => voice)).toEqual([replaced, absent]);
    expect(internals.voices.has(live)).toBe(true); expect(internals.voices.has(oneShot)).toBe(true);
    audio.syncScopes(scopes, false); expect(stop).toHaveBeenCalledTimes(2);
    audio.syncScopes(scopes, true);
    expect(stop).toHaveBeenLastCalledWith(live); expect(internals.voices.has(oneShot)).toBe(true);
    internals.voices.clear(); audio.dispose();
  });
  it('keeps the local sync wrapper while online sync accepts independent confirmed metadata', () => {
    const audio = new PlayAudio(), sync = vi.spyOn(audio, 'syncScopes');
    const match = { phase: 'playing', fighters: [{ special: { serial: 11 } }, { special: null }] } as unknown as LocalMatch;
    audio.sync(match); expect(sync).toHaveBeenLastCalledWith([11, null], false);
    audio.syncScopes(Object.freeze([7, 8]), false); expect(sync).toHaveBeenLastCalledWith([7, 8], false);
    match.phase = 'ended'; audio.sync(match); expect(sync).toHaveBeenLastCalledWith([11, null], true);
    audio.dispose();
  });
});
