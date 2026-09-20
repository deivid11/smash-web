import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';
import { PLAYER_PRESENTATIONS, playerPresentation } from '../../lib/game/player-colors.ts';
import { PlayInput } from '../../web/src/play-input.ts';
import { ControllerHub } from '../../web/src/input/controller-hub.ts';

afterEach(() => vi.unstubAllGlobals());
describe('shared eight-player capacity and presentation', () => {
  it('has one distinct presentation for every supported simulated player', () => {
    expect(MIN_MATCH_PLAYERS).toBe(2); expect(MAX_MATCH_PLAYERS).toBe(8);
    expect(PLAYER_PRESENTATIONS).toHaveLength(MAX_MATCH_PLAYERS);
    expect(new Set(PLAYER_PRESENTATIONS.map(player => player.color)).size).toBe(MAX_MATCH_PLAYERS);
    expect(new Set(PLAYER_PRESENTATIONS.map(player => player.key)).size).toBe(MAX_MATCH_PLAYERS);
    for (let slot = 0; slot < MAX_MATCH_PLAYERS; slot++) expect(playerPresentation(slot).css).toMatch(/^#[0-9a-f]{6}$/u);
    expect(playerPresentation(7).key).toBe('eight');
  });
  it.each([-1, 8, 0.5, NaN])('rejects an invalid presentation slot %s instead of rendering undefined', slot => {
    expect(() => playerPresentation(slot)).toThrow('Invalid player');
  });
  it('sizes local HUMAN input ordinals independently of remote or CPU player capacity', () => {
    vi.stubGlobal('window', new EventTarget());
    const canvas = new EventTarget() as unknown as HTMLCanvasElement;
    const hub = new ControllerHub({ getGamepads: () => [], now: () => 0 });
    const input = new PlayInput(canvas, hub);
    try {
      input.playerCount = MAX_MATCH_PLAYERS; input.setLocalPlayerCount(1);
      expect(input.poll(false)).toHaveLength(2);
      expect(hub.getSnapshot().localPlayerCount).toBe(1);
      expect(input.poll().every(player => player.x === 0 && !player.jump && !player.attack)).toBe(true);
      input.playerCount = 100; expect(input.poll()).toHaveLength(2);
      input.setLocalPlayerCount(8); expect(input.poll()).toHaveLength(8);
      input.playerCount = NaN; expect(input.poll()).toHaveLength(8);
      input.setLocalPlayerCount(1); expect(input.poll()).toHaveLength(2);
    } finally { input.dispose(); }
  });
});
