import { describe, expect, it } from 'vitest';
import {
  ANDROID_PAD_INDEX_BASE,
  androidBridge,
  androidPads,
  hasNativeBridge,
  androidRumbleAll,
  androidSnapshotToPad,
  androidVibrate,
  parseAndroidPads,
} from '../../web/src/android-bridge.ts';
import { controllerProfile } from '../../lib/input/gamepad-profiles.ts';
import { parseAppUpdateState } from '../../web/src/android-bridge.ts';
import { updateAction } from '../../web/src/play/app-update.tsx';

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  id: 3,
  name: 'Xbox Wireless Controller',
  buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  axes: [0.1, -0.2, 0, 0],
  vibrator: true,
  ...overrides,
});

describe('android native gamepad bridge', () => {
  it('maps native snapshots to standard PadRecords without browser index collisions', () => {
    const pad = androidSnapshotToPad(snapshot())!;
    expect(pad).not.toBeNull();
    expect(pad.index).toBe(ANDROID_PAD_INDEX_BASE + 3);
    expect(pad.index).toBeGreaterThanOrEqual(32);
    expect(pad.mapping).toBe('standard');
    expect(pad.connected).toBe(true);
    expect(pad.buttons[9]!.pressed).toBe(true);
    expect(pad.axes[0]).toBeCloseTo(0.1);
  });
  it('adds vendor/product ids so generic names like Sony "Wireless Controller" identify and automap', () => {
    const pad = androidSnapshotToPad(snapshot({ name: 'Wireless Controller', vendor: 0x054c, product: 0x0ce6 }))!;
    expect(pad.id).toBe('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)');
    expect(controllerProfile(pad)).toMatchObject({ family: 'playstation', standard: true });
    expect(controllerProfile(pad).mapping).not.toBeNull();
    expect(androidSnapshotToPad(snapshot({ vendor: 0 }))!.id).toBe('Xbox Wireless Controller');
    expect(androidSnapshotToPad(snapshot({ vendor: 70000 }))!.id).toBe('Xbox Wireless Controller');
  });
  it('reads the shell update state for the home update button, with a fallback for older shells', () => {
    const ready = parseAppUpdateState({ version: () => '', check: () => {}, apply: () => {}, state: () => JSON.stringify({ app: '2026.09.17-0445', game: '2026.09.17-0445 (built in)', phase: 'ready', message: '', ready: '2026.09.17-0541', appUpdate: null, done: 10, total: 10 }) });
    expect(ready).toMatchObject({ app: '2026.09.17-0445', phase: 'ready', ready: '2026.09.17-0541', interactive: true });
    expect(updateAction(ready)).toMatchObject({ label: 'Update ready · Reload', highlight: true, busy: false });
    const downloading = parseAppUpdateState({ version: () => '', check: () => {}, apply: () => {}, state: () => JSON.stringify({ phase: 'downloading', done: 512, total: 2048 }) });
    expect(updateAction(downloading)).toMatchObject({ label: 'Downloading 25%', busy: true });
    const old = parseAppUpdateState({ version: () => 'app 2026.09.17-0445 · game 2026.09.17-0541 (downloaded)', check: () => {} });
    expect(old).toMatchObject({ app: '2026.09.17-0445', game: '2026.09.17-0541 (downloaded)', phase: 'unknown', interactive: false });
    expect(updateAction(old).label).toBe('Check for updates');
    const broken = parseAppUpdateState({ version: () => 'x', check: () => {}, state: () => 'not json' });
    expect(broken.phase).toBe('unknown');
    expect(updateAction(parseAppUpdateState({ version: () => '', check: () => {}, state: () => JSON.stringify({ phase: 'error', message: 'Game update failed: IOException' }) }))).toMatchObject({ label: 'Retry update', detail: 'Game update failed: IOException' });
  });
  it('rejects malformed snapshots instead of feeding gameplay', () => {
    expect(androidSnapshotToPad(null)).toBeNull();
    expect(androidSnapshotToPad({ id: 1 })).toBeNull();
    expect(androidSnapshotToPad(snapshot({ buttons: [1, 0] }))).toBeNull();
    expect(androidSnapshotToPad(snapshot({ axes: [0, 0] }))).toBeNull();
    expect(androidSnapshotToPad(snapshot({ id: 5000 }))).toBeNull();
    expect(parseAndroidPads('not json')).toEqual([]);
    expect(parseAndroidPads(JSON.stringify([snapshot(), { bogus: true }]))).toHaveLength(1);
  });
  it('detects the native shell for the boot gate', () => {
    expect(hasNativeBridge()).toBe(false);
    (globalThis as { window?: unknown }).window = { SmashPad: {} };
    expect(hasNativeBridge()).toBe(true);
    delete (globalThis as { window?: unknown }).window;
    expect(hasNativeBridge()).toBe(false);
  });
  it('reads live pads through window.SmashPad and stays empty without the shell', () => {
    expect(androidBridge()).toBeNull();
    expect(androidPads()).toEqual([]);
    const bridge = { getPads: () => JSON.stringify([snapshot()]), rumbleAll: () => {}, vibrateCsv: () => {} };
    expect(androidPads(bridge)).toHaveLength(1);
    expect(androidPads({ getPads: () => { throw new Error('denied'); }, rumbleAll: () => {}, vibrateCsv: () => {} })).toEqual([]);
  });
  it('rumbles native pads and vibrates the handset through the shell', () => {
    const calls: unknown[] = [];
    const bridge = {
      getPads: () => '[]',
      rumbleAll: (strong: number, weak: number, durationMs: number) => { calls.push(['rumble', strong, weak, durationMs]); },
      vibrateCsv: (pattern: string) => { calls.push(['vibrate', pattern]); },
    };
    expect(androidRumbleAll(0.8, 0.5, 120, bridge)).toBe(true);
    expect(androidVibrate([0, 500, 50, 80], bridge)).toBe(true);
    expect(calls).toEqual([
      ['rumble', 0.8, 0.5, 120],
      ['vibrate', '0,500,50,80'],
    ]);
    expect(androidRumbleAll(1, 1, 100)).toBe(false);
    expect(androidVibrate(50)).toBe(false);
  });
});
