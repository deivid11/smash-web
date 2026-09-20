import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GameSession } from './game-session.ts';
import type { ControllerSnapshot } from '../input/controller-hub.ts';
import { AppUpdateControl } from './app-update.tsx';

/** Controller status: which pad (if any) can drive the menus right now.
 * String-compared so hub polls that only wiggle sticks never re-render menus. */
export function describePads(snapshot: ControllerSnapshot): string {
  const pads = snapshot.devices.filter(device => device.connected && (device.mapping || device.standard));
  if (pads.length === 0) return 'NO CONTROLLER — KEYBOARD + TOUCH READY';
  const first = pads[0]!;
  const slot = first.slot === null || first.slot === undefined ? '' : ` · P${first.slot + 1}`;
  const more = pads.length > 1 ? ` +${pads.length - 1}` : '';
  return `${first.profile.toUpperCase()}${slot}${more}`;
}
const PAD_LEGEND = 'Controller menus: stick moves your hand · A picks · B goes back · X / Y costume · LB / RB switch player · Start READY TO FIGHT / pause · View opens options';

function usePadStatus(session: GameSession): string | null {
  const hub = session.input?.controllers ?? null;
  const [text, setText] = useState<string | null>(() => (hub ? describePads(hub.getSnapshot()) : null));
  useEffect(() => {
    if (!hub) { setText(null); return; }
    setText(describePads(hub.getSnapshot()));
    return hub.subscribe(() => setText(describePads(hub.getSnapshot())));
  }, [hub]);
  return text;
}

export interface SystemMenuProps {
  session: GameSession;
  ready: boolean;
  onOptions: () => void;
  onControllers: () => void;
  /** Browser-only fullscreen toggle (absent inside the Android shell). */
  fullscreenButton?: ReactNode;
  /** `home`: labelled settings section in the mode select panel; `header`: one settings cog at the end of a scene header that opens Options / Controllers / Fullscreen. */
  variant: 'home' | 'header';
  /** Entries shown before Options on home (account, party chat); in a header, right before the cog. */
  leading?: ReactNode;
}

/** Menu settings entry points (Options, Controllers, fullscreen). Replaces the old
 * bottom system bar: audio, display, controllers, data, credits and the port lab all
 * live inside the Options dialog, reached from here or the controller View button. */
export const SystemMenu = memo(function SystemMenu({ session, ready, onOptions, onControllers, fullscreenButton, variant, leading }: SystemMenuProps) {
  const status = usePadStatus(session);
  const live = !!status && !status.startsWith('NO CONTROLLER');
  const padTitle = live ? `${status} — ${PAD_LEGEND}` : 'No controller connected: keyboard and touch are ready. Pair a pad, then open Controllers.';
  // Header: the leading entry (party chat chip) sits right before the settings cog.
  if (variant === 'header') return <>{leading}<HeaderSettings ready={ready} live={live} status={status} padTitle={padTitle} onOptions={onOptions} onControllers={onControllers} fullscreenButton={fullscreenButton} /></>;
  return <nav className="system-menu system-menu-home" aria-label="Settings">
    {leading}
    <button id="open-options" type="button" className="system-entry" aria-label="OPTIONS" onClick={onOptions}><span className="system-glyph" aria-hidden="true">⚙</span><span>Options</span></button>
    <button id="controller-settings" type="button" className={`system-entry${live ? ' is-live' : ''}`} disabled={!ready} title={padTitle} onClick={onControllers}><span className="system-glyph" aria-hidden="true">🎮</span><span>Controllers</span>{status && <small className="system-status" role="status">{live ? status : 'Keyboard + touch'}</small>}</button>
    {fullscreenButton}
    <AppUpdateControl variant="home" />
  </nav>;
});

/** Scene-header settings: a single cog whose menu holds Options, Controllers and
 * Fullscreen. The items stay mounted (hidden while closed) so their ids are stable;
 * Escape, B (web/src/play/gamepad-menu.ts back target), an outside tap or picking
 * an item closes it. */
function HeaderSettings({ ready, live, status, padTitle, onOptions, onControllers, fullscreenButton }: { ready: boolean; live: boolean; status: string | null; padTitle: string; onOptions: () => void; onControllers: () => void; fullscreenButton?: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Fixed under the cog: scene header plates clip overflow, so the menu cannot hang inside them.
  const [anchor, setAnchor] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const flip = (): void => {
    const rect = toggle.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: Math.round(rect.bottom + 6), right: Math.max(6, Math.round(window.innerWidth - rect.right)) });
    setOpen(value => !value);
  };
  useEffect(() => {
    if (!open) return;
    // Land the keyboard / pad cursor on the first item so D-pad + A work right away.
    box.current?.querySelector<HTMLElement>('.system-menu-popover button:not(:disabled)')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false); toggle.current?.focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent): void => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const close = (): void => setOpen(false);
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close); };
  }, [open]);
  return <div ref={box} className={`system-menu system-menu-header${open ? ' is-open' : ''}`} role="group" aria-label="Settings"
    onBlur={event => { if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={toggle} id="system-menu-toggle" type="button" className={`system-icon system-menu-toggle${live ? ' is-live' : ''}`} aria-label="Settings" aria-haspopup="menu" aria-expanded={open} title="Settings" onClick={flip}><span aria-hidden="true">⚙</span></button>
    <div className="system-menu-popover" role="menu" aria-label="Settings" hidden={!open} style={anchor} onClick={event => { if ((event.target as Element).closest('button')) setOpen(false); }}>
      <button id="open-options" type="button" role="menuitem" className="system-menu-item" aria-label="OPTIONS" onClick={onOptions}><span className="system-menu-glyph" aria-hidden="true">⚙</span><span>Options</span></button>
      <button id="controller-settings" type="button" role="menuitem" className={`system-menu-item${live ? ' is-live' : ''}`} disabled={!ready} aria-label="Controllers" title={padTitle} onClick={onControllers}><span className="system-menu-glyph" aria-hidden="true">🎮</span><span>Controllers</span>{status && <small>{live ? status : 'Keyboard + touch'}</small>}</button>
      {fullscreenButton}
    </div>
  </div>;
}
