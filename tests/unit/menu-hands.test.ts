import { describe, expect, test } from 'vitest';
import { ControllerHub } from '../../web/src/input/controller-hub.ts';
import { handLegend, handSpeed, pickHop } from '../../web/src/play/menu-hands.ts';

const buttons = (count: number, held: readonly number[] = []) => Array.from({ length: count }, (_, index) => ({ pressed: held.includes(index), value: held.includes(index) ? 1 : 0 }));
const pad = (index: number, id: string, held: readonly number[] = [], axes = [0, 0, 0, 0]) => ({ index, id, mapping: 'standard', connected: true, axes, buttons: buttons(17, held) });

describe('Smash-style floating hand cursor', () => {
  test('stick speed has a dead zone, eases in and caps at a full push', () => {
    const viewport = { width: 1280, height: 720 };
    expect(handSpeed(0.15, viewport)).toBe(0);
    expect(handSpeed(NaN, viewport)).toBe(0);
    const small = handSpeed(0.4, viewport), full = handSpeed(1, viewport);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(full * 0.25); // precise aiming on small tilts
    expect(full).toBeCloseTo(1152);
    expect(handSpeed(1.4, viewport)).toBe(full);
    expect(handSpeed(1, { width: 390, height: 300 })).toBe(650); // phones keep a usable floor
  });

  test('D-pad hops pick the nearest target in that direction and stay on the row', () => {
    const grid = [0, 1, 2].flatMap(row => [0, 1, 2].map(col => ({ left: col * 110, top: row * 90, width: 100, height: 80 })));
    const middle = { x: 160, y: 130 }; // inside cell (row 1, col 1) = index 4
    expect(pickHop(middle, grid, 'right')).toBe(5);
    expect(pickHop(middle, grid, 'left')).toBe(3);
    expect(pickHop(middle, grid, 'up')).toBe(1);
    expect(pickHop(middle, grid, 'down')).toBe(7);
    expect(pickHop({ x: 270, y: 40 }, grid, 'right')).toBe(-1); // nothing further right
    // A hand between cells still hops to the next one, never the one it just left.
    expect(pickHop({ x: 105, y: 40 }, grid, 'right')).toBe(1);
  });

  test('legend glyphs follow the controller family labels', () => {
    expect(handLegend('xbox')).toMatchObject({ a: 'A', b: 'B', x: 'X', y: 'Y', start: 'START' });
    expect(handLegend('playstation')).toMatchObject({ a: '✕', b: '○', bumpers: 'L1/R1' });
    expect(handLegend('nintendo')).toMatchObject({ a: 'A', b: 'B', x: 'Y', y: 'X', start: '+' });
    expect(handLegend(undefined).a).toBe('A');
  });

  test('menuPads reads every controller separately with its own seat ordinal', () => {
    const xbox = pad(0, 'Xbox Wireless Controller', [0, 5, 9], [0.8, -0.5, 0, 0.6]);
    const nintendo = pad(1, 'Nintendo Switch Pro Controller (Vendor: 057e Product: 2009)', [1, 15]);
    const spare = pad(2, 'Xbox Wireless Controller', [0]);
    const hub = new ControllerHub({ getGamepads: () => [xbox, nintendo, spare], now: () => 0 });
    hub.setLocalPlayerCount(2);
    hub.scan(0, true);
    const [first, second, third] = hub.menuPads();
    // Stick y grows up; the D-pad is reported separately and zeroes the analog read.
    expect(first).toMatchObject({ slot: 0, family: 'xbox', confirm: true, back: false, nextSeat: true, start: true, dpadX: 0 });
    expect(first!.x).toBeCloseTo(0.8);
    expect(first!.y).toBeCloseTo(0.5);
    expect(first!.cY).toBeCloseTo(-0.6);
    // Nintendo: the east button is labelled A, so it confirms.
    expect(second).toMatchObject({ slot: 1, family: 'nintendo', confirm: true, back: false, dpadX: 1, x: 0 });
    // A third pad without a local seat still drives its own hand.
    expect(third).toMatchObject({ slot: null, confirm: true });
    expect(hub.menuState()).toMatchObject({ confirm: true, right: true });
    hub.beginCalibration(hub.getSnapshot().devices[2]!.key);
    expect(hub.menuPads()).toHaveLength(2); // calibration owns that pad
    hub.dispose();
  });
});
