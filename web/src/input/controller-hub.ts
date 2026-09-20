import type { PlayerInput } from '../../../lib/game/match.ts';
import { androidPads } from '../android-bridge.ts';
import { ACTIONS, ACTION_LABELS, buttonLabel, cleanMapping, controllerProfile, emptyControllerInput, emptyMapping, guessedMapping, mappedInput, mappingError, mappingKey, pressed,
  type ControllerAction, type ControllerMapping, type ControllerProfile, type PadRecord } from '../../../lib/input/gamepad-profiles.ts';

/** Local HUMAN control ordinals, not fighter seats or the remote room capacity. */
export const MAX_LOCAL_CONTROLLERS = 8;
export type LocalControllerCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type LocalControllerInputs = [PlayerInput, PlayerInput, ...PlayerInput[]];

const STORAGE_KEY = 'smash.controller-mappings.v1';
const LATCHED = ['jump', 'attack', 'strong', 'special', 'shield', 'grab', 'walk', 'taunt', 'down'] as const;
const MAX_DEVICES = 16;
interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface ControllerEnvironment {
  getGamepads?: () => readonly (PadRecord | null)[];
  /** Native Android shell pads (window.SmashPad). Absent on desktop/mobile browsers. */
  getAndroidPads?: () => readonly (PadRecord | null)[];
  storage?: StoragePort; secureContext?: boolean; platform?: string; now?: () => number;
}
export type CalibrationAxis = 'axis-x' | 'axis-y' | 'axis-cx' | 'axis-cy';
export interface CalibrationView { mapping: ControllerMapping; listening: ControllerAction | CalibrationAxis | null; message: string }
export interface ControllerDeviceView {
  key: string; index: number; name: string; profile: string; family: ControllerProfile['family']; standard: boolean;
  connected: boolean; slot: number | null; usable: boolean; armed: boolean; calibrated: boolean; saved: boolean;
  /** Raw layout auto-mapped by {@link guessedMapping}: works immediately, may need a remap. */
  guessed: boolean;
  buttons: {index: number; label: string; value: number; pressed: boolean}[]; axes: number[];
  mapping: ControllerMapping | null; calibration: CalibrationView | null;
}
export interface ControllerSnapshot {
  status: 'waiting' | 'available' | 'unsupported' | 'blocked' | 'error'; message: string;
  secureContext: boolean; platform: string; localPlayerCount: LocalControllerCount; storageNotice: string;
  devices: readonly ControllerDeviceView[];
}
export interface ControllerMenuState {
  /** True when at least one connected controller can drive menus (mapped or
   * standard-layout fallback; calibration still suppresses navigation). */
  connected: boolean;
  up: boolean; down: boolean; left: boolean; right: boolean;
  /** Attack (labelled A: Xbox A / Cross / Nintendo A): activate the focused menu control. */
  confirm: boolean;
  /** Special (labelled B: Xbox B / Circle / Nintendo B): go back. */
  back: boolean;
  /** Left / right shoulder (standard buttons 4/5): previous/next player seat
   * on character select. Raw indices only; never a gameplay binding. */
  prevSeat: boolean;
  nextSeat: boolean;
}
/** One controller's menu read for the Smash-style floating hands
 * (web/src/play/menu-hands.ts). Same sources as {@link ControllerMenuState},
 * kept per pad so every player moves their own cursor. Y axes grow up. */
export interface ControllerMenuPad {
  key: string; family: ControllerProfile['family'];
  /** Local human ordinal, or null for a pad without a gameplay seat. */
  slot: number | null;
  /** Analog left stick after the deadzone (0 while the D-pad is held). */
  x: number; y: number;
  /** D-pad as -1 / 0 / 1. */
  dpadX: number; dpadY: number;
  confirm: boolean; back: boolean;
  /** Face buttons by standard position (West = Xbox X, North = Xbox Y). */
  west: boolean; north: boolean;
  prevSeat: boolean; nextSeat: boolean;
  leftTrigger: boolean; rightTrigger: boolean;
  /** Start / Menu (standard 9) and Select / View (standard 8). */
  start: boolean; select: boolean;
  /** Right stick after the deadzone. */
  cX: number; cY: number;
}
interface Device {
  key: string; identity: string; index: number; pad: PadRecord; profile: ControllerProfile;
  connected: boolean; slot: number | null; manualAssignment: boolean; mapping: ControllerMapping | null; calibrated: boolean; guessed: boolean;
  armed: boolean; menuDown: boolean; input: PlayerInput; latches: Partial<Record<typeof LATCHED[number], boolean>>;
  calibration: (CalibrationView & {previousButtons: boolean[]; baseline: number[]}) | null;
}
function browserEnvironment(): ControllerEnvironment {
  let storage: StoragePort | undefined;
  try { storage = globalThis.localStorage; } catch { /* Storage may be denied independently of gamepads. */ }
  return {getGamepads: typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? () => navigator.getGamepads() : undefined,
    getAndroidPads: () => androidPads(),
    storage, secureContext: globalThis.isSecureContext === true,
    platform: typeof navigator !== 'undefined' ? navigator.platform : '', now: () => performance.now()};
}
const neutral = (input: PlayerInput) => Math.abs(input.x) < 0.01 && Math.abs(input.y ?? 0) < 0.01 && Math.abs(input.cX ?? 0) < 0.01 && Math.abs(input.cY ?? 0) < 0.01 && !LATCHED.some(key => input[key]);
const copyMapping = (mapping: ControllerMapping | null) => mapping ? cleanMapping(mapping) : null;

/** Polling and assignments are entirely local to the viewing browser. GamepadAPI
 * does not expose a persistent physical UUID or perform OS Bluetooth pairing.
 * Slots are reserved by browser index + session descriptor, never list order.
 * The host must scan every render tick, including menus; UI publishes at most
 * 10 Hz except explicit actions, connection changes and capability failures. */
export class ControllerHub {
  /** Local UI gesture only; never serialized into gameplay/network PlayerInput. */
  onMenu: (() => void) | undefined;
  private readonly environment: ControllerEnvironment;
  private readonly devices = new Map<string, Device>();
  private readonly saved = new Map<string, ControllerMapping>();
  private readonly listeners = new Set<() => void>();
  private nextKey = 1;
  private enabled = false;
  private localCount: LocalControllerCount = 2;
  private lastPublish = -Infinity;
  private lastSignature = '';
  private disposed = false;
  private status: ControllerSnapshot['status'];
  private message: string;
  private storageNotice = '';
  private snapshot: ControllerSnapshot;
  constructor(environment?: ControllerEnvironment) {
    this.environment = environment ?? browserEnvironment();
    this.status = this.environment.getGamepads ? 'waiting' : 'unsupported';
    this.message = this.environment.getGamepads ? 'Pair in your OS, then press a controller button and choose Connect / detect.' : 'Gamepad API is unavailable in this browser. Keyboard and touch still work.';
    this.loadSaved(); this.snapshot = this.buildSnapshot();
  }
  getSnapshot = (): ControllerSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  setLocalPlayerCount(count: LocalControllerCount): void {
    if (!Number.isInteger(count) || count < 1 || count > MAX_LOCAL_CONTROLLERS) throw new Error('Local human controller slots must be between one and eight.');
    if (count === this.localCount) return;
    this.localCount = count; this.autoAssign(); this.releaseInputs(); this.publish(true);
  }
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled; this.releaseInputs();
  }
  releaseInputs(): void {
    for (const device of this.devices.values()) { device.armed = false; device.input = emptyControllerInput(); device.latches = {}; }
  }
  /** A real user gesture can make the API expose pads. This NEVER pairs Bluetooth. */
  detect(): void {
    if (this.disposed) return;
    this.scan(this.now(), true);
    if (this.status === 'waiting') { this.message = 'No controller exposed yet. Pair in OS Bluetooth settings, wake it, then press a button while this tab is focused.'; this.publish(true); }
  }
  private now(): number { const value = this.environment.now?.() ?? 0; return Number.isFinite(value) ? value : 0; }
  scan(now = this.now(), force = false): void {
    if (this.disposed) return;
    if (!this.environment.getGamepads) { this.status = 'unsupported'; this.publish(force, now); return; }
    let pads: readonly (PadRecord | null)[];
    try {
      pads = this.environment.getGamepads(); if (!pads || !Number.isSafeInteger(pads.length) || pads.length > 64) throw new Error('Invalid gamepad list.');
      // Native Android shell pads (window.SmashPad): mobile browsers and WebViews
      // expose no Gamepad API, so phone-paired controllers arrive here instead.
      // Additive only — a failing bridge never breaks browser pads.
      try {
        const extra = this.environment.getAndroidPads?.();
        if (extra && Number.isSafeInteger(extra.length) && extra.length > 0 && extra.length <= 8) pads = [...pads, ...extra];
      } catch { /* bridge failure: browser pads still apply */ }
    }
    catch (error) {
      this.status = error && typeof error === 'object' && 'name' in error && error.name === 'SecurityError' ? 'blocked' : 'error';
      this.message = this.status === 'blocked' ? 'Browser policy denied Gamepad API access. Try a top-level HTTPS / localhost page; keyboard and touch remain available.' : 'The browser could not read controllers. Retry Connect / detect; keyboard and touch remain available.';
      for (const device of this.devices.values()) device.connected = false;
      this.releaseInputs(); this.publish(force || this.snapshot.status !== this.status, now); return;
    }
    let changed = false, menuRequested = false;
    const seen = new Set<string>(), seenIndices = new Set<number>();
    for (const [listIndex, source] of pads.entries()) {
      if (!source || source.connected !== true) continue;
      const index = source.index ?? listIndex;
      if (!Number.isInteger(index) || index < 0 || index >= 64 || seenIndices.has(index) || seenIndices.size >= MAX_DEVICES || !source.buttons || !source.axes || !Number.isSafeInteger(source.buttons.length) || source.buttons.length < 0 || !Number.isSafeInteger(source.axes.length) || source.axes.length < 0) continue;
      seenIndices.add(index);
      const pad: PadRecord = {index, id: typeof source.id === 'string' ? source.id.slice(0, 512) : '', mapping: source.mapping === 'standard' ? 'standard' : '', connected: true,
        buttons: Array.from({length: Math.min(64, source.buttons.length)}, (_, buttonIndex) => { const button = source.buttons[buttonIndex]; return {pressed: button?.pressed === true, value: Number.isFinite(button?.value) ? Math.max(0, Math.min(1, button!.value)) : 0}; }),
        axes: Array.from({length: Math.min(32, source.axes.length)}, (_, axisIndex) => { const axis = source.axes[axisIndex]; return Number.isFinite(axis) ? Math.max(-1, Math.min(1, axis!)) : NaN; })};
      const identity = `${pad.id}\n${pad.mapping}\n${pad.buttons.length}:${pad.axes.length}`;
      let device = [...this.devices.values()].find(candidate => candidate.index === pad.index && candidate.identity === identity);
      if (!device) {
        if (this.devices.size >= MAX_DEVICES) continue; // Explicit forget frees disconnected reservations.
        const profile = controllerProfile(pad), stored = this.saved.get(mappingKey(pad));
        // Every controller is automapped, whatever its brand: standard layouts use
        // the browser/OS standard mapping (a valid saved remap for the same
        // capability key wins), raw layouts get a flagged best-effort guess. Saved
        // raw profiles still need explicit confirmation (capability keys collide).
        // Older saved profiles predate the smash-stick: keep their buttons and fill
        // the missing right stick from the standard layout (additive only, the pad
        // must expose it) so upgrades gain C-stick smashes without recalibrating.
        let mapping = profile.standard ? stored && !mappingError(stored, pad) ? cleanMapping(stored) : profile.mapping : null;
        if (mapping && profile.mapping && !mapping.axes.cx && !mapping.axes.cy && profile.mapping.axes.cx && profile.mapping.axes.cy) {
          mapping = { ...mapping, axes: { ...mapping.axes, cx: { ...profile.mapping.axes.cx }, cy: { ...profile.mapping.axes.cy } } };
        }
        const guess = profile.standard ? null : guessedMapping(pad);
        if (guess) mapping = guess;
        const occupied = new Set([...this.devices.values()].map(candidate => candidate.slot));
        const slot = Array.from({length: this.localCount}, (_, index) => index).find(index => !occupied.has(index)) ?? null;
        device = {key: `controller-${this.nextKey++}`, identity, index: pad.index, pad, profile, connected: true, slot, manualAssignment: false, mapping, calibrated: !guess && !!mapping && !!stored, guessed: !!guess,
          armed: false, menuDown: pressed(pad.buttons[9]), input: emptyControllerInput(), latches: {}, calibration: null};
        this.devices.set(device.key, device); changed = true;
      } else if (!device.connected) { device.connected = true; device.armed = false; device.menuDown = pressed(pad.buttons[9]); device.latches = {}; device.calibration = null; changed = true; }
      device.pad = pad; seen.add(device.key);
      const menuDown = pressed(pad.buttons[9]);
      if (menuDown && !device.menuDown && device.profile.standard && device.mapping && device.slot !== null && device.slot < this.localCount && !device.calibration && !ACTIONS.some(action => device.mapping!.buttons[action].includes(9))) menuRequested = true;
      device.menuDown = menuDown; // Separate from gameplay release/enable latches.
      if (device.calibration) this.sampleCalibration(device);
      this.sampleInput(device);
    }
    for (const device of this.devices.values()) if (!seen.has(device.key) && device.connected) {
      device.connected = false; device.armed = false; device.input = emptyControllerInput(); device.latches = {}; device.calibration = null; changed = true;
    }
    const previous = this.status;
    this.status = seen.size ? 'available' : 'waiting';
    this.message = seen.size ? `${seen.size} controller${seen.size === 1 ? '' : 's'} exposed by this browser. Pairing and drivers are managed by your OS.` : 'No controller exposed yet. Press a controller button; use OS Bluetooth settings to pair first.';
    this.publish(force || changed || previous !== this.status, now);
    if (menuRequested) this.onMenu?.();
  }
  private sampleInput(device: Device): void {
    if (!this.enabled || !device.mapping || device.calibration || device.slot === null || device.slot >= this.localCount) { device.input = emptyControllerInput(); device.latches = {}; device.armed = false; return; }
    const input = mappedInput(device.pad, device.mapping);
    if (!device.armed) { device.armed = neutral(input); device.input = emptyControllerInput(); return; }
    for (const action of LATCHED) if (input[action] && !device.input[action]) device.latches[action] = true;
    device.input = input;
  }
  inputs(consume = true): LocalControllerInputs {
    const inputs = Array.from({length: Math.max(2, this.localCount)}, emptyControllerInput) as LocalControllerInputs;
    if (this.enabled) for (const device of this.devices.values()) if (device.connected && device.armed && device.mapping && !device.calibration && device.slot !== null && device.slot < this.localCount) {
      const input = {...device.input}; for (const key of LATCHED) if (device.latches[key]) input[key] = true;
      inputs[device.slot] = input;
    }
    if (consume) this.consumeLatches(); return inputs;
  }
  consumeLatches(): void { for (const device of this.devices.values()) device.latches = {}; }
  /** Menu navigation state from any connected controller, even while gameplay
   * input is disabled (menus, roguelike screens, options), and never consuming
   * gameplay latches. Slot assignment only gates gameplay: every connected pad
   * can drive the shared menus, so a second player can help navigate before
   * their seat exists. Mapped devices navigate through the active mapping;
   * standard-layout pads without a mapping yet (unknown brand, not yet
   * confirmed) fall back to raw standard indices for menus only — gameplay
   * still needs a confirmed or calibrated mapping. Calibration suppresses
   * navigation so Listen captures stay unambiguous. Confirm = Attack (the
   * labelled A button), Back = Special (labelled B); directions merge stick + D-pad. Bumpers (LB/RB)
   * switch the active player seat on character select. */
  menuState(): ControllerMenuState {
    const idle: ControllerMenuState = { connected: false, up: false, down: false, left: false, right: false, confirm: false, back: false, prevSeat: false, nextSeat: false };
    let seen = false;
    for (const device of this.devices.values()) {
      if (!device.connected || device.calibration) continue;
      // Bumpers are menu-only seat cycling on raw standard indices; gameplay
      // bindings (grab/strong defaults) never leak into menu state.
      if (pressed(device.pad.buttons[4])) idle.prevSeat = true;
      if (pressed(device.pad.buttons[5])) idle.nextSeat = true;
      if (device.mapping) {
        seen = true;
        let input;
        try { input = mappedInput(device.pad, device.mapping); } catch { continue; }
        // Stick amplitude uses the mapping deadzone; D-pad is already merged into x/y.
        // Threshold 0.5 keeps tilt-to-walk drift from nudging menus while full pushes move.
        if (input.x <= -0.5) idle.left = true;
        if (input.x >= 0.5) idle.right = true;
        if ((input.y ?? 0) >= 0.5) idle.up = true;
        if ((input.y ?? 0) <= -0.5) idle.down = true;
        if (input.down) idle.down = true;
        if (input.attack) idle.confirm = true;
        if (input.special) idle.back = true;
      } else if (device.profile.standard) {
        // Raw standard-layout fallback: trustworthy indices (stick 0/1, faces
        // 0/1, D-pad 12-15) per the Gamepad API standard mapping. Y grows down
        // on the wire, so pushing up reads negative — matching the mapped path.
        seen = true;
        const axis = (index: number): number => { const value = device.pad.axes[index]; return Number.isFinite(value) ? value! : 0; };
        if (axis(0) <= -0.5 || pressed(device.pad.buttons[14])) idle.left = true;
        if (axis(0) >= 0.5 || pressed(device.pad.buttons[15])) idle.right = true;
        if (axis(1) <= -0.5 || pressed(device.pad.buttons[12])) idle.up = true;
        if (axis(1) >= 0.5 || pressed(device.pad.buttons[13])) idle.down = true;
        if (pressed(device.pad.buttons[0])) idle.confirm = true;
        if (pressed(device.pad.buttons[1])) idle.back = true;
      }
    }
    idle.connected = seen;
    return idle;
  }
  /** Per-pad menu reads for the floating hands; never consumes gameplay latches.
   * Calibrating or disconnected pads are skipped, like {@link menuState}. */
  menuPads(): ControllerMenuPad[] {
    const pads: ControllerMenuPad[] = [];
    for (const device of this.devices.values()) {
      if (!device.connected || device.calibration || (!device.mapping && !device.profile.standard)) continue;
      const raw = device.pad;
      const button = (index: number) => pressed(raw.buttons[index]);
      const axis = (index: number, sign = 1) => { const value = raw.axes[index]; return Number.isFinite(value) && Math.abs(value!) > 0.2 ? value! * sign : 0; };
      const slot = device.slot !== null && device.slot < this.localCount ? device.slot : null;
      const shared = { key: device.key, family: device.profile.family, slot, west: button(2), north: button(3), prevSeat: button(4), nextSeat: button(5), leftTrigger: button(6), rightTrigger: button(7), start: button(9), select: button(8) };
      if (device.mapping) {
        let input;
        try { input = mappedInput(raw, device.mapping); } catch { continue; }
        const held = (action: ControllerAction) => device.mapping!.buttons[action].some(index => button(index));
        const dpadX = +held('right') - +held('left'), dpadY = +held('up') - +held('down');
        pads.push({ ...shared, x: dpadX ? 0 : input.x, y: dpadY ? 0 : input.y ?? 0, dpadX, dpadY, confirm: !!input.attack, back: !!input.special, cX: input.cX ?? 0, cY: input.cY ?? 0 });
      } else {
        // Standard layout without a usable mapping: trustworthy standard indices only.
        const dpadX = +button(15) - +button(14), dpadY = +button(12) - +button(13);
        pads.push({ ...shared, x: dpadX ? 0 : axis(0), y: dpadY ? 0 : axis(1, -1), dpadX, dpadY, confirm: button(0), back: button(1), cX: axis(2), cY: axis(3, -1) });
      }
    }
    return pads;
  }
  private device(key: string): Device { const device = this.devices.get(key); if (!device) throw new Error('Controller no longer exists. Detect it again.'); return device; }
  private autoAssign(): void {
    const occupied = new Set([...this.devices.values()].map(device => device.slot));
    for (const device of this.devices.values()) if (device.connected && device.slot === null && !device.manualAssignment) {
      const slot = Array.from({length: this.localCount}, (_, index) => index).find(index => !occupied.has(index));
      if (slot !== undefined) { device.slot = slot; occupied.add(slot); device.armed = false; device.input = emptyControllerInput(); device.latches = {}; }
    }
  }
  assign(key: string, slot: number | null): void {
    const device = this.device(key);
    if (slot !== null && (!device.connected || !Number.isInteger(slot) || slot < 0 || slot >= this.localCount)) throw new Error('That local player slot is unavailable.');
    if (slot !== null) for (const other of this.devices.values()) if (other !== device && other.slot === slot) { other.slot = null; other.manualAssignment = true; other.armed = false; other.input = emptyControllerInput(); other.latches = {}; }
    device.slot = slot; device.manualAssignment = true; device.armed = false; device.input = emptyControllerInput(); device.latches = {}; this.publish(true);
  }
  forget(key: string): void {
    const device = this.device(key); if (device.connected) throw new Error('Disconnect first, or choose Unassigned.');
    this.devices.delete(key); this.autoAssign(); this.publish(true);
  }
  confirmStandard(key: string): void {
    const device = this.device(key); if (!device.profile.mapping) throw new Error('This device does not expose a valid browser-standard layout. Calibrate the raw indices.');
    device.mapping = cleanMapping(device.profile.mapping); device.calibrated = false; device.guessed = false; device.calibration = null; this.releaseInputs(); this.publish(true);
  }
  applySaved(key: string): void {
    const device = this.device(key), mapping = this.saved.get(mappingKey(device.pad));
    const error = mappingError(mapping, device.pad); if (error || !mapping) throw new Error(error ?? 'No saved mapping.');
    device.mapping = cleanMapping(mapping); device.calibrated = true; device.guessed = false; device.calibration = null; this.releaseInputs(); this.publish(true);
  }
  beginCalibration(key: string): void {
    const device = this.device(key); if (!device.connected) throw new Error('Reconnect the controller before calibration.');
    device.calibration = {mapping: copyMapping(device.mapping) ?? emptyMapping(), listening: null, message: 'Bind movement and every required action. Raw buttons are numbered, not guessed.', previousButtons: [], baseline: []};
    this.releaseInputs(); this.publish(true);
  }
  cancelCalibration(key: string): void { this.device(key).calibration = null; this.releaseInputs(); this.publish(true); }
  private calibration(key: string): NonNullable<Device['calibration']> { const calibration = this.device(key).calibration; if (!calibration) throw new Error('Start calibration first.'); return calibration; }
  listen(key: string, action: ControllerAction | CalibrationAxis): void {
    if (!ACTIONS.includes(action as ControllerAction) && action !== 'axis-x' && action !== 'axis-y' && action !== 'axis-cx' && action !== 'axis-cy') throw new Error('Unknown calibration action.');
    const device = this.device(key), calibration = this.calibration(key);
    calibration.listening = action; calibration.previousButtons = device.pad.buttons.map(button => pressed(button)); calibration.baseline = [...device.pad.axes];
    calibration.message = action === 'axis-x' ? 'Center the stick before Listen, then move it RIGHT only.' : action === 'axis-y' ? 'Center the stick before Listen, then move it UP only.' : action === 'axis-cx' ? 'Center the RIGHT stick before Listen, then move it RIGHT only.' : action === 'axis-cy' ? 'Center the RIGHT stick before Listen, then move it UP only.' : `Release buttons, then press one button for ${ACTION_LABELS[action]}.`;
    this.publish(true);
  }
  clearBinding(key: string, action: ControllerAction | CalibrationAxis): void {
    const calibration = this.calibration(key);
    if (action === 'axis-x') calibration.mapping.axes.x = null;
    else if (action === 'axis-y') calibration.mapping.axes.y = null;
    else if (action === 'axis-cx') calibration.mapping.axes.cx = null;
    else if (action === 'axis-cy') calibration.mapping.axes.cy = null;
    else if (ACTIONS.includes(action)) calibration.mapping.buttons[action] = [];
    calibration.listening = null; this.publish(true);
  }
  setDeadzone(key: string, value: number): void {
    if (!Number.isFinite(value) || value < 0.05 || value > 0.4) throw new Error('Deadzone must be between 5% and 40%.');
    this.calibration(key).mapping.deadzone = value; this.publish(true);
  }
  private sampleCalibration(device: Device): void {
    const calibration = device.calibration!;
    if (!calibration.listening) return;
    const action = calibration.listening;
    if (action === 'axis-x' || action === 'axis-y' || action === 'axis-cx' || action === 'axis-cy') {
      const candidates = device.pad.axes.map((value, index) => ({value, index, delta: value - (calibration.baseline[index] ?? 0)}))
        .filter(candidate => Math.abs(calibration.baseline[candidate.index] ?? 0) <= 0.75 && Math.abs(candidate.delta) >= 0.55)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const best = candidates[0];
      if (!best || (candidates[1] && Math.abs(best.delta) - Math.abs(candidates[1].delta) < 0.15)) return;
      const target = action === 'axis-x' ? 'x' : action === 'axis-y' ? 'y' : action === 'axis-cx' ? 'cx' : 'cy';
      const right = target === 'cx' || target === 'cy';
      calibration.mapping.axes[target] = {index: best.index, sign: best.delta > 0 ? 1 : -1, center: calibration.baseline[best.index] ?? 0};
      calibration.message = `Captured ${right ? 'right-stick ' : ''}axis ${best.index}. Release to center before binding the other direction.`;
    } else {
      const current = device.pad.buttons.map(button => pressed(button));
      const candidates = current.flatMap((down, index) => down && !calibration.previousButtons[index] ? [index] : []);
      calibration.previousButtons = current;
      if (candidates.length !== 1) return;
      const index = candidates[0]!;
      // A deliberate new binding moves that button, rather than silently firing two actions.
      for (const other of ACTIONS) calibration.mapping.buttons[other] = calibration.mapping.buttons[other].filter(button => button !== index);
      calibration.mapping.buttons[action] = [index];
      calibration.message = `Button ${index} → ${ACTION_LABELS[action]}. Any prior binding for that button was removed.`;
    }
    calibration.listening = null;
  }
  saveCalibration(key: string): void {
    const device = this.device(key), calibration = this.calibration(key), error = mappingError(calibration.mapping, device.pad);
    if (error) throw new Error(error);
    device.mapping = cleanMapping(calibration.mapping); device.calibrated = true; device.guessed = false; device.calibration = null;
    const cacheKey = mappingKey(device.pad); this.saved.delete(cacheKey); this.saved.set(cacheKey, cleanMapping(device.mapping));
    while (this.saved.size > 16) this.saved.delete(this.saved.keys().next().value!);
    this.persist(); this.releaseInputs(); this.publish(true);
  }
  resetMapping(key: string): void {
    const device = this.device(key); this.saved.delete(mappingKey(device.pad)); this.persist();
    const guess = device.profile.standard ? null : guessedMapping(device.pad);
    device.mapping = device.profile.standard ? copyMapping(device.profile.mapping) : guess;
    device.guessed = !!guess; device.calibrated = false; device.calibration = null; this.releaseInputs(); this.publish(true);
  }
  private loadSaved(): void {
    try {
      const text = this.environment.storage?.getItem(STORAGE_KEY); if (!text) return;
      if (text.length > 32768) throw new Error('Oversize mapping storage.');
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('profiles' in data) || !Array.isArray(data.profiles) || data.profiles.length > 16) throw new Error('Invalid mapping storage.');
      for (const entry of data.profiles) {
        if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || !/^(xbox|playstation|nintendo|gamesir|wii|unknown):(standard|raw):([0-9]{1,2}):([0-9]{1,2})$/.test(entry.key)) continue;
        const parts = entry.key.split(':'), buttons = Number(parts[2]), axes = Number(parts[3]);
        if (buttons > 64 || axes > 32 || mappingError(entry.mapping, {buttons: Array.from({length: buttons}, () => ({pressed: false, value: 0})), axes: Array.from({length: axes}, () => 0)})) continue;
        this.saved.set(entry.key, cleanMapping(entry.mapping));
      }
    } catch { this.storageNotice = 'Saved mappings were unavailable or invalid. Calibrate again; keyboard and touch still work.'; }
  }
  private persist(): void {
    try {
      if (!this.environment.storage) throw new Error('No storage.');
      this.environment.storage.setItem(STORAGE_KEY, JSON.stringify({version: 1, profiles: [...this.saved].map(([key, mapping]) => ({key, mapping}))})); this.storageNotice = '';
    } catch { this.storageNotice = 'Mapping works for this session, but browser storage is unavailable.'; }
  }
  private buildSnapshot(): ControllerSnapshot {
    return {status: this.status, message: this.message, secureContext: this.environment.secureContext === true, platform: this.environment.platform ?? '', localPlayerCount: this.localCount, storageNotice: this.storageNotice,
      devices: [...this.devices.values()].map(device => ({key: device.key, index: device.index, name: device.pad.id.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160) || 'Unnamed controller', profile: device.profile.name, family: device.profile.family, standard: device.profile.standard,
        connected: device.connected, slot: device.slot, usable: !!device.mapping && device.connected, armed: device.armed, calibrated: device.calibrated, saved: this.saved.has(mappingKey(device.pad)), guessed: device.guessed && !!device.mapping,
        buttons: device.connected ? device.pad.buttons.map((button, index) => ({index, label: buttonLabel(device.profile, index), value: Math.round(button.value * 100) / 100, pressed: pressed(button)})) : [],
        axes: device.connected ? device.pad.axes.map(axis => Number.isFinite(axis) ? Math.round(axis * 50) / 50 : 0) : [], mapping: copyMapping(device.mapping),
        calibration: device.calibration ? {mapping: cleanMapping(device.calibration.mapping), listening: device.calibration.listening, message: device.calibration.message} : null}))};
  }
  private publish(force: boolean, now = this.now()): void {
    if (!force && now - this.lastPublish < 100) return;
    const snapshot = this.buildSnapshot(), signature = JSON.stringify(snapshot);
    this.lastPublish = now;
    if (signature === this.lastSignature) return;
    this.snapshot = snapshot; this.lastSignature = signature;
    for (const listener of this.listeners) listener();
  }
  dispose(): void { this.disposed = true; this.releaseInputs(); this.devices.clear(); this.listeners.clear(); this.onMenu = undefined; }
}
