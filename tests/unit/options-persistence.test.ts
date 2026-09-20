import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSession } from '../../web/src/play/game-session.ts';
import { CUSTOM_PRESENTATIONS } from '../../lib/custom/registry.ts';
const defaultPresentation = CUSTOM_PRESENTATIONS[0]?.id ?? 'default';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('game option persistence', () => {
  it('boots audio and presentation defaults with empty storage', () => {
    const view = new GameSession().ui.getSnapshot();
    expect(view.sound).toBe(true);
    expect(view.music).toBe(true);
    expect(view.musicVolume).toBe(0.3);
    expect(view.masterVolume).toBe(0.1);
    expect(view.presentation).toBe(defaultPresentation);
  });

  it('round-trips and clamps the general volume, falling back to the quiet default for garbage', () => {
    const first = new GameSession();
    first.setMasterVolume(0.4);
    expect(localStorage.getItem('smash-master-volume')).toBe('0.4');
    expect(new GameSession().ui.getSnapshot().masterVolume).toBe(0.4);
    first.setMasterVolume(3);
    expect(first.ui.getSnapshot().masterVolume).toBe(1);
    first.setMasterVolume(-2);
    expect(first.ui.getSnapshot().masterVolume).toBe(0);
    localStorage.setItem('smash-master-volume', 'max');
    expect(new GameSession().ui.getSnapshot().masterVolume).toBe(0.1);
  });

  it('round-trips sound, music and volume across sessions', () => {
    const first = new GameSession();
    first.setSound(false);
    first.setMusic(false);
    first.setMusicVolume(0.15);
    expect(localStorage.getItem('smash-sound')).toBe('0');
    expect(localStorage.getItem('smash-music')).toBe('0');
    expect(localStorage.getItem('smash-music-volume')).toBe('0.15');
    const second = new GameSession().ui.getSnapshot();
    expect(second.sound).toBe(false);
    expect(second.music).toBe(false);
    expect(second.musicVolume).toBe(0.15);
  });

  it('round-trips touch and presentation choices across sessions', () => {
    const first = new GameSession();
    first.setTouch(true);
    const choice = CUSTOM_PRESENTATIONS.at(-1)?.id ?? 'default';
    first.setPresentation(choice);
    expect(localStorage.getItem('smash-touch')).toBe('1');
    expect(localStorage.getItem('smash-presentation')).toBe(choice);
    const second = new GameSession().ui.getSnapshot();
    expect(second.touch).toBe(true);
    expect(second.presentation).toBe(choice);
  });

  it('clamps out-of-range volume and falls back for garbage, missing or denied storage', () => {
    const first = new GameSession();
    first.setMusicVolume(2);
    expect(first.ui.getSnapshot().musicVolume).toBe(1);
    first.setMusicVolume(-1);
    expect(first.ui.getSnapshot().musicVolume).toBe(0);
    localStorage.setItem('smash-music-volume', 'loud');
    localStorage.setItem('smash-presentation', 'hologram');
    const second = new GameSession().ui.getSnapshot();
    expect(second.musicVolume).toBe(0.3);
    expect(second.presentation).toBe(defaultPresentation);
    vi.stubGlobal('localStorage', undefined);
    const third = new GameSession();
    expect(third.ui.getSnapshot().musicVolume).toBe(0.3);
    expect(() => { third.setSound(false); third.setMusicVolume(0.5); third.setTouch(true); }).not.toThrow();
    const denied = {} as Storage;
    Object.defineProperty(denied, 'getItem', { get() { throw new Error('denied'); } });
    vi.stubGlobal('localStorage', denied);
    const fourth = new GameSession().ui.getSnapshot();
    expect(fourth.sound).toBe(true);
    expect(fourth.music).toBe(true);
    expect(fourth.musicVolume).toBe(0.3);
  });
});
