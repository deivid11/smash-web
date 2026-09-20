import { neutralInput } from '../../lib/game/match.ts';
import { ControllerHub, type LocalControllerCount, type LocalControllerInputs } from './input/controller-hub.ts';

import { KeyboardMapStore, type KeyLayout } from './input/keyboard-map.ts';

/** On-screen buttons of the first human (web/src/play/touch-controls.tsx), by action. */
const TOUCH_BUTTONS = { jump: 'touch:Space', attack: 'touch:KeyJ', strong: 'touch:KeyK', special: 'touch:KeyL', shield: 'touch:KeyU', grab: 'touch:KeyI' } as const;
export class PlayInput {
  private keys = new Set<string>();
  private latched = new Set<string>();
  private touch = new Map<string, Set<number>>();
  /** Touch analog stick for the first HUMAN ordinal (x right, y up, unit circle). */
  private stick = { x: 0, y: 0 };
  private abort = new AbortController();
  private unavailableReported = false;
  private active = false;
  get enabled(): boolean { return this.active; }
  set enabled(value: boolean) { if (value !== this.active) { this.active = value; this.clear(); this.controllers.setEnabled(value); } }
  walkMode = false;
  /** Legacy host metadata only. Local input length is controlled by setLocalPlayerCount. */
  playerCount = 2;
  onGamepadUnavailable: (() => void) | undefined;
  /** True while Options is capturing a key for a rebind: the game must not react to it. */
  rebinding = false;
  constructor(canvas: HTMLCanvasElement, readonly controllers = new ControllerHub(), readonly keyboard = new KeyboardMapStore()) {
    canvas.tabIndex = 0;
    window.addEventListener('keydown', (event) => {
      if (!this.enabled || this.rebinding || !this.keyboard.uses(event.code) || (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"]'))) return;
      event.preventDefault();
      if (!this.keys.has(event.code)) this.latched.add(event.code);
      this.keys.add(event.code);
    }, { signal: this.abort.signal });
    window.addEventListener('keyup', (event) => { this.keys.delete(event.code); if (this.enabled && this.keyboard.uses(event.code)) event.preventDefault(); }, { signal: this.abort.signal });
    window.addEventListener('blur', () => this.clear(), { signal: this.abort.signal });
    canvas.addEventListener('pointerdown', () => canvas.focus(), { signal: this.abort.signal });
  }
  /** Touch buttons keep their fixed names (the default player-one key codes plus the touch-only
   * ones) in their own namespace, so rebinding a keyboard key never changes or steals a button. */
  pressTouch(name: string, pointer: number): void {
    if (!this.enabled) return;
    const code = `touch:${name}`;
    const pointers = this.touch.get(code) ?? new Set<number>();
    if (pointers.size === 0) this.latched.add(code);
    pointers.add(pointer); this.touch.set(code, pointers);
  }
  releaseTouch(name: string, pointer: number): void { this.touch.get(`touch:${name}`)?.delete(pointer); }
  setStick(x: number, y: number): void { const clamp = (v: number) => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0)); this.stick = { x: clamp(x), y: clamp(y) }; }
  clear(): void { this.keys.clear(); this.latched.clear(); this.touch.clear(); this.stick = { x: 0, y: 0 }; this.controllers.releaseInputs(); }
  /** HUMAN control ordinals only; the host maps these around CPU/OFF fighter seats.
   * Online always passes one, independent of the room's total player count. */
  setLocalPlayerCount(count: LocalControllerCount): void {
    const previous = this.controllers.getSnapshot().localPlayerCount;
    this.controllers.setLocalPlayerCount(count);
    if (previous !== count) this.clear();
  }
  private has(...codes: string[]): boolean { return codes.some((code) => this.keys.has(code) || this.latched.has(code) || (this.touch.get(code)?.size ?? 0) > 0); }
  private layoutInput(keys: KeyLayout, touch: Partial<Record<keyof KeyLayout, string>> = {}): LocalControllerInputs[number] {
    const held = (action: keyof KeyLayout) => this.has(...keys[action], ...(touch[action] ? [touch[action]!] : []));
    return { x: +held('right') - +held('left'), y: +held('up') - +held('down'), jump: held('jump'), attack: held('attack'), strong: held('strong'),
      down: held('down'), walk: held('walk'), shield: held('shield'), grab: held('grab'), special: held('special'), taunt: held('taunt'), cX: 0, cY: 0 };
  }
  consumeLatches(): void { this.latched.clear(); this.controllers.consumeLatches(); }
  poll(consume = true): LocalControllerInputs {
    this.controllers.scan();
    const status = this.controllers.getSnapshot().status;
    if (['blocked', 'unsupported', 'error'].includes(status)) { if (!this.unavailableReported) { this.unavailableReported = true; this.onGamepadUnavailable?.(); } }
    else this.unavailableReported = false;
    const localCount = this.controllers.getSnapshot().localPlayerCount, count = Math.max(2, localCount);
    if (!this.enabled) return Array.from({ length: count }, neutralInput) as LocalControllerInputs;
    const map = this.keyboard.getSnapshot();
    const inputs: LocalControllerInputs = [
      // The touch HOP button reads only its press latch: jump is held for one simulation frame and
      // released during the jump squat, so the fighter short hops however long the thumb stays down.
      // Touch-only codes ride beside player one's keys: HOP is a one-frame jump latch (held for one
      // simulation frame and released during the jump squat, so the fighter short hops however
      // long the thumb stays down), and the four SPECIAL buttons press special with a direction.
      { ...this.layoutInput(map[0], TOUCH_BUTTONS), jump: this.has(...map[0].jump, TOUCH_BUTTONS.jump) || this.latched.has('touch:ShortHop'), walk: this.walkMode || this.has(...map[0].walk),
        special: this.has(...map[0].special, TOUCH_BUTTONS.special, 'touch:SpecialNeutral', 'touch:SpecialSide', 'touch:SpecialUp', 'touch:SpecialDown') },
      this.layoutInput(map[1]),
    ];
    // Keyboard/touch layouts belong to the first two HUMAN ordinals, never CPU/OFF seats.
    if (localCount === 1) inputs[1] = neutralInput();
    while (inputs.length < count) inputs.push(neutralInput());
    // The touch stick adds to the keyboard digital axes exactly like a gamepad stick.
    if (Math.abs(this.stick.x) > Math.abs(inputs[0].x)) inputs[0].x = this.stick.x;
    if (Math.abs(this.stick.y) > Math.abs(inputs[0].y ?? 0)) inputs[0].y = this.stick.y;
    if (this.stick.y < -0.5) inputs[0].down = true;
    if (this.has('touch:SpecialNeutral')) inputs[0].specialDirection = 'neutral';
    else if (this.has('touch:SpecialSide')) inputs[0].specialDirection = 'side';
    else if (this.has('touch:SpecialUp')) inputs[0].specialDirection = 'up';
    else if (this.has('touch:SpecialDown')) inputs[0].specialDirection = 'down';
    const pads = this.controllers.inputs(false);
    for (let slot = 0; slot < pads.length; slot++) {
      const pad = pads[slot]!, input = inputs[slot]!;
      if (Math.abs(pad.x) > Math.abs(input.x)) input.x = pad.x;
      if (Math.abs(pad.y ?? 0) > Math.abs(input.y ?? 0)) input.y = pad.y;
      input.jump ||= pad.jump; input.attack ||= pad.attack; input.strong ||= pad.strong; input.special ||= pad.special;
      input.down ||= pad.down; input.shield ||= pad.shield; input.grab ||= pad.grab; input.walk ||= pad.walk; input.taunt ||= pad.taunt;
      // The smash-stick merges by amplitude like the left stick: a flick in any
      // direction wins over neutral, and releasing it recenters without sticking.
      if (Math.abs(pad.cX ?? 0) > Math.abs(input.cX ?? 0)) input.cX = pad.cX;
      if (Math.abs(pad.cY ?? 0) > Math.abs(input.cY ?? 0)) input.cY = pad.cY;
    }
    if (consume) this.consumeLatches();
    return inputs;
  }
  dispose(): void { this.abort.abort(); this.clear(); this.controllers.dispose(); }
}
