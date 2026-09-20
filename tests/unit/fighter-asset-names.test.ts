import { describe, expect, it } from 'vitest';
import { fighterAssetNames } from '../../lib/game/load.ts';

describe('roster prefetch file lists', () => {
  it('names every file an original fighter load reads', () => {
    expect(fighterAssetNames('Fx')).toEqual(['PlFx.dat', 'PlFxNr.dat', 'PlFxAJ.dat', 'EfFxData.dat']);
    expect(fighterAssetNames('Pp')).toContain('PlNnNr.dat');
    expect(fighterAssetNames('Kb')).toEqual(expect.arrayContaining(['PlKbAJ.dat', 'PlKbCpFx.dat', 'PlKbCpMr.dat']));
    expect(fighterAssetNames('custom:example.dummy')).toEqual([]);
  });
});
