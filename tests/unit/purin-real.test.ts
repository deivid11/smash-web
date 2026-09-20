import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { PURIN_ACTION_KEYS } from '../../lib/game/purin-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Jigglypuff registration', () => {
  it('reserves public-roster selector 11, native Pr kind, own narrator and bounded assets', () => {
    expect(ROSTER_CHOICES[11]).toBe('Pr'); expect(ROOM_FIGHTERS).toContain('Pr');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Pr' }))).toMatchObject({ fighter: 'Pr' });
    for (const name of ['PlPr.dat', 'PlPrAJ.dat', 'PlPrNr.dat', 'EfPrData.dat', 'audio/us/purin.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['PlKbCpPr.dat', 'audio/purin.ssm', 'audio/us/pupupu.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.jigglypuff).toBe(0x7c83d); // gm_80168C5C CKIND_PURIN=15
    expect(new Set(PURIN_ACTION_KEYS.map(e => e.key)).size).toBe(28); // 27 specials + the Wait->Wait1 idle mapping.
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Jigglypuff original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Pr', mirror ? 'Pr' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  const other = () => game.fighters[1]!;
  const air = (y = 100) => { f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = y; };
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 50-joint skeleton, five original air jumps and no phantom articles', () => {
    const pr = f().content, p = pr.specials.parameters;
    expect(pr.profile.name).toBe('Jigglypuff'); expect(pr.profile.boneCount).toBe(50);
    expect(pr.specials.articles).toEqual({});
    if (p.kind !== 'Pr') throw new Error('wrong parameters');
    expect(p.jumps.vertical).toHaveLength(5);
    for (const [i, expected] of [1.65, 1.59, 1.47, 1.36, 1.25].entries()) expect(p.jumps.vertical[i]).toBeCloseTo(expected, 5);
    expect(pr.airJumps?.animations).toEqual(['JumpAerialF1', 'JumpAerialF2', 'JumpAerialF3', 'JumpAerialF4', 'JumpAerialF5']);
    expect(pr.profile.attributes.maxJumps).toBe(6);
    expect(p.rollout.chargeMax).toBe(180); expect(p.rollout.releaseFrames).toBe(90); expect(p.rollout.landingLag).toBe(30);
    expect(p.pound.boost).toBeCloseTo(2.2, 5); expect(p.pound.decay).toBeCloseTo(0.92, 5);
    for (const clip of pr.clips.values()) expect(clip.joints).toHaveLength(50);
    for (const name of Object.values(pr.moves)) expect(pr.attacks.get(name)!.events.some(e => e.type === 'create')).toBe(true);
    expect(base.sound.cues(pr.specials.sounds.ko).length).toBeGreaterThan(0);
  });
  it('charges Rollout, releases into the roll and connects with speed-scaled damage', () => {
    make(false, 40);
    step({ special: true, specialDirection: 'neutral' });
    expect(f().state).toBe('special'); expect(f().animation).toMatch(/^SpecialNStart/);
    ticks(40, { special: true });
    expect(f().special?.phase).toBe('loop');
    const charged = f().special!.purin!.charge;
    expect(charged).toBeGreaterThan(50);
    ticks(1); // release B
    expect(f().special?.phase).toBe('travel'); expect(f().animation).toBe('SpecialNRelease');
    expect(Math.abs(f().velocity.x)).toBeGreaterThan(1);
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) { step(); hit = other().percent > 0; }
    expect(hit).toBe(true);
    expect(other().percent).toBeGreaterThanOrEqual(7); // 3·(2+|vel|) at roll speed
    expect(f().animation).toBe('SpecialNHit');
    for (let i = 0; i < 120 && f().state === 'special'; i++) step();
    expect(['landing', 'idle', 'fall', 'helpless']).toContain(f().state);
  });
  it('ends a short ground roll through SpecialNEnd back to idle without falling off', () => {
    make(false, 120); other().x = 200; other().grounded = false; other().floor = null; other().y = 500;
    step({ special: true, specialDirection: 'neutral' });
    for (let i = 0; i < 40 && f().special?.phase !== 'loop'; i++) step({ special: true });
    ticks(2, { special: true });
    ticks(1); // Barely charged: the roll stays well inside the stage.
    expect(f().special?.phase).toBe('travel');
    for (let i = 0; i < 400 && f().state === 'special'; i++) step();
    expect(['idle', 'landing']).toContain(f().state);
    expect(f().stocks).toBe(3); // Untouched default stocks: the roll never left the stage.
  });
  it('boosts the aerial Pound along the stick and decays it with the original 0.92 rate', () => {
    air();
    step({ special: true, specialDirection: 'side' });
    expect(f().animation).toBe('SpecialAirS');
    let boosted = 0;
    for (let i = 0; i < 40; i++) { step(); boosted = Math.max(boosted, Math.abs(f().velocity.x)); }
    expect(boosted).toBeGreaterThan(1.5);
    expect(f().state === 'special' || f().state === 'fall' || f().state === 'helpless').toBe(true);
  });
  it('sings an adjacent grounded Mario to sleep and lets him mash awake', () => {
    make(false, 12);
    step({ special: true, specialDirection: 'up' });
    expect(f().animation).toMatch(/^SpecialHi/);
    let asleep = false;
    for (let i = 0; i < 120 && !asleep; i++) { step(); asleep = other().state === 'dizzy'; }
    expect(asleep).toBe(true);
    expect(['FuraSleepStart', 'FuraSleepLoop']).toContain(other().animation);
    let awake = false;
    for (let i = 0; i < 200 && !awake; i++) { step({}, { attack: i % 2 === 0 }); awake = other().state !== 'dizzy'; }
    expect(awake).toBe(true);
  });
  it('lands the point-blank Rest for the original heavy hit', () => {
    make(false, 3);
    step({ special: true, specialDirection: 'down' });
    expect(f().animation).toMatch(/^SpecialLw/);
    let damage = 0;
    for (let i = 0; i < 20 && !damage; i++) { step(); damage = other().percent; }
    expect(damage).toBe(28); // ftPr SpecialLw create@1: 28% fire, radius 2 at part 5.
    expect(other().state === 'hitstun' || other().hitlag > 0).toBe(true);
  });
  it('spends all six original jumps before running out', () => {
    air(60);
    let used = 0;
    for (let i = 0; i < 200; i++) {
      const jump = i % 12 === 0;
      const before = f().jumpsUsed;
      step({ jump });
      if (f().jumpsUsed > before) used = f().jumpsUsed;
    }
    expect(used).toBe(6);
    expect(f().content.profile.attributes.maxJumps).toBe(6);
  });
});
