import { HsdArchive } from '../hsd/archive.ts';
import { partJoint, type FighterProfile } from './data.ts';
import type { V3 } from '../hsd/model.ts';

export interface HitDefinition {
  id: number; group: number; bone: number; damage: number; radius: number; offset: V3;
  angle: number; growth: number; weightSet: number; base: number; grounded: boolean; airborne: boolean;
  element?: number; soundKind?: number; soundSeverity?: number; shieldDamage?: number;
  /** Item scripts only (it_802790C0 word 5): raw x40_b4/x41/x42 target-category flags. */
  itemFlags?: number;
}
export type MoveEvent = { frame: number; type: 'create'; hit: HitDefinition } | { frame: number; type: 'clear'; id: number | null }
  | { frame: number; type: 'damage' | 'radius'; id: number; value: number }
  | { frame: number; type: 'sound'; sound: number; volume: number; pan: number; groundOnly?:boolean }
  | { frame: number; type: 'command'; index: number; value: number }
  | { frame: number; type: 'flag'; flag: number; value?: number }
  | { frame: number; type: 'gfx'; effect: number; bone: number; commonBone: boolean; offset?:V3; range?:V3; groundOnly?:boolean }
  | { frame: number; type: 'hurt'; bone: number | null; state: number }
  | { frame: number; type: 'charge'; maxFrames:number; multiplier:number; color:number }
  | { frame: number; type: 'body-state'; state: number }
  | { frame: number; type: 'self-damage'; damage: number }
  | { frame: number; type: 'model-part'; group: number; alternative: number }
  | { frame: number; type: 'model-reset'; hidden: boolean }
  /** ftAction_80072894 → ftCommon_8007E83C: drive the held parasol item into table state `state`
   * (Peach's own parasol: 4 opens, 6 folds), at an anim rate of frames/`divisor` (0 = fighter rate). */
  | { frame: number; type: 'parasol'; state: number; divisor: number }
  | { frame: number; type: 'throw-hit'; index:number; hit:HitDefinition }
  | { frame: number; type: 'jab'; kind: 'combo' | 'rapid'; enabled: boolean };
export interface AttackDefinition { name: string; events: MoveEvent[]; interruptFrame: number | null; ignoredOpcodes: number[] }
const WORD_LENGTHS = [5, 5, 1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 7, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 2, 1, 4];
const FIXED = Math.fround(0.003906); // original ftAction literal, not a substituted 1/256
const s16 = (word: number) => (word << 16) >> 16;

/** Bounded subset of original action command semantics needed by these attacks.
 * Visual/audio/control opcodes are skipped by their original word lengths. */
export function parseAttack(arc: HsdArchive, script: number, name: string, profile: FighterProfile, frameLimit = 3600): AttackDefinition {
  const events: MoveEvent[] = [], ignored = new Set<number>();
  const loops: Array<{ pointer: number; remaining: number }> = [], returns: number[] = [];
  const visited = new Map<number, { frame: number; relative: number }>();
  let pointer = script, frame = 0, relative = 0, interruptFrame: number | null = null;
  for (let steps = 0; steps < 8192; steps++) {
    visited.set(pointer, { frame, relative });
    const word = arc.u32(pointer), opcode = word >>> 26, value = word & 0x3ffffff;
    if (opcode === 0) return { name, events, interruptFrame, ignoredOpcodes: [...ignored] };
    if (opcode === 1 || opcode === 2) {
      if (opcode === 1) relative += value;
      frame = opcode === 1 ? frame + value : Math.max(frame, value);
      if (frame > frameLimit && frameLimit < 3600) return { name, events, interruptFrame, ignoredOpcodes: [...ignored] };
      if (frame > 3600) throw new Error('Attack script duration exceeds the supported budget.');
      pointer += 4; continue;
    }
    if (opcode === 3) {
      // Held loops (Kirby's inhale repeats 8000 times) are only accepted when the caller
      // bounds the unrolled timeline to the animation length.
      if (loops.length >= 8 || (value < 1 && frameLimit >= 3600) || (value > 100 && frameLimit >= 3600)) throw new Error('Invalid attack script loop.');
      loops.push({ pointer: pointer + 4, remaining: value || Math.ceil(frameLimit) + 2 }); pointer += 4; continue;
    }
    if (opcode === 4) {
      const loop = loops.at(-1); if (!loop) throw new Error('Unmatched attack loop end.');
      if (--loop.remaining > 0) pointer = loop.pointer; else { loops.pop(); pointer += 4; } continue;
    }
    if (opcode === 5 || opcode === 7) {
      const target = arc.pointer(pointer + 4);
      // Backward jumps also share scripts across motions (Pk aerial specials → ground scripts).
      // Absolute-only cycles restart with the animation (Fox Run); relative-wait cycles
      // unroll to frameLimit. A zero-time cycle is malformed, not a completed timeline.
      const seen = visited.get(target);
      if (opcode === 7 && seen && !loops.length && !returns.length && relative === seen.relative) {
        if (frame === seen.frame) throw new Error('Attack script cycle has no time progress (budget).');
        return { name, events, interruptFrame, ignoredOpcodes: [...ignored] };
      }
      if (opcode === 5) { if (returns.length >= 8) throw new Error('Attack subroutine nesting exceeds budget.'); returns.push(pointer + 8); }
      pointer = target; continue;
    }
    if (opcode === 6) {
      const next = returns.pop(); if (next === undefined) throw new Error('Unmatched attack subroutine return.'); pointer = next; continue;
    }
    if (opcode === 8) return { name, events, interruptFrame, ignoredOpcodes: [...ignored, opcode] };
    if (opcode === 9) { pointer += 4; ignored.add(opcode); continue; }
    const words = WORD_LENGTHS[opcode - 10];
    if (!words) throw new Error(`Unsupported action opcode ${opcode}.`);
    arc.range(pointer, words * 4);
    if (opcode === 11) {
      const id = (word >>> 23) & 7, commonBone = !!(word & 0x400), boneId = (word >>> 11) & 255;
      if (id > 3) throw new Error('Invalid original hitbox id.');
      // Link's native item callback binds ftParts[139] to its hook tip, not a body joint.
      const attachment=!commonBone&&boneId===139&&(profile.kind==='Lk'||profile.kind==='Cl')&&['Catch','CatchDash','AirCatch'].includes(name);
      const bone = attachment?139:commonBone ? profile.boneMap[boneId] : boneId < profile.partJoints.length ? partJoint(profile, boneId, 'hitbox') : undefined;
      if (bone === undefined || bone === 255 || (!attachment&&bone >= profile.boneCount)) throw new Error(`Invalid original hitbox bone ${boneId} (${commonBone ? 'common' : 'part'}) in ${name}.`);
      const w1 = arc.u32(pointer + 4), w2 = arc.u32(pointer + 8), w3 = arc.u32(pointer + 12), w4 = arc.u32(pointer + 16);
      const hit: HitDefinition = {
        id, group: (word >>> 20) & 7, bone, damage: word & 1023,
        radius: Math.fround((w1 >>> 16) * FIXED), offset: [Math.fround(s16(w1) * FIXED), Math.fround(s16(w2 >>> 16) * FIXED), Math.fround(s16(w2) * FIXED)],
        angle: (w3 >>> 23) & 511, growth: (w3 >>> 14) & 511, weightSet: (w3 >>> 5) & 511,
        base: (w4 >>> 23) & 511, grounded: !!(w4 & 2), airborne: !!(w4 & 1),
        shieldDamage: (w4 >>> 10) & 255,
        element: (w4 >>> 18) & 31, soundSeverity: (w4 >>> 7) & 7, soundKind: (w4 >>> 2) & 31,
      };
      if (hit.radius > 50 || hit.damage > 100 || hit.angle > 361) throw new Error('Unsupported hitbox parameters in this playable slice.');
      events.push({ frame, type: 'create', hit });
    } else if (opcode === 15 || opcode === 16) {
      if (opcode === 15 && value > 3) throw new Error('Invalid hitbox clear index.');
      events.push({ frame, type: 'clear', id: opcode === 16 ? null : value });
    } else if (opcode === 12 || opcode === 13) {
      const id = (word >>> 23) & 7;
      if (id > 3) throw new Error('Invalid adjusted hitbox index.');
      events.push({ frame, type: opcode === 12 ? 'damage' : 'radius', id, value: opcode === 12 ? word & 0x7fffff : Math.fround((word & 0x7fffff) * FIXED) });
    } else if (opcode === 17 || opcode === 54) {
      const params = arc.u32(pointer + 8);
      events.push({ frame, type: 'sound', sound: arc.u32(pointer + 4), volume: (params >>> 8) & 255, pan: params & 255, ...(opcode===54?{groundOnly:true}:{}) });
    } else if (opcode === 19) events.push({ frame, type: 'command', index: (word >>> 24) & 3, value: word & 0xffffff });
    else if (opcode === 24 || opcode === 20 || opcode === 25) events.push({ frame, type: 'flag', flag: opcode === 25 ? 100 + value : opcode, value });
    else if (opcode === 10) {
      const w2=arc.u32(pointer+8),w3=arc.u32(pointer+12),w4=arc.u32(pointer+16);
      events.push({frame,type:'gfx',effect:arc.u32(pointer+4)>>>16,bone:(word>>>18)&255,commonBone:!!(word&0x20000),offset:[Math.fround(s16(w2>>>16)*FIXED),Math.fround(s16(w2)*FIXED),Math.fround(s16(w3>>>16)*FIXED)],range:[Math.fround((w3&65535)*FIXED),Math.fround((w4>>>16)*FIXED),Math.fround((w4&65535)*FIXED)]});
    }
    // ftAction_80072E4C: authored ground-contact GFX fallback. Material-specific
    // substitutions/sounds remain separate; do not silently discard landing dust.
    else if (opcode === 55) events.push({frame,type:'gfx',effect:word&65535,bone:0,commonBone:false,offset:[0,0,0],groundOnly:true});
    else if (opcode === 31) events.push({ frame, type: 'model-part', group: (word << 6) >> 25, alternative: (word << 13) >> 13 });
    else if (opcode === 32 || opcode === 33) events.push({ frame, type: 'model-reset', hidden: opcode === 33 });
    // lb/types.h struct unk9 {opcode:6, unk1:13, unk2:13}.
    else if (opcode === 42) events.push({ frame, type: 'parasol', state: (word >>> 13) & 0x1fff, divisor: word & 0x1fff });
    else if (opcode === 27 || opcode === 28) events.push({ frame, type: 'hurt', bone: opcode === 27 ? null : (word >>> 18) & 255, state: opcode === 27 ? value : word & 0x3ffff });
    else if (opcode === 26) events.push({frame,type:'body-state',state:value});
    // ftAction_80072BF4: signed 26-bit damage_amount (Roy full-charge recoil).
    else if (opcode === 51) events.push({ frame, type: 'self-damage', damage: (word << 6) >> 6 });
    else if (opcode === 34) {
      const w1=arc.u32(pointer+4),w2=arc.u32(pointer+8),damage=word&0x7fffff,index=(word>>>23)&7;
      if(index>1||damage>100)throw Error('Invalid original throw definition.');
      events.push({frame,type:'throw-hit',index,hit:{id:index,group:0,bone:profile.boneMap[52]!,damage,radius:0,offset:[0,0,0],angle:w1>>>23,growth:(w1>>>14)&511,weightSet:(w1>>>5)&511,base:w2>>>23,element:(w2>>>19)&15,soundSeverity:(w2>>>16)&7,soundKind:(w2>>>12)&15,grounded:true,airborne:true}});
    }
    else if (opcode === 29 || opcode === 30) events.push({ frame, type: 'jab', kind: opcode === 29 ? 'combo' : 'rapid', enabled: opcode === 29 ? value === 0 : value !== 0 });
    else if (opcode === 56) {
      const maxFrames=(word>>>16)&1023,multiplier=Math.fround((word&65535)*FIXED);
      // Vanilla multipliers are always >= 1; ACE fighters author values slightly below
      // (Charizard's up smash declares 0.977), so the floor admits them without opening
      // the door to nonsense charge data.
      if(maxFrames<1||maxFrames>600||multiplier<0.5||multiplier>5)throw Error('Unsupported smash charge parameters.');
      events.push({frame,type:'charge',maxFrames,multiplier,color:arc.u32(pointer+4)>>>24});
    }
    else if (opcode === 23) interruptFrame = frame;
    else ignored.add(opcode);
    pointer += words * 4;
  }
  throw new Error('Attack script execution budget exceeded.');
}

export interface ActiveHit extends HitDefinition { activation: number }
export function activeHits(move: AttackDefinition, frame: number): ActiveHit[] {
  const active = new Map<number, ActiveHit>();
  let activation = 0;
  for (const event of move.events) {
    if (event.frame > frame) break;
    if (event.type === 'create') {
      const previous = active.get(event.hit.id);
      active.set(event.hit.id, { ...event.hit, activation: previous?.group === event.hit.group ? previous.activation : activation });
    } else if (event.type === 'clear') {
      activation++;
      if (event.id === null) active.clear(); else active.delete(event.id);
    }
    else if (event.type === 'damage' || event.type === 'radius') {
      const hit = active.get(event.id);
      if (hit) hit[event.type === 'damage' ? 'damage' : 'radius'] = event.value;
    }
  }
  return [...active.values()].sort((a, b) => a.id - b.id);
}
