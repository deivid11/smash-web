import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { linkActionKeys, LINK_ITEM_MOTIONS } from '../../lib/game/link-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';
import { GameSoundLibrary, SemTable, SsmBank } from '../../lib/game/audio.ts';

describe('Link registration', () => {
  it('appends public-roster selector 6, room kind and only verified assets', () => {
    expect(ROSTER_CHOICES[6]).toBe('Lk'); expect(ROOM_FIGHTERS).toContain('Lk');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Lk' }))).toMatchObject({ fighter: 'Lk' });
    for (const name of ['PlLk.dat', 'PlLkAJ.dat', 'PlLkNr.dat', 'EfLkData.dat', 'audio/us/link.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['audio/link.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.link).toBe(0x7c842); // gm_80168C5C CKIND_LINK=6
    expect(new Set(linkActionKeys('Lk').map(e => e.key)).size).toBe(linkActionKeys('Lk').length);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Link original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch, announcerCues = 0;
  const make = (mirror = false, gap = 35) => {
    rig?.dispose(); content = rosterPair(base, 'Lk', mirror ? 'Lk' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      base = await loadGameContent(session, new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
      const names = new GameSoundLibrary(new SemTable(await session.bytes('audio/us/smash2.sem')), [new SsmBank(await session.bytes('audio/us/nr_name.ssm'))]);
      announcerCues = names.cues(MENU_SOUND_IDS.link).filter(cue => cue.gain > 0).length;
    } finally { await disc.close(); }
  }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 75-joint model, native attributes, hookshot articles and its announcer call', () => {
    const lk = f().content, p = lk.profile;
    expect(p.name).toBe('Link'); expect(p.boneCount).toBe(75); expect(p.attributes.weight).toBe(104);
    expect(lk.canGrab).not.toBe(false); expect(lk.hookshot?.segments).toBe(15); expect(announcerCues).toBeGreaterThan(0);
    for (const clip of lk.clips.values()) expect(clip.joints).toHaveLength(75);
    for (const name of Object.values(lk.moves)) if (!name.startsWith('Attack100')) expect(lk.attacks.get(name)!.events.some(e => e.type === 'create')).toBe(true);
    for (const name of ['AttackS42', ...LINK_ITEM_MOTIONS, 'SpecialNStart', 'SpecialLw', 'SpecialHi', 'SpecialAirHi']) expect(lk.attacks.has(name)).toBe(true);
    expect(activeHits(lk.attacks.get('AttackS42')!, 10).length).toBeGreaterThan(0);
  });
  it('connects the jab and starts its original hookshot grab', () => {
    make(false, 10); step({ attack: true }); ticks(10); expect(game.fighters[1].percent).toBeGreaterThan(0);
    make(false, 10); step({ grab: true }); ticks(3); expect(f().state).toBe('grab'); expect(f().animation).toBe('Catch');
  });
  it('chains the gated second forward smash from AttackS41 into AttackS42', () => {
    step({ strong: true }); expect(f().animation).toBe('AttackS41');
    let chained = false;
    for (let i = 0; i < 60 && !chained; i++) { step({ attack: i % 2 === 0 }); chained = f().animation === 'AttackS42'; }
    expect(chained).toBe(true);
    ticks(140); expect(f().state).not.toBe('attack');
  });
  it('charges the bow and fires a stronger arrow after holding', () => {
    const damage = (hold: number) => {
      make(false, 60);
      ticks(hold, { special: true, specialDirection: 'neutral' });
      let arrow; for (let i = 0; i < 30 && !arrow; i++) { step(); arrow = game.projectiles.items.find(p => p.kind === 'arrow'); }
      expect(arrow).toBeDefined();
      return arrow!.hit.damage;
    };
    const quick = damage(20), full = damage(90);
    const p = f().content.specials.parameters;
    if (p.kind !== 'Lk') throw new Error('Missing Link parameters.');
    expect(quick).toBeGreaterThanOrEqual(p.arrow.minDamage); expect(full).toBeGreaterThan(quick);
    expect(full).toBeLessThanOrEqual(p.arrow.maxDamage + 0.01);
    ticks(120); expect(game.projectiles.items.filter(p => p.kind === 'arrow')).toHaveLength(0);
  });
  it('throws one boomerang, blocks a second while out, and catches the return', () => {
    step({ special: true, specialDirection: 'side' });
    let out; for (let i = 0; i < 40 && !out; i++) { step(); out = game.projectiles.items.find(p => p.kind === 'boomerang'); }
    expect(out).toBeDefined(); expect(f().link.boomerang).toBe(out!.id);
    ticks(40); // finish the throw, then attempt a second while it flies
    if (!f().special) step({ special: true, specialDirection: 'side' });
    expect(game.projectiles.items.filter(p => p.kind === 'boomerang').length).toBeLessThanOrEqual(1);
    let caught = false;
    for (let i = 0; i < 400 && !caught; i++) { step(); caught = f().link.boomerang === null && game.projectiles.items.every(p => p.kind !== 'boomerang'); }
    expect(caught).toBe(true);
  });
  it('pulls a held bomb, throws it, and the fuse or impact detonates into the original blast', () => {
    make(false, 60); // far enough that the throw arc descends into the target
    step({ special: true, specialDirection: 'down' });
    let bomb; for (let i = 0; i < 60 && !bomb; i++) { step(); bomb = game.projectiles.items.find(p => p.kind === 'link-bomb'); }
    expect(bomb).toBeDefined(); expect(f().link.bomb).toBe(bomb!.id);
    for (let i = 0; i < 120 && f().special; i++) step(); // recover into idle while holding
    step({ special: true, specialDirection: 'down' });
    expect(f().animation.startsWith('LightThrow')).toBe(true);
    let released = false;
    for (let i = 0; i < 90 && !released; i++) { step(); released = f().link.bomb === null; }
    expect(released).toBe(true);
    let exploded = false;
    for (let i = 0; i < 400 && !exploded; i++) { step(); const item = game.projectiles.items.find(p => p.kind === 'link-bomb'); exploded = !!item && (item as { link?: { phase: string } }).link?.phase === 'explosion'; if (!item && i > 5) break; }
    expect(exploded).toBe(true); expect(game.fighters[1].percent).toBeGreaterThan(0);
    ticks(120); expect(game.projectiles.items.filter(p => p.kind === 'link-bomb')).toHaveLength(0);
  });
  it('rises with the aerial spin attack and lands helpless with the original landing lag', () => {
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 30;
    const startY = f().y;
    step({ special: true, specialDirection: 'up', y: 1 });
    expect(f().animation).toBe('SpecialAirHi'); expect(f().velocity.y).toBeGreaterThan(0);
    ticks(8); expect(f().y).toBeGreaterThan(startY);
    let landed = false;
    for (let i = 0; i < 300 && !landed; i++) { step(); landed = f().state === 'landing'; }
    expect(landed).toBe(true); expect(f().special).toBeNull();
  });
  it('keeps hashes stable across capture/restore with a boomerang and held bomb live', () => {
    step({ special: true, specialDirection: 'down' });
    for (let i = 0; i < 60 && !f().link.bomb; i++) step();
    for (let i = 0; i < 120 && f().special; i++) step();
    step({ special: true, specialDirection: 'side' });
    for (let i = 0; i < 40 && !f().link.boomerang; i++) step();
    expect(game.projectiles.items.length).toBeGreaterThan(0);
    const state = game.captureState(); const hash = game.stateHash();
    ticks(7); game.restoreState(state); expect(game.stateHash()).toBe(hash);
    ticks(7); // restored world keeps stepping without duplicating held items
    expect(game.projectiles.items.filter(p => p.kind === 'link-bomb').length).toBeLessThanOrEqual(1);
  });
  it('mirrors cleanly and reverts to originals without leaking Link state', () => {
    make(true); step({ special: true, specialDirection: 'side' }, { special: true, specialDirection: 'side' });
    ticks(40);
    expect(game.fighters[1].content.profile.kind).toBe('Lk');
    make(false); expect(game.fighters[1].content.profile.kind).toBe('Mr');
    expect(game.fighters[1].link.boomerang).toBeNull(); expect(game.fighters[1].link.bomb).toBeNull();
  });
});
