import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasProgress, loadLink, planSync, readLocalRift, riftProgress, RIFT_KEYS, saveLink, writeLocalRift, type RiftCloudData } from '../../web/src/account/cloud-save.ts';
import { createRun } from '../../lib/game/roguelike/run-state.ts';
import { generateRun } from '../../lib/game/roguelike/generator.ts';
import { emptyMeta, onRogueSaved, saveMeta } from '../../lib/game/roguelike/meta.ts';
import { clearSuspendedRun, loadSuspendedRun, parseSuspendedRun, planForRun, saveSuspendedRun, SUSPENDED_RUN_KEY } from '../../lib/game/roguelike/suspend.ts';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}
const empty: RiftCloudData = { format: 1, meta: null, best: null, run: null, fighter: null };
const played = (runs: number, shards = runs * 10): RiftCloudData => ({ ...empty, meta: { ...emptyMeta(), runs, shards, stats: { ...emptyMeta().stats, runs } } });

beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage(); });
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

describe('cloud save planning', () => {
  it('uploads fresh device progress and downloads onto an empty device', () => {
    expect(planSync(null, 7, played(2), null)).toBe('push');
    expect(planSync(null, 7, empty, null)).toBe('noop');
    expect(planSync(null, 7, empty, { data: played(4), revision: 3 })).toBe('pull');
  });
  it('follows the linked revision: push local edits, pull other devices, ask when both changed', () => {
    const link = { userId: 7, revision: 3, dirty: false, syncedAt: 1 };
    expect(planSync(link, 7, played(4), { data: played(4), revision: 3 })).toBe('noop');
    expect(planSync({ ...link, dirty: true }, 7, played(5), { data: played(4), revision: 3 })).toBe('push');
    expect(planSync(link, 7, played(4), { data: played(6), revision: 5 })).toBe('pull');
    expect(planSync({ ...link, dirty: true }, 7, played(5), { data: played(6), revision: 5 })).toBe('conflict');
  });
  it('never silently merges two different accounts\' progress on one device', () => {
    const other = { userId: 1, revision: 9, dirty: false, syncedAt: 1 };
    expect(planSync(other, 7, played(3), { data: played(8), revision: 2 })).toBe('conflict');
    expect(planSync(other, 7, played(3), { data: played(3), revision: 2 })).toBe('noop');
    expect(planSync(other, 7, played(3), { data: empty, revision: 1 })).toBe('push');
  });
  it('round-trips the rift slot through storage and summarizes it', () => {
    const data: RiftCloudData = { format: 1, meta: { ...emptyMeta(), shards: 55, keys: 3, stats: { ...emptyMeta().stats, runs: 4, wins: 1 } }, best: { score: 1200, cleared: 17 }, run: { format: 1, savedAt: 1, run: { row: 6, playerFighter: 'Fx' } }, fighter: 'Pk' };
    writeLocalRift(data);
    expect(readLocalRift()).toEqual(data);
    expect(localStorage.getItem(RIFT_KEYS.fighter)).toBe('Pk');
    expect(riftProgress(data)).toEqual({ runs: 4, wins: 1, shards: 55, keys: 3, bestScore: 1200, runFloor: 7, runFighter: 'Fx' });
    expect(hasProgress(empty)).toBe(false);
    writeLocalRift(empty);
    expect(readLocalRift()).toEqual(empty);
    saveLink({ userId: 3, revision: 2, dirty: true, syncedAt: 5 });
    expect(loadLink()).toEqual({ userId: 3, revision: 2, dirty: true, syncedAt: 5 });
  });
});

describe('Rift save & quit', () => {
  const plan = generateRun('SAVE-QUIT', { length: 50, difficulty: 'flame', playerFighter: 'Mr', heat: 1 });
  it('stores live runs (fights as their intro), rebuilds the map from the seed, and notifies cloud sync', () => {
    let saves = 0;
    const off = onRogueSaved(() => { saves++; });
    const run = { ...createRun(plan), phase: 'fight' as const, row: 3, coins: 90 };
    saveSuspendedRun(run);
    const loaded = loadSuspendedRun();
    expect(loaded?.run).toMatchObject({ phase: 'intro', row: 3, coins: 90, seedLabel: 'SAVE-QUIT', heat: 1 });
    expect(planForRun(loaded!.run)?.map).toEqual(plan.map);
    saveMeta(emptyMeta());
    clearSuspendedRun();
    expect(localStorage.getItem(SUSPENDED_RUN_KEY)).toBeNull();
    expect(saves).toBe(3);
    off();
  });
  it('drops finished or damaged saves', () => {
    saveSuspendedRun({ ...createRun(plan), phase: 'gameover', lives: 0 });
    expect(loadSuspendedRun()).toBeNull();
    expect(parseSuspendedRun({ format: 1, run: { ...createRun(plan), heat: 99 } })).toBeNull();
    expect(parseSuspendedRun({ format: 2, run: createRun(plan) })).toBeNull();
    localStorage.setItem(SUSPENDED_RUN_KEY, '{not json');
    expect(loadSuspendedRun()).toBeNull();
    // A seed whose settings no longer produce the stored plan seed is not resumable.
    expect(planForRun({ ...createRun(plan), planSeed: plan.seed + 1 })).toBeNull();
  });
});
