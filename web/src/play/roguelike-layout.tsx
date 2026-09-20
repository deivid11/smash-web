/** Rift Descent screen scaffolding: every rogue screen is one viewport-sized
 * page (header · body · footer) with no document scroll, like the home and
 * battle menus. Shared pieces live here so setup, run and pause screens use
 * the same frame, the same horizontal act map and the same fit-to-space grids.
 * Presentation only — run rules stay in `lib/game/roguelike/`.
 */
import type { CSSProperties, ReactNode } from 'react';
import { ACT_SIZE, floorVersus, type FloorPlan, type GeneratedRun } from '../../../lib/game/roguelike/generator.ts';
import { BOSSES } from '../../../lib/game/roguelike/bosses.ts';
import { PATRONS } from '../../../lib/game/roguelike/patrons.ts';
import { Art, ArtRefIcon, BOSS_ART, REWARD_ART } from './roguelike-art.tsx';
import { bossText, NODE_ICONS, nodeKindText, REWARD_ICONS, rewardText, useRogueStrings, type RogueStrings } from './roguelike-text.ts';

/** One full-viewport rogue page: compact header (eyebrow, title, aside), a body that owns the free space, optional footer bar. */
export function RogueScreen({
  name, eyebrow, title, aside, children, footer, className = '', back,
}: {
  name: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Header back button (B / Escape target through `.battle-back`). */
  back?: { label: string; onClick: () => void; id?: string };
}) {
  const titleId = `rogue-${name}-title`;
  return <section className={`rogue-screen rogue-screen-${name} ${className}`} aria-labelledby={titleId}>
    <header className="rogue-screen-head">
      {back && <button className="battle-back rogue-back" id={back.id} onClick={back.onClick}>◀ {back.label}</button>}
      <div className="rogue-screen-titles">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={titleId}>{title}</h2>
      </div>
      {aside && <div className="rogue-screen-aside">{aside}</div>}
    </header>
    <div className="rogue-screen-body">{children}</div>
    {footer && <footer className="rogue-screen-foot">{footer}</footer>}
  </section>;
}

type Matchup = Pick<FloorPlan, 'enemies' | 'format' | 'modifier'>;
/** Short matchup tag for the fight chip: `2v1` for allied rivals, `FFA` for a free-for-all. */
export function versusTag(floor: Matchup, extraFoes: number, t: RogueStrings): string {
  const { format, foes } = floorVersus(floor, extraFoes);
  return format === 'ffa' ? t.formatFfaShort : `${foes}v1`;
}
/** Matchup badge: 1 VS 1, N VS 1 (rivals are a team and never hit each other) or FREE-FOR-ALL. */
export function FormatBadge({ floor, extraFoes = 0 }: { floor: Matchup; extraFoes?: number }) {
  const { t } = useRogueStrings();
  const { format, foes } = floorVersus(floor, extraFoes);
  const label = format === 'duel' ? t.formatDuel : format === 'team' ? t.formatTeam.replace('{n}', String(foes)) : t.formatFfa;
  const detail = format === 'duel' ? t.formatDuelDetail : format === 'team' ? t.formatTeamDetail : t.formatFfaDetail;
  return <p className={`rogue-format format-${format}`} data-format={format} title={detail}><b>{label}</b> <span>{detail}</span></p>;
}

export function Locale() {
  const { locale, setLocale, t } = useRogueStrings();
  return <div className="rogue-locale" role="group" aria-label={t.languageName}>
    <button id="rogue-locale-en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
    <button id="rogue-locale-es" aria-pressed={locale === 'es'} onClick={() => setLocale('es')}>ES</button>
  </div>;
}

/** Shared with the battle roster and stage select (web/src/play/fit-grid.ts). */
export { useFitColumns } from './fit-grid.ts';

/** Act progress pills: five acts, each capped by its boss. */
export function ActPills({ act, cleared = -1 }: { act: number; cleared?: number }) {
  const { locale, t } = useRogueStrings();
  return <div className="rogue-act-pills" aria-label={`${t.act} ${act + 1}/5`}>
    {BOSSES.map((boss, index) => <span key={boss.id} className={`rogue-act-pill${index === act ? ' now' : ''}${(index + 1) * ACT_SIZE - 1 < cleared ? ' done' : ''}`} title={bossText(boss, locale).name}>
      <ArtRefIcon art={BOSS_ART[boss.id]} fallback={boss.icon} />
      <b>{t.actMap} {index + 1}</b>
    </span>)}
  </div>;
}

/** Slay the Spire-style map for ONE act, laid out left → right so it fits a
 * landscape screen: 10 floors across, 3 lanes down, the boss on the right. */
export function ActMap({
  plan, act, path, row, lane, reachable, selected, onSelect, onEnter, compact = false,
}: {
  plan: GeneratedRun;
  act: number;
  path: readonly number[];
  row: number;
  lane: number | null;
  reachable: readonly number[];
  selected?: number | null;
  onSelect?: (lane: number) => void;
  onEnter?: (lane: number) => void;
  compact?: boolean;
}) {
  const { locale } = useRogueStrings();
  const first = act * ACT_SIZE;
  const rows = plan.map.slice(first, Math.min(plan.length, first + ACT_SIZE));
  const columns = rows.length;
  const x = (r: number): number => ((r - first + 0.5) / columns) * 100;
  const y = (laneIndex: number): number => 18 + laneIndex * 32;
  const taken = (r: number): number | null => (r < row ? (path[r] ?? null) : r === row ? lane : null);
  const edges: ReactNode[] = [];
  rows.forEach((nodes) => {
    for (const node of nodes) {
      const r = node.row;
      if (r + 1 >= first + columns) continue;
      for (const next of node.next) {
        const walked = taken(r) === node.lane && taken(r + 1) === next;
        const open = r === row - 1 && path[r] === node.lane && reachable.includes(next);
        edges.push(<line key={`${r}-${node.lane}-${next}`} x1={x(r)} y1={y(node.lane)} x2={x(r + 1)} y2={y(next)} className={walked ? 'walked' : open ? 'open' : ''} />);
      }
    }
  });
  return <div className={`rogue-actmap${compact ? ' compact' : ''}`}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{edges}</svg>
    {rows.map((nodes) => nodes.map((node) => {
      const r = node.row;
      const isReachable = r === row && lane === null && reachable.includes(node.lane);
      const isTaken = taken(r) === node.lane;
      const past = r < row && !isTaken;
      const reward = node.reward && node.kind !== 'boss'
        ? (node.reward === 'boon' && node.patron ? <Art group="patron" id={node.patron} fallback={PATRONS[node.patron].icon} /> : <ArtRefIcon art={REWARD_ART[node.reward]} fallback={REWARD_ICONS[node.reward]} />)
        : null;
      const style = { left: `${x(r)}%`, top: `${y(node.lane)}%`, '--patron': node.patron ? PATRONS[node.patron].color : undefined } as CSSProperties;
      const className = `rogue-node kind-${node.kind}${isReachable ? ' reachable' : ''}${isTaken ? ' taken' : ''}${past ? ' past' : ''}${selected === node.lane && r === row ? ' selected' : ''}${r === row && lane === node.lane ? ' here' : ''}`;
      const label = `${nodeKindText(node.kind, locale)}${node.reward ? ` · ${rewardText(node.reward, locale)}` : ''}`;
      const token = <Art group="room" id={node.kind} fallback={NODE_ICONS[node.kind]} className="rogue-node-token" />;
      if (compact || !onSelect) {
        return <span key={`${r}-${node.lane}`} className={className} style={style} title={label}>{token}{reward && <small>{reward}</small>}</span>;
      }
      // The selected room is the controller's starting cursor: D-pad switches rooms, A enters.
      return <button key={`${r}-${node.lane}`} className={className} style={style} aria-label={label} disabled={!isReachable}
        data-lane={node.lane} data-row={r} data-pad-default={isReachable && selected === node.lane ? '' : undefined}
        onFocus={() => onSelect(node.lane)}
        onMouseEnter={() => isReachable && onSelect(node.lane)}
        onClick={() => { if (selected === node.lane) onEnter?.(node.lane); else onSelect(node.lane); }}
        onDoubleClick={() => onEnter?.(node.lane)}>
        {token}{reward && <small>{reward}</small>}
      </button>;
    }))}
    <span className="rogue-actmap-floors" aria-hidden="true">{rows.map((nodes, index) => <i key={index} style={{ left: `${x(nodes[0]!.row)}%` }}>{nodes[0]!.row + 1}</i>)}</span>
  </div>;
}
