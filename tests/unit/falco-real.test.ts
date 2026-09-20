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
import { FALCO_ACTION_KEYS } from '../../lib/game/falco-data.ts';
import { ROOM_FIGHTERS, parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Falco registration', () => {
  it('reserves public-roster selector21, native Fc kind and bounded assets', () => {
    expect(ROSTER_CHOICES[21]).toBe('Fc'); expect(ROOM_FIGHTERS).toContain('Fc');
    expect(parseClientMessage(JSON.stringify({ type: 'choose', token: 't', fighter: 'Fc' }))).toMatchObject({ fighter: 'Fc' });
    for (const name of ['PlFc.dat', 'PlFcAJ.dat', 'PlFcNr.dat', 'audio/us/falco.ssm']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['EfFcData.dat', 'audio/falco.ssm']) expect(SERVER_ASSETS).not.toContain(name);
    expect(new Set(FALCO_ACTION_KEYS.map((e) => e.key)).size).toBe(26);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Falco original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (mirror = false, gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Fc', mirror ? 'Fc' : 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0];
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the 67-joint skeleton, full normals and own articles', () => {
    const fc = f().content;
    expect(fc.profile.name).toBe('Falco'); expect(fc.profile.boneCount).toBe(67);
    expect(fc.moves.sideTilt).toBe('AttackS3S'); expect(fc.moves.upAir).toBe('AttackAirHi');
    expect(fc.specials.articles.projectile?.hit).toBeTruthy();
    expect(fc.specials.articles.ghost?.hit).toBeTruthy();
    // Falco uses his own PlFc.dat articles (slot 3 illusion, not Fox slot 2).
    for (const name of Object.values(fc.moves)) if (!name.startsWith('Attack100')) expect(fc.attacks.get(name)!.events.some((e) => e.type === 'create')).toBe(true);
  });
  it('fires its own laser and reflects with its own descent', () => {
    make(false, 80); step({ special: true, specialDirection: 'neutral' }); ticks(30);
    expect(game.projectiles.items.some((p) => p.kind === 'laser')).toBe(true);
    make(); step({ special: true, specialDirection: 'down' }); ticks(10);
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
  it('restores byte-identical snapshots and rolls back late inputs', () => {
    make(); ticks(10, { special: true, specialDirection: 'neutral' });
    const snap = game.captureState(); const hash = game.stateHash();
    ticks(10); game.restoreState(snap); expect(game.stateHash()).toBe(hash);
    const saved = game.captureState(); for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]); const h = game.stateHash(); game.restoreState(saved); for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), special: i === 5, specialDirection: 'neutral' }, neutralInput()]); expect(game.stateHash()).toBe(h);
  });
});
