import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import {
  MUTE_CITY_ANIM_FRAMES, MUTE_CITY_DECK_IDS, createMuteCityRuntime,
  muteCityBuildDeck, muteCityPhaseKey, stepMuteCity,
} from '../../lib/game/mutecity.ts';

const iso = process.env.MELEE_DISC_PATH;

describe.skipIf(!iso)('Mute City dynamic road on the original ISO', () => {
  let base: GameContent;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      const wasm = new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
      base = await loadGameContent(session, wasm, () => {}, 'mute-city');
    } finally { await disc.close(); }
  }, 180000);
  it('parses the scripted area phases, splines, joints and road animation', () => {
    const data = base.muteCityData!;
    expect(data.scale).toBeCloseTo(0.6, 5);
    expect(data.phases.size).toBe(7);
    expect(data.phases.get('3,4')!.floors.map((floor) => floor.id)).toEqual([0]);
    for (const spline of [data.splineL, data.splineR]) {
      expect(spline.type).toBe(3);
      expect(spline.points).toHaveLength(49);
    }
    expect(data.chainL.length).toBeGreaterThan(2);
    expect(data.chainR.length).toBeGreaterThan(2);
    expect(data.clip).not.toBeNull();
    // No stage line collides with the runtime deck ids.
    const lineIds = new Set<number>();
    for (const phase of data.phases.values()) {
      for (const floor of phase.floors) lineIds.add(floor.id);
      for (const surface of phase.surfaces ?? []) lineIds.add(surface.id);
    }
    for (const id of MUTE_CITY_DECK_IDS) expect(lineIds.has(id)).toBe(false);
  });
  it('builds a finite traveling deck near the start pad, deterministically', () => {
    const data = base.muteCityData!;
    const first = muteCityBuildDeck(data, 0.932775, 0.932775, 0, 0);
    const second = muteCityBuildDeck(data, 0.932775, 0.932775, 0, 0);
    expect(second).toEqual(first);
    expect(first.deck.floors.map((floor) => floor.id).sort((a, b) => a - b)).toEqual([49, 51, 53]);
    for (const floor of first.deck.floors) {
      for (const end of [floor.a, floor.b]) {
        expect(end.every(Number.isFinite)).toBe(true);
        expect(Math.abs(end[0])).toBeLessThan(210);
        expect(end[1]).toBeGreaterThan(-100);
        expect(end[1]).toBeLessThan(100);
      }
    }
    const mid = first.deck.floors.find((floor) => floor.id === 51)!;
    const span = Math.hypot(mid.b[0] - mid.a[0], mid.b[1] - mid.a[1]);
    expect(span).toBeGreaterThan(5);
    // The deck travels: markers move off their init positions within 600 frames.
    const runtime = createMuteCityRuntime();
    for (let f = 0; f <= 600; f++) stepMuteCity(runtime, data, f % MUTE_CITY_ANIM_FRAMES, false);
    expect(Math.abs(runtime.markerR - 0.932775) + Math.abs(runtime.markerL - 0.932775)).toBeGreaterThan(0);
  });
  it('runs a live match through the first stop with stable rollback', () => {
    const run = (): { game: LocalMatch; rig: GameRigs; hash: string } => {
      const content = rosterPair(base, 'Fx', 'Mr');
      const rig = new GameRigs(content);
      const game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, seed: 7 });
      game.start();
      for (let i = 0; i < 900; i++) game.step([{ ...neutralInput() }, { ...neutralInput() }]);
      const hash = game.liveStateHash();
      return { game, rig, hash };
    };
    const first = run();
    try {
      const game = first.game;
      expect(game.muteCity).not.toBeNull();
      // Frame ~900 (past the 877 stop): surrounding road is live and the deck rides.
      expect(game.muteCity!.areas).toEqual([0, 3, 4, 7, 8]);
      expect(game.muteCity!.deckOn).toBe(true);
      expect(game.muteCity!.deck).not.toBeNull();
      expect(game.snapshot().muteCity).toMatchObject({ deck: true });
      // Idle fighters stay supported on the moving road (no fall-through).
      for (const fighter of game.fighters) {
        expect(fighter.state).not.toBe('ko');
        expect(fighter.stocks).toBe(3);
      }
      const hash900 = first.hash;
      const step = () => game.step([{ ...neutralInput() }, { ...neutralInput() }]);
      for (let i = 0; i < 100; i++) step();
      const hash1000 = game.liveStateHash();
      game.restoreState(game.captureState());
      expect(game.liveStateHash()).toBe(hash1000);
      const checkpoint = game.captureState();
      for (let i = 0; i < 50; i++) step();
      const ahead = game.liveStateHash();
      game.restoreState(checkpoint);
      for (let i = 0; i < 50; i++) step();
      expect(game.liveStateHash()).toBe(ahead);
      expect(hash900).not.toBe(hash1000);
    } finally {
      first.rig.dispose();
    }
    // An identical run reproduces the road bit-for-bit (deck math included).
    const second = run();
    try {
      expect(second.hash).toBe(first.hash);
    } finally {
      second.rig.dispose();
    }
  });
  it('reaches the flight gap with no deck and only the start pad', () => {
    const content = rosterPair(base, 'Fx', 'Mr');
    const rig = new GameRigs(content);
    try {
      const game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, seed: 7 });
      game.start();
      for (let i = 0; i < 2600; i++) game.step([{ ...neutralInput() }, { ...neutralInput() }]);
      expect(game.muteCity!.deckOn).toBe(false);
      expect(game.muteCity!.deck).toBeNull();
      expect(muteCityPhaseKey(game.muteCity!.areas)).toBe('3');
    } finally {
      rig.dispose();
    }
  });
});
