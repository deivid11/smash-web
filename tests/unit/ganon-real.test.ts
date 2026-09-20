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
import { GANON_ACTION_KEYS } from '../../lib/game/ganon-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Ganondorf registration', () => {
  it('reserves public-roster selector23, native Gn kind and bounded assets', () => {
    expect(ROSTER_CHOICES[23]).toBe('Gn'); expect(ROOM_FIGHTERS).toContain('Gn');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Gn' }))).toMatchObject({ fighter: 'Gn' });
    for (const name of ['PlGn.dat', 'PlGnAJ.dat', 'PlGnNr.dat', 'EfGnData.dat', 'audio/us/ganon.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['audio/ganon.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(new Set(GANON_ACTION_KEYS.map((e) => e.key)).size).toBe(18);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Ganondorf original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Gn', mirror ? 'Gn' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 84-joint skeleton with a single jab and no articles', () => {
    const gn = f().content;
    expect(gn.profile.name).toBe('Ganondorf'); expect(gn.profile.boneCount).toBe(84);
    expect(gn.moves.jab).toBe('Attack11'); expect(gn.moves.jab2).toBeUndefined();
    expect(gn.specials.articles).toEqual({});
    for (const name of Object.values(gn.moves)) expect(gn.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
  });
  it('runs Warlock Punch and Wizard Kick with Falcon-shared orchestration', () => {
    make(false, 14); step({ special: true, specialDirection: 'neutral' }); ticks(20);
    expect(f().special?.direction).toBe('neutral');
    make(false, 14); step({ special: true, specialDirection: 'down' }); ticks(20);
    expect(f().special?.direction).toBe('down');
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
    make(); ticks(10, { special: true, specialDirection: 'side' });
    const snap = game.captureState(); const hash = game.stateHash();
    ticks(10); game.restoreState(snap); expect(game.stateHash()).toBe(hash);
    const saved = game.captureState(); for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]); const h = game.stateHash(); game.restoreState(saved); for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]); expect(game.stateHash()).toBe(h);
  });
});
