import { describe, expect, test } from 'vitest';
import { ControllerHub } from '../../web/src/input/controller-hub.ts';
import { adjustRangeValue, adjustSelectValue, cycleSeat, findNextFocus, preferredFocus } from '../../web/src/play/gamepad-menu.ts';

const buttons = (count: number) => Array.from({ length: count }, () => ({ pressed: false, value: 0 }));

function standardPad(overrides: Partial<{ axes: number[]; buttons: { pressed: boolean; value: number }[] }> = {}) {
  return {
    index: 0,
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
    mapping: 'standard' as const,
    connected: true,
    axes: overrides.axes ?? [0, 0, 0, 0],
    buttons: overrides.buttons ?? buttons(17),
  };
}

describe('controller menu state', () => {
  test('no connected device exposes no menu navigation', () => {
    const hub = new ControllerHub({ getGamepads: () => [], now: () => 0 });
    expect(hub.menuState()).toEqual({ connected: false, up: false, down: false, left: false, right: false, confirm: false, back: false, prevSeat: false, nextSeat: false });
    hub.dispose();
  });

  test('unassigned mapped pads still navigate the shared menus', () => {
    const pad = standardPad();
    const hub = new ControllerHub({ getGamepads: () => [pad], now: () => 0 });
    hub.scan(0, true);
    expect(hub.menuState().connected).toBe(true);
    hub.assign(hub.getSnapshot().devices[0]!.key, null);
    expect(hub.getSnapshot().devices[0]!.slot).toBeNull();
    expect(hub.menuState().connected).toBe(true);
    (pad as { axes: number[] }).axes = [-0.8, 0, 0, 0];
    hub.scan(1, true);
    expect(hub.menuState()).toMatchObject({ left: true, right: false });
    hub.dispose();
  });

  test('unknown-brand standard pads are automapped for gameplay and menus', () => {
    const pad = { ...standardPad(), id: 'Generic USB Gamepad (STANDARD GAMEPAD)' };
    const hub = new ControllerHub({ getGamepads: () => [pad], now: () => 0 });
    hub.scan(0, true);
    expect(hub.getSnapshot().devices[0]).toMatchObject({ usable: true, guessed: false });
    expect(hub.menuState().connected).toBe(true);
    hub.dispose();
  });

  test('standard-layout pads whose standard mapping is invalid navigate menus via raw indices, never gameplay', () => {
    // 14 buttons: D-pad left/right (14/15) are missing, so no standard mapping validates.
    const pad = { ...standardPad({ buttons: buttons(14) }), id: 'Generic USB Gamepad (STANDARD GAMEPAD)' };
    const hub = new ControllerHub({ getGamepads: () => [pad], now: () => 0 });
    hub.scan(0, true);
    expect(hub.getSnapshot().devices[0]!.mapping).toBeNull();
    expect(hub.inputs(false)[0]).toMatchObject({ x: 0, y: 0, jump: false, special: false });
    expect(hub.menuState().connected).toBe(true);
    (pad as { axes: number[] }).axes = [0, -0.9, 0, 0];
    hub.scan(1, true);
    expect(hub.menuState()).toMatchObject({ up: true, down: false });
    (pad as { axes: number[] }).axes = [0, 0, 0, 0];
    (pad as { buttons: { pressed: boolean; value: number }[] }).buttons = buttons(14).map((button, index) =>
      index === 0 || index === 5 ? { pressed: true, value: 1 } : button,
    );
    hub.scan(2, true);
    expect(hub.menuState()).toMatchObject({ confirm: true, back: false, nextSeat: true, prevSeat: false });
    // D-pad runs the same raw path.
    (pad as { buttons: { pressed: boolean; value: number }[] }).buttons = buttons(14).map((button, index) =>
      index === 1 || index === 4 || index === 13 ? { pressed: true, value: 1 } : button,
    );
    hub.scan(3, true);
    expect(hub.menuState()).toMatchObject({ confirm: false, back: true, prevSeat: true, down: true });
    hub.dispose();
  });

  test('non-standard pads navigate menus through their best-guess mapping, and stay silent when nothing fits', () => {
    const pad = { ...standardPad(), id: 'Custom Raw Pad', mapping: '' };
    const hub = new ControllerHub({ getGamepads: () => [pad], now: () => 0 });
    hub.scan(0, true);
    expect(hub.getSnapshot().devices[0]).toMatchObject({ usable: true, guessed: true });
    (pad as { buttons: { pressed: boolean; value: number }[] }).buttons = buttons(17).map((button, index) =>
      index === 0 ? { pressed: true, value: 1 } : button,
    );
    hub.scan(1, true);
    expect(hub.menuState()).toMatchObject({ connected: true, confirm: true });
    hub.dispose();
    const tiny = { ...standardPad({ buttons: buttons(5) }), id: 'Tiny Raw Pad', mapping: '' };
    const silent = new ControllerHub({ getGamepads: () => [tiny], now: () => 0 });
    silent.scan(0, true);
    expect(silent.getSnapshot().devices[0]).toMatchObject({ usable: false, guessed: false });
    expect(silent.menuState().connected).toBe(false);
    silent.dispose();
  });

  test('standard mapping drives directions plus confirm/back while gameplay is disabled', () => {
    const pad = standardPad();
    const hub = new ControllerHub({ getGamepads: () => [pad], now: () => 0 });
    hub.scan(0, true);
    // Gameplay disabled by default: gameplay inputs stay neutral, menus still work.
    expect(hub.inputs(false)[0]).toMatchObject({ x: 0, y: 0, jump: false, special: false });
    expect(hub.menuState().connected).toBe(true);

    (pad as { axes: number[] }).axes = [0.8, 0, 0, 0];
    hub.scan(1, true);
    expect(hub.menuState()).toMatchObject({ right: true, left: false });

    (pad as { axes: number[] }).axes = [0, 0, 0, 0];
    (pad as { buttons: { pressed: boolean; value: number }[] }).buttons = buttons(17).map((button, index) =>
      index === 0 ? { pressed: true, value: 1 } : button,
    );
    hub.scan(2, true);
    expect(hub.menuState()).toMatchObject({ confirm: true, back: false });

    (pad as { buttons: { pressed: boolean; value: number }[] }).buttons = buttons(17).map((button, index) =>
      index === 1 ? { pressed: true, value: 1 } : button,
    );
    hub.scan(3, true);
    expect(hub.menuState()).toMatchObject({ confirm: false, back: true });
    hub.dispose();
  });

  test('calibration suppresses menu navigation', () => {
    const pad = standardPad();
    const hub = new ControllerHub({ getGamepads: () => [pad], now: () => 0 });
    hub.scan(0, true);
    const key = hub.getSnapshot().devices[0]!.key;
    hub.beginCalibration(key);
    hub.scan(1, true);
    expect(hub.menuState().connected).toBe(false);
    expect(hub.getSnapshot().devices[0]!.calibration).not.toBeNull();
    hub.dispose();
  });
});

function fakeElement(left: number, top: number): HTMLElement {
  return {
    getBoundingClientRect: () =>
      ({ left, top, width: 10, height: 10, right: left + 10, bottom: top + 10, x: left, y: top, toJSON: () => ({}) }) as DOMRect,
  } as HTMLElement;
}

describe('gamepad menu focus geometry', () => {
  test('spatial navigation keeps grid rows and columns', () => {
    const a = fakeElement(0, 0);
    const b = fakeElement(20, 0);
    const c = fakeElement(0, 20);
    expect(findNextFocus(a, [a, b, c], 'right')).toBe(b);
    expect(findNextFocus(a, [a, b, c], 'down')).toBe(c);
    expect(findNextFocus(b, [a, b, c], 'left')).toBe(a);
    expect(findNextFocus(a, [a, b, c], 'up')).toBeNull();
  });

  test('select cycles enabled options and notifies listeners', () => {
    const dispatched: string[] = [];
    const select = {
      options: [{ value: '1', disabled: false }, { value: '2', disabled: false }, { value: '3', disabled: true }],
      selectedIndex: 0,
      value: '1',
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        return true;
      },
    } as unknown as HTMLSelectElement;
    expect(adjustSelectValue(select, 'right')).toBe(true);
    expect(select.value).toBe('2');
    expect(dispatched).toEqual(['input', 'change']);
    // Skips the disabled third option and wraps.
    expect(adjustSelectValue(select, 'right')).toBe(true);
    expect(select.value).toBe('1');
  });

  test('bumpers cycle the active character-select seat with wrap and skips', () => {
    const seats = (pressed: number | null, count: number, disabled: readonly number[] = []) => ({
      querySelector: (selectors: string) => (selectors === '.battle-select' ? {} : null),
      querySelectorAll: (selectors: string) =>
        selectors === '.battle-select .seat-select'
          ? Array.from({ length: count }, (_, slot) => ({
            id: `select-seat-${slot}`,
            disabled: disabled.includes(slot),
            getAttribute: (name: string) => (name === 'aria-pressed' ? String(slot === pressed) : null),
          }))
          : [],
    });
    const picked: number[] = [];
    const session = { selectSeat: (slot: number) => { picked.push(slot); } };
    expect(cycleSeat(seats(0, 3), session, 1)).toBe(true);
    expect(cycleSeat(seats(0, 3), session, -1)).toBe(true);
    expect(picked).toEqual([1, 2]); // next, then wrap-around previous
    picked.length = 0;
    expect(cycleSeat(seats(0, 3, [1]), session, 1)).toBe(true);
    expect(picked).toEqual([2]); // disabled seats are skipped
    expect(cycleSeat({ querySelector: () => null, querySelectorAll: () => [] }, session, 1)).toBe(false);
    expect(picked).toEqual([2]); // outside fighter setup: inert, no call
  });

  test('range steps for controller left/right', () => {
    const dispatched: string[] = [];
    const range = {
      min: '0',
      max: '1',
      step: '0.05',
      value: '0.3',
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        return true;
      },
    } as unknown as HTMLInputElement;
    expect(adjustRangeValue(range, 'right')).toBe(true);
    expect(Number(range.value)).toBeCloseTo(0.35);
    expect(dispatched).toEqual(['input', 'change']);
  });
});

describe('gamepad menu starting focus', () => {
  type Fake = { name: string; closest: (selector: string) => unknown; getAttribute: (key: string) => string | null };
  /** Fake focus candidate: `within` lists the selectors it matches or sits inside. */
  const make = (name: string, within: string[] = [], attrs: Record<string, string> = {}): Fake => {
    const node: Fake = { name, closest: (selector) => (within.includes(selector) ? node : null), getAttribute: (key) => attrs[key] ?? null };
    return node;
  };
  const pick = (...candidates: Fake[]) => (preferredFocus(candidates as never[]) as Fake | null)?.name ?? null;

  test('skips the header settings icons and lands on the screen action', () => {
    const controllers = make('controllers', ['.system-menu']), options = make('options', ['.system-menu']);
    const abandon = make('abandon'), fight = make('fight', [], { 'data-pad-default': '' });
    expect(pick(controllers, options, abandon, fight)).toBe('fight');
    expect(pick(controllers, options, abandon)).toBe('abandon');
  });

  test('prefers the hub highlight, then the selected body tile, then the first body control', () => {
    const settings = make('settings', ['.system-menu']);
    const mirror = make('mirror', ['.rogue-screen-body']), begin = make('begin', ['.rogue-screen-body', '.rogue-nav.primary']);
    expect(pick(settings, mirror, begin)).toBe('begin');
    const fox = make('fox', ['.rogue-screen-body'], { 'aria-pressed': 'false' }), zero = make('zero', ['.rogue-screen-body'], { 'aria-pressed': 'true' });
    expect(pick(settings, fox, zero)).toBe('zero');
    expect(pick(settings, make('leave'), make('card', ['.rogue-screen-body']))).toBe('card');
    expect(pick()).toBeNull();
  });
});
