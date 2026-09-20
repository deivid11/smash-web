import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { PEACH_ACTION_KEYS } from '../../lib/game/peach-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Peach registration', () => {
  it('reserves public-roster selector 14, native Pe kind, own narrator and bounded assets', () => {
    expect(ROSTER_CHOICES[14]).toBe('Pe'); expect(ROOM_FIGHTERS).toContain('Pe');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Pe' }))).toMatchObject({ fighter: 'Pe' });
    for (const name of ['PlPe.dat', 'PlPeAJ.dat', 'PlPeNr.dat', 'EfPeData.dat', 'audio/us/peach.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['audio/peach.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.peach).toBe(0x7c84b); // gm_80168C5C CKIND_PEACH=12
    expect(new Set(PEACH_ACTION_KEYS.map(e => e.key)).size).toBe(23);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Peach original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Pe', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const f = () => game.fighters[0];
  const other = () => game.fighters[1]!;
  const air = (y = 80) => { f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = y; };
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 114-joint skeleton, float clock, turnip faces and Toad bubble', () => {
    const pe = f().content, p = pe.specials.parameters;
    expect(pe.profile.name).toBe('Peach'); expect(pe.profile.boneCount).toBe(114);
    if (p.kind !== 'Pe') throw new Error('wrong parameters');
    expect(p.float.duration).toBe(150);
    expect(p.toad.counter.radius).toBeCloseTo(6, 5);
    const articles = pe.specials.articles.peach!;
    expect(articles.turnip.faces).toHaveLength(8);
    expect(articles.turnip.faces.reduce((sum, face) => sum + face.odds, 0)).toBe(58);
    expect(Math.max(...articles.turnip.faces.map(face => face.damage))).toBe(30); // Stitch-face.
    for (const clip of pe.clips.values()) expect(clip.joints).toHaveLength(114);
    for (const name of Object.values(pe.moves)) expect(pe.attacks.get(name)!.events.some(e => e.type === 'create')).toBe(true);
  });
  it('floats on held jump after the double jump for the original 150 frames', () => {
    air(60);
    f().jumpsUsed = f().content.profile.attributes.maxJumps;
    f().velocity.y = -0.5;
    for (let i = 0; i < 5; i++) step({ jump: true });
    expect(f().animation).toBe('Fuwafuwa');
    const y = f().y;
    for (let i = 0; i < 30; i++) step({ jump: true });
    expect(f().animation).toBe('Fuwafuwa');
    expect(Math.abs(f().y - y)).toBeLessThan(0.5); // The hover cancels gravity outright.
    step();
    expect(f().animation).toBe('Fall');
    expect(f().peachFloat.available).toBe(false);
  });
  it('bounces the Peach Bomber off Mario with the explosion rebound', () => {
    make(34);
    step({ special: true, specialDirection: 'side' });
    let launched = false, rebounded = false;
    for (let i = 0; i < 90 && !rebounded; i++) { step(); launched ||= f().animation === 'SpecialSJump'; rebounded = f().animation === 'SpecialAirSEnd1'; }
    expect(launched).toBe(true);
    expect(rebounded).toBe(true); // doAirEnd0: the SJump detect box swapped into the rebound.
    let hit = other().percent > 0;
    for (let i = 0; i < 20 && !hit; i++) { step(); hit = other().percent > 0; }
    expect(hit).toBe(true); // The explosion item landed.
  });
  it('pulls a turnip and throws it into Mario for its face damage', () => {
    make(30);
    expect(f().content.partDefaults?.[3]).toBe(-1); // ftPe_Init_OnDeath: the weapon group starts hidden.
    step({ special: true, specialDirection: 'down' });
    // spawnVeg on the pull script's throw flag (frame 1): the turnip is in hand at once.
    for (let i = 0; i < 3 && f().peachTurnip === null; i++) step();
    expect(f().peachTurnip).not.toBeNull();
    expect(f().special?.direction).toBe('down');
    for (let i = 0; i < 30 && f().state !== 'idle'; i++) step();
    step({ attack: true });
    expect(f().state).toBe('item-throw');
    expect(game.projectiles.items.some(p => p.kind === 'turnip')).toBe(true);
    expect(f().peachTurnip).toBeNull();
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) { step(); hit = other().percent > 0; }
    expect(hit).toBe(true);
  });
  it('counters a jab with Toad and releases the spore burst', () => {
    make(9);
    step({ special: true, specialDirection: 'neutral' });
    step({ special: true });
    for (let i = 0; i < 12 && f().special?.phase === 'start'; i++) step({}, { attack: i === 0 });
    expect(f().special?.phase).toBe('hit');
    expect(f().animation).toMatch(/SpecialNHit/);
    // doHitAnim: one spore per SpecialNHit command 3 (frames 10–26), not an instant burst.
    let spores = 0;
    for (let i = 0; i < 40; i++) { step(); spores += game.events.filter(e => e.type === 'shot' && e.projectileKind === 'toad-spore').length; }
    expect(spores).toBe(7);
    expect(other().percent).toBeGreaterThan(0);
  });
  it('draws a different random weapon for consecutive forward smashes', () => {
    make(80); other().x = 500; other().grounded = false; other().floor = null; other().y = 600;
    const names: string[] = [];
    for (let round = 0; round < 6; round++) {
      step({ strong: true });
      for (let i = 0; i < 10 && !f().animation.startsWith('AttackS4'); i++) step({ strong: true });
      names.push(f().animation);
      for (let i = 0; i < 120 && f().state !== 'idle'; i++) step();
    }
    expect(names.every(name => /^AttackS4(Club|Pan|Racket)$/.test(name))).toBe(true);
    expect(new Set(names).size).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < names.length; i++) expect(names[i]).not.toBe(names[i - 1]); // Never twice in a row.
  });
  it('drives her own parasol item: opcode 42 opens it at ItemParasolOpen frame 6 on FtPart 109', () => {
    // ftAction_80072894 → ftCommon_8007E83C(state 4, divisor 4) → it_802BDD40 (anim 0 at 15/4);
    // the renderer holds It_Kind_Peach_Parasol on FtPart 109 through the move (it_802BDA64).
    const fighter = rosterPair(base, 'Pe', 'Mr').fighters[0]!;
    expect(fighter.timelines.get('ItemParasolOpen')!.events.filter(event => event.type === 'parasol')).toEqual([{ frame: 6, type: 'parasol', state: 4, divisor: 4 }]);
    expect(fighter.timelines.get('ItemParasolOpen')!.ignoredOpcodes ?? []).not.toContain(42);
    expect(fighter.specials.articles.peach!.parasol.model.roots.length).toBeGreaterThan(0);
    expect(fighter.profile.partJoints[109]).toBeGreaterThanOrEqual(0);
  });
  it('opens the parasol after the aerial rise and folds it on stick down', () => {
    air(40);
    step({ special: true, specialDirection: 'up' });
    let open = false;
    for (let i = 0; i < 80 && !open; i++) { step(); open = f().animation === 'ItemParasolOpen'; }
    expect(open).toBe(true);
    const vy = f().velocity.y;
    expect(vy).toBeGreaterThanOrEqual(-0.6);
    step({ down: true, y: -1 });
    expect(f().animation).toBe('ItemParasolFall');
  });
});
