import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';
import { GameSoundLibrary, SemTable, SsmBank } from '../../lib/game/audio.ts';

describe('Young Link registration', () => {
  it('appends public-roster selector 10, room kind and only verified assets', () => {
    expect(ROSTER_CHOICES[10]).toBe('Cl'); expect(ROOM_FIGHTERS).toContain('Cl');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Cl' }))).toMatchObject({ fighter: 'Cl' });
    for (const name of ['PlCl.dat', 'PlClAJ.dat', 'PlClNr.dat', 'audio/us/clink.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['EfClData.dat', 'audio/clink.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.younglink).toBe(0x7c843); // gm_80168C5C CKIND_CLINK=21
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Young Link original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch, announcerCues = 0;
  const make = (rival: 'Lk' | 'Mr' = 'Mr', gap = 35) => {
    rig?.dispose(); content = rosterPair(base, 'Cl', rival); rig = new GameRigs(content);
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
      announcerCues = names.cues(MENU_SOUND_IDS.younglink).filter(cue => cue.gain > 0).length;
    } finally { await disc.close(); }
  }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads its own 79-joint model, child attributes and announcer call, never borrowing adult content', () => {
    const cl = f().content, p = cl.profile;
    expect(p.name).toBe('Young Link'); expect(p.boneCount).toBe(79); expect(p.attributes.weight).toBe(85);
    expect(cl.canGrab).not.toBe(false); expect(cl.hookshot?.segments).toBe(10); expect(announcerCues).toBeGreaterThan(0);
    expect(cl).not.toBe(base.roster.get('Lk'));
    expect(cl.model).not.toBe(base.roster.get('Lk')!.model);
    for (const clip of cl.clips.values()) expect(clip.joints).toHaveLength(79);
    const params = cl.specials.parameters, adult = base.roster.get('Lk')!.specials.parameters;
    if (params.kind !== 'Cl' || adult.kind !== 'Lk') throw new Error('Wrong Link parameter kinds.');
    expect(params.neutral.chargeFrames).toBe(45); expect(adult.neutral.chargeFrames).toBe(60);
    expect(params.arrow.maxDamage).toBe(15); expect(params.side.maxAngle).toBeGreaterThan(adult.side.maxAngle);
  });
  it('fires its faster fire arrow with child damage bounds', () => {
    ticks(20, { special: true, specialDirection: 'neutral' });
    let arrow; for (let i = 0; i < 30 && !arrow; i++) { step(); arrow = game.projectiles.items.find(p => p.kind === 'arrow'); }
    expect(arrow).toBeDefined();
    expect(arrow!.hit.element).toBe(1); // fire, unlike the adult electric-free normal arrow
    expect(arrow!.hit.damage).toBeGreaterThanOrEqual(8); expect(arrow!.hit.damage).toBeLessThanOrEqual(15.01);
  });
  it('cycles its own boomerang out and back', () => {
    step({ special: true, specialDirection: 'side' });
    let out; for (let i = 0; i < 40 && !out; i++) { step(); out = game.projectiles.items.find(p => p.kind === 'boomerang'); }
    expect(out).toBeDefined(); expect(f().link.boomerang).toBe(out!.id);
    let caught = false;
    for (let i = 0; i < 400 && !caught; i++) { step(); caught = f().link.boomerang === null && game.projectiles.items.every(p => p.kind !== 'boomerang'); }
    expect(caught).toBe(true);
  });
  it('detonates the thrown bomb into the original three-pulse blast', () => {
    make('Mr', 60);
    step({ special: true, specialDirection: 'down' });
    for (let i = 0; i < 60 && !f().link.bomb; i++) step();
    expect(f().link.bomb).not.toBeNull();
    for (let i = 0; i < 120 && f().special; i++) step();
    step({ special: true, specialDirection: 'down' });
    expect(f().animation.startsWith('LightThrow')).toBe(true);
    for (let i = 0; i < 90 && f().link.bomb; i++) step();
    expect(f().link.bomb).toBeNull();
    const activations = new Set<number>();
    for (let i = 0; i < 400; i++) {
      step();
      const item = game.projectiles.items.find(p => p.kind === 'link-bomb') as { link?: { phase: string; activation: number } } | undefined;
      if (item?.link?.phase === 'explosion') activations.add(item.link.activation);
      if (!item && i > 5) break;
    }
    expect(activations.size).toBeGreaterThan(1); // child pulses re-activate; the adult blast is a single activation
    expect(game.fighters[1].percent).toBeGreaterThan(0);
  });
  it('spins upward and lands with its own recovery, then fights the adult without cross-talk', () => {
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 30;
    step({ special: true, specialDirection: 'up', y: 1 });
    expect(f().animation).toBe('SpecialAirHi'); expect(f().velocity.y).toBeGreaterThan(0);
    let landed = false;
    for (let i = 0; i < 300 && !landed; i++) { step(); landed = f().state === 'landing'; }
    expect(landed).toBe(true);
    make('Lk');
    expect(game.fighters[0].content.profile.name).toBe('Young Link');
    expect(game.fighters[1].content.profile.name).toBe('Link');
    step({ special: true, specialDirection: 'side' }, { special: true, specialDirection: 'side' });
    ticks(35);
    const kinds = game.projectiles.items.filter(p => p.kind === 'boomerang');
    expect(kinds).toHaveLength(2);
    expect(new Set(kinds.map(p => p.data)).size).toBe(2); // each rides its own article
    const state = game.captureState(); const hash = game.stateHash();
    ticks(6); game.restoreState(state); expect(game.stateHash()).toBe(hash);
  });
});
