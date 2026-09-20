/** Rebindable keyboard layouts for the first two local humans. Purely a local input concern:
 * the simulation, rollback and the online relay only ever see the resulting PlayerInput. */

export const KEY_ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'strong', 'special', 'shield', 'grab', 'walk', 'taunt'] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];
/** One layout: every action owns a list of physical key codes (KeyboardEvent.code). */
export type KeyLayout = Record<KeyAction, string[]>;
export type KeyboardMap = readonly [KeyLayout, KeyLayout];

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  left: 'Move left', right: 'Move right', up: 'Aim up', down: 'Crouch / drop / fast-fall', jump: 'Jump',
  attack: 'Quick attack (A)', strong: 'Smash attack', special: 'Special (B)', shield: 'Shield / air dodge', grab: 'Grab', walk: 'Walk (hold)', taunt: 'Taunt (standing)',
};

export const DEFAULT_KEYBOARD_MAP: KeyboardMap = [
  { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], jump: ['Space'], attack: ['KeyJ'], strong: ['KeyK'], special: ['KeyL'], shield: ['KeyU'], grab: ['KeyI'], walk: ['ShiftLeft'], taunt: ['KeyT'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], jump: ['Enter', 'Numpad0'], attack: ['KeyN', 'Numpad1'], strong: ['KeyM', 'Numpad2'], special: ['Comma'], shield: ['ShiftRight'], grab: ['Period'], walk: ['Slash'], taunt: ['KeyB', 'Numpad3'] },
];

/** Keys the game or the browser needs for itself; they can never be bound. */
const RESERVED = new Set(['Escape', 'Tab', 'MetaLeft', 'MetaRight', 'ContextMenu', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'PrintScreen', 'Unidentified', '']);
export const bindable = (code: string): boolean => typeof code === 'string' && code.length <= 24 && /^[A-Za-z0-9]+$/u.test(code) && !RESERVED.has(code);

const STORAGE_KEY = 'smash-keyboard-map';
const cloneLayout = (layout: KeyLayout): KeyLayout => Object.fromEntries(KEY_ACTIONS.map((action) => [action, [...layout[action]]])) as KeyLayout;
const cloneMap = (map: KeyboardMap): KeyboardMap => [cloneLayout(map[0]), cloneLayout(map[1])];

/** Stored maps are untrusted text: unknown actions, bad codes and duplicates are dropped. */
export function parseKeyboardMap(value: unknown): KeyboardMap | null {
  if (!value || typeof value !== 'object' || (value as { v?: unknown }).v !== 1) return null;
  const players = (value as { players?: unknown }).players;
  if (!Array.isArray(players) || players.length !== 2) return null;
  const seen = new Set<string>();
  const layouts = players.map((entry, player) => {
    const layout = {} as KeyLayout;
    for (const action of KEY_ACTIONS) {
      // An action the stored map never heard of (taunt, in maps saved before it existed)
      // keeps its default keys, minus any the player has since bound elsewhere.
      const codes = Array.isArray((entry as Record<string, unknown> | null)?.[action]) ? (entry as Record<string, unknown[]>)[action]!
        : [...(DEFAULT_KEYBOARD_MAP[player as 0 | 1]?.[action] ?? [])];
      layout[action] = codes.filter((code): code is string => typeof code === 'string' && bindable(code) && !seen.has(code) && !!seen.add(code)).slice(0, 3);
    }
    return layout;
  });
  return [layouts[0]!, layouts[1]!];
}

export function keyboardMapsEqual(a: KeyboardMap, b: KeyboardMap): boolean {
  return [0, 1].every((player) => KEY_ACTIONS.every((action) => a[player as 0 | 1][action].join() === b[player as 0 | 1][action].join()));
}

/** Binds one key to one action, replacing that action's keys. A key is unique across both
 * layouts, so it is taken away from whatever action owned it before. */
export function bindKey(map: KeyboardMap, player: 0 | 1, action: KeyAction, code: string): KeyboardMap {
  if (!bindable(code)) return map;
  const next = cloneMap(map);
  for (const layout of next) for (const other of KEY_ACTIONS) layout[other] = layout[other].filter((bound) => bound !== code);
  next[player][action] = [code];
  return next;
}

const NAMES: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backquote: '`', Backspace: 'Backspace', CapsLock: 'Caps Lock', NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
};
/** Short printable name of a physical key (layout-independent, like the codes themselves). */
export function keyLabel(code: string): string {
  if (NAMES[code]) return NAMES[code]!;
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3);
  if (/^Digit\d$/u.test(code)) return code.slice(5);
  if (/^Numpad\d$/u.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** Shared, persisted map: PlayInput reads it every poll, the Options panel edits it. */
export class KeyboardMapStore {
  private map: KeyboardMap;
  private codes = new Set<string>();
  private listeners = new Set<() => void>();
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })()) {
    let stored: KeyboardMap | null = null;
    try { const text = this.storage?.getItem(STORAGE_KEY); if (text) stored = parseKeyboardMap(JSON.parse(text)); } catch { /* unreadable: defaults */ }
    this.map = stored ?? cloneMap(DEFAULT_KEYBOARD_MAP);
    this.index();
  }
  private index(): void { this.codes = new Set(this.map.flatMap((layout) => KEY_ACTIONS.flatMap((action) => layout[action]))); }
  getSnapshot = (): KeyboardMap => this.map;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  /** True for every key currently bound to something (PlayInput swallows only these). */
  uses(code: string): boolean { return this.codes.has(code); }
  get customized(): boolean { return !keyboardMapsEqual(this.map, DEFAULT_KEYBOARD_MAP); }
  private commit(map: KeyboardMap): void {
    this.map = map; this.index();
    try {
      if (this.customized) this.storage?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, players: map }));
      else this.storage?.removeItem(STORAGE_KEY);
    } catch { /* private mode: session-only */ }
    for (const listener of this.listeners) listener();
  }
  bind(player: 0 | 1, action: KeyAction, code: string): boolean {
    if (!bindable(code)) return false;
    this.commit(bindKey(this.map, player, action, code));
    return true;
  }
  reset(): void { this.commit(cloneMap(DEFAULT_KEYBOARD_MAP)); }
}
