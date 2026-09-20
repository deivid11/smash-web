/** Rift Descent in-fight HUD: run panel with boon rail, boss/elite bars,
 * pocket hotkeys, floating combat popups, per-fighter status chips and the
 * pause-screen build viewer. Presentation only — it reads the run controller
 * (`web/src/play/roguelike-session.ts`), the session HUD store and the live
 * `LocalMatch` fields (`poison`, `hex`, `rogue`) without ever writing sim state
 * (pocket use goes through the controller like before).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { boonById, type OwnedBoon } from '../../../lib/game/roguelike/boons.ts';
import { affixById } from '../../../lib/game/roguelike/affixes.ts';
import { consumableById, type ConsumableId } from '../../../lib/game/roguelike/consumables.ts';
import { buildStats } from '../../../lib/game/roguelike/mods.ts';
import { PATRONS, type PatronId } from '../../../lib/game/roguelike/patrons.ts';
import { bossById, treasureById } from '../../../lib/game/roguelike/bosses.ts';
import { actOf, floorVersus } from '../../../lib/game/roguelike/generator.ts';
import { versusTag } from './roguelike-layout.tsx';
import type { GameSession } from './game-session.ts';
import type { RogueController, RoguePopup } from './roguelike-session.ts';
import { LoadoutSheet } from './roguelike-loadout.tsx';
import { Art, ArtRefIcon, BOSS_ART, TREASURE_ART, Ui, type ArtRef } from './roguelike-art.tsx';
import {
  affixText, bossText, boonRarityText, boonText, consumableText, NODE_ICONS, patronText, treasureText, useRogueStrings,
} from './roguelike-text.ts';

const duoColors = (boon: OwnedBoon): [string, string] => {
  const def = boonById(boon.id);
  return def.duo ? [PATRONS[def.duo[0]].color, PATRONS[def.duo[1]].color] : [PATRONS[def.patron].color, PATRONS[def.patron].color];
};

/** Compact boon token: patron ring, rarity frame, level pips, tooltip. */
export function BoonChip({ boon, size = 'md' }: { boon: OwnedBoon; size?: 'sm' | 'md' }) {
  const { locale } = useRogueStrings();
  const def = boonById(boon.id);
  const text = boonText(def, boon.rarity, boon.level, locale);
  const [a, b] = duoColors(boon);
  return <span className={`rogue-chip rogue-chip-${size} rogue-rarity-${boon.rarity}`} style={{ '--patron': a, '--patron-b': b } as CSSProperties} title={`${text.name} · ${boonRarityText(boon.rarity, locale)} Lv${boon.level}\n${[...text.gains.map((line) => `▲ ${line}`), ...text.costs.map((line) => `▼ ${line}`)].join('\n')}`} aria-label={`${text.name} level ${boon.level}`}>
    <Art group="boon" id={def.id} fallback={def.icon} className="rogue-chip-icon" />
    {boon.level > 1 && <span className="rogue-chip-level" aria-hidden="true">{boon.level}</span>}
  </span>;
}

/** Full build sheet grouped by patron, with every live stat. */
export function BuildPanel({ rogue, showRun = true }: { rogue: RogueController; showRun?: boolean }) {
  const { locale, t } = useRogueStrings();
  const { run } = rogue;
  const groups = useMemo(() => {
    const map = new Map<PatronId, OwnedBoon[]>();
    for (const boon of run.boons) {
      const patron = boonById(boon.id).patron;
      map.set(patron, [...(map.get(patron) ?? []), boon]);
    }
    return [...map.entries()];
  }, [run.boons]);
  const stats = buildStats(rogue.build, locale === 'es');
  const affixes = rogue.inFight || run.phase === 'intro' ? rogue.affixes : [];
  return <div className="rogue-build-panel">
    {showRun && <div className="rogue-build-run" role="status">
      <span className="rogue-stat" title={t.livesAria}><Ui id="life" fallback="♥" /> {run.lives}/{run.maxLives}</span>
      <span className="rogue-stat" title={t.coinsAria}><Ui id="coin" fallback="🪙" /> {run.coins}</span>
      {run.defiances > 0 && <span className="rogue-stat" title={t.defianceAria}><Art group="status" id="last-stand" fallback="✝" className="rogue-ui-icon" /> {run.defiances}</span>}
      <span className="rogue-stat" title={t.rerollsAria}><Ui id="reroll" fallback="🎲" /> {run.rerolls}</span>
      <span className="rogue-stat">{t.kos} {run.kos}</span>
      <span className="rogue-stat"><Ui id="score" fallback="★" /> {run.score}</span>
      {run.heat > 0 && <span className="rogue-stat"><Ui id="heat" fallback="🔥" /> {run.heat}</span>}
    </div>}
    <LoadoutSheet relics={run.relics} aspect={run.aspect} rank={run.championRank} />
    {run.treasures.length > 0 && <section className="rogue-build-group rogue-build-treasures" style={{ '--patron': '#ffd75e' } as CSSProperties}>
      <h4><Art group="room" id="treasure" fallback="🏆" className="rogue-h4-art" /> {t.treasuresTitle}</h4>
      <ul>{run.treasures.map((id) => { const def = treasureById(id); const text = treasureText(def, locale); return <li key={id} className="rogue-build-boon"><span className="rogue-chip rogue-chip-sm rogue-rarity-legendary" style={{ '--patron': '#ffd75e', '--patron-b': '#ff9a4a' } as CSSProperties}><ArtRefIcon art={TREASURE_ART[id]} fallback={def.icon} className="rogue-chip-icon" /></span><span className="rogue-build-boon-body"><strong>{text.name}</strong><small className="gain">▲ {text.detail}</small></span></li>; })}</ul>
    </section>}
    {groups.length === 0 && <p className="rogue-build-empty">{t.buildEmpty}</p>}
    {groups.map(([patronId, boons]) => {
      const patron = PATRONS[patronId];
      const ptext = patronText(patron, locale);
      return <section key={patronId} className="rogue-build-group" style={{ '--patron': patron.color } as CSSProperties}>
        <h4><Art group="patron" id={patronId} fallback={patron.icon} className="rogue-h4-art" /> {ptext.name} <small>{ptext.title}</small></h4>
        <ul>{boons.map((boon) => {
          const def = boonById(boon.id);
          const text = boonText(def, boon.rarity, boon.level, locale);
          return <li key={boon.id} className={`rogue-build-boon rogue-rarity-${boon.rarity}`}>
            <BoonChip boon={boon} size="sm" />
            <span className="rogue-build-boon-body">
              <strong>{text.name} <em>{boonRarityText(boon.rarity, locale)} · Lv{boon.level}</em></strong>
              {text.gains.map((line) => <small key={line} className="gain">▲ {line}</small>)}
              {text.costs.map((line) => <small key={line} className="cost">▼ {line}</small>)}
            </span>
          </li>;
        })}</ul>
      </section>;
    })}
    {stats.length > 0 && <section className="rogue-build-stats">
      <h4>{t.buildStats}</h4>
      <dl>{stats.map((stat) => <div key={stat.key} className={`tone-${stat.tone}`}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>
    </section>}
    {affixes.length > 0 && <section className="rogue-build-affixes">
      <h4>{t.foeGifts}</h4>
      <p>{affixes.map((id) => { const text = affixText(affixById(id), locale); return <span key={id} className="rogue-affix" title={text.detail}><Art group="affix" id={id} fallback={affixById(id).icon} className="rogue-affix-art" />{text.name}</span>; })}</p>
    </section>}
    {run.consumables.length > 0 && <p className="rogue-build-pockets">{run.consumables.map((id, index) => <span key={`${id}-${index}`} title={`${consumableText(consumableById(id), locale).name}: ${consumableText(consumableById(id), locale).detail}`}><Art group="item" id={id} fallback={consumableById(id).icon} className="rogue-pocket-art" /></span>)}</p>}
  </div>;
}

/** In-fight run chip: one small line under the match header (act · floor,
 * room, lives, live Last Stands, foe gifts). The full run — path, boons,
 * relics, coins — lives on the between-room screens and the pause RUN view,
 * so the arena stays clear. */
export function RogueRunHud({ rogue, session }: { rogue: RogueController; session: GameSession }) {
  const { locale, t } = useRogueStrings();
  const hud = useSyncExternalStore(session.hud.subscribe, session.hud.getSnapshot);
  const { run, plan } = rogue;
  const node = rogue.node;
  const liveStands = session.match?.fighters[0]?.rogue.lastStand ?? 0;
  void hud.frame;
  return <div className="rogue-run-hud" role="status" aria-label={`${t.stripTitle}: ${t.floor} ${run.row + 1}/${plan.length}`}>
    {node && <Art group="room" id={node.kind} fallback={NODE_ICONS[node.kind]} className={`rogue-run-kind kind-${node.kind}`} />}
    <strong>{t.act} {actOf(run.row) + 1} · {run.row + 1}<small>/{plan.length}</small></strong>
    {node?.floor && (() => {
      const extra = run.pending.some((entry) => entry.mirror) ? 1 : 0, { format } = floorVersus(node.floor, extra);
      return <span className={`rogue-stat rogue-format-tag format-${format}`} title={format === 'ffa' ? t.formatFfaDetail : format === 'team' ? t.formatTeamDetail : t.formatDuelDetail}>{versusTag(node.floor, extra, t)}</span>;
    })()}
    <span className="rogue-stat" title={t.livesAria}><Ui id="life" fallback="♥" />{run.lives}</span>
    {liveStands > 0 && <span className="rogue-stat stand" title={t.defianceAria}><Art group="status" id="last-stand" fallback="✝" className="rogue-ui-icon" />{liveStands}</span>}
    {rogue.affixes.length > 0 && <span className="rogue-run-gifts">{rogue.affixes.map((id) => <Art key={id} group="affix" id={id} fallback={affixById(id).icon} label={affixText(affixById(id), locale).name} />)}</span>}
  </div>;
}

/** Boss ribbon (boss floors only): name, title and an enrage tag. Percent and
 * stocks already live on the match HUD cards, so no second gauge. */
export function RogueBossBar({ rogue }: { rogue: RogueController; session: GameSession }) {
  const { locale, t } = useRogueStrings();
  const fx = useSyncExternalStore(rogue.fx.subscribe, rogue.fx.getSnapshot);
  const boss = rogue.node?.floor?.boss ? bossById(rogue.node.floor.boss) : null;
  if (!boss) return null;
  const enraged = fx.enraged.length > 0;
  return <div className={`rogue-boss-bars boss-tier-${boss.tier}${enraged ? ' enraged' : ''}`} role="status">
    <ArtRefIcon art={BOSS_ART[boss.id]} fallback={boss.icon} className="rogue-boss-title-art" />
    <b>{bossText(boss, locale).name}</b>
    {rogue.foes.some((foe) => foe.substituted) && <small>{t.standIn}</small>}
    {enraged && <em><Art group="status" id="enraged" fallback="😡" className="rogue-ui-icon" /> {t.enraged}</em>}
  </div>;
}

/** Pocket slots with 1–3 hotkeys (keyboard) — real-time use mid-fight. */
export function RoguePockets({ rogue, session, onUse }: { rogue: RogueController; session: GameSession; onUse: (id: ConsumableId) => void }) {
  const { locale, t } = useRogueStrings();
  const view = useSyncExternalStore(session.ui.subscribe, session.ui.getSnapshot);
  const slots = Array.from({ length: rogue.run.pockets }, (_, index) => rogue.run.consumables[index] ?? null);
  const latest = useRef({ slots, paused: view.paused, onUse });
  latest.current = { slots, paused: view.paused, onUse };
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code);
      if (index < 0 || event.repeat || latest.current.paused) return;
      const id = latest.current.slots[index];
      if (id) { event.preventDefault(); latest.current.onUse(id); }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
  if (!slots.some(Boolean)) return <div className="rogue-pockets empty" role="group" aria-label={t.consumablesGroup} />;
  return <div className="rogue-pockets" role="group" aria-label={t.consumablesGroup}>
    {slots.map((id, index) => {
      if (!id) return null;
      const def = consumableById(id);
      const text = consumableText(def, locale);
      return <button key={index} className="rogue-pocket rogue-consumable" title={`${text.name}: ${text.detail}`} aria-label={`${text.name}. ${text.detail}`} onClick={() => onUse(id)}>
        <Art group="item" id={id} fallback={def.icon} className="rogue-pocket-art" /><kbd>{index + 1}</kbd>
      </button>;
    })}
  </div>;
}

interface StatusChip { key: string; art: ArtRef; icon: string; label?: string; tone: string }
const status = (id: string): ArtRef => ({ group: 'status', id });
function statusChips(fighter: NonNullable<GameSession['match']>['fighters'][number], slot: number, enraged: boolean, boss: ArtRef | null = null): StatusChip[] {
  const chips: StatusChip[] = [];
  if (boss) chips.push({ key: 'boss', art: boss, icon: '👑', tone: 'boss' });
  if (fighter.poison) chips.push({ key: 'burn', art: status(slot === 0 ? 'poison' : 'burn'), icon: slot === 0 ? '☠' : '🔥', label: `${Math.ceil(fighter.poison.ticks / 60)}s`, tone: 'burn' });
  const hex = fighter.hex;
  if (hex) {
    if (hex.doomTicks > 0) chips.push({ key: 'doom', art: status('doom'), icon: '☄️', label: `${Math.round(hex.doomAmount)}%`, tone: 'doom' });
    if (hex.weakTicks > 0) chips.push({ key: 'jolt', art: status('jolt'), icon: '🔋', label: `${Math.ceil(hex.weakTicks / 60)}s`, tone: 'jolt' });
    if (hex.chillTicks > 0) chips.push({ key: 'slow', art: status('slow'), icon: '🫧', label: `${Math.ceil(hex.chillTicks / 60)}s`, tone: 'slow' });
    if (hex.retaliateTicks > 0 && fighter.rogue.retaliateMul !== 1) chips.push({ key: 'retaliate', art: status('counter'), icon: '⚔', tone: 'ready' });
  }
  if (fighter.rogue.lastStand > 0) chips.push({ key: 'stand', art: status('last-stand'), icon: '✝', label: fighter.rogue.lastStand > 1 ? `×${fighter.rogue.lastStand}` : undefined, tone: 'stand' });
  if (enraged) chips.push({ key: 'rage', art: status('enraged'), icon: '😡', tone: 'rage' });
  return chips;
}

/** Floating popups, status chips over fighters and the rogue banner. */
export function RogueFxLayer({ rogue, session }: { rogue: RogueController; session: GameSession }) {
  const hud = useSyncExternalStore(session.hud.subscribe, session.hud.getSnapshot);
  const fx = useSyncExternalStore(rogue.fx.subscribe, rogue.fx.getSnapshot);
  const [now, setNow] = useState(() => performance.now());
  const projected = useRef(new Map<number, { x: number; y: number; visible: boolean }>());
  const hasLive = fx.popups.some((popup) => now - popup.born < 1100) || (fx.banner !== null && fx.banner.until > now);
  useEffect(() => {
    if (!hasLive) return;
    const timer = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(timer);
  }, [hasLive]);
  const project = (popup: RoguePopup) => {
    let point = projected.current.get(popup.id);
    if (!point) {
      point = session.renderer?.labelPosition(popup.x, popup.y - 20) ?? { x: 0, y: 0, visible: false };
      projected.current.set(popup.id, point);
      if (projected.current.size > 64) projected.current.delete(projected.current.keys().next().value!);
    }
    return point;
  };
  const match = session.match;
  const live = performance.now();
  return <div className="rogue-fx-layer" aria-hidden="true">
    {match && hud.fighters.map((fighter, slot) => {
      const actor = match.fighters[slot];
      if (!actor || !fighter.position.visible) return null;
      const bossIcon = slot > 0 && rogue.foes[slot - 1]?.boss && rogue.node?.floor?.boss ? BOSS_ART[rogue.node.floor.boss] : null;
      const chips = statusChips(actor, slot, fx.enraged.includes(slot), bossIcon);
      if (!chips.length) return null;
      return <span key={slot} className="rogue-status-row" style={{ left: fighter.position.x, top: fighter.position.y - 22 }}>
        {chips.map((chip) => <span key={chip.key} className={`rogue-status tone-${chip.tone}`}><ArtRefIcon art={chip.art} fallback={chip.icon} className="rogue-status-art" />{chip.label && <small>{chip.label}</small>}</span>)}
      </span>;
    })}
    {fx.popups.filter((popup) => live - popup.born < 1100).map((popup, index) => {
      const point = project(popup);
      if (!point.visible) return null;
      return <span key={popup.id} className={`rogue-popup tone-${popup.tone}`} style={{ left: point.x + ((index % 3) - 1) * 10, top: point.y }}>{popup.text}</span>;
    })}
    {fx.banner && fx.banner.until > live && <span className={`rogue-banner tone-${fx.banner.tone}`}>{fx.banner.text}</span>}
  </div>;
}
