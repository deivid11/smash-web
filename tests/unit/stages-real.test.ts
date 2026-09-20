import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent } from '../../lib/game/load.ts';
import type { GameContent } from '../../lib/game/load.ts';
import { SUPPORTED_STAGES } from '../../lib/game/stages.ts';
import { selectGameStage } from '../../lib/game/load.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import { LocalMatch } from '../../lib/game/match.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;

// Every SUPPORTED_STAGES entry must load model AND collision from the real disc
// with at least two spawns, sane blast zones and (when declared) a non-empty
// staticAreas selection plus in-range hiddenObjects roots.
describe.skipIf(!iso)('selectable stage assets on the original disc', () => {
  let base: GameContent;
  let session: HsdAssetSession;
  let disc: Awaited<ReturnType<typeof openDisc>>;
  beforeAll(async () => {
    disc = await openDisc(iso!);
    const info = await verifyMeleeDisc(disc);
    session = new HsdAssetSession(disc, info);
    const wasm = new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
    base = await loadGameContent(session, wasm, () => {});
  }, 180000);
  afterAll(async () => { await disc?.close(); });
  it('seats the full eight-player prototype layout on every stage', async () => {
    const kinds = ['Fx', 'Mr', 'Kb', 'Ca', 'Ss', 'Pk', 'Fe', 'Lk'] as const;
    for (const { id } of SUPPORTED_STAGES) {
      const content = rosterPlayers(await selectGameStage(base, session, id), kinds);
      const rig = new GameRigs(content);
      try {
        const match = new LocalMatch(content, rig, {
          opponent: 'human', countdown: 0, seed: 7,
          controllers: kinds.map(() => 'cpu' as const),
          seatIds: kinds.map((_, slot) => slot),
          cpuLevels: kinds.map(() => 5 as const),
        });
        expect(match.fighters).toHaveLength(8);
      } finally {
        rig.dispose();
      }
    }
  }, 180000);
  it.each(SUPPORTED_STAGES.map((stage) => [stage.id] as const))('loads %s with playable collision', async (id) => {
    const content = await selectGameStage(base, session, id);
    expect(content.stageId).toBe(id);
    expect(content.stage.floors.length).toBeGreaterThan(0);
    expect(content.stage.spawns.length).toBeGreaterThanOrEqual(2);
    // Walk-off geometry may extend past the blast box (Onett's street,
    // Yoshi's Island's slopes); spawns must always sit inside it.
    expect(content.stage.blast.left).toBeLessThan(content.stage.blast.right);
    expect(content.stage.blast.bottom).toBeLessThan(content.stage.blast.top);
    expect(content.stage.blast.right - content.stage.blast.left).toBeGreaterThan(100);
    for (const spawn of content.stage.spawns) {
      expect(spawn[0]).toBeGreaterThanOrEqual(content.stage.blast.left);
      expect(spawn[0]).toBeLessThanOrEqual(content.stage.blast.right);
      expect(spawn[1]).toBeGreaterThanOrEqual(content.stage.blast.bottom);
      expect(spawn[1]).toBeLessThanOrEqual(content.stage.blast.top);
    }
    const definition = SUPPORTED_STAGES.find((stage) => stage.id === id)!;
    if ('staticAreas' in definition && definition.staticAreas) {
      expect(definition.staticAreas.length).toBeGreaterThan(0);
    }
    if ('hiddenObjects' in definition && definition.hiddenObjects) {
      for (const root of definition.hiddenObjects) {
        expect(root).toBeLessThan(content.stageModel.roots.length);
      }
    }
    // Original per-object distance fog (HSD_FogDesc at each map_head entry
    // +0x1C, applied per map gobj by HSD_FogSet): every parsed entry must match
    // a raw re-read of the archive, ranges must be sane world units, and the
    // scene background must be the callbacks-flagged entry's color (black when
    // that entry defines none, per Ground_801C1E94).
    const arc = content.stageModel.archive;
    const head = arc.symbol('map_head');
    const data = arc.pointer(head + 8), count = arc.u32(head + 12);
    expect(content.stageModel.fogEntries.length).toBe(count);
    expect(definition.fogBackground).toBeLessThan(count);
    for (let i = 0; i < count; i++) {
      const desc = arc.pointer(data + i * 0x34 + 0x1c);
      const parsed = content.stageModel.fogEntries[i];
      if (!desc) { expect(parsed).toBeNull(); continue; }
      // Degenerate archived ranges (end <= start) disable fog, like the game.
      if (arc.f32(desc + 12) <= arc.f32(desc + 8)) { expect(parsed).toBeNull(); continue; }
      expect(parsed).not.toBeNull();
      expect(parsed!.end).toBeGreaterThan(parsed!.start);
      expect(parsed!.start).toBeGreaterThanOrEqual(0);
      for (const channel of parsed!.color) { expect(channel).toBeGreaterThanOrEqual(0); expect(channel).toBeLessThanOrEqual(1); }
      expect(parsed!.color[0]).toBeCloseTo(arc.u8(desc + 16) / 255, 5);
      expect(parsed!.color[1]).toBeCloseTo(arc.u8(desc + 17) / 255, 5);
      expect(parsed!.color[2]).toBeCloseTo(arc.u8(desc + 18) / 255, 5);
      expect(parsed!.start).toBeCloseTo(arc.f32(desc + 8) * content.stage.scale, 0);
      expect(parsed!.end).toBeCloseTo(arc.f32(desc + 12) * content.stage.scale, 0);
    }
    if (id === 'mute-city') {
      // Entry 30 is the callbacks-flagged fog source (grMc_StageCallbacks[30]
      // carries 0xC0000000): lavender day haze over the track, while the car
      // roots carry the far blue-gray desc that leaves them unfogged.
      const bg = content.stageModel.fogEntries[definition.fogBackground]!;
      expect(bg.color.map((channel) => Math.round(channel * 255))).toEqual([217, 179, 255]);
      expect(bg.start).toBe(0);
      expect(bg.end).toBeCloseTo(3000, 0);
    }
  }, 120000);
});
