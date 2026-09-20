/** Gamepad menu navigation: full-game controller support for menus and roguelike UI.
 *
 * Gameplay input already flows through `ControllerHub` in
 * `web/src/input/controller-hub.ts` into `GameSession` in
 * `web/src/play/game-session.ts`. That path is disabled in menus, so menus were
 * mouse/touch/keyboard only. This module adds a DOM focus navigator driven by
 * `ControllerHub.menuState()` (any connected controller, mapped or
 * standard-layout fallback):
 *
 * - D-pad / left stick: move focus spatially (grids keep rows/columns).
 * - A (Attack: Xbox A / Cross / Nintendo A): activate the focused control.
 * - B (Special: Xbox B / Circle / Nintendo B): go back (dialog close, BACK, MODES).
 * - Character and stage select use the floating hands instead (see handSurface).
 * - LB / RB: switch the active player seat on character select.
 * - Left/right on a focused `<select>` or range cycles the value instead of
 *   moving focus; up/down still moves focus.
 * - Start / Menu (button 9) goes through `onMenu`: pause in a local match,
 *   READY TO FIGHT on character/stage select, options elsewhere.
 * - Paused match: right stick orbits the pause camera, RT / LT zoom, and
 *   L+R+A+Start quits to character select.
 *
 * Cosmetic only: this moves DOM focus and clicks buttons. It never mutates
 * simulation state directly; React callbacks own all match/roguelike changes.
 * Calibration suppresses navigation so Listen captures stay unambiguous.
 */
import { useEffect, type RefObject } from 'react';
import type { GameSession } from './game-session.ts';

export type MenuDirection = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function visible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden) return false;
  if (element.closest('[hidden]')) return false;
  // Closed <dialog> content has no layout boxes; open ones do.
  const dialog = element.closest('dialog');
  if (dialog instanceof HTMLDialogElement && !dialog.open) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return element.getClientRects().length > 0;
}

export function listFocusable(root: ParentNode): HTMLElement[] {
  const nodes = [...root.querySelectorAll(FOCUSABLE_SELECTOR)] as HTMLElement[];
  return nodes.filter((element) => {
    if (element instanceof HTMLButtonElement && element.disabled) return false;
    if (element instanceof HTMLInputElement && element.disabled) return false;
    if (element instanceof HTMLSelectElement && element.disabled) return false;
    if (element.tabIndex < 0 && !/^(BUTTON|A|INPUT|SELECT|SUMMARY)$/.test(element.tagName)) return false;
    // Gameplay surface and touch controls are never menu focus targets.
    if (element.closest('#play-canvas, .canvas-host, .touch-layer')) return false;
    if (element.id === 'play-canvas') return false;
    return visible(element);
  });
}

/** Topmost menu scope: modal dialog > item switch > rogue overlay > menu layer
 * (character/stage/online/mode) > arena chrome (paused/ended + consumables).
 * Never the whole app: that would include the gameplay canvas behind menus. */
export function scopeRoot(root: HTMLElement): ParentNode {
  const dialog = root.querySelector('.options-dialog[open]');
  if (dialog) return dialog;
  const itemSwitch = root.querySelector('.item-switch-backdrop');
  if (itemSwitch && visible(itemSwitch as HTMLElement)) return itemSwitch;
  const rogue = root.querySelector('.rogue-overlay');
  if (rogue && visible(rogue as HTMLElement)) return rogue;
  const menuLayer = root.querySelector('.menu-layer');
  if (menuLayer && visible(menuLayer as HTMLElement)) return menuLayer;
  const chrome = root.querySelector('.arena-chrome');
  if (chrome && visible(chrome as HTMLElement)) return chrome;
  return root;
}

/** Character and stage select belong to the Smash-style floating hands
 * (web/src/play/menu-hands.ts) unless a dialog or the item switch is on top.
 * Focus navigation stands down there so a press never acts twice. */
export function handSurface(root: HTMLElement): HTMLElement | null {
  if (root.querySelector('.options-dialog[open]')) return null;
  const itemSwitch = root.querySelector('.item-switch-backdrop');
  if (itemSwitch && visible(itemSwitch)) return null;
  const surface = root.querySelector<HTMLElement>('.menu-layer .battle-select, .menu-layer .stage-select');
  // Rift Descent embeds the fighter grid in its own long setup form: focus navigation keeps it.
  return surface && visible(surface) && !surface.closest('.rogue-setup, .rogue-overlay') ? surface : null;
}

type FocusCandidate = Pick<Element, 'closest' | 'getAttribute'>;
/** Where the controller cursor lands when nothing in the scope is focused yet:
 * an explicit `data-pad-default` action (FIGHT, ENTER, RETRY…), the Rift hub's
 * highlighted entry (BEGIN / CONTINUE), then the selected or first control of a
 * Rift screen body (cards, options, tiles), then anything but the header settings
 * icons (Controllers / Options / fullscreen). */
export function preferredFocus<T extends FocusCandidate>(candidates: readonly T[]): T | null {
  return candidates.find((element) => element.getAttribute('data-pad-default') !== null)
    ?? candidates.find((element) => (element.closest('.rogue-nav.primary') as unknown) === element)
    ?? candidates.find((element) => element.closest('.rogue-screen-body') && element.getAttribute('aria-pressed') === 'true')
    ?? candidates.find((element) => element.closest('.rogue-screen-body'))
    ?? candidates.find((element) => !element.closest('.system-menu'))
    ?? candidates[0]
    ?? null;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectOf(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height };
}

/** Spatial pick: closest candidate strictly in `direction`, orthogonal distance
 * penalized so grid rows/columns feel stable. Falls back to null (stay). */
export function findNextFocus(current: HTMLElement, candidates: readonly HTMLElement[], direction: MenuDirection): HTMLElement | null {
  const origin = rectOf(current);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    if (candidate === current) continue;
    const target = rectOf(candidate);
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    let primary = 0;
    let orthogonal = 0;
    if (direction === 'up' && dy >= -4) continue;
    if (direction === 'down' && dy <= 4) continue;
    if (direction === 'left' && dx >= -4) continue;
    if (direction === 'right' && dx <= 4) continue;
    if (direction === 'up' || direction === 'down') {
      primary = Math.abs(dy);
      orthogonal = Math.abs(dx);
    } else {
      primary = Math.abs(dx);
      orthogonal = Math.abs(dy);
    }
    // Heavy orthogonal penalty keeps grid navigation on its row/column; the header
    // settings icons are only reached when no screen control lies that way.
    const score = primary + orthogonal * 2.2 + (typeof candidate.closest === 'function' && candidate.closest('.system-menu') ? 4000 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function moveFocus(root: HTMLElement, direction: MenuDirection): boolean {
  const scope = scopeRoot(root);
  const candidates = listFocusable(scope);
  if (candidates.length === 0) return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!active || !candidates.includes(active)) {
    const home = preferredFocus(candidates)!;
    home.focus({ preventScroll: false });
    home.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }
  // Selects and ranges keep left/right for value changes; up/down still moves.
  if ((active instanceof HTMLSelectElement || (active instanceof HTMLInputElement && active.type === 'range')) && (direction === 'left' || direction === 'right')) {
    return false;
  }
  const next = findNextFocus(active, candidates, direction);
  if (!next) return false;
  next.focus({ preventScroll: false });
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Cycle a native select to the next/previous enabled option and notify React. */
export function adjustSelectValue(select: HTMLSelectElement, direction: 'left' | 'right' | 'up' | 'down'): boolean {
  const options = [...select.options];
  if (options.length === 0) return false;
  const step = direction === 'left' || direction === 'up' ? -1 : 1;
  let index = select.selectedIndex;
  for (let hop = 0; hop < options.length; hop++) {
    index = (index + step + options.length) % options.length;
    if (!options[index]!.disabled) break;
  }
  if (index === select.selectedIndex) return false;
  select.selectedIndex = index;
  select.value = options[index]!.value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function adjustRangeValue(input: HTMLInputElement, direction: 'left' | 'right' | 'up' | 'down'): boolean {
  const min = Number.isFinite(Number(input.min)) ? Number(input.min) : 0;
  const max = Number.isFinite(Number(input.max)) ? Number(input.max) : 100;
  const step = Number.isFinite(Number(input.step)) && Number(input.step) > 0 ? Number(input.step) : (max - min) / 20;
  const delta = direction === 'left' || direction === 'down' ? -step : step;
  const next = Math.max(min, Math.min(max, Number(input.value || 0) + delta));
  if (Object.is(next, Number(input.value))) return false;
  input.value = String(next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function activateFocused(root: HTMLElement): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scope = scopeRoot(root);
  const candidates = listFocusable(scope);
  const focused = active && candidates.includes(active) ? active : null;
  const target = focused ?? preferredFocus(candidates);
  if (!target) return false;
  // Nothing focused yet: the first A only shows where the cursor starts (never clicks a surprise button).
  if (!focused) { target.focus({ preventScroll: false }); return true; }
  if (target instanceof HTMLSelectElement) return true; // Focused; left/right cycles options.
  if (target instanceof HTMLInputElement && (target.type === 'range' || target.type === 'text' || target.type === 'number')) {
    // Text fields focus for keyboard entry; ranges handled by left/right.
    return true;
  }
  if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
    target.click();
    return true;
  }
  if (typeof (target as HTMLElement).click === 'function') {
    (target as HTMLElement).click();
    return true;
  }
  return false;
}

/** Back target priority: item switch > options dialog > open header settings menu (its cog closes it) > battle BACK >
 * roguelike secondary (MODES / leave / abandon). Returns null when none. */
export function findBackTarget(root: HTMLElement): HTMLElement | null {
  const pick = (selector: string, within: ParentNode = root): HTMLElement | null => {
    for (const element of [...within.querySelectorAll(selector)] as HTMLElement[]) {
      if (visible(element) && !(element instanceof HTMLButtonElement && element.disabled)) return element;
    }
    return null;
  };
  const itemSwitch = root.querySelector('.item-switch-backdrop');
  if (itemSwitch && visible(itemSwitch as HTMLElement)) {
    return pick('.item-switch-close', itemSwitch);
  }
  const dialog = root.querySelector('.options-dialog[open]');
  if (dialog) {
    return pick('button[aria-label="Close options"]', dialog) ?? pick('.options-dialog > .primary', dialog);
  }
  const settings = root.querySelector('.system-menu-header.is-open');
  if (settings) return pick('.system-menu-toggle', settings);
  const battleBack = pick('#back-to-characters, #back-to-mode, .battle-back');
  if (battleBack) return battleBack;
  const rogue = root.querySelector('.rogue-overlay');
  if (rogue && visible(rogue as HTMLElement)) {
    // Setup/end MODES, shop leave, intro abandon: the panel's secondary action.
    const secondary = pick('.rogue-actions .secondary', rogue);
    if (secondary) return secondary;
  }
  // Arena pause overlay has no back button; B does nothing there (Start pauses).
  return null;
}

export function pressBack(root: HTMLElement): boolean {
  const active = document.activeElement;
  // First B blurs a text field so controller users can leave it; second B goes back.
  if (active instanceof HTMLInputElement && (active.type === 'text' || active.type === 'number' || active.type === 'search') && active.closest('.game-app')) {
    active.blur();
    return true;
  }
  const target = findBackTarget(root);
  if (!target) return false;
  target.focus({ preventScroll: false });
  target.click();
  return true;
}

interface EdgeState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  prevSeat: boolean;
  nextSeat: boolean;
  repeatAt: number;
  repeatDir: MenuDirection | null;
}

/** Minimal seat-button surface so node unit tests can drive this without a DOM. */
interface SeatButton {
  readonly id: string;
  readonly disabled: boolean;
  getAttribute(name: string): string | null;
}
interface SeatScope {
  querySelector(selectors: string): unknown;
  querySelectorAll(selectors: string): ArrayLike<SeatButton>;
}

/** LB/RB seat cycling on character select: activates the previous/next player
 * panel (wrapping, skipping disabled seats) through the session, which cues.
 * Returns false outside the fighter setup so bumpers stay inert elsewhere. */
export function cycleSeat(scope: SeatScope, session: { selectSeat(slot: number): void }, direction: 1 | -1): boolean {
  if (!scope.querySelector('.battle-select')) return false;
  const seats: SeatButton[] = [];
  const nodes = scope.querySelectorAll('.battle-select .seat-select');
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (!node.disabled) seats.push(node);
  }
  if (seats.length === 0) return false;
  let current = seats.findIndex(seat => seat.getAttribute('aria-pressed') === 'true');
  if (current < 0) current = direction === 1 ? seats.length - 1 : 0;
  const match = /^select-seat-(\d+)$/.exec(seats[(current + direction + seats.length) % seats.length]!.id);
  if (!match) return false;
  session.selectSeat(Number(match[1]));
  return true;
}

/** rAF-driven gamepad focus navigation. Mount once in `PlayApp`. */
export function useGamepadMenuNav(root: RefObject<HTMLElement | null>, session: GameSession): void {
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    let lastFrame = 0, quitChord = false, rehomeAt = 0;
    const edge: EdgeState = { up: false, down: false, left: false, right: false, confirm: false, back: false, prevSeat: false, nextSeat: false, repeatAt: 0, repeatDir: null };
    const markGamepad = () => {
      const host = root.current;
      if (host && !host.classList.contains('gamepad-focus')) host.classList.add('gamepad-focus');
    };
    const markPointer = (event: Event) => {
      // Mouse/touch/keyboard keep native :focus-visible rings; gamepad adds its own.
      if (event.type === 'pointerdown' || event.type === 'mousedown' || event.type === 'touchstart') root.current?.classList.remove('gamepad-focus');
    };
    const tick = () => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      const host = root.current;
      const hub = session.input?.controllers;
      if (!host || !hub) return;
      // Never fight calibration: Listen owns every button while open.
      try {
        if (hub.getSnapshot().devices.some((device) => device.calibration)) {
          edge.up = edge.down = edge.left = edge.right = edge.confirm = edge.back = edge.prevSeat = edge.nextSeat = false;
          edge.repeatDir = null;
          return;
        }
      } catch {
        return;
      }
      let state;
      try {
        state = hub.menuState();
      } catch {
        return;
      }
      if (!state.connected) {
        edge.up = edge.down = edge.left = edge.right = edge.confirm = edge.back = edge.prevSeat = edge.nextSeat = false;
        edge.repeatDir = null;
        return;
      }
      // Active gameplay owns the stick/buttons; menus own them when paused,
      // ended, or outside the arena. Pause first, then navigate consumables and
      // match actions with the controller (mouse/touch stay live mid-match).
      try {
        const view = session.ui.getSnapshot();
        if (view.scene === 'arena' && view.active && !view.paused && !view.ended && !session.online) {
          // Track held buttons so an attack held while pausing never clicks Resume.
          edge.up = state.up; edge.down = state.down; edge.left = state.left; edge.right = state.right;
          edge.confirm = state.confirm; edge.back = state.back; edge.prevSeat = state.prevSeat; edge.nextSeat = state.nextSeat;
          edge.repeatDir = null;
          lastFrame = 0;
          return;
        }
        if (view.scene === 'arena' && view.paused && !session.online) {
          // Melee pause camera on the pad: right stick orbits, RT / LT zoom.
          // Holding both triggers is the L+R+A+Start quit chord, so A waits.
          const now = performance.now(), dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
          lastFrame = now;
          const pads = hub.menuPads();
          quitChord = pads.some(pad => pad.leftTrigger && pad.rightTrigger);
          const renderer = session.renderer;
          for (const pad of pads) {
            if (!renderer || dt === 0) break;
            if (pad.cX || pad.cY) renderer.pauseOrbit(pad.cX * 2.2 * dt, -pad.cY * 1.6 * dt);
            if (pad.rightTrigger !== pad.leftTrigger) renderer.pauseZoom(pad.rightTrigger ? Math.exp(-1.1 * dt) : Math.exp(1.1 * dt));
          }
        } else { quitChord = false; lastFrame = 0; }
      } catch {
        return;
      }
      // Hands own character/stage select: keep edges current so a press that
      // changes scenes never fires again on the next screen, but act on nothing.
      if (handSurface(host)) {
        edge.up = state.up; edge.down = state.down; edge.left = state.left; edge.right = state.right;
        edge.confirm = state.confirm; edge.back = state.back; edge.prevSeat = state.prevSeat; edge.nextSeat = state.nextSeat;
        edge.repeatDir = null;
        return;
      }
      const now = performance.now();
      // With a pad connected, focus that vanished with the last screen (fell back
      // to <body>) is re-homed on the new screen's main action, ring shown.
      if (now >= rehomeAt) {
        rehomeAt = now + 200;
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active === document.body || !host.contains(active)) {
          const home = preferredFocus(listFocusable(scopeRoot(host)));
          // Never park the cursor on a settings/account entry just because the screen's
          // own controls are still disabled mid-transition: retry on the next check.
          if (home && !home.closest('.system-menu')) { home.focus({ preventScroll: true }); markGamepad(); }
        }
      }
      const dirs: MenuDirection[] = ['up', 'down', 'left', 'right'];
      let pressedDir: MenuDirection | null = null;
      for (const dir of dirs) if (state[dir]) pressedDir = dir;
      // Direction edges + hold repeat (400ms delay, 150ms cadence).
      for (const dir of dirs) {
        const held = state[dir];
        const was = edge[dir];
        if (held && !was) {
          markGamepad();
          const active = document.activeElement;
          let handled = false;
          if (active instanceof HTMLSelectElement && host.contains(active) && (dir === 'left' || dir === 'right')) {
            handled = adjustSelectValue(active, dir);
          } else if (active instanceof HTMLInputElement && active.type === 'range' && host.contains(active) && (dir === 'left' || dir === 'right')) {
            handled = adjustRangeValue(active, dir);
          } else {
            handled = moveFocus(host, dir);
          }
          if (handled) {
            try {
              session.cue('select');
            } catch {
              /* Audio is best-effort; navigation still works muted. */
            }
          }
          edge.repeatDir = dir;
          edge.repeatAt = now + 400;
        }
        edge[dir] = held;
      }
      if (pressedDir && edge.repeatDir && state[edge.repeatDir] && now >= edge.repeatAt) {
        markGamepad();
        if (moveFocus(host, edge.repeatDir)) {
          try {
            session.cue('select');
          } catch {
            /* Best-effort menu tick. */
          }
        }
        edge.repeatAt = now + 150;
      }
      if (!pressedDir) edge.repeatDir = null;
      if (state.confirm && !edge.confirm && !quitChord) {
        markGamepad();
        activateFocused(host);
      }
      edge.confirm = state.confirm;
      if (state.back && !edge.back) {
        markGamepad();
        pressBack(host);
      }
      edge.back = state.back;
      // LB/RB switch the active player seat on character select. The session
      // cues on success, so no extra tick here (unlike focus moves).
      if (state.prevSeat && !edge.prevSeat) {
        markGamepad();
        cycleSeat(host, session, -1);
      }
      edge.prevSeat = state.prevSeat;
      if (state.nextSeat && !edge.nextSeat) {
        markGamepad();
        cycleSeat(host, session, 1);
      }
      edge.nextSeat = state.nextSeat;
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('pointerdown', markPointer, { passive: true });
    window.addEventListener('mousedown', markPointer, { passive: true });
    window.addEventListener('touchstart', markPointer, { passive: true });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', markPointer);
      window.removeEventListener('mousedown', markPointer);
      window.removeEventListener('touchstart', markPointer);
    };
  }, [root, session]);
}
