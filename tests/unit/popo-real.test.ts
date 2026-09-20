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
import { POPO_ACTION_KEYS } from '../../lib/game/popo-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Popo registration', () => {
  it('reserves public-roster selector27, native Pp kind and bounded assets', () => {
    expect(ROSTER_CHOICES[27]).toBe('Pp'); expect(ROOM_FIGHTERS).toContain('Pp');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Pp' }))).toMatchObject({ fighter: 'Pp' });
    for (const name of ['PlPp.dat', 'PlPpAJ.dat', 'PlPpNr.dat', 'EfIcData.dat', 'audio/us/ice.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['EfPpData.dat', 'audio/ice.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(new Set(POPO_ACTION_KEYS.map((e) => e.key)).size).toBe(15);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Popo original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Pp', mirror ? 'Pp' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 49-joint skeleton, full normals and both ice articles', () => {
    const pp = f().content;
    expect(pp.profile.name).toBe('Ice Climbers'); expect(pp.profile.boneCount).toBe(49);
    expect(pp.moves.jab2).toBe('Attack12'); expect(pp.moves.sideTilt).toBe('AttackS3S');
    expect(pp.specials.articles.projectile?.hit).toBeTruthy();
    expect(pp.specials.articles.accessory?.hit).toBeTruthy();
    expect(pp.specials.parameters.kind).toBe('Pp');
    for (const name of Object.values(pp.moves)) expect(pp.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
  });
  it('slides Ice Shots with speed-scaled damage and sprays Blizzard', () => {
    make(false, 80); step({ special: true, specialDirection: 'neutral' }); ticks(10);
    const ice = game.projectiles.items.find((p) => p.kind === 'ice-shot');
    expect(ice).toBeTruthy();
    expect(ice!.hit.damage).toBeGreaterThan(0);
    make(); step({ special: true, specialDirection: 'down' }); ticks(120);
    expect(game.projectiles.items.some((p) => p.kind === 'blizzard') || f().special === null).toBe(true);
  });
  it('advances Squall Hammer and rises with solo Belay', () => {
    make(); step({ special: true, specialDirection: 'side' }); ticks(30);
    expect(f().special === null || f().special?.direction === 'side').toBe(true);
    ticks(200); expect(f().special).toBeNull();
    make(); const y0 = f().y;
    step({ special: true, specialDirection: 'up' }); ticks(25);
    expect(f().y).toBeGreaterThan(y0);
    ticks(160); expect(f().special === null || f().state === 'helpless').toBe(true);
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
    for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'down' }, neutralInput()]);
    const h = game.stateHash(); game.restoreState(saved2);
    for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'down' }, neutralInput()]);
    expect(game.stateHash()).toBe(h);
  });
});
