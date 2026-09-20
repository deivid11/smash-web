import type { MatchEvent } from '../../lib/game/match.ts';
import { rumbleForEvent, shouldRumble, strongestPulse, type RumbleLevel, type RumblePulse } from '../../lib/game/rumble.ts';
import { androidRumbleAll, androidVibrate } from './android-bridge.ts';

interface RumbleGamepad {
  // Duck-typed: accepts DOM Gamepads (GamepadHapticEffectType params) and test doubles.
  vibrationActuator?: { playEffect?: (...args: any[]) => Promise<unknown> } | null;
}
interface RumbleEnvironment {
  pads?: () => readonly (RumbleGamepad | null)[] | undefined;
  vibrate?: (pattern: number | number[]) => boolean;
  /** Native shell gamepad vibrators (window.SmashPad). */
  androidRumble?: (strong: number, weak: number, durationMs: number) => boolean;
  /** Native shell handset vibration (window.SmashPad). */
  androidVibrate?: (pattern: number | number[]) => boolean;
}

/** Cosmetic rumble bridge: MatchEvents -> Gamepad dual-rumble + phone vibration.
 *
 * Original routing is per GameCube port (HSD_PadRumbleAdd slot + PADControlMotor
 * in third_party/melee/src/sysdolphin/baselib/rumble.c:217). The browser has no
 * port ids: every locally exposed pad pulses together, which is also what makes
 * a PC / Switch Pro / PS / Xbox pad paired to a phone rumble — phone browsers
 * expose phone-paired Bluetooth/USB pads through the same Gamepad API list, so
 * no separate phone-controller path is needed. The phone handset itself vibrates
 * through navigator.vibrate (Android; iOS Safari has no vibration API and no-ops).
 * Simulation, snapshots, hashes and rollback never read this. */
export class PlayRumble {
  private readonly environment: RumbleEnvironment;
  private level: RumbleLevel = 'full';
  private lastPulse = -Infinity;
  readonly stats = { pulsed: 0, unsupported: 0, lastError: '' };
  constructor(environment?: RumbleEnvironment) {
    this.environment = environment ?? {
      pads: () => {
        try {
          const list = globalThis.navigator?.getGamepads?.();
          return list ? [...list] : [];
        } catch (error) { this.stats.lastError = String(error); return []; }
      },
      vibrate: (pattern) => {
        try {
          // Prefer the native shell inside the Android app (WebView vibration
          // is throttled); fall back to the standard handset API everywhere else.
          if (androidVibrate(pattern)) return true;
          const vibrate = globalThis.navigator?.vibrate?.bind(globalThis.navigator);
          return vibrate?.(pattern) ?? false;
        } catch (error) { this.stats.lastError = String(error); return false; }
      },
      androidRumble: (strong, weak, durationMs) => androidRumbleAll(strong, weak, durationMs),
    };
  }
  getLevel(): RumbleLevel { return this.level; }
  setLevel(level: RumbleLevel): void {
    this.level = level;
    if (level === 'off') this.stop();
  }
  /** One frame batch of confirmed/presentation events. Coalesces to the
   * strongest pulse so trades/doubles never stack motors or phone vibration. */
  events(events: readonly MatchEvent[]): void {
    if (this.level === 'off') return;
    const pulses: (RumblePulse | null)[] = [];
    for (const event of events) {
      if (!shouldRumble(event, this.level)) continue;
      pulses.push(rumbleForEvent(event));
    }
    const best = strongestPulse(pulses);
    if (best) this.pulse(best);
  }
  /** Direct pulse (UI test button, KO banner overrides). Respects the level gate. */
  pulse(request: RumblePulse): void {
    if (this.level === 'off') return;
    const now = performance.now();
    if (now - this.lastPulse < 20) return; // Coalesce same-tick bursts.
    this.lastPulse = now;
    const strong = Math.min(1, Math.max(0, request.strong));
    const weak = Math.min(1, Math.max(0, request.weak));
    const duration = Math.max(0, Math.min(1000, Math.round(request.durationMs)));
    if (duration <= 0 || (strong <= 0 && weak <= 0)) return;
    let actuated = false;
    try {
      const pads = this.environment.pads?.() ?? [];
      for (const pad of pads) {
        if (!pad) continue;
        const play = pad.vibrationActuator?.playEffect;
        if (typeof play !== 'function') continue;
        actuated = true;
        void Promise.resolve()
          .then(() => play.call(pad.vibrationActuator, 'dual-rumble', {
            duration,
            strongMagnitude: strong,
            weakMagnitude: weak,
          }))
          .then(
            () => { this.stats.pulsed++; },
            (error) => { this.stats.lastError = String(error); },
          );
      }
    } catch (error) { this.stats.lastError = String(error); }
    // Native shell gamepad vibrators first (the only path for phone-paired
    // Switch/Xbox/PS pads: no Gamepad API exists on mobile browsers/WebViews).
    try {
      if (this.environment.androidRumble?.(strong, weak, duration)) this.stats.pulsed++;
    } catch (error) { this.stats.lastError = String(error); }
    // Phone handset: Android vibrates, iOS returns false (no API). Long
    // break/KO pulses use a two-burst pattern so the handset echoes the
    // motor swell instead of one flat buzz.
    try {
      const pattern = duration >= 200 ? [0, duration, 50, 80] : duration;
      const ok = this.environment.vibrate?.(pattern) ?? false;
      if (ok) this.stats.pulsed++;
      else if (!actuated) this.stats.unsupported++;
    } catch (error) { this.stats.lastError = String(error); }
  }
  /** Cancel handset vibration and zero the motors (pause, reset, match end).
   * dual-rumble has no cancel: a zero-magnitude pulse is the documented stop. */
  stop(): void {
    this.lastPulse = -Infinity;
    try { this.environment.vibrate?.(0); } catch (error) { this.stats.lastError = String(error); }
    try {
      const pads = this.environment.pads?.() ?? [];
      for (const pad of pads) {
        const play = pad?.vibrationActuator?.playEffect;
        if (typeof play !== 'function') continue;
        void Promise.resolve()
          .then(() => play.call(pad!.vibrationActuator, 'dual-rumble', { duration: 1, strongMagnitude: 0, weakMagnitude: 0 }))
          .then(undefined, (error) => { this.stats.lastError = String(error); });
      }
    } catch (error) { this.stats.lastError = String(error); }
  }
}
