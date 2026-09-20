import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type MatchOptions, type PlayerInput } from '../../lib/game/match.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { activeHits } from '../../lib/game/moves.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('playable slice with original local disc data', () => {
  let content: GameContent, rig: GameRigs, game: LocalMatch;
  const make = (options: MatchOptions = {}) => {
    rig?.dispose(); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, ...options }); game.start(); return game;
  };
  const idle = (frames: number) => { for (let i = 0; i < frames; i++) game.step([neutralInput(), neutralInput()]); };
  const closeRange = () => {
    game.fighters.forEach((fighter, slot) => { fighter.x = slot === 0 ? -6 : 6; fighter.y = 0; fighter.floor = 1; fighter.grounded = true; rig.sample(fighter); });
  };
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const info = await verifyMeleeDisc(disc);
      const wasm = new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
      content = await loadGameContent(new HsdAssetSession(disc, info), wasm);
    } finally { await disc.close(); }
  });
  beforeEach(() => { make(); });
  afterEach(() => rig.dispose());

  it('uses original Battlefield scale, floors, and blast zones', () => {
    expect(content.stage.scale).toBeCloseTo(0.8, 6);
    expect(content.stage.mainLeft).toBeCloseTo(-68.4, 4); expect(content.stage.mainRight).toBeCloseTo(68.4, 4);
    expect(content.stage.blast.left).toBeCloseTo(-224, 4); expect(content.stage.floors.filter((floor) => floor.oneWay)).toHaveLength(3);
  });
  it('runs different original gravity and jump attributes through the C routines', () => {
    expect(content.physics.air(0, { x: 0, y: 0 }, 0, false).y).toBeCloseTo(-0.23, 6);
    expect(content.physics.air(1, { x: 0, y: 0 }, 0, false).y).toBeCloseTo(-0.095, 6);
    expect(content.physics.jump(0, { x: 0, y: 0 }, 0, false).y).toBeCloseTo(3.68, 6);
    expect(content.physics.jump(1, { x: 0, y: 0 }, 0, false).y).toBeCloseTo(2.3, 6);
  });
  it('uses the original RNG for reproducible practice-bot choices', () => {
    content.physics.seed(1); expect(content.physics.random()).toBe(41 / 65536);
  });
  it('moves in response to held input rather than playing an in-place clip', () => {
    for (let i = 0; i < 10; i++) game.step([{ ...neutralInput(), x: 1 }, neutralInput()]);
    expect(game.fighters[0].x).toBeGreaterThan(15); expect(game.fighters[0].velocity.x).toBeGreaterThan(0);
  });
  it('distinguishes a short hop from a held jump', () => {
    const peak = (held: number) => {
      make(); let maximum = 0;
      for (let frame = 0; frame < 70; frame++) { game.step([{ ...neutralInput(), jump: frame < held }, neutralInput()]); maximum = Math.max(maximum, game.fighters[0].y); }
      return maximum;
    };
    expect(peak(12)).toBeGreaterThan(peak(1) + 10);
  });
  it('allows a double jump but not unlimited air jumps', () => {
    for (let i = 0; i < 8; i++) game.step([{ ...neutralInput(), jump: true }, neutralInput()]);
    idle(1); game.step([{ ...neutralInput(), jump: true }, neutralInput()]);
    expect(game.fighters[0].jumpsUsed).toBe(2); expect(game.fighters[0].state).toBe('airjump');
    idle(1); const velocity = game.fighters[0].velocity.y;
    game.step([{ ...neutralInput(), jump: true }, neutralInput()]);
    expect(game.fighters[0].jumpsUsed).toBe(2); expect(game.fighters[0].velocity.y).toBeLessThan(velocity);
  });
  it('drops through the original one-way platform and lands on the main floor', () => {
    const height = game.fighters[1].y;
    game.step([neutralInput(), { ...neutralInput(), down: true }]);
    expect(game.fighters[1].grounded).toBe(false); expect(game.fighters[1].y).toBeLessThan(height);
    idle(70); expect(game.fighters[1].grounded).toBe(true); expect(game.fighters[1].y).toBeCloseTo(0);
  });
  it('starts fast-falling only after a down input during descent', () => {
    for (let i = 0; i < 22; i++) game.step([{ ...neutralInput(), jump: i < 12 }, neutralInput()]);
    expect(game.fighters[0].velocity.y).toBeLessThan(0);
    game.step([{ ...neutralInput(), down: true }, neutralInput()]);
    expect(game.fighters[0].fastFall).toBe(true);
    expect(game.fighters[0].velocity.y).toBeLessThan(-content.fighters[0].profile.attributes.terminal);
  });
  it('aligns original hitbox bones with the rendered forward direction', () => {
    closeRange(); const fighter = game.fighters[0]; fighter.animation = fighter.content.moves.jab; fighter.animationFrame = 3;
    rig.sample(fighter); const hit = activeHits(fighter.content.attacks.get(fighter.animation)!, 3)[0]!;
    expect(rig.point(fighter, hit.bone, hit.offset)[0]).toBeGreaterThan(fighter.x);
    fighter.facing = -1; rig.sample(fighter);
    expect(rig.point(fighter, hit.bone, hit.offset)[0]).toBeLessThan(fighter.x);
  });
  it('deals original jab damage once per hit activation, not every overlap frame', () => {
    closeRange(); game.step([{ ...neutralInput(), attack: true }, neutralInput()]); idle(40);
    expect(game.fighters[1].percent).toBe(4); expect(game.fighters[1].x).toBeGreaterThan(6);
  });
  it.each([0, 1])('chains jab 1 into jab 2 at the original script gate for slot %s', (slot) => {
    const fighter = game.fighters[slot]!;
    const press = () => { const inputs = [neutralInput(), neutralInput()] as const; inputs[slot]!.attack = true; game.step(inputs); };
    press(); idle(1); press(); // queue before the frame-6 gate
    expect(fighter.animation).toBe('Attack11'); idle(4);
    expect(fighter.animation).toBe('Attack12'); expect(fighter.attackSerial).toBe(2);
    const gate = fighter.content.attacks.get('Attack11')!.events.find((event) => event.type === 'jab' && event.kind === 'combo' && event.enabled);
    expect(gate?.frame).toBe(6);
  });
  it('plays Mario punch, punch, kick rather than restarting jab 1', () => {
    const names: string[] = [];
    for (let frame = 0; frame < 35; frame++) {
      game.step([neutralInput(), { ...neutralInput(), attack: frame < 13 && frame % 4 === 0 }]);
      const name = game.fighters[1].animation; if (names.at(-1) !== name) names.push(name);
    }
    expect(names).toEqual(['Attack11', 'Attack12', 'Attack13', 'Wait1']);
  });
  it('enters Fox rapid kicks by tapping, repeats cycles, and plays the ending on release', () => {
    const names: string[] = [];
    for (let frame = 0; frame < 160; frame++) {
      game.step([{ ...neutralInput(), attack: frame < 110 && frame % 4 === 0 }, neutralInput()]);
      const name = game.fighters[0].animation; if (names.at(-1) !== name) names.push(name);
    }
    expect(names).toEqual(['Attack11', 'Attack12', 'Attack100Start', 'Attack100Loop', 'Attack100End', 'Wait1']);
    expect(game.fighters[0].attackSerial).toBeGreaterThan(6); expect(game.fighters[0].jab).toBeNull();
  });
  it('hands a grounded normal back to Wait_IASA at its authored interrupt frame', () => {
    const press = (a: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, neutralInput()]);
    const dashAttack = () => { const f = game.fighters[0]; f.x = -60; f.y = 0; f.grounded = true; f.floor = 1; rig.sample(f);
      for (let i = 0; i < 6; i++) press({ x: 1 }); press({ x: 1, attack: true }); expect(f.attackName).toBe(f.content.moves.dash); return f; };
    const move = content.fighters[0]!.attacks.get(content.fighters[0]!.moves.dash)!;
    const end = content.fighters[0]!.clips.get(content.fighters[0]!.moves.dash)!.endFrame, iasa = move.interruptFrame!;
    expect(iasa).toBeGreaterThan(0); expect(iasa).toBeLessThan(end);
    // ftCo_AttackDash_IASA never ends the move on its own: with no input it still plays out.
    let fighter = dashAttack();
    while (fighter.state === 'attack' && fighter.animationFrame < end) press();
    expect(Math.round(fighter.animationFrame)).toBeGreaterThanOrEqual(Math.floor(end));
    // Shielding inside the window takes the recovery instead (ftCo_Wait_IASA -> Guard).
    make(); fighter = dashAttack();
    while (fighter.animationFrame < iasa) { press(); expect(fighter.state).toBe('attack'); }
    press({ shield: true });
    expect(fighter.state).toBe('shield'); expect(fighter.animationFrame).toBeLessThan(end);
  });
  it.each([0, 1])('does not turn a held quick button into an automatic combo for slot %s', (slot) => {
    for (let frame = 0; frame < 100; frame++) {
      const inputs = [neutralInput(), neutralInput()] as const; inputs[slot]!.attack = true; game.step(inputs);
    }
    expect(game.fighters[slot]!.attackSerial).toBe(1); expect(game.fighters[slot]!.state).toBe('idle');
  });
  it('retains a jab press through hitlag without advancing the combo window', () => {
    closeRange(); game.step([{ ...neutralInput(), attack: true }, neutralInput()]);
    for (let i = 0; i < 10 && game.fighters[0].hitlag === 0; i++) idle(1);
    const fighter = game.fighters[0], window = fighter.jab!.window;
    game.step([{ ...neutralInput(), attack: true }, neutralInput()]);
    expect(fighter.jab!.window).toBe(window); expect(fighter.jab!.queued).toBe(true);
    for (let i = 0; i < 20 && fighter.animation !== 'Attack12'; i++) idle(1);
    expect(fighter.animation).toBe('Attack12');
  });
  it('allows a late jab within the original window, but resets after it expires', () => {
    game.step([{ ...neutralInput(), attack: true }, neutralInput()]); idle(20);
    expect(game.fighters[0].state).toBe('idle');
    game.step([{ ...neutralInput(), attack: true }, neutralInput()]); expect(game.fighters[0].animation).toBe('Attack12');
    idle(40); game.step([{ ...neutralInput(), attack: true }, neutralInput()]); expect(game.fighters[0].animation).toBe('Attack11');
  });
  it('clears a pending jab on movement instead of chaining after running', () => {
    game.step([{ ...neutralInput(), attack: true }, neutralInput()]); idle(19);
    game.step([{ ...neutralInput(), x: 1 }, neutralInput()]); expect(game.fighters[0].jab).toBeNull();
  });
  it.each([0, 1])('selects original down tilt and down smash on the ground for slot %s', (slot) => {
    // A fresh down-tap with attack smashes (original flick input); holding the
    // crouch first expires the flick window, so the same button tilts instead.
    // Pin the seat to the main floor: P2 spawns over a pass-through platform
    // that the held crouch would otherwise drop through.
    game.fighters.forEach((fighter, seat) => { fighter.x = seat === 0 ? -6 : 6; fighter.y = 0; fighter.floor = 1; fighter.grounded = true; });
    const held = [neutralInput(), neutralInput()] as const; held[slot]!.down = true;
    for (let i = 0; i < 10; i++) game.step(held);
    expect(game.fighters[slot]!.state).toBe('crouch');
    const inputs = [neutralInput(), neutralInput()] as const; inputs[slot]!.down = true; inputs[slot]!.attack = true;
    game.step(inputs); expect(game.fighters[slot]!.animation).toBe('AttackLw3'); expect(game.fighters[slot]!.grounded).toBe(true);
    idle(60); inputs[slot]!.attack = false; inputs[slot]!.strong = true; game.step(inputs);
    expect(game.fighters[slot]!.animation).toBe('AttackLw4');
  });
  it.each([0, 1])('uses the down aerial, original multihits, and its landing clip/lag for slot %s', (slot) => {
    const fighter = game.fighters[slot]!;
    fighter.x = 0; fighter.y = 10; fighter.grounded = false; fighter.floor = null; fighter.state = 'fall'; fighter.velocity.y = -1;
    const inputs = [neutralInput(), neutralInput()] as const; inputs[slot]!.y = -1; inputs[slot]!.attack = true;
    game.step(inputs); expect(fighter.animation).toBe('AttackAirLw');
    const move = fighter.content.attacks.get('AttackAirLw')!;
    const activations = new Set(Array.from({ length: 40 }, (_, frame) => activeHits(move, frame)).flat().map((hit) => hit.activation));
    expect(activations.size).toBeGreaterThan(1);
    for (let i = 0; i < 30 && !fighter.grounded; i++) idle(1);
    expect(fighter.animation).toBe('LandingAirLw'); expect(fighter.landingFrames).toBe(fighter.content.profile.attributes.aerialDownLandingLag);
  });
  it('holds the original crouch pose and permits a low attack from it', () => {
    game.fighters[0].x = -30; game.fighters[0].y = 0; game.fighters[0].floor = 1;
    for (let i = 0; i < 20; i++) game.step([{ ...neutralInput(), down: true }, neutralInput()]);
    expect(game.fighters[0].animation).toBe('SquatWait');
    game.step([{ ...neutralInput(), down: true, attack: true }, neutralInput()]); expect(game.fighters[0].animation).toBe('AttackLw3');
  });
  it('freezes attacker animation during hitlag', () => {
    closeRange(); game.step([{ ...neutralInput(), attack: true }, neutralInput()]);
    for (let i = 0; i < 8 && game.fighters[0].hitlag === 0; i++) idle(1);
    expect(game.fighters[0].hitlag).toBeGreaterThan(0);
    const frame = game.fighters[0].animationFrame; idle(1);
    expect(game.fighters[0].animationFrame).toBe(frame);
  });
  it('nudges grounded fighters apart using their original nudge bounds', () => {
    game.fighters.forEach((fighter) => { fighter.x = 0; fighter.y = 0; fighter.grounded = true; fighter.floor = 1; });
    idle(10); expect(game.fighters[0].x).toBeLessThan(game.fighters[1].x);
  });
  it('loses a stock beyond the original blast zone and respawns invulnerably', () => {
    game.fighters[0].percent = 77; game.fighters[0].x = content.stage.blast.right + 1;
    idle(1); expect(game.fighters[0].stocks).toBe(2); expect(game.fighters[0].state).toBe('ko');
    idle(46); expect(game.fighters[0].state).toBe('respawn'); expect(game.fighters[0].percent).toBe(0); expect(game.fighters[0].invulnerable).toBeGreaterThan(0);
  });
  it('ends the match after the last stock and stops advancing it', () => {
    make({ stocks: 1 }); game.fighters[0].x = content.stage.blast.right + 1; idle(1);
    expect(game.phase).toBe('ended'); expect(game.winner).toBe(1);
    const snapshot = game.snapshot(); idle(30); expect(game.snapshot()).toEqual(snapshot);
  });
  it('handles simultaneous final-stock knockouts without player-order bias', () => {
    make({ stocks: 1 }); game.fighters[0].x = content.stage.blast.right + 1; game.fighters[1].x = content.stage.blast.left - 1; idle(1);
    expect(game.phase).toBe('ended'); expect(game.winner).toBeNull();
  });
  it('ends a tied timer match as a prototype draw', () => { make({ seconds: 1 }); idle(60); expect(game.phase).toBe('ended'); expect(game.winner).toBeNull(); });
  it('rejects invalid prototype match rules', () => {
    expect(() => new LocalMatch(content, rig, { stocks: 0 })).toThrow('Invalid');
    expect(() => new LocalMatch(content, rig, { seconds: NaN })).toThrow('Invalid');
  });
  it('repeats a fixed-input run in the same runtime', () => {
    const run = () => {
      make({ opponent: 'bot' });
      for (let frame = 0; frame < 900; frame++) game.step([{ ...neutralInput(), x: Math.sin(frame / 90) > 0 ? 1 : -1, jump: frame % 50 < 10, attack: frame % 30 === 0, strong: frame % 91 === 0 }, neutralInput()]);
      return game.snapshot();
    };
    expect(run()).toEqual(run());
  });
  it('completes a scripted local battle with actual hits and knockouts', () => {
    make({ opponent: 'bot' }); let hits = 0, knockouts = 0;
    for (let frame = 0; frame < 10801 && game.phase !== 'ended'; frame++) {
      const player = game.fighters[0], target = game.fighters[1], dx = target.x - player.x;
      const input = neutralInput();
      input.x = Math.abs(player.x) > 55 ? -Math.sign(player.x) : Math.abs(dx) > 10 ? Math.sign(dx) : 0;
      input.jump = (target.y - player.y > 20 || player.y < -8) && frame % 40 < 12;
      input.down = player.grounded && player.y > target.y + 15;
      input.attack = Math.abs(dx) < 15 && Math.abs(target.y - player.y) < 15 && frame % 33 === 0;
      input.strong = Math.abs(dx) < 15 && Math.abs(target.y - player.y) < 15 && frame % 95 === 0;
      game.step([input, neutralInput()]);
      hits += game.events.filter((event) => event.type === 'hit').length; knockouts += game.events.filter((event) => event.type === 'ko').length;
    }
    expect(hits).toBeGreaterThan(5); expect(knockouts).toBeGreaterThan(0); expect(game.phase).toBe('ended');
  }, 15000); // Up to 10,800 fully posed frames; allow loaded CI/agent machines.
});
