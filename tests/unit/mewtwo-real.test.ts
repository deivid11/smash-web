import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { MEWTWO_ACTION_KEYS } from '../../lib/game/mewtwo-data.ts';
import { reflector } from '../../lib/game/specials.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Mewtwo registration', () => {
  it('appends public-roster selector 9, room kind and only verified assets', () => {
    expect(ROSTER_CHOICES[9]).toBe('Mt'); expect(ROOM_FIGHTERS).toContain('Mt');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Mt' }))).toMatchObject({ fighter: 'Mt' });
    for (const name of ['PlMt.dat', 'PlMtAJ.dat', 'PlMtNr.dat', 'EfMtData.dat', 'audio/us/mewtwo.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['audio/mewtwo.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.mewtwo).toBe(0x7c848);
    expect(new Set(MEWTWO_ACTION_KEYS.map(e => e.key)).size).toBe(19);
    expect(MEWTWO_ACTION_KEYS[0]).toEqual({ key: 'SpecialNStart', index: 244, figatree: 'SpecialNStart' });
    expect(MEWTWO_ACTION_KEYS.find(e => e.key === 'SpecialAirNLoopFull')).toEqual({ key: 'SpecialAirNLoopFull', index: 251, figatree: 'SpecialAirNLoop' });
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Mewtwo original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap = 35) => {
    rig?.dispose(); content = rosterPair(base, 'Mt', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('reads the 68-joint model, native attributes and idle without fabricated jabs', () => {
    const mt = f().content, p = mt.profile;
    expect(p.name).toBe('Mewtwo'); expect(p.boneCount).toBe(68); expect(p.attributes.weight).toBe(85); expect(p.attributes.maxJumps).toBe(2);
    expect(mt.model.stats.meshes).toBe(46); expect(mt.clips.get('Wait1')!.name).toContain('ACTION_Wait1_');
    expect(mt.moves.jab2).toBeUndefined(); expect(mt.moves.rapidStart).toBe('Attack100Start');
    for (const clip of mt.clips.values()) { expect(clip.joints).toHaveLength(68); expect(clip.name).toContain('PlyMewtwo5K_'); }
    for (const name of Object.values(mt.moves)) if (!name.startsWith('Attack100')) expect(mt.attacks.get(name)!.events.some(e => e.type === 'create')).toBe(true);
  });
  it('parses the original ftMewtwoAttributes and per-charge Shadow Ball articles', () => {
    const p = f().content.specials.parameters;
    if (p.kind !== 'Mt') throw new Error('wrong parameters');
    expect(p.neutral.chargeCycles).toBe(7); expect(p.neutral.chargeIterations).toBe(16);
    expect(p.side.airBoost).toBeCloseTo(1.5); expect(p.side.reflect.radius).toBe(10); expect(p.side.reflect.keepOwner).toBe(true);
    expect(p.up.duration).toBe(10); expect(p.up.landing).toBe(30); expect(p.down.offsetX).toBeCloseTo(4.5);
    const articles = f().content.specials.articles.mewtwo!;
    expect(articles.charges).toHaveLength(8);
    expect(articles.charges[0]!.hit!.damage).toBe(3); expect(articles.charges[7]!.hit!.damage).toBe(25);
    expect(articles.charges[7]!.model.stats.meshes).toBeGreaterThan(0);
    expect(articles.disable.hit!.damage).toBe(1); expect(articles.disable.hit!.element).toBe(12);
    expect(articles.disable.model.stats.meshes).toBe(0); // native Disable is particle-only
    expect(articles.wobblePeriod).toBe(12);
  });
  it('charges Shadow Ball in original 17-frame cycles and keeps it through a shield cancel', () => {
    step({ special: true, specialDirection: 'neutral' });
    ticks(90, { special: true });
    expect(f().special?.phase).toBe('loop');
    expect(f().mewtwoCharge).toBeGreaterThan(0); expect(f().mewtwoCharge).toBeLessThan(7);
    const banked = f().mewtwoCharge;
    step({ shield: true }); // SpecialNCancel stores the partial ball
    expect(f().animation).toContain('NCancel');
    ticks(60); expect(f().special).toBeNull(); expect(f().mewtwoCharge).toBe(banked);
  });
  it('reaches full charge, fires the 25% ball with recoil and resets the bank', () => {
    step({ special: true, specialDirection: 'neutral' });
    ticks(7 * 17 + 40, { special: true });
    expect(f().mewtwoCharge).toBe(7);
    expect(f().animation).toContain('NLoopFull');
    step({ attack: true });
    let shot = null; for (let i = 0; i < 40 && !shot; i++) { step(); shot = game.projectiles.items.find(p => p.kind === 'shadow-ball') ?? null; }
    expect(shot).not.toBeNull(); expect(shot!.hit.damage).toBe(25); expect(f().mewtwoCharge).toBe(0);
    const state = game.captureState(); const hash = game.stateHash(); ticks(3); game.restoreState(state); expect(game.stateHash()).toBe(hash);
    ticks(120); expect(f().special).toBeNull();
  });
  it('drops a partial charge on hit but keeps a full Shadow Ball', () => {
    const punish = () => { for (let i = 0; i < 60 && f().state !== 'hitstun'; i++) step({}, { attack: i === 0 }); expect(f().state).toBe('hitstun'); };
    make(8); f().mewtwoCharge = 4; punish(); expect(f().mewtwoCharge).toBe(0);
    make(8); f().mewtwoCharge = 7; punish(); expect(f().mewtwoCharge).toBe(7);
  });
  it('opens Confusion\'s script-owned reflect window with original bounds', () => {
    step({ special: true, specialDirection: 'side' });
    let bubble = null; for (let i = 0; i < 60 && !bubble; i++) { step(); bubble = reflector(f()); }
    expect(bubble).not.toBeNull(); expect(bubble!.radius).toBe(10); expect(bubble!.damageMultiplier).toBeCloseTo(1.5); expect(bubble!.keepOwner).toBe(true);
    ticks(80); expect(f().special).toBeNull();
  });
  it('grants the Confusion air boost once per airtime', () => {
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 60;
    step({ special: true, specialDirection: 'side' });
    expect(f().velocity.y).toBeCloseTo(1.5 - f().content.profile.attributes.gravity, 3); expect(f().mewtwoBoostUsed).toBe(true);
    ticks(70); expect(f().special).toBeNull();
    step({ special: true, specialDirection: 'side' });
    expect(f().velocity.y).toBeLessThan(1);
  });
  it('teleports along the stick, stays intangible during the zoom and ends helpless', () => {
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 40;
    step({ special: true, specialDirection: 'up', y: 1 });
    let launched = false; for (let i = 0; i < 40 && !launched; i++) { step({ y: 1 }); launched = f().special?.phase === 'travel'; }
    expect(launched).toBe(true);
    const startY = f().y; expect(f().invulnerable).toBeGreaterThan(0); expect(f().animation).toBe('SpecialHiLost');
    ticks(10, { y: 1 });
    expect(f().y - startY).toBeGreaterThan(30); // 10 frames at momentum·1 + momentumAdd = 5/frame
    let done = false; for (let i = 0; i < 90 && !done; i++) { step(); done = f().state === 'helpless' || f().state === 'landing'; }
    expect(done).toBe(true);
  });
  it('fires Disable\'s short-lived original projectile from the hand offsets', () => {
    make(12);
    step({ special: true, specialDirection: 'down' });
    let shot = null; for (let i = 0; i < 60 && !shot; i++) { step(); shot = game.projectiles.items.find(p => p.kind === 'disable') ?? null; }
    expect(shot).not.toBeNull(); expect(shot!.hit.damage).toBe(1); expect(Math.abs(shot!.vx)).toBeCloseTo(2.7, 1);
    ticks(10); expect(game.projectiles.items.filter(p => p.kind === 'disable')).toHaveLength(0);
    ticks(80); expect(f().special).toBeNull();
  });
  it('replays Shadow Ball wobble and Teleport deterministically after a rollback restore', () => {
    const saved = game.captureState();
    const commands: Array<[Partial<PlayerInput>, Partial<PlayerInput>]> = Array.from({ length: 160 }, (_, i) => [
      i < 60 ? { special: true, specialDirection: 'neutral' } : i === 62 ? { attack: true } : i === 100 ? { special: true, specialDirection: 'up', y: 1 } : i > 100 && i < 115 ? { y: 1 } : {},
      i === 40 ? { special: true, specialDirection: 'neutral' } : {},
    ]);
    for (const [a, b] of commands) step(a, b); const hash = game.stateHash();
    game.restoreState(saved); for (const [a, b] of commands) step(a, b);
    expect(game.stateHash()).toBe(hash);
  });
});
