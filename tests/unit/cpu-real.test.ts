import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, selectGameStage, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchOptions } from '../../lib/game/match.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;
interface Tally { kos: [number, number]; dealt: [number, number]; frames: number }
describe.skipIf(!iso)('leveled CPU exhibitions with original local disc data', () => {
  let content: GameContent;
  const rigs: GameRigs[] = [];
  const make = (kinds: readonly FighterKind[], options: MatchOptions) => {
    const selected = rosterPlayers(content, kinds), rig = new GameRigs(selected); rigs.push(rig);
    const match = new LocalMatch(selected, rig, { opponent: 'human', countdown: 0, seed: 4242, controllers: kinds.map(() => 'cpu' as const), ...options }); match.start(); return match;
  };
  /** Events name the victim: damage taken by ev.player, KO of ev.player. */
  const play = (match: LocalMatch, frames: number): Tally => {
    const tally: Tally = { kos: [0, 0], dealt: [0, 0], frames: 0 };
    while (match.phase !== 'ended' && match.frame < frames) {
      match.step(match.fighters.map(() => neutralInput()));
      for (const event of match.events) {
        if (event.type === 'hit') tally.dealt[event.player === 0 ? 1 : 0] += event.damage ?? 0;
        if (event.type === 'ko') tally.kos[event.player === 0 ? 1 : 0]++;
      }
    }
    tally.frames = match.frame; return tally;
  };
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { content = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer); }
    finally { await disc.close(); }
  });
  afterEach(() => { rigs.forEach(rig => rig.dispose()); rigs.length = 0; });

  it('lets level 9 dominate level 1 in a Fox mirror while level 1 barely lands hits', () => {
    const tally = play(make(['Fx', 'Fx'], { cpuLevels: [9, 1], seconds: 45 }), 45 * 60);
    expect(tally.kos[0]).toBeGreaterThan(tally.kos[1]); expect(tally.kos[0]).toBeGreaterThanOrEqual(2);
    expect(tally.dealt[0]).toBeGreaterThan(tally.dealt[1] * 2);
  });
  it('keeps the ladder ordered: level 5 out-damages level 1 and level 9 out-damages level 5', () => {
    const fiveVersusOne = play(make(['Mr', 'Fx'], { cpuLevels: [5, 1], seconds: 45 }), 45 * 60);
    const nineVersusFive = play(make(['Mr', 'Fx'], { cpuLevels: [9, 5], seconds: 45 }), 45 * 60);
    expect(fiveVersusOne.dealt[0]).toBeGreaterThan(fiveVersusOne.dealt[1] * 1.5);
    expect(nineVersusFive.dealt[0]).toBeGreaterThan(nineVersusFive.dealt[1] * 1.2);
  });
  it('navigates Hyrule Temple instead of pushing into walls: both level 5 CPUs land hits and never stall', async () => {
    const disc = await openDisc(iso!);
    let temple: GameContent;
    try { temple = await selectGameStage(content, new HsdAssetSession(disc, await verifyMeleeDisc(disc)), 'temple'); } finally { await disc.close(); }
    const selected = rosterPlayers(temple, ['Fx', 'Mr']), rig = new GameRigs(selected); rigs.push(rig);
    const match = new LocalMatch(selected, rig, { opponent: 'human', countdown: 0, seed: 500, controllers: ['cpu', 'cpu'], cpuLevels: [5, 5], seconds: 60 }); match.start();
    const stalled = [0, 0], last = match.fighters.map(f => f.x), run = [0, 0], landed = [0, 0];
    while (match.phase !== 'ended' && match.frame < 3600) {
      match.step([neutralInput(), neutralInput()]);
      match.fighters.forEach((f, slot) => {
        const pushing = f.grounded && Math.abs(f.previous.x) > 0.2 && Math.abs(f.x - last[slot]!) < 0.05 && ['walk', 'run', 'idle'].includes(f.state);
        run[slot] = pushing ? run[slot]! + 1 : 0; if (run[slot]! >= 30) stalled[slot]!++; last[slot] = f.x;
      });
      for (const event of match.events) if (event.type === 'hit') landed[event.player === 0 ? 1 : 0]!++;
    }
    expect(stalled).toEqual([0, 0]); expect(landed[0]).toBeGreaterThanOrEqual(3); expect(landed[1]).toBeGreaterThanOrEqual(3);
  });
  it('is deterministic per level, differs across levels, and survives snapshot restore mid-match', () => {
    const a = make(['Kb', 'Mr'], { cpuLevels: [7, 3], seconds: 20 }), b = make(['Kb', 'Mr'], { cpuLevels: [7, 3], seconds: 20 }), c = make(['Kb', 'Mr'], { cpuLevels: [3, 7], seconds: 20 });
    expect(a.cpuLevels).toEqual([7, 3]); expect(c.stateHash()).not.toBe(a.stateHash());
    for (let frame = 0; frame < 400; frame++) { a.step([neutralInput(), neutralInput()]); b.step([neutralInput(), neutralInput()]); }
    expect(b.stateHash()).toBe(a.stateHash());
    const snapshot = a.captureState();
    for (let frame = 0; frame < 300; frame++) a.step([neutralInput(), neutralInput()]);
    const later = a.stateHash();
    a.restoreState(snapshot); expect(a.stateHash()).toBe(b.stateHash());
    for (let frame = 0; frame < 300; frame++) a.step([neutralInput(), neutralInput()]);
    expect(a.stateHash()).toBe(later);
    expect(() => c.restoreState(snapshot)).toThrow('Incompatible');
  });
  it('rejects malformed CPU level lists and defaults humans and omitted CPUs to level 5', () => {
    for (const cpuLevels of [[9], [0, 5], [5, 10], [5, 1.5], ['9', 9]]) expect(() => make(['Fx', 'Mr'], { cpuLevels: cpuLevels as MatchOptions['cpuLevels'] })).toThrow('CPU levels');
    expect(make(['Fx', 'Mr'], { controllers: ['human', 'cpu'] }).cpuLevels).toEqual([5, 5]);
    expect(make(['Fx', 'Mr'], { controllers: ['human', 'cpu'], cpuLevels: [1, 9] }).cpuLevels).toEqual([5, 9]);
  });
});
