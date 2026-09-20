import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsEnabled, setAnalyticsEnabled, trackVisit, visitPageClass } from '../../web/src/analytics/visits.ts';
import { Store } from '../../web/src/play/store.ts';
import type { GameSession, PlayView } from '../../web/src/play/game-session.ts';

let stop: (() => void) | undefined;
let storage: Map<string, string>;
let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('navigator', { language: 'en-US', maxTouchPoints: 0, webdriver: true, doNotTrack: '0' });
  vi.stubGlobal('location', { pathname: '/players/TestUser', host: 'game.example', search: '?ref=not%20a%20slug' });
  vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => 'server' }), referrer: 'https://news.example/private-page?token=secret', visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('screen', { width: 1280, height: 720 }); vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('addEventListener', vi.fn()); vi.stubGlobal('removeEventListener', vi.fn());
  send = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', send);
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
function session() {
  const ui = new Store({ ready: false, active: false, ended: false, error: '', discGate: null, scene: 'home', mode: 'solo', graphics: 'high' } as PlayView);
  return { ui, game: { ui, online: false, spectating: false } as GameSession };
}
const bodies = () => send.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)));

describe('browser visit privacy boundary', () => {
  it.each([['/players/TestUser', 'players'], ['/players', 'players'], ['/play.html', 'play'], ['/play', 'play'], ['/', 'play'], ['/viewer.html', 'viewer'], ['/playful/other', 'other']])('classifies %s without retaining its pathname', (path, expected) => {
    expect(visitPageClass(path)).toBe(expected);
  });
  it('sends page/referrer/error classes rather than usernames, URLs, queries or messages', () => {
    const { ui, game } = session(); stop = trackVisit(game);
    expect(bodies()[0].start).toMatchObject({ page: 'players', referrerHost: 'news.example', campaign: null });
    ui.update({ error: 'Source error: /private/example.iso?token=secret' }); ui.update({ ready: true });
    expect(bodies()[1].events).toEqual(expect.arrayContaining([{ type: 'error', data: { kind: 'source' } }]));
    const wire = JSON.stringify(bodies());
    for (const value of ['TestUser', '/players/', 'private-page', 'token=secret', 'example.iso', 'Source error:']) expect(wire).not.toContain(value);
  });
  it('sends no persistent visitor ID under DNT and marks the report for server-side privacy', () => {
    vi.stubGlobal('navigator', { language: 'en-US', maxTouchPoints: 0, doNotTrack: '1' });
    const { game } = session(); stop = trackVisit(game);
    expect(bodies()[0].start).toMatchObject({ visitor: null, returning: false, dnt: true });
    expect(storage.has('smash-visitor')).toBe(false);
  });
  it('stops all further reports and removes the browser identifier after opt-out', async () => {
    const { ui, game } = session(); stop = trackVisit(game);
    expect(storage.has('smash-visitor')).toBe(true);
    setAnalyticsEnabled(false); const count = send.mock.calls.length;
    expect(analyticsEnabled()).toBe(false); expect(storage.has('smash-visitor')).toBe(false);
    ui.update({ ready: true }); await vi.advanceTimersByTimeAsync(120_000); stop();
    expect(send).toHaveBeenCalledTimes(count);
  });
});
