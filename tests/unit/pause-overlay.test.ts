import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ArenaOverlay } from '../../web/src/play/match-hud.tsx';
import type { GameSession, HudView, PlayView } from '../../web/src/play/game-session.ts';

// Presentation-only structural checks; the browser suite drives the real runtime.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() };
});

function fixture(overrides: Partial<PlayView>) {
  const hud: HudView = { frame: 150, clock: '2:59', status: 'PAUSED', mode: 'LOCAL', phase: 'playing', countdown: 0, winner: 'Fox wins.', winnerSlot: 0, banner: '', onettWarning: false, rouletteIn: null, fighters: [
    { name: 'Fox', label: 'PLAYER 1', tag: 'P1', seatId: 0, control: 'human', percent: 0, stocks: 4, shield: 60, charge: 0, chargeMax: 60, charging: false, combat: '', hillPoints: 0, team: null, infected: false, kos: 0, falls: 0, damage: 0, position: { x: 40, y: 100, visible: true } },
    { name: 'Mario', label: 'PLAYER 2', tag: 'P2', seatId: 1, control: 'human', percent: 0, stocks: 4, shield: 60, charge: 0, chargeMax: 60, charging: false, combat: '', hillPoints: 0, team: null, infected: false, kos: 0, falls: 0, damage: 0, position: { x: 90, y: 100, visible: true } },
  ], shieldMax: 60, hill: null };
  const view = { mode: 'solo', scene: 'arena', portraits: {}, setup: { stage: 'final', stocks: 4 }, ready: true, loading: false, error: '', active: true, paused: false, ended: false, pauseFocus: null, ...overrides } as unknown as PlayView;
  const session = { hud: { getSnapshot: () => hud }, ui: { getSnapshot: () => view }, online: false } as unknown as GameSession;
  return { session, view };
}
const count = (html: string, needle: string) => (html.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')) ?? []).length;

describe('Melee-style pause overlay', () => {
  it('shows the pause frame without the dimmed results card, and exactly one resume control', () => {
    const { session, view } = fixture({ paused: true });
    const html = renderToStaticMarkup(createElement(ArenaOverlay, { session, view }));
    expect(html).toContain('id="pause-overlay"');
    expect(html).toContain('pause-corner');
    expect(html).toContain('PAUSE');
    expect(html).toContain('orbit'); // control hints present
    expect(html).not.toContain('id="center-overlay"'); // no blur/dim modal while paused
    expect(count(html, 'id="start-match"')).toBe(1); // single resume affordance
  });

  it('carries the full match menu (rematch / fighters / toggles / options) in the pause frame', () => {
    const { session, view } = fixture({ paused: true });
    const html = renderToStaticMarkup(createElement(ArenaOverlay, { session, view }));
    for (const id of ['pause-match', 'reset-match', 'change-fighters', 'walk-mode', 'touch-toggle', 'hud-toggle']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Game options');
  });

  it('labels the focused fighter when the camera is locked on a player', () => {
    const { session, view } = fixture({ paused: true, pauseFocus: { slot: 1, name: 'Mario' } });
    const html = renderToStaticMarkup(createElement(ArenaOverlay, { session, view }));
    expect(html).toContain('MARIO');
  });

  it('draws neither the pause frame nor the results card during live play', () => {
    const { session, view } = fixture({});
    const html = renderToStaticMarkup(createElement(ArenaOverlay, { session, view }));
    expect(html).not.toContain('id="pause-overlay"');
    expect(html).not.toContain('id="center-overlay"');
    expect(count(html, 'id="start-match"')).toBe(0);
  });

  it('still shows the GAME splash and multi-human results table once the match ends', () => {
    const { session, view } = fixture({ active: false, ended: true });
    const html = renderToStaticMarkup(createElement(ArenaOverlay, { session, view }));
    expect(html).not.toContain('id="pause-overlay"');
    expect(html).toContain('id="game-splash"');
    expect(html).toContain('id="center-overlay"');
    expect(html).toContain('id="results-table"');
    expect(html).toContain('id="agree-0"');
    expect(html).toContain('id="agree-1"');
  });
});
