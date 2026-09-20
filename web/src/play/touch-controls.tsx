import { memo, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameSession } from './game-session.ts';

/** Action cluster: one code per button, same codes as the P1 keyboard layout. `ShortHop` has no
 * key: it presses jump for exactly one simulation frame (see PlayInput.poll), so a thumb tap of
 * any length releases inside the jump squat and always short hops. */
const ACTIONS = [
  ['Space', 'Jump', 'JUMP', 'jump'], ['KeyJ', 'Quick attack', 'A', 'quick'], ['KeyK', 'Strong attack', 'SMASH', 'strong'],
  ['KeyL', 'Special', 'B', 'special'], ['ShortHop', 'Short hop', 'HOP', 'hop'], ['KeyU', 'Shield or air dodge', 'SHIELD', 'shield'], ['KeyI', 'Grab', 'GRAB', 'grab'],
] as const;
/** Travel radius, dead zone and response curve: the walk band (output below the run
 * threshold, ~0.8) spans roughly 10-55 px of thumb travel; a full push runs. */
const STICK_RADIUS = 64, STICK_DEADZONE = 0.1, STICK_CURVE = 1.25, RUN_OUTPUT = 0.8;
const vibrate = () => { try { navigator.vibrate?.(8); } catch { /* Haptics are optional. */ } };
const capture = (target: Element, pointerId: number) => { try { target.setPointerCapture(pointerId); } catch { /* Synthetic pointers have no capture. */ } };

/** Floating analog stick: the base appears wherever the thumb lands, follows it when the
 * thumb travels past the radius (so direction is always relative to the current thumb
 * position), and outputs the P1 analog vector (x right, y up) through a walk/run curve. */
const TouchStick = memo(function TouchStick({ session }: { session: GameSession }) {
  const zone = useRef<HTMLDivElement>(null), base = useRef<HTMLDivElement>(null), knob = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const placeBase = (x: number, y: number) => {
    const rect = zone.current?.getBoundingClientRect();
    if (base.current && rect) { base.current.style.left = `${x - rect.left}px`; base.current.style.top = `${y - rect.top}px`; }
  };
  const place = useCallback((dx: number, dy: number) => {
    const length = Math.hypot(dx, dy), scale = length > STICK_RADIUS ? STICK_RADIUS / length : 1;
    if (knob.current) knob.current.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    const magnitude = Math.min(1, length / STICK_RADIUS);
    const value = magnitude < STICK_DEADZONE ? 0 : Math.pow((magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE), STICK_CURVE);
    zone.current?.setAttribute('data-tier', value === 0 ? 'idle' : value >= RUN_OUTPUT ? 'run' : 'walk');
    session.stick(length ? dx / length * value : 0, length ? -dy / length * value : 0);
  }, [session]);
  const release = useCallback(() => {
    pointer.current = null; zone.current?.classList.remove('active'); place(0, 0);
  }, [place]);
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current) return;
    event.preventDefault(); capture(event.currentTarget, event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    placeBase(event.clientX, event.clientY);
    event.currentTarget.classList.add('active'); place(0, 0); vibrate(); session.focus();
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = pointer.current;
    if (origin?.id !== event.pointerId) return;
    let dx = event.clientX - origin.x, dy = event.clientY - origin.y;
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      // Drag the base along with the thumb instead of pinning it to the first touch.
      const slack = 1 - STICK_RADIUS / length;
      origin.x += dx * slack; origin.y += dy * slack; dx -= dx * slack; dy -= dy * slack;
      placeBase(origin.x, origin.y);
    }
    place(dx, dy);
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => { if (pointer.current?.id === event.pointerId) release(); };
  useEffect(() => () => release(), [release]);
  return <div ref={zone} id="touch-stick" className="touch-stick" role="group" aria-label="Movement stick" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
    <div className="stick-rest" aria-hidden="true" />
    <div ref={base} className="stick-base" aria-hidden="true"><div ref={knob} className="stick-knob" /></div>
  </div>;
});

/** Action buttons with slide support: a finger that moves between buttons releases the
 * previous code and presses the new one, and several fingers can hold different buttons. */
const TouchActions = memo(function TouchActions({ session }: { session: GameSession }) {
  const held = useRef(new Map<number, string>());
  const codeAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-key]') as HTMLElement | null)?.dataset.key ?? null;
  const set = useCallback((id: number, code: string | null) => {
    const previous = held.current.get(id) ?? null;
    if (previous === code) return;
    if (previous) { session.touch(previous, id, false); held.current.delete(id); }
    if (code) { held.current.set(id, code); session.touch(code, id, true); vibrate(); }
  }, [session]);
  const down = (event: ReactPointerEvent<HTMLDivElement>) => { event.preventDefault(); capture(event.currentTarget, event.pointerId); set(event.pointerId, codeAt(event.clientX, event.clientY)); };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => { if (held.current.has(event.pointerId)) set(event.pointerId, codeAt(event.clientX, event.clientY)); };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => set(event.pointerId, null);
  useEffect(() => () => { for (const [id, code] of held.current) session.touch(code, id, false); held.current.clear(); }, [session]);
  return <div id="touch-controls" className="touch-actions" role="group" aria-label="Action buttons" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}>
    {ACTIONS.map(([code, label, text, kind]) => <button key={code} type="button" data-key={code} className={`touch-${kind}`} aria-label={label} title={label}>{text}</button>)}
  </div>;
});

export const TouchControls = memo(function TouchControls({ session }: { session: GameSession }) {
  return <div className="touch-layer" id="touch-layer"><TouchStick session={session} /><TouchActions session={session} /></div>;
});
