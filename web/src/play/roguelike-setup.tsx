/** Rift Descent setup: a small screen router instead of one long scrolling
 * page. HUB (banner menu, like the home screen) → CHAMPION (fighter grid) ·
 * LOADOUT (aspects + relic vault) · MIRROR (talents) · RULES (seed, wrath,
 * heat, bosses, act-1 preview). Every screen fits the viewport; B / Escape /
 * the header BACK returns to the hub. Rules and storage live in
 * `lib/game/roguelike/meta.ts` and `lib/game/roguelike/unlocks.ts`.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { FighterKind } from '../../../lib/game/data.ts';
import { BOSSES } from '../../../lib/game/roguelike/bosses.ts';
import { ACT_SIZE, DIFFICULTIES, generateRun, heatScoreMult, type GeneratedRun, type RogueDifficulty, type RogueHeat } from '../../../lib/game/roguelike/generator.ts';
import {
  buyRank, championRecord, chooseAspect, isRelicUnlocked, loadMeta, MIRROR, nextRankCost, refundMirror, relicSlots, saveMeta,
  toggleLoadoutRelic, unlockRelicWithKeys, type RogueMeta,
} from '../../../lib/game/roguelike/meta.ts';
import { loadBest } from '../../../lib/game/roguelike/run-state.ts';
import { loadSuspendedRun, type SuspendedRun } from '../../../lib/game/roguelike/suspend.ts';
import {
  ASPECTS, aspectById, championPerks, MASTERY_REWARDS, masteryProgress, relicById, relicLevel, RELIC_LEVEL_XP, RELICS, type RelicId,
} from '../../../lib/game/roguelike/unlocks.ts';
import { FIGHTERS } from './battle-select.tsx';
import { Art, ArtRefIcon, BOSS_ART, Ui } from './roguelike-art.tsx';
import { ActMap, ActPills, Locale, RogueScreen, useFitColumns } from './roguelike-layout.tsx';
import { fighterName, MasteryBadge } from './roguelike-loadout.tsx';
import { newRandomSeedLabel, type RogueSettings } from './roguelike-session.ts';
import { aspectText, bossText, masteryRewardText, mirrorText, relicText, useRogueStrings } from './roguelike-text.ts';

type Images = Readonly<Record<string, string>>;
type SetupScreen = 'hub' | 'fighter' | 'loadout' | 'mirror' | 'rules';
const FIGHTER_KEY = 'smash-roguelike-fighter';

function lastFighter(): FighterKind {
  try { return (localStorage.getItem(FIGHTER_KEY) as FighterKind | null) ?? 'Fx'; } catch { return 'Fx'; }
}

function XpBar({ into, span, tone = 'gold' }: { into: number; span: number | null; tone?: 'gold' | 'blue' }) {
  const fill = span === null ? 100 : Math.max(0, Math.min(100, (into / Math.max(1, span)) * 100));
  return <span className={`rogue-xp tone-${tone}`}><span style={{ width: `${fill}%` }} /></span>;
}

function Portrait({ portraits, fighter, className = '' }: { portraits: Images; fighter: FighterKind; className?: string }) {
  return <span className={`rogue-mini-portrait ${className}`}>{portraits[fighter] ? <img src={portraits[fighter]} alt="" draggable={false} /> : fighter}</span>;
}

export function RogueSetup({
  onStart, onResume, onBack, onPreviewFighter, portraits, background = null,
}: {
  onStart: (settings: RogueSettings) => void;
  /** Continue the run kept by lib/game/roguelike/suspend.ts. */
  onResume?: (saved: SuspendedRun) => void;
  onBack: () => void;
  onPreviewFighter: (kind: FighterKind) => void;
  portraits: Images;
  previews?: Images;
  /** Background roster download (null once every fighter is ready). */
  background?: { loaded: number; total: number } | null;
}) {
  const [screen, setScreen] = useState<SetupScreen>('hub');
  const [fighter, setFighter] = useState<FighterKind>(lastFighter);
  const [seedLabel, setSeedLabel] = useState('');
  const [difficulty, setDifficulty] = useState<RogueDifficulty>('flame');
  const [heat, setHeat] = useState<RogueHeat>(0);
  const [meta, setMetaState] = useState<RogueMeta>(() => loadMeta());
  const hub = (): void => setScreen('hub');
  const pickFighter = (kind: FighterKind): void => {
    setFighter(kind);
    onPreviewFighter(kind);
    try { localStorage.setItem(FIGHTER_KEY, kind); } catch { /* private mode */ }
  };
  useEffect(() => {
    if (screen === 'hub') return;
    const keys = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      setScreen('hub');
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [screen]);
  const begin = (): void => onStart({
    fighter, seedLabel: seedLabel.trim() || newRandomSeedLabel(), length: 50, difficulty, heat,
    relics: meta.loadout, aspect: championRecord(meta, fighter).aspect,
  });
  return <div className={`rogue-setup rogue-setup-${screen}`}>
    {screen === 'hub' && <SetupHub fighter={fighter} portraits={portraits} meta={meta} difficulty={difficulty} heat={heat} seedLabel={seedLabel} onBegin={begin} onResume={onResume} onBack={onBack} onOpen={setScreen} />}
    {screen === 'fighter' && <FighterScreen fighter={fighter} portraits={portraits} loading={background} meta={meta} onPick={pickFighter} onDone={hub} />}
    {screen === 'loadout' && <LoadoutScreen fighter={fighter} portraits={portraits} meta={meta} onMeta={setMetaState} onDone={hub} />}
    {screen === 'mirror' && <MirrorScreen onDone={() => { setMetaState(loadMeta()); hub(); }} />}
    {screen === 'rules' && <RulesScreen fighter={fighter} seedLabel={seedLabel} onSeed={setSeedLabel} difficulty={difficulty} onDifficulty={setDifficulty} heat={heat} onHeat={setHeat} onDone={hub} />}
  </div>;
}

// ——— Hub ———

function SetupHub({
  fighter, portraits, meta, difficulty, heat, seedLabel, onBegin, onResume, onBack, onOpen,
}: {
  fighter: FighterKind; portraits: Images; meta: RogueMeta; difficulty: RogueDifficulty; heat: RogueHeat; seedLabel: string;
  onBegin: () => void; onResume?: (saved: SuspendedRun) => void; onBack: () => void; onOpen: (screen: SetupScreen) => void;
}) {
  const { locale, t } = useRogueStrings();
  const [best] = useState(() => loadBest());
  const [saved] = useState(() => (onResume ? loadSuspendedRun() : null));
  const record = championRecord(meta, fighter);
  const rank = masteryProgress(record.xp).rank;
  const wrath = t[`${difficulty}Name` as 'emberName' | 'flameName' | 'infernoName'];
  return <RogueScreen name="hub" className="rogue-hub" title={<span className="rogue-title">RIFT DESCENT</span>} eyebrow={t.setupEyebrow}
    back={{ label: t.modes.replace(/^◀\s*/u, ''), onClick: onBack, id: 'rogue-back-modes' }} aside={<Locale />}>
    <div className="rogue-hub-left">
      <p className="rogue-lede">{t.setupLede}</p>
      <p className="rogue-hub-descent"><strong>{t.descentInfo}</strong><small>{t.descentLede}</small></p>
      <div className="rogue-hub-bosses" aria-label={t.bossesTitle}>
        {BOSSES.map((boss, index) => <span key={boss.id} className={`rogue-hub-boss tier-${boss.tier}`} title={`${bossText(boss, locale).name} · ${t.floor} ${(index + 1) * ACT_SIZE}`}>
          <ArtRefIcon art={BOSS_ART[boss.id]} fallback={boss.icon} /><em>{(index + 1) * ACT_SIZE}</em>
        </span>)}
      </div>
      {best && <p className="rogue-best" role="status">{t.best}: {best.score} {t.pts} · {best.cleared}/{best.length}{best.heat > 0 && <> · <Ui id="heat" fallback="🔥" />{best.heat}</>}</p>}
      <p className="rogue-scope">{t.scopeNote}</p>
    </div>
    <nav className="rogue-hub-menu" aria-label="Rift Descent">
      {saved && onResume && <button id="rogue-continue" className="rogue-nav primary" onClick={() => onResume(saved)}>
        <Portrait portraits={portraits} fighter={saved.run.playerFighter} className="rogue-nav-art" />
        <span className="rogue-nav-text"><strong>{t.continueRun}</strong><small>{t.continueSub} · {fighterName(saved.run.playerFighter).toUpperCase()} · {t.floor} {Math.min(saved.run.length, saved.run.row + 1)}/{saved.run.length} · ❤ {saved.run.lives} · 🪙 {saved.run.coins} · {saved.run.boons.length} {t.boonsWord}</small></span>
      </button>}
      <button id="rogue-begin" className={`rogue-nav${saved ? '' : ' primary'}`} onClick={onBegin}>
        <Portrait portraits={portraits} fighter={fighter} className="rogue-nav-art" />
        <span className="rogue-nav-text"><strong>{t.enterRift}</strong><small>{saved ? t.newRunReplaces : `${t.navBeginSub} · ${wrath}${heat > 0 ? ` · 🔥${heat}` : ''}`}</small></span>
      </button>
      <button id="rogue-champion-open" className="rogue-nav" onClick={() => onOpen('fighter')}>
        <MasteryBadge rank={rank} className="rogue-nav-art" />
        <span className="rogue-nav-text"><strong>{t.navChampion} · {fighterName(fighter).toUpperCase()}</strong><small>{t.masteryRank} {rank} · {record.runs} {t.runsWord} · {record.wins} {t.winsWord}</small></span>
        <span className="rogue-nav-arrow" aria-hidden="true">▶</span>
      </button>
      <button id="rogue-loadout-open" className="rogue-nav" onClick={() => onOpen('loadout')}>
        <Art group="talent" id="satchel" fallback="🧳" className="rogue-nav-art" />
        <span className="rogue-nav-text"><strong>{t.navLoadout}</strong><small className="rogue-nav-icons">
          {record.aspect && <Art group="aspect" id={record.aspect} fallback={aspectById(record.aspect).icon} className="rogue-ui-icon big" />}
          {meta.loadout.map((id) => <Art key={id} group="relic" id={id} fallback={relicById(id).icon} className="rogue-ui-icon big" />)}
          {!record.aspect && meta.loadout.length === 0 && t.navLoadoutSub}
          <span className="rogue-nav-keys"><Ui id="key" fallback="🗝" /> {meta.keys}</span>
        </small></span>
        <span className="rogue-nav-arrow" aria-hidden="true">▶</span>
      </button>
      <button id="rogue-mirror-open" className="rogue-nav" onClick={() => onOpen('mirror')}>
        <Art group="talent" id="favor" fallback="🪞" className="rogue-nav-art" />
        <span className="rogue-nav-text"><strong>{t.navMirror}</strong><small><Ui id="shards" fallback="💠" /> {meta.shards} · {t.navMirrorSub}</small></span>
        <span className="rogue-nav-arrow" aria-hidden="true">▶</span>
      </button>
      <button id="rogue-rules-open" className="rogue-nav" onClick={() => onOpen('rules')}>
        <Art group="ui" id="heat" fallback="🔥" className="rogue-nav-art" />
        <span className="rogue-nav-text"><strong>{t.navRules}</strong><small>{wrath} · {t.heatName.split('·')[0]!.trim()} {heat}{seedLabel.trim() ? ` · ${seedLabel.trim()}` : ''}</small></span>
        <span className="rogue-nav-arrow" aria-hidden="true">▶</span>
      </button>
    </nav>
  </RogueScreen>;
}

// ——— Champion ———

function FighterScreen({ fighter, portraits, loading, meta, onPick, onDone }: { fighter: FighterKind; portraits: Images; loading: { loaded: number; total: number } | null; meta: RogueMeta; onPick: (kind: FighterKind) => void; onDone: () => void }) {
  const { locale, t } = useRogueStrings();
  // The whole roster at once: while the background download runs every fighter
  // shows (not-yet-ready ones dimmed); once it finishes, absent fighters drop out.
  const settled = !loading && Object.keys(portraits).length > 0;
  const roster = settled ? FIGHTERS.filter((entry) => entry.kind.startsWith('custom:') || portraits[entry.kind] !== undefined) : FIGHTERS;
  const ready = (kind: string): boolean => kind.startsWith('custom:') || portraits[kind] !== undefined;
  const [gridRef, columns] = useFitColumns<HTMLDivElement>(roster.length, 0.82, 4);
  const record = championRecord(meta, fighter);
  const progress = masteryProgress(record.xp);
  const perks = championPerks(progress.rank);
  const next = MASTERY_REWARDS.find((reward) => reward.rank > progress.rank);
  const open = ASPECTS.filter((aspect) => aspect.rank <= progress.rank).length;
  return <RogueScreen name="fighter" className="rogue-fighter-screen" eyebrow={t.fighterHint} title={t.chooseFighter} back={{ label: t.back, onClick: onDone }}
    aside={<span className="rogue-roster-count">{roster.length} {t.fighterCount}{loading ? ` · ${loading.loaded}/${loading.total}` : ''}</span>}>
    <div className="rogue-roster" ref={gridRef} style={{ '--columns': columns } as CSSProperties} role="group" aria-label={t.chooseFighter}>
      {roster.map((entry) => <button key={entry.kind} className={`rogue-roster-tile${ready(entry.kind) ? '' : ' pending'}`} data-fighter={entry.kind} aria-pressed={entry.kind === fighter} title={entry.name} disabled={!ready(entry.kind)}
        onClick={() => { if (entry.kind === fighter) onDone(); else onPick(entry.kind as FighterKind); }}>
        {portraits[entry.kind] ? <img src={portraits[entry.kind]} alt="" draggable={false} /> : <span aria-hidden="true">{entry.mark}</span>}
        <b>{entry.name}</b>
      </button>)}
    </div>
    <aside className="rogue-fighter-side">
      <Portrait portraits={portraits} fighter={fighter} className="big" />
      <strong className="rogue-fighter-name">{fighterName(fighter).toUpperCase()}</strong>
      <span className="rogue-champion-rank" id="rogue-mastery-rank"><MasteryBadge rank={progress.rank} />{t.masteryRank} {progress.rank}{progress.span === null && <em> · {t.masteryMax}</em>}</span>
      <XpBar into={progress.into} span={progress.span} />
      <small>{progress.span === null ? `${record.xp} XP` : `${progress.into}/${progress.span} XP`} · {record.runs} {t.runsWord} · {record.wins} {t.winsWord}</small>
      <small>{open}/{ASPECTS.length} {t.unlockedAspects} · {perks.aspectLevel > 1 ? `Lv${perks.aspectLevel}` : 'Lv1'}</small>
      {next && <small className="rogue-fighter-next"><b>{t.nextReward} ({next.rank}):</b> {masteryRewardText(next, locale)}</small>}
      <button className="battle-next" id="rogue-fighter-confirm" onClick={onDone}>{t.confirm}</button>
    </aside>
  </RogueScreen>;
}

// ——— Loadout ———

function LoadoutScreen({ fighter, portraits, meta, onMeta, onDone }: { fighter: FighterKind; portraits: Images; meta: RogueMeta; onMeta: (meta: RogueMeta) => void; onDone: () => void }) {
  const { locale, t } = useRogueStrings();
  const [error, setError] = useState('');
  const [focus, setFocus] = useState<RelicId>(() => meta.loadout[0] ?? RELICS[0]!.id);
  const [gridRef, columns] = useFitColumns<HTMLDivElement>(RELICS.length, 1.05, 6);
  const commit = (fn: () => RogueMeta): void => {
    try { const next = fn(); saveMeta(next); onMeta(next); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const record = championRecord(meta, fighter);
  const progress = masteryProgress(record.xp);
  const perks = championPerks(progress.rank);
  const slots = relicSlots(meta);
  const relic = relicById(focus);
  const text = relicText(relic, locale);
  const unlocked = isRelicUnlocked(meta, focus);
  const xp = meta.relicXp[focus] ?? 0;
  const level = relicLevel(xp);
  const equipped = meta.loadout.includes(focus);
  const nextXp = level === 1 ? RELIC_LEVEL_XP[0] : level === 2 ? RELIC_LEVEL_XP[1] : null;
  return <RogueScreen name="loadout" className="rogue-loadout rogue-loadout-screen" eyebrow={t.loadoutLede} title={t.loadoutTitle} back={{ label: t.back, onClick: onDone }}
    aside={<span className="rogue-keys" title={t.keysName}><Ui id="key" fallback="🗝" /> <b id="rogue-keys">{meta.keys}</b></span>}>
    <section className={`rogue-champion${progress.rank >= 8 ? ' champion-max' : ''}`}>
      <div className="rogue-champion-head">
        <Portrait portraits={portraits} fighter={fighter} className="big" />
        <span className="rogue-champion-body">
          <small>{t.championTitle}</small>
          <strong>{fighterName(fighter).toUpperCase()}</strong>
          <span className="rogue-champion-rank"><MasteryBadge rank={progress.rank} />{t.masteryRank} {progress.rank}</span>
          <XpBar into={progress.into} span={progress.span} />
        </span>
      </div>
      <p className="rogue-champion-perks"><b>{t.perksActive}:</b> {perks.rerolls ? <span className="rogue-perk"><Ui id="reroll" fallback="🎲" /> +{perks.rerolls}</span> : null}{perks.coins ? <span className="rogue-perk"><Ui id="coin" fallback="🪙" /> +{perks.coins}</span> : null}{perks.lives ? <span className="rogue-perk"><Ui id="life" fallback="♥" /> +{perks.lives}</span> : null}<span className="rogue-perk">✦ Lv{perks.aspectLevel}</span></p>
      <div className="rogue-aspects" role="radiogroup" aria-label={t.aspectTitle}>
        {ASPECTS.map((aspect) => {
          const atext = aspectText(aspect, locale);
          const open = aspect.rank <= progress.rank;
          const chosen = record.aspect === aspect.id;
          return <button key={aspect.id} role="radio" aria-checked={chosen} id={`rogue-aspect-${aspect.id}`} className={`rogue-aspect${chosen ? ' chosen' : ''}${open ? '' : ' locked'}`} disabled={!open}
            onClick={() => commit(() => chooseAspect(meta, fighter, aspect.id))} title={`${atext.name}\n${open ? atext.levels[perks.aspectLevel - 1] : `${t.masteryRank} ${aspect.rank}`}`}>
            {open ? <Art group="aspect" id={aspect.id} fallback={aspect.icon} className="rogue-aspect-icon" /> : <span className="rogue-aspect-icon rogue-locked-art" aria-hidden="true"><Art group="aspect" id={aspect.id} fallback="🔒" /></span>}
            <span><strong>{atext.name.replace(/^Aspect of the |^Aspecto de(l| la) /u, '')}</strong><small>{open ? atext.levels[perks.aspectLevel - 1] : `🔒 ${t.masteryRank} ${aspect.rank}`}</small></span>
          </button>;
        })}
      </div>
    </section>
    <section className="rogue-vault">
      <div className="rogue-vault-head">
        <strong>{t.relicsTitle}</strong>
        <span className="rogue-relic-slots" id="rogue-relic-slots" aria-label={`${meta.loadout.length}/${slots} ${t.slotsWord}`}>
          {Array.from({ length: slots }, (_, index) => { const id = meta.loadout[index]; return id ? <Art key={index} group="relic" id={id} fallback={relicById(id).icon} className="rogue-relic-slot" /> : <span key={index} className="rogue-relic-slot empty">+</span>; })}
          <b>{meta.loadout.length}/{slots}</b>
        </span>
      </div>
      <div className="rogue-relic-grid" ref={gridRef} style={{ '--columns': columns } as CSSProperties}>
        {RELICS.map((entry) => {
          const open = isRelicUnlocked(meta, entry.id);
          const on = meta.loadout.includes(entry.id);
          const lvl = relicLevel(meta.relicXp[entry.id] ?? 0);
          return <button key={entry.id} id={`rogue-relic-${entry.id}`} className={`rogue-relic${on ? ' equipped' : ''}${open ? '' : ' locked'}${focus === entry.id ? ' focused' : ''}`} aria-pressed={open ? on : undefined}
            onMouseEnter={() => setFocus(entry.id)} onFocus={() => setFocus(entry.id)}
            onClick={() => { setFocus(entry.id); if (open) commit(() => toggleLoadoutRelic(meta, entry.id)); }}>
            <Art group="relic" id={entry.id} fallback={entry.icon} className="rogue-relic-icon" />
            <b>{relicText(entry, locale).name}</b>
            {open ? <span className="rogue-relic-level">{[1, 2, 3].map((pip) => <i key={pip} className={pip <= lvl ? 'on' : ''} />)}</span> : <span className="rogue-relic-lock">🔒 {entry.keyCost}</span>}
          </button>;
        })}
      </div>
      <div className={`rogue-relic-detail${unlocked ? '' : ' locked'}`} role="status">
        <Art group="relic" id={focus} fallback={relic.icon} className="rogue-relic-detail-art" />
        <span className="rogue-relic-detail-body">
          <strong>{text.name} {unlocked && <em>Lv{level}</em>}</strong>
          <small>{unlocked ? text.levels[level - 1] : `🔒 ${text.condition}`}</small>
          {unlocked && nextXp !== null && <XpBar into={xp - (level === 2 ? RELIC_LEVEL_XP[0] : 0)} span={nextXp - (level === 2 ? RELIC_LEVEL_XP[0] : 0)} tone="blue" />}
        </span>
        {unlocked
          ? <button className="rogue-relic-action" onClick={() => commit(() => toggleLoadoutRelic(meta, focus))}>{equipped ? `✓ ${t.equipped}` : t.equip}</button>
          : <button className="rogue-relic-action rogue-relic-unlock" disabled={meta.keys < relic.keyCost} onClick={() => commit(() => unlockRelicWithKeys(meta, focus))}>{t.unlock} · <Ui id="key" fallback="🗝" /> {relic.keyCost}</button>}
      </div>
      {error && <p className="room-error" role="alert">{error === 'Your relic slots are full.' ? t.slotsFull : error}</p>}
    </section>
  </RogueScreen>;
}

// ——— Mirror ———

export function MirrorScreen({ onDone }: { onDone: () => void }) {
  const { locale, t } = useRogueStrings();
  const [meta, setMeta] = useState<RogueMeta>(() => loadMeta());
  const [error, setError] = useState('');
  const [focus, setFocus] = useState(MIRROR[0]!.id);
  const commit = (next: RogueMeta): void => { saveMeta(next); setMeta(next); setError(''); };
  const focusDef = MIRROR.find((def) => def.id === focus)!;
  const focusRank = meta.ranks[focus];
  const focusCost = nextRankCost(meta, focus);
  return <RogueScreen name="mirror" className="rogue-mirror" eyebrow={t.mirrorLede} title={t.mirrorTitle} back={{ label: t.back, onClick: onDone }}
    aside={<p className="rogue-mirror-shards" role="status"><Ui id="shards" fallback="💠" /> <strong id="rogue-shards">{meta.shards}</strong> {t.shards}</p>}
    footer={<>
      <small className="rogue-foot-note">{meta.runs} {t.runsWord} · {meta.wins} {t.winsWord} · {t.mirrorHint}</small>
      <button className="secondary" onClick={() => commit(refundMirror(meta))}>{t.mirrorRefund}</button>
      <button className="battle-next" onClick={onDone}>{t.mirrorClose}</button>
    </>}>
    <div className="rogue-mirror-grid">
      {MIRROR.map((def) => {
        const rank = meta.ranks[def.id];
        const cost = nextRankCost(meta, def.id);
        const text = mirrorText(def, rank + (cost === null ? 0 : 1), locale);
        return <button key={def.id} className={`rogue-mirror-talent${rank > 0 ? ' owned' : ''}${focus === def.id ? ' focused' : ''}`} disabled={cost === null || meta.shards < cost}
          onMouseEnter={() => setFocus(def.id)} onFocus={() => setFocus(def.id)}
          onClick={() => { setFocus(def.id); try { commit(buyRank(meta, def.id)); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } }}>
          <Art group="talent" id={def.id} fallback={def.icon} className="rogue-mirror-icon" />
          <strong>{text.name}</strong>
          <span className="rogue-mirror-pips" aria-label={`${rank}/${def.costs.length}`}>{def.costs.map((_, index) => <i key={index} className={index < rank ? 'on' : ''} />)}</span>
          <span className="rogue-price">{cost === null ? t.mirrorMaxed : <><Ui id="shards" fallback="💠" /> {cost}</>}</span>
        </button>;
      })}
    </div>
    <p className="rogue-mirror-detail" role="status">
      <Art group="talent" id={focus} fallback={focusDef.icon} className="rogue-ui-icon big" />
      <strong>{mirrorText(focusDef, focusRank + (focusCost === null ? 0 : 1), locale).name}</strong>
      <span>{mirrorText(focusDef, Math.max(1, focusRank + (focusCost === null ? 0 : 1)), locale).detail}</span>
      {error && <em className="room-error">{error}</em>}
    </p>
  </RogueScreen>;
}

// ——— Rules ———

function RulesScreen({
  fighter, seedLabel, onSeed, difficulty, onDifficulty, heat, onHeat, onDone,
}: {
  fighter: FighterKind; seedLabel: string; onSeed: (label: string) => void; difficulty: RogueDifficulty; onDifficulty: (value: RogueDifficulty) => void;
  heat: RogueHeat; onHeat: (value: RogueHeat) => void; onDone: () => void;
}) {
  const { locale, t } = useRogueStrings();
  let preview: GeneratedRun | null = null;
  try { preview = seedLabel.trim() ? generateRun(seedLabel.trim(), { length: 50, difficulty, playerFighter: fighter, heat }) : null; } catch { preview = null; }
  const blurb = { ember: t.emberBlurb, flame: t.flameBlurb, inferno: t.infernoBlurb };
  return <RogueScreen name="rules" className="rogue-rules" eyebrow={t.navRulesSub} title={t.navRules} back={{ label: t.back, onClick: onDone }}
    footer={<><small className="rogue-foot-note">{t.descentInfo}</small><button className="battle-next" onClick={onDone}>{t.confirm}</button></>}>
    <section className="rogue-rules-form">
      <div className="rogue-form">
        <label>{t.seed}<input id="rogue-seed" value={seedLabel} placeholder={t.seedPlaceholder} onChange={(event) => onSeed(event.target.value.toUpperCase())} /></label>
        <button className="secondary" onClick={() => onSeed(newRandomSeedLabel())}>{t.random}</button>
      </div>
      <div className="rogue-wrath-options" role="radiogroup" aria-label={t.wrath}>
        {DIFFICULTIES.map((value) => <button key={value} role="radio" aria-checked={difficulty === value} className={`rogue-wrath-option wrath-${value}`} onClick={() => onDifficulty(value)}>
          <strong>{t[`${value}Name` as 'emberName' | 'flameName' | 'infernoName']}</strong><small>{blurb[value]}</small>
        </button>)}
      </div>
      <div className="rogue-heat" role="group" aria-label={t.heatName}>
        <span>{t.heatName}</span>
        <span className="rogue-heat-row">
          <button id="rogue-heat-down" aria-label={t.heatLower} disabled={heat <= 0} onClick={() => onHeat(Math.max(0, heat - 1) as RogueHeat)}>−</button>
          <strong id="rogue-heat-value" aria-live="polite">{heat}</strong>
          <button id="rogue-heat-up" aria-label={t.heatRaise} disabled={heat >= 5} onClick={() => onHeat(Math.min(5, heat + 1) as RogueHeat)}>+</button>
          <span className="rogue-heat-flames" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} className={index < heat ? 'on' : ''}><Ui id="heat" fallback="🔥" /></i>)}</span>
        </span>
        <small>{heat === 0 ? t.heatNone : locale === 'es' ? `Rivales +${heat} ${heat > 1 ? 'niveles' : 'nivel'}, +${heat * 8}% daño · puntos ×${heatScoreMult(heat)}` : `Foes +${heat} level${heat > 1 ? 's' : ''}, +${heat * 8}% damage · score ×${heatScoreMult(heat)}`}</small>
      </div>
    </section>
    <section className="rogue-rules-preview">
      <ActPills act={0} />
      {preview
        ? <div className="rogue-tower" aria-label={`${preview.length} ${t.towerPreviewAria}`}><ActMap plan={preview} act={0} path={[]} row={-1} lane={null} reachable={[]} compact /></div>
        : <p className="rogue-tower-hint">{t.towerHint}</p>}
    </section>
  </RogueScreen>;
}
