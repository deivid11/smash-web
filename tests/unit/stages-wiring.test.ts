import { describe, expect, it } from 'vitest';
import { SUPPORTED_STAGES, type StageId } from '../../lib/game/stages.ts';
import { MENU_AUDIO_ASSETS, VIEWER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MUSIC_TRACKS } from '../../lib/game/music.ts';
import type { RoomStage } from '../../lib/net/protocol.ts';

/** Every playable stage id must be routable through online rooms. */
type AssertStagesRoutable = StageId extends RoomStage ? true : false;
const _routable: AssertStagesRoutable = true;
void _routable;

describe('stage wiring (no silent unplayable entries)', () => {
  it('exposes nineteen stages with unique ids, assets and music', () => {
    expect(SUPPORTED_STAGES).toHaveLength(19);
    expect(new Set(SUPPORTED_STAGES.map((stage) => stage.id)).size).toBe(19);
    for (const stage of SUPPORTED_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.limitations.length).toBeGreaterThan(0);
    }
  });
  it('serves every stage archive and music track through the allowlisted asset API', () => {
    const viewer = new Set<string>(VIEWER_ASSETS);
    const audio = new Set<string>(MENU_AUDIO_ASSETS);
    for (const stage of SUPPORTED_STAGES) {
      expect(viewer.has(stage.asset), `${stage.id} archive ${stage.asset} must be allowlisted`).toBe(true);
      const track = MUSIC_TRACKS[stage.music];
      expect(track, `${stage.id} music ${stage.music} must be registered`).toBeDefined();
      expect(audio.has(track), `${stage.id} music file ${track} must be allowlisted`).toBe(true);
    }
  });
  it('keeps staticAreas selections well-formed', () => {
    for (const stage of SUPPORTED_STAGES) {
      if (!('staticAreas' in stage) || stage.staticAreas === undefined) continue;
      expect(stage.staticAreas.length).toBeGreaterThan(0);
      expect(new Set(stage.staticAreas).size).toBe(stage.staticAreas.length);
      for (const area of stage.staticAreas) {
        expect(Number.isInteger(area) && area >= 0 && area < 64).toBe(true);
      }
    }
  });
  it('keeps hiddenObjects selections well-formed', () => {
    for (const stage of SUPPORTED_STAGES) {
      if (!('hiddenObjects' in stage) || (stage as { hiddenObjects?: readonly number[] }).hiddenObjects === undefined) continue;
      const hidden = (stage as { hiddenObjects: readonly number[] }).hiddenObjects;
      expect(hidden.length).toBeGreaterThan(0);
      expect(new Set(hidden).size).toBe(hidden.length);
      for (const root of hidden) {
        expect(Number.isInteger(root) && root >= 0 && root < 64).toBe(true);
      }
    }
  });
  it('keeps fogBackground selections well-formed', () => {
    for (const stage of SUPPORTED_STAGES) {
      expect(Number.isInteger(stage.fogBackground) && stage.fogBackground >= 0 && stage.fogBackground < 64).toBe(true);
    }
  });
  it('hides Mute City\'s parked starting grid and keeps the starting road', () => {
    const mute = SUPPORTED_STAGES.find((stage) => stage.id === 'mute-city')!;
    // grMc_803E34A4 (third_party/melee/src/melee/gr/grmutecity.c): the 30
    // runtime spline-driven car roots whose rest grid would otherwise park on
    // the spawn road. Root 5 is trackside scenery and stays visible.
    expect('hiddenObjects' in mute && [...mute.hiddenObjects]).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 32, 33, 34, 35]);
    expect('staticAreas' in mute && [...mute.staticAreas]).toEqual([3, 4]);
  });
  it('keeps areaOffsets selections well-formed', () => {
    for (const stage of SUPPORTED_STAGES) {
      if (!('areaOffsets' in stage) || stage.areaOffsets === undefined) continue;
      expect(stage.areaOffsets.length).toBeGreaterThan(0);
      const areas = stage.areaOffsets.map(([area]) => area);
      expect(new Set(areas).size).toBe(areas.length);
      for (const [area, dx, dy] of stage.areaOffsets) {
        expect(Number.isInteger(area) && area >= 0 && area < 64).toBe(true);
        expect(Number.isFinite(dx) && Number.isFinite(dy)).toBe(true);
      }
    }
  });
});
