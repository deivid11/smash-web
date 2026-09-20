import type { PlayerInput } from '../game/match.ts';

/** Browser records only. No Web Bluetooth/HID access, device identity storage or telemetry. */
export interface PadButton { readonly pressed: boolean; readonly value: number }
export interface PadRecord {
  readonly index: number; readonly id: string; readonly mapping: string; readonly connected: boolean;
  readonly buttons: readonly PadButton[]; readonly axes: readonly number[];
}
export type ControllerFamily = 'xbox' | 'playstation' | 'nintendo' | 'gamesir' | 'wii' | 'unknown';
export const ACTIONS = ['jump', 'attack', 'strong', 'special', 'shield', 'grab', 'walk', 'taunt', 'left', 'right', 'up', 'down'] as const;
export type ControllerAction = typeof ACTIONS[number];
export const ACTION_LABELS: Record<ControllerAction, string> = { jump: 'Jump', attack: 'Quick attack', strong: 'Strong attack', special: 'Special', shield: 'Shield / dodge', grab: 'Grab', walk: 'Walk modifier', taunt: 'Taunt', left: 'D-pad left', right: 'D-pad right', up: 'D-pad up', down: 'D-pad down' };
export interface AxisBinding { index: number; sign: 1 | -1; center: number }
export interface ControllerMapping {
  version: 1;
  /** Left-stick movement (`x`/`y`) plus the optional smash-stick (`cx`/`cy`,
   * null when the pad has no second stick: menus and Strong-button smashes
   * keep working, only C-stick flicks stay unbound). */
  axes: {x: AxisBinding | null; y: AxisBinding | null; cx: AxisBinding | null; cy: AxisBinding | null};
  buttons: Record<ControllerAction, number[]>;
  deadzone: number; threshold: number;
}
export interface ControllerProfile { family: ControllerFamily; name: string; standard: boolean; labels: readonly string[]; mapping: ControllerMapping | null }
const REQUIRED: readonly ControllerAction[] = ['jump', 'attack', 'strong', 'special', 'shield', 'grab'];
const STANDARD_LABELS = ['South', 'East', 'West', 'North', 'Left shoulder', 'Right shoulder', 'Left trigger', 'Right trigger', 'Select / view', 'Start / menu', 'Left stick click', 'Right stick click', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home'];
/** Smash layout by standard position: South (Xbox A / Cross) attacks, East (B /
 * Circle) is special, West + North (X / Y) jump, both bumpers grab, both
 * triggers shield, the right stick smashes, R3 is the spare Strong button and
 * Select / View taunts (the original's D-pad is movement here).
 * Nintendo pads label their positions differently (A east, B south), so
 * {@link standardMapping} swaps attack/special to keep "A attacks, B specials". */
const STANDARD_BUTTONS: Record<ControllerAction, number[]> = {jump: [2, 3], attack: [0], strong: [11], special: [1], shield: [6, 7], grab: [4, 5], walk: [], taunt: [8], left: [14], right: [15], up: [12], down: [13]};
export const emptyControllerInput = (): PlayerInput => ({x: 0, y: 0, jump: false, attack: false, strong: false, special: false, shield: false, grab: false, walk: false, taunt: false, down: false, cX: 0, cY: 0});
export function emptyMapping(): ControllerMapping {
  return {version: 1, axes: {x: null, y: null, cx: null, cy: null}, buttons: Object.fromEntries(ACTIONS.map(action => [action, [] as number[]])) as ControllerMapping['buttons'], deadzone: 0.18, threshold: 0.55};
}
export function standardMapping(family?: ControllerFamily): ControllerMapping {
  const buttons = structuredClone(STANDARD_BUTTONS);
  if (family === 'nintendo') { buttons.attack = [1]; buttons.special = [0]; }
  return {version: 1, axes: {x: {index: 0, sign: 1, center: 0}, y: {index: 1, sign: -1, center: 0}, cx: {index: 2, sign: 1, center: 0}, cy: {index: 3, sign: -1, center: 0}}, buttons, deadzone: 0.18, threshold: 0.55};
}
export function controllerProfile(pad: Pick<PadRecord, 'id' | 'mapping' | 'buttons' | 'axes'>): ControllerProfile {
  const id = pad.id.slice(0, 512).toLowerCase();
  // Wii/RVL before generic Nintendo: a vendor ID alone does NOT identify a Wii model.
  // GameSir first: an explicit brand wins over coincidental markers. GameSir pads
  // (G8, X2, T4 and kin) use the Xbox face/shoulder layout, including their
  // non-XInput modes that report generic codes under a GameSir ID.
  const family: ControllerFamily = /gamesir/.test(id) ? 'gamesir'
    : /\bwii\b|wiimote|wiiu|wii-u|rvl-cnt|rvl-cnt-01|classic controller/.test(id) ? 'wii'
    : /xbox|xinput|045e|microsoft.*(controller|gamepad)/.test(id) ? 'xbox'
    // Sony pads name themselves only "Wireless Controller" over Bluetooth (Android,
    // Linux, macOS); Xbox's "Xbox Wireless Controller" already matched above.
    : /playstation|dualshock|dualsense|054c|sony.*(controller|gamepad)|^wireless controller\b/.test(id) ? 'playstation'
    : /nintendo|057e|switch.*(pro|controller)|joy-con/.test(id) ? 'nintendo' : 'unknown';
  const standard = pad.mapping === 'standard';
  const labels = [...STANDARD_LABELS];
  if (standard && family === 'xbox') labels.splice(0, 12, 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View / Back', 'Menu / Start', 'LS click', 'RS click');
  if (standard && family === 'gamesir') labels.splice(0, 12, 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View / Back', 'Menu / Start', 'LS click', 'RS click');
  if (standard && family === 'playstation') labels.splice(0, 12, 'Cross ✕', 'Circle ○', 'Square □', 'Triangle △', 'L1', 'R1', 'L2', 'R2', 'Create / Share', 'Options', 'L3', 'R3');
  if (standard && family === 'nintendo') labels.splice(0, 12, 'B (south)', 'A (east)', 'Y (west)', 'X (north)', 'L', 'R', 'ZL', 'ZR', 'Minus −', 'Plus +', 'Left stick click', 'Right stick click');
  const name = {xbox: 'Xbox', playstation: 'PlayStation', nintendo: 'Nintendo', gamesir: 'GameSir', wii: 'Wii / Classic adapter', unknown: 'Unidentified controller'}[family];
  // Pads with fewer than four axes keep the left stick working and leave the
  // smash-stick unbound rather than losing the whole standard mapping.
  const full = standardMapping(family);
  if (pad.axes.length < 4) { full.axes.cx = null; full.axes.cy = null; }
  const mapping = standard && !mappingError(full, pad) ? full : null;
  // Raw indices have no portable face-button names, even when the ID names a familiar brand.
  return {family, name, standard, labels: standard ? labels : [], mapping};
}
/** Best-effort mapping for raw (non-standard) layouts, so every controller sends
 * input without setup. Most raw drivers (DirectInput, evdev, HID) list the four
 * face buttons first, then shoulders and triggers, with the left stick on axes
 * 0/1. Only indices the pad exposes are bound; the smash-stick and D-pad stay
 * unbound (trigger axes and hats differ per driver) and off-center resting axes
 * are never bound. Null when movement plus every required action cannot be
 * covered — calibration remains the fix, and the panel flags guesses. */
export function guessedMapping(pad: Pick<PadRecord, 'buttons' | 'axes'>): ControllerMapping | null {
  const count = pad.buttons.length;
  const resting = (index: number) => Number.isFinite(pad.axes[index]) && Math.abs(pad.axes[index]!) <= 0.5;
  if (count < 7 || pad.axes.length < 2 || !resting(0) || !resting(1)) return null;
  const mapping = emptyMapping();
  mapping.axes.x = {index: 0, sign: 1, center: 0}; mapping.axes.y = {index: 1, sign: -1, center: 0};
  // Same Smash order as the standard layout: attack 0, special 1, jump 2/3,
  // grab on the bumpers, shield on the triggers, Strong on R3 when it exists.
  mapping.buttons.attack = [0]; mapping.buttons.special = [1]; mapping.buttons.jump = [2, 3];
  mapping.buttons.grab = count >= 12 ? [4, 5] : [4]; mapping.buttons.strong = count >= 12 ? [11] : [5]; mapping.buttons.shield = count >= 8 ? [6, 7] : [6];
  return mappingError(mapping, pad) ? null : mapping;
}
export function buttonLabel(profile: ControllerProfile, index: number): string { return profile.labels[index] ? `${profile.labels[index]} · ${index}` : `Button ${index}`; }

/** Validate untrusted persisted or user-edited mappings before using any index.
 * Button/axis counts and profile count are bounded independently of browser data. */
export function mappingError(value: unknown, pad: Pick<PadRecord, 'buttons' | 'axes'>, complete = true): string | null {
  if (!value || typeof value !== 'object') return 'Missing controller mapping.';
  const map = value as Partial<ControllerMapping>;
  if (map.version !== 1 || !map.axes || typeof map.axes !== 'object' || !map.buttons || typeof map.buttons !== 'object') return 'Unsupported mapping schema.';
  if (!Number.isFinite(map.deadzone) || map.deadzone! < 0.05 || map.deadzone! > 0.4 || !Number.isFinite(map.threshold) || map.threshold! < 0.2 || map.threshold! > 0.95) return 'Invalid deadzone or button threshold.';
  // Missing smash-stick bindings (older saved profiles) mean "no C-stick",
  // never an error; present ones must be valid and use their own axes.
  const axes = {x: map.axes.x ?? null, y: map.axes.y ?? null, cx: (map.axes as Partial<Record<'cx' | 'cy', AxisBinding | null>>).cx ?? null, cy: (map.axes as Partial<Record<'cx' | 'cy', AxisBinding | null>>).cy ?? null};
  for (const axis of ['x', 'y', 'cx', 'cy'] as const) {
    const binding = axes[axis];
    if (binding !== null && (!binding || !Number.isInteger(binding.index) || binding.index < 0 || binding.index >= Math.min(32, pad.axes.length) || ![1, -1].includes(binding.sign) || !Number.isFinite(binding.center) || Math.abs(binding.center) > 0.75)) return `Invalid ${axis.toUpperCase()} axis binding.`;
  }
  if (map.axes.x && map.axes.y && map.axes.x.index === map.axes.y.index) return 'Horizontal and vertical movement must use different axes.';
  const sticks = [axes.x, axes.y, axes.cx, axes.cy].filter((binding): binding is AxisBinding => binding !== null);
  if (new Set(sticks.map(binding => binding.index)).size !== sticks.length) return 'Each stick direction must use a different axis.';
  const used = new Set<number>();
  for (const action of ACTIONS) {
    // A missing taunt array (profiles saved before the taunt binding existed) means
    // "unbound", exactly like the missing smash-stick axes above, never an error.
    const buttons = map.buttons[action] ?? (action === 'taunt' ? [] : undefined);
    if (!Array.isArray(buttons) || buttons.length > 2) return `Invalid ${ACTION_LABELS[action]} binding.`;
    for (const index of buttons) {
      if (!Number.isInteger(index) || index < 0 || index >= Math.min(64, pad.buttons.length)) return `Button index is unavailable for ${ACTION_LABELS[action]}.`;
      if (used.has(index)) return `Button ${index} is assigned more than once; rebind before saving.`;
      used.add(index);
    }
    if (complete && REQUIRED.includes(action) && !buttons.length) return `Bind ${ACTION_LABELS[action]} before saving.`;
  }
  if (complete && ((!map.axes.x && (!map.buttons.left?.length || !map.buttons.right?.length)) || (!map.axes.y && (!map.buttons.up?.length || !map.buttons.down?.length)))) return 'Bind both movement axes or all four D-pad directions.';
  return null;
}
export function cleanMapping(value: ControllerMapping): ControllerMapping {
  // Explicit schema projection: never retain unknown JSON keys/prototypes.
  const axis = (binding: AxisBinding | null | undefined): AxisBinding | null => binding ? {index: binding.index, sign: binding.sign, center: binding.center} : null;
  const axes = (value.axes ?? {}) as Partial<Record<'x' | 'y' | 'cx' | 'cy', AxisBinding | null>>;
  return {version: 1, axes: {x: axis(axes.x), y: axis(axes.y), cx: axis(axes.cx), cy: axis(axes.cy)},
    buttons: Object.fromEntries(ACTIONS.map(action => [action, [...(value.buttons[action] ?? [])]])) as ControllerMapping['buttons'], deadzone: value.deadzone, threshold: value.threshold};
}
export function pressed(button: PadButton | undefined, threshold = 0.55): boolean {
  return !!button && (button.pressed === true || (Number.isFinite(button.value) && button.value >= threshold));
}
function axisValue(axes: readonly number[], binding: AxisBinding | null, deadzone: number): number {
  if (!binding) return 0;
  const raw = axes[binding.index];
  if (!Number.isFinite(raw)) return 0;
  const delta = Math.max(-1, Math.min(1, raw!)) - binding.center;
  const scale = delta < 0 ? 1 + binding.center : 1 - binding.center;
  const value = Math.max(-1, Math.min(1, delta / scale * binding.sign));
  // Preserve the original stick amplitude outside the drift deadzone. Gameplay
  // thresholds/acceleration belong to the original-data simulation, not this adapter.
  return Math.abs(value) <= deadzone ? 0 : value;
}
export function mappedInput(pad: Pick<PadRecord, 'buttons' | 'axes'>, mapping: ControllerMapping): PlayerInput {
  const held = (action: ControllerAction) => mapping.buttons[action].some(index => pressed(pad.buttons[index], mapping.threshold));
  const digitalX = +held('right') - +held('left'), digitalY = +held('up') - +held('down');
  const x = digitalX || axisValue(pad.axes, mapping.axes.x, mapping.deadzone), y = digitalY || axisValue(pad.axes, mapping.axes.y, mapping.deadzone);
  const axes = (mapping.axes ?? {}) as Partial<Record<'cx' | 'cy', AxisBinding | null>>;
  return {x, y, down: y < -0.66, jump: held('jump'), attack: held('attack'), strong: held('strong'), special: held('special'), shield: held('shield'), grab: held('grab'), walk: held('walk'), taunt: held('taunt'),
    cX: axisValue(pad.axes, axes.cx ?? null, mapping.deadzone), cY: axisValue(pad.axes, axes.cy ?? null, mapping.deadzone)};
}
/** Capability/model-family key only: no raw device ID, serial number, address or user identity. */
export function mappingKey(pad: PadRecord): string {
  return `${controllerProfile(pad).family}:${pad.mapping === 'standard' ? 'standard' : 'raw'}:${Math.min(64, pad.buttons.length)}:${Math.min(32, pad.axes.length)}`;
}
