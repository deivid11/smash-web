import type { Camera, Scene } from 'three';
import type { FighterContent } from '../game/load.ts';
import type { MatchFighter, PlayerInput, LocalMatch, MatchEvent } from '../game/match.ts';
import type { ActiveHit, HitDefinition } from '../game/moves.ts';
import type { SpecialDirection } from '../game/special-data.ts';
import type { SpecialRuntime, SpecialStep } from '../game/specials.ts';
import type { MeleePhysics } from '../game/physics.ts';
import type { ModelInstance } from '../../web/src/render/model-instance.ts';
import type { CustomFighterKind, PackIdentity } from './identity.ts';

export type CustomState = { [key: string]: null | boolean | number | string | CustomState | (null | boolean | number | string | CustomState)[] };
export type FinishSpecial = (helpless?: boolean, lag?: number, mobility?: number) => void;
export interface CustomSkin {
  render(fighter: MatchFighter, camera: Camera, victory: boolean, presentation: string, alpha: number, paused: boolean): void;
  dispose(): void;
}
export interface CustomEffects {
  update(match: LocalMatch, camera: Camera, presentation: string): void;
  reset(): void;
  dispose(): void;
}
/** Prepared once per GameSession; skins own their geometry, this object owns shared textures. */
export interface CustomVisual {
  createSkin(actor: ModelInstance): CustomSkin;
  createEffects?(scene: Scene): CustomEffects;
  dispose(): void;
}
export interface CustomPackContext {
  kind: CustomFighterKind;
  /** Only manifest-declared assets, emitted to hashed public build URLs. */
  assets: Readonly<Record<string, string>>;
}
/** v1 trusted, build-time extension API; NOT a sandbox or a universal GLB importer. */
export interface CharacterPack {
  apiVersion: 1;
  kind: CustomFighterKind;
  name: string;
  menu: { mark: string; color: 'mint' | 'coral' | 'water' | 'pink' | 'orange' | 'electric'; subtitle: string; provenance: string };
  create(): FighterContent;
  /** Only JSON-compatible, finite, deterministic per-fighter data. Snapshot-owned. */
  initialState?(): CustomState;
  specials: {
    name(direction: SpecialDirection, phase: SpecialRuntime['phase'], air: boolean): string;
    begin(fighter: MatchFighter, direction: SpecialDirection, input: PlayerInput): void;
    step(fighter: MatchFighter, input: PlayerInput, physics: MeleePhysics, finish: FinishSpecial): SpecialStep;
    land(fighter: MatchFighter, finish: FinishSpecial): boolean;
  };
  /** May mutate simulation fields, never render state; null means this hit was not countered. */
  counter?(attacker: MatchFighter, victim: MatchFighter, hit: HitDefinition): MatchEvent[] | null;
  hits?(fighter: MatchFighter, hits: ActiveHit[]): ActiveHit[];
  status?(fighter: MatchFighter): string | null;
  presentations?: readonly { id: string; label: string }[];
  prepareVisual?(): Promise<CustomVisual>;
}
export interface InstalledPack { identity: PackIdentity; character: CharacterPack }
