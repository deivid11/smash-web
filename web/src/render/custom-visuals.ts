import { CUSTOM_PACKS } from '../../../lib/custom/registry.ts';
import type { CustomFighterKind } from '../../../lib/custom/identity.ts';
import type { CustomVisual } from '../../../lib/custom/types.ts';
export type CustomVisuals = ReadonlyMap<CustomFighterKind, CustomVisual>;
export function disposeCustomVisuals(visuals: CustomVisuals): void { for (const visual of visuals.values()) visual.dispose(); }
export async function prepareCustomVisuals(): Promise<CustomVisuals> {
  const visuals = new Map<CustomFighterKind, CustomVisual>();
  try {
    for (const pack of CUSTOM_PACKS) if (pack.prepareVisual) visuals.set(pack.kind, await pack.prepareVisual());
    return visuals;
  } catch (error) { disposeCustomVisuals(visuals); throw error; }
}
