import { describe, expect, it } from 'vitest';
import {
  isRumbleLevel,
  loadRumbleLevel,
  rumbleForEvent,
  shouldRumble,
  strongestPulse,
} from '../../lib/game/rumble.ts';
import { PlayRumble } from '../../web/src/play-rumble.ts';

const hit = (damage = 5, extra: Record<string, unknown> = {}) => ({
  type: 'hit' as const,
  player: 0,
  x: 0,
  y: 0,
  damage,
  ...extra,
});

describe('original-trigger rumble mapping', () => {
  it('scales hit pulses by damage like ftCommon_8007ED50 and ignores zero damage', () => {
    const jab = rumbleForEvent(hit(3))!;
    const smash = rumbleForEvent(hit(20, { knockback: 120 }))!;
    expect(jab).not.toBeNull();
    expect(smash.strong).toBeGreaterThan(jab.strong);
    expect(smash.durationMs).toBeGreaterThan(jab.durationMs);
    expect(rumbleForEvent(hit(0))).toBeNull();
  });
  it('maps shield-break to the longest pulse (original id 24 knock) and grabs/Throws/KOs', () => {
    const broke = rumbleForEvent({ type: 'shield-break', player: 0, x: 0, y: 0 })!;
    const jab = rumbleForEvent(hit(5))!;
    const grab = rumbleForEvent({ type: 'grab', player: 0, x: 0, y: 0 })!;
    const toss = rumbleForEvent({ type: 'throw', player: 0, x: 0, y: 0, damage: 9 })!;
    const ko = rumbleForEvent({ type: 'ko', player: 0, x: 0, y: 0 })!;
    expect(broke.durationMs).toBeGreaterThan(ko.durationMs);
    expect(ko.strong).toBe(1);
    expect(grab.durationMs).toBeLessThan(toss.durationMs);
    expect(jab.durationMs).toBeLessThan(broke.durationMs);
    expect(rumbleForEvent({ type: 'shield', player: 0, x: 0, y: 0 })).not.toBeNull();
    expect(rumbleForEvent({ type: 'jump', player: 0, x: 0, y: 0 })).toBeNull();
  });
  it('coalesces same-frame batches to the strongest pulse without stacking', () => {
    const jab = rumbleForEvent(hit(3))!;
    const broke = rumbleForEvent({ type: 'shield-break', player: 1, x: 0, y: 0 })!;
    expect(strongestPulse([jab, broke])).toEqual(broke);
    expect(strongestPulse([null, null])).toBeNull();
  });
});

describe('rumble level gate', () => {
  it('defaults to full and validates persisted values', () => {
    expect(loadRumbleLevel()).toBe('full');
    expect(isRumbleLevel('off')).toBe(true);
    expect(isRumbleLevel('subtle')).toBe(true);
    expect(isRumbleLevel('full')).toBe(true);
    expect(isRumbleLevel('extreme')).toBe(false);
  });
  it('off blocks everything, subtle keeps KO + break + strong hits', () => {
    expect(shouldRumble(hit(5), 'off')).toBe(false);
    expect(shouldRumble({ type: 'ko', player: 0, x: 0, y: 0 }, 'off')).toBe(false);
    expect(shouldRumble(hit(5), 'subtle')).toBe(false);
    expect(shouldRumble(hit(15), 'subtle')).toBe(true);
    expect(shouldRumble({ type: 'ko', player: 0, x: 0, y: 0 }, 'subtle')).toBe(true);
    expect(shouldRumble({ type: 'shield-break', player: 0, x: 0, y: 0 }, 'subtle')).toBe(true);
    expect(shouldRumble(hit(5), 'full')).toBe(true);
  });
});

describe('PlayRumble bridge', () => {
  it('pulses every exposed pad actuator plus the phone handset', async () => {
    const played: Array<{ type: string; params: Record<string, number> }> = [];
    const vibrated: Array<number | number[]> = [];
    const rumble = new PlayRumble({
      pads: () => [
        { vibrationActuator: { playEffect: (type, params) => { played.push({ type, params }); return Promise.resolve(); } } },
        { vibrationActuator: { playEffect: (type, params) => { played.push({ type, params }); return Promise.resolve(); } } },
        null,
      ],
      vibrate: (pattern) => { vibrated.push(pattern); return true; },
    });
    rumble.events([hit(18, { knockback: 100 })]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(played).toHaveLength(2);
    expect(played[0]!.type).toBe('dual-rumble');
    expect(played[0]!.params.duration).toBeGreaterThan(0);
    expect(played[0]!.params.strongMagnitude).toBeGreaterThan(0.5);
    expect(vibrated).toHaveLength(1);
  });
  it('phone-paired pads use the same Gamepad list path and off cancels everything', () => {
    // A Switch Pro / Xbox pad paired to a phone appears in the same
    // navigator.getGamepads list: one code path covers PC and phone.
    let stopped = 0;
    const calls: number[] = [];
    const rumble = new PlayRumble({
      pads: () => [{ vibrationActuator: { playEffect: () => { calls.push(1); return Promise.resolve(); } } }],
      vibrate: (pattern) => { if (pattern === 0) stopped++; return true; },
    });
    rumble.setLevel('off');
    rumble.events([hit(20)]);
    expect(calls).toHaveLength(0);
    expect(stopped).toBe(1);
  });
  it('never throws when actuators or vibration are missing', () => {
    const rumble = new PlayRumble({ pads: () => { throw new Error('denied'); }, vibrate: () => { throw new Error('denied'); } });
    expect(() => rumble.events([hit(20), { type: 'ko', player: 0, x: 0, y: 0 }])).not.toThrow();
    const bare = new PlayRumble({ pads: () => [null], vibrate: () => false });
    expect(() => bare.events([hit(20)])).not.toThrow();
    expect(bare.stats.unsupported).toBe(1);
  });
});
