import { memo, useMemo, useState } from 'react';
import { MATCH_ITEM_NAMES, MATCH_ITEM_LABELS, itemKind, type CommonItemName } from '../../../lib/game/item-kinds.ts';
import { SUPPORTED_MATCH_ITEMS } from '../../../lib/game/item-engine.ts';

type MatchItemName = (typeof MATCH_ITEM_NAMES)[number];
const FREQUENCIES: ReadonlyArray<[number, string]> = [[-1, 'OFF'], [0, 'VERY LOW'], [1, 'LOW'], [2, 'MEDIUM'], [3, 'HIGH'], [4, 'VERY HIGH']];
/** Short menu blurbs (this port's honest scope notes, not original strings). */
const NOTES: Partial<Record<MatchItemName, string>> = {
  Capsule: 'Small container. Throw it to break it open — one item pops out.',
  Box: 'Heavy crate: carry it overhead (no jumps) and throw to break it open.',
  Taru: 'Heavy barrel: carry it overhead and throw it; sometimes it is a dud.',
  Egg: 'Fragile container hiding one item.',
  Kusudama: 'Party Ball: throw it and it drifts up, then rains items.',
  TaruCann: 'Barrel Cannon. Not ported yet.',
  BombHei: 'Bob-omb: throw it for a blast — leave it and it walks, then blows.',
  Dosei: 'Mr. Saturn. Bumps rivals and keeps going. Fully throwable.',
  Heart: 'Heart Container: restores 100% on pickup.',
  Tomato: 'Maxim Tomato: heals 50% on pickup.',
  Star: 'Starman: bounces by — touch it for invincibility.',
  Bat: 'Home-Run Bat. A swings it (smash for the big hit); Z throws.',
  Sword: 'Beam Sword. A swings jab/tilt/smash/dash arcs; Z throws.',
  Parasol: 'A swings it; Z throws. The slow-fall float is not ported yet.',
  GShell: 'Green Shell: hit or throw it to send it sliding.',
  RShell: 'Red Shell: slides and homes toward fighters.',
  LGun: 'Ray Gun: A fires 16 rays; Z throws.',
  Freeze: 'Freezie: slides along; throw it to chill a rival.',
  Foods: 'Food: a snack that heals a little on pickup.',
  MSBomb: 'Motion-Sensor Bomb: plant it and wait for footsteps.',
  Flipper: 'Flipper: throw it and it hovers, bumping anyone who touches it.',
  SScope: 'Super Scope: A fires energy shots from its charge pool; Z throws.',
  StarRod: 'Star Rod: swings launch stars (16 per rod); Z throws.',
  LipStick: "Lip's Stick. A swings it; Z throws. The flower is not ported yet.",
  Harisen: 'Fan. A slaps with it fast; Z throws.',
  FFlower: 'Fire Flower: A breathes a burst of flames; Z throws.',
  Kinoko: 'Super Mushroom: touch it to grow huge for a while.',
  DKinoko: 'Poison Mushroom: looks tasty, shrinks you tiny.',
  Hammer: 'Hammer: grab it and swing uncontrollably until it burns out.',
  WStar: 'Warp Star: grab it, soar up and crash down with a huge blast.',
  ScBall: 'Screw Attack: while held, your jumps hit like a screw attack.',
  RabbitC: 'Bunny Hood: faster runs and higher jumps for a while.',
  MetalB: 'Metal Box: launches barely move you while it lasts.',
  Spycloak: 'Cloaking Device: invisible and damage-proof while it lasts.',
  MBall: 'Poké Ball: throw it to release a Pokémon, weighted like the original (Snorlax, Charizard, Lugia…; rarely Mew or Celebi).',
};

export interface ItemSwitchProps {
  frequency: number;
  switches: readonly number[] | null;
  portraits: Readonly<Record<string, string>>;
  disabled: boolean;
  onRules: (patch: { items?: number; itemSwitches?: readonly number[] | null }) => void;
  onClose: () => void;
}

/** Melee-style Item Switch: frequency ladder plus one toggle tile per match item.
 * Unported kinds are visible but locked so the menu is honest about scope. */
export const ItemSwitch = memo(function ItemSwitch({ frequency, switches, portraits, disabled, onRules, onClose }: ItemSwitchProps) {
  const supported = useMemo(() => new Set(SUPPORTED_MATCH_ITEMS.map((name) => itemKind(name))), []);
  const enabled = useMemo(() => new Set(switches === null ? [...supported] : switches.filter((kind) => supported.has(kind))), [switches, supported]);
  const [focus, setFocus] = useState<MatchItemName>('Dosei');
  const toggle = (name: MatchItemName) => {
    const kind = itemKind(name);
    if (disabled || !supported.has(kind)) return;
    const next = new Set(enabled);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    onRules({ itemSwitches: [...next].sort((a, b) => a - b) });
  };
  const setAll = (on: boolean) => { if (!disabled) onRules({ itemSwitches: on ? [...supported].sort((a, b) => a - b) : [] }); };
  const focusKind = itemKind(focus), focusSupported = supported.has(focusKind);
  return <div className="item-switch-backdrop" role="dialog" aria-modal="true" aria-label="Item switch">
    <section className="item-switch">
      <header className="item-switch-head">
        <h3>ITEM SWITCH</h3>
        <div className="item-switch-frequency" role="group" aria-label="Item frequency">
          {FREQUENCIES.map(([value, label]) => <button key={value} className={frequency === value ? 'frequency-pill active' : 'frequency-pill'} disabled={disabled} aria-pressed={frequency === value} onClick={() => onRules({ items: value })}>{label}</button>)}
        </div>
        <button className="item-switch-close" onClick={onClose} aria-label="Close item switch">✕ DONE</button>
      </header>
      <div className="item-switch-grid" role="group" aria-label="Enabled items">
        {MATCH_ITEM_NAMES.map((name) => {
          const kind = itemKind(name), isSupported = supported.has(kind), on = enabled.has(kind);
          const className = `item-tile${isSupported ? on ? ' on' : ' off' : ' locked'}${focus === name ? ' focused' : ''}`;
          return <button key={name} className={className} data-item={name} disabled={disabled || !isSupported} aria-pressed={isSupported ? on : undefined}
            onClick={() => { setFocus(name); toggle(name); }} onMouseEnter={() => setFocus(name)} onFocus={() => setFocus(name)}
            title={MATCH_ITEM_LABELS[name]}>
            {portraits[name] ? <img src={portraits[name]} alt="" draggable={false} /> : <span className="item-tile-mark" aria-hidden="true">{MATCH_ITEM_LABELS[name].slice(0, 2).toUpperCase()}</span>}
            <strong>{MATCH_ITEM_LABELS[name]}</strong>
            {!isSupported && <span className="item-tile-badge">SOON</span>}
          </button>;
        })}
      </div>
      <footer className="item-switch-detail">
        <div className="item-switch-summary">
          <strong>{MATCH_ITEM_LABELS[focus]}</strong>
          <span className={focusSupported ? enabled.has(focusKind) ? 'state on' : 'state off' : 'state locked'}>{focusSupported ? enabled.has(focusKind) ? 'ON' : 'OFF' : 'NOT PORTED YET'}</span>
          <p>{NOTES[focus] ?? ''}</p>
        </div>
        <div className="item-switch-bulk">
          <button className="secondary" disabled={disabled} onClick={() => setAll(true)}>ALL ON</button>
          <button className="secondary" disabled={disabled} onClick={() => setAll(false)}>ALL OFF</button>
        </div>
      </footer>
      <p className="item-switch-scope">Locked tiles are original items not yet ported; they unlock wave by wave. Frequency uses the original spawn-interval ladder.</p>
    </section>
  </div>;
});
export type { CommonItemName };
