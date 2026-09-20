/** Shared background-load progress: one bar over every deferred asset set
 * (fighters, stages, full voice banks), so menu screens show a single
 * "how much game is ready" figure instead of per-system notes. Units are
 * settled loads (failures count — the match-start guard retries specifics
 * on demand), which keeps the bar monotonic and honest. */
import type { FighterKind } from '../../../lib/game/data.ts';
export interface BackgroundLoad {
  loaded: number;
  total: number;
}

export function summarizeBackgroundLoad(parts: {
  fightersDone: number;
  fightersTotal: number;
  stagesDone: number;
  stagesTotal: number;
  soundDone: boolean;
}): BackgroundLoad {
  const fightersTotal = Math.max(0, Math.floor(parts.fightersTotal));
  const stagesTotal = Math.max(0, Math.floor(parts.stagesTotal));
  const total = fightersTotal + stagesTotal + 1;
  const loaded =
    Math.max(0, Math.min(fightersTotal, Math.floor(parts.fightersDone))) +
    Math.max(0, Math.min(stagesTotal, Math.floor(parts.stagesDone))) +
    (parts.soundDone ? 1 : 0);
  return { loaded: Math.min(loaded, total), total };
}

/** After this many failed menu-idle capture attempts, a loaded fighter gets
 * a letter-mark placeholder portrait (empty string) instead of retrying
 * forever: playable and selectable, just unthumbnailed. */
export const PORTRAIT_MAX_ATTEMPTS = 3;
/** Kinds that exhausted their capture attempts and still lack portraits. Pure. */
export function portraitPlaceholderKeys(
  missing: readonly FighterKind[],
  failures: ReadonlyMap<FighterKind, number>,
): FighterKind[] {
  return missing.filter((kind) => (failures.get(kind) ?? 0) >= PORTRAIT_MAX_ATTEMPTS);
}

export function LoadProgressBar({ loaded, total }: { loaded: number; total: number }) {
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
  return (
    <div
      className="load-progress-bar"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Loading game: ${loaded} of ${total}`}
    >
      <span className="load-progress-track" aria-hidden="true">
        <span className="load-progress-fill" style={{ width: `${percent}%` }} />
      </span>
      <small>
        LOADING GAME · {loaded}/{total}
      </small>
    </div>
  );
}
