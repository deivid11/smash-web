/** Rift Descent painted art: patron medallions, boon/relic/item icons, room
 * tokens, status marks, card frames, event scenes and the abyss backdrop.
 *
 * Files live in `web/src/play/rogue-art/<group>/<game-id>.webp`, prepared from
 * the project's illustrated asset sheets and bundled through Vite with hashed,
 * immutable URLs. Every lookup keeps
 * the old emoji as a fallback: a missing file never breaks a screen.
 */
import type { CSSProperties } from 'react';
import type { BossId, TreasureId } from '../../../lib/game/roguelike/bosses.ts';
import type { RewardKind } from '../../../lib/game/roguelike/generator.ts';

const FILES = import.meta.glob('./rogue-art/**/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export type ArtGroup =
  | 'patron' | 'ui' | 'room' | 'reward' | 'boon' | 'relic' | 'aspect' | 'item' | 'affix' | 'status'
  | 'talent' | 'blessing' | 'rarity' | 'mastery' | 'scene' | 'frame' | 'bg';

export interface ArtRef { group: ArtGroup; id: string }

export function artUrl(group: ArtGroup, id: string): string | undefined {
  return FILES[`./rogue-art/${group}/${id}.webp`];
}

/** Boss treasures reuse the closest painted pieces. */
export const TREASURE_ART: Readonly<Record<TreasureId, ArtRef>> = Object.freeze({
  'titan-heart': { group: 'ui', id: 'life' },
  'war-crown': { group: 'mastery', id: 'crown' },
  'patron-blessing': { group: 'reward', id: 'boon' },
  'executioner-edge': { group: 'blessing', id: 'sharpened' },
  'aegis-core': { group: 'boon', id: 'aegis-plate' },
  'golden-idol': { group: 'ui', id: 'score' },
  'phoenix-crown': { group: 'relic', id: 'phoenix-heart' },
  'storm-eye': { group: 'boon', id: 'volt-static' },
  'rift-compass': { group: 'patron', id: 'rift' },
});

export const BOSS_ART: Readonly<Record<BossId, ArtRef>> = Object.freeze({
  warlord: { group: 'affix', id: 'enraged' },
  'twin-terrors': { group: 'status', id: 'counter' },
  titan: { group: 'affix', id: 'titan' },
  'giga-koopa': { group: 'affix', id: 'infernal' },
  'rift-sovereign': { group: 'room', id: 'boss' },
});

export const REWARD_ART: Readonly<Record<RewardKind, ArtRef>> = Object.freeze({
  boon: { group: 'reward', id: 'boon' },
  pom: { group: 'reward', id: 'pom' },
  coins: { group: 'ui', id: 'coin' },
  heart: { group: 'ui', id: 'life' },
  pocket: { group: 'reward', id: 'pocket' },
});

/** Painted icon with an emoji fallback. Decorative unless `label` is given. */
export function Art({ group, id, fallback = '', className = '', label, style }: {
  group: ArtGroup;
  id: string;
  fallback?: string;
  className?: string;
  label?: string;
  style?: CSSProperties;
}) {
  const src = artUrl(group, id);
  if (!src) return <span className={`rogue-art rogue-art-emoji ${className}`} style={style} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>{fallback}</span>;
  return <img className={`rogue-art ${className}`} style={style} src={src} alt={label ?? ''} aria-hidden={label ? undefined : true} draggable={false} decoding="async" />;
}

export function ArtRefIcon({ art, fallback, className, label }: { art: ArtRef; fallback?: string; className?: string; label?: string }) {
  return <Art group={art.group} id={art.id} fallback={fallback} className={className} label={label} />;
}

/** Small inline currency/stat icon (coins, keys, shards, lives, rerolls, heat, score). */
export function Ui({ id, fallback, label }: { id: 'coin' | 'key' | 'shards' | 'life' | 'reroll' | 'heat' | 'score'; fallback: string; label?: string }) {
  return <Art group="ui" id={id} fallback={fallback} className="rogue-ui-icon" label={label} />;
}
