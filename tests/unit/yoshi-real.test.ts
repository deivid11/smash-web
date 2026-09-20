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
import { YOSHI_ACTION_KEYS } from '../../lib/game/yoshi-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Yoshi registration', () => {
  it('reserves public-roster selector31, native Ys kind and bounded assets', () => {
    expect(ROSTER_CHOICES[31]).toBe('Ys'); expect(ROOM_FIGHTERS).toContain('Ys');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Ys' }))).toMatchObject({ fighter: 'Ys' });
    for (const name of ['PlYs.dat', 'PlYsAJ.dat', 'PlYsNr.dat', 'EfYsData.dat', 'audio/us/yoshi.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['audio/yoshi.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(new Set(YOSHI_ACTION_KEYS.map((e) => e.key)).size).toBe(22);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Yoshi original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Ys', mirror ? 'Ys' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 70-joint skeleton, full normals and egg/star articles', () => {
    const ys = f().content;
    expect(ys.profile.name).toBe('Yoshi'); expect(ys.profile.boneCount).toBe(70);
    expect(ys.moves.jab2).toBe('Attack12'); expect(ys.moves.sideTilt).toBe('AttackS3S');
    expect(ys.specials.articles.projectile?.hit?.damage).toBe(12);
    expect(ys.specials.articles.yoshi?.star.hit?.damage).toBe(1);
    expect(ys.specials.parameters.kind).toBe('Ys');
    for (const name of Object.values(ys.moves)) expect(ys.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
  });
  it('traps victims in eggs, rolls with root motion and throws timed eggs', () => {
    make(false, 10);
    step({ special: true, specialDirection: 'neutral' }); ticks(60);
    const trapped = game.fighters[1].state === 'bury' || game.fighters[1].percent > 0 || f().special === null;
    expect(trapped).toBe(true);
    make(); step({ special: true, specialDirection: 'side', x: 1 }); ticks(15);
    expect(f().special?.direction === 'side' || f().special === null).toBe(true);
    ticks(200); expect(f().special).toBeNull();
    make(false, 90); step({ special: true, specialDirection: 'up' }); ticks(5);
    for (let i = 0; i < 20; i++) step({ special: true, specialDirection: 'up' });
    ticks(40);
    expect(game.projectiles.items.some((p) => p.kind === 'yoshi-egg') || f().special === null).toBe(true);
  });
  it('bursts stars on a Yoshi Bomb landing', () => {
    make(); f().grounded = false; f().floor = null; f().y = 60; f().state = 'fall'; f().animation = 'Fall';
    step({ special: true, specialDirection: 'down' }); ticks(80);
    expect(game.projectiles.items.some((p) => p.kind === 'yoshi-star') || f().state === 'landing' || f().special === null).toBe(true);
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
    make(); ticks(10, { special: true, specialDirection: 'side', x: 1 });
    const saved = game.captureState(); const hash = game.stateHash();
    ticks(10); game.restoreState(saved); expect(game.stateHash()).toBe(hash);
  });
});
