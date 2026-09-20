import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBOARD_MAP, KeyboardMapStore, bindKey, bindable, keyLabel, parseKeyboardMap } from '../../web/src/input/keyboard-map.ts';
import { PlayInput } from '../../web/src/play-input.ts';
import { ControllerHub } from '../../web/src/input/controller-hub.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

describe('keyboard map', () => {
  it('binds one key to one action and takes it away from its previous owner, across both players', () => {
    const map = bindKey(DEFAULT_KEYBOARD_MAP, 0, 'jump', 'KeyJ');
    expect(map[0].jump).toEqual(['KeyJ']); expect(map[0].attack).toEqual([]);
    const crossed = bindKey(map, 1, 'grab', 'KeyJ');
    expect(crossed[1].grab).toEqual(['KeyJ']); expect(crossed[0].jump).toEqual([]);
    expect(DEFAULT_KEYBOARD_MAP[0].attack).toEqual(['KeyJ']); // the defaults are never mutated
  });
  it('refuses reserved and malformed keys', () => {
    for (const code of ['Escape', 'Tab', 'F5', 'MetaLeft', '', 'Key J', '<script>', 'x'.repeat(40)]) expect(bindable(code)).toBe(false);
    expect(bindKey(DEFAULT_KEYBOARD_MAP, 0, 'jump', 'Escape')).toBe(DEFAULT_KEYBOARD_MAP);
    for (const code of ['KeyQ', 'Digit1', 'Numpad5', 'ControlLeft', 'Backquote']) expect(bindable(code)).toBe(true);
  });
  it('labels keys for people', () => {
    expect([keyLabel('KeyW'), keyLabel('Digit7'), keyLabel('Numpad0'), keyLabel('ArrowLeft'), keyLabel('ShiftLeft'), keyLabel('Comma')]).toEqual(['W', '7', 'Num 0', '←', 'Left Shift', ',']);
  });
  it('sanitizes stored maps: bad codes and duplicates are dropped, other shapes rejected', () => {
    expect(parseKeyboardMap(null)).toBeNull(); expect(parseKeyboardMap({ v: 2, players: [] })).toBeNull(); expect(parseKeyboardMap({ v: 1, players: [{}] })).toBeNull();
    const parsed = parseKeyboardMap({ v: 1, players: [{ jump: ['KeyQ', 'Escape', 42, 'KeyQ'], attack: ['KeyQ', 'KeyE'], evil: ['KeyZ'] }, { jump: ['KeyE', 'KeyR'] }] })!;
    expect(parsed[0].jump).toEqual(['KeyQ']); expect(parsed[0].attack).toEqual(['KeyE']); expect(parsed[1].jump).toEqual(['KeyR']);
    expect(parsed[0].left).toEqual([]); expect('evil' in parsed[0]).toBe(false);
  });
  it('persists only customized maps and restores defaults', () => {
    const storage = memoryStorage();
    const store = new KeyboardMapStore(storage);
    expect(store.customized).toBe(false); expect(store.uses('KeyJ')).toBe(true); expect(store.uses('KeyQ')).toBe(false);
    let notified = 0; store.subscribe(() => notified++);
    expect(store.bind(0, 'attack', 'KeyQ')).toBe(true); expect(store.bind(0, 'attack', 'Escape')).toBe(false);
    expect(notified).toBe(1); expect(store.uses('KeyQ')).toBe(true); expect(store.uses('KeyJ')).toBe(false);
    expect(new KeyboardMapStore(storage).getSnapshot()[0].attack).toEqual(['KeyQ']);
    store.reset();
    expect(storage.data.size).toBe(0); expect(store.getSnapshot()[0].attack).toEqual(['KeyJ']);
    expect(new KeyboardMapStore(memoryStorage({ 'smash-keyboard-map': 'not json' })).customized).toBe(false);
  });
});

describe('PlayInput with a rebound keyboard', () => {
  afterEach(() => vi.unstubAllGlobals());
  function harness() {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('Element', class extends EventTarget {});
    const keyboard = new KeyboardMapStore(memoryStorage());
    const input = new PlayInput(new EventTarget() as unknown as HTMLCanvasElement, new ControllerHub({ getGamepads: () => [], now: () => 0 }), keyboard);
    input.setLocalPlayerCount(2); input.enabled = true; input.poll();
    const key = (code: string, down = true) => { const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true }); Object.defineProperty(event, 'code', { value: code }); window.dispatchEvent(event); return event; };
    return { input, keyboard, key };
  }
  it('reads the new key, ignores the old one, and keeps the touch buttons working', () => {
    const h = harness();
    try {
      h.keyboard.bind(0, 'attack', 'KeyQ');
      expect(h.key('KeyQ').defaultPrevented).toBe(true);
      expect(h.input.poll()[0].attack).toBe(true);
      h.key('KeyQ', false);
      expect(h.key('KeyJ').defaultPrevented).toBe(false); // no longer a game key: the browser keeps it
      expect(h.input.poll()[0].attack).toBe(false);
      h.input.pressTouch('KeyJ', 1); // the on-screen A button is not the J key
      expect(h.input.poll()[0].attack).toBe(true);
      h.input.releaseTouch('KeyJ', 1);
      expect(h.input.poll()[0].attack).toBe(false);
    } finally { h.input.dispose(); }
  });
  it('a key stolen from player two stops driving player two', () => {
    const h = harness();
    try {
      h.keyboard.bind(0, 'jump', 'Enter');
      h.key('Enter');
      const [one, two] = h.input.poll();
      expect(one.jump).toBe(true); expect(two!.jump).toBe(false);
      h.key('Enter', false); h.key('Numpad0');
      expect(h.input.poll()[1]!.jump).toBe(true); // player two keeps the alternate key
    } finally { h.input.dispose(); }
  });
  it('does not feed the game while Options is capturing a key', () => {
    const h = harness();
    try {
      h.input.rebinding = true;
      expect(h.key('KeyJ').defaultPrevented).toBe(false);
      expect(h.input.poll()[0].attack).toBe(false);
    } finally { h.input.dispose(); }
  });
});
