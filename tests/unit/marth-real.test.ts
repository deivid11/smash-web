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
import { MARTH_ACTION_KEYS } from '../../lib/game/marth-data.ts';
import { royCounter } from '../../lib/game/roy.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Marth registration', () => {
  it('reserves public-roster selector25, native Ms kind and bounded assets', () => {
    expect(ROSTER_CHOICES[25]).toBe('Ms'); expect(ROOM_FIGHTERS).toContain('Ms');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Ms' }))).toMatchObject({ fighter: 'Ms' });
    for (const name of ['PlMs.dat', 'PlMsAJ.dat', 'PlMsNr.dat', 'EfMsData.dat', 'audio/us/mars.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['audio/mars.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(new Set(MARTH_ACTION_KEYS.map((e) => e.key)).size).toBe(32);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Marth original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Ms', mirror ? 'Ms' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 90-joint skeleton with jab2 and S31 tilt', () => {
    const ms = f().content;
    expect(ms.profile.name).toBe('Marth'); expect(ms.profile.boneCount).toBe(90);
    expect(ms.moves.jab2).toBe('Attack12'); expect(ms.moves.sideTilt).toBe('AttackS31');
    expect(ms.specials.articles).toEqual({});
    for (const name of Object.values(ms.moves)) expect(ms.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
  });
  it('charges Shield Breaker and counters through the shared Roy handler', () => {
    make(); step({ special: true, specialDirection: 'neutral' }); ticks(10);
    expect(f().special?.direction).toBe('neutral');
    make(false, 10); step({ special: true, specialDirection: 'down' }); ticks(5);
    expect(royCounter(f())).toBeTruthy();
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
    make(); ticks(10, { special: true, specialDirection: 'neutral' });
    const snap = game.captureState(); const hash = game.stateHash();
    ticks(10); game.restoreState(snap); expect(game.stateHash()).toBe(hash);
    const saved = game.captureState(); for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]); const h = game.stateHash(); game.restoreState(saved); for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]); expect(game.stateHash()).toBe(h);
  });
});
