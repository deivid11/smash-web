import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { ModelInstance } from '../../web/src/render/model-instance.ts';
import { PlayEffects } from '../../web/src/render/play-effects.ts';
import { PerspectiveCamera, Scene } from 'three';
import { NESS_ACTION_KEYS } from '../../lib/game/ness-data.ts';
import { activeHits } from '../../lib/game/moves.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';
import { MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';

describe('Ness registration', () => {
  it('reserves public-roster selector 12, native Ns kind, own narrator and bounded assets', () => {
    expect(ROSTER_CHOICES[12]).toBe('Ns'); expect(ROOM_FIGHTERS).toContain('Ns');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Ns' }))).toMatchObject({ fighter: 'Ns' });
    for (const name of ['PlNs.dat', 'PlNsAJ.dat', 'PlNsNr.dat', 'EfNsData.dat', 'audio/us/ness.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['PlNsRe.dat', 'PlKbCpNs.dat', 'audio/ness.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(MENU_SOUND_IDS.ness).toBe(0x7c84a); // gm_80168C5C CKIND_NESS=11
    expect(new Set(NESS_ACTION_KEYS.map(e => e.key)).size).toBe(32); // 31 keyed states + Wait->Wait1.
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Ness original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Ns', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; f.facing = i ? -1 : 1; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const f = () => game.fighters[0];
  const other = () => game.fighters[1]!;
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 63-joint skeleton and the decomp-named PSI parameters and articles', () => {
    const ns = f().content, p = ns.specials.parameters;
    expect(ns.profile.name).toBe('Ness'); expect(ns.profile.boneCount).toBe(63);
    if (p.kind !== 'Ns') throw new Error('wrong parameters');
    expect(p.flash.loop1).toBe(30); expect(p.flash.minChargeFrames).toBe(30);
    expect(p.thunder.momentum).toBeCloseTo(3.6, 5); expect(p.thunder.deceleration).toBeCloseTo(0.072, 5);
    expect(p.magnet.healMul).toBeCloseTo(2, 5); expect(p.magnet.absorb.radius).toBeCloseTo(8.5, 5);
    expect(p.yoyo.chargeDuration).toBe(60); expect(p.bat.maxDamage).toBe(50);
    const articles = ns.specials.articles.ness!;
    expect(articles.ball.speed).toBeCloseTo(2, 5); expect(articles.ball.turnRadius).toBeCloseTo(6, 5);
    expect(articles.flash.chargeCap).toBeCloseTo(100, 5); expect(articles.fire.lifetime).toBeCloseTo(20, 5);
    expect(articles.pillar.lifetime).toBeCloseTo(100, 5);
    for (const clip of ns.clips.values()) expect(clip.joints).toHaveLength(63);
    for (const name of Object.values(ns.moves)) expect(ns.attacks.get(name)!.events.some(e => e.type === 'create')).toBe(true);
  });
  it('fires PK Fire into Mario and burns him with the multihit pillar', () => {
    make(30);
    step({ special: true, specialDirection: 'side' });
    expect(f().animation).toBe('SpecialS');
    let bolt = false, pillar = false;
    for (let i = 0; i < 30 && !pillar; i++) { step(); bolt ||= game.projectiles.items.some(p => p.kind === 'pk-fire'); pillar = game.projectiles.items.some(p => p.kind === 'pk-fire-pillar'); }
    expect(bolt).toBe(true); expect(pillar).toBe(true);
    const before = other().percent;
    for (let i = 0; i < 60; i++) step();
    expect(other().percent).toBeGreaterThan(before + 4); // Pillar re-hits over its life.
  });
  it('controls PK Thunder into himself and launches PK Thunder 2 through Mario', () => {
    make(60);
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 70;
    step({ special: true, specialDirection: 'up' });
    expect(f().animation).toMatch(/^Special(Air)?HiStart/);
    let ball = false;
    for (let i = 0; i < 30 && !ball; i++) { step(); ball = game.projectiles.items.some(p => p.kind === 'pk-thunder'); }
    expect(ball).toBe(true);
    // Steer the ball back into Ness like a recovering player would.
    let pkt2 = false;
    for (let i = 0; i < 240 && !pkt2; i++) {
      const ball = game.projectiles.items.find(p => p.kind === 'pk-thunder');
      const dx = ball ? f().x - ball.x : 0, dy = ball ? f().y + 5 - ball.y : -1;
      const norm = Math.max(1e-6, Math.hypot(dx, dy));
      step({ x: dx / norm, y: dy / norm, down: dy < 0 });
      pkt2 = f().special?.phase === 'hit';
    }
    expect(pkt2).toBe(true);
    expect(Math.hypot(f().velocity.x, f().velocity.y)).toBeGreaterThan(2.5);
    // The launch direction depends on the contact point; assert the armed script hits instead.
    expect(f().animation).toMatch(/^Special(Air)?Hi$/);
    let armed = 0;
    for (let i = 0; i < 60 && f().special?.phase === 'hit'; i++) {
      step();
      const name = f().attackName;
      if (name) armed = Math.max(armed, ...activeHits(f().content.attacks.get(name)!, f().animationFrame).map(h => h.damage), armed);
    }
    expect(armed).toBeGreaterThanOrEqual(20); // ftNs SpecialAirHi flight hitboxes.
    for (let i = 0; i < 200 && f().state === 'special'; i++) step();
    expect(['helpless', 'landing', 'fall', 'idle']).toContain(f().state);
  });
  it('loads the two held smash items and the three PSI effect models', () => {
    const articles = f().content.specials.articles.ness!;
    // ftNs_Init_OnLoad registers It_Kind_Ness_Bat at slot 9 and It_Kind_Ness_Yoyo at slot 10;
    // the yo-yo has no state table of its own, so a strict reader would have dropped it.
    for (const held of [articles.bat, articles.yoyo]) {
      expect(held.model.stats.meshes).toBeGreaterThan(0);
      const instance = new ModelInstance(held.model); instance.update(4); instance.dispose();
    }
    // effNessDataTable 0-2 are efSync 1262/1263 and the efAsync 1264 magnet shield.
    const effects = f().content.specials.effects;
    for (const name of ['pk-thunder-aura', 'pk-thunder-2-aura', 'psi-magnet']) {
      expect(effects.get(name)?.stats.meshes ?? 0).toBeGreaterThan(0);
    }
  });
  it('puts the bat in Ness\u2019s hand for the whole forward smash', () => {
    make(60);
    const scene = new Scene(), effects = new PlayEffects(scene, content, rig, new PerspectiveCamera());
    try {
      let held = 0, swinging = 0;
      for (let i = 0; i < 60; i++) {
        step({ strong: i === 0, x: 1 });
        effects.update(game);
        if (f().state === 'attack' && f().attackName === 'AttackS4') { swinging++; held += effects.stats.models > 0 ? 1 : 0; }
      }
      expect(swinging).toBeGreaterThan(10);
      expect(held).toBe(swinging); // The bat exists on every frame of the swing, not just the hit.
      expect(effects.stats.models).toBe(0); // ...and is despawned with the move.
    } finally { effects.dispose(); }
  });
  it('keeps the PK Fire pillar on its own script cadence instead of a damage treadmill', () => {
    make(16);
    step({ special: true, specialDirection: 'side' });
    let pillar = false;
    for (let i = 0; i < 40 && !pillar; i++) { step(); pillar = game.projectiles.items.some(p => p.kind === 'pk-fire-pillar'); }
    expect(pillar).toBe(true);
    // Pin Mario inside the column for its whole life: the script can only land one 3% strike
    // and then a 2% hit every eight frames, so a full 100-frame trap stays far under 40%.
    const trapped = game.projectiles.items.find(p => p.kind === 'pk-fire-pillar')!;
    for (let i = 0; i < 140; i++) { other().x = trapped.x; other().y = trapped.y; step(); }
    // One 3% opener plus a 2% hit every eight frames across a 100-frame life is ~29%; the old
    // five-frame re-arm at the opener's 3% could reach 60% off a single bolt.
    expect(other().percent).toBeGreaterThan(20);
    expect(other().percent).toBeLessThan(34);
  });
  it('never lets PK Thunder hit its owner on the frames it is still inside him', () => {
    make(60);
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 90;
    step({ special: true, specialDirection: 'up' });
    let ball = false;
    for (let i = 0; i < 30 && !ball; i++) { step(); ball = game.projectiles.items.some(p => p.kind === 'pk-thunder'); }
    expect(ball).toBe(true);
    // Straight up, no steering: the ball leaves the 8.33 x 12.33 box and must not come back.
    for (let i = 0; i < 40; i++) step();
    expect(f().special?.phase).not.toBe('hit');
    expect(f().special?.ness?.thunderColl).toBe(0); // armed, waiting for a real re-entry
  });
  it('absorbs a Mario fireball with PSI Magnet and heals double its damage', () => {
    make(30);
    f().percent = 50;
    step({ special: true, specialDirection: 'down' });
    expect(f().animation).toMatch(/^SpecialLw/);
    for (let i = 0; i < 8; i++) step({ special: true });
    // Mario throws a fireball into the magnet.
    step({ special: true }, { special: true, specialDirection: 'neutral' });
    let healed = false;
    for (let i = 0; i < 90 && !healed; i++) { step({ special: true }); healed = f().percent < 50; }
    expect(healed).toBe(true);
    expect(f().percent).toBeLessThanOrEqual(50 - 10); // 6% fireball · 2.0 heal, rounded.
  });
  it('charges PK Flash and detonates it for charge-scaled damage', () => {
    make(60);
    step({ special: true, specialDirection: 'neutral' });
    let shot = false;
    for (let i = 0; i < 40 && !shot; i++) { step({ special: true }); shot = game.projectiles.items.some(p => p.kind === 'pk-flash'); }
    expect(shot).toBe(true);
    // Hover the ball over Mario and release once it has arced down next to him.
    for (let i = 0; i < 200; i++) {
      const ball = game.projectiles.items.find(p => p.kind === 'pk-flash');
      if (!ball) break;
      const dx = other().x - ball.x;
      const close = Math.abs(dx) < 5 && ball.y < 20;
      step(close ? {} : { special: true, x: Math.max(-1, Math.min(1, dx / 4)) });
      if (other().percent > 0) break;
    }
    expect(other().percent).toBeGreaterThanOrEqual(15); // Charge-scaled explosion connected.
    for (let i = 0; i < 120 && f().state === 'special'; i++) step();
    expect(f().state).not.toBe('special'); // The hold releases through Hold1 and NEnd.
  });
});
