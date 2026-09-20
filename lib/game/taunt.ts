import type { FighterContent } from './load.ts';

/** Original Appeal (taunt) motions.
 *
 * Every fighter on the supported roster authors one of four sets in its own AJ file:
 * a single symmetric `Appeal` (Mario, Marth, Mewtwo, Bowser…), the facing pair
 * `AppealR`/`AppealL` (Kirby, Samus, Link, Falcon…), the raised pair
 * `AppealHiR`/`AppealHiL` (Sonic, Charizard, Diddy, Shadow, Dedede's ACE kit) or a
 * single `AppealLw`. Loading is tolerant (lib/game/load.ts): a source whose fighter
 * has none of them simply cannot taunt instead of failing the whole roster.
 *
 * The clip, its script (voice cues and graphics) and the fighter's own animation data
 * are the original ones. Only the state orchestration around them — when the Appeal
 * may start and what ends it — is prototype code, like the rest of the match flow. */
export const TAUNT_MOTIONS = ['Appeal', 'AppealR', 'AppealL', 'AppealHi', 'AppealHiR', 'AppealHiL', 'AppealLw'] as const;

/** The motion this fighter taunts with, or null when its source authors none.
 *
 * A facing pair is only used when BOTH sides exist: a lone `AppealR` beside a plain
 * `Appeal` (Shadow Mewtwo's m-ex table) is a leftover, and the symmetric clip is the
 * taunt the original plays. */
export function tauntAnimation(content: Pick<FighterContent, 'clips'>, facing: number): string | null {
  const has = (name: string) => content.clips.has(name);
  const right = facing >= 0;
  if (has('AppealR') && has('AppealL')) return right ? 'AppealR' : 'AppealL';
  if (has('AppealHiR') && has('AppealHiL')) return right ? 'AppealHiR' : 'AppealHiL';
  for (const name of ['Appeal', 'AppealHi', 'AppealLw', 'AppealR', 'AppealL', 'AppealHiR', 'AppealHiL']) if (has(name)) return name;
  return null;
}
