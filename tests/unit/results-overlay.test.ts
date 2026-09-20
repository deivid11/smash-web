import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { ResultsOverlay, resultsReady } from '../../web/src/play/match-hud.tsx';
import type { FighterHud, GameSession } from '../../web/src/play/game-session.ts';

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() };
});

const fighter = (slot: number, control: 'human' | 'cpu', extra: Partial<FighterHud> = {}): FighterHud => ({
  name: slot % 2 ? 'Mario' : 'Fox', label: control === 'cpu' ? 'CPU' : `PLAYER ${slot + 1}`, tag: `P${slot + 1}`,
  seatId: slot, control, kind: slot % 2 ? 'Mr' : 'Fx', costume: 0, percent: 0, stocks: 3, shield: 60, charge: 0,
  chargeMax: 60, charging: false, combat: '', hillPoints: 0, team: null, infected: false,
  kos: slot === 0 ? 2 : 1, falls: slot === 0 ? 1 : 2, damage: slot === 0 ? 137 : 96,
  position: { x: 0, y: 0, visible: false }, ...extra,
});
const session = { changeFighters: () => {}, start: () => {} } as unknown as GameSession;

describe('Ultimate-style results overlay', () => {
  it('opens with the GAME splash over the card', () => {
    const html = renderToStaticMarkup(createElement(ResultsOverlay, {
      session, fighters: [fighter(0, 'human'), fighter(1, 'cpu')], winner: 'Fox wins.', winnerSlot: 0, ready: true,
    }));
    expect(html).toContain('id="game-splash"');
    expect(html).toContain('GAME!');
  });

  it('sends a solo human straight to a winner card bound for character select', () => {
    const html = renderToStaticMarkup(createElement(ResultsOverlay, {
      session, fighters: [fighter(0, 'human'), fighter(1, 'cpu')], winner: 'Fox wins.', winnerSlot: 0, ready: true,
    }));
    expect(html).toContain('id="overlay-title"');
    expect(html).toContain('Fox wins.');
    expect(html).not.toContain('id="results-table"');
    expect(html).toContain('id="choose-fighters"');
    expect(html).toContain('Choose fighters');
    expect(html).toContain('id="start-match"');
  });

  it('lists per-fighter stats with one agree button per human', () => {
    const html = renderToStaticMarkup(createElement(ResultsOverlay, {
      session, fighters: [fighter(0, 'human'), fighter(1, 'human')], winner: 'Fox wins.', winnerSlot: 0, ready: true,
    }));
    expect(html).toContain('id="results-table"');
    for (const header of ['KOs', 'Falls', 'DMG', 'Stocks']) expect(html).toContain(header);
    expect(html).toContain('id="agree-0"');
    expect(html).toContain('id="agree-1"');
    expect(html).toContain('data-winner="true"');
    expect(html).toContain('Waiting for');
    expect(html).not.toContain('id="choose-fighters"');
  });

  it('gates the room advance on every human agreeing', () => {
    expect(resultsReady([0], [0])).toBe(false);
    expect(resultsReady([0, 1], [0])).toBe(false);
    expect(resultsReady([0, 1], [1, 0])).toBe(true);
    expect(resultsReady([0, 1, 3], [0, 1, 3])).toBe(true);
  });
});

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('results stats from the real simulation', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap = 8) => {
    rig?.dispose(); content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); }
  }, 30000);
  afterEach(() => rig?.dispose());
  it('credits damage, KOs and falls across a blast finish and survives rollback', () => {
    make();
    for (let i = 0; i < 30 && game.fighters[1]!.percent === 0; i++) step({ attack: true });
    expect(game.fighters[1]!.percent).toBeGreaterThan(0);
    expect(game.fighters[0]!.damageDealt).toBeGreaterThan(0);
    const snap = game.captureState(), hash = game.stateHash();
    for (let i = 0; i  < 10; i++) step();
    game.restoreState(snap); expect(game.stateHash()).toBe(hash);
    expect(game.fighters[0]!.damageDealt).toBeGreaterThan(0);
    game.fighters[1]!.x = content.stage.blast.right + 10;
    for (let i = 0; i < 10 && game.fighters[1]!.falls === 0; i++) step();
    expect(game.fighters[1]!.falls).toBe(1);
    expect(game.fighters[0]!.kos).toBe(1);
    make();
    game.fighters[0]!.x = content.stage.blast.left - 10;
    for (let i = 0; i < 10 && game.fighters[0]!.falls === 0; i++) step();
    expect(game.fighters[0]!.falls).toBe(1);
    expect(game.fighters[0]!.kos).toBe(0);
    expect(game.fighters[1]!.kos).toBe(0);
  });
});
