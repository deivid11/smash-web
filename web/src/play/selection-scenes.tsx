import type { CSSProperties, ReactNode } from 'react';
import { SUPPORTED_STAGES, stagePlayerLimit, type StageId } from '../../../lib/game/stages.ts';
import { LoadProgressBar, type BackgroundLoad } from './load-progress.tsx';
import { useFitColumns } from './fit-grid.ts';
export { FIGHTERS } from './battle-select.tsx';

/** Honest one-line card blurbs; full limitations live in lib/game/stages.ts. */
const STAGE_BLURBS: Record<StageId, string> = {
  battlefield: 'Three platforms · original blast zones',
  final: 'One main platform · no pass-through platforms',
  corneria: 'Sloped Great Fox hull · no Arwings or lasers',
  temple: 'Sloped ruins · walls and ceilings block crossings',
  stadium: 'Transforming terrain · original cycle',
  'yoshi-story': 'Three platforms · Randall hidden, Shy Guys harmless',
  'dream-land': 'Whispy tree · three platforms · no wind',
  'peach-castle': 'Tower, decks and Bills · lift frozen · Bill blasts prototype',
  onett: 'Long street and rooftops · 30% car hits with warning',
  'mute-city': 'Traveling road platform · original 60 s area cycle',
  'yoshi-island': 'Sloped island and pipes · blocks spin when struck',
  'green-greens': 'Whispy blows and drops fruit · blocks fall, break and explode',
  venom: 'Great Fox wings and hull · no dockings',
  'jungle-japes': 'Island and side platforms · Klaptrap naps',
  fourside: 'Two towers and crane base · UFO just visiting',
  brinstar: 'Organic platforms · acid stays down',
  'kongo-jungle': 'Island and high platforms · barrel quiet',
  'fountain-of-dreams': 'Base and side platforms · water still',
  'mushroom-kingdom': 'Pipes, blocks and lift · lift parked',
};

export interface StageSelectProps {
  stage: StageId;
  previews: Readonly<Record<string, string>>;
  disabled?: boolean;
  canStart?: boolean;
  onStage: (stage: StageId) => void;
  onBack: () => void;
  onStart: () => void;
  startLabel?: string;
  rulesSummary?: string;
  footer?: ReactNode;
  /** Settings icons (Options / Controllers) shown at the end of the header. */
  system?: ReactNode;
  /** Active fighter count; stages whose prototype spawn layout cannot seat it are disabled. */
  playerCount?: number;
  /** Unified background load progress (fighters + stages + voice banks); null when ready. */
  background?: BackgroundLoad | null;
  /** Header chips beside the rule title (LAN room code). */
  headerAside?: ReactNode;
  /** Footer controls before the stage name (LAN leave room). */
  footerStart?: ReactNode;
  /** Extra detail-panel content under the preview (LAN readiness list). */
  side?: ReactNode;
  /** Status line in the ready bar (LAN host / guest guidance). */
  note?: ReactNode;
  /** Alert toast over the stage grid (LAN errors); keep `.room-error` inside. */
  alert?: ReactNode;
}

export function StageSelect({ stage, previews, disabled = false, canStart = true, onStage, onBack, onStart, startLabel = 'READY TO FIGHT!', rulesSummary, footer, playerCount = 2, background, system, headerAside, footerStart, side, note, alert }: StageSelectProps) {
  const selected = SUPPORTED_STAGES.find(entry => entry.id === stage) ?? SUPPORTED_STAGES[0]!;
  // Every stage plus RANDOM at once, tiles sized from the free space (preview art is 540×300).
  const [gridRef, columns] = useFitColumns<HTMLDivElement>(SUPPORTED_STAGES.length + 1, 1.5, 8);
  const pickRandom = () => {
    if (disabled) return;
    const pool = SUPPORTED_STAGES.filter(entry => playerCount <= stagePlayerLimit(entry.id));
    const source = pool.length ? pool : SUPPORTED_STAGES;
    onStage(source[Math.floor(Math.random() * source.length)]!.id);
  };
  const tileArt = (id: StageId) => previews[id] ? <img src={previews[id]} alt="" draggable={false} /> : <svg viewBox="0 0 400 220" aria-hidden="true"><path d="M35 145H365" stroke="currentColor" strokeWidth="8" />{id === 'battlefield' && <path d="M75 101H155M245 101H325M160 57H240" stroke="currentColor" strokeWidth="6" />}</svg>;
  const limit = stagePlayerLimit(selected.id);
  // One viewport, no scroll (like the Rift screens): header · stage grid + detail panel · ready bar.
  return <section className="stage-select melee-stage-select play-screen play-screen-stages" aria-labelledby="stage-title">
    <header className="battle-select-heading"><div className="battle-logo"><h2 id="stage-title">STAGE</h2><span className="versus-medallion">VS</span></div><div className="battle-rule-title">{rulesSummary ?? 'Choose the battleground'}</div>{headerAside}<button id="back-to-characters" className="battle-back" onClick={onBack}>◀ BACK</button>{system}</header>
    <div className="play-screen-body stage-select-body">
      <div className="battle-stage-grid melee-stage-grid" ref={gridRef} style={{ '--columns': columns } as CSSProperties} role="group" aria-label="Choose stage">{SUPPORTED_STAGES.map(entry => <button className="battle-stage melee-tile" key={entry.id} data-stage={entry.id} aria-pressed={stage === entry.id} aria-label={entry.label} title={`${entry.label} — ${STAGE_BLURBS[entry.id]}`} disabled={disabled || playerCount > stagePlayerLimit(entry.id)} onClick={() => onStage(entry.id)}>
        <span className="battle-stage-image">{tileArt(entry.id)}<span className="battle-stage-selected">{stage === entry.id ? '● SELECTED' : 'STAGE'}</span></span>
        <strong>{entry.label}</strong>
      </button>)}<button className="battle-stage melee-tile melee-random" data-stage="random" aria-label="Random stage" title="Pick a random stage" disabled={disabled} onClick={pickRandom}>
        <span className="battle-stage-image melee-random-image" aria-hidden="true"><span>?</span></span>
        <strong>RANDOM</strong>
      </button></div>
      <aside className="melee-stage-detail" aria-live="polite">
        <span className="melee-preview" aria-hidden="true">{tileArt(selected.id)}</span>
        <span className="melee-info"><strong>{selected.label}</strong><span>{STAGE_BLURBS[selected.id]}</span><small className="melee-limit">{limit < 8 ? `UP TO ${limit} PLAYERS` : '2–8 PLAYERS'} · ORIGINAL MODEL, COLLISION &amp; MUSIC</small></span>
        <button className="secondary melee-random-button" disabled={disabled} onClick={pickRandom}>🎲 RANDOM</button>
        {side}
      </aside>
      {alert && <div className="play-screen-alert">{alert}</div>}
    </div>
    <footer className="stage-ready-bar">{background ? <LoadProgressBar loaded={background.loaded} total={background.total} /> : null}{footerStart}<span className="stage-ready-name">{selected.label}</span>{note && <span className="stage-ready-note">{note}</span>}{footer}<button className="battle-next" id="start-match" disabled={disabled || !canStart} onClick={onStart}>{startLabel} ▶</button></footer>
  </section>;
}
