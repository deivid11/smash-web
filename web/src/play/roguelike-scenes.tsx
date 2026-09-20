/** Roguelike React scenes (blessing, act map, room intro, reward cards, events,
 * rest, shop, spoils, endings) — each one a single viewport-sized screen with
 * no document scroll (see `web/src/play/roguelike-layout.tsx`). Setup lives in
 * `web/src/play/roguelike-setup.tsx`. Presentation only: all run rules live in
 * `lib/game/roguelike/`, and match control flows through `RogueController` in
 * `web/src/play/roguelike-session.ts` into the existing `GameSession`.
 *
 * Fighter portraits (`portraits`) and stage renders (`previews`) are the same
 * runtime thumbnails the solo screens use — passed in from
 * `web/src/play/play-app.tsx`, never bundled assets.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { actOf, BOSS_LANE, type FloorPlan, type MapNode } from '../../../lib/game/roguelike/generator.ts';
import { affixById, type FoeAffixId } from '../../../lib/game/roguelike/affixes.ts';
import {
  boonById, boonValue, formatValue, maxLevelOf, shopPrice, SHOP_HEAL_PRICE, SHOP_POM_PRICE, SHOP_REMOVE_PRICE, SHOP_REROLL_PRICE,
  type OfferCard, type OwnedBoon,
} from '../../../lib/game/roguelike/boons.ts';
import { consumableById } from '../../../lib/game/roguelike/consumables.ts';
import { blessingById } from '../../../lib/game/roguelike/meta.ts';
import { eventById } from '../../../lib/game/roguelike/events.ts';
import { PATRONS } from '../../../lib/game/roguelike/patrons.ts';
import { bossById, treasureById, treasureStocks, type TreasureId } from '../../../lib/game/roguelike/bosses.ts';
import { eventOptionAvailable, runPrice } from '../../../lib/game/roguelike/run-state.ts';
import { SUPPORTED_STAGES } from '../../../lib/game/stages.ts';
import {
  affixText, blessingText, boonKindText, boonRarityText, boonText, consumableText, eventOptionText, eventText,
  aspectText, floorKindText, modText, NODE_ICONS, nodeKindDetail, nodeKindText, patronText, relicText, REWARD_ICONS, rewardText,
  bossText, toastText, treasureText, useRogueStrings, type RogueLocale,
} from './roguelike-text.ts';
import { BoonChip } from './roguelike-hud.tsx';
import { buildStats } from '../../../lib/game/roguelike/mods.ts';
import { aspectById, relicById } from '../../../lib/game/roguelike/unlocks.ts';
import { LoadoutStrip, RunReportPanel } from './roguelike-loadout.tsx';
import type { RogueController } from './roguelike-session.ts';
import { Art, ArtRefIcon, artUrl, BOSS_ART, REWARD_ART, TREASURE_ART, Ui } from './roguelike-art.tsx';
import { ActMap, ActPills, FormatBadge, RogueScreen, useFitColumns } from './roguelike-layout.tsx';
import { MirrorScreen } from './roguelike-setup.tsx';
import type { FighterKind } from '../../../lib/game/data.ts';
import './roguelike.css';
import './roguelike-screens.css';

export { RogueSetup } from './roguelike-setup.tsx';

type Images = Readonly<Record<string, string>>;

function stageLabel(id: string): string {
  return SUPPORTED_STAGES.find((stage) => stage.id === id)?.label ?? id.toUpperCase();
}

function stageArt(previews: Images, id: string, className: string): ReactNode {
  const src = previews[id];
  if (!src) return <span className={`${className} rogue-art-missing`} aria-hidden="true">{stageLabel(id)}</span>;
  return <img className={className} src={src} alt="" draggable={false} />;
}

function Portrait({ portraits, fighter, className = '' }: { portraits: Images; fighter: FighterKind; className?: string }) {
  return <span className={`rogue-mini-portrait ${className}`}>{portraits[fighter] ? <img src={portraits[fighter]} alt="" draggable={false} /> : fighter}</span>;
}

/** Compact foe list: full levels for duels/trios, a range for crowds. */
function enemySummary(floor: FloorPlan, locale: RogueLocale): string {
  const unit = locale === 'es' ? 'Nv' : 'Lv';
  const levels = floor.enemies.map((enemy) => enemy.level);
  if (levels.length <= 3) return levels.map((level) => `CPU ${unit}${level}`).join(' · ');
  const min = Math.min(...levels), max = Math.max(...levels);
  return min === max ? `${levels.length} × CPU ${unit}${min}` : `${levels.length} × CPU ${unit}${min}–${max}`;
}

function AffixIcons({ affixes }: { affixes: readonly FoeAffixId[] }) {
  const { locale, t } = useRogueStrings();
  if (affixes.length === 0) return null;
  return <p className="rogue-gifts" role="status">
    <strong>{t.foeGifts}</strong>
    {affixes.map((id) => {
      const text = affixText(affixById(id), locale);
      return <span key={id} className={`rogue-affix rogue-affix-${id}`} title={`${text.name}: ${text.detail}`}><Art group="affix" id={id} fallback={affixById(id).icon} className="rogue-affix-art" /><b>{text.name}</b></span>;
    })}
  </p>;
}

function Toast({ rogue }: { rogue: RogueController }) {
  const { locale } = useRogueStrings();
  const text = toastText(rogue.run.toast, locale, {
    boon: (id) => { try { return boonText(boonById(id), 'common', 1, locale).name; } catch { try { return treasureText(treasureById(id), locale).name; } catch { return id; } } },
    pocket: (id) => { try { return consumableText(consumableById(id), locale).name; } catch { return id; } },
  });
  if (!text) return null;
  return <p className="rogue-toast" role="status" key={rogue.run.toast}>{text}</p>;
}

function useNumberKeys(count: number, onPick: (index: number) => void): void {
  const latest = useRef(onPick);
  latest.current = onPick;
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      const index = ['1', '2', '3', '4', '5', '6'].indexOf(event.key);
      if (index >= 0 && index < count && !event.repeat && !(event.target instanceof HTMLInputElement)) latest.current(index);
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [count]);
}

// ——— Run chrome: stat strip, boon rail, build overlay ———

function RunStrip({ rogue }: { rogue: RogueController }) {
  const { locale, t } = useRogueStrings();
  const { run } = rogue;
  return <div className="rogue-runstrip" role="status">
    <span className="rogue-stat lives" title={t.livesAria}><Ui id="life" fallback="♥" /> {run.lives}/{run.maxLives}</span>
    <span className="rogue-stat" title={t.coinsAria}><Ui id="coin" fallback="🪙" /> {run.coins}</span>
    {run.rerolls > 0 && <span className="rogue-stat" title={t.rerollsAria}><Ui id="reroll" fallback="🎲" /> {run.rerolls}</span>}
    {run.defiances > 0 && <span className="rogue-stat" title={t.defianceAria}><Art group="status" id="last-stand" fallback="✝" className="rogue-ui-icon" /> {run.defiances}</span>}
    {run.heat > 0 && <span className="rogue-stat heat"><Ui id="heat" fallback="🔥" /> {run.heat}</span>}
    {run.consumables.length > 0 && <span className="rogue-stat rogue-strip-icons" title={t.consumablesGroup}>{run.consumables.map((id, index) => <Art key={`${id}-${index}`} group="item" id={id} fallback={consumableById(id).icon} className="rogue-ui-icon big" label={consumableText(consumableById(id), locale).name} />)}</span>}
    {run.treasures.length > 0 && <span className="rogue-stat rogue-strip-icons rogue-treasure-strip">{run.treasures.map((id) => <ArtRefIcon key={id} art={TREASURE_ART[id]} fallback={treasureById(id).icon} className="rogue-ui-icon big" label={treasureText(treasureById(id), locale).name} />)}</span>}
    <LoadoutStrip relics={run.relics} aspect={run.aspect} />
  </div>;
}

function BoonRail({ rogue, onBuild }: { rogue: RogueController; onBuild: () => void }) {
  const { t } = useRogueStrings();
  const { run } = rogue;
  return <div className="rogue-footrail">
    <button className="rogue-build-toggle" onClick={onBuild}><Art group="reward" id="boon" fallback="📜" className="rogue-ui-icon big" /> {t.showBuild.replace(/^📜\s*/u, '')} <b>{run.boons.length}</b></button>
    {run.boons.length > 0 && <span className="rogue-rail">{run.boons.map((boon) => <BoonChip key={boon.id} boon={boon} size="sm" />)}</span>}
  </div>;
}

function BuildOverlay({ rogue, onClose }: { rogue: RogueController; onClose: () => void }) {
  const { t } = useRogueStrings();
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', keys, true);
    return () => window.removeEventListener('keydown', keys, true);
  }, [onClose]);
  return <div className="rogue-build-overlay" role="dialog" aria-modal="true" aria-label={t.buildTitle}>
    <header><h2>{t.buildTitle}</h2><button className="battle-back rogue-back" onClick={onClose}>✕ {t.close}</button></header>
    <div className="rogue-build-overlay-body"><BuildGrid rogue={rogue} /></div>
  </div>;
}

interface BuildItem { key: string; art: ReactNode; name: string; sub: string; gains: readonly string[]; costs: readonly string[]; color: string }

/** The whole build as a fitted tile grid + a detail column (no scrolling, any build size). */
export function BuildGrid({ rogue }: { rogue: RogueController }) {
  const { locale, t } = useRogueStrings();
  const { run } = rogue;
  const items: BuildItem[] = [];
  if (run.aspect) {
    const text = aspectText(aspectById(run.aspect.id), locale);
    items.push({ key: `aspect-${run.aspect.id}`, art: <Art group="aspect" id={run.aspect.id} fallback={aspectById(run.aspect.id).icon} className="rogue-buildtile-art" />, name: text.name, sub: `${t.aspectTitle} · Lv${run.aspect.level}`, gains: [text.levels[run.aspect.level - 1] ?? ''], costs: [], color: '#ffd75e' });
  }
  for (const relic of run.relics) {
    const text = relicText(relicById(relic.id), locale);
    items.push({ key: `relic-${relic.id}`, art: <Art group="relic" id={relic.id} fallback={relicById(relic.id).icon} className="rogue-buildtile-art" />, name: text.name, sub: `${t.relicsTitle.split(' ')[0]} · Lv${relic.level}`, gains: [text.levels[relic.level - 1] ?? ''], costs: [], color: '#8fd8ff' });
  }
  for (const id of run.treasures) {
    const text = treasureText(treasureById(id), locale);
    items.push({ key: `treasure-${id}`, art: <ArtRefIcon art={TREASURE_ART[id]} fallback={treasureById(id).icon} className="rogue-buildtile-art" />, name: text.name, sub: t.treasuresTitle, gains: [text.detail], costs: [], color: '#ffcf4a' });
  }
  for (const boon of run.boons) {
    const def = boonById(boon.id);
    const text = boonText(def, boon.rarity, boon.level, locale);
    items.push({ key: `boon-${boon.id}`, art: <BoonChip boon={boon} />, name: text.name, sub: `${boonRarityText(boon.rarity, locale)} · Lv${boon.level} · ${patronText(PATRONS[def.patron], locale).name}`, gains: text.gains, costs: text.costs, color: PATRONS[def.patron].color });
  }
  const [focusKey, setFocus] = useState<string | null>(null);
  const [ref, columns] = useFitColumns<HTMLDivElement>(Math.max(1, items.length), 3.4, 6);
  const focus = items.find((item) => item.key === focusKey) ?? items[items.length - 1] ?? null;
  const stats = buildStats(rogue.build, locale === 'es');
  return <div className="rogue-buildgrid rogue-build-panel">
    {items.length === 0
      ? <p className="rogue-build-empty">{t.buildEmpty}</p>
      : <div className="rogue-buildgrid-tiles" ref={ref} style={{ '--columns': columns } as CSSProperties}>
        {items.map((item) => <button key={item.key} className={`rogue-buildtile${focus?.key === item.key ? ' focused' : ''}`} style={{ '--patron': item.color } as CSSProperties}
          onMouseEnter={() => setFocus(item.key)} onFocus={() => setFocus(item.key)} onClick={() => setFocus(item.key)}>
          {item.art}<span><strong>{item.name}</strong><small>{item.sub}</small></span>
        </button>)}
      </div>}
    <aside className="rogue-buildgrid-side">
      {focus && <div className="rogue-buildgrid-detail" style={{ '--patron': focus.color } as CSSProperties}>
        <div className="rogue-buildgrid-detail-head">{focus.art}<span><strong>{focus.name}</strong><small>{focus.sub}</small></span></div>
        {focus.gains.map((line) => <small key={line} className="gain">▲ {line}</small>)}
        {focus.costs.map((line) => <small key={line} className="cost">▼ {line}</small>)}
      </div>}
      {stats.length > 0 && <dl className="rogue-buildgrid-stats">{stats.map((stat) => <div key={stat.key} className={`tone-${stat.tone}`}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>}
    </aside>
  </div>;
}

/** Run page: stat strip in the header, boon rail + actions in the footer, toast over the body. */
function RunScreen({
  rogue, name, eyebrow, title, children, actions, className = '',
}: {
  rogue: RogueController; name: string; eyebrow?: ReactNode; title: ReactNode; children: ReactNode; actions?: ReactNode; className?: string;
}) {
  const [build, setBuild] = useState(false);
  return <>
    <RogueScreen name={name} className={`rogue-runpage ${className}`} eyebrow={eyebrow} title={title} aside={<RunStrip rogue={rogue} />}
      footer={<><BoonRail rogue={rogue} onBuild={() => setBuild(true)} />{actions && <div className="rogue-actions">{actions}</div>}</>}>
      <Toast rogue={rogue} />
      {children}
    </RogueScreen>
    {build && <BuildOverlay rogue={rogue} onClose={() => setBuild(false)} />}
  </>;
}

/** Cards sized from the body height (and width), never scrolling. */
function CardRow({ count, label, children, className = '' }: { count: number; label: string; children: ReactNode; className?: string }) {
  return <div className={`rogue-cardrow ${className}`} style={{ '--count': Math.max(1, count) } as CSSProperties} role="group" aria-label={label}><div className="rogue-cardrow-track">{children}</div></div>;
}

// ——— Blessing ———

export function RogueBlessing({ rogue, onPick }: { rogue: RogueController; onPick: (id: string) => void }) {
  const { locale, t } = useRogueStrings();
  useNumberKeys(rogue.run.blessings.length, (index) => onPick(rogue.run.blessings[index]!));
  return <RunScreen rogue={rogue} name="blessing" className="rogue-blessing-panel" eyebrow={`${t.blessingEyebrow} · ${rogue.run.seedLabel}`} title={t.blessingTitle}>
    <CardRow count={rogue.run.blessings.length} label={t.pickGroup}>
      {rogue.run.blessings.map((id, index) => {
        const def = blessingById(id);
        const text = blessingText(def, locale);
        return <button key={id} className="rogue-option rogue-card rogue-framed frame-rare rogue-blessing-card" onClick={() => onPick(id)}>
          <span className="rogue-key" aria-hidden="true">{index + 1}</span>
          <strong className="rogue-frame-ribbon">{text.name}</strong>
          <span className="rogue-frame-body">
            <Art group="blessing" id={id} fallback={def.icon} className="rogue-card-art" />
            <span className="rogue-card-detail">{text.detail}</span>
          </span>
        </button>;
      })}
    </CardRow>
  </RunScreen>;
}

// ——— Map ———

function NodeDetail({ node, rogue, portraits, previews }: { node: MapNode; rogue: RogueController; portraits: Images; previews: Images }) {
  const { locale, t } = useRogueStrings();
  const floor = node.floor;
  const patron = node.patron ? PATRONS[node.patron] : null;
  const boss = floor?.boss ? bossById(floor.boss) : null;
  return <div className={`rogue-node-detail kind-${node.kind}`} style={{ '--patron': patron?.color } as CSSProperties}>
    <div className="rogue-node-detail-top">
      {floor ? stageArt(previews, floor.stage, 'rogue-node-art') : <Art group="scene" id={node.kind === 'event' ? node.event ?? 'storm' : node.kind === 'rest' ? 'rest' : node.kind === 'shop' ? 'shop' : 'merchant'} className="rogue-node-art" />}
      <p className="rogue-node-kind"><Art group="room" id={node.kind} fallback={NODE_ICONS[node.kind]} className="rogue-inline-art" /> {nodeKindText(node.kind, locale)}{floor && <small>{stageLabel(floor.stage)}</small>}</p>
    </div>
    <div className="rogue-node-detail-body">
      {boss && floor && <p className="rogue-boss-callout"><ArtRefIcon art={BOSS_ART[boss.id]} fallback={boss.icon} className="rogue-boss-callout-art" /><b>{bossText(boss, locale).name}</b><small>{bossText(boss, locale).title} · {floor.enemies.map((enemy) => `${enemy.stocks ?? 3} ${t.bossStocks}`).join(' + ')}</small></p>}
      {!boss && <p className="rogue-node-desc">{nodeKindDetail(node.kind, locale)}</p>}
      {floor && <div className="rogue-lineup rogue-lineup-small">
        {floor.enemies.slice(0, 6).map((enemy, index) => <span key={index} className="rogue-combatant"><Portrait portraits={portraits} fighter={enemy.fighter} /><small>{t.levelShort}{enemy.level}</small></span>)}
        {floor.enemies.length > 6 && <small className="rogue-more">+{floor.enemies.length - 6}</small>}
      </div>}
      {floor && <FormatBadge floor={floor} extraFoes={rogue.run.pending.some((entry) => entry.mirror) ? 1 : 0} />}
      {floor && <AffixIcons affixes={[...new Set([...floor.affixes, ...rogue.run.pending.flatMap((entry) => entry.affixes)])]} />}
      {floor?.modifier && <p className="rogue-mod" title={modText(floor.modifier, locale).detail}><b>{modText(floor.modifier, locale).label}</b> {modText(floor.modifier, locale).detail}</p>}
      {node.reward && <p className="rogue-node-reward">
        <span className="rogue-reward-icon" aria-hidden="true">{node.reward === 'boon' && patron && node.patron ? <Art group="patron" id={node.patron} fallback={patron.icon} /> : <ArtRefIcon art={REWARD_ART[node.reward]} fallback={REWARD_ICONS[node.reward]} />}</span>
        <span><strong>{t.reward}: {rewardText(node.reward, locale)}</strong>{node.reward === 'boon' && patron && <small>{patronText(patron, locale).name} · {patronText(patron, locale).theme}</small>}</span>
      </p>}
    </div>
  </div>;
}

export function RogueMap({ rogue, onEnter, onLeave, portraits, previews }: { rogue: RogueController; onEnter: (lane: number) => void; onLeave: () => void; portraits: Images; previews: Images }) {
  const { locale, t } = useRogueStrings();
  const { run, plan } = rogue;
  const reachable = rogue.lanes;
  const [selected, setSelected] = useState<number | null>(reachable[0] ?? null);
  useEffect(() => { setSelected(reachable.includes(BOSS_LANE) && reachable.length === 1 ? BOSS_LANE : reachable[0] ?? null); }, [run.row]);
  const node = selected !== null ? plan.map[run.row]?.find((entry) => entry.lane === selected) ?? null : null;
  const bossNext = plan.map[run.row]?.length === 1;
  const bossDef = bossNext ? plan.map[run.row]?.[0]?.floor?.boss : null;
  const act = actOf(Math.max(0, run.row));
  return <RunScreen rogue={rogue} name="map" className="rogue-map-panel"
    eyebrow={`${t.act} ${act + 1}/5 · ${t.floor} ${run.row + 1}/${plan.length} · ${run.seedLabel}`}
    title={bossDef ? <><ArtRefIcon art={BOSS_ART[bossDef]} fallback={bossById(bossDef).icon} className="rogue-title-art" /> {bossText(bossById(bossDef), locale).name}</> : bossNext ? t.bossAhead : t.mapTitle}
    actions={<>
      <button className="secondary" onClick={onLeave}>{t.abandon}</button>
      <button className="battle-next rogue-option" id="rogue-enter" disabled={selected === null || !reachable.includes(selected)} onClick={() => selected !== null && onEnter(selected)}>{node ? <><Art group="room" id={node.kind} fallback={NODE_ICONS[node.kind]} className="rogue-inline-art" /> {nodeKindText(node.kind, locale)} · </> : ''}{t.enter}</button>
    </>}>
    <div className="rogue-map-main">
      <ActPills act={act} cleared={run.row - 1} />
      <ActMap plan={plan} act={act} path={run.path} row={run.row} lane={null} reachable={reachable} selected={selected} onSelect={setSelected} onEnter={onEnter} />
    </div>
    {node ? <NodeDetail node={node} rogue={rogue} portraits={portraits} previews={previews} /> : <p className="rogue-tower-hint">{t.mapHint}</p>}
  </RunScreen>;
}

// ——— Intro ———

export function RogueIntro({
  rogue, error, onFight, onLeave, portraits, previews,
}: {
  rogue: RogueController;
  error: string;
  onFight: () => void;
  onLeave: () => void;
  portraits: Images;
  previews: Images;
}) {
  const { run } = rogue;
  const floor = rogue.floor;
  const node = rogue.node!;
  const { locale, t } = useRogueStrings();
  const patron = node.patron ? PATRONS[node.patron] : null;
  const mirror = run.pending.some((entry) => entry.mirror);
  const curseLevels = run.pending.reduce((sum, entry) => sum + entry.levelShift, 0);
  const boss = floor.boss ? bossById(floor.boss) : null;
  const seconds = floor.timeSeconds + rogue.build.clockBonus;
  return <RunScreen rogue={rogue} name="intro" className={`rogue-intro-panel kind-${floor.kind}`}
    eyebrow={`${t.act} ${actOf(run.row) + 1}/5 · ${t.floor} ${run.row + 1}/${run.length}${rogue.lastOutcome === 'lose' ? ` · ${t.retrySpent}` : rogue.lastOutcome === 'draw' ? ` · ${t.drawReplay}` : ''}`}
    title={<><span className={`rogue-kind rogue-kind-${floor.kind}`}>{floorKindText(floor.kind, locale)}</span> {boss ? bossText(boss, locale).name : `${floor.kind === 'elite' ? t.elitePrefix : ''}${stageLabel(floor.stage)}`}</>}
    actions={<>
      <button className="secondary" onClick={onLeave}>{t.abandon}</button>
      <button className="battle-next" id="rogue-fight" data-pad-default onClick={onFight}>{t.fight}</button>
    </>}>
    <div className="rogue-stage-banner-wrap">
      {stageArt(previews, floor.stage, 'rogue-stage-banner')}
      <div className="rogue-banner-caption">
        {boss && <ArtRefIcon art={BOSS_ART[boss.id]} fallback={boss.icon} className="rogue-banner-boss" />}
        <strong>{boss ? bossText(boss, locale).name : stageLabel(floor.stage)}</strong>
        {boss && <small>{bossText(boss, locale).title} · {stageLabel(floor.stage)}</small>}
      </div>
    </div>
    <div className="rogue-intro-info">
      <div className="rogue-lineup rogue-versus" aria-label={`1v${floor.enemies.length}`}>
        <span className="rogue-combatant rogue-you"><Portrait portraits={portraits} fighter={run.playerFighter} className="big" /><strong>{t.you}</strong></span>
        <span className="rogue-vs" aria-hidden="true">{t.versus}</span>
        {floor.enemies.slice(0, 5).map((enemy, index) => <span key={index} className={`rogue-combatant${enemy.boss ? ' rogue-boss-combatant' : ''}`}><Portrait portraits={portraits} fighter={enemy.fighter} className={floor.enemies.length <= 2 ? 'big' : ''} /><small>{enemy.giga && enemy.fighter !== 'Gk' ? `${t.giga} · ` : ''}{t.levelShort}{Math.max(1, Math.min(9, enemy.level + curseLevels + rogue.build.levelShift))}{enemy.stocks ? ` · ${'●'.repeat(enemy.stocks)}` : ''}</small></span>)}
        {floor.enemies.length > 5 && <small className="rogue-more">+{floor.enemies.length - 5}</small>}
        {mirror && <span className="rogue-combatant rogue-echo"><Portrait portraits={portraits} fighter={run.playerFighter} className="big" /><small>👻 ECHO</small></span>}
      </div>
      <FormatBadge floor={floor} extraFoes={mirror ? 1 : 0} />
      <p className="rogue-intro-rules">{enemySummary(floor, locale)} · {floor.playerStocks + rogue.build.bonusStocks + treasureStocks(run.treasures)} {t.stocksUnit} · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}{floor.handicap > 0 && <> · +{floor.handicap}%</>}</p>
      {floor.modifier && <p className="rogue-mod" role="status"><b>{modText(floor.modifier, locale).label}</b> {modText(floor.modifier, locale).detail}</p>}
      <AffixIcons affixes={rogue.affixes} />
      {node.reward && <p className="rogue-node-reward" style={{ '--patron': patron?.color } as CSSProperties}><span className="rogue-reward-icon">{node.reward === 'boon' && patron && node.patron ? <Art group="patron" id={node.patron} fallback={patron.icon} /> : <ArtRefIcon art={REWARD_ART[node.reward]} fallback={REWARD_ICONS[node.reward]} />}</span><span><strong>{t.reward}: {rewardText(node.reward, locale)}</strong>{patron && node.reward === 'boon' && <small>{patronText(patron, locale).name}</small>}</span></p>}
      {floor.rift && <p className="rogue-mod rogue-rift" role="status">{t.riftNote}</p>}
      {error && <p className="room-error" role="alert">{error}</p>}
    </div>
  </RunScreen>;
}

/** Shown on the rogue scene while a floor's fighters/stage download before the match starts. */
export function RoguePreparing({ progress }: { progress: string }) {
  const { t } = useRogueStrings();
  return <RogueScreen name="preparing" className="rogue-preparing" title={t.preparing}>
    <div className="rogue-preparing-body" role="status" aria-live="polite">
      <Art group="patron" id="rift" fallback="🌀" className="rogue-event-icon rogue-spin" />
      <p className="rogue-lede">{progress}</p>
    </div>
  </RogueScreen>;
}

// ——— Boss spoils ———

export function RogueSpoils({ rogue, onPick }: { rogue: RogueController; onPick: (id: TreasureId) => void }) {
  const { locale, t } = useRogueStrings();
  const { run } = rogue;
  useNumberKeys(run.spoils.length, (index) => onPick(run.spoils[index]!));
  const floor = rogue.node?.floor;
  const boss = floor?.boss ? bossById(floor.boss) : null;
  return <RunScreen rogue={rogue} name="spoils" className="rogue-spoils-panel"
    eyebrow={`${t.spoilsEyebrow}${boss ? ` · ${bossText(boss, locale).name}` : ''} · ${t.act} ${actOf(run.row) + 1}/5`}
    title={<>{boss && <ArtRefIcon art={BOSS_ART[boss.id]} fallback={boss.icon} className="rogue-title-art" />} {t.spoilsTitle}</>}>
    <CardRow count={run.spoils.length} label={t.treasuresTitle}>
      {run.spoils.map((id, index) => {
        const def = treasureById(id);
        const text = treasureText(def, locale);
        return <button key={id} id={`rogue-spoil-${id}`} className="rogue-option rogue-card rogue-framed frame-legendary rogue-treasure-card" onClick={() => onPick(id)}>
          <span className="rogue-key" aria-hidden="true">{index + 1}</span>
          <strong className="rogue-frame-ribbon">{text.name}</strong>
          <span className="rogue-frame-body">
            <ArtRefIcon art={TREASURE_ART[id]} fallback={def.icon} className="rogue-card-art" />
            <span className="rogue-card-detail">{text.detail}</span>
          </span>
        </button>;
      })}
    </CardRow>
  </RunScreen>;
}

// ——— Offer cards ———

export function OfferCardView({ card, owned, index, price, poor, onPick }: { card: OfferCard; owned: readonly OwnedBoon[]; index?: number; price?: number; poor?: boolean; onPick: () => void }) {
  const { locale, t } = useRogueStrings();
  const def = boonById(card.id);
  const current = owned.find((entry) => entry.id === card.id);
  const rarity = card.type === 'boon' ? card.rarity : current?.rarity ?? 'common';
  const level = card.type === 'pom' && current ? Math.min(maxLevelOf(def), current.level + card.levels) : current?.level ?? 1;
  const text = boonText(def, rarity, level, locale);
  const delta = card.type === 'pom' && current && !def.fixed ? `${formatValue(boonValue(def, rarity, current.level))} → ${formatValue(boonValue(def, rarity, level))}` : null;
  const patron = PATRONS[def.patron];
  const [a, b] = def.duo ? [PATRONS[def.duo[0]].color, PATRONS[def.duo[1]].color] : [patron.color, patron.color];
  const tag = card.type === 'pom' ? `${t.upgrade} ${current?.level ?? 1} → ${level}` : card.type === 'remove' ? `✂ ${t.remove}` : `✦ ${t.newBoon}`;
  const patrons = def.duo ?? [def.patron];
  return <button className={`rogue-option rogue-card rogue-framed frame-${rarity} rogue-boon-card rogue-rarity-${rarity} rogue-card-${card.type} kind-${def.kind}`} style={{ '--patron': a, '--patron-b': b } as CSSProperties} disabled={poor} onClick={onPick}>
    {index !== undefined && <span className="rogue-key" aria-hidden="true">{index + 1}</span>}
    <strong className="rogue-frame-ribbon rogue-boon-name">{text.name}</strong>
    <span className="rogue-frame-body">
      <span className="rogue-card-patron">{patrons.map((id) => <Art key={id} group="patron" id={id} fallback={PATRONS[id].icon} className="rogue-patron-mini" />)} {def.duo ? t.requiresTwo : patronText(patron, locale).name}</span>
      <span className="rogue-card-art-wrap">
        <Art group="boon" id={def.id} fallback={def.icon} className="rogue-card-art rogue-boon-icon" />
        {card.type === 'pom' && <Art group="reward" id="pom" fallback="🍎" className="rogue-card-badge" />}
      </span>
      <span className="rogue-kind-tag"><Art group="rarity" id={rarity} className="rogue-gem" /> {boonRarityText(rarity, locale)} · {boonKindText(def.kind, locale).split(' · ')[0]}</span>
      <span className={`rogue-card-tag tag-${card.type}`}>{tag}</span>
      <em className="rogue-flavor">{text.flavor}</em>
      {delta && <span className="rogue-pom-delta" aria-label={`${current?.level} → ${level}`}>{delta}</span>}
      <ul className="rogue-gains">{text.gains.map((gain) => <li key={gain}>{gain}</li>)}</ul>
      {text.costs.length > 0 && <ul className="rogue-costs">{text.costs.map((cost) => <li key={cost}>{cost}</li>)}</ul>}
    </span>
    {price !== undefined && <span className="rogue-price">{poor ? `${t.need} ${price}` : `${t.buy} · ${price}`} <Ui id="coin" fallback="🪙" /></span>}
  </button>;
}

/** Many-card offers (purge a boon from a big build) as a fitted tile grid instead of a card row. */
function OfferTiles({ offers, owned, onPick }: { offers: readonly OfferCard[]; owned: readonly OwnedBoon[]; onPick: (index: number) => void }) {
  const { locale } = useRogueStrings();
  const [ref, columns] = useFitColumns<HTMLDivElement>(offers.length, 2.6, 8);
  return <div className="rogue-offer-tiles" ref={ref} style={{ '--columns': columns } as CSSProperties}>
    {offers.map((card, index) => {
      const def = boonById(card.id);
      const entry = owned.find((boon) => boon.id === card.id);
      const text = boonText(def, entry?.rarity ?? 'common', entry?.level ?? 1, locale);
      return <button key={`${card.type}-${card.id}`} className={`rogue-option rogue-offer-tile rogue-rarity-${entry?.rarity ?? 'common'} rogue-card-${card.type}`} onClick={() => onPick(index)} title={[...text.gains, ...text.costs].join('\n')}>
        {entry && <BoonChip boon={entry} />}
        <span><strong>{text.name}</strong><small>{text.gains[0]}</small></span>
      </button>;
    })}
  </div>;
}

export function RogueReward({ rogue, onPick, onReroll, onSkip }: { rogue: RogueController; onPick: (index: number) => void; onReroll: () => void; onSkip: () => void }) {
  const { t } = useRogueStrings();
  const { run } = rogue;
  useNumberKeys(run.offers.length, onPick);
  const first = run.offers[0];
  const chaos = first?.type === 'boon' && boonById(first.id).patron === 'chaos';
  const title = !first ? t.rewardTitleBoon : first.type === 'pom' ? t.rewardTitlePom : first.type === 'remove' ? t.rewardTitleRemove : chaos ? t.rewardTitleChaos : run.offerSource === 'treasure' ? t.rewardTitleTreasure : t.rewardTitleBoon;
  const shopSub = run.offerSource === 'shop-pom' || run.offerSource === 'shop-remove';
  const canReroll = run.offers.length > 0 && run.offers.every((card) => card.type === 'boon') && run.rerolls > 0 && !!run.offerSpec;
  return <RunScreen rogue={rogue} name="reward" className={`rogue-boon-panel${chaos ? ' chaos' : ''}`} eyebrow={`${t.rewardEyebrow} · ${run.score} ${t.pts}`} title={title}
    actions={<>
      <button className="secondary" id="rogue-skip" onClick={onSkip}>{shopSub ? t.cancel : t.skipCoins}</button>
      {run.offers.some((card) => card.type === 'boon') && <button className="secondary" id="rogue-reroll" disabled={!canReroll} onClick={onReroll}><Ui id="reroll" fallback="🎲" /> {t.reroll} · {run.rerolls}</button>}
    </>}>
    {run.offers.length > 4
      ? <OfferTiles offers={run.offers} owned={run.boons} onPick={onPick} />
      : <CardRow count={run.offers.length} label={t.pickGroup}>
        {run.offers.map((card, index) => <OfferCardView key={`${card.type}-${card.id}`} card={card} owned={run.boons} index={index} onPick={() => onPick(index)} />)}
      </CardRow>}
  </RunScreen>;
}

// ——— Event / Rest ———

/** Painted event scene with a soft vignette; falls back to the floating emoji. */
function SceneArt({ id, fallback, className = '' }: { id: string; fallback: string; className?: string }) {
  const src = artUrl('scene', id);
  if (!src) return <span className={`rogue-event-icon ${className}`} aria-hidden="true">{fallback}</span>;
  return <div className={`rogue-scene-banner ${className}`} aria-hidden="true"><img src={src} alt="" draggable={false} /></div>;
}

export function RogueEvent({ rogue, onOption, onContinue }: { rogue: RogueController; onOption: (id: string) => void; onContinue: () => void }) {
  const { locale, t } = useRogueStrings();
  const event = eventById(rogue.run.event!.id);
  const text = eventText(event, locale);
  const settled = rogue.run.event!.outcome !== null;
  return <RunScreen rogue={rogue} name="event" className="rogue-event-panel" eyebrow={`${t.eventEyebrow} · ${t.floor} ${rogue.run.row + 1}`} title={text.title}
    actions={settled ? <button className="battle-next rogue-option" id="rogue-continue" data-pad-default onClick={onContinue}>{t.continue}</button> : undefined}>
    <SceneArt id={event.id} fallback={event.icon} />
    <div className="rogue-event-side">
      <p className="rogue-event-text">{text.text}</p>
      {!settled && <div className="rogue-event-options">
        {event.options.map((option) => {
          const label = eventOptionText(event, option, locale);
          const ok = eventOptionAvailable(rogue.run, option.id);
          return <button key={option.id} className={`rogue-option rogue-event-option${option.id === 'leave' ? ' leave' : ''}`} disabled={!ok} onClick={() => onOption(option.id)}>
            <strong>{label.label}</strong>
            <small>{ok ? label.detail : `${label.detail} · ${t.unavailable}`}</small>
          </button>;
        })}
      </div>}
    </div>
  </RunScreen>;
}

export function RogueRest({ rogue, error, onHeal, onTemper }: { rogue: RogueController; error: string; onHeal: () => void; onTemper: () => void }) {
  const { t } = useRogueStrings();
  const canTemper = rogue.run.boons.some((entry) => !boonById(entry.id).fixed && entry.level < maxLevelOf(boonById(entry.id)));
  useNumberKeys(2, (index) => { if (index === 0) onHeal(); else if (canTemper) onTemper(); });
  return <RunScreen rogue={rogue} name="rest" className="rogue-rest-panel" eyebrow={`${t.restEyebrow} · ${t.floor} ${rogue.run.row + 1}`} title={t.restTitle}>
    <SceneArt id="rest" fallback="🔥" className="rogue-campfire-scene" />
    <div className="rogue-event-side">
      <p className="rogue-event-text">{t.restLede}</p>
      <CardRow count={2} label={t.restTitle}>
        <button className="rogue-option rogue-card rogue-framed frame-common rogue-rest-card" id="rogue-rest-heal" onClick={onHeal}><span className="rogue-key" aria-hidden="true">1</span><strong className="rogue-frame-ribbon">{t.restHeal}</strong><span className="rogue-frame-body"><Art group="ui" id="life" fallback="❤" className="rogue-card-art" /><span className="rogue-card-detail">{t.restHealDetail}</span></span></button>
        <button className="rogue-option rogue-card rogue-framed frame-common rogue-rest-card" id="rogue-rest-temper" disabled={!canTemper} onClick={onTemper}><span className="rogue-key" aria-hidden="true">2</span><strong className="rogue-frame-ribbon">{t.restTemper}</strong><span className="rogue-frame-body"><Art group="reward" id="pom" fallback="🔨" className="rogue-card-art" /><span className="rogue-card-detail">{t.restTemperDetail}</span></span></button>
      </CardRow>
      {error && <p className="room-error" role="alert">{error}</p>}
    </div>
  </RunScreen>;
}

// ——— Shop ———

export function RogueShop({
  rogue, error, onBuyCard, onBuyPocket, onHeal, onPom, onRemove, onReroll, onLeave,
}: {
  rogue: RogueController;
  error: string;
  onBuyCard: (index: number) => void;
  onBuyPocket: (index: number) => void;
  onHeal: () => void;
  onPom: () => void;
  onRemove: () => void;
  onReroll: () => void;
  onLeave: () => void;
}) {
  const { run } = rogue;
  const shop = run.shop!;
  const { locale, t } = useRogueStrings();
  const healFull = run.lives >= run.maxLives;
  const canPom = run.boons.some((entry) => !boonById(entry.id).fixed && entry.level < maxLevelOf(boonById(entry.id)));
  const price = (base: number): ReactNode => <>{runPrice(run, base)} <Ui id="coin" fallback="🪙" /></>;
  return <RunScreen rogue={rogue} name="shop" className="rogue-shop-panel" eyebrow={shop.antechamber ? t.antechamberEyebrow : t.shopEyebrow} title={t.shopTitle.replace(/^⚱\s*/u, '')}
    actions={<>
      <button className="secondary" id="rogue-reroll" disabled={shop.rerolled || run.coins < runPrice(run, SHOP_REROLL_PRICE)} onClick={onReroll}><Ui id="reroll" fallback="🎲" /> {t.reroll} · {price(SHOP_REROLL_PRICE)}</button>
      <button className="battle-next" id="rogue-shop-leave" onClick={onLeave}>{shop.antechamber ? `${t.bossAhead} · ` : ''}{t.leave}</button>
    </>}>
    <CardRow count={3} label={t.shopTitle}>
      {shop.cards.map((card, index) => card
        ? <OfferCardView key={`${card.id}-${index}`} card={card} owned={run.boons} price={runPrice(run, shopPrice(card))} poor={run.coins < runPrice(run, shopPrice(card))} onPick={() => onBuyCard(index)} />
        : <div key={`sold-${index}`} className="rogue-card rogue-sold">{t.soldOut}</div>)}
    </CardRow>
    <div className="rogue-shop-services">
      {shop.pockets.map((id, index) => {
        if (!id) return <div key={`pocket-${index}`} className="rogue-service rogue-sold">{t.soldOut}</div>;
        const def = consumableById(id);
        const text = consumableText(def, locale);
        const full = run.consumables.length >= run.pockets;
        return <button key={`pocket-${index}`} className="rogue-option rogue-service" disabled={full || run.coins < runPrice(run, def.price)} onClick={() => onBuyPocket(index)} title={text.detail}>
          <Art group="item" id={id} fallback={def.icon} className="rogue-card-icon" /><span><strong>{text.name}</strong><small>{text.detail}</small></span>
          <span className="rogue-price">{full ? t.pocketsFull : price(def.price)}</span>
        </button>;
      })}
      <button className="rogue-option rogue-service" disabled={shop.healed || healFull || run.coins < runPrice(run, SHOP_HEAL_PRICE)} onClick={onHeal} title={t.healDetail}>
        <Art group="ui" id="life" fallback="💖" className="rogue-card-icon" /><span><strong>{t.healName}</strong><small>{t.healDetail}</small></span>
        <span className="rogue-price">{shop.healed ? t.soldOut : healFull ? t.healFull : price(SHOP_HEAL_PRICE)}</span>
      </button>
      <button className="rogue-option rogue-service" disabled={shop.pomBought || !canPom || run.coins < runPrice(run, SHOP_POM_PRICE)} onClick={onPom} title={t.pomDetail}>
        <Art group="reward" id="pom" fallback="🍎" className="rogue-card-icon" /><span><strong>{t.pomName}</strong><small>{t.pomDetail}</small></span>
        <span className="rogue-price">{shop.pomBought ? t.soldOut : price(SHOP_POM_PRICE)}</span>
      </button>
      <button className="rogue-option rogue-service" disabled={shop.removed || run.boons.length === 0 || run.coins < runPrice(run, SHOP_REMOVE_PRICE)} onClick={onRemove} title={t.removeDetail}>
        <span className="rogue-card-icon rogue-card-glyph" aria-hidden="true">✂</span><span><strong>{t.removeName}</strong><small>{t.removeDetail}</small></span>
        <span className="rogue-price">{shop.removed ? t.soldOut : price(SHOP_REMOVE_PRICE)}</span>
      </button>
      {error && <p className="room-error" role="alert">{error}</p>}
    </div>
  </RunScreen>;
}

// ——— End ———

export function RogueEnd({
  rogue, victory, onRetry, onNewSeed, onLeave,
}: {
  rogue: RogueController;
  victory: boolean;
  onRetry: () => void;
  onNewSeed: () => void;
  onLeave: () => void;
}) {
  const { run } = rogue;
  const { t } = useRogueStrings();
  const [mirror, setMirror] = useState(false);
  const [build, setBuild] = useState(false);
  if (mirror) return <MirrorScreen onDone={() => setMirror(false)} />;
  return <>
    <RogueScreen name="end" className={`rogue-end-panel${victory ? ' victory' : ' defeat'}`} eyebrow={`${victory ? t.endVictoryEyebrow : t.endDefeatEyebrow} · ${t.seed} ${run.seedLabel}`}
      title={<><Art group={victory ? 'mastery' : 'room'} id={victory ? '8' : 'boss'} className="rogue-title-art" /> {(victory ? t.endVictory : t.endDefeat).replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '')}</>}
      footer={<>
        <button className="secondary" onClick={onLeave}>{t.modes}</button>
        <button className="secondary" onClick={() => setBuild(true)}>{t.finalBuild}</button>
        <button className="secondary" onClick={() => setMirror(true)}>{t.mirrorOpen.replace(/^🪞\s*/u, '')} · <Ui id="shards" fallback="💠" /> {rogue.meta.shards}</button>
        <button className="secondary" id="rogue-new-seed" onClick={onNewSeed}>{t.newSeed}</button>
        <button className="battle-next" id="rogue-retry" data-pad-default onClick={onRetry}>{t.retrySeed}</button>
      </>}>
      <div className="rogue-end-stats">
        <span><b><Ui id="score" fallback="★" /> {run.score}</b>{t.score}</span>
        <span><b>{run.cleared}/{run.length}</b>{t.floorsWord}</span>
        <span><b>{run.bossesDown}</b>{t.bossesWord}</span>
        <span><b>{run.kos}</b>{t.kos}</span>
        <span><b>{run.flawless}</b>{t.flawlessWord}</span>
        {rogue.shardsEarned !== null && <span className="shards"><b><Ui id="shards" fallback="💠" /> +{rogue.shardsEarned}</b>{t.shardsEarned}</span>}
        {rogue.best && <span className="best"><b>{rogue.best.score}</b>{t.best}</span>}
      </div>
      {rogue.report ? <RunReportPanel report={rogue.report} /> : <div />}
      <div className="rogue-end-build">
        <h3 className="rogue-subhead">{t.finalBuild}</h3>
        <div className="rogue-rail">{run.boons.map((boon) => <BoonChip key={boon.id} boon={boon} />)}</div>
        <LoadoutStrip relics={run.relics} aspect={run.aspect} />
      </div>
    </RogueScreen>
    {build && <BuildOverlay rogue={rogue} onClose={() => setBuild(false)} />}
  </>;
}
