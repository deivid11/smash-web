import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { copySourceKinds, loadGameCore, loadRosterQueue, pendingRosterKinds, unloadFighters, type GameContent } from '../../lib/game/load.ts';

/** On-demand loading: a selection may ask for any single fighter, and anything outside the
 * warm set is unloaded and must reload cleanly (see docs/PERF_TELEMETRY.md). */
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('asset lifecycle for on-demand selections', () => {
  let session: HsdAssetSession, wasm: ArrayBuffer, disc: Awaited<ReturnType<typeof openDisc>>;
  beforeAll(async () => {
    disc = await openDisc(iso!);
    const info = await verifyMeleeDisc(disc);
    session = new HsdAssetSession({ size: disc.size, read: (offset, length) => disc.read(offset, length) }, info);
    wasm = new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
  }, 120_000);
  afterAll(async () => { await disc?.close(); });

  it('loads a copy-ability fighter alone by pulling in its sources', async () => {
    const content = await loadGameCore(session, wasm);
    // Kirby parses each copy ability from another fighter's specials, so loading him alone
    // used to throw "copy ability needs Fx loaded first".
    const sources = copySourceKinds(['Kb']);
    expect(sources.length).toBeGreaterThan(3);
    const { kinds } = await loadRosterQueue(session, content, ['Kb']);
    expect(kinds).toContain('Kb');
    expect(content.roster.has('Kb')).toBe(true);
    for (const source of sources) expect(content.roster.has(source)).toBe(true);
    expect(content.roster.get('Kb')!.specials.parameters?.kind).toBe('Kb');
  }, 180_000);

  it('unloads fighters and reloads them identically on demand', async () => {
    const content: GameContent = await loadGameCore(session, wasm);
    await loadRosterQueue(session, content, ['Mr', 'Pk']);
    const before = content.roster.get('Pk')!;
    expect(pendingRosterKinds(session, content)).not.toContain('Pk');

    expect(unloadFighters(content, ['Pk'])).toEqual(['Pk']);
    expect(content.roster.has('Pk')).toBe(false);
    expect(content.roster.has('Mr')).toBe(true);
    // A dropped kind is pending again, so the selection gate knows to fetch it.
    expect(pendingRosterKinds(session, content)).toContain('Pk');

    const { kinds } = await loadRosterQueue(session, content, ['Pk']);
    expect(kinds).toEqual(['Pk']);
    const after = content.roster.get('Pk')!;
    expect(after).not.toBe(before);
    // Same fighter, rebuilt: identity differs but the gameplay-relevant shape matches.
    expect(after.profile.kind).toBe(before.profile.kind);
    expect(after.profile.boneCount).toBe(before.profile.boneCount);
    expect([...after.clips.keys()].sort()).toEqual([...before.clips.keys()].sort());
    expect(unloadFighters(content, ['Pk', 'Pk'])).toEqual(['Pk']);
  }, 180_000);
});
