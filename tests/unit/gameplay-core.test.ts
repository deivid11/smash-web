import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractCFunction } from '../../scripts/extract-c.ts';
import { HsdArchive } from '../../lib/hsd/archive.ts';
import { parseAttack, activeHits, type AttackDefinition } from '../../lib/game/moves.ts';
import { pointSegmentDistanceSquared } from '../../lib/game/match.ts';
import type { FighterProfile } from '../../lib/game/data.ts';

// Synthetic 16-joint skeleton; every fighter part owns a joint (no virtual hat parts).
const profile = { boneCount: 16, boneMap: Array.from({ length: 54 }, (_, i) => i % 16), partJoints: Array.from({ length: 16 }, (_, i) => i) } as FighterProfile;
function script(words: number[]): HsdArchive {
  const dataSize = Math.max(words.length * 4, 32), bytes = new Uint8Array(dataSize + 32), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length); view.setUint32(4, dataSize);
  words.forEach((word, index) => view.setUint32(32 + index * 4, word));
  return new HsdArchive(bytes);
}
const createHit = (damage = 4) => [(11 << 26) | (2 << 11) | damage, 256 << 16, 0, (45 << 23) | (100 << 14), (20 << 23) | 3];

describe('unmodified C function extraction', () => {
  it('preserves the exact function text and handles braces in strings/comments', () => {
    const functionText = 'static inline float sample(int x)\n{\n  /* } */ const char* s = "{";\n  if (x) { return 1; }\n  return 0;\n}';
    expect(extractCFunction(`/* prefix */\n${functionText}\nvoid other(void) {}`, 'sample')).toBe(functionText);
  });
  it('ignores a prototype when locating the definition', () => expect(extractCFunction('float f(int x);\nfloat f(int x) { return x; }', 'f')).toBe('float f(int x) { return x; }'));
  it('rejects ambiguous definitions', () => expect(() => extractCFunction('void f(void) {}\nvoid f(void) {}', 'f')).toThrow('found 2'));
  it('rejects missing definitions', () => expect(() => extractCFunction('void g(void) {}', 'f')).toThrow('found 0'));
  it('rejects unterminated bodies', () => expect(() => extractCFunction('void f(void) {', 'f')).toThrow('Unterminated'));
  it('rejects invalid symbol patterns', () => expect(() => extractCFunction('', 'f.*')).toThrow('Invalid'));
});

describe('gameplay WASM build provenance', () => {
  it('records the original pinned function texts rather than rewritten equivalents', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../web/public/wasm/gameplay.build.json', import.meta.url), 'utf8'));
    expect(manifest.functions).toHaveLength(33);
    expect(manifest.functions.map((entry: { name: string }) => entry.name)).toEqual(expect.arrayContaining(['ftCommon_8007D140', 'ftCommon_8007D344', 'ft_80084F3C']));
    for (const entry of manifest.functions as Array<{ file: string; name: string; sha256: string }>) {
      if (entry.name === 'KNOCKBACK') continue;
      const file = readFileSync(new URL(`../../third_party/melee/${entry.file}`, import.meta.url), 'utf8');
      const text = extractCFunction(file, entry.name);
      expect(createHash('sha256').update(text).digest('hex')).toBe(entry.sha256);
    }
    const binary = readFileSync(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url));
    expect(createHash('sha256').update(binary).digest('hex')).toBe(manifest.wasmSha256);
  });
  it('runs without host imports and uses the intended scalar-data ABI', async () => {
    const bytes = readFileSync(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url));
    const module = await WebAssembly.compile(bytes);
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    const instance = await WebAssembly.instantiate(module, {});
    expect((instance.exports.core_attrs_size as () => number)()).toBe(0x9c);
    expect((instance.exports.core_common_size as () => number)()).toBe(0x7f4);
    expect(instance.exports.memory).toBeInstanceOf(WebAssembly.Memory);
    for (const name of ['core_dash', 'core_turn_run']) expect(typeof instance.exports[name], name).toBe('function');
  });
});

describe('original action-script subset', () => {
  it('decodes timing, hitbox fields, and the original fixed-point literal', () => {
    const move = parseAttack(script([(2 << 26) | 2, ...createHit(), (1 << 26) | 3, 16 << 26, 0]), 0, 'Synthetic jab', profile);
    expect(activeHits(move, 1)).toHaveLength(0);
    expect(activeHits(move, 2)[0]).toMatchObject({ bone: 2, damage: 4, angle: 45, growth: 100, base: 20, grounded: true, airborne: true });
    expect(activeHits(move, 2)[0]!.radius).toBe(Math.fround(Math.fround(0.003906) * 256));
    expect(activeHits(move, 5)).toHaveLength(0);
  });
  it('assigns a new hit activation after a clear/recreate wave', () => {
    const move = parseAttack(script([(3 << 26) | 2, ...createHit(), (1 << 26) | 1, 16 << 26, 4 << 26, 0]), 0, 'Synthetic multihit', profile);
    expect(activeHits(move, 0)[0]!.activation).not.toBe(activeHits(move, 1)[0]!.activation);
  });
  it('retains the activation when only damage changes', () => {
    const move = parseAttack(script([...createHit(), (1 << 26) | 1, (12 << 26) | 9, (1 << 26) | 1, 16 << 26, 0]), 0, 'Synthetic late hit', profile);
    expect(activeHits(move, 0)[0]!.activation).toBe(activeHits(move, 1)[0]!.activation);
    expect(activeHits(move, 1)[0]!.damage).toBe(9);
    expect((move.events[0] as { hit: { damage: number } }).hit.damage).toBe(4);
  });
  it('retains the original smash hold point, duration, fixed-point multiplier and color id',()=>{
    const move=parseAttack(script([(2<<26)|7,(56<<26)|(60<<16)|350,119<<24,...createHit(),0]),0,'charge',profile);
    expect(move.events[0]).toEqual({frame:7,type:'charge',maxFrames:60,multiplier:Math.fround(Math.fround(0.003906)*350),color:119});
    expect(move.events[1]?.type).toBe('create');
  });
  it('rejects zero-duration or unsupported charge multipliers before runtime division',()=>{
    expect(()=>parseAttack(script([56<<26|350,0,0]),0,'charge',profile)).toThrow('charge');
    expect(()=>parseAttack(script([56<<26|60<<16|65535,0,0]),0,'charge',profile)).toThrow('charge');
  });
  it('marks native walking footstep cues as ground-only and keeps their word alignment',()=>{
    const move=parseAttack(script([54<<26,401,0x6440,...createHit(),0]),0,'walk',profile);
    expect(move.events[0]).toEqual({frame:0,type:'sound',sound:401,volume:100,pan:64,groundOnly:true});expect(move.events[1]?.type).toBe('create');
  });
  it('follows backward script sharing before applying bounded-loop limits', () => {
    const words = [...createHit(7), 0, 7 << 26, 0];
    const move = parseAttack(script(words), 24, 'shared aerial', profile, 40);
    expect(activeHits(move, 0)[0]?.damage).toBe(7);
  });
  it('bounds a backward goto loop that advances time', () => {
    const move = parseAttack(script([...createHit(), (1 << 26) | 1, 16 << 26, 7 << 26, 0]), 0, 'loop', profile, 3);
    expect(move.events.filter(e => e.type === 'create')).toHaveLength(4);
  });
  it('ends an absolute-timer animation cycle without losing its first pass', () => {
    const move = parseAttack(script([(2 << 26) | 2, ...createHit(), (2 << 26) | 6, 16 << 26, 7 << 26, 0]), 0, 'locomotion', profile, 30);
    expect(move.events.filter(e => e.type === 'create')).toHaveLength(1);
    expect(move.events.at(-1)).toMatchObject({ frame: 6, type: 'clear' });
  });
  it('rejects a backward goto loop with no time progress', () => {
    expect(() => parseAttack(script([7 << 26, 0]), 0, 'invalid', profile, 20)).toThrow('budget');
  });
  it('rejects unmatched loop commands', () => expect(() => parseAttack(script([4 << 26]), 0, 'invalid', profile)).toThrow('Unmatched'));
  it('rejects recursive subroutines within a bounded budget', () => expect(() => parseAttack(script([5 << 26, 0]), 0, 'invalid', profile)).toThrow('nesting'));
  it('rejects unsupported hitbox ids', () => {
    const words = createHit(); words[0]! |= 7 << 23;
    expect(() => parseAttack(script(words), 0, 'invalid', profile)).toThrow('hitbox id');
  });
  it('rejects invalid skeleton references', () => {
    const words = createHit(); words[0] = (11 << 26) | (200 << 11) | 4;
    expect(() => parseAttack(script(words), 0, 'invalid', profile)).toThrow('bone');
  });
  it('rejects excessive script duration', () => expect(() => parseAttack(script([(1 << 26) | 99999]), 0, 'invalid', profile)).toThrow('duration'));
  it('supports empty inactive move timelines', () => expect(activeHits({ name: 'none', events: [], interruptFrame: null, ignoredOpcodes: [] } as AttackDefinition, 100)).toEqual([]));
});

describe('capsule geometry', () => {
  it('measures distance to the interior of a segment', () => expect(pointSegmentDistanceSquared([3, 5, 0], [0, 0, 0], [0, 10, 0])).toBe(9));
  it('clamps to segment endpoints', () => expect(pointSegmentDistanceSquared([3, 15, 0], [0, 0, 0], [0, 10, 0])).toBe(34));
  it('handles zero-length capsules', () => expect(pointSegmentDistanceSquared([1, 2, 3], [0, 0, 0], [0, 0, 0])).toBe(14));
  it('includes depth instead of treating the scene as flat rectangles', () => expect(pointSegmentDistanceSquared([0, 5, 4], [0, 0, 0], [0, 10, 0])).toBe(16));
});
