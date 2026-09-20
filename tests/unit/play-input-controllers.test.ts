import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayInput } from '../../web/src/play-input.ts';
import { ControllerHub } from '../../web/src/input/controller-hub.ts';

function harness() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('Element', class extends EventTarget {});
  const pads = Array.from({ length: 8 }, (_, ordinal) => ({ index: ordinal * 3, id: 'Xbox Wireless Controller', mapping: 'standard', connected: true,
    axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }));
  const hub = new ControllerHub({ getGamepads: () => pads, now: () => 0 });
  const input = new PlayInput(new EventTarget() as unknown as HTMLCanvasElement, hub);
  input.setLocalPlayerCount(8); input.enabled = true; input.poll();
  const button = (ordinal: number, index: number, down: boolean) => { pads[ordinal]!.buttons[index] = { pressed: down, value: +down }; };
  const key = (code: string, down = true) => {
    const event = new Event(down ? 'keydown' : 'keyup', { cancelable: true }); Object.defineProperty(event, 'code', { value: code }); window.dispatchEvent(event);
  };
  return { input, hub, pads, button, key };
}
afterEach(() => vi.unstubAllGlobals());
describe('PlayInput local-human ordinals, never fighter-seat mapping', () => {
  it('merges the first two keyboard layouts and eight pads without mapping CPU/OFF seats', () => {
    const h = harness();
    try {
      h.input.playerCount = 2; // obsolete total-match metadata must not truncate local source 8
      h.key('KeyD'); h.key('KeyN'); h.button(7, 3, true);
      const inputs = h.input.poll(); expect(inputs).toHaveLength(8);
      expect(inputs[0]).toMatchObject({ x: 1, attack: false, jump: false });
      expect(inputs[1]).toMatchObject({ x: 0, attack: true, jump: false });
      expect(inputs.slice(2, 7).every(input => input.x === 0 && !input.attack && !input.jump)).toBe(true);
      expect(inputs[7]).toMatchObject({ x: 0, attack: false, jump: true });
    } finally { h.input.dispose(); }
  });
  it('retains keyboard and eighth-pad taps across poll(false) until explicit consumption', () => {
    const h = harness();
    try {
      h.key('KeyJ'); h.key('KeyJ', false); h.button(7, 3, true);
      expect(h.input.poll(false)[0].attack).toBe(true);
      h.button(7, 3, false);
      for (let i = 0; i < 4; i++) {
        const inputs = h.input.poll(false); expect(inputs[0].attack).toBe(true); expect(inputs[7]!.jump).toBe(true);
      }
      h.input.consumeLatches(); const consumed = h.input.poll(false);
      expect(consumed[0].attack).toBe(false); expect(consumed[7]!.jump).toBe(false);
      h.key('KeyN'); h.key('KeyN', false); expect(h.input.poll()[1].attack).toBe(true); expect(h.input.poll(false)[1].attack).toBe(false);
    } finally { h.input.dispose(); }
  });
  it('holds the touch HOP jump for exactly one simulation frame, however long the thumb stays down', () => {
    const h = harness();
    try {
      h.input.pressTouch('ShortHop', 4);
      expect(h.input.poll(false)[0].jump).toBe(true); // an online tick that does not advance keeps the press
      expect(h.input.poll()[0].jump).toBe(true);
      for (let i = 0; i < 5; i++) expect(h.input.poll()[0].jump).toBe(false);
      h.input.releaseTouch('ShortHop', 4); h.input.pressTouch('ShortHop', 5);
      expect(h.input.poll()[0].jump).toBe(true);
      expect(h.input.poll()[0].jump).toBe(false);
      h.input.releaseTouch('ShortHop', 5);
    } finally { h.input.dispose(); }
  });
  it('keeps LAN to one active local human regardless of total room count and secondary keys/pads', () => {
    const h = harness();
    try {
      h.input.playerCount = 8; h.input.setLocalPlayerCount(1); h.input.poll();
      h.key('ArrowRight'); h.key('KeyN'); h.key('KeyD'); h.button(1, 3, true); h.button(7, 0, true);
      const inputs = h.input.poll(false); expect(inputs).toHaveLength(2);
      expect(inputs[0].x).toBe(1); expect(inputs[1]).toMatchObject({ x: 0, y: 0, attack: false, jump: false });
      expect(h.hub.getSnapshot().localPlayerCount).toBe(1); expect(h.hub.getSnapshot().devices[7]!.slot).toBe(7);
    } finally { h.input.dispose(); }
  });
  it('clears stale keyboard/touch/latches on capacity changes but never consumes deferred input on a no-op count', () => {
    const h = harness();
    try {
      h.key('KeyJ'); h.key('KeyJ', false); h.input.pressTouch('Space', 12); h.input.releaseTouch('Space', 12);
      h.input.setLocalPlayerCount(8); expect(h.input.poll(false)[0]).toMatchObject({ attack: true, jump: true });
      h.input.setLocalPlayerCount(1); expect(h.input.poll(false)[0]).toMatchObject({ attack: false, jump: false });
      h.input.setLocalPlayerCount(8); expect(h.input.poll(false).every(input => !input.attack && !input.jump)).toBe(true);
    } finally { h.input.dispose(); }
  });
  it('scans Menu9 while disabled, with all eight gameplay vectors neutral and no stuck enable input', () => {
    const h = harness();
    try {
      let menus = 0; h.hub.onMenu = () => { menus++; }; h.input.enabled = false;
      h.button(7, 9, true); h.button(7, 3, true); h.key('KeyJ'); h.input.pressTouch('Space', 1);
      expect(h.input.poll(false).every(input => !input.attack && !input.jump && input.x === 0)).toBe(true); expect(menus).toBe(1);
      h.input.enabled = true; expect(h.input.poll(false)[7]!.jump).toBe(false); expect(menus).toBe(1);
      h.button(7, 3, false); h.input.poll(); h.button(7, 3, true); expect(h.input.poll()[7]!.jump).toBe(true);
    } finally { h.input.dispose(); }
  });
  it('allows a menu-only exhibition source while the host ignores gameplay vectors', () => {
    const h = harness();
    try {
      h.input.setLocalPlayerCount(1); h.input.enabled = false;
      let menus = 0; h.hub.onMenu = () => { menus++; }; h.button(0, 9, true); h.button(0, 0, true);
      const inputs = h.input.poll(false); expect(inputs).toHaveLength(2); expect(inputs.every(input => !input.attack)).toBe(true); expect(menus).toBe(1);
      h.button(7, 9, true); h.input.poll(); expect(menus).toBe(1); // inactive reservation cannot toggle exhibition options
    } finally { h.input.dispose(); }
  });
});
