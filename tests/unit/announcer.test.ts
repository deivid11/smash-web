import { describe, expect, it } from 'vitest';
import { announcerCue } from '../../web/src/play/game-session.ts';
import { isBonusFighter, MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';
import { ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { CUSTOM_FIGHTERS } from '../../lib/custom/registry.ts';
import type { FighterKind } from '../../lib/game/data.ts';

/** Every original-disc fighter announces its own name call on the CSS; custom and
 * ACE fighters fall back to the generic confirm cue (never another fighter's name). */
const ORIGINAL: readonly FighterKind[] = ['Fx', 'Mr', 'Kb', 'Ss', 'Pk', 'Fe', 'Lk', 'Ca', 'Dk', 'Mt', 'Cl', 'Pr', 'Ns', 'Kp', 'Pe', 'Fc', 'Dr', 'Gn', 'Pc', 'Ms', 'Lg', 'Pp', 'Zd', 'Sk', 'Gw', 'Ys'];
const CUSTOM: readonly FighterKind[] = [...CUSTOM_FIGHTERS, 'Zx', 'Td', 'Mk', 'Sn', 'Rc', 'Lz', 'Wf', 'Dd', 'De', 'Wr', 'Sh', 'Bl', 'Lc', 'Nm', 'Nt', 'Da', 'Fy', 'Sc', 'Dl', 'Kx', 'Lu', 'Lc2', 'Sm', 'Lb', 'MM', 'Sd', 'Cn', 'Gk', 'Ts', 'Bf', 'WfU'];

describe('character-select announcer', () => {
  it('covers every roster slot', () => {
    for (const kind of ROSTER_CHOICES) expect([...ORIGINAL, ...CUSTOM]).toContain(kind);
  });
  it('gives each original fighter its own narrator cue from nr_name.ssm', () => {
    const seen = new Set<number>();
    for (const kind of ORIGINAL) {
      const cue = announcerCue(kind);
      expect(cue).not.toBe('confirm');
      const id = MENU_SOUND_IDS[cue];
      expect(id).toBeGreaterThan(0x7c82f); expect(id).toBeLessThan(0x7c852);
      expect(seen.has(id)).toBe(false); seen.add(id);
    }
  });
  it('never borrows another fighter voice for custom characters', () => {
    for (const kind of CUSTOM) expect(announcerCue(kind)).toBe('confirm');
    expect(announcerCue(undefined)).toBe('confirm');
  });
  it('labels exactly the fighters without a name call as bonus characters', () => {
    for (const kind of ORIGINAL) expect(isBonusFighter(kind)).toBe(false);
    for (const kind of CUSTOM) expect(isBonusFighter(kind)).toBe(true);
  });
});
