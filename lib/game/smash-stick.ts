/** Melee-style C-stick (right stick) smash input.
 *
 * Leaf module (no game imports) so the match step in `lib/game/match.ts`, the
 * defense/grab controller in `lib/game/combat.ts` and the input adapters can
 * share one gate without an import cycle.
 *
 * Semantics (prototype input mapping, not an original C routine claim):
 * - The C-stick carries its own `cX`/`cY` vector (right, up-positive, unit
 *   circle). It never moves the fighter, aims the left stick, tap-jumps,
 *   fast-falls, drops through platforms or steers specials: those keep reading
 *   the left stick.
 * - Past {@link CSTICK_THRESHOLD} the stick counts as a held Strong button, so
 *   holding it charges a grounded smash exactly like holding Strong.
 * - Crossing the threshold is a Strong rising edge, so a flick fires a smash
 *   (grounded: side/up/down; aerial: directional aerial) with the flick's own
 *   direction, independent of where the left stick points.
 * - Direction priority mirrors the existing attack selection in
 *   `lib/game/match.ts` (down, then up, then side), so a C-stick flick behaves
 *   exactly like pressing Strong with the left stick pointed that way.
 */
import type { PlayerInput } from './match.ts';

/** C-stick deflection gate. Above the left-stick walk band so drift never smashes. */
export const CSTICK_THRESHOLD = 0.5;

const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);

/** Held past the gate (charges a grounded smash like a held Strong button). */
export function cStickActive(input: Pick<PlayerInput, 'cX' | 'cY'>): boolean {
  return Math.max(Math.abs(finite(input.cX)), Math.abs(finite(input.cY))) > CSTICK_THRESHOLD;
}

/** Fresh flick past the gate (fires a smash like a Strong rising edge). */
export function cStickEdge(input: Pick<PlayerInput, 'cX' | 'cY'>, previous: Pick<PlayerInput, 'cX' | 'cY'>): boolean {
  return cStickActive(input) && !cStickActive(previous);
}

/** Held Strong button: face button or deflected C-stick (charges smashes). */
export function smashHeld(input: Pick<PlayerInput, 'strong' | 'cX' | 'cY'>): boolean {
  return !!input.strong || cStickActive(input);
}

/** Strong rising edge: face-button edge or fresh C-stick flick. */
export function smashEdge(
  input: Pick<PlayerInput, 'strong' | 'cX' | 'cY'>,
  previous: Pick<PlayerInput, 'strong' | 'cX' | 'cY'>,
): boolean {
  return (!!input.strong && !previous.strong) || cStickEdge(input, previous);
}
