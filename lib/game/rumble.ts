import type { MatchEvent } from './match.ts';

/** Cosmetic rumble intensity (options menu, persisted). `full` mirrors the
 * original per-hit/grab/shield/KO dispatch; `subtle` keeps KO + shield-break +
 * strong hits (>= 12 damage, same threshold as reduced camera shake) and skips
 * jab-level ticks; `off` disables all pads and phone vibration. Simulation,
 * snapshots and hashes never read this. */
export type RumbleLevel = 'off' | 'subtle' | 'full';
export const RUMBLE_LEVELS: readonly RumbleLevel[] = ['off', 'subtle', 'full'];
export const RUMBLE_STORAGE_KEY = 'smash-rumble';
export function isRumbleLevel(value: unknown): value is RumbleLevel {
  return typeof value === 'string' && (RUMBLE_LEVELS as readonly string[]).includes(value);
}
export function loadRumbleLevel(): RumbleLevel {
  try {
    const raw = globalThis.localStorage?.getItem(RUMBLE_STORAGE_KEY);
    if (isRumbleLevel(raw)) return raw;
  } catch { /* private mode: session-only */ }
  return 'full';
}
export function saveRumbleLevel(level: RumbleLevel): void {
  try { globalThis.localStorage?.setItem(RUMBLE_STORAGE_KEY, level); } catch { /* Quota or private mode: the session value still applies. */ }
}

/** Single dual-rumble + phone-vibration pulse. Magnitudes are Gamepad
 * dual-rumble 0..1 (strong = high-frequency, weak = low-frequency); the phone
 * handset uses durationMs only (navigator.vibrate has no amplitude). */
export interface RumblePulse {
  strong: number;
  weak: number;
  durationMs: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const pulse = (strong: number, weak: number, durationMs: number): RumblePulse => ({
  strong: clamp01(strong),
  weak: clamp01(weak),
  durationMs: Math.max(0, Math.min(1000, Math.round(durationMs))),
});

/** Original trigger map (supplemental waveform approximation).
 *
 * GameCube motors are binary on/off behind HSD_PadRumbleAdd priority lists
 * (see third_party/melee/src/sysdolphin/baselib/rumble.c:129-258 and
 * third_party/melee/src/melee/lb/lb_013B.c:244 lb_80014574 into LbRb.dat).
 * This adapter keeps the original *call sites* and scales durations by the
 * same inputs the original uses, but renders them as bounded dual-rumble
 * magnitudes + phone-vibration durations instead of the disc waveforms:
 * - hit: ftCommon_8007ED50 victim path (rumble 5, duration = damage*x138+x13C
 *   in third_party/melee/src/melee/ft/ftcommon.c:1193) and the attacker
 *   ftCommon_8007EE0C path (rumble 10, third_party/melee/src/melee/ft/ftcommon.c:1203).
 * - shield-break fly/fall: rumble 24 / 8
 *   (ftCo_ShieldBreakFly.c:34, ftCo_ShieldBreakFall.c:22).
 * - grab/catch: rumble 3 (ftCo_CatchWait.c:28, ftCo_CaptureWait.c:79).
 * - damage KO state: rumble 12 (ftCo_Damage.c:1037).
 * - star/attack item hit: rumble 0x11 (ftcoll.c:1125).
 * LbRb.dat exact on/off tracks are not decoded here; durations below are
 * bounded approximations of those tracks' typical lengths. */
export function rumbleForEvent(event: MatchEvent): RumblePulse | null {
  switch (event.type) {
    case 'hit': {
      const damage = Number.isFinite(event.damage) ? Math.max(0, event.damage!) : 0;
      const knockback = Number.isFinite(event.knockback) ? Math.max(0, event.knockback!) : 0;
      if (damage <= 0 && knockback <= 0) return null;
      // Damage-scaled like ftCommon_8007ED50: light jabs tick, smash hits thump.
      const strong = 0.35 + Math.min(0.45, damage / 30) + Math.min(0.2, knockback / 400);
      return pulse(strong, strong * 0.55, 40 + damage * 6 + Math.min(80, knockback / 4));
    }
    case 'shield':
      // Defender block tick (shield_hit path in fighter.c:2894-2938).
      return pulse(0.4, 0.3, 50);
    case 'shield-break':
      // Original id 24: the longest fighter rumble, paired with the DamageFlyN knock.
      return pulse(1, 0.7, 500);
    case 'grab':
      // Original id 3 catch/capture wait.
      return pulse(0.5, 0.3, 70);
    case 'throw': {
      const damage = Number.isFinite(event.damage) ? Math.max(0, event.damage!) : 0;
      return pulse(0.6 + Math.min(0.3, damage / 30), 0.4, 110 + damage * 4);
    }
    case 'ko':
      return pulse(1, 0.6, 400);
    case 'counter':
    case 'reflect':
      return pulse(0.55, 0.35, 90);
    case 'cape':
    case 'bounce':
      return pulse(0.3, 0.2, 40);
    case 'ledge':
      return pulse(0.35, 0.25, 60);
    case 'transform':
      return pulse(0.5, 0.4, 120);
    default:
      return null;
  }
}

/** Level gate for presentation only. `subtle` keeps KO + shield-break +
 * strong hits/throws (>= 12 damage, same threshold as reduced shake). */
export function shouldRumble(event: MatchEvent, level: RumbleLevel): boolean {
  if (level === 'off') return false;
  if (level === 'full') return rumbleForEvent(event) !== null;
  if (event.type === 'ko' || event.type === 'shield-break') return true;
  const damage = Number.isFinite(event.damage) ? event.damage! : 0;
  if ((event.type === 'hit' || event.type === 'throw') && damage >= 12) return true;
  return false;
}

/** Strongest pulse wins per frame batch: same-frame opposing hits must not
 * stack durations/amplitudes (presentation coalescing, never simulation). */
export function strongestPulse(pulses: readonly (RumblePulse | null)[]): RumblePulse | null {
  let best: RumblePulse | null = null;
  let bestScore = -1;
  for (const current of pulses) {
    if (!current) continue;
    const score = current.strong * 2 + current.weak + current.durationMs / 500;
    if (score > bestScore) { bestScore = score; best = current; }
  }
  return best;
}
