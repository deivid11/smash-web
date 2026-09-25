import installed from '#custom-packs';
import { isCustomFighter, validPackIdentities, type CustomFighterKind } from './identity.ts';
import type { CharacterPack, CustomState, InstalledPack } from './types.ts';
import type { FighterContent } from '../game/load.ts';

/** A fixed registry per build: never download/evaluate code sent by an online peer. */
export function validateRegistry(entries: readonly InstalledPack[]): readonly InstalledPack[] {
  if (!validPackIdentities(entries.map(entry => entry.identity))) throw new Error('Invalid, duplicate or unsorted character pack identities.');
  for (const { identity, character: pack } of entries) {
    if (pack.apiVersion !== 1 || pack.kind !== identity.id || !isCustomFighter(pack.kind) || !pack.name?.trim() || pack.name.length > 64 || typeof pack.create !== 'function' || !pack.menu || !pack.specials || ['name', 'begin', 'step', 'land'].some(key => typeof pack.specials[key as keyof CharacterPack['specials']] !== 'function')) throw new Error(`Invalid character pack: ${identity.id}`);
    if ([pack.landed, pack.aerialAttack, pack.input, pack.cancel, pack.specials.allowed].some(hook => hook !== undefined && typeof hook !== 'function')) throw new Error(`Invalid custom gameplay hook: ${identity.id}`);
    if (pack.presentations?.some(mode => !/^[a-z][a-z0-9-]{0,31}$/u.test(mode.id) || !mode.label || mode.label.length > 64)) throw new Error(`Invalid pack presentation: ${identity.id}`);
  }
  return entries;
}
const packs = validateRegistry(installed);
export const CUSTOM_PACKS: readonly CharacterPack[] = Object.freeze(packs.map(entry => entry.character));
export const CUSTOM_PACK_IDENTITIES = Object.freeze(packs.map(entry => Object.freeze({ ...entry.identity })));
export const CUSTOM_FIGHTERS = Object.freeze(CUSTOM_PACKS.map(pack => pack.kind));
const byKind = new Map(CUSTOM_PACKS.map(pack => [pack.kind, pack]));
export function customCharacter(kind: unknown): CharacterPack | undefined { return isCustomFighter(kind) ? byKind.get(kind) : undefined; }
export function requireCustomCharacter(kind: unknown): CharacterPack {
  const pack = customCharacter(kind);
  if (!pack) throw new Error(`Custom character is not installed: ${String(kind)}`);
  return pack;
}
export const CUSTOM_PRESENTATIONS = Object.freeze([...new Map(CUSTOM_PACKS.flatMap(pack => pack.presentations ?? []).map(mode => [mode.id, mode])).values()]);
export function customInitialState(kind: unknown): CustomState | null {
  const state = customCharacter(kind)?.initialState?.();
  if (state === undefined) return null;
  // Reject non-JSON state and unreasonable allocations before it reaches hashing / rollback.
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 16) throw new Error('Custom state is too deeply nested.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value))) throw new Error('Custom state must contain only finite JSON data.');
    for (const item of Object.values(value)) visit(item, depth + 1);
  };
  visit(state);
  if (JSON.stringify(state).length > 16_384) throw new Error('Custom state exceeds 16 KiB.');
  return structuredClone(state);
}
export function createCustomCharacter(kind: CustomFighterKind): FighterContent {
  const pack = requireCustomCharacter(kind), content = pack.create();
  if (content.profile.kind !== pack.kind || content.custom !== pack.kind || content.specials.parameters.kind !== 'custom' || !content.clips.has('Wait1') || content.profile.words.byteLength !== 0x9c) throw new Error(`Invalid fighter factory: ${pack.kind}`);
  return content;
}
export function addCustomCharacters(roster: Map<import('../game/data.ts').FighterKind, FighterContent>): void {
  for (const pack of CUSTOM_PACKS) {
    if (roster.has(pack.kind)) throw new Error(`Duplicate fighter: ${pack.kind}`);
    roster.set(pack.kind, createCustomCharacter(pack.kind));
  }
}
export function customName(kind: CustomFighterKind): string { return customCharacter(kind)?.name ?? kind; }
