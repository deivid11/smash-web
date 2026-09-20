import { describe, expect, it } from 'vitest';
import { HsdArchive } from '../../lib/hsd/archive.ts';
import { parseItemScript } from '../../lib/game/item-data.ts';
import { activeHits } from '../../lib/game/moves.ts';

function script(words: number[]): HsdArchive {
  const dataSize = Math.max(words.length * 4, 32), bytes = new Uint8Array(dataSize + 32), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length); view.setUint32(4, dataSize);
  words.forEach((word, index) => view.setUint32(32 + index * 4, word));
  return new HsdArchive(bytes);
}
// it_802790C0 layout: 6 words, 13-bit damage, 7-bit item bone, element/sfx in word 4, flags in word 5.
const itemHit = (damage: number, bone = 0, element = 0) => [
  (11 << 26) | (1 << 23) | (bone << 13) | damage,
  (512 << 16) | 256, (128 << 16) | 64,
  (80 << 23) | (60 << 14) | (0 << 5),
  (40 << 23) | (element << 18) | (5 << 9) | (2 << 6) | (3 << 2) | 3,
  0x12345678,
];

describe('item animation script parser', () => {
  it('unpacks the six-word item hitbox command with item bone and 13-bit damage', () => {
    const move = parseItemScript(script([(2 << 26) | 4, ...itemHit(300, 17, 2), 0]), 0, 'test');
    expect(move.events).toHaveLength(1);
    const event = move.events[0]!;
    if (event.type !== 'create') throw new Error('Expected a hitbox event.');
    expect(event.frame).toBe(4);
    expect(event.hit).toMatchObject({ id: 1, bone: 17, damage: 300, angle: 80, growth: 60, base: 40, element: 2, shieldDamage: 5, soundSeverity: 2, soundKind: 3, grounded: true, airborne: true, itemFlags: 0x12345678 });
    expect(event.hit.radius).toBeCloseTo(2, 3);
    const active = activeHits(move, 4);
    expect(active).toHaveLength(1);
    expect(active[0]!.damage).toBe(300);
  });
  it('supports timers, clear-all, damage/scale updates and command variables', () => {
    const move = parseItemScript(script([
      ...itemHit(20), (1 << 26) | 6,
      (12 << 26) | (1 << 23) | 999, (13 << 26) | (1 << 23) | 512,
      (17 << 26) | 33, (1 << 26) | 4, (15 << 26), 0,
    ]), 0, 'test');
    expect(move.events.map((event) => [event.frame, event.type])).toEqual([[0, 'create'], [6, 'damage'], [6, 'radius'], [6, 'command'], [10, 'clear']]);
    expect(activeHits(move, 8)[0]!.damage).toBe(999);
    expect(activeHits(move, 11)).toHaveLength(0);
  });
  it('decodes the three-word item sound command and anim-wrap markers', () => {
    const move = parseItemScript(script([(16 << 26) | (1 << 18), 0x4321, (90 << 8) | 64, (8 << 26), 0]), 0, 'test');
    expect(move.events[0]).toMatchObject({ frame: 0, type: 'sound', sound: 0x4321, volume: 90, pan: 64 });
    expect(move.events[1]).toMatchObject({ type: 'flag', flag: 8 });
  });
  it('terminates absolute goto cycles and rejects zero-progress cycles', () => {
    // goto → word 0 with only async timers: restart-with-animation semantics, not an infinite loop.
    expect(parseItemScript(script([(2 << 26) | 10, ...itemHit(5), (7 << 26), 0]), 0, 'test').events).toHaveLength(1);
    expect(() => parseItemScript(script([(7 << 26), 0]), 0, 'test')).toThrow('no time progress');
  });
  it('rejects unknown opcodes instead of desynchronizing the stream', () => {
    expect(() => parseItemScript(script([(26 << 26), 0]), 0, 'test')).toThrow('Unsupported item script opcode');
  });
});
