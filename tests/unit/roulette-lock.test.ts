import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** GameSession needs a DOM + WebGL, so this pins the wiring instead: Rift Descent and tournament
 * entries must stand roulette chaos down and lock it, and every other mode entry must unlock it. */
const source = readFileSync(new URL('../../web/src/play/game-session.ts', import.meta.url), 'utf8');
const body = (name: string): string => { const start = source.indexOf(`  ${name}(`); return source.slice(start, source.indexOf('\n  }', start)); };

describe('roulette chaos lock', () => {
  it('Rift Descent and tournaments disarm and lock roulette', () => {
    for (const entry of ['rogueMenu', 'tournamentMenu']) { expect(body(entry)).toContain('this.setRoulette(false)'); expect(body(entry)).toContain('this.rouletteLocked = true'); }
  });
  it('arming is refused while locked', () => expect(body('setRoulette')).toContain('if (roulette && this.rouletteLocked)'));
  it('every other mode entry unlocks it', () => {
    for (const entry of ['chooseMode', 'chooseZombies', 'chooseRoulette', 'chooseHill', 'home']) expect(body(entry)).toContain('this.rouletteLocked = false');
    expect(source).toMatch(/changeFighters\(\): void \{ if \(!this\.online\) \{ this\.rouletteLocked = false;/u);
  });
});
