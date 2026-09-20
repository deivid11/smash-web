import type { CSSProperties, ReactNode } from 'react';
import { FIGHTERS } from './battle-select.tsx';
import { SUPPORTED_STAGES } from '../../../lib/game/stages.ts';

/** `error` is the boot failure (view.error before ready): shown in place of the
 * loading prompt so a failed data load never reads as an endless "Loading…". */
export interface ModeSelectProps { onSolo: () => void; onLan: () => void; onRogue?: () => void; onTournament?: () => void; onHill?: () => void; onZombies?: () => void; onRoulette?: () => void; rouletteSeconds?: number; ready: boolean; busy?: boolean; error?: string; onRetry?: () => void; system?: ReactNode }

/** One banner. `emoji` marks a picture glyph so CSS can tint it to the gold of the
 * lettered symbols (VS, LAN) instead of leaving full-colour emoji in the row. */
interface ModeEntry { id: string; kind: string; symbol: string; emoji?: boolean; title: string; blurb: string; onPick: () => void }

export function ModeSelect({ onSolo, onLan, onRogue, onTournament, onHill, onZombies, onRoulette, rouletteSeconds, ready, busy, error, onRetry, system }: ModeSelectProps) {
  // Built as a list so the diagonal cascade and the fly-in beat follow --mode-index:
  // a new mode staggers with the rest instead of resetting to flush left.
  const modes: ModeEntry[] = [
    { id: 'mode-solo', kind: 'mode-local', symbol: 'VS', title: 'SOLO / LOCAL', blurb: '2–8 players · humans and CPUs', onPick: onSolo },
    { id: 'mode-lan', kind: 'mode-network', symbol: 'LAN', title: 'MULTIPLAYER', blurb: 'Connect browsers · host can add CPUs', onPick: onLan },
    ...(onTournament ? [{ id: 'mode-tournament', kind: 'mode-tournament', symbol: '🏆', emoji: true, title: 'TOURNAMENT', blurb: 'Local or LAN brackets · CPUs fill in · pause and resume', onPick: onTournament }] : []),
    ...(onHill ? [{ id: 'mode-hill', kind: 'mode-hill', symbol: '◉', title: 'KING OF THE HILL', blurb: 'Zones A+B · infinite lives · teams · prototype', onPick: onHill }] : []),
    ...(onZombies ? [{ id: 'mode-zombies', kind: 'mode-zombies', symbol: '🧟', emoji: true, title: 'ZOMBIES', blurb: 'Last stock joins the horde · prototype', onPick: onZombies }] : []),
    ...(onRoulette ? [{ id: 'mode-roulette', kind: 'mode-roulette', symbol: '🎲', emoji: true, title: 'ROULETTE CHAOS', blurb: `Quick setup · random champs every ${rouletteSeconds ?? 30} s · prototype`, onPick: onRoulette }] : []),
    ...(onRogue ? [{ id: 'mode-rogue', kind: 'mode-rogue', symbol: '◈', title: 'RIFT DESCENT', blurb: 'Solo roguelike tower · seeded · prototype', onPick: onRogue }] : []),
  ];
  return <section className="mode-select" aria-labelledby="mode-title">
    <div className="mode-game-mark" aria-hidden="true">SMASH<span>WEB</span></div>
    <h2 id="mode-title">SELECT MODE</h2>
    {/* Above the choices: on landscape phones anything below them is off-screen. */}
    {!ready && error && <div id="mode-boot-error" className="mode-prompt mode-prompt-error" role="alert"><strong>Game data failed to load</strong><span>{error}</span>{onRetry && <button id="mode-boot-retry" type="button" onClick={onRetry}>Retry</button>}</div>}
    <div className="mode-choices">
      {modes.map((mode, index) => <button key={mode.id} id={mode.id} className={`mode-choice ${mode.kind}`} style={{ '--mode-index': index } as CSSProperties} disabled={!ready || busy} onClick={mode.onPick}>
        <span className={`mode-symbol${mode.emoji ? ' mode-symbol-picture' : ''}`} aria-hidden="true">{mode.symbol}</span>
        <span className="mode-label"><strong>{mode.title}</strong><small>{mode.blurb}</small></span>
        <span className="mode-arrow" aria-hidden="true">▶</span>
      </button>)}
    </div>
    {!(!ready && error) && <p className="mode-prompt">{ready ? 'Choose a mode to set up your battle.' : 'Loading original assets…'}</p>}
    {system}
    <p className="mode-research-note">Unofficial fan project · limited porting prototype · original disc required.<br />{FIGHTERS.length} implemented fighters, {SUPPORTED_STAGES.length} stages. Not the complete Melee engine.</p>
  </section>;
}
