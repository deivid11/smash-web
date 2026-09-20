import { describe, expect, it } from 'vitest';
import { registerRosterFighter, type FighterContent, type GameContent } from '../../lib/game/load.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';

const stubFighter = (kind: FighterKind): FighterContent => ({ profile: { kind } }) as unknown as FighterContent;
const stubContent = (kinds: readonly FighterKind[]): GameContent =>
  ({ roster: new Map(kinds.map(kind => [kind, stubFighter(kind)])) }) as unknown as GameContent;

describe('shared roster registry between base and derived stage contents', () => {
  it('shares one roster map between base content and spread-derived stages', () => {
    const base = stubContent(['Fx', 'Mr']);
    // selectGameStage derives stages via object spread, sharing the roster map.
    const stage = { ...base };
    expect(stage.roster).toBe(base.roster);
  });

  it('keeps previously derived stages observing background-loaded fighters', () => {
    const base = stubContent(['Fx', 'Mr']);
    const stage = { ...base };
    registerRosterFighter(base, 'Kb', stubFighter('Kb'));
    expect(stage.roster.get('Kb')?.profile.kind).toBe('Kb');
  });

  it('starts matches on stage content for fighters loaded after stage derivation', () => {
    // Production failure: the ready-check (base roster) passed, then match
    // start on the earlier-derived stage content threw 'Unknown fighter
    // selection' and the online match never started.
    const base = stubContent(['Fx', 'Mr']);
    const stage = { ...base };
    registerRosterFighter(base, 'Kb', stubFighter('Kb'));
    expect(base.roster.has('Kb')).toBe(true);
    expect(() => rosterPlayers(stage, ['Fx', 'Kb'])).not.toThrow();
    expect(rosterPlayers(stage, ['Fx', 'Kb']).fighters.map(fighter => fighter.profile.kind)).toEqual(['Fx', 'Kb']);
  });
});
