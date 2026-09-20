/** Rift Descent cloud save: which localStorage keys make up the "rift" slot,
 * how to summarize them, and the pure decision of what a sync should do.
 * The network side lives in web/src/account/account-client.ts.
 */
import { ROGUE_META_KEY } from '../../../lib/game/roguelike/meta.ts';
import { SUSPENDED_RUN_KEY } from '../../../lib/game/roguelike/suspend.ts';

/** Raw storage keys owned by the rift slot (values are stored verbatim as parsed JSON). */
export const RIFT_KEYS = {
  meta: ROGUE_META_KEY,
  best: 'smash-roguelike-best',
  run: SUSPENDED_RUN_KEY,
  fighter: 'smash-roguelike-fighter',
} as const;
const LINK_KEY = 'smash-cloud-link';

export interface RiftCloudData {
  format: 1;
  meta: unknown;
  best: unknown;
  run: unknown;
  fighter: string | null;
}

/** Which account this browser's progress was last synced with, and whether it changed since. */
export interface CloudLink { userId: number; revision: number; dirty: boolean; syncedAt: number }

export interface RiftProgress { runs: number; wins: number; shards: number; keys: number; bestScore: number; runFloor: number | null; runFighter: string | null }

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function readJson(key: string): unknown {
  try { const raw = storage()?.getItem(key); return raw ? JSON.parse(raw) as unknown : null; } catch { return null; }
}

export function readLocalRift(): RiftCloudData {
  let fighter: string | null = null;
  try { fighter = storage()?.getItem(RIFT_KEYS.fighter) ?? null; } catch { /* storage denied */ }
  return { format: 1, meta: readJson(RIFT_KEYS.meta), best: readJson(RIFT_KEYS.best), run: readJson(RIFT_KEYS.run), fighter };
}

/** Replaces local rift progress with a cloud copy (without firing save listeners). */
export function writeLocalRift(data: RiftCloudData): void {
  const store = storage();
  if (!store) return;
  const put = (key: string, value: unknown): void => {
    if (value === null || value === undefined) store.removeItem(key);
    else store.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  };
  try {
    put(RIFT_KEYS.meta, data.meta);
    put(RIFT_KEYS.best, data.best);
    put(RIFT_KEYS.run, data.run);
    put(RIFT_KEYS.fighter, data.fighter);
  } catch { /* quota: the cloud copy stays authoritative */ }
}

export function parseRiftData(value: unknown): RiftCloudData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<RiftCloudData>;
  if (data.format !== 1) return null;
  return { format: 1, meta: data.meta ?? null, best: data.best ?? null, run: data.run ?? null, fighter: typeof data.fighter === 'string' ? data.fighter : null };
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
export function riftProgress(data: RiftCloudData): RiftProgress {
  const meta = (data.meta ?? {}) as { shards?: unknown; keys?: unknown; runs?: unknown; wins?: unknown; stats?: { runs?: unknown; wins?: unknown } };
  const run = (data.run as { run?: { row?: unknown; playerFighter?: unknown } } | null)?.run;
  return {
    runs: Math.max(count(meta.runs), count(meta.stats?.runs)),
    wins: Math.max(count(meta.wins), count(meta.stats?.wins)),
    shards: count(meta.shards),
    keys: count(meta.keys),
    bestScore: count((data.best as { score?: unknown } | null)?.score),
    runFloor: run ? count(run.row) + 1 : null,
    runFighter: run && typeof run.playerFighter === 'string' ? run.playerFighter : null,
  };
}

export function hasProgress(data: RiftCloudData): boolean {
  const progress = riftProgress(data);
  return progress.runs > 0 || progress.shards > 0 || progress.keys > 0 || progress.bestScore > 0 || progress.runFloor !== null;
}

function sameProgress(a: RiftCloudData, b: RiftCloudData): boolean {
  return JSON.stringify([a.meta, a.best, a.run]) === JSON.stringify([b.meta, b.best, b.run]);
}

export type SyncPlan = 'noop' | 'push' | 'pull' | 'conflict';
/** Decide how to reconcile this browser with the account's cloud copy. Conflicts
 * are only reported when both sides hold progress the other lacks: the player picks. */
export function planSync(link: CloudLink | null, userId: number, local: RiftCloudData, cloud: { data: RiftCloudData; revision: number } | null): SyncPlan {
  const linked = link?.userId === userId;
  if (!cloud) return hasProgress(local) ? 'push' : 'noop';
  if (linked && cloud.revision === link.revision) return link.dirty ? 'push' : 'noop';
  if (sameProgress(local, cloud.data)) return 'noop';
  if (linked && !link.dirty) return 'pull';
  if (!linked && !hasProgress(local)) return 'pull';
  if (!hasProgress(cloud.data)) return 'push';
  return 'conflict';
}

export function loadLink(): CloudLink | null {
  const value = readJson(LINK_KEY) as Partial<CloudLink> | null;
  if (!value || !Number.isSafeInteger(value.userId) || !Number.isSafeInteger(value.revision)) return null;
  return { userId: value.userId!, revision: value.revision!, dirty: value.dirty === true, syncedAt: count(value.syncedAt) };
}
export function saveLink(link: CloudLink | null): void {
  try {
    if (link) storage()?.setItem(LINK_KEY, JSON.stringify(link));
    else storage()?.removeItem(LINK_KEY);
  } catch { /* session-only link */ }
}
