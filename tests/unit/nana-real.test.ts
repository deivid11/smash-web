import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Nana registration', () => {
  it('exposes her bounded model assets and nothing else new', () => {
    // USA v1.02 holds PlNn Nr/Aq/Wh/Ye — there are no PlNnRe/Gr/Or files,
    // and her data/action/effect banks stay unexposed: she rides Popo's slot.
    for (const name of ['PlNnNr.dat', 'PlNnAq.dat', 'PlNnWh.dat', 'PlNnYe.dat']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['PlNnRe.dat', 'PlNnGr.dat', 'PlNnOr.dat', 'PlNn.dat', 'PlNnAJ.dat', 'EfNnData.dat']) expect(SERVER_ASSETS).not.toContain(name);
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Ice Climbers duo integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (gap = 50) => {
    rig?.dispose(); content = rosterPair(base, 'Pp', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * gap / 2; f.y = 0; f.grounded = true; f.floor = content.stage.floors.find((floor) => !floor.oneWay)!.id; rig.sample(f); });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const popo = () => game.fighters[0]!;
  const rival = () => game.fighters[1]!;
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads her twin model on Popo\u2019s skeleton and spawns the duo', () => {
    const pp = popo().content;
    expect(pp.partnerModel).toBeTruthy();
    expect(pp.partnerModel!.roots[0]!.joints.length).toBe(pp.profile.boneCount);
    expect(popo().nana).toMatchObject({ active: true, percent: 0 });
    expect(rig.partners.has(0)).toBe(true);
    expect(rig.partners.has(1)).toBe(false);
  });
  it('trails Popo back to her anchor while idling', () => {
    make(120);
    popo().x = 0;
    expect(Math.abs(popo().nana!.x - popo().x)).toBeGreaterThan(20);
    ticks(120);
    expect(Math.abs(popo().nana!.x - (popo().x - popo().facing * 9))).toBeLessThan(6);
    expect(popo().nana!.grounded).toBe(true);
  });
  it('lands her own hammer when the rival crowds her (echo damage)', () => {
    make(60);
    // Park the rival on Nana's spot, out of Popo's forward reach.
    for (let i = 0; i < 30; i++) step();
    rival().x = popo().nana!.x; rival().y = popo().nana!.y; rival().grounded = true;
    popo().facing = 1; rival().facing = -1;
    step({ attack: true }); ticks(40);
    expect(rival().percent).toBeGreaterThan(0);
  });
  it('bleeds her own percent pool when struck, then tumbles back', () => {
    make(60);
    for (let i = 0; i < 30; i++) step();
    const nana = popo().nana!;
    // Rival smashes from Nana's side while Popo stands clear.
    rival().x = nana.x + 6; rival().y = nana.y; rival().grounded = true; rival().facing = -1;
    const before = popo().percent;
    step({ strong: true }, { attack: true }); ticks(60);
    expect(nana.percent + popo().percent).toBeGreaterThan(before);
    expect(popo().state).not.toBe('hitstun');
  });
  it('goes Sopo when launched and revives on Popo\u2019s next stock', () => {
    make();
    const nana = popo().nana!;
    nana.x = 9999; nana.invulnerable = 0;
    step();
    expect(popo().nana!.active).toBe(false);
    expect(game.events.some((e) => e.type === 'ko')).toBe(true);
    // Popo fights on alone, then loses the stock: the duo respawns together.
    popo().x = 9999;
    ticks(400);
    expect(popo().stocks).toBe(2);
    expect(popo().nana!.active).toBe(true);
    expect(popo().nana!.percent).toBe(0);
  });
  it('restores her across rollback and replays deterministically', () => {
    const run = () => {
      make();
      for (let n = 0; n < 90; n++) step({ x: Math.sin(n / 9) > 0 ? 1 : -1, jump: n === 20, attack: n % 30 === 10 }, { x: n % 40 < 20 ? -1 : 1, shield: n % 50 < 8 });
      return game.stateHash();
    };
    expect(run()).toBe(run());
    make();
    for (let n = 0; n < 45; n++) step({ attack: n % 15 === 0 }, { shield: n % 20 < 5 });
    const snapshot = game.captureState();
    const nanaBefore = { ...popo().nana! };
    for (let n = 0; n < 45; n++) step({ x: 1 }, { x: -1 });
    expect(game.stateHash()).not.toBe(game.stateHash(snapshot));
    game.restoreState(snapshot);
    expect(popo().nana).toEqual(nanaBefore);
    expect(game.stateHash()).toBe(game.stateHash(snapshot));
    expect(game.snapshot().fighters[0]!.nana).toMatchObject({ active: nanaBefore.active });
  });
});
