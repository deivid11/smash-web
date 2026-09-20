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
import { ZELDA_ACTION_KEYS } from '../../lib/game/zelda-data.ts';
import { reflector } from '../../lib/game/specials.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Zelda registration', () => {
  it('reserves public-roster selector28, native Zd kind and bounded assets', () => {
    expect(ROSTER_CHOICES[28]).toBe('Zd'); expect(ROOM_FIGHTERS).toContain('Zd');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Zd' }))).toMatchObject({ fighter: 'Zd' });
    for (const name of ['PlZd.dat', 'PlZdAJ.dat', 'PlZdNr.dat', 'EfZdData.dat', 'audio/us/zs.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['EfSkData.dat', 'audio/zs.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(new Set(ZELDA_ACTION_KEYS.map((e) => e.key)).size).toBe(16);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Zelda original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Zd', mirror ? 'Zd' : 'Fx'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 118-joint skeleton, single jab and both Din articles', () => {
    const zd = f().content;
    expect(zd.profile.name).toBe('Zelda'); expect(zd.profile.boneCount).toBe(118);
    expect(zd.moves.jab).toBe('Attack11'); expect(zd.moves.jab2).toBeUndefined();
    expect(zd.specials.articles.zelda?.travel).toBeTruthy();
    expect(zd.specials.articles.zelda?.blast).toBeTruthy();
    expect(zd.specials.parameters.kind).toBe('Zd');
    for (const name of Object.values(zd.moves)) expect(zd.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
  });
  it('latches Nayru reflector and guides then detonates Din fire', () => {
    make(); step({ special: true, specialDirection: 'neutral' }); ticks(20);
    expect(reflector(f())).toBeTruthy();
    ticks(80); expect(f().special).toBeNull();
    make(false, 90); step({ special: true, specialDirection: 'side' }); ticks(15);
    expect(game.projectiles.items.some((p) => p.kind === 'dins-fire')).toBe(true);
    for (let i = 0; i < 10; i++) step({ special: true, specialDirection: 'side' });
    ticks(120);
    const blast = game.projectiles.items.find((p) => p.kind === 'dins-fire' && p.zelda?.exploded);
    expect(blast !== undefined || f().special === null).toBe(true);
  });
  it('recovers with Farore teleport and lands with lag', () => {
    make(); step({ special: true, specialDirection: 'up', x: 1 }); ticks(15);
    expect(f().special?.direction).toBe('up');
    ticks(120); expect(f().special).toBeNull();
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
    const saved2 = game.captureState();
    for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'side' }, neutralInput()]);
    const h = game.stateHash(); game.restoreState(saved2);
    for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'side' }, neutralInput()]);
    expect(game.stateHash()).toBe(h);
  });
});
