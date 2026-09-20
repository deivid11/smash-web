import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';
import { playerPresentation } from '../../lib/game/player-colors.ts';
import type { RoomView } from '../../lib/net/protocol.ts';
import { MatchHud, ArenaOverlay } from '../../web/src/play/match-hud.tsx';
import { OnlinePanel } from '../../web/src/play/online-panel.tsx';
import type { FighterHud, GameSession, HudView, PlayView } from '../../web/src/play/game-session.ts';
import type { OnlineSession } from '../../web/src/play/online-session.ts';

// Presentation-only structural checks. Browser tests verify the real runtime,
// WebGL render, live external stores, responsive bounds and relay authority.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot() };
});

function fixture(count: number) {
  const fighters: (FighterHud & { seatId: number; control: 'human' | 'cpu' })[] = Array.from({ length: count }, (_, slot) => ({
    name: slot % 2 ? 'Mario' : 'Fox', label: `PLAYER ${slot + 1}`, tag: `P${slot + 1}`, seatId: slot, control: 'human',
    percent: slot === 7 ? 123 : 0, stocks: 4, shield: 60, charge: 0, chargeMax: 60,
    charging: false, combat: '', hillPoints: 0, team: null, infected: false, kos: 0, falls: 0, damage: 0, position: { x: 20 + slot * 30, y: 100, visible: true },
  }));
  const hud: HudView = { frame: 150, clock: '2:59', status: 'ONLINE MATCH', mode: `ONLINE · ${count} PLAYERS`, phase: 'playing', countdown: 0, winner: '', winnerSlot: null, banner: '', onettWarning: false, rouletteIn: null, fighters, shieldMax: 60, hill: null };
  const view = { mode: 'lan', scene: 'online', portraits: {}, setup: { stage: 'final', stocks: 4 }, ready: true, loading: false, error: '', active: true, paused: false } as unknown as PlayView;
  const session = { hud: { getSnapshot: () => hud }, ui: { getSnapshot: () => view }, online: true } as unknown as GameSession;
  return { session, view };
}

describe('expanded player presentation', () => {
  it.each([2, 4, 5, 6, 7, 8])('renders %i uniquely identified HUD cards with the shared palette', count => {
    const { session } = fixture(count);
    const html = renderToStaticMarkup(createElement(MatchHud, { session }));
    expect(html.match(/class="fighter-card /gu)).toHaveLength(count);
    expect(html).not.toContain('undefined');
    expect(html.includes('many-players')).toBe(count > 4);
    for (let slot = 0; slot < count; slot++) {
      const presentation = playerPresentation(slot);
      expect(html).toContain(`player-${presentation.key}`);
      expect(html).toContain(`--player-color:${presentation.css}`);
      expect(html).toContain(`id="percent-${slot}"`);
      expect(html).toContain(`id="stocks-${slot}"`);
      expect(html).toContain(`aria-label="Player ${slot + 1}:`);
    }
    if (count === 8) expect(html).toContain('data-seat-id="7" data-controller-kind="human" data-damage="danger"');
  });

  it('overhead HUD mode drops the cards and floats clamped damage percents above fighters', () => {
    const { session, view } = fixture(3);
    (view as { hudMode?: string }).hudMode = 'overhead';
    session.hud.getSnapshot().fighters[1]!.percent = 74;
    session.hud.getSnapshot().fighters[2]!.percent = 131;
    session.hud.getSnapshot().fighters[2]!.position.visible = false;
    expect(renderToStaticMarkup(createElement(MatchHud, { session }))).toBe(''); // no cards at all
    const overlay = renderToStaticMarkup(createElement(ArenaOverlay, { session, view }));
    expect(overlay).toContain('id="overhead-percent-0"'); expect(overlay).toContain('data-damage="normal"');
    expect(overlay).toContain('id="overhead-percent-1"'); expect(overlay).toContain('data-damage="high"');
    expect(overlay).toMatch(/id="overhead-percent-2"[^>]*hidden/u); expect(overlay).toContain('data-damage="danger"');
    expect(overlay).toContain('>74<span>%</span>');
    expect(overlay).toContain('id="fighter-tag-0"'); // player identity chips stay
    (view as { hudMode?: string }).hudMode = 'cards';
    expect(renderToStaticMarkup(createElement(MatchHud, { session }))).toContain('fighter-card');
    expect(renderToStaticMarkup(createElement(ArenaOverlay, { session, view }))).not.toContain('overhead-percent');
  });

  it('keeps physical seat colors and CPU labels when active seats are sparse', () => {
    const { session, view } = fixture(2);
    Object.assign(session.hud.getSnapshot().fighters[0]!, { seatId: 1, control: 'cpu', tag: 'CPU2' });
    Object.assign(session.hud.getSnapshot().fighters[1]!, { seatId: 6, control: 'human', tag: 'P7' });
    const hud = renderToStaticMarkup(createElement(MatchHud, { session }));
    const overlay = renderToStaticMarkup(createElement(ArenaOverlay, { session, view }));
    expect(hud).toContain('player-two'); expect(hud).toContain('player-seven');
    expect(hud).toContain('data-seat-id="1" data-controller-kind="cpu"');
    expect(hud).toContain('Player 2: Fox (CPU)'); expect(hud).toContain('id="percent-0"');
    expect(overlay).toContain('tag-two'); expect(overlay).toContain('tag-seven');
    expect(overlay).toContain('id="fighter-tag-0"');
  });

  it('marks infected fighters with a badge and infinite stocks', () => {
    const { session } = fixture(2);
    Object.assign(session.hud.getSnapshot().fighters[0]!, { infected: true, stocks: 1 });
    const html = renderToStaticMarkup(createElement(MatchHud, { session }));
    expect(html).toContain('id="zombie-badge-0"'); expect(html).toContain('INFECTED');
    expect(html).toContain('>∞<'); expect(html).not.toContain('id="zombie-badge-1"');
  });

  it('gives all eight in-world tags matching colors and readable foreground inks', () => {
    const { session, view } = fixture(MAX_MATCH_PLAYERS);
    const html = renderToStaticMarkup(createElement(ArenaOverlay, { session, view }));
    for (let slot = 0; slot < MAX_MATCH_PLAYERS; slot++) {
      const presentation = playerPresentation(slot);
      expect(html).toContain(`tag-${presentation.key}`);
      expect(html).toContain(`id="fighter-tag-${slot}"`);
      expect(html).toContain(`background-color:${presentation.css};color:${presentation.ink}`);
    }
    expect(html).not.toContain('tag-undefined');
  });

  it.each([2, 8])('shows eight lobby slots, the correct %i/8 count and matching slot colors', count => {
    const { session, view } = fixture(count);
    const room: RoomView = {
      code: 'ABC234', hostSlot: 0, phase: 'lobby', rules: { stage: 'final', stocks: 4, timeSeconds: 180 },
      fingerprint: { game: 'presentation-test', wasm: 'a'.repeat(64), content: 'b'.repeat(64) },
      players: Array.from({ length: count }, (_, slot) => ({ slot, name: `Browser ${slot + 1}`, fighter: 'Fx', ready: false, control: 'human' })),
    };
    const online = {
      client: { getSnapshot: () => ({ room, slot: 0, status: 'connected', error: null, lastEnd: null }) },
      stats: { getSnapshot: () => ({ error: '', status: 'Ready for a match.' }) }, game: session,
      voice: {
        getSnapshot: () => ({ supported: false, secure: true, enabled: false, requesting: false, muted: false, ptt: false, pttHeld: false, error: '', localSpeaking: false, peers: [] }),
        subscribe: () => () => {},
      },
    } as unknown as OnlineSession;
    const html = renderToStaticMarkup(createElement(OnlinePanel, { online, view }));
    expect(html.match(/class="player-seat(?: |")/gu)).toHaveLength(8);
    expect(html).toContain(`${count}/8 players`);
    expect(html).toContain('Human seats are real browser connections.');
    for (let slot = 0; slot < MAX_MATCH_PLAYERS; slot++) {
      expect(html).toContain(`--seat-color:${playerPresentation(slot).css}`);
      expect(html).toContain(`id="seat-kind-${slot}"`);
      expect(html).toContain(`id="select-seat-${slot}"`);
    }
  });
});
