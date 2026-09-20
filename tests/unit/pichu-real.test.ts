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
import { PICHU_ACTION_KEYS } from '../../lib/game/pichu-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Pichu registration', () => {
  it('reserves public-roster selector24, native Pc kind and bounded assets', () => {
    expect(ROSTER_CHOICES[24]).toBe('Pc'); expect(ROOM_FIGHTERS).toContain('Pc');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Pc' }))).toMatchObject({ fighter: 'Pc' });
    for (const name of ['PlPc.dat', 'PlPcAJ.dat', 'PlPcNr.dat', 'audio/us/pichu.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['EfPcData.dat', 'audio/pichu.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(PICHU_ACTION_KEYS.length).toBe(25);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Pichu original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Pc', mirror ? 'Pc' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 46-joint skeleton with single jab and own thunder articles', () => {
    const pc = f().content;
    expect(pc.profile.name).toBe('Pichu'); expect(pc.profile.boneCount).toBe(46);
    expect(pc.moves.jab).toBe('Attack11'); expect(pc.moves.jab2).toBeUndefined();
    expect(pc.specials.articles.projectile?.hit).toBeTruthy();
    expect(pc.specials.articles.pikachu?.groundPath.length).toBeGreaterThan(10);
    for (const name of Object.values(pc.moves)) expect(pc.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
  });
  it('fires jolts and runs Skull Bash with Pikachu-shared orchestration', () => {
    make(false, 80); step({ special: true, specialDirection: 'neutral' }); ticks(30);
    expect(game.projectiles.items.some((p) => p.kind === 'tjolt')).toBe(true);
    make(); step({ special: true, specialDirection: 'side' }); ticks(10);
    expect(f().special?.direction).toBe('side');
  });
  it('poses every normal hitbox in both facings', () => {
    for (const name of Object.values(f().content.moves)) for (const facing of [-1, 1]) {
      const move = f().content.attacks.get(name)!, first = move.events.find((e) => e.type === 'create');
      if (!first) continue;
      f().animation = name; f().animationFrame = first.frame; f().facing = facing; rig.sample(f());
      for (const hit of activeHits(move, first.frame)) expect(rig.point(f(), hit.bone, hit.offset).every(Number.isFinite)).toBe(true);
    }
  });
  it('restores snapshots and rolls back', () => {
    make(); ticks(10, { special: true, specialDirection: 'up' });
    const snap = game.captureState(); const hash = game.stateHash();
    ticks(10); game.restoreState(snap); expect(game.stateHash()).toBe(hash);
    const saved = game.captureState(); for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]); const h = game.stateHash(); game.restoreState(saved); for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]); expect(game.stateHash()).toBe(h);
  });
});
