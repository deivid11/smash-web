import type { CSSProperties, ReactNode } from 'react';
import { activeSeats, type PlayerSeat, type SeatControl } from '../../../lib/game/setup.ts';
import { CPU_LEVELS, clampCpuLevel, type CpuLevel } from '../../../lib/game/cpu.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from '../../../lib/game/limits.ts';
import { playerPresentation } from '../../../lib/game/player-colors.ts';

export interface RouletteSetupProps {
  seats: readonly PlayerSeat[];
  onControl: (slot: number, control: SeatControl) => void;
  onLevel: (slot: number, level: CpuLevel) => void;
  stocks: number;
  seconds: number;
  items: number;
  onStocks: (stocks: number) => void;
  onSeconds: (seconds: number) => void;
  onItems: (items: number) => void;
  rouletteSeconds: number;
  onRouletteSeconds: (seconds: number) => void;
  ready: boolean;
  busy?: boolean;
  onBack: () => void;
  onNext: () => void;
  system?: ReactNode;
}
const ITEM_LABELS = ['VERY LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY HIGH'] as const;

/** Roulette quick setup: who plays, match rules and the rotation timer — then
 * NEXT opens the real stage selector, and START rolls the fighters. Local solo only. */
export function RouletteSetup({ seats, onControl, onLevel, stocks, seconds, items, onStocks, onSeconds, onItems, rouletteSeconds, onRouletteSeconds, ready, busy, onBack, onNext, system }: RouletteSetupProps) {
  const active = activeSeats(seats);
  const humans = active.filter(seat => seat.control === 'human');
  const canNext = ready && !busy && active.length >= MIN_MATCH_PLAYERS && active.length <= MAX_MATCH_PLAYERS;
  const secondsLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <section className="roulette-setup play-screen play-screen-roulette" aria-labelledby="roulette-title">
    <header className="battle-select-heading"><div className="battle-logo"><h2 id="roulette-title">ROULETTE</h2><span className="versus-medallion">🎲</span></div><div className="battle-rule-title">RANDOM CHAMPS EVERY {rouletteSeconds}s · {stocks} STOCK · {secondsLabel}</div><button className="battle-back" id="back-roulette" onClick={onBack}>◀ BACK</button>{system}</header>
    <div className="play-screen-body roulette-body">
      <p className="roulette-note">Set players and rules — NEXT picks the stage, START rolls the fighters. Humans: P1 WASD, P2 arrows, more on gamepads.</p>
      <div className="roulette-seats" role="group" aria-label="Players">
        {seats.map(seat => {
          const presentation = playerPresentation(seat.slot);
          const enabled = seat.control !== 'off';
          const ordinal = humans.findIndex(entry => entry.slot === seat.slot);
          const status = !enabled ? 'OUT' : seat.control === 'cpu' ? `CPU LV ${clampCpuLevel(seat.level)}` : ordinal === 0 ? 'HUMAN · WASD' : ordinal === 1 ? 'HUMAN · ARROWS' : 'HUMAN · GAMEPAD';
          return <div key={seat.slot} className={`roulette-seat${enabled ? '' : ' is-off'}`} data-seat-id={seat.slot} data-control={seat.control} style={{ '--seat-color': presentation.css } as CSSProperties}>
            <strong className="roulette-seat-name">P{seat.slot + 1}</strong>
            <label className="roulette-seat-control"><span className="action-label">Player {seat.slot + 1} control</span><select id={`roulette-kind-${seat.slot}`} value={seat.control} disabled={!ready || busy} onChange={event => onControl(seat.slot, event.target.value as SeatControl)}>
              <option value="human">HUMAN</option><option value="cpu">CPU</option><option value="off">OFF</option>
            </select></label>
            {seat.control === 'cpu' && <label className="roulette-seat-control"><span className="action-label">Player {seat.slot + 1} CPU level</span><select id={`roulette-level-${seat.slot}`} value={clampCpuLevel(seat.level)} disabled={!ready || busy} onChange={event => onLevel(seat.slot, clampCpuLevel(Number(event.target.value)))}>
              {CPU_LEVELS.map(value => <option key={value} value={value}>LV {value}</option>)}
            </select></label>}
            <span className="roulette-seat-status">{status}</span>
          </div>;
        })}
      </div>
      <div className="roulette-rules" role="group" aria-label="Match rules">
        <label>STOCKS<select id="roulette-stocks" value={stocks} disabled={!ready || busy} onChange={event => onStocks(Number(event.target.value))}>{[1, 2, 3, 4, 5, 9].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>TIME<select id="roulette-seconds-rule" value={seconds} disabled={!ready || busy} onChange={event => onSeconds(Number(event.target.value))}>{[60, 120, 180, 300].map(value => <option key={value} value={value}>{value / 60} MIN</option>)}</select></label>
        <label>ITEMS<select id="roulette-items" value={items} disabled={!ready || busy} onChange={event => onItems(Number(event.target.value))}><option value={-1}>OFF</option>{ITEM_LABELS.map((label, value) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>SWAP EVERY<select id="roulette-interval" value={rouletteSeconds} disabled={!ready || busy} onChange={event => onRouletteSeconds(Number(event.target.value))}><option value={10}>10 s</option><option value={30}>30 s</option><option value={60}>60 s</option></select></label>
        <span className="roulette-rules-summary">{stocks} STOCK · {secondsLabel} · SWAP {rouletteSeconds}s</span>
      </div>
    </div>
    <footer className="battle-select-footer"><div className="battle-active-count"><strong>{active.length}/{MAX_MATCH_PLAYERS}</strong><span>IN BATTLE</span></div><button className="battle-next" id="go-stage" disabled={!canNext} onClick={onNext}>CHOOSE STAGE ▶</button></footer>
  </section>;
}
