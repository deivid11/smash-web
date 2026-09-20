import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { LUIGI_ACTION_KEYS } from '../../lib/game/luigi-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Luigi registration', () => {
  it('reserves public-roster selector26, native Lg kind and bounded assets', () => {
    expect(ROSTER_CHOICES[26]).toBe('Lg'); expect(ROOM_FIGHTERS).toContain('Lg');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Lg' }))).toMatchObject({ fighter: 'Lg' });
    for (const name of ['PlLg.dat', 'PlLgAJ.dat', 'PlLgNr.dat', 'EfLgData.dat', 'audio/us/luigi.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['PlLgRe.dat', 'EfDrData.dat', 'audio/luigi.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(new Set(LUIGI_ACTION_KEYS.map((e) => e.key)).size).toBe(17);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Luigi original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Lg', mirror ? 'Lg' : 'Fx'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 61-joint skeleton, full normals and own fireball', () => {
    const lg = f().content;
    expect(lg.profile.name).toBe('Luigi'); expect(lg.profile.boneCount).toBe(61);
    expect(lg.moves.jab3).toBe('Attack13'); expect(lg.moves.upAir).toBe('AttackAirHi');
    expect(lg.specials.articles.projectile?.hit).toBeTruthy();
    expect(lg.specials.parameters.kind).toBe('Lg');
    for (const name of Object.values(lg.moves)) expect(lg.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
  });
  it('throws fireballs and charges/releases the Green Missile', () => {
    make(false, 80); step({ special: true, specialDirection: 'neutral' }); ticks(30);
    expect(game.projectiles.items.some((p) => p.kind === 'fireball')).toBe(true);
    make(); step({ special: true, specialDirection: 'side' }); ticks(25);
    expect(['loop', 'travel', 'end'].includes(f().special?.phase ?? '')).toBe(true);
    ticks(200);
    expect(f().special).toBeNull();
  });
  it('launches a non-misfire Green Missile into Fly, carrying the launch hitbox into the rival', () => {
    make(false, 40);
    step({ special: true, x: 1, specialDirection: 'side' });
    f().special!.luigi!.misfire = false; // Pin the entry die: the normal launch path.
    let flew = false, hit = false;
    for (let i = 0; i < 80 && !hit; i++) {
      step({ special: i < 30 });
      if (f().animation === 'SpecialSFly') { flew = true; expect(f().grounded).toBe(false); expect(f().attackName).toBe('SpecialSLaunch'); }
      hit = game.fighters[1]!.percent > 0;
    }
    expect(flew).toBe(true);
    expect(hit).toBe(true);
    // ftLg_SpecialS_OnGiveDamage: stops dead into AirSEnd, then an ordinary Fall/landing.
    expect(f().animation).toMatch(/SpecialAirSEnd|SpecialSEnd/);
    for (let i = 0; i < 120 && f().special; i++) step();
    expect(f().state).not.toBe('helpless');
  });
  it('whiffs a tap missile: the low Fly arc lands straight into SpecialSEnd', () => {
    make(false, 100);
    step({ special: true, x: 1, specialDirection: 'side' });
    f().special!.luigi!.misfire = false;
    const seen = new Set<string>();
    for (let i = 0; i < 200 && f().special; i++) { step(); seen.add(f().animation); }
    // ftLg_SpecialAirS2_Coll: landing mid-Fly enters SpecialSEnd (no AirSEnd on a tap arc).
    for (const name of ['SpecialSStart', 'SpecialSHold', 'SpecialSLaunch', 'SpecialSFly', 'SpecialSEnd']) expect(seen.has(name)).toBe(true);
    expect(f().state).not.toBe('helpless');
  });
  it('spins the Cyclone in place and rises while mashing', () => {
    make(); const y0 = f().y;
    step({ special: true, specialDirection: 'down' });
    for (let i = 0; i < 30; i++) step(i % 4 === 0 ? { special: true, specialDirection: 'down' } : {});
    expect(f().y).toBeGreaterThan(y0);
    ticks(100); expect(f().special).toBeNull();
    make(); step({ special: true, specialDirection: 'up' }); ticks(60);
    expect(f().special).toBeNull();
  });
  it('poses every normal hitbox in both facings', () => {
    for (const name of Object.values(f().content.moves)) for (const facing of [-1, 1]) {
      const move = f().content.attacks.get(name)!, first = move.events.find((e) => e.type === 'create');
      if (!first) continue;
      f().animation = name; f().animationFrame = first.frame; f().facing = facing; rig.sample(f());
      for (const hit of activeHits(move, first.frame)) expect(rig.point(f(), hit.bone, hit.offset).every(Number.isFinite)).toBe(true);
    }
  });
  it('restores byte-identical snapshots and replays deterministically', () => {
    make(); ticks(10, { special: true, specialDirection: 'side' });
    const saved = game.captureState(); const hash = game.stateHash();
    ticks(10); game.restoreState(saved); expect(game.stateHash()).toBe(hash);
    const saved2 = game.captureState();
    for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]);
    const h = game.stateHash(); game.restoreState(saved2);
    for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]);
    expect(game.stateHash()).toBe(h);
  });
});
