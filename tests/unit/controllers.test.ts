import { describe, expect, it } from 'vitest';
import { ACTIONS, controllerProfile, emptyMapping, guessedMapping, mappedInput, mappingError, standardMapping, type ControllerAction, type PadRecord } from '../../lib/input/gamepad-profiles.ts';
import { ControllerHub, MAX_LOCAL_CONTROLLERS, type LocalControllerCount } from '../../web/src/input/controller-hub.ts';

function pad(index = 0, id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)', mapping = 'standard', buttons = 17, axes = 4) {
  return {index, id, mapping, connected: true, buttons: Array.from({length: buttons}, () => ({pressed: false, value: 0})), axes: Array.from({length: axes}, () => 0)};
}
type TestPad = ReturnType<typeof pad>;
function memoryStorage(initial: string | null = null) { let value = initial; return {getItem: () => value, setItem: (_key: string, next: string) => { value = next; }}; }
function harness(initial: Array<TestPad | null>, storage = memoryStorage()) {
  let now = 0, records = initial;
  const hub = new ControllerHub({getGamepads: () => records, now: () => now, storage, secureContext: true, platform: 'Linux'});
  const scan = (advance = 1) => { now += advance; hub.scan(now); };
  const devices = () => { hub.detect(); return hub.getSnapshot().devices; };
  hub.detect(); hub.setEnabled(true); scan();
  return {hub, scan, devices, storage, records: (next: Array<TestPad | null>) => { records = next; scan(); }};
}
const press = (p: TestPad, index: number, down = true) => { p.buttons[index]!.pressed = down; p.buttons[index]!.value = +down; };
const rawActions: readonly ControllerAction[] = ['jump', 'attack', 'strong', 'special', 'shield', 'grab', 'left', 'right', 'up', 'down'];
function calibrateDpad(h: ReturnType<typeof harness>, p: TestPad) {
  const key = h.devices()[0]!.key; h.hub.beginCalibration(key);
  rawActions.forEach((action, index) => { h.hub.listen(key, action); press(p, index); h.scan(); press(p, index, false); h.scan(); });
  h.hub.saveCalibration(key); h.scan(); return key;
}

describe('browser-standard controller profiles and conservative raw identification', () => {
  it.each([
    ['Xbox Wireless Controller', 'xbox', 'A'], ['045e-028e-Microsoft X-Box 360 pad', 'xbox', 'A'],
    ['DualSense Wireless Controller (054c)', 'playstation', 'Cross'], ['Sony DualShock 4', 'playstation', 'Cross'],
    ['Nintendo Switch Pro Controller (Vendor: 057e Product: 2009)', 'nintendo', 'B (south)'],
    ['GameSir-G8', 'gamesir', 'A'], ['GameSir X2 Bluetooth', 'gamesir', 'A'], ['GameSir T4 Pro', 'gamesir', 'A'],
    ['Nintendo RVL-CNT-01', 'wii', 'South'], ['Wii U Pro Controller', 'wii', 'South'], ['Mystery Gamepad', 'unknown', 'South'],
    // Sony's Bluetooth HID name on Android/Linux/macOS, with and without Chrome's vendor suffix.
    ['Wireless Controller', 'playstation', 'Cross'], ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'playstation', 'Cross'],
    ['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'xbox', 'A'],
  ])('identifies %s only as a model hint over browser-standard mapping', (id, family, face) => {
    const profile = controllerProfile(pad(0, id)); expect(profile.family).toBe(family); expect(profile.labels[0]).toContain(face); expect(profile.mapping).not.toBeNull();
  });
  it('automaps a standard-layout GameSir with gameplay, menus and Start, no clicks needed', () => {
    const p = pad(0, 'GameSir-G8');
    const h = harness([p]);
    const device = h.devices()[0]!;
    expect(device.profile).toBe('GameSir');
    expect(device.usable).toBe(true);
    expect(h.hub.menuState().connected).toBe(true);
    press(p, 3); h.scan();
    expect(h.hub.inputs()[0].jump).toBe(true);
    press(p, 3, false); press(p, 9); h.scan();
    let menus = 0; h.hub.onMenu = () => { menus++; };
    press(p, 9, false); h.scan(); press(p, 9); h.scan();
    expect(menus).toBe(1);
  });
  it('never calls generic Nintendo vendor057e a Wii and never gives a raw brand ID a standard profile', () => {
    expect(controllerProfile(pad(0, '057e Nintendo controller')).family).toBe('nintendo');
    for (const id of ['Xbox controller', 'DualSense', 'Wii Remote', 'unknown']) { const profile = controllerProfile(pad(0, id, '')); expect(profile.mapping).toBeNull(); expect(profile.labels).toEqual([]); }
  });
  it('uses only valid standard button/axis capabilities, not guessed missing indices', () => {
    expect(controllerProfile(pad(0, 'Xbox', 'standard', 5, 1)).mapping).toBeNull();
  });
  it('guesses a raw layout only from exposed indices and centered sticks', () => {
    const guess = guessedMapping(pad(0, 'raw', '', 12, 4))!;
    expect(guess.buttons).toMatchObject({attack: [0], special: [1], jump: [2, 3], grab: [4, 5], strong: [11], shield: [6, 7], left: [], up: []});
    expect(guess.axes).toMatchObject({x: {index: 0, sign: 1}, y: {index: 1, sign: -1}, cx: null, cy: null});
    expect(guessedMapping(pad(0, 'raw', '', 7, 2))!.buttons.shield).toEqual([6]);
    expect(guessedMapping(pad(0, 'raw', '', 8, 2))!.buttons).toMatchObject({grab: [4], strong: [5], shield: [6, 7]}); // no R3: Strong falls back to RB
    expect(guessedMapping(pad(0, 'raw', '', 6, 4))).toBeNull(); // no shield button left
    expect(guessedMapping(pad(0, 'raw', '', 11, 0))).toBeNull(); // no movement axes
    const trigger = pad(0, 'raw', '', 17, 4); trigger.axes[1] = -1; // resting trigger on axis 1
    expect(guessedMapping(trigger)).toBeNull();
  });
  it.each([2, 3])('maps standard jump button %i', button => { const p = pad(); press(p, button); expect(mappedInput(p, standardMapping()).jump).toBe(true); });
  it('keeps "A attacks, B specials" on Nintendo pads, whose standard positions are labelled the other way round', () => {
    const nintendo = controllerProfile(pad(0, 'Nintendo Switch Pro Controller (Vendor: 057e Product: 2009)')).mapping!;
    expect(nintendo.buttons).toMatchObject({attack: [1], special: [0], jump: [2, 3], grab: [4, 5], shield: [6, 7]});
    expect(controllerProfile(pad()).mapping!.buttons).toMatchObject({attack: [0], special: [1]});
  });
  it.each([[0, 'attack'], [11, 'strong'], [1, 'special'], [6, 'shield'], [7, 'shield'], [4, 'grab'], [5, 'grab']] as const)('maps standard button %i to %s', (button, action) => {
    const p = pad(); press(p, button); expect(mappedInput(p, standardMapping())[action]).toBe(true);
  });
  it('preserves original analog amplitude outside the deadzone, including -0.3 walking', () => {
    const p = pad(); p.axes = [-0.3, 0.3]; const input = mappedInput(p, standardMapping());
    expect(input.x).toBe(-0.3); expect(input.y).toBe(-0.3);
    p.axes = [0.17, -0.17]; expect(mappedInput(p, standardMapping())).toMatchObject({x: 0, y: 0});
  });
  it('bounds malformed axes and trigger values, supports D-pad movement and inverted vertical stick', () => {
    const p = pad(); p.axes = [NaN, Infinity]; expect(mappedInput(p, standardMapping())).toMatchObject({x: 0, y: 0});
    p.axes = [9, -9]; expect(mappedInput(p, standardMapping())).toMatchObject({x: 1, y: 1});
    p.axes = [0, 0.9]; expect(mappedInput(p, standardMapping()).down).toBe(true);
    p.axes = [0, 0]; press(p, 14); press(p, 12); expect(mappedInput(p, standardMapping())).toMatchObject({x: -1, y: 1});
    p.buttons[6]!.value = 0.54; expect(mappedInput(p, standardMapping()).shield).toBe(false);
    p.buttons[6]!.value = 0.56; expect(mappedInput(p, standardMapping()).shield).toBe(true);
    p.buttons[6]!.value = NaN; expect(mappedInput(p, standardMapping()).shield).toBe(false);
  });
  it('validates mapping schema, duplicate controls, axis signs, complete actions and bounds', () => {
    expect(mappingError(emptyMapping(), pad())).toContain('Bind');
    const duplicate = standardMapping(); duplicate.buttons.grab = [2]; expect(mappingError(duplicate, pad())).toContain('more than once');
    const bounds = standardMapping(); bounds.buttons.attack = [64]; expect(mappingError(bounds, pad())).toContain('unavailable');
    const axes = standardMapping(); axes.axes.x!.sign = 0 as 1; expect(mappingError(axes, pad())).toContain('axis');
    const sameAxis = standardMapping(); sameAxis.axes.y!.index = 0; expect(mappingError(sameAxis, pad())).toContain('different axes');
    for (const value of [null, {}, {version: 2}, {...standardMapping(), deadzone: NaN}, {...standardMapping(), threshold: 2}]) expect(mappingError(value, pad())).not.toBeNull();
  });
});

describe('ControllerHub local assignments, discovery, safe calibration and persistence', () => {
  it('samples button changes immediately, without waiting for the 10Hz UI publisher', () => {
    const p = pad(), h = harness([p]); let published = 0; h.hub.subscribe(() => published++);
    press(p, 3); h.scan(); expect(h.hub.inputs(false)[0].jump).toBe(true); expect(published).toBe(0);
    press(p, 3, false); h.scan(); expect(h.hub.inputs(false)[0].jump).toBe(true); // buffered tap through a stalled network tick
    h.hub.consumeLatches(); expect(h.hub.inputs(false)[0].jump).toBe(false);
    h.scan(100); expect(published).toBe(1);
  });
  it('exposes standard Menu/Options as a separate UI rising edge across enabled/disabled transitions', () => {
    const p = pad(), h = harness([p]); let menus = 0; h.hub.onMenu = () => { menus++; h.hub.setEnabled(false); };
    press(p, 9); h.scan(); expect(menus).toBe(1); h.hub.releaseInputs(); h.scan(); expect(menus).toBe(1);
    press(p, 9, false); h.scan(); press(p, 9); h.scan(); expect(menus).toBe(2);
    expect(h.hub.inputs()[0]).toMatchObject({attack: false, special: false, jump: false});
    press(p, 9, false); h.scan(); h.hub.beginCalibration(h.devices()[0]!.key); press(p, 9); h.scan(); expect(menus).toBe(2);
  });
  it('never guesses a raw Menu button and suppresses Menu when button9 is remapped to gameplay', () => {
    const p = pad(), h = harness([p]); let menus = 0; h.hub.onMenu = () => { menus++; };
    const key = h.devices()[0]!.key; h.hub.beginCalibration(key); h.hub.listen(key, 'jump'); press(p, 9); h.scan(); press(p, 9, false); h.scan(); h.hub.saveCalibration(key); h.scan();
    press(p, 9); h.scan(); expect(menus).toBe(0); expect(h.hub.inputs()[0].jump).toBe(true);
    const raw = pad(0, 'raw', '', 11, 0), other = harness([raw]); calibrateDpad(other, raw); other.hub.onMenu = () => { menus++; };
    press(raw, 9); other.scan(); expect(menus).toBe(0);
  });
  it('keeps sparse browser indices in stable slots, without shifting P2 when P1 disconnects', () => {
    const a = pad(0), b = pad(3, 'DualSense'); const h = harness([a, null, null, b]);
    expect(h.devices().map(device => [device.index, device.slot])).toEqual([[0, 0], [3, 1]]);
    press(a, 3); press(b, 0); h.scan(); h.hub.consumeLatches();
    h.records([null, null, null, b]); expect(h.hub.inputs(false)[0].jump).toBe(false); expect(h.hub.inputs(false)[1].attack).toBe(true);
    expect(h.devices()[1]!.slot).toBe(1);
  });
  it('reconnects at the same browser index without stuck buttons, and does not claim physical identity', () => {
    const p = pad(), h = harness([p]); press(p, 3); h.scan(); h.records([]);
    expect(h.hub.inputs(false)[0].jump).toBe(false); h.records([p]); expect(h.hub.inputs(false)[0].jump).toBe(false);
    press(p, 3, false); h.scan(); press(p, 3); h.scan(); expect(h.hub.inputs(false)[0].jump).toBe(true);
    h.records([]); const moved = pad(4); h.records([null, null, null, null, moved]);
    expect(h.devices().map(device => device.slot)).toEqual([0, 1]); // manual reclaim, not a fabricated physical UUID
  });
  it('handles identical controllers and replacement devices with explicit reassignment', () => {
    const a = pad(0), b = pad(1), h = harness([a, b]); const first = h.devices()[0]!, second = h.devices()[1]!;
    h.hub.assign(second.key, 0); expect(h.devices().map(device => device.slot)).toEqual([null, 0]);
    h.hub.assign(first.key, 1); h.scan(); press(a, 3); h.scan(); expect(h.hub.inputs(false)[1].jump).toBe(true);
    h.records([null, b]); h.hub.forget(first.key); expect(h.devices()).toHaveLength(1);
    expect(() => h.hub.forget(second.key)).toThrow('Disconnect');
  });
  it('limits online/practice to one local slot while keeping offline P2 reservation', () => {
    const a = pad(0), b = pad(1), h = harness([a, b]); h.hub.setLocalPlayerCount(1); h.scan(); press(b, 3); h.scan();
    expect(h.hub.inputs(false)[1].jump).toBe(false); expect(h.devices()[1]!.slot).toBe(1);
    expect(() => h.hub.assign(h.devices()[1]!.key, 1)).toThrow('unavailable');
    h.hub.setLocalPlayerCount(2); h.scan(); expect(h.hub.inputs(false)[1].jump).toBe(false); // held during mode change
    press(b, 3, false); h.scan(); press(b, 3); h.scan(); expect(h.hub.inputs(false)[1].jump).toBe(true);
  });
  it('automatically assigns a waiting second pad when switching practice to local versus, without undoing manual unassignment', () => {
    const a = pad(0), b = pad(1); const hub = new ControllerHub({getGamepads: () => [a, b]});
    hub.setLocalPlayerCount(1); hub.detect(); expect(hub.getSnapshot().devices.map(device => device.slot)).toEqual([0, null]);
    hub.setLocalPlayerCount(2); expect(hub.getSnapshot().devices.map(device => device.slot)).toEqual([0, 1]);
    hub.assign(hub.getSnapshot().devices[1]!.key, null); hub.setLocalPlayerCount(1); hub.setLocalPlayerCount(2);
    expect(hub.getSnapshot().devices[1]!.slot).toBeNull();
  });
  it('automaps unidentified standard controllers and best-guesses raw ones, flagging the guess', () => {
    const unknown = pad(0, 'Mystery'), h = harness([unknown]); expect(h.devices()[0]).toMatchObject({usable: true, guessed: false, calibrated: false});
    press(unknown, 3); h.scan(); expect(h.hub.inputs()[0].jump).toBe(true);
    const sony = pad(0, 'Wireless Controller'), ps = harness([sony]); expect(ps.devices()[0]).toMatchObject({profile: 'PlayStation', usable: true, guessed: false});
    const rawPad = pad(0, 'Xbox raw adapter', ''), raw = harness([rawPad]); expect(raw.devices()[0]).toMatchObject({usable: true, guessed: true, calibrated: false});
    press(rawPad, 0); raw.scan(); expect(raw.hub.inputs()[0].attack).toBe(true);
    expect(() => raw.hub.confirmStandard(raw.devices()[0]!.key)).toThrow('raw');
    raw.hub.resetMapping(raw.devices()[0]!.key); expect(raw.devices()[0]).toMatchObject({usable: true, guessed: true});
    const axisless = harness([pad(0, 'Nintendo RVL-CNT-01 Wii Remote', '', 11, 0)]); expect(axisless.devices()[0]).toMatchObject({usable: false, guessed: false});
  });
  it('calibrates an axisless raw Wii D-pad and all required actions into real gameplay input', () => {
    const p = pad(0, 'Nintendo RVL-CNT-01 Wii Remote', '', 11, 0), h = harness([p]); calibrateDpad(h, p);
    expect(h.devices()[0]!.usable).toBe(true); press(p, 6); press(p, 9); press(p, 0); h.scan();
    expect(h.hub.inputs(false)[0]).toMatchObject({x: -1, y: -1, down: true, jump: true});
    const stored = h.storage.getItem(); expect(stored).not.toContain(p.id); expect(stored).not.toContain('controller-');
    expect(stored).toContain('wii:raw:11:0');
  });
  it('never silently reapplies raw profile collisions, but permits explicit saved profile confirmation', () => {
    const p = pad(0, 'Unknown adapter A SERIAL-private', '', 11, 0), h = harness([p]); calibrateDpad(h, p);
    const other = pad(0, 'Different unknown adapter B', '', 11, 0), next = harness([other], h.storage);
    expect(next.devices()[0]).toMatchObject({saved: true, usable: false}); press(other, 0); next.scan(); expect(next.hub.inputs(false)[0].jump).toBe(false);
    next.hub.applySaved(next.devices()[0]!.key); press(other, 0, false); next.scan(); press(other, 0); next.scan(); expect(next.hub.inputs(false)[0].jump).toBe(true);
  });
  it('captures stick center/sign, ignores resting trigger axes and avoids duplicate bindings', () => {
    const p = pad(0, 'Raw pad', '', 17, 3), h = harness([p]); p.axes = [0.1, 0, -1]; h.scan();
    const key = h.devices()[0]!.key; h.hub.beginCalibration(key); h.hub.listen(key, 'axis-x'); p.axes[0] = 0.9; h.scan();
    expect(h.devices()[0]!.calibration!.mapping.axes.x).toEqual({index: 0, sign: 1, center: 0.1});
    p.axes[0] = 0.1; h.scan(); h.hub.listen(key, 'axis-y'); p.axes[2] = 1; h.scan(); expect(h.devices()[0]!.calibration!.listening).toBe('axis-y');
    p.axes[1] = -0.9; h.scan(); expect(h.devices()[0]!.calibration!.mapping.axes.y).toEqual({index: 1, sign: -1, center: 0});
    h.hub.listen(key, 'jump'); press(p, 0); h.scan(); press(p, 0, false); h.scan(); h.hub.listen(key, 'attack'); press(p, 0); h.scan();
    expect(h.devices()[0]!.calibration!.mapping.buttons.jump).toEqual([]); expect(h.devices()[0]!.calibration!.mapping.buttons.attack).toEqual([0]);
    expect(() => h.hub.saveCalibration(key)).toThrow('Bind');
  });
  it('does not capture an already-held button until it is released and pressed again', () => {
    const p = pad(0, 'raw', ''), h = harness([p]); press(p, 2); h.scan(); const key = h.devices()[0]!.key;
    h.hub.beginCalibration(key); h.hub.listen(key, 'jump'); h.scan(); expect(h.devices()[0]!.calibration!.listening).toBe('jump');
    press(p, 2, false); h.scan(); press(p, 2); h.scan(); expect(h.devices()[0]!.calibration!.mapping.buttons.jump).toEqual([2]);
  });
  it('keeps all gameplay neutral while disabled or calibrating, and waits for release on enable', () => {
    const p = pad(), h = harness([p]); h.hub.setEnabled(false); press(p, 3); h.scan(); expect(h.hub.inputs()[0].jump).toBe(false);
    h.hub.setEnabled(true); h.scan(); expect(h.hub.inputs()[0].jump).toBe(false);
    press(p, 3, false); h.scan(); press(p, 3); h.scan(); expect(h.hub.inputs()[0].jump).toBe(true);
    h.hub.beginCalibration(h.devices()[0]!.key); h.scan(); expect(h.hub.inputs()[0].jump).toBe(false);
  });
  it('reports unsupported, permission denial and recovery without disabling keyboard or inventing a connection', () => {
    const unsupported = new ControllerHub({}); unsupported.detect(); expect(unsupported.getSnapshot().status).toBe('unsupported');
    let denied = true; const p = pad(); const hub = new ControllerHub({getGamepads: () => { if (denied) throw Object.assign(new Error('private details'), {name: 'SecurityError'}); return [p]; }, secureContext: false});
    hub.detect(); expect(hub.getSnapshot()).toMatchObject({status: 'blocked', devices: [], secureContext: false}); expect(hub.getSnapshot().message).not.toContain('private details');
    denied = false; hub.detect(); expect(hub.getSnapshot().status).toBe('available');
  });
  it('bounds malformed storage and handles storage denial without losing session mappings', () => {
    for (const text of ['invalid json', 'x'.repeat(32769), JSON.stringify({version: 1, profiles: Array.from({length: 17})}), JSON.stringify({version: 3, profiles: []})]) {
      const hub = new ControllerHub({storage: memoryStorage(text)}); expect(hub.getSnapshot().storageNotice).not.toBe('');
    }
    const storage = {getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }};
    const p = pad(0, 'raw', '', 11, 0), h = harness([p], storage); calibrateDpad(h, p);
    expect(h.devices()[0]!.usable).toBe(true); expect(h.hub.getSnapshot().storageNotice).toContain('session');
  });
  it('supports legacy partial standard records safely, bounds devices and neutralizes nonfinite calibrated axes', () => {
    const partial = {connected: true, mapping: 'standard', buttons: pad().buttons, axes: [0, 0]} as unknown as PadRecord;
    const hub = new ControllerHub({getGamepads: () => [partial]}); hub.detect(); expect(hub.getSnapshot().devices[0]).toMatchObject({index: 0, name: 'Unnamed controller', usable: true, guessed: false}); // automapped, left stick only
    const many = new ControllerHub({getGamepads: () => Array.from({length: 40}, (_, i) => pad(i))}); many.detect(); expect(many.getSnapshot().devices).toHaveLength(16);
    const map = standardMapping(); map.axes.x!.center = 0.5; expect(mappedInput({...pad(), axes: [NaN, 0]}, map).x).toBe(0);
  });
  it('drops mappings with invalid array values and projects away unrelated stored properties', () => {
    const invalid = standardMapping(); invalid.buttons.attack = [Infinity];
    const storage = memoryStorage(JSON.stringify({version: 1, profiles: [{key: 'xbox:standard:17:4', mapping: invalid}]}));
    const h = harness([pad()], storage); expect(h.devices()[0]!.calibrated).toBe(false);
    const extended = standardMapping() as ReturnType<typeof standardMapping> & {unrelated?: string}; extended.unrelated = 'discard-root';
    Object.assign(extended.axes.x!, {privateNote: 'discard-axis'});
    const valid = harness([pad()], memoryStorage(JSON.stringify({version: 1, profiles: [{key: 'xbox:standard:17:4', mapping: extended}]})));
    expect(valid.devices()[0]!.mapping!.axes.x).toEqual({index: 0, sign: 1, center: 0});
    expect(valid.devices()[0]!.mapping).not.toHaveProperty('unrelated');
    const key = valid.devices()[0]!.key; valid.hub.beginCalibration(key); valid.hub.saveCalibration(key);
    expect(valid.storage.getItem()).not.toContain('discard-'); expect(valid.storage.getItem()).not.toContain('privateNote');
    expect(ACTIONS).toHaveLength(11);
  });
});

describe('one to eight LOCAL HUMAN controller ordinals', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8] as const)('supports %i local humans with a minimum-two neutral tuple', count => {
    const h = harness([]); h.hub.setLocalPlayerCount(count);
    expect(MAX_LOCAL_CONTROLLERS).toBe(8); expect(h.hub.getSnapshot().localPlayerCount).toBe(count);
    expect(h.hub.inputs()).toHaveLength(Math.max(2, count));
    expect(h.hub.inputs().every(input => input.x === 0 && !input.jump && !input.attack)).toBe(true);
  });
  it.each([0, 9, -1, 1.5, NaN, Infinity, -Infinity, '8', null])('rejects invalid runtime local capacity %s without changing assignments', count => {
    const h = harness([pad()]);
    expect(() => h.hub.setLocalPlayerCount(count as LocalControllerCount)).toThrow('between one and eight');
    expect(h.hub.getSnapshot().localPlayerCount).toBe(2); expect(h.devices()[0]!.slot).toBe(0);
  });
  it('autoassigns eight sparse browser records on expansion and samples every independent source', () => {
    const indices = [0, 3, 7, 11, 16, 25, 40, 63], pads = indices.map(index => pad(index));
    const records = Array.from({length: 64}, (_, index) => pads.find(p => p.index === index) ?? null);
    const hub = new ControllerHub({getGamepads: () => records}); hub.setLocalPlayerCount(1); hub.detect();
    expect(hub.getSnapshot().devices.map(device => device.slot)).toEqual([0, null, null, null, null, null, null, null]);
    hub.setLocalPlayerCount(8); hub.setEnabled(true); hub.scan();
    expect(hub.getSnapshot().devices.map(device => [device.index, device.slot])).toEqual(indices.map((index, slot) => [index, slot]));
    pads.forEach((p, slot) => { p.axes[0] = 0.2 + slot / 10; press(p, slot % 2 ? 3 : 0); }); hub.scan();
    const inputs = hub.inputs(false); expect(inputs).toHaveLength(8);
    inputs.forEach((input, slot) => { expect(input.x).toBeCloseTo(0.2 + slot / 10); expect(input.jump).toBe(slot % 2 === 1); expect(input.attack).toBe(slot % 2 === 0); });
    inputs[0].x = -1; expect(hub.inputs(false)[0].x).toBeCloseTo(0.2); expect(inputs[7]!.x).toBeCloseTo(0.9);
    hub.dispose();
  });
  it('preserves all eight reservations through 1→8→1→8 and gates held controls until neutral', () => {
    const pads = Array.from({length: 8}, (_, index) => pad(index)), h = harness(pads);
    h.hub.setLocalPlayerCount(1); h.hub.setLocalPlayerCount(8); h.scan();
    const assignments = h.devices().map(device => [device.key, device.slot]);
    press(pads[7]!, 3); h.scan(); expect(h.hub.inputs(false)[7]!.jump).toBe(true);
    h.hub.setLocalPlayerCount(1); h.scan(); expect(h.hub.inputs(false)).toHaveLength(2);
    h.hub.setLocalPlayerCount(8); h.scan(); expect(h.devices().map(device => [device.key, device.slot])).toEqual(assignments);
    expect(h.hub.inputs(false)[7]!.jump).toBe(false);
    press(pads[7]!, 3, false); h.scan(); press(pads[7]!, 3); h.scan(); expect(h.hub.inputs(false)[7]!.jump).toBe(true);
  });
  it('fills only available slots without overriding manual bindings, unassignment or disconnected reservations', () => {
    const pads = Array.from({length: 9}, (_, index) => pad(index)), h = harness(pads); h.hub.setLocalPlayerCount(8);
    const devices = h.devices(); h.hub.assign(devices[0]!.key, 7); h.hub.assign(devices[7]!.key, 0); h.hub.assign(devices[3]!.key, null);
    h.records(pads.map((p, index) => index === 1 ? null : p));
    h.hub.setLocalPlayerCount(1); h.hub.setLocalPlayerCount(8);
    expect(h.devices().map(device => device.slot)).toEqual([7, 1, 2, null, 4, 5, 6, 0, 3]);
    expect(h.devices()[1]!.connected).toBe(false);
    expect(() => h.hub.assign(devices[3]!.key, 8)).toThrow('unavailable');
    h.hub.forget(devices[1]!.key); expect(h.devices().find(device => device.key === devices[3]!.key)!.slot).toBeNull();
  });
  it('never shifts remaining humans when low/high-index controllers disconnect and safely restores both', () => {
    const pads = Array.from({length: 8}, (_, index) => pad(index * 4)), h = harness(pads); h.hub.setLocalPlayerCount(8); h.scan();
    press(pads[0]!, 3); press(pads[6]!, 0); press(pads[7]!, 3); h.scan();
    h.records(pads.map((p, slot) => slot === 0 || slot === 7 ? null : p));
    expect(h.hub.inputs(false)[0].jump).toBe(false); expect(h.hub.inputs(false)[6]!.attack).toBe(true); expect(h.hub.inputs(false)[7]!.jump).toBe(false);
    expect(h.devices().map(device => device.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    h.records(pads); expect(h.hub.inputs(false)[0].jump).toBe(false); expect(h.hub.inputs(false)[7]!.jump).toBe(false);
    [pads[0]!, pads[7]!].forEach(p => press(p, 3, false)); h.scan(); [pads[0]!, pads[7]!].forEach(p => press(p, 3)); h.scan();
    expect(h.hub.inputs(false)[0].jump).toBe(true); expect(h.hub.inputs(false)[7]!.jump).toBe(true);
  });
  it('ignores Menu9 on inactive reservations and avoids a false edge when expanding with Menu held', () => {
    const pads = Array.from({length: 8}, (_, index) => pad(index)), h = harness(pads); h.hub.setLocalPlayerCount(8); h.scan();
    let menus = 0; h.hub.onMenu = () => { menus++; }; h.hub.setLocalPlayerCount(1); h.hub.setEnabled(false);
    press(pads[7]!, 9); h.scan(); expect(menus).toBe(0);
    h.hub.setLocalPlayerCount(8); h.scan(); expect(menus).toBe(0);
    press(pads[7]!, 9, false); h.scan(); press(pads[7]!, 9); h.scan(); expect(menus).toBe(1);
    expect(h.hub.inputs(false).every(input => !input.jump && !input.attack && input.x === 0)).toBe(true);
    h.scan(); expect(menus).toBe(1);
  });
  it('keeps exhibition gameplay neutral while the menu-only source still opens options', () => {
    const p = pad(), h = harness([p]); h.hub.setLocalPlayerCount(1); h.hub.setEnabled(false);
    let menus = 0; h.hub.onMenu = () => { menus++; };
    press(p, 3); p.axes[0] = 1; press(p, 9); h.scan();
    expect(menus).toBe(1); expect(h.hub.inputs(false).every(input => !input.jump && input.x === 0)).toBe(true);
    h.hub.releaseInputs(); h.scan(); expect(menus).toBe(1);
  });
  it('automaps Wii/unknown standard controllers at higher human ordinals', () => {
    const pads = Array.from({length: 8}, (_, index) => pad(index)); pads[6]!.id = 'Wii U Pro Controller'; pads[7]!.id = 'Unidentified adapter';
    const h = harness(pads); h.hub.setLocalPlayerCount(8); h.scan();
    expect(h.devices()[6]!.usable).toBe(true); expect(h.devices()[7]!.usable).toBe(true);
    press(pads[6]!, 3); press(pads[7]!, 3); h.scan();
    expect(h.hub.inputs(false).slice(6).every(input => input.jump)).toBe(true);
  });
});
