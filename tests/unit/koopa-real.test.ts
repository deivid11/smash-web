import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { KOOPA_ACTION_KEYS } from '../../lib/game/koopa-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Bowser registration', () => {
  it('reserves public-roster selector 13, native Kp kind, own narrator and bounded assets', () => {
    expect(ROSTER_CHOICES[13]).toBe('Kp'); expect(ROOM_FIGHTERS).toContain('Kp');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Kp' }))).toMatchObject({ fighter: 'Kp' });
    for (const name of ['PlKp.dat', 'PlKpAJ.dat', 'PlKpNr.dat', 'EfKpData.dat', 'audio/us/koopa.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['audio/koopa.ssm', 'audio/us/gkoopa.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.bowser).toBe(0x7c840); // gm_80168C5C CKIND_KOOPA=5
    expect(new Set(KOOPA_ACTION_KEYS.map(e => e.key)).size).toBe(21);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Bowser original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Kp', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const f = () => game.fighters[0];
  const other = () => game.fighters[1]!;
  const air = (y = 80) => { f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = y; };
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 76-joint skeleton and the original breath/klaw/fortress/bomb parameters', () => {
    const kp = f().content, p = kp.specials.parameters;
    expect(kp.profile.name).toBe('Bowser'); expect(kp.profile.boneCount).toBe(76);
    if (p.kind !== 'Kp') throw new Error('wrong parameters');
    expect(p.breath.maxStrength).toBe(360); expect(p.breath.minStrength).toBe(40);
    expect(p.klaw.biteDamage).toBe(3); expect(p.fortress.landingLag).toBe(50);
    expect(p.bomb.diveSpeed).toBeCloseTo(-7.5, 5);
    const flame = kp.specials.articles.projectile!;
    expect(flame.speed).toBeCloseTo(1.9, 5); expect(flame.lifetime).toBeCloseTo(28, 5);
    for (const clip of kp.clips.values()) expect(clip.joints).toHaveLength(76);
    for (const name of Object.values(kp.moves)) expect(kp.attacks.get(name)!.events.some(e => e.type === 'create')).toBe(true);
  });
  it('breathes decaying fire into Mario and recovers the pool afterwards', () => {
    make(24);
    step({ special: true, specialDirection: 'neutral' });
    let flames = 0, burnt = false;
    for (let i = 0; i < 90; i++) { step({ special: true }); flames = Math.max(flames, game.projectiles.items.filter(p => p.kind === 'koopa-flame').length); burnt ||= other().percent > 0; }
    expect(flames).toBeGreaterThan(1);
    expect(burnt).toBe(true);
    const drained = f().koopaBreath;
    expect(drained).toBeLessThan(360);
    for (let i = 0; i < 200 && f().state === 'special'; i++) step();
    for (let i = 0; i < 90; i++) step();
    expect(f().koopaBreath).toBeGreaterThan(drained);
  });
  it('keeps the flame article mesh-free and takes its look from the fighter particle bank', () => {
    make(24);
    const article = f().content.specials.articles.projectile!;
    // itKoopaFlame carries no geometry at all: efSync 0x4DB-0x4DE spawn the look instead.
    expect(article.model.stats.meshes).toBe(0); expect(article.model.stats.vertices).toBe(0);
    const bank = f().content.specials.particles;
    expect(bank).toBeDefined();
    // efLib_CreateGenerator(0x2EE5..0x2EE8): the four flame variants live in EfKpData, not the common bank.
    for (const generator of [12005, 12006, 12007, 12008]) expect(bank!.definition(generator).life).toBeGreaterThan(0);
  });
  it('sends flames through a burned opponent on their original launch bounds', () => {
    make(24);
    const flame = f().content.specials.articles.koopa!;
    // itKoopaFlame_Spawn rolls speed inside x8..xC and the angle inside x10..x14 (from straight up).
    expect(flame.speed[0]).toBeCloseTo(1.9, 3); expect(flame.speed[1]).toBeCloseTo(2.2, 3);
    expect(flame.angle[0]).toBeGreaterThan(Math.PI / 2); expect(flame.angle[1]).toBeLessThan(Math.PI);
    step({ special: true, specialDirection: 'neutral' });
    let reach = 0, burned = false;
    for (let i = 0; i < 90; i++) {
      step({ special: true });
      burned ||= other().percent > 0;
      for (const p of game.projectiles.items) if (p.kind === 'koopa-flame') reach = Math.max(reach, p.x - f().x);
    }
    expect(burned).toBe(true);
    // itKoopaFlame_Logic111_DmgDealt returns false: burning someone does not end the flame, and
    // itKoopaFlame_Update_Direction/Angle rolls it along the floor instead of ending it there, so
    // the stream runs out to the article's own speed x lifetime instead of dying at the first thing
    // it touches.
    expect(reach).toBeGreaterThan(40);
  });
  it('lets a Klaw victim mash out of the bite loop', () => {
    make(10);
    const klaw = (f().content.specials.parameters as { klaw: { escapeBase: number } }).klaw;
    step({ special: true, x: 1, specialDirection: 'side' });
    for (let i = 0; i < 30 && other().state !== 'captured'; i++) step();
    expect(other().state).toBe('captured');
    // ftCommon_InitGrab(x4C): held while Bowser stays inside the special, but on the victim's clock.
    expect(other().combat.holdTimer).toBeCloseTo(klaw.escapeBase, 4);
    let freed = -1;
    for (let i = 1; i <= 120 && freed < 0; i++) { step({}, { attack: i % 2 === 0 }); if (other().state !== 'captured') freed = i; }
    expect(freed).toBeGreaterThan(0); expect(freed).toBeLessThan(klaw.escapeBase);
    for (let i = 0; i < 4; i++) step();
    expect(f().state).not.toBe('special'); // the bite loop drops out with nobody in the claw
  });
  it('command-grabs with the Klaw, bites and tosses forward', () => {
    make(14);
    step({ special: true, specialDirection: 'side' });
    let caught = false;
    for (let i = 0; i < 40 && !caught; i++) { step(); caught = other().state === 'captured'; }
    expect(caught).toBe(true);
    expect(f().animation).toMatch(/SpecialSHit0/);
    const bitten = () => other().percent;
    for (let i = 0; i < 90 && bitten() === 0; i++) step();
    expect(bitten()).toBeGreaterThan(0); // The bite script pummels the captured partner.
    step({ x: 1 });
    expect(f().state).toBe('throw');
    for (let i = 0; i < 60 && other().state === 'captured'; i++) step({ x: 1 });
    expect(other().state).not.toBe('captured');
  });
  it('spins the grounded Fortress into Mario and rises with the aerial one', () => {
    make(18);
    step({ special: true, specialDirection: 'up' });
    let hit = false;
    for (let i = 0; i < 80 && !hit; i++) { step({ x: 1 }); hit = other().percent > 0; }
    expect(hit).toBe(true);
    make(); air();
    step({ special: true, specialDirection: 'up' });
    expect(f().velocity.y).toBeGreaterThan(1.5); // x54 rise 1.78 minus the first fortress-gravity tick.
    for (let i = 0; i < 200 && f().state === 'special'; i++) step();
    expect(['helpless', 'landing', 'fall']).toContain(f().state);
  });
  it('plunges the aerial Bowser Bomb into the crash landing', () => {
    air(70);
    step({ special: true, specialDirection: 'down' });
    let diving = false;
    for (let i = 0; i < 60 && !diving; i++) { step(); diving = f().velocity.y <= -7; }
    expect(diving).toBe(true);
    for (let i = 0; i < 90 && f().special; i++) step();
    for (let i = 0; i < 90 && f().state !== 'idle'; i++) step();
    expect(f().state).toBe('idle');
  });
});
