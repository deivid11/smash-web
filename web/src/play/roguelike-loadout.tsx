/** Rift Descent permanent-unlock pieces shared by run screens: mastery badge,
 * fighter names, the end-of-run rewards report and compact loadout strips.
 * The setup loadout screen lives in `web/src/play/roguelike-setup.tsx`.
 * Presentation only: rules and storage live in `lib/game/roguelike/unlocks.ts`
 * and `lib/game/roguelike/meta.ts`.
 */
import type { CSSProperties } from 'react';
import { ORIGINAL_FIGHTERS } from '../../../lib/game/data.ts';
import { customCharacter } from '../../../lib/custom/registry.ts';
import type { RunReport } from '../../../lib/game/roguelike/meta.ts';
import {
  aspectById, MASTERY_REWARDS, masteryProgress, relicById,
  type EquippedAspect, type EquippedRelic, type RelicId,
} from '../../../lib/game/roguelike/unlocks.ts';
import { aspectText, masteryRewardText, relicText, useRogueStrings } from './roguelike-text.ts';
import { Art, Ui } from './roguelike-art.tsx';

/** Mastery rank badge (ranks 1–8 have painted chevrons/crowns). */
export function MasteryBadge({ rank, className = '' }: { rank: number; className?: string }) {
  return <Art group="mastery" id={String(Math.max(1, Math.min(8, rank)))} fallback="✦" className={`rogue-mastery-badge ${className}`} />;
}

export function fighterName(kind: string): string {
  return (ORIGINAL_FIGHTERS as Record<string, { name: string } | undefined>)[kind]?.name ?? customCharacter(kind)?.name ?? kind;
}

function XpBar({ into, span, tone = 'gold' }: { into: number; span: number | null; tone?: 'gold' | 'blue' }) {
  const fill = span === null ? 100 : Math.max(0, Math.min(100, (into / Math.max(1, span)) * 100));
  return <span className={`rogue-xp tone-${tone}`}><span style={{ width: `${fill}%` }} /></span>;
}

/** Relic + aspect icons for HUDs and run bars. */
export function LoadoutStrip({ relics, aspect }: { relics: readonly EquippedRelic[]; aspect: EquippedAspect | null }) {
  const { locale } = useRogueStrings();
  if (!relics.length && !aspect) return null;
  return <span className="rogue-loadout-strip">
    {aspect && <span className="rogue-loadout-aspect" title={`${aspectText(aspectById(aspect.id), locale).name} · Lv${aspect.level}\n${aspectText(aspectById(aspect.id), locale).levels[aspect.level - 1]}`}><Art group="aspect" id={aspect.id} fallback={aspectById(aspect.id).icon} /></span>}
    {relics.map((relic) => {
      const def = relicById(relic.id);
      const text = relicText(def, locale);
      return <span key={relic.id} className="rogue-loadout-relic" title={`${text.name} · Lv${relic.level}\n${text.levels[relic.level - 1]}`}><Art group="relic" id={relic.id} fallback={def.icon} /><small>{relic.level}</small></span>;
    })}
  </span>;
}

/** Build-sheet section listing the equipped loadout with live effects. */
export function LoadoutSheet({ relics, aspect, rank }: { relics: readonly EquippedRelic[]; aspect: EquippedAspect | null; rank: number }) {
  const { locale, t } = useRogueStrings();
  if (!relics.length && !aspect) return null;
  return <section className="rogue-build-group rogue-build-loadout" style={{ '--patron': '#8fd8ff' } as CSSProperties}>
    <h4><Art group="talent" id="satchel" fallback="🧳" className="rogue-h4-art" /> {t.loadoutRun} <small><MasteryBadge rank={rank} className="inline" /> {t.masteryRank} {rank}</small></h4>
    <ul>
      {aspect && <li className="rogue-build-boon"><span className="rogue-chip rogue-chip-sm" style={{ '--patron': '#ffd75e', '--patron-b': '#ffd75e' } as CSSProperties}><Art group="aspect" id={aspect.id} fallback={aspectById(aspect.id).icon} className="rogue-chip-icon" /></span>
        <span className="rogue-build-boon-body"><strong>{aspectText(aspectById(aspect.id), locale).name} <em>Lv{aspect.level}</em></strong><small className="gain">▲ {aspectText(aspectById(aspect.id), locale).levels[aspect.level - 1]}</small></span></li>}
      {relics.map((relic) => {
        const def = relicById(relic.id);
        const text = relicText(def, locale);
        return <li key={relic.id} className="rogue-build-boon"><span className="rogue-chip rogue-chip-sm" style={{ '--patron': '#8fd8ff', '--patron-b': '#8fd8ff' } as CSSProperties}><Art group="relic" id={relic.id} fallback={def.icon} className="rogue-chip-icon" /></span>
          <span className="rogue-build-boon-body"><strong>{text.name} <em>Lv{relic.level}</em></strong><small className="gain">▲ {text.levels[relic.level - 1]}</small></span></li>;
      })}
    </ul>
  </section>;
}

/** End-of-run rewards: keys, champion mastery, relic level-ups, new unlocks. */
export function RunReportPanel({ report }: { report: RunReport }) {
  const { locale, t } = useRogueStrings();
  const before = masteryProgress(report.mastery.before);
  const after = masteryProgress(report.mastery.after);
  const rankUp = report.mastery.rankAfter > report.mastery.rankBefore;
  const unlockedRewards = MASTERY_REWARDS.filter((reward) => reward.rank > report.mastery.rankBefore && reward.rank <= report.mastery.rankAfter);
  return <section className="rogue-report" aria-labelledby="rogue-report-title">
    <h3 id="rogue-report-title" className="rogue-subhead">{t.reportTitle}</h3>
    <div className="rogue-report-row">
      <span className="rogue-report-chip keys"><b id="rogue-report-keys"><Ui id="key" fallback="🗝" /> +{report.keys}</b>{t.keysEarned}</span>
      <span className="rogue-report-chip shards"><b><Ui id="shards" fallback="💠" /> +{report.earned}</b>{t.shards}</span>
      <span className={`rogue-report-mastery${rankUp ? ' rank-up' : ''}`}>
        <small>{t.masteryGain} · {fighterName(report.mastery.fighter).toUpperCase()} · +{report.mastery.xp} XP</small>
        <strong><MasteryBadge rank={after.rank} />{t.masteryRank} {before.rank}{rankUp && <> → {after.rank} <em>{t.rankUp}</em></>}</strong>
        <XpBar into={after.into} span={after.span} />
        {unlockedRewards.map((reward) => <small key={reward.key} className="rogue-report-reward">✦ {masteryRewardText(reward, locale)}</small>)}
      </span>
    </div>
    {report.relics.length > 0 && <div className="rogue-report-relics">
      {report.relics.map((entry) => {
        const def = relicById(entry.id);
        const up = entry.levelAfter > entry.levelBefore;
        return <span key={entry.id} className={`rogue-report-relic${up ? ' level-up' : ''}`}><Art group="relic" id={entry.id} fallback={def.icon} className="rogue-ui-icon big" /> {relicText(def, locale).name} <small>+{entry.xp} {t.relicXpWord}{up ? ` · ${t.levelUp} ${entry.levelAfter}` : ''}</small></span>;
      })}
    </div>}
    {report.unlocked.map((id: RelicId) => {
      const def = relicById(id);
      const text = relicText(def, locale);
      return <div key={id} className="rogue-report-unlock" role="status"><Art group="relic" id={id} fallback={def.icon} className="rogue-relic-icon" /><span><small>{t.newUnlock}</small><strong>{text.name}</strong><em>{text.levels[0]}</em></span></div>;
    })}
  </section>;
}
