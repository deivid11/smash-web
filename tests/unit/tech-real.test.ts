import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchFighter, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('tech, knockdown and launch-direction prototype layer', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (a: 'Mr' | 'Pe' = 'Mr', gap = 10) => {
    rig?.dispose(); content = rosterPair(base, a, 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a, b); };
  /** Puts a fighter into an airborne tumble a few frames above the ground. */
  const tumble = (f: MatchFighter, y = 15) => {
    f.x = 0; f.y = y; f.grounded = false; f.floor = null;
    f.state = 'hitstun'; f.animation = 'DamageFlyN'; f.animationFrame = 0; f.animationEpoch++;
    f.hitstun = 60; f.velocity = { x: 0, y: 0 }; f.knockback = { x: 0, y: -1 };
  };
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the tech/knockdown clips for a vanilla fighter', () => {
    for (const name of ['Passive', 'PassiveStandF', 'PassiveStandB', 'PassiveWall', 'DownBoundU', 'DownWaitU', 'DownStandU']) {
      expect(game.fighters[0]!.content.clips.has(name), name).toBe(true);
    }
  });
  it('bounces a missed-tech tumble landing into the knockdown and auto-stands', () => {
    const f = game.fighters[0]!;
    tumble(f);
    for (let i = 0; i < 30 && f.state !== 'downed'; i++) step();
    expect(f.state).toBe('downed');
    expect(f.animation).toBe('DownBoundU');
    expect(f.hitstun).toBe(0);
    for (let i = 0; i < 60 && f.animation !== 'DownWaitU'; i++) step();
    expect(f.animation).toBe('DownWaitU');
    for (let i = 0; i < 120 && f.state !== 'idle'; i++) step();
    expect(f.state).toBe('idle');
  });
  it('techs in place on a fresh shield press within the window, with invulnerability', () => {
    const f = game.fighters[0]!;
    tumble(f);
    step({ shield: true });
    for (let i = 0; i < 30 && f.state === 'hitstun'; i++) step({ shield: true });
    expect(f.state).toBe('tech');
    expect(f.animation).toBe('Passive');
    expect(f.invulnerable).toBeGreaterThan(0);
    for (let i = 0; i < 80 && f.state === 'tech'; i++) step();
    expect(f.state).toBe('idle');
  });
  it('tech rolls with the held stick direction', () => {
    const f = game.fighters[0]!;
    f.facing = 1;
    tumble(f);
    step({ shield: true, x: 1 });
    for (let i = 0; i < 30 && f.state === 'hitstun'; i++) step({ shield: true, x: 1 });
    expect(f.state).toBe('tech');
    expect(f.animation).toBe('PassiveStandF');
    const from = f.x;
    for (let i = 0; i < 80 && f.state === 'tech'; i++) step();
    expect(f.state).toBe('idle');
    expect(f.x).not.toBe(from); // the roll carries its original root motion
  });
  it('a press outside the window knocks down instead (miss lockout)', () => {
    const f = game.fighters[0]!;
    tumble(f, 60);
    // Burn the window high in the air, then keep mashing: the 40-frame lockout
    // keeps the re-press from arming a fresh window before the landing.
    step({ shield: true });
    for (let i = 0; i < 25; i++) step();
    for (let i = 0; i < 60 && f.state === 'hitstun'; i++) step({ shield: i % 2 === 0 });
    expect(f.state).toBe('downed');
  });
  it('launches a victim standing behind the attacker away from it, not through it', () => {
    make('Mr', 6);
    const attacker = game.fighters[0]!, victim = game.fighters[1]!;
    attacker.x = 0; victim.x = -3; victim.percent = 80; attacker.facing = 1; rig.sample(attacker); rig.sample(victim);
    step({ strong: true, y: -1 }); // the down smash sweeps the back side too
    for (let i = 0; i < 50 && victim.percent === 80; i++) step({ y: -1 });
    expect(victim.percent).toBeGreaterThan(80);
    expect(victim.knockback.x).toBeLessThan(0); // sent away from the attacker's position
  });
  it('turns a back smash around out of the initial dash window, and only there (ftCo_AttackS4_8008C114)', () => {
    const f = game.fighters[0]!;
    ticks(3, { x: 1 });
    expect(f).toMatchObject({ state: 'run', animation: 'Dash', facing: 1 });
    step({ strong: true, x: -1 });
    expect(f.state).toBe('attack');
    expect(f.attackName).toBe(f.content.moves.strong);
    expect(f.facing).toBe(-1);
    // Past PlCo x44 the Dash IASA has no smash check: the back flick smash-turns instead.
    make(); ticks(6, { x: 1 });
    step({ strong: true, x: -1 });
    expect(game.fighters[0]!).toMatchObject({ state: 'idle', animation: 'Turn' });
  });
  it('lets Peach float without spending the double jump and through an aerial', () => {
    make('Pe');
    const peach = game.fighters[0]!;
    // Full hop holding jump: the float opens at the apex with the air jump unspent.
    step({ jump: true });
    ticks(6, { jump: true });
    for (let i = 0; i < 60 && peach.animation !== 'Fuwafuwa'; i++) step({ jump: true });
    expect(peach.animation).toBe('Fuwafuwa');
    expect(peach.jumpsUsed).toBeLessThan(peach.content.profile.attributes.maxJumps);
    const y = peach.y, timer = peach.peachFloat.timer;
    expect(timer).toBeGreaterThan(0);
    // A float-cancel aerial keeps hovering (gravity stays canceled) and resumes the float.
    step({ jump: true, attack: true });
    expect(peach.state).toBe('attack');
    ticks(10, { jump: true });
    expect(Math.abs(peach.y - y)).toBeLessThan(1);
    expect(peach.peachFloat.timer).toBeLessThan(timer);
    for (let i = 0; i < 60 && peach.state === 'attack'; i++) step({ jump: true });
    for (let i = 0; i < 10 && peach.animation !== 'Fuwafuwa'; i++) step({ jump: true });
    expect(peach.animation).toBe('Fuwafuwa');
  });
});
