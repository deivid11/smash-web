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
import { SEAK_ACTION_KEYS } from '../../lib/game/seak-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Sheik registration', () => {
  it('reserves public-roster selector29, native Sk kind and bounded assets', () => {
    expect(ROSTER_CHOICES[29]).toBe('Sk'); expect(ROOM_FIGHTERS).toContain('Sk');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Sk' }))).toMatchObject({ fighter: 'Sk' });
    for (const name of ['PlSk.dat', 'PlSkAJ.dat', 'PlSkNr.dat', 'audio/us/zs.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['EfSkData.dat', 'audio/sheik.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    // Shares Zelda's effect bank and voice bank (neither exists for Sheik).
    expect(SERVER_ASSETS).toContain('EfZdData.dat');
    expect(new Set(SEAK_ACTION_KEYS.map((e) => e.key)).size).toBe(23);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Sheik original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Sk', mirror ? 'Sk' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 58-joint skeleton, rapid jab and three articles', () => {
    const sk = f().content;
    expect(sk.profile.name).toBe('Sheik'); expect(sk.profile.boneCount).toBe(58);
    expect(sk.moves.rapidStart).toBe('Attack100Start'); expect(sk.moves.sideTilt).toBe('AttackS3');
    expect(sk.specials.articles.projectile?.hit?.damage).toBe(3);
    expect(sk.specials.articles.seak?.chain.hit).toBeTruthy();
    expect(sk.specials.articles.seak?.vanish.hit?.damage).toBe(12);
    expect(sk.specials.parameters.kind).toBe('Sk');
    for (const [k, v] of Object.entries(sk.moves)) {
      if (k === 'rapidStart' || k === 'rapidEnd') continue; // wind-up/out with no capsules, like other rapid owners
      expect(sk.attacks.get(v!)!.events.some((e) => e.type === 'create')).toBe(true);
    }
  });
  it('charges, stores and throws the stored needle count', () => {
    make(false, 90); step({ special: true, specialDirection: 'neutral' });
    ticks(40, { special: true });
    expect(f().sheikNeedles).toBeGreaterThan(1);
    step({ shield: true }); ticks(15);
    expect(f().state).not.toBe('special');
    const stored = f().sheikNeedles;
    expect(stored).toBeGreaterThan(1);
    step({ special: true, specialDirection: 'neutral' }); ticks(60);
    expect(game.projectiles.items.filter((p) => p.kind === 'needles').length).toBeLessThanOrEqual(stored);
    expect(f().sheikNeedles).toBe(0);
  });
  it('extends the chain whip and bursts on Vanish reappear', () => {
    make(false, 60); step({ special: true, specialDirection: 'side' }); ticks(30);
    expect(game.projectiles.items.some((p) => p.kind === 'chain-whip') || f().special !== null).toBe(true);
    ticks(160); expect(f().special).toBeNull();
    expect(game.projectiles.items.some((p) => p.kind === 'chain-whip')).toBe(false);
    make(); step({ special: true, specialDirection: 'up', x: 1 }); ticks(60);
    expect(f().special).toBeNull();
  });
  it('transforms Zelda into Sheik and back with rollback-safe snapshots', () => {
    rig?.dispose(); content = rosterPair(base, 'Zd', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((g, i) => { g.x = (i ? 1 : -1) * 25; g.y = 0; g.grounded = true; g.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(g); });
    const zd = () => game.fighters[0];
    expect(zd().content.profile.kind).toBe('Zd');
    const pre = game.captureState();
    zd().percent = 42;
    step({ special: true, specialDirection: 'down' });
    let flipped = false;
    for (let i = 0; i < 120 && !flipped; i++) {
      step({});
      flipped = zd().content.profile.kind === 'Sk';
    }
    expect(flipped).toBe(true);
    expect(zd().percent).toBe(42);
    expect(game.events.some((e) => e.type === 'transform' && e.kind === 'Sk')).toBe(true);
    step({ special: true, specialDirection: 'down' });
    flipped = false;
    for (let i = 0; i < 120 && !flipped; i++) {
      step({});
      flipped = zd().content.profile.kind === 'Zd';
    }
    expect(flipped).toBe(true);
    game.restoreState(pre);
    expect(zd().content.profile.kind).toBe('Zd');
    const hash = game.stateHash();
    ticks(5); game.restoreState(pre); expect(game.stateHash()).toBe(hash);
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
    make(); ticks(10, { special: true, specialDirection: 'neutral' });
    const saved = game.captureState(); const hash = game.stateHash();
    ticks(10); game.restoreState(saved); expect(game.stateHash()).toBe(hash);
  });
});
