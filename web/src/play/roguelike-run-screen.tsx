/** Rift Descent pause companion: the Melee-style camera pause stays clean and
 * only shows a small "RUN · BUILD" pill; pressing it (or I) opens a dedicated
 * full-screen run view with tabs for the build, run stats + map, the
 * permanent-unlock loadout and the current foes. Esc closes the screen back
 * to the camera pause before it can resume the match. Presentation only.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { affixById } from '../../../lib/game/roguelike/affixes.ts';
import { championRecord } from '../../../lib/game/roguelike/meta.ts';
import { aspectById, masteryProgress, MASTERY_REWARDS, relicById, relicLevel, RELIC_LEVEL_XP } from '../../../lib/game/roguelike/unlocks.ts';
import { bossById } from '../../../lib/game/roguelike/bosses.ts';
import { portraitFor } from '../../../lib/game/costumes.ts';
import type { GameSession } from './game-session.ts';
import { BuildGrid } from './roguelike-scenes.tsx';
import { fighterName, MasteryBadge } from './roguelike-loadout.tsx';
import { Art, Ui } from './roguelike-art.tsx';
import { ActMap, ActPills } from './roguelike-layout.tsx';
import type { RogueController } from './roguelike-session.ts';
import { eventById } from '../../../lib/game/roguelike/events.ts';
import { affixText, aspectText, bossText, eventText, masteryRewardText, modText, NODE_ICONS, nodeKindText, relicText, useRogueStrings } from './roguelike-text.ts';

type Tab = 'build' | 'run' | 'loadout' | 'foes';
const TABS: readonly Tab[] = ['build', 'run', 'loadout', 'foes'];

/** Small pill on the camera pause + the full-screen run view it opens. */
export function RoguePauseRun({ rogue, session }: { rogue: RogueController; session: GameSession }) {
  const { t } = useRogueStrings();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('build');
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    // Capture phase: Esc closes this screen before GameSession resumes the match.
    const keys = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.code === 'KeyI') { event.preventDefault(); setOpen((value) => !value); return; }
      if (!openRef.current) return;
      if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); return; }
      const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code);
      if (index >= 0) setTab(TABS[index]!);
    };
    window.addEventListener('keydown', keys, true);
    return () => window.removeEventListener('keydown', keys, true);
  }, []);
  if (!open) {
    return <button className="rogue-pause-pill" id="rogue-run-open" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <Art group="reward" id="boon" fallback="📜" className="rogue-ui-icon big" /> {t.runScreenOpen} <kbd>I</kbd>
    </button>;
  }
  return <RogueRunScreen rogue={rogue} session={session} tab={tab} onTab={setTab} onClose={() => setOpen(false)} />;
}

function RogueRunScreen({ rogue, session, tab, onTab, onClose }: { rogue: RogueController; session: GameSession; tab: Tab; onTab: (tab: Tab) => void; onClose: () => void }) {
  const { t } = useRogueStrings();
  const { run, plan } = rogue;
  const node = rogue.node;
  const labels: Record<Tab, string> = { build: t.tabBuild, run: t.tabRun, loadout: t.tabLoadout, foes: t.tabFoes };
  return <div className="rogue-run-screen" role="dialog" aria-modal="true" aria-labelledby="rogue-run-screen-title" id="rogue-run-screen">
    <div className="rogue-run-screen-inner">
      <header className="rogue-run-screen-head">
        <div>
          <p className="eyebrow">❚❚ {t.pausedWord} · {run.seedLabel}</p>
          <h2 id="rogue-run-screen-title">RIFT DESCENT · {t.floor} {run.row + 1}/{plan.length}{node && <small> <Art group="room" id={node.kind} fallback={NODE_ICONS[node.kind]} className="rogue-inline-art" /> {node.floor ? node.floor.stage.toUpperCase() : ''}</small>}</h2>
        </div>
        <button className="secondary rogue-run-screen-close" id="rogue-run-close" onClick={onClose}>✕ {t.backToPause} <kbd>Esc</kbd></button>
      </header>
      <nav className="rogue-run-tabs" role="tablist">
        {TABS.map((entry, index) => <button key={entry} role="tab" id={`rogue-tab-${entry}`} aria-selected={tab === entry} className={tab === entry ? 'active' : ''} onClick={() => onTab(entry)}>
          <kbd>{index + 1}</kbd> {labels[entry]}
        </button>)}
      </nav>
      <section className="rogue-run-screen-body" role="tabpanel" aria-labelledby={`rogue-tab-${tab}`}>
        {tab === 'build' && <BuildGrid rogue={rogue} />}
        {tab === 'run' && <RunTab rogue={rogue} />}
        {tab === 'loadout' && <LoadoutTab rogue={rogue} session={session} />}
        {tab === 'foes' && <FoesTab rogue={rogue} session={session} />}
      </section>
    </div>
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'gold' }) {
  return <span className={`rogue-run-stat${tone ? ` tone-${tone}` : ''}`}><b>{value}</b>{label}</span>;
}

function RunTab({ rogue }: { rogue: RogueController }) {
  const { locale, t } = useRogueStrings();
  const { run, plan } = rogue;
  const wrath = t[`${plan.difficulty}Name` as 'emberName' | 'flameName' | 'infernoName'];
  const act = Math.floor(Math.max(0, run.row) / 10);
  return <div className="rogue-run-tab rogue-run-tab-run">
    <div className="rogue-run-stats-grid">
      <Stat label={t.score} value={run.score} tone="gold" />
      <Stat label={t.floorsWord} value={`${run.cleared}/${plan.length}`} />
      <Stat label={t.livesAria} value={<><Ui id="life" fallback="♥" /> {run.lives}/{run.maxLives}</>} tone="good" />
      <Stat label={t.coinsAria} value={<><Ui id="coin" fallback="🪙" /> {run.coins}</>} tone="gold" />
      <Stat label={t.kos} value={run.kos} />
      <Stat label={t.bossesWord} value={run.bossesDown} />
      <Stat label={t.elitesWord} value={run.elitesDown} />
      <Stat label={t.flawlessWord} value={run.flawless} />
      <Stat label={t.fightsWord} value={run.fightsWon} />
      <Stat label={t.eventsWord} value={run.eventsVisited} />
      <Stat label={t.spentWord} value={<><Ui id="coin" fallback="🪙" /> {run.coinsSpent}</>} />
      <Stat label={t.rerollsAria} value={<><Ui id="reroll" fallback="🎲" /> {run.rerolls}</>} />
      <Stat label={t.defianceAria} value={<><Art group="status" id="last-stand" fallback="✝" className="rogue-ui-icon" /> {run.defiances}</>} />
      <Stat label={t.wrath} value={wrath} />
      <Stat label={t.heatName.split('·')[0]!.trim()} value={<><Ui id="heat" fallback="🔥" /> {run.heat}</>} tone={run.heat > 0 ? 'bad' : undefined} />
    </div>
    <div className="rogue-run-map">
      <ActPills act={act} cleared={run.row - 1} />
      <ActMap plan={plan} act={act} path={run.path} row={run.row} lane={run.lane} reachable={[]} />
      {run.pending.length > 0 && <p className="rogue-gifts"><strong>{t.curses}</strong> {run.pending.map((entry, index) => <span key={index} className="rogue-affix">{eventText(eventById(entry.source), locale).title} · {entry.fights}× {entry.levelShift ? `+${entry.levelShift} ${t.levelShort}` : ''}{entry.affixes.map((id) => <Art key={id} group="affix" id={id} fallback={affixById(id).icon} className="rogue-affix-art" />)}{entry.mirror ? ' 👻' : ''}</span>)}</p>}
    </div>
  </div>;
}

function LoadoutTab({ rogue, session }: { rogue: RogueController; session: GameSession }) {
  const { locale, t } = useRogueStrings();
  const view = useSyncExternalStore(session.ui.subscribe, session.ui.getSnapshot);
  const { run, meta } = rogue;
  const record = championRecord(meta, run.playerFighter);
  const progress = masteryProgress(record.xp);
  const next = MASTERY_REWARDS.find((reward) => reward.rank > progress.rank);
  const portrait = portraitFor(view.portraits, run.playerFighter, 0);
  return <div className="rogue-run-tab rogue-run-loadout">
    <div className="rogue-champion">
      <div className="rogue-champion-head">
        <span className="rogue-mini-portrait big">{portrait ? <img src={portrait} alt="" draggable={false} /> : run.playerFighter}</span>
        <span className="rogue-champion-body">
          <small>{t.championTitle}</small>
          <strong>{fighterName(run.playerFighter).toUpperCase()}</strong>
          <span className="rogue-champion-rank"><MasteryBadge rank={progress.rank} />{t.masteryRank} {progress.rank}</span>
          <span className="rogue-xp"><span style={{ width: `${progress.span === null ? 100 : Math.min(100, (progress.into / progress.span) * 100)}%` }} /></span>
          <small>{progress.span === null ? t.masteryMax : `${progress.into}/${progress.span} XP`}</small>
        </span>
      </div>
      {next && <p className="rogue-champion-next"><b>{t.nextReward} ({t.masteryRank} {next.rank}):</b> {masteryRewardText(next, locale)}</p>}
    </div>
    <div className="rogue-run-loadout-items">
      {run.aspect && <div className="rogue-run-loadout-item"><Art group="aspect" id={run.aspect.id} fallback={aspectById(run.aspect.id).icon} className="rogue-run-loadout-art" />
        <span><strong>{aspectText(aspectById(run.aspect.id), locale).name} <em>Lv{run.aspect.level}</em></strong><small>{aspectText(aspectById(run.aspect.id), locale).levels[run.aspect.level - 1]}</small></span></div>}
      {run.relics.map((relic) => {
        const xp = meta.relicXp[relic.id] ?? 0;
        const level = relicLevel(xp);
        const target = level === 1 ? RELIC_LEVEL_XP[0] : level === 2 ? RELIC_LEVEL_XP[1] : null;
        const def = relicById(relic.id);
        const text = relicText(def, locale);
        return <div key={relic.id} className="rogue-run-loadout-item rogue-loadout-relic-row"><Art group="relic" id={relic.id} fallback={def.icon} className="rogue-run-loadout-art" />
          <span><strong>{text.name} <em>Lv{relic.level}</em></strong><small>{text.levels[relic.level - 1]}</small><small className="xp">{target === null ? t.masteryMax : `${xp}/${target} ${t.relicXpWord}`}</small></span></div>;
      })}
      {!run.relics.length && !run.aspect && <p className="rogue-build-empty">{t.loadoutLede}</p>}
    </div>
  </div>;
}

function FoesTab({ rogue, session }: { rogue: RogueController; session: GameSession }) {
  const { locale, t } = useRogueStrings();
  const hud = useSyncExternalStore(session.hud.subscribe, session.hud.getSnapshot);
  const view = useSyncExternalStore(session.ui.subscribe, session.ui.getSnapshot);
  const fx = useSyncExternalStore(rogue.fx.subscribe, rogue.fx.getSnapshot);
  const node = rogue.node;
  const floor = node?.floor;
  const boss = floor?.boss ? bossById(floor.boss) : null;
  return <div className="rogue-run-tab rogue-run-tab-foes">
    <div className="rogue-foes-main">
      {node && <p className="rogue-node-kind"><Art group="room" id={node.kind} fallback={NODE_ICONS[node.kind]} className="rogue-inline-art" /> {nodeKindText(node.kind, locale)}{boss && <> · {bossText(boss, locale).name}</>}{floor?.modifier && <> · {modText(floor.modifier, locale).label}</>}</p>}
      {floor?.modifier && <p className="rogue-mod">{modText(floor.modifier, locale).detail}</p>}
      <div className="rogue-foe-grid">
        {hud.fighters.map((fighter, slot) => {
          if (slot === 0) return null;
          const portrait = fighter.kind ? portraitFor(view.portraits, fighter.kind, fighter.costume ?? 0) : undefined;
          const enraged = fx.enraged.includes(slot);
          return <div key={slot} className={`rogue-foe-card${enraged ? ' enraged' : ''}${fighter.stocks <= 0 ? ' down' : ''}`} style={{ '--fill': `${Math.min(100, fighter.percent / 1.5)}%` } as CSSProperties}>
            <span className="rogue-mini-portrait">{portrait ? <img src={portrait} alt="" draggable={false} /> : fighter.name.slice(0, 2)}</span>
            <span className="rogue-foe-card-body">
              <strong>{fighter.name.toUpperCase()}</strong>
              <small>CPU {t.levelShort}{fighter.level ?? '?'} · {'●'.repeat(Math.max(0, fighter.stocks))} · {fighter.percent}%{enraged ? ` · ${t.enraged}` : ''}</small>
              <span className="rogue-boss-gauge"><span style={{ width: `${Math.min(100, fighter.percent / 1.5)}%` }} /></span>
            </span>
          </div>;
        })}
      </div>
    </div>
    <aside className="rogue-foes-gifts">
      <h4 className="rogue-subhead">{t.foeGifts}</h4>
      {rogue.affixes.length === 0 && <p className="rogue-build-empty">{t.noGifts}</p>}
      <ul className="rogue-foe-gifts">
        {rogue.affixes.map((id) => { const text = affixText(affixById(id), locale); return <li key={id}><Art group="affix" id={id} fallback={affixById(id).icon} className="rogue-gift-art" /><span><strong>{text.name}</strong> <small>{text.detail}</small></span></li>; })}
      </ul>
    </aside>
  </div>;
}
