import { memo, useState, type CSSProperties, type ReactNode } from 'react';
import './play-screens.css';
import type { FighterKind } from '../../../lib/game/data.ts';
import { clampCostumeIndex, costumeCount, costumeName, portraitFor } from '../../../lib/game/costumes.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from '../../../lib/game/limits.ts';
import { playerPresentation } from '../../../lib/game/player-colors.ts';
import { activeSeats, type BattleSetup, type PlayerSeat, type SeatControl } from '../../../lib/game/setup.ts';
import { isPairedSlotKind, pickRandomKind, ROSTER_CHOICES } from '../../../lib/game/roster.ts';
import { HILL_TEAM_COLORS, HILL_TEAM_NAMES, hillTeamOfSlot } from '../../../lib/game/hill.ts';
import type { HillSetup } from '../../../lib/game/hill.ts';
import { CPU_LEVEL_NAMES, CPU_LEVELS, clampCpuLevel, type CpuLevel } from '../../../lib/game/cpu.ts';
import { SUPPORTED_MATCH_ITEMS } from '../../../lib/game/item-engine.ts';
import { ItemSwitch } from './item-switch.tsx';
import { LoadProgressBar, type BackgroundLoad } from './load-progress.tsx';
import { useFitColumns } from './fit-grid.ts';

import { CUSTOM_PACKS } from '../../../lib/custom/registry.ts';
import { isCustomFighter } from '../../../lib/custom/identity.ts';
const BUILTIN_FIGHTERS = [
  { id: 0, kind: 'Fx', name: 'Fox', mark: 'FX', color: 'mint', subtitle: 'Blaster · Illusion · Reflector', provenance: 'Original Melee fighter' },
  { id: 1, kind: 'Mr', name: 'Mario', mark: 'M', color: 'coral', subtitle: 'Fireball · Cape · Tornado', provenance: 'Original Melee fighter' },
  { id: 3, kind: 'Kb', name: 'Kirby', mark: 'K', color: 'pink', subtitle: 'Inhale · Hammer · Cutter · Stone', provenance: 'Original Melee fighter' },
  { id: 4, kind: 'Ss', name: 'Samus', mark: 'S', color: 'orange', subtitle: 'Charge shot · Missiles · Screw attack · Bombs', provenance: 'Original assets · prototype; no tether or bomb jump' },
  { id: 5, kind: 'Pk', name: 'Pikachu', mark: 'PK', color: 'electric', subtitle: 'Thunder Jolt · Skull Bash · Quick Attack · Thunder', provenance: 'Original assets · prototype special orchestration' },
  { id: 6, kind: 'Fe', name: 'Roy', mark: 'R', color: 'coral', subtitle: 'Flare Blade · Double-Edge Dance · Blazer · Counter', provenance: 'Original assets · prototype; partial fire/trail effects' },
  { id: 7, kind: 'Lk', name: 'Link', mark: 'L', color: 'mint', subtitle: 'Bow · Boomerang · Spin Attack · Bomb', provenance: 'Original assets · hookshot, bomb items and landing cancels' },
  { id: 8, kind: 'Ca', name: 'Captain Falcon', mark: 'CF', color: 'coral', subtitle: 'Falcon Punch · Raptor Boost · Falcon Dive · Falcon Kick', provenance: 'Original assets · prototype; partial flame/wind effects' },
  { id: 9, kind: 'Dk', name: 'Donkey Kong', mark: 'DK', color: 'coral', subtitle: 'Giant Punch · Headbutt · Spinning Kong · Hand Slap', provenance: 'Original assets · prototype; cargo carry and Headbutt bury' },
  { id: 10, kind: 'Mt', name: 'Mewtwo', mark: 'M2', color: 'water', subtitle: 'Shadow Ball · Confusion · Teleport · Disable', provenance: 'Original assets · prototype; no Confusion grab or Disable stun' },
  { id: 11, kind: 'Cl', name: 'Young Link', mark: 'YL', color: 'mint', subtitle: 'Fire Bow · Boomerang · Spin Attack · Bombs', provenance: 'Original assets · hookshot, bomb items and landing cancels' },
  { id: 12, kind: 'Pr', name: 'Jigglypuff', mark: 'JP', color: 'pink', subtitle: 'Rollout · Pound · Sing · Rest', provenance: 'Original assets · prototype; no wall rebound or scale pop' },
  { id: 13, kind: 'Ns', name: 'Ness', mark: 'N', color: 'coral', subtitle: 'PK Flash · PK Fire · PK Thunder · PSI Magnet', provenance: 'Original assets · prototype; no yo-yo charge or PKT2 wall rebound' },
  { id: 14, kind: 'Kp', name: 'Bowser', mark: 'BW', color: 'orange', subtitle: 'Fire Breath · Koopa Klaw · Whirling Fortress · Bowser Bomb', provenance: 'Original assets · prototype; no Klaw mash escape or flame arcs' },
  { id: 15, kind: 'Pe', name: 'Peach', mark: 'PC', color: 'pink', subtitle: 'Toad · Peach Bomber · Parasol · Turnips · Float', provenance: 'Original assets · prototype; no rare pulls or held-turnip visuals' },
  { id: 16, kind: 'Zx', name: 'Zero', mark: 'Z', color: 'coral', subtitle: 'Z-Buster · Hienkyaku · Ryuenjin · Sentsuizan', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 17, kind: 'Td', name: 'Toad', mark: 'TD', color: 'pink', subtitle: 'Ice Ball · Quick poke · Vault recovery', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 18, kind: 'Mk', name: 'Meta Knight', mark: 'MK', color: 'water', subtitle: 'Mach Tornado · Drill Rush · Shuttle Loop · Dimensional Cape', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 19, kind: 'Sn', name: 'Sonic', mark: 'SN', color: 'electric', subtitle: 'Homing Attack · Spin Dash · Spring Jump · Spin Charge', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 20, kind: 'Rc', name: 'Raichu', mark: 'RC', color: 'electric', subtitle: 'Jolt · Roll · Quick Attack · Thunder', provenance: 'ACE 2.0 mod fighter · Pikachu-clone specials from the compiled code' },
  { id: 21, kind: 'Lz', name: 'Charizard', mark: 'CZ', color: 'orange', subtitle: 'Flamethrower · Rock Smash · Fly · Slam', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 33, kind: 'Wf', name: 'Wolf', mark: 'WF', color: 'mint', subtitle: 'Blaster · Wolf Flash · Fire Wolf · Reflector', provenance: 'ACE 2.0 mod fighter · specials ported from its compiled m-ex code' },
  { id: 34, kind: 'Dd', name: 'Diddy Kong', mark: 'DD', color: 'coral', subtitle: 'Peanut Popgun · Monkey Flip · Rocketbarrel · Banana', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 35, kind: 'De', name: 'King Dedede', mark: 'DD', color: 'orange', subtitle: 'Inhale · Gordo Throw · Super Jump · Jet Hammer', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 36, kind: 'Wr', name: 'Wario', mark: 'W', color: 'electric', subtitle: 'Chomp · Shoulder Bash · Corkscrew · Waft', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 37, kind: 'Sh', name: 'Shadow', mark: 'SH', color: 'water', subtitle: 'Homing Attack · Spin Dash · Chaos Control · Spin Charge', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 38, kind: 'Bl', name: 'Blastoise', mark: 'BL', color: 'water', subtitle: 'Water Gun · Shell Bash · Hydro Pump · Withdraw', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 39, kind: 'Lc', name: 'Lucas', mark: 'LC', color: 'coral', subtitle: 'PK Freeze · PK Fire · PK Thunder · PSI Magnet', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 40, kind: 'Nm', name: 'Metal Sonic', mark: 'MS', color: 'mint', subtitle: 'Black Shot · Spin Dash · Overdrive · Spark Loop', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 41, kind: 'Nt', name: 'Ninten', mark: 'NT', color: 'coral', subtitle: 'Hypnosis · Slingshot · Thunder Rocket · Magnet', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 42, kind: 'Da', name: 'Daisy', mark: 'D', color: 'pink', subtitle: 'Toad · Daisy Bomber · Parasol · Turnips · Float', provenance: 'ACE 2.0 mod fighter · Peach kit on her own attributes; prototype orchestration' },
  { id: 43, kind: 'Fy', name: 'Fay', mark: 'FY', color: 'mint', subtitle: 'Blaster · Sniper · Fire Fay · Reflector', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 44, kind: 'Sc', name: 'Black Sonic', mark: 'BS', color: 'water', subtitle: 'Homing Attack · BM Dash · Spring Jump · BM Charge', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 45, kind: 'Dl', name: 'Dr. Luigi', mark: 'DL', color: 'mint', subtitle: 'Fireball · Green Missile · Super Jump Punch · Cyclone', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 46, kind: 'Kx', name: 'Knuckles', mark: 'KX', color: 'coral', subtitle: 'Homing Attack · Spin Dash · Rising Punch · Drill Charge', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 47, kind: 'Lu', name: 'Lucina', mark: 'LU', color: 'mint', subtitle: 'Shield Breaker · Dancing Blade · Dolphin Slash · Counter', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 48, kind: 'Lc2', name: 'Lucas TDX', mark: 'TX', color: 'coral', subtitle: 'PK Freeze · PK Fire · PK Thunder · PSI Magnet', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 49, kind: 'Sm', name: 'Shadow Mewtwo', mark: 'SM', color: 'water', subtitle: 'Shadow Ball · Confusion · Teleport · Disable', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 50, kind: 'Lb', name: 'Luigi & Boo', mark: 'LB', color: 'mint', subtitle: 'Fireball · Green Missile · Super Jump Punch · Cyclone', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 51, kind: 'MM', name: 'Metal Mario', mark: 'MM', color: 'coral', subtitle: 'Fireball · Cape · Super Jump · Tornado', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 52, kind: 'Sd', name: 'Skull Kid', mark: 'SK', color: 'water', subtitle: 'Remote Bomb · Spin Warp · Vanish Warp · Float', provenance: 'ACE 2.0 mod fighter · specials ported from its compiled m-ex code' },
  { id: 53, kind: 'Cn', name: 'Chun-Li', mark: 'CN', color: 'mint', subtitle: 'Kikoken · Lightning Legs · Spinning Bird Kick · Tensho Kicks', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 54, kind: 'Gk', name: 'Giga Bowser', mark: 'GB', color: 'coral', subtitle: 'Fire Breath · Koopa Klaw · Whirling Fortress · Bowser Bomb', provenance: 'ACE 2.0 mod fighter · prototype special orchestration' },
  { id: 55, kind: 'Ts', name: 'Tails', mark: 'TS', color: 'electric', subtitle: 'Tail Shot · Rolling Spin · Helicopter · Spin Charge', provenance: 'ACE 2.0 mod fighter · ported from its compiled m-ex code' },
  { id: 56, kind: 'Bf', name: 'Blood Falcon', mark: 'BF', color: 'coral', subtitle: 'Falcon Punch · Raptor Boost · Falcon Dive · Falcon Kick', provenance: 'ACE 2.0 mod fighter · Captain Falcon clone slot' },
  { id: 57, kind: 'WfU', name: 'Wolf SSBU', mark: 'WU', color: 'water', subtitle: 'Blaster · Wolf Flash · Fire Wolf · Reflector', provenance: 'ACE 2.0 mod fighter · SSBU-animated Wolf slot' },
  { id: 22, kind: 'Fc', name: 'Falco', mark: 'FC', color: 'mint', subtitle: 'Blaster · Phantasm · Fire Bird · Reflector', provenance: 'Original Melee fighter' },
  { id: 23, kind: 'Dr', name: 'Dr. Mario', mark: 'DM', color: 'coral', subtitle: 'Megavitamins · Cape · Super Jump · Tornado', provenance: 'Original Melee fighter' },
  { id: 24, kind: 'Gn', name: 'Ganondorf', mark: 'GN', color: 'water', subtitle: 'Warlock Punch · Gerudo Dragon · Dark Dive · Wizard Kick', provenance: 'Original Melee fighter' },
  { id: 25, kind: 'Pc', name: 'Pichu', mark: 'PC', color: 'electric', subtitle: 'Thunder Jolt · Skull Bash · Agility · Thunder', provenance: 'Original assets · prototype; no recoil self-damage' },
  { id: 26, kind: 'Ms', name: 'Marth', mark: 'MS', color: 'mint', subtitle: 'Shield Breaker · Dancing Blade · Dolphin Slash · Counter', provenance: 'Original Melee fighter' },
  { id: 27, kind: 'Lg', name: 'Luigi', mark: 'LG', color: 'mint', subtitle: 'Fireball · Green Missile · Super Jump Punch · Cyclone', provenance: 'Original Melee fighter' },
  { id: 28, kind: 'Pp', name: 'Ice Climbers', mark: 'IC', color: 'water', subtitle: 'Ice Shot · Squall Hammer · Belay · Blizzard', provenance: 'Original assets · Ice Climbers duo (prototype Nana partner)' },
  { id: 29, kind: 'Zd', name: 'Zelda', mark: 'ZD', color: 'water', subtitle: "Nayru's Love · Din's Fire · Farore's Wind · Transform", provenance: 'Original Melee fighter' },
  { id: 30, kind: 'Sk', name: 'Sheik', mark: 'SK', color: 'water', subtitle: 'Needles · Chain · Vanish · Transform', provenance: 'Original Melee fighter' },
  { id: 31, kind: 'Gw', name: 'Mr. Game & Watch', mark: 'GW', color: 'mint', subtitle: 'Chef · Judgment · Fire · Oil Panic', provenance: 'Original Melee fighter' },
  { id: 32, kind: 'Ys', name: 'Yoshi', mark: 'YS', color: 'mint', subtitle: 'Egg Lay · Egg Roll · Egg Throw · Yoshi Bomb', provenance: 'Original assets · prototype; no egg shield or DJ armor' },
] as const;
export const FIGHTERS: readonly { id: number; kind: FighterKind; name: string; mark: string; color: string; subtitle: string; provenance: string }[] = [
  ...BUILTIN_FIGHTERS.map(fighter => ({ ...fighter, id: ROSTER_CHOICES.indexOf(fighter.kind) })),
  ...CUSTOM_PACKS.map(pack => ({ id: ROSTER_CHOICES.indexOf(pack.kind), kind: pack.kind, name: pack.name, ...pack.menu })),
];

export interface BattleSelectProps {
  seats: readonly PlayerSeat[];
  activeSeat: number;
  onActiveSeat: (slot: number) => void;
  onFighter: (slot: number, fighter: FighterKind) => void;
  /** Skin index for a seat (visual-only); omitted when the caller cannot set skins. */
  onCostume?: (slot: number, costume: number) => void;
  onControl: (slot: number, control: SeatControl) => void;
  /** CPU intelligence 1-9 for a CPU seat; omitted when the caller cannot set levels. */
  onLevel?: (slot: number, level: CpuLevel) => void;
  canEdit: (slot: number, field: 'fighter' | 'control') => boolean;
  mode: 'local' | 'lan';
  portraits: Readonly<Record<string, string>>;
  stocks: number;
  seconds: number;
  /** King of the Hill zone rules (local matches only); null is a classic stock battle. */
  hill?: HillSetup | null;
  /** RED vs BLUE team battle (local matches only); omitted means free-for-all. */
  teams?: boolean;
  /** PROTOTYPE (zombies): last-stock KO joins the horde (local matches only). */
  zombies?: boolean;
  /** Match-item frequency (-1 off, 0-4); omit to hide the item rule (LAN rooms without item support). */
  items?: number;
  /** Item Switch selection (null = all supported); shown with `items`. */
  itemSwitches?: readonly number[] | null;
  itemPortraits?: Readonly<Record<string, string>>;
  onRules?: (patch: Partial<Pick<BattleSetup, 'stocks' | 'seconds' | 'items' | 'itemSwitches' | 'hill' | 'teams' | 'zombies'>>) => void;
  ready: boolean;
  busy?: boolean;
  onNext?: () => void;
  onBack?: () => void;
  /** Settings icons (Options / Controllers) shown at the end of the header. */
  system?: ReactNode;
  /** Phase 2.1: hover/focus prefetch so the picked fighter is loaded by match start. */
  onPreviewFighter?: (fighter: FighterKind) => void;
  /** Unified background load progress (fighters + stages + voice banks); null when ready. */
  background?: BackgroundLoad | null;
  seatNames?: Readonly<Record<number, string>>;
  readySlots?: readonly number[];
  footer?: ReactNode;
  /** Header chips beside the rule title (LAN room code, connection). */
  headerAside?: ReactNode;
  /** Footer controls before the rules (LAN leave / voice / friends). */
  footerStart?: ReactNode;
  /** Status line in the roster tray head, replacing the scope note (LAN room status). */
  note?: ReactNode;
  /** Alert toast over the roster (LAN errors); keep `.room-error` inside. */
  alert?: ReactNode;
}

function SeatToken({ slot, cursor = false }: { slot: number; cursor?: boolean }) {
  const presentation = playerPresentation(slot);
  return <span className={cursor ? 'seat-token cursor-token' : 'seat-token'} style={{ '--seat-color': presentation.css, '--seat-ink': presentation.ink } as CSSProperties} aria-hidden="true">P{slot + 1}</span>;
}

function PlayerPanel({ seat, props }: { seat: PlayerSeat; props: BattleSelectProps }) {
  const { activeSeat, onActiveSeat, onControl, onLevel, onCostume, canEdit, portraits, ready, busy, mode, seatNames, readySlots, teams } = props;
  const presentation = playerPresentation(seat.slot);
  const fighter = FIGHTERS.find(entry => entry.kind === seat.fighter)!;
  const selected = activeSeat === seat.slot;
  const locked = !canEdit(seat.slot, 'fighter') && !canEdit(seat.slot, 'control');
  const enabled = seat.control !== 'off';
  const canSkin = enabled && ready && !busy && !!onCostume && canEdit(seat.slot, 'fighter');
  const skins = costumeCount(seat.fighter);
  const skin = clampCostumeIndex(seat.fighter, seat.costume);
  const skinPortrait = portraitFor(portraits, seat.fighter, skin);
  const humanOrdinal = activeSeats(props.seats).filter(entry => entry.control === 'human').findIndex(entry => entry.slot === seat.slot);
  const localInput = humanOrdinal === 0 ? 'HUMAN · WASD' : humanOrdinal === 1 ? 'HUMAN · ARROWS' : 'HUMAN · GAMEPAD';
  const level = clampCpuLevel(seat.level);
  const status = !enabled ? 'NOT IN BATTLE' : seat.control === 'cpu' ? `CPU LV ${level} · ${CPU_LEVEL_NAMES[level].toUpperCase()}` : readySlots?.includes(seat.slot) ? 'READY' : mode === 'lan' ? 'HUMAN · CONNECTED' : localInput;
  return <article className={`player-seat${selected ? ' active-seat' : ''}${locked ? ' locked-seat' : ''}`} data-seat-id={seat.slot} data-control={seat.control} style={{ '--seat-color': presentation.css, '--seat-ink': presentation.ink } as CSSProperties} aria-label={`Player ${seat.slot + 1} setup`}>
    <div className="seat-control-strip"><span className="seat-number">P{seat.slot + 1}</span><label className="seat-kind-label"><span className="action-label">Player {seat.slot + 1} control</span><select id={`seat-kind-${seat.slot}`} value={seat.control} disabled={!ready || busy || !canEdit(seat.slot, 'control')} onChange={event => { onActiveSeat(seat.slot); onControl(seat.slot, event.target.value as SeatControl); }}>
      <option value="human" disabled={mode === 'lan' && seat.control !== 'human'}>HUMAN</option><option value="cpu">CPU</option><option value="off">OFF</option>
    </select></label>{seat.control === 'cpu' && <label className="seat-level-label"><span className="action-label">Player {seat.slot + 1} CPU level</span><select id={`seat-level-${seat.slot}`} value={level} disabled={!ready || busy || !onLevel || !canEdit(seat.slot, 'control')} onChange={event => { onActiveSeat(seat.slot); onLevel?.(seat.slot, clampCpuLevel(Number(event.target.value))); }}>
      {CPU_LEVELS.map(value => <option key={value} value={value}>LV {value}</option>)}
    </select></label>}</div>
    <button className="seat-select" id={`select-seat-${seat.slot}`} aria-label={`Select player ${seat.slot + 1}${enabled ? `: ${fighter.name}` : ': off'}`} aria-pressed={selected} disabled={!ready || busy || locked} onClick={() => onActiveSeat(seat.slot)}>
      <span className="seat-emblem" aria-hidden="true">{enabled ? 'VS' : '—'}</span>
      {enabled && skinPortrait && <img className={`seat-portrait portrait-${seat.fighter}`} src={skinPortrait} alt="" draggable={false} />}
      {enabled && !skinPortrait && <span className="seat-fallback" aria-hidden="true">{fighter.mark}</span>}
      <span className="seat-fighter-name">{enabled ? fighter.name : 'N/A'}</span>
      {enabled && isPairedSlotKind(seat.fighter) && <span className="seat-transform-hint">DOWN-B ⇄ {seat.fighter === 'Zd' ? 'SHEIK' : 'ZELDA'}</span>}
      {enabled && skins > 1 && <span className="seat-costume-strip" role="group" aria-label={`Player ${seat.slot + 1} skin`}>
        <button id={`costume-prev-${seat.slot}`} className="seat-costume-arrow" aria-label="Previous skin" disabled={!canSkin} onClick={(event) => { event.stopPropagation(); onActiveSeat(seat.slot); onCostume?.(seat.slot, (skin + skins - 1) % skins); }}>◀</button>
        <span className="seat-costume-name">{costumeName(seat.fighter, skin)}</span>
        <button id={`costume-next-${seat.slot}`} className="seat-costume-arrow" aria-label="Next skin" disabled={!canSkin} onClick={(event) => { event.stopPropagation(); onActiveSeat(seat.slot); onCostume?.(seat.slot, (skin + 1) % skins); }}>▶</button>
      </span>}
      <span className="seat-ordinal" aria-hidden="true">P{seat.slot + 1}</span>
      {selected && <SeatToken slot={seat.slot} cursor />}
    </button>
    <div className="seat-footer"><strong>{seatNames?.[seat.slot] ?? (enabled ? `PLAYER ${seat.slot + 1}` : 'OPEN SEAT')}</strong>{teams && enabled && (() => { const team = hillTeamOfSlot(seat.slot); return <span className={`seat-team seat-team-${HILL_TEAM_NAMES[team].toLowerCase()}`} style={{ '--team-color': HILL_TEAM_COLORS[team] } as CSSProperties}>{HILL_TEAM_NAMES[team]}</span>; })()}<span>{status}</span></div>
  </article>;
}

/** Pure setup UI. Parent callbacks own role authorization, room commands and RNG. */
export const BattleSelect = memo(function BattleSelect(props: BattleSelectProps) {
  const { seats, activeSeat, onFighter, canEdit, mode, portraits, stocks, seconds, hill, teams, zombies, items, itemSwitches, itemPortraits, onRules, ready, busy, onNext, onBack, footer, onPreviewFighter, background, system, headerAside, footerStart, note, alert } = props;
  const [switchOpen, setSwitchOpen] = useState(false);
  const supportedCount = SUPPORTED_MATCH_ITEMS.length;
  const enabledCount = itemSwitches === null || itemSwitches === undefined ? supportedCount : itemSwitches.length;
  const itemsSummary = items === undefined ? '' : items < 0 ? 'OFF' : `${['VERY LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY HIGH'][items]} · ${enabledCount}/${supportedCount}`;
  const active = activeSeats(seats);
  const selected = seats.find(seat => seat.slot === activeSeat);
  const editable = !!selected && selected.control !== 'off' && canEdit(activeSeat, 'fighter') && ready && !busy;
  const secondsLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  // A modded fighter (Zero) exists only when the server registered the extension disc;
  // portraits are captured per loaded roster entry, so a missing portrait means absent.
  // While the background download runs the whole roster shows (fighters still
  // loading are dimmed and not pickable yet, like the Rift champion grid) so the
  // fitted grid does not reshuffle as portraits land.
  const settled = !background && Object.keys(portraits).length > 0;
  const roster = settled ? FIGHTERS.filter(fighter => isCustomFighter(fighter.kind) || portraits[fighter.kind] !== undefined) : FIGHTERS;
  /** Portrait still on its way (the roster keeps loading in the background): the tile shows a spinner. */
  const loadingPortrait = (kind: string): boolean => !settled && !isCustomFighter(kind) && portraits[kind] === undefined;
  const pending = (kind: string): boolean => !settled && !isCustomFighter(kind) && Object.keys(portraits).length > 0 && portraits[kind] === undefined;
  // Zelda/Sheik render as one Melee roster slot: Sheik groups under Zelda's
  // card with both starting forms side by side (a lone half still renders
  // alone when a manifest lacks its counterpart).
  const slots: Array<{ key: string; entries: typeof roster }> = [];
  for (const entry of roster) {
    if (entry.kind === 'Sk' && roster.some((other) => other.kind === 'Zd')) continue;
    if (entry.kind === 'Zd') {
      const partner = roster.find((other) => other.kind === 'Sk');
      slots.push(partner ? { key: 'Zd-Sk', entries: [entry, partner] } : { key: entry.kind, entries: [entry] });
    } else slots.push({ key: entry.kind, entries: [entry] });
  }
  // Every fighter at once, sized from the free space (the Zelda/Sheik pair spans two cells).
  const [rosterRef, rosterColumns] = useFitColumns<HTMLDivElement>(slots.reduce((cells, slot) => cells + slot.entries.length, 0), 0.9, 4);
  const halfButton = (fighter: (typeof roster)[number]) => {
    const occupants = active.filter(seat => seat.fighter === fighter.kind);
    const pressed = selected?.control !== 'off' && selected?.fighter === fighter.kind;
    return <button key={fighter.kind} className={`roster-half roster-${fighter.kind}${pending(fighter.kind) ? ' is-pending' : ''}`} data-fighter={fighter.kind} aria-label={`${fighter.name} starting form · ${fighter.provenance}`} aria-pressed={pressed} disabled={!editable || pending(fighter.kind)} onClick={() => onFighter(activeSeat, fighter.kind)} onMouseEnter={() => onPreviewFighter?.(fighter.kind)} onFocus={() => onPreviewFighter?.(fighter.kind)} style={pressed ? { '--chooser-color': playerPresentation(activeSeat).css } as CSSProperties : undefined}>
      <span className={`roster-portrait${loadingPortrait(fighter.kind) ? ' is-loading' : ''}`}>{portraits[fighter.kind] ? <img src={portraits[fighter.kind]} alt="" draggable={false} /> : <span aria-hidden="true">{fighter.mark}</span>}</span><strong>{fighter.name}</strong>
      <span className="roster-assignments">{occupants.map(seat => <SeatToken key={seat.slot} slot={seat.slot} />)}</span>
      {selected?.control !== 'off' && selected?.fighter === fighter.kind && <span className="roster-cursor"><SeatToken slot={activeSeat} cursor /></span>}
    </button>;
  };
  const scopeNote = hill ? 'King of the Hill is a local prototype: stand uncontested in a zone to score, zones relocate, KOs always respawn, and CPUs fight normally without playing for the hill.' : zombies ? 'Zombies prototype: a lost last stock joins the horde with one permanent stock; the infected hunt the living and always come back, survivors win by outlasting the clock.' : teams ? 'Team battle prototype: RED (even seats) vs BLUE (odd seats); direct strikes and grabs never connect between teammates, but projectiles and items still hit everyone.' : mode === 'lan' ? 'Human seats are real browser connections. The host sets CPU levels.' : 'All-CPU battles can be watched. Human seats need assigned keyboard, touch or gamepad controls.';
  // One viewport, no scroll (like the Rift screens): header · roster that owns
  // the free space · seat strip · rules footer.
  return <section className={`battle-select play-screen play-screen-characters mode-${mode}`} aria-labelledby="character-title">
    <header className="battle-select-heading"><div className="battle-logo"><h2 id="character-title">BATTLE</h2><span className="versus-medallion">VS</span></div><div className="battle-rule-title">{hill ? `KOTH · ${hill.zones > 1 ? 'A+B' : 'A ONLY'} · ∞ LIVES` : teams ? `${stocks}-stock TEAMS` : zombies ? `${stocks}-stock ZOMBIES` : `${stocks}-stock battle`} <span>· {secondsLabel}</span></div>{headerAside}{onBack && <button className="battle-back" id="back-to-mode" onClick={onBack}>◀ BACK</button>}{system}</header>
    <div className="play-screen-body battle-select-body">
      <div className="roster-tray">
        <div className="roster-tray-head">
          <strong className="roster-mode">{mode === 'lan' ? 'MULTIPLAYER' : 'LOCAL BATTLE'}</strong>
          <span className="seat-selection-hint" role="status">{selected ? <><SeatToken slot={selected.slot} />{selected.control === 'off' ? mode === 'lan' ? 'Set this seat to CPU, or let another browser join.' : 'Set this seat to HUMAN or CPU to join the battle.' : editable ? `Choosing for player ${selected.slot + 1}` : 'This player is controlled by another browser.'}</> : 'Select a player panel.'}</span>
          <span className="roster-note" title={scopeNote}>{note ?? scopeNote}</span>
          <span className="roster-scope"><strong>{slots.length} FIGHTERS</strong>{background ? <LoadProgressBar loaded={background.loaded} total={background.total} /> : null}</span>
          <button id="random-fighter" className="secondary" disabled={!editable} title="Pick a random fighter for the active player" onClick={() => { const kind = pickRandomKind(roster.map(entry => entry.kind), selected?.fighter ?? null); if (!kind) return; onPreviewFighter?.(kind); onFighter(activeSeat, kind); }}>🎲 RANDOM</button>
        </div>
        <div className="roster-grid" ref={rosterRef} style={{ '--columns': rosterColumns } as CSSProperties} role="group" aria-label="Choose a fighter for the active player">
          {slots.map(slot => {
            if (slot.entries.length === 1) {
              const fighter = slot.entries[0]!;
              const occupants = active.filter(seat => seat.fighter === fighter.kind);
              const pressed = selected?.control !== 'off' && selected?.fighter === fighter.kind;
              return <button key={fighter.kind} className={`roster-fighter roster-${fighter.kind}${pending(fighter.kind) ? ' is-pending' : ''}`} data-fighter={fighter.kind} aria-label={`${fighter.name} · ${fighter.provenance}`} aria-pressed={pressed} disabled={!editable || pending(fighter.kind)} onClick={() => onFighter(activeSeat, fighter.kind)} onMouseEnter={() => onPreviewFighter?.(fighter.kind)} onFocus={() => onPreviewFighter?.(fighter.kind)} style={pressed ? { '--chooser-color': playerPresentation(activeSeat).css } as CSSProperties : undefined}>
                <span className={`roster-portrait${loadingPortrait(fighter.kind) ? ' is-loading' : ''}`}>{portraits[fighter.kind] ? <img src={portraits[fighter.kind]} alt="" draggable={false} /> : <span aria-hidden="true">{fighter.mark}</span>}</span><strong>{fighter.name}</strong>
                <span className="roster-assignments">{occupants.map(seat => <SeatToken key={seat.slot} slot={seat.slot} />)}</span>
                {selected?.control !== 'off' && selected?.fighter === fighter.kind && <span className="roster-cursor"><SeatToken slot={activeSeat} cursor /></span>}
              </button>;
            }
            return <div key={slot.key} className="roster-fighter roster-pair" data-fighter={slot.key} role="group" aria-label="Zelda and Sheik · one fighter, two starting forms · Down-B transforms mid-match">
              <span className="roster-pair-halves">{slot.entries.map(halfButton)}</span>
              <span className="roster-pair-caption"><strong>ZELDA ⇄ SHEIK</strong><span>ONE FIGHTER · DOWN-B SWAPS</span></span>
            </div>;
          })}
        </div>
        {alert && <div className="play-screen-alert">{alert}</div>}
      </div>
      <div className="player-seat-grid">{seats.map(seat => <PlayerPanel key={seat.slot} seat={seat} props={props} />)}</div>
    </div>
    <footer className="battle-select-footer">{footerStart}<div className="battle-rule-controls">{mode === 'local' && <label>MATCH<select id="setup-match-type" value={hill ? 'hill' : zombies ? 'zombies' : 'stock'} disabled={!ready || busy || !onRules} onChange={event => onRules?.(event.target.value === 'hill' ? { hill: { zones: 2 }, zombies: false } : event.target.value === 'zombies' ? { zombies: true, hill: null, teams: false } : { hill: null, zombies: false })}><option value="stock">STOCK</option><option value="hill">KING OF THE HILL</option><option value="zombies">ZOMBIES</option></select></label>}{hill && mode === 'local'
      ? <label>ZONES<select id="setup-hill-zones" value={hill.zones} disabled={!ready || busy || !onRules} onChange={event => onRules?.({ hill: { zones: Number(event.target.value) === 1 ? 1 : 2 } })}><option value={1}>A ONLY</option><option value={2}>A + B</option></select></label>
      : <label>STOCKS<select id="setup-stocks" value={stocks} disabled={!ready || busy || !onRules} onChange={event => onRules?.({ stocks: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 9].map(value => <option key={value} value={value}>{value}</option>)}</select></label>}{mode === 'local' && <label>TEAMS<select id="setup-teams" value={teams ? 'teams' : 'ffa'} disabled={!ready || busy || !onRules || zombies} onChange={event => onRules?.({ teams: event.target.value === 'teams' })}><option value="ffa">FREE-FOR-ALL</option><option value="teams">RED VS BLUE</option></select></label>}{hill && <span className="hill-lives-note" id="setup-hill-lives" title="Knocked out fighters always respawn">∞ LIVES</span>}<label>TIME<select id="setup-seconds" value={seconds} disabled={!ready || busy || !onRules} onChange={event => onRules?.({ seconds: Number(event.target.value) })}>{[60, 120, 180, 300].map(value => <option key={value} value={value}>{value / 60} MIN</option>)}</select></label>{items !== undefined && <label>ITEMS<button id="setup-items" className="items-switch-button" disabled={!ready || busy || !onRules} onClick={() => setSwitchOpen(true)}>{itemsSummary} ▾</button></label>}</div><div className="battle-active-count"><strong>{active.length}/{MAX_MATCH_PLAYERS}</strong><span>IN BATTLE</span></div>{footer}{onNext && <button className="battle-next" id="go-stage" disabled={!ready || busy || active.length < MIN_MATCH_PLAYERS || active.length > MAX_MATCH_PLAYERS} onClick={onNext}>CHOOSE STAGE ▶</button>}</footer>
    {switchOpen && items !== undefined && <ItemSwitch frequency={items} switches={itemSwitches ?? null} portraits={itemPortraits ?? {}} disabled={!ready || !!busy || !onRules} onRules={patch => onRules?.(patch)} onClose={() => setSwitchOpen(false)} />}
  </section>;
});
