import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { beginJab } from '../../lib/game/jab.ts';
import { rosterPair, ROSTER_CHOICES } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

// Native combo script gates, not uniform speed overrides. Custom packs test their own timings.
const CHAINS: ReadonlyArray<[FighterKind, readonly number[]]> = [
  ['Fx', [6]], ['Mr', [6, 6]], ['Kb', [6]],
  ['Ss', [12]], ['Pk', [5, 5, 5]], ['Lk', [10, 10]],
  ['Ca', [9, 8]], ['Dk', [10]], ['Cl', [10, 10]],
];
const RAPIDS: readonly FighterKind[] = ['Fx', 'Kb', 'Lk', 'Ca', 'Mt', 'Cl'];
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('roster jab timing with original local disc data', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const f = () => game.fighters[0];
  const make = (kind: FighterKind) => {
    rig?.dispose(); const content = rosterPair(base, kind, 'Mr'); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((fighter, slot) => {
      fighter.x = slot ? 45 : -45; fighter.y = 0; fighter.grounded = true;
      fighter.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; rig.sample(fighter);
    });
  };
  const step = (input: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...input }, neutralInput()]);
  const ticks = (count: number, input: Partial<PlayerInput> = {}) => { for (let i = 0; i < count; i++) step(input); };
  // Isolate a third jab with no pending rapid-jab mash, so its native IASA is
  // tested independently of Attack100's higher-priority input threshold.
  const finisher = (kind: FighterKind) => {
    make(kind); const fighter = f(), name = fighter.content.moves.jab3!;
    fighter.state = 'attack'; fighter.animation = name; fighter.animationFrame = 0;
    fighter.attackName = name; fighter.attackSerial = 1;
    fighter.jab = { ...beginJab(fighter.content), name, window: 0 };
    rig.sample(fighter);
  };
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)),
        new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
    } finally { await disc.close(); }
  }, 30000);
  afterEach(() => rig?.dispose());

  it.each(CHAINS)('%s consumes each buffered combo tap at its own script gate', (kind, gates) => {
    make(kind); step({ attack: true });
    for (const [index, gate] of gates.entries()) {
      const serial = f().attackSerial;
      const event = f().content.attacks.get(f().animation)!.events.find(e => e.type === 'jab' && e.kind === 'combo' && e.enabled);
      expect(event?.frame).toBe(gate);
      step(); step({ attack: true });
      // Keep this tap held until it chains. Releasing it early would add a
      // legitimate fifth mash edge and select Link's rapid jab instead.
      while (f().animationFrame < gate) { expect(f().attackSerial).toBe(serial); step({ attack: true }); }
      expect(f().attackSerial).toBe(serial); step({ attack: true });
      expect(f().animation).toBe(kind === 'Pk' ? 'Attack11' : index === 0 ? 'Attack12' : 'Attack13');
      expect(f().animationFrame).toBe(1); expect(f().attackSerial).toBe(serial + 1);
    }
  });
  it.each(ROSTER_CHOICES)('%s never creates an automatic chain from a held button', kind => {
    // A modded fighter (Zero) loads only when its extension disc is registered.
    if (!base.roster.has(kind)) return;
    make(kind); ticks(120, { attack: true });
    expect(f().attackSerial).toBe(1); expect(f().state).toBe('idle');
  });
  it.each(RAPIDS)('%s enters, sustains and releases its own rapid jab', kind => {
    make(kind); const names: string[] = [], moves = f().content.moves;
    for (let frame = 0; frame < 300; frame++) {
      step({ attack: frame < 180 && frame % 4 === 0 });
      expect(f().content.clips.has(f().animation)).toBe(true);
      if (names.at(-1) !== f().animation) names.push(f().animation);
    }
    expect(names.filter(name => name.startsWith('Attack100'))).toEqual([moves.rapidStart, moves.rapidLoop, moves.rapidEnd]);
    expect(f().attackSerial).toBeGreaterThan(5); expect(f().state).toBe('idle'); expect(f().jab).toBeNull();
  });
  it.each(['Fe', 'Mt'] as const)('%s does not invent a second jab from a single extra tap', kind => {
    make(kind); step({ attack: true }); step(); step({ attack: true });
    // Hold the second tap so a third press/release edge cannot legitimately
    // trigger Mewtwo's threshold-3 rapid jab.
    ticks(80, { attack: true });
    expect(f().content.moves.jab2).toBeUndefined(); expect(f().attackSerial).toBe(1); expect(f().state).toBe('idle');
  });
  it.each([['Lk', 32], ['Cl', 32], ['Ca', 22]] as const)('%s can start a new jab at its frame-%i finisher interrupt', (kind, gate) => {
    finisher(kind); const move = f().content.attacks.get('Attack13')!;
    expect(move.interruptFrame).toBe(gate); expect(f().content.clips.get('Attack13')!.endFrame).toBeGreaterThan(gate);
    ticks(gate); step({ attack: true });
    expect(f().animation).toBe('Attack11'); expect(f().animationFrame).toBe(1); expect(f().attackSerial).toBe(2);
  });
  it.each(['Lk', 'Cl'] as const)('%s restarts after a real three-jab sequence without entering its rapid branch', kind => {
    make(kind); step({ attack: true });
    for (const expected of ['Attack12', 'Attack13']) {
      step(); step({ attack: true });
      ticks(11 - f().animationFrame, { attack: true });
      expect(f().animation).toBe(expected); expect(f().animationFrame).toBe(1);
    }
    ticks(31); step({ attack: true });
    expect(f().animation).toBe('Attack11'); expect(f().attackSerial).toBe(4);
  });
  it.each(['Mr'] as const)('%s keeps its full finisher recovery without an earlier authored gate', kind => {
    finisher(kind); const duration = f().content.clips.get('Attack13')!.endFrame;
    ticks(duration - 1); step({ attack: true });
    expect(f().animation).toBe('Attack13'); expect(f().attackSerial).toBe(1);
    step({ attack: true }); expect(f().state).toBe('idle'); expect(f().attackSerial).toBe(1);
  });
  it.each(['Lk', 'Cl', 'Ca'] as const)('%s does not buffer a premature finisher restart or truncate an idle recovery', kind => {
    finisher(kind); const gate = f().content.attacks.get('Attack13')!.interruptFrame!;
    ticks(gate - 1); step({ attack: true });
    expect(f().animation).toBe('Attack13'); expect(f().attackSerial).toBe(1);
    step({ attack: true }); expect(f().animation).toBe('Attack13');
    step(); expect(f().animation).toBe('Attack13');
    step({ attack: true }); expect(f().animation).toBe('Attack11'); expect(f().attackSerial).toBe(2);
  });
  it.each(['Lk', 'Cl', 'Ca'] as const)('%s retains hitlag and deterministic replay at the finisher interrupt', kind => {
    finisher(kind); ticks(f().content.attacks.get('Attack13')!.interruptFrame!);
    f().hitlag = 2; const frame = f().animationFrame;
    step({ attack: true }); expect(f().animationFrame).toBe(frame); expect(f().attackSerial).toBe(1);
    step(); const state = game.captureState();
    step({ attack: true }); expect(f().animation).toBe('Attack11');
    ticks(3); const hash = game.stateHash(); expect(f().attackSerial).toBe(2);
    game.restoreState(state); step({ attack: true }); ticks(3); expect(game.stateHash()).toBe(hash);
  });
  it('does not turn Roy first-jab IASA into Pikachu-style neutral repeats', () => {
    make('Fe'); step({ attack: true });
    const gate = f().content.attacks.get('Attack11')!.interruptFrame!;
    ticks(gate - 1); step({ attack: true });
    expect(f().animationFrame).toBe(gate + 1); expect(f().attackSerial).toBe(1);
  });
});
