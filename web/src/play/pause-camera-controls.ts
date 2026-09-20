import type { PlayRenderer } from '../render/play-renderer.ts';

export interface PauseFocusInfo { slot: number; name: string }
interface PauseControlHooks {
  /** Focus target changed (fighter slot + name, or null for the free look). */
  onFocusChange: (focus: PauseFocusInfo | null) => void;
  /** True while pause-camera input must stand down (disposed, options open). */
  blocked: () => boolean;
}

/** Live-scaled per-frame rates for held keys (distance scaling happens inside
 * the renderer's pause camera, so these stay constant). */
const KEY_PAN = 3.5;
const KEY_YAW = 0.03;
const KEY_ZOOM_IN = 0.985;
const KEY_ZOOM_OUT = 1.015;
const DRAG_ORBIT = 0.006;
const DRAG_PAN = 0.85;

/** Translates mouse + keyboard into the renderer's Melee-style pause camera
 * (orbit / zoom / pan / focus). Only active while the match is paused, and it
 * never touches simulation input — the gameplay ControllerHub stays disabled. */
export class PauseCameraControls {
  private readonly abort = new AbortController();
  private readonly keys = new Set<string>();
  private active = false;
  private drag: { mode: 'orbit' | 'pan'; id: number; x: number; y: number } | null = null;

  constructor(private readonly canvas: HTMLElement, private readonly renderer: PlayRenderer, private readonly hooks: PauseControlHooks) {
    const signal = this.abort.signal;
    this.canvas.addEventListener('pointerdown', this.onPointerDown, { signal });
    this.canvas.addEventListener('pointermove', this.onPointerMove, { signal });
    this.canvas.addEventListener('pointerup', this.onPointerUp, { signal });
    this.canvas.addEventListener('pointercancel', this.onPointerUp, { signal });
    this.canvas.addEventListener('wheel', this.onWheel, { signal, passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu, { signal });
    window.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('keyup', this.onKeyUp, { signal });
    window.addEventListener('blur', this.onBlur, { signal });
  }

  /** Begin accepting pause-camera input (called when the match pauses). */
  enable(): void { this.active = true; this.keys.clear(); this.drag = null; }
  /** Stop accepting input and drop any held state (called on resume). */
  disable(): void { this.active = false; this.keys.clear(); this.drag = null; }
  dispose(): void { this.abort.abort(); }

  private live(): boolean { return this.active && !this.hooks.blocked(); }
  private editable(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest('input, select, textarea, button, a, [contenteditable="true"]');
  }

  /** Apply continuously-held keys once per frame; called from the paused tick. */
  poll(): void {
    if (!this.live() || !this.keys.size) return;
    const has = (...codes: string[]) => codes.some((code) => this.keys.has(code));
    let panR = 0, panU = 0;
    if (has('KeyD', 'ArrowRight')) panR += KEY_PAN;
    if (has('KeyA', 'ArrowLeft')) panR -= KEY_PAN;
    if (has('KeyW', 'ArrowUp')) panU += KEY_PAN;
    if (has('KeyS', 'ArrowDown')) panU -= KEY_PAN;
    if (panR || panU) this.renderer.pausePan(panR, panU);
    if (has('KeyQ')) this.renderer.pauseOrbit(KEY_YAW, 0);
    if (has('KeyE')) this.renderer.pauseOrbit(-KEY_YAW, 0);
    if (has('Equal', 'NumpadAdd')) this.renderer.pauseZoom(KEY_ZOOM_IN);
    if (has('Minus', 'NumpadSubtract')) this.renderer.pauseZoom(KEY_ZOOM_OUT);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.live()) return;
    // Left drag orbits; right / middle / shift-left drag pans.
    const pan = event.button === 1 || event.button === 2 || event.shiftKey;
    this.drag = { mode: pan ? 'pan' : 'orbit', id: event.pointerId, x: event.clientX, y: event.clientY };
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
    event.preventDefault();
  };
  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    if (!this.live()) { this.drag = null; return; }
    const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
    this.drag.x = event.clientX; this.drag.y = event.clientY;
    if (this.drag.mode === 'orbit') this.renderer.pauseOrbit(dx * DRAG_ORBIT, dy * DRAG_ORBIT);
    else this.renderer.pausePan(-dx * DRAG_PAN, dy * DRAG_PAN);
    event.preventDefault();
  };
  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    this.drag = null;
    try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };
  private onWheel = (event: WheelEvent): void => {
    if (!this.live()) return;
    // deltaMode 1 (lines) / 2 (pages) carry much larger magnitudes than pixels.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight || 800 : 1;
    this.renderer.pauseZoom(Math.exp(Math.max(-4, Math.min(4, event.deltaY * unit * 0.0012))));
    event.preventDefault();
  };
  private onContextMenu = (event: Event): void => { if (this.live()) event.preventDefault(); };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.live() || event.repeat && !HELD.has(event.code)) return;
    if (this.editable(event.target)) return;
    if (HELD.has(event.code)) { this.keys.add(event.code); event.preventDefault(); return; }
    switch (event.code) {
      case 'Tab': this.hooks.onFocusChange(this.renderer.pauseFocusCycle(event.shiftKey ? -1 : 1)); event.preventDefault(); break;
      case 'KeyR': this.renderer.pauseReset(); this.hooks.onFocusChange(this.renderer.pauseFocusInfo()); event.preventDefault(); break;
      default:
        if (/^Digit[1-8]$/.test(event.code)) {
          const info = this.renderer.pauseFocusSlot(Number(event.code.slice(5)) - 1);
          if (info) { this.hooks.onFocusChange(info); event.preventDefault(); }
        }
    }
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private onBlur = (): void => { this.keys.clear(); this.drag = null; };
}

/** Keys applied continuously each frame (held), versus one-shot on keydown. */
const HELD = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
