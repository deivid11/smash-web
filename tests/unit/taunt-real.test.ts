import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc, verifyAceDisc } from '../../lib/disc.ts';
import { mergeModdedSource } from '../../lib/hsd/modded-source.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { TAUNT_MOTIONS, tauntAnimation } from '../../lib/game/taunt.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

const wasm = async () => new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;

describe('taunt motion selection', () => {
  const clips = (...names: string[]) => ({ clips: new Map(names.map(name => [name, {} as never])) });
  it('prefers a complete facing pair, then the raised pair, then the symmetric clip', () => {
    expect(tauntAnimation(clips('AppealR', 'AppealL'), 1)).toBe('AppealR');
    expect(tauntAnimation(clips('AppealR', 'AppealL'), -1)).toBe('AppealL');
    expect(tauntAnimation(clips('AppealHiR', 'AppealHiL'), -1)).toBe('AppealHiL');
    // A lone side clip beside a symmetric Appeal (Shadow Mewtwo's m-ex table) is a
    // leftover: the symmetric one is the taunt the original plays.
    expect(tauntAnimation(clips('Appeal', 'AppealR'), 1)).toBe('Appeal');
    expect(tauntAnimation(clips('AppealLw'), 1)).toBe('AppealLw');
    expect(tauntAnimation(clips('AppealR'), -1)).toBe('AppealR');
    expect(tauntAnimation(clips(), 1)).toBeNull();
    expect(TAUNT_MOTIONS).toContain('Appeal');
  });
});

describe.skipIf(!iso)('taunts with original local disc data', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const f = () => game.fighters[0]!;
  const make = (kind: FighterKind) => {
    rig?.dispose(); const content = rosterPair(base, kind, 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((fighter, slot) => {
      fighter.x = slot ? 45 : -45; fighter.y = 0; fighter.grounded = true;
      fighter.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; rig.sample(fighter);
    });
  };
  const step = (input: Partial<PlayerInput> = {}, other: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...input }, { ...neutralInput(), ...other }]);
  const ticks = (count: number, input: Partial<PlayerInput> = {}) => { for (let i = 0; i < count; i++) step(input); };
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), await wasm(), undefined, 'final'); }
    finally { await disc.close(); }
  }, 60000);
  afterEach(() => rig?.dispose());

  it('gives every original fighter an Appeal motion with its own script, in both facings', () => {
    for (const [kind, content] of base.roster) {
      // Installed character packs author their own motions: one without an Appeal
      // simply cannot taunt, exactly like any other motion it does not provide.
      if (content.custom) { expect(tauntAnimation(content, 1)).toBe(content.clips.has('Appeal') ? 'Appeal' : null); continue; }
      const right = tauntAnimation(content, 1), left = tauntAnimation(content, -1);
      expect(right, `${kind} taunt`).not.toBeNull();
      expect(TAUNT_MOTIONS).toContain(right as never);
      expect(TAUNT_MOTIONS).toContain(left as never);
      // The original clip and its script (voice cue, graphics) are both loaded.
      expect(content.clips.get(right!)!.endFrame).toBeGreaterThan(0);
      expect(content.timelines.has(right!)).toBe(true);
      // Only the few Appeal scripts that author hitboxes enter the attack tables.
      expect(content.attacks.has(right!)).toBe(content.timelines.get(right!)!.events.some(event => event.type === 'create'));
    }
  });

  it('plays the facing-matched clip from Wait and returns to Wait when it ends', () => {
    make('Kb');
    f().facing = -1;
    step({ taunt: true });
    expect(f().state).toBe('taunt');
    expect(f().animation).toBe('AppealL');
    const frames = f().content.clips.get('AppealL')!.endFrame;
    // Committal: movement, crouch and the stick do nothing until the Appeal ends.
    ticks(Math.ceil(frames) - 2, { taunt: true, x: 1, down: true });
    expect(f().state).toBe('taunt');
    expect(Math.abs(f().velocity.x)).toBeLessThan(0.01);
    ticks(4);
    expect(f().state).toBe('idle');
    expect(f().animation).toBe('Wait1');
    // Mario's taunt is the single symmetric Appeal, in either facing.
    make('Mr');
    f().facing = -1; step({ taunt: true });
    expect(f().animation).toBe('Appeal');
  });

  it('is a ground action reachable from the walking and running states, never from the air', () => {
    make('Fx');
    f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 60;
    step({ taunt: true });
    expect(f().state).toBe('fall');
    // ftCo_Run_IASA / ftCo_Walk_IASA reach the same Appeal check as ftCo_Wait_IASA.
    make('Fx');
    ticks(6, { x: 1 });
    expect(f().state).toBe('run');
    step({ taunt: true, x: 1 });
    expect(f().state).toBe('taunt');
    // One Appeal per press: holding the button neither loops nor re-enters it.
    make('Fx');
    ticks(3, { taunt: true });
    expect(f().state).toBe('taunt');
    ticks(120, { taunt: true });
    expect(f().state).toBe('idle');
  });

  it('honours the script interrupt flag: Pikachu is actionable early, Mario is not', () => {
    // ftCo_AppealS_IASA gives control back only once the script raises allow_interrupt.
    make('Pk');
    const gate = base.roster.get('Pk' as FighterKind)!.timelines.get('AppealR')!.interruptFrame!;
    expect(gate).toBeGreaterThan(0);
    step({ taunt: true });
    expect(f().state).toBe('taunt');
    ticks(Math.ceil(gate) - 2);
    step({ attack: true });
    expect(f().state).toBe('taunt');
    ticks(3);
    step({ attack: true });
    expect(f().state).toBe('attack');
    // Mario's Appeal never raises the flag: the same input does nothing all the way through.
    make('Mr');
    expect(base.roster.get('Mr' as FighterKind)!.timelines.get('Appeal')!.interruptFrame).toBeNull();
    step({ taunt: true });
    ticks(60, { attack: true, x: 1 });
    expect(f().state).toBe('taunt');
  });

  it("strikes with Luigi's scripted taunt hitbox and leaves harmless taunts harmless", () => {
    make('Lg');
    expect(f().content.attacks.has('Appeal')).toBe(true);
    game.fighters[1]!.x = f().x + 6; game.fighters[1]!.facing = -1;
    f().facing = 1;
    step({ taunt: true });
    expect(f().state).toBe('taunt');
    // The script creates the kick's hitbox on frame 45 and clears it on 46.
    for (let i = 0; i < 80 && game.fighters[1]!.percent === 0; i++) step();
    expect(game.fighters[1]!.percent).toBeGreaterThan(0);
    expect(f().state).toBe('taunt');
    // Mario's Appeal has no hitbox at all: nobody takes damage from it.
    make('Mr');
    game.fighters[1]!.x = f().x + 6;
    step({ taunt: true });
    ticks(120);
    expect(game.fighters[1]!.percent).toBe(0);
  });

  it('loses to a same-frame attack, ends on a hit, and survives a rollback round trip', () => {
    make('Mr');
    step({ taunt: true, attack: true });
    expect(f().state).toBe('attack');
    make('Mr');
    step({ taunt: true });
    expect(f().state).toBe('taunt');
    const snapshot = game.captureState(), hash = game.stateHash();
    ticks(3);
    game.restoreState(snapshot);
    expect(game.stateHash()).toBe(hash);
    expect(f().state).toBe('taunt');
    // ftCo_Damage: a hit takes the taunting fighter out of the Appeal.
    game.fighters[1]!.x = f().x + 8;
    for (let i = 0; i < 20 && f().state === 'taunt'; i++) step({}, { attack: true });
    expect(f().state).toBe('hitstun');
  });
});

describe.skipIf(!iso || !aceIso)('taunts across the full roster (ACE extension disc)', () => {
  let base: GameContent;
  beforeAll(async () => {
    const vanilla = await openDisc(iso!), ace = await openDisc(aceIso!);
    try {
      const merged = mergeModdedSource({ reader: vanilla, info: await verifyMeleeDisc(vanilla) }, { reader: ace, info: await verifyAceDisc(ace) });
      base = await loadGameContent(new HsdAssetSession(merged.reader, { files: merged.files }), await wasm(), undefined, 'final');
    } finally { await vanilla.close(); await ace.close(); }
  }, 300000);

  it('resolves an Appeal for every loaded fighter, ACE kits included', () => {
    const missing = [...base.roster].filter(([, content]) => !content.custom && tauntAnimation(content, 1) === null).map(([kind]) => kind);
    expect(missing).toEqual([]);
    expect(base.roster.size).toBeGreaterThan(50);
    // Sample the four authoring shapes seen on this source.
    expect(tauntAnimation(base.roster.get('Sn' as FighterKind)!, 1)).toBe('AppealHiR');
    expect(tauntAnimation(base.roster.get('De' as FighterKind)!, 1)).toBe('AppealLw');
    expect(tauntAnimation(base.roster.get('Sm' as FighterKind)!, 1)).toBe('Appeal');
    expect(tauntAnimation(base.roster.get('Td' as FighterKind)!, -1)).toBe('AppealR');
  });
});
