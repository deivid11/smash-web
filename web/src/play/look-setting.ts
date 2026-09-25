import type { SourceManifest } from '../../../lib/hsd/source-protocol.ts';

/** The player's cosmetic look (lib/hsd/looks.ts), kept per browser. Nothing stored means the first
 * look the host offers (Animelee where the host serves it); 'original' keeps the disc's own art.
 * A look only swaps render data, so it never changes online compatibility. */
export const LOOK_KEY = 'smash-web.look';
export const ORIGINAL_LOOK = 'original';
function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export function loadLookPreference(): string | null {
  const value = storage()?.getItem(LOOK_KEY) ?? null;
  return value !== null && /^[a-z0-9-]{1,32}$/u.test(value) ? value : null;
}
export function saveLookPreference(value: string): void {
  try { storage()?.setItem(LOOK_KEY, value); } catch { /* private mode: the choice lasts this visit */ }
}
/** The look a session reads with: the stored choice when this host offers it, else the host's first
 * look; none for 'original' or a host without looks. */
export function chooseLook(manifest: Pick<SourceManifest, 'looks'>, stored: string | null = loadLookPreference()): string | null {
  if (stored === ORIGINAL_LOOK) return null;
  const looks = manifest.looks ?? [];
  return looks.find((look) => look.id === stored)?.id ?? looks[0]?.id ?? null;
}
