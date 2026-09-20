import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

// ftCo_LandingAir_EnterWithLag for every fighter: auto-cancel windows from the aerial script's
// cmd_vars[0] and the L-cancel (L/R/Z within PlCo xE4 frames halves the lag), so a short-hopped,
// fast-fallen, L-canceled Fox drill leaves the grounded rival in hitstun (drill → shine/grab).
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('aerial landing lag, auto-cancel and L-cancel', () => {
  let base: GameContent, content: GameContent, rig: GameRigs | undefined, game: LocalMatch;
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 120000);
  afterEach(() => { rig?.dispose(); rig = undefined; });
  const make = () => {
    content = rosterPair(base, 'Fx', 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    const floor = content.stage.floors.find((entry) => !entry.oneWay)!;
    game.fighters.forEach((f, i) => { f.x = i ? 0 : -5; f.y = floor.a[1]; f.grounded = true; f.floor = floor.id; f.facing = i ? -1 : 1; rig!.sample(f); });
    return floor.a[1];
  };
  const fox = () => game.fighters[0]!, mario = () => game.fighters[1]!;
  /** Short hop, down-air on the first airborne frame, hold down after the apex; `cancelAt` presses
   * shield that many frames before the landing frame (measured from a dry run). */
  const drill = (cancelBefore: number | null, landingFrame?: number) => {
    const ground = make();
    let frame = 0, attacked = false, apex = false, landed = -1;
    game.step([{ ...neutralInput(), jump: true }, neutralInput()]); frame++;
    while (frame < 80) {
      const input: Partial<PlayerInput> = { x: 0.3 };
      if (!fox().grounded && !attacked) { input.attack = true; input.y = -1; attacked = true; }
      if (!fox().grounded && fox().velocity.y < 0) apex = true;
      if (apex && !fox().grounded && fox().state === 'attack') { input.y = -1; input.down = true; }
      if (cancelBefore !== null && landingFrame !== undefined && frame + 1 === landingFrame - cancelBefore) input.shield = true;
      const airborne = !fox().grounded;
      game.step([{ ...neutralInput(), ...input }, neutralInput()]); frame++;
      if (airborne && fox().grounded) { landed = frame; break; }
    }
    expect(fox().y).toBeCloseTo(ground, 3);
    return { landed, lag: fox().landingFrames, animation: fox().animation };
  };

  it('short hops from a one-frame jump press (touch HOP) and full hops while jump stays held', () => {
    const takeoff = (held: boolean) => {
      make();
      game.step([{ ...neutralInput(), jump: true }, neutralInput()]);
      for (let i = 0; i < 10 && fox().grounded; i++) game.step([{ ...neutralInput(), jump: held }, neutralInput()]);
      return fox().velocity.y;
    };
    const attrs = () => fox().content.profile.attributes;
    expect(takeoff(false)).toBeCloseTo(attrs().hopSpeed, 4);
    expect(takeoff(true)).toBeCloseTo(attrs().jumpSpeed, 4);
  });

  it('keeps the full down-air landing lag without an L-cancel', () => {
    const dry = drill(null);
    expect(dry).toMatchObject({ lag: fox().content.profile.attributes.aerialDownLandingLag, animation: 'LandingAirLw' });
    expect(mario().percent).toBeGreaterThan(0);
  });

  it('halves it for a shield press within the 7-frame window and combos the grounded rival', () => {
    const { landed } = drill(null);
    const result = drill(3, landed);
    expect(result.landed).toBe(landed);
    expect(result.lag).toBe(Math.trunc(fox().content.profile.attributes.aerialDownLandingLag / 2));
    for (let i = 0; i < result.lag; i++) game.step([neutralInput(), neutralInput()]);
    expect(fox().state).toBe('idle');
    expect(mario().state).toBe('hitstun');
  });

  it('misses the L-cancel when the press comes too early', () => {
    const { landed } = drill(null);
    expect(drill(8, landed).lag).toBe(fox().content.profile.attributes.aerialDownLandingLag);
  });

  it('auto-cancels an aerial landing before the script arms its landing lag', () => {
    const ground = make();
    const f = fox();
    f.grounded = false; f.floor = null; f.y = ground + 2; f.velocity = { x: 0, y: -1 }; f.state = 'fall'; f.animation = 'Fall'; f.jumpsUsed = 1;
    game.step([{ ...neutralInput(), attack: true, y: -1 }, neutralInput()]);
    expect(f.attackName).toBe(f.content.moves.downAir);
    for (let i = 0; i < 6 && !f.grounded; i++) game.step([neutralInput(), neutralInput()]);
    expect(f).toMatchObject({ grounded: true, state: 'landing', animation: 'Landing', landingFrames: f.content.profile.attributes.landingLag });
  });

  it('forgets a press made before being hit', () => {
    make();
    const f = fox();
    game.step([{ ...neutralInput(), shield: true }, neutralInput()]);
    expect(f.link.shieldAge).toBe(0);
    (game as unknown as { change(f: unknown, s: string, a: string): void }).change(f, 'hitstun', 'DamageN1');
    expect(f.link.shieldAge).toBe(255);
  });
});
