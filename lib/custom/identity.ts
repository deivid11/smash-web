/** Shared metadata only: importing this module never executes a character pack. */
export type CustomFighterKind = `custom:${string}`;
export interface PackIdentity { id: CustomFighterKind; hash: string }
export const MAX_CHARACTER_PACKS = 16;
export const PACK_ID = /^[a-z][a-z0-9-]{0,23}\.[a-z][a-z0-9-]{0,23}$/u;
export function isCustomFighter(kind: unknown): kind is CustomFighterKind {
  return typeof kind === 'string' && kind.startsWith('custom:') && PACK_ID.test(kind.slice(7));
}
export function validPackIdentities(value: unknown): value is readonly PackIdentity[] {
  if (!Array.isArray(value) || value.length > MAX_CHARACTER_PACKS) return false;
  let previous = '';
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).sort().join(',') !== 'hash,id' || !isCustomFighter(entry.id) || typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.hash) || entry.id <= previous) return false;
    previous = entry.id;
  }
  return true;
}
export function samePacks(a: readonly PackIdentity[] = [], b: readonly PackIdentity[] = []): boolean {
  return a.length === b.length && a.every((pack, index) => pack.id === b[index]?.id && pack.hash === b[index]?.hash);
}
export function packMismatch(a: readonly PackIdentity[] = [], b: readonly PackIdentity[] = []): string[] {
  const left = new Map(a.map(pack => [pack.id, pack.hash])), right = new Map(b.map(pack => [pack.id, pack.hash]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().filter(id => left.get(id) !== right.get(id));
}
