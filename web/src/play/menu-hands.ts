/** Smash-style floating hands for character and stage select.
 *
 * Every connected controller gets its own pointing hand, tinted with the
 * player colour of the seat it controls (web/src/input/controller-hub.ts
 * `menuPads()` gives the per-pad read, the pad's human ordinal picks the seat):
 *
 * - Left stick glides the hand (analog speed curve, slower over targets);
 *   the D-pad hops it to the next control in that direction.
 * - A picks what the hand points at: a fighter for the hand's seat, a player
 *   panel (carrying that seat's token, like Melee's CPU coin), selects cycle.
 * - B drops a carried token, otherwise goes back.
 * - X / Y cycle the seat's costume (or a hovered select); on stage select
 *   they pick a random stage.
 * - LB / RB switch the active seat; Start is READY TO FIGHT (next / start).
 * - Select / View opens options; the right stick scrolls the screen.
 *
 * DOM-only like web/src/play/gamepad-menu.ts: hands click the same buttons a
 * mouse would, so React callbacks keep owning every setup change. The focus
 * navigator stands down wherever `handSurface()` is active.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { playerPresentation } from '../../../lib/game/player-colors.ts';
import type { ControllerHub, ControllerMenuPad } from '../input/controller-hub.ts';
import type { PlayerSeat } from '../../../lib/game/setup.ts';
import type { MenuSound } from '../menu-audio.ts';
import { adjustRangeValue, adjustSelectValue, cycleSeat, findBackTarget, handSurface, listFocusable, type MenuDirection } from './gamepad-menu.ts';
import './menu-hands.css';

/** What the hands need from GameSession (narrow for tests). */
export interface HandSession {
  input?: { controllers: Pick<ControllerHub, 'menuPads' | 'getSnapshot'> };
  ui: { getSnapshot(): { mode: 'solo' | 'lan' | null; setup: { seats: readonly PlayerSeat[] } } };
  readonly localHumans: readonly PlayerSeat[];
  cue(sound: MenuSound): void;
  selectSeat(slot: number): void;
}

const STICK_DEADZONE = 0.2;
const GAP_PROBES: readonly (readonly [number, number])[] = [[10, 0], [-10, 0], [0, 10], [0, -10]];

/** Analog stick → hand speed in px/s: dead zone, then an ease-in curve so small
 * tilts aim precisely and a full push crosses the screen in about a second. */
export function handSpeed(magnitude: number, viewport: { width: number; height: number }): number {
  if (!Number.isFinite(magnitude) || magnitude <= STICK_DEADZONE) return 0;
  const max = Math.max(650, Math.min(1700, 0.9 * Math.max(viewport.width, viewport.height)));
  return max * Math.min(1, ((magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE)) ** 1.6);
}

export interface HopRect { left: number; top: number; width: number; height: number }

/** D-pad hop: the nearest target strictly in `direction` from the hand point,
 * orthogonal drift penalized so rows and columns stay stable. Targets under the
 * point itself are skipped. Returns the index into `rects`, or -1. */
export function pickHop(point: { x: number; y: number }, rects: readonly HopRect[], direction: MenuDirection): number {
  let best = -1, bestScore = Infinity;
  rects.forEach((rect, index) => {
    if (point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height) return;
    const dx = rect.left + rect.width / 2 - point.x, dy = rect.top + rect.height / 2 - point.y;
    if ((direction === 'up' && dy >= -4) || (direction === 'down' && dy <= 4) || (direction === 'left' && dx >= -4) || (direction === 'right' && dx <= 4)) return;
    const vertical = direction === 'up' || direction === 'down';
    const score = (vertical ? Math.abs(dy) : Math.abs(dx)) + (vertical ? Math.abs(dx) : Math.abs(dy)) * 2.2;
    if (score < bestScore) { bestScore = score; best = index; }
  });
  return best;
}

/** Button glyphs by controller family, for the on-screen legend. */
export function handLegend(family: ControllerMenuPad['family'] | undefined): { a: string; b: string; x: string; y: string; bumpers: string; start: string; select: string } {
  if (family === 'playstation') return { a: '✕', b: '○', x: '□', y: '△', bumpers: 'L1/R1', start: 'OPTIONS', select: 'CREATE' };
  if (family === 'nintendo') return { a: 'A', b: 'B', x: 'Y', y: 'X', bumpers: 'L/R', start: '+', select: '−' };
  return { a: 'A', b: 'B', x: 'X', y: 'Y', bumpers: 'LB/RB', start: 'START', select: 'VIEW' };
}

/** The interactive control a hand points at, limited to `scope`. Labels
 * resolve to their control so the whole "STOCKS ▾" label is a target. */
export function handTarget(element: Element | null, scope: Element): HTMLElement | null {
  let node: Element | null = element?.closest('button, select, input, a[href], summary, label') ?? null;
  if (node instanceof HTMLLabelElement) node = node.control ?? null;
  return node instanceof HTMLElement && scope.contains(node) ? node : null;
}

interface PadButtons { confirm: boolean; back: boolean; west: boolean; north: boolean; prevSeat: boolean; nextSeat: boolean; start: boolean; select: boolean }
const BUTTONS: readonly (keyof PadButtons)[] = ['confirm', 'back', 'west', 'north', 'prevSeat', 'nextSeat', 'start', 'select'];

interface Hand {
  key: string; el: HTMLDivElement; tag: HTMLSpanElement; token: HTMLSpanElement;
  x: number; y: number; placed: boolean;
  glide: { x: number; y: number } | null;
  hopDir: MenuDirection | null; hopAt: number;
  prev: PadButtons;
  hover: HTMLElement | null;
  /** Seat token carried from another player panel (Melee's CPU coin). */
  carry: number | null;
  pending: { target: HTMLElement; frames: number } | null;
  paint: string;
}

const GLOVE = `<svg class="menu-hand-glove" viewBox="0 0 58 72" aria-hidden="true"><g class="menu-hand-outline"><rect x="8" y="1" width="13" height="38" rx="6.5"/><rect x="19" y="21" width="11" height="17" rx="5.5"/><rect x="28" y="23" width="11" height="16" rx="5.5"/><rect x="37" y="26" width="10" height="15" rx="5"/><rect x="7" y="27" width="41" height="31" rx="12"/><rect x="0" y="31" width="19" height="12" rx="6" transform="rotate(28 9 37)"/><rect x="12" y="55" width="31" height="15" rx="4"/></g><g class="menu-hand-fill"><rect x="8" y="1" width="13" height="38" rx="6.5"/><rect x="19" y="21" width="11" height="17" rx="5.5"/><rect x="28" y="23" width="11" height="16" rx="5.5"/><rect x="37" y="26" width="10" height="15" rx="5"/><rect x="7" y="27" width="41" height="31" rx="12"/><rect x="0" y="31" width="19" height="12" rx="6" transform="rotate(28 9 37)"/></g><path class="menu-hand-crease" d="M21 36v-3M30 37v-3M39 39v-3M14 48c8 3 17 3 26-1"/><rect class="menu-hand-cuff" x="12" y="55" width="31" height="15" rx="4"/></svg>`;

const seatOf = (element: Element | null): number | null => {
  const match = element ? /^select-seat-(\d+)$/.exec(element.id) : null;
  return match ? Number(match[1]) : null;
};
const disabled = (element: HTMLElement) => (element instanceof HTMLButtonElement || element instanceof HTMLSelectElement || element instanceof HTMLInputElement) && element.disabled;

export class MenuHands {
  private readonly hands = new Map<string, Hand>();
  private layer: HTMLDivElement | null = null;
  private legend: HTMLDivElement | null = null;
  private surface: HTMLElement | null = null;
  private last = 0;
  private primary: string | null = null;
  private focusing = false;
  private pointerAt = -Infinity;
  private painted = new Map<HTMLElement, string>();

  constructor(private readonly root: HTMLElement, private readonly session: HandSession, private readonly hooks: { openOptions(): void }) {
    root.addEventListener('focusin', this.onFocusIn);
    window.addEventListener('pointerdown', this.onPointer, { capture: true, passive: true });
  }

  dispose(): void {
    this.root.removeEventListener('focusin', this.onFocusIn);
    window.removeEventListener('pointerdown', this.onPointer, { capture: true });
    this.clearHover();
    this.layer?.remove(); this.layer = null; this.legend = null;
    this.root.classList.remove('has-menu-hands');
    this.hands.clear();
  }

  private onPointer = () => { this.pointerAt = performance.now(); };

  /** Keyboard / programmatic focus (not a click) warps the leading hand onto
   * the focused control, so Tab and the hands never disagree. */
  private onFocusIn = (event: FocusEvent) => {
    if (this.focusing || !this.surface || performance.now() - this.pointerAt < 400) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const menu = this.surface.closest('.menu-layer');
    if (!target || !menu?.contains(target)) return;
    const hand = (this.primary && this.hands.get(this.primary)) || this.hands.values().next().value;
    if (!hand) return;
    const rect = target.getBoundingClientRect();
    hand.x = rect.left + rect.width / 2; hand.y = rect.top + rect.height / 2; hand.glide = null; hand.placed = true;
  };

  tick(now: number): void {
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    const hub = this.session.input?.controllers;
    let pads: ControllerMenuPad[] = [];
    let surface: HTMLElement | null = null;
    try {
      if (hub && !hub.getSnapshot().devices.some(device => device.calibration)) { pads = hub.menuPads(); surface = handSurface(this.root); }
    } catch { pads = []; surface = null; }
    if (!surface || pads.length === 0) {
      // Keep button history so a press that leaves this screen never repeats.
      for (const pad of pads) { const hand = this.hands.get(pad.key); if (hand) hand.prev = this.buttons(pad); }
      this.hide();
      if (!surface) this.surface = null;
      return;
    }
    if (surface !== this.surface) {
      this.surface = surface;
      for (const hand of this.hands.values()) { hand.placed = false; hand.carry = null; hand.pending = null; hand.glide = null; }
    }
    this.show();
    const seen = new Set<string>();
    pads.forEach((pad, order) => {
      let hand = this.hands.get(pad.key);
      if (!hand) { hand = this.create(pad); this.hands.set(pad.key, hand); }
      seen.add(pad.key);
      this.step(hand, pad, order, dt, now, surface!);
    });
    for (const [key, hand] of this.hands) if (!seen.has(key)) { hand.el.remove(); this.hands.delete(key); }
    this.paintHover();
    this.paintLegend(pads[0]?.family);
  }

  private buttons(pad: ControllerMenuPad): PadButtons {
    return { confirm: pad.confirm, back: pad.back, west: pad.west, north: pad.north, prevSeat: pad.prevSeat, nextSeat: pad.nextSeat, start: pad.start, select: pad.select };
  }

  private create(pad: ControllerMenuPad): Hand {
    const el = document.createElement('div');
    el.className = 'menu-hand';
    el.innerHTML = GLOVE;
    const tag = document.createElement('span'); tag.className = 'menu-hand-tag';
    const token = document.createElement('span'); token.className = 'menu-hand-token'; token.hidden = true;
    el.append(tag, token);
    this.layer!.append(el);
    return { key: pad.key, el, tag, token, x: 0, y: 0, placed: false, glide: null, hopDir: null, hopAt: 0, prev: this.buttons(pad), hover: null, carry: null, pending: null, paint: '' };
  }

  private show(): void {
    if (!this.layer) {
      this.layer = document.createElement('div');
      this.layer.className = 'menu-hands';
      this.layer.setAttribute('aria-hidden', 'true');
      this.legend = document.createElement('div');
      this.legend.className = 'menu-hands-legend';
      this.layer.append(this.legend);
      this.root.append(this.layer);
    }
    this.layer.hidden = false;
    this.root.classList.add('has-menu-hands');
  }

  private hide(): void {
    if (this.layer && !this.layer.hidden) { this.layer.hidden = true; this.root.classList.remove('has-menu-hands'); }
    for (const hand of this.hands.values()) { hand.hover = null; hand.pending = null; }
    this.clearHover();
  }

  private stage(): boolean { return !!this.surface?.matches('.stage-select'); }

  /** The seat this pad plays: its human ordinal among local HUMAN seats, or on
   * LAN the browser's own (active) panel. Undefined for a spare controller. */
  private ownSeat(pad: ControllerMenuPad): number | undefined {
    if (this.session.ui.getSnapshot().mode === 'lan') return this.activeSeat() ?? undefined;
    return pad.slot === null ? undefined : this.session.localHumans[pad.slot]?.slot;
  }

  private activeSeat(): number | null {
    return seatOf(this.surface?.querySelector('.seat-select[aria-pressed="true"]') ?? null);
  }

  private targetSeat(hand: Hand, pad: ControllerMenuPad): number | null {
    return hand.carry ?? this.ownSeat(pad) ?? this.activeSeat();
  }

  private place(hand: Hand, pad: ControllerMenuPad, order: number): void {
    const surface = this.surface!;
    let anchor: Element | null = null;
    if (this.stage()) anchor = surface.querySelector('[data-stage][aria-pressed="true"]');
    else {
      const seat = this.ownSeat(pad);
      const fighter = seat === undefined ? undefined : this.session.ui.getSnapshot().setup.seats.find(entry => entry.slot === seat);
      if (fighter && fighter.control !== 'off') anchor = surface.querySelector(`.roster-grid button[data-fighter="${fighter.fighter}"]`);
      if (!anchor && seat !== undefined) anchor = surface.querySelector(`#select-seat-${seat}`);
    }
    const rect = (anchor ?? surface).getBoundingClientRect();
    const inView = rect.bottom > 0 && rect.top < innerHeight;
    hand.x = rect.left + rect.width * (anchor ? 0.5 : 0.35) + order * 16;
    hand.y = inView ? rect.top + Math.min(rect.height, innerHeight) * (anchor ? 0.5 : 0.35) + order * 12 : innerHeight / 2;
    hand.placed = true;
  }

  private step(hand: Hand, pad: ControllerMenuPad, order: number, dt: number, now: number, surface: HTMLElement): void {
    // (Re)appearing hands ignore buttons already held: the press that closed a
    // dialog or changed the screen must not act again here.
    const fresh = !hand.placed;
    if (fresh) { this.place(hand, pad, order); hand.prev = this.buttons(pad); }
    const menu = surface.closest('.menu-layer') ?? surface;
    const scroller = menu instanceof HTMLElement ? menu : null;

    // Stick glide.
    const magnitude = Math.hypot(pad.x, pad.y);
    let moved = false;
    const speed = handSpeed(magnitude, { width: innerWidth, height: innerHeight }) * (hand.hover ? 0.75 : 1);
    if (speed > 0) {
      hand.x += (pad.x / magnitude) * speed * dt;
      hand.y -= (pad.y / magnitude) * speed * dt;
      hand.glide = null; moved = true;
      // Pushing into the top/bottom edge scrolls tall screens (phones).
      if (scroller && hand.y < 28 && pad.y > 0) scroller.scrollTop -= speed * dt;
      if (scroller && hand.y > innerHeight - 28 && pad.y < 0) scroller.scrollTop += speed * dt;
    }
    // D-pad hops with hold-to-repeat.
    const dir: MenuDirection | null = pad.dpadX > 0 ? 'right' : pad.dpadX < 0 ? 'left' : pad.dpadY > 0 ? 'up' : pad.dpadY < 0 ? 'down' : null;
    if (dir && (dir !== hand.hopDir || now >= hand.hopAt)) {
      hand.hopAt = now + (dir === hand.hopDir ? 130 : 380);
      if (this.hop(hand, menu, dir)) { moved = true; this.cue('select'); }
    }
    hand.hopDir = dir;
    if (hand.glide) {
      moved = true;
      const k = 1 - Math.exp(-dt * 24);
      hand.x += (hand.glide.x - hand.x) * k; hand.y += (hand.glide.y - hand.y) * k;
      if (Math.hypot(hand.glide.x - hand.x, hand.glide.y - hand.y) < 0.75) { hand.x = hand.glide.x; hand.y = hand.glide.y; hand.glide = null; }
    }
    // Right stick scrolls.
    if (scroller && Math.abs(pad.cY) > 0) scroller.scrollTop -= pad.cY * 900 * dt;
    hand.x = Math.max(2, Math.min(innerWidth - 2, hand.x));
    hand.y = Math.max(2, Math.min(innerHeight - 2, hand.y));
    if (moved) this.primary = hand.key;

    // Hover: what the fingertip points at. Grid gaps are a few pixels wide, so
    // a fingertip resting between two cards still grabs the nearest one.
    let target = handTarget(document.elementFromPoint(hand.x, hand.y), menu);
    for (const [dx, dy] of GAP_PROBES) {
      if (target) break;
      target = handTarget(document.elementFromPoint(hand.x + dx, hand.y + dy), menu);
    }
    if (target !== hand.hover) {
      hand.hover = target;
      if (target && (target.dataset.fighter || target.dataset.stage)) target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
      if (target && moved && this.primary === hand.key && document.activeElement !== target) {
        this.focusing = true;
        try { target.focus({ preventScroll: true }); } finally { this.focusing = false; }
      }
    }

    // A fighter pick waiting for its seat panel to become active.
    if (hand.pending && --hand.pending.frames <= 0) {
      const { target: pick } = hand.pending;
      hand.pending = null;
      if (pick.isConnected && !disabled(pick)) pick.click();
    }

    const buttons = this.buttons(pad);
    const pressed = (name: keyof PadButtons) => buttons[name] && !hand.prev[name];
    const edges = BUTTONS.filter(pressed);
    hand.prev = buttons;
    for (const edge of edges) this.act(hand, pad, edge);
    this.paintHand(hand, pad);
  }

  private hop(hand: Hand, menu: Element, direction: MenuDirection): boolean {
    const candidates = listFocusable(menu);
    const index = pickHop(hand, candidates.map(element => element.getBoundingClientRect()), direction);
    if (index < 0) return false;
    const target = candidates[index]!;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    hand.glide = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return true;
  }

  private cue(sound: MenuSound): void {
    try { this.session.cue(sound); } catch { /* Audio is best-effort. */ }
  }

  private press(hand: Hand): void {
    hand.el.classList.remove('is-pressing');
    void hand.el.offsetWidth; // Restart the tap animation.
    hand.el.classList.add('is-pressing');
  }

  private act(hand: Hand, pad: ControllerMenuPad, edge: keyof PadButtons): void {
    const surface = this.surface!;
    const stage = this.stage();
    const target = hand.hover;
    switch (edge) {
      case 'confirm': {
        this.press(hand);
        if (!target) return;
        if (disabled(target)) { this.cue('back'); return; }
        if (target instanceof HTMLSelectElement) { adjustSelectValue(target, 'right'); return; }
        if (target instanceof HTMLInputElement) {
          if (target.type === 'range') adjustRangeValue(target, 'right');
          else if (target.type === 'checkbox' || target.type === 'radio') target.click();
          else target.focus();
          return;
        }
        if (!stage && target.matches('.roster-grid button[data-fighter]')) {
          const seat = this.targetSeat(hand, pad);
          const panel = seat === null ? null : surface.querySelector<HTMLElement>(`#select-seat-${seat}`);
          hand.carry = null;
          if (panel && seat !== this.activeSeat() && !disabled(panel)) {
            // Make the hand's seat the chooser first; click once React re-rendered.
            panel.click();
            hand.pending = { target, frames: 2 };
          } else target.click();
          return;
        }
        if (!stage && target.matches('.seat-select')) {
          const seat = seatOf(target);
          target.click();
          const own = this.ownSeat(pad);
          hand.carry = seat !== null && seat !== own ? seat : null;
          return;
        }
        target.click();
        return;
      }
      case 'back': {
        if (hand.carry !== null) { hand.carry = null; this.cue('back'); return; }
        findBackTarget(this.root)?.click();
        return;
      }
      case 'start': {
        const next = surface.querySelector<HTMLElement>(stage ? '#start-match' : '#go-stage');
        if (next && !disabled(next)) { this.press(hand); next.click(); }
        else this.cue('back');
        return;
      }
      case 'select': this.hooks.openOptions(); return;
      case 'west':
      case 'north': {
        const forward = edge === 'north';
        if (target instanceof HTMLSelectElement && !disabled(target)) { adjustSelectValue(target, forward ? 'right' : 'left'); return; }
        if (target instanceof HTMLInputElement && target.type === 'range' && !disabled(target)) { adjustRangeValue(target, forward ? 'right' : 'left'); return; }
        if (stage) { const random = surface.querySelector<HTMLElement>('[data-stage="random"]'); if (random && !disabled(random)) random.click(); return; }
        const seat = this.targetSeat(hand, pad);
        const arrow = seat === null ? null : surface.querySelector<HTMLElement>(`#costume-${forward ? 'next' : 'prev'}-${seat}`);
        if (arrow && !disabled(arrow)) { this.press(hand); arrow.click(); } else this.cue('back');
        return;
      }
      case 'prevSeat':
      case 'nextSeat': {
        if (stage) return;
        if (cycleSeat(surface.ownerDocument, this.session, edge === 'nextSeat' ? 1 : -1)) {
          // The active panel is updated synchronously in the session store; read it back next frame.
          requestAnimationFrame(() => {
            const seat = this.activeSeat();
            hand.carry = seat !== null && seat !== this.ownSeat(pad) ? seat : null;
          });
        }
        return;
      }
    }
  }

  private paintHand(hand: Hand, pad: ControllerMenuPad): void {
    hand.el.style.transform = `translate3d(${hand.x}px, ${hand.y}px, 0)`;
    const own = this.ownSeat(pad);
    const carry = hand.carry !== null && hand.carry !== own ? hand.carry : null;
    const seats = this.session.ui.getSnapshot().setup.seats;
    const carried = carry === null ? undefined : seats.find(seat => seat.slot === carry);
    const signature = `${own ?? '-'}|${carry ?? '-'}|${carried?.control ?? ''}`;
    if (signature === hand.paint) return;
    hand.paint = signature;
    const color = own === undefined ? { css: '#aeb8c8', ink: '#0b1020' } : playerPresentation(own);
    hand.el.style.setProperty('--hand-color', color.css);
    hand.el.style.setProperty('--hand-ink', color.ink);
    hand.el.dataset.handSeat = own === undefined ? '' : String(own);
    hand.tag.textContent = own === undefined ? '🎮' : `P${own + 1}`;
    hand.token.hidden = carry === null;
    if (carry !== null) {
      const tint = playerPresentation(carry);
      hand.token.textContent = `${carried?.control === 'cpu' ? 'CPU' : `P${carry + 1}`}`;
      hand.token.style.setProperty('--token-color', tint.css);
      hand.token.style.setProperty('--token-ink', tint.ink);
    }
  }

  private paintHover(): void {
    const next = new Map<HTMLElement, string>();
    for (const hand of this.hands.values()) if (hand.hover && !next.has(hand.hover)) next.set(hand.hover, hand.el.style.getPropertyValue('--hand-color') || '#fff');
    for (const [element] of this.painted) if (!next.has(element)) { element.removeAttribute('data-hand-hover'); element.style.removeProperty('--hand-hover'); }
    for (const [element, color] of next) if (this.painted.get(element) !== color) { element.setAttribute('data-hand-hover', ''); element.style.setProperty('--hand-hover', color); }
    this.painted = next;
  }

  private clearHover(): void {
    for (const [element] of this.painted) { element.removeAttribute('data-hand-hover'); element.style.removeProperty('--hand-hover'); }
    this.painted.clear();
  }

  private legendKey = '';
  private paintLegend(family: ControllerMenuPad['family'] | undefined): void {
    if (!this.legend) return;
    const key = `${family}|${this.stage()}`;
    if (key === this.legendKey) return;
    this.legendKey = key;
    const glyph = handLegend(family);
    const item = (button: string, label: string) => `<span><b>${button}</b>${label}</span>`;
    this.legend.innerHTML = this.stage()
      ? [item(glyph.a, 'PICK'), item(glyph.b, 'BACK'), item(`${glyph.x}/${glyph.y}`, 'RANDOM'), item(glyph.start, 'FIGHT!')].join('')
      : [item(glyph.a, 'PICK'), item(glyph.b, 'BACK'), item(`${glyph.x}/${glyph.y}`, 'COSTUME'), item(glyph.bumpers, 'PLAYER'), item(glyph.start, 'READY')].join('');
  }
}

/** Mount once in PlayApp next to useGamepadMenuNav. */
export function useMenuHands(root: RefObject<HTMLElement | null>, session: HandSession, openOptions: () => void): void {
  const options = useRef(openOptions);
  options.current = openOptions;
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const hands = new MenuHands(host, session, { openOptions: () => options.current() });
    let frame = 0;
    const loop = (now: number) => { frame = requestAnimationFrame(loop); hands.tick(now); };
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); hands.dispose(); };
  }, [root, session]);
}
