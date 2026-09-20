import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameCore, loadRosterQueue, unloadFighters, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput } from '../../lib/game/match.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { CUSTOM_PACKS } from '../../lib/custom/registry.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso || !CUSTOM_PACKS.length)('installed custom packs with original shared physics and local disc', () => {
  let content: GameContent;
  const rigs: GameRigs[] = [];
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      content = await loadGameCore(session, new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer);
      for (const pack of CUSTOM_PACKS) {
        const original = content.roster.get(pack.kind);
        expect(unloadFighters(content, [pack.kind])).toEqual([pack.kind]);
        await loadRosterQueue(session, content, [pack.kind]);
        expect(content.roster.get(pack.kind)).not.toBe(original);
        expect(content.roster.get(pack.kind)?.profile.kind).toBe(pack.kind);
      }
    } finally { await disc.close(); }
  });
  afterEach(() => { for (const rig of rigs.splice(0)) rig.dispose(); });
  const make = (kind: typeof CUSTOM_PACKS[number]['kind']) => {
    const selected = rosterPlayers(content, [kind, kind]);
    const rig = new GameRigs(selected); rigs.push(rig);
    const match = new LocalMatch(selected, rig, { opponent: 'human', countdown: 0, seed: 145, stocks: 9 });
    match.start(); return match;
  };
  it('keeps full TS+WASM state independent across matches and restores custom JSON state exactly', () => {
    for (const pack of CUSTOM_PACKS) {
      const a = make(pack.kind), b = make(pack.kind);
      expect(a.content.physics.memoryView().buffer).not.toBe(b.content.physics.memoryView().buffer);
      a.fighters[0].customState = { counter: 7, nested: { flag: true }, list: [1, 2] };
      a.fighters[1].customState = { counter: 0 };
      expect(a.fighters[0].customState).not.toBe(a.fighters[1].customState);
      const snapshot = a.captureState(), hash = a.stateHash(), other = b.stateHash();
      a.fighters[0].customState.counter = 8;
      expect(a.stateHash()).not.toBe(hash); expect(b.stateHash()).toBe(other);
      a.restoreState(snapshot); expect(a.stateHash()).toBe(hash);
      expect(a.fighters[0].customState).toEqual({ counter: 7, nested: { flag: true }, list: [1, 2] });
    }
  });
  it('replays custom specials deterministically after restoring the full snapshot', () => {
    for (const pack of CUSTOM_PACKS) for (const direction of ['neutral', 'side', 'up', 'down'] as const) {
      const match = make(pack.kind), saved = match.captureState();
      const run = () => {
        for (let frame = 0; frame < 90; frame++) match.step([{ ...neutralInput(), special: frame === 0, specialDirection: direction }, neutralInput()]);
        return match.stateHash();
      };
      const hash = run(); match.restoreState(saved); expect(run()).toBe(hash);
      expect(match.fighters.every(f => Number.isFinite(f.x) && Number.isFinite(f.y))).toBe(true);
    }
  });
  it('resets custom state on swaps rather than leaking another character state', () => {
    for (const pack of CUSTOM_PACKS) {
      const match = make(pack.kind);
      match.fighters[0].customState = { secretCounter: 44 };
      match.debugSwapFighter(0, 'Fx'); expect(match.fighters[0].customState).toBeNull();
      match.debugSwapFighter(0, pack.kind); expect(match.fighters[0].customState).toEqual(pack.initialState?.() ?? null);
    }
  });
});
