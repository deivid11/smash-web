import { HsdArchive } from '../hsd/archive.ts';
import { loadModel, type HsdModel, type V3 } from '../hsd/model.ts';
import { loadJointAnimation, sampleTrack, type AnimationClip } from '../hsd/animation.ts';
import type { HitDefinition, MoveEvent, AttackDefinition } from './moves.ts';
import { COMMON_ITEM_NAMES, POKEMON_BASE, POKEMON_NAMES } from './item-kinds.ts';

/** ItCo.dat itPublicData (third_party/melee/src/melee/it/it_3F14.h it_804D6D20_t):
 * x0 ItemCommonData, x4 common Article*[43], x8 character items, xC pokémon items.
 * Only the common table is parsed here; character articles keep coming from Pl archives. */
const COMMON_ARTICLE_COUNT = COMMON_ITEM_NAMES.length;

/** ItemCommonData scalars this slice consumes (third_party/melee/src/melee/it/types.h ItemCommonData).
 * The x4C…xF8 values are the same ones lib/game/item-common.ts pins for the Link-bomb path. */
export interface ItemCommonTuning {
  lifetime: number;        // x30, default despawn timer restarted on pickup (it_802742F4)
  reflectedLife: number;   // x4C
  dropScatter: number;     // x54, horizontal scatter for container drops (it_8026F53C)
  shieldBounceX: number; shieldBounceY: number; shieldBounceLift: number; // x58/x5C/x60
  clankMargin: number;     // xB4, item-vs-item damage tie margin (it_8026FE68)
  reflectVelocity: number; // xD4, knock-away speed for the weaker item
  reflectDamageCap: number; // xD8, hitbox damage clamp after reflection (Item_80269F14)
  shieldBounceAngle: number; // xE0 unk_degrees, added to 90° for the bounce/absorb split (Item_80269DC8)
  explosionLife: number;   // xF8
  /** x80[5]/x80[6] (x94/x98): it_8026B1D4 adds speed × x94 + x98 to a thrown item's hit (min 1). */
  thrownSpeedDamage: number; thrownDamageOffset: number;
  /** xFC: five {min,max} respawn-countdown pairs indexed by the item-frequency rule (it_8026C88C). */
  spawnIntervals: ReadonlyArray<{ min: number; max: number }>;
}
/** Article x0 ItemAttr (third_party/melee/src/melee/it/types.h:80-128). */
export interface ItemAttributes {
  heavy: boolean;          // x0 bit 0x80: crate-style two-hand carry
  actionClass: number;     // x0_78: 0 throwable, 2 swingable, 3 shootable (it_8026B30C)
  holdKind: number;        // x0_hold_kind: hand pose id
  throwSpeedMul: number;   // x4
  spinSpeed: number;       // xC
  gravity: number;         // x10_fall_speed
  terminal: number;        // x14_fall_speed_max
  popUpSpeed: number;      // x18: container-drop launch vy (it_8026F53C)
  damageMul: number;       // x1C
  ecb: { top: number; bottom: number; right: number; left: number }; // x20
  grabRange: [number, number]; // x38
  bounce: number;          // x58 restitution used by the existing article path
  scale: number;           // x60, model scale (never hitboxes)
  destroyGfx: number;      // x64
  destroySfx: number;      // x78
}
export interface ItemHurtCapsule { bone: number; a: [number, number, number]; b: [number, number, number]; radius: number }
/** One of the 8 ItemStateDesc slots: animation pointers plus its parsed itcmd timeline. */
export interface ItemStateData { animation: number; materialAnimation: number; script: AttackDefinition | null }
export interface ItemKindData {
  kind: number; name: string;
  attributes: ItemAttributes;
  /** Raw data-section offset of the per-kind special attribute block (itCommonItems.h structs), 0 when absent. */
  special: number;
  hurtbones: ItemHurtCapsule[];
  states: ItemStateData[];
  model: { joint: number; boneCount: number; boneAttachId: number };
}

/** Rest-pose joint of an item skeleton in HSD pre-order (the dynamic bone-table order). */
export interface ItemJoint { parent: number; flags: number; rotation: V3; scale: V3; translation: V3 }

const FIXED = Math.fround(0.003906);
const s16 = (word: number) => (word << 16) >> 16;
const vec3 = (arc: HsdArchive, offset: number): [number, number, number] => [arc.f32(offset), arc.f32(offset + 4), arc.f32(offset + 8)];
function bounded(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Unsupported item ${label}: ${value}`);
  return value;
}

/** Item animation-script parser (itanimlist.c it_802799E4 + it_803F22A8). Flow opcodes 0–9 are the
 * shared Command_Execute set; 10–25 are the item command table. The unrolled timeline reuses the
 * fighter MoveEvent shape so activeHits() applies unchanged; item hitbox bones are ITEM skeleton
 * indices (0 = the item's own position), never fighter parts. */
export function parseItemScript(arc: HsdArchive, script: number, name: string, frameLimit = 3600): AttackDefinition {
  const events: MoveEvent[] = [], ignored = new Set<number>();
  const loops: Array<{ pointer: number; remaining: number }> = [], returns: number[] = [];
  const visited = new Map<number, { frame: number; relative: number }>();
  let pointer = script, frame = 0, relative = 0;
  const done = (): AttackDefinition => ({ name, events, interruptFrame: null, ignoredOpcodes: [...ignored] });
  for (let steps = 0; steps < 8192; steps++) {
    visited.set(pointer, { frame, relative });
    const word = arc.u32(pointer), opcode = word >>> 26, value = word & 0x3ffffff;
    if (opcode === 0) return done();
    if (opcode === 1 || opcode === 2) {
      if (opcode === 1) relative += value;
      frame = opcode === 1 ? frame + value : Math.max(frame, value);
      if (frame > frameLimit) return done();
      pointer += 4; continue;
    }
    if (opcode === 3) {
      if (loops.length >= 8 || value > 10000) throw new Error(`Invalid item script loop in ${name}.`);
      loops.push({ pointer: pointer + 4, remaining: value || frameLimit + 2 }); pointer += 4; continue;
    }
    if (opcode === 4) {
      const loop = loops.at(-1); if (!loop) throw new Error(`Unmatched item loop end in ${name}.`);
      if (--loop.remaining > 0) pointer = loop.pointer; else { loops.pop(); pointer += 4; } continue;
    }
    if (opcode === 5 || opcode === 7) {
      const target = arc.pointer(pointer + 4);
      const seen = visited.get(target);
      if (opcode === 7 && seen && !loops.length && !returns.length && relative === seen.relative) {
        if (frame === seen.frame) throw new Error(`Item script cycle has no time progress in ${name}.`);
        return done();
      }
      if (opcode === 5) { if (returns.length >= 8) throw new Error(`Item subroutine nesting exceeds budget in ${name}.`); returns.push(pointer + 8); }
      pointer = target; continue;
    }
    if (opcode === 6) {
      const next = returns.pop(); if (next === undefined) throw new Error(`Unmatched item subroutine return in ${name}.`); pointer = next; continue;
    }
    // Command_08 re-runs the tail once per animation wrap; keep parsing so those events stay visible.
    if (opcode === 8 || opcode === 9) { events.push({ frame, type: 'flag', flag: opcode }); pointer += 4; continue; }
    if (opcode === 11) {
      arc.range(pointer, 24);
      const w1 = arc.u32(pointer + 4), w2 = arc.u32(pointer + 8), w3 = arc.u32(pointer + 12), w4 = arc.u32(pointer + 16), w5 = arc.u32(pointer + 20);
      const hit: HitDefinition = {
        id: (word >>> 23) & 7, group: (word >>> 20) & 7, bone: (word >>> 13) & 127, damage: word & 8191,
        radius: Math.fround((w1 >>> 16) * FIXED), offset: [Math.fround(s16(w1) * FIXED), Math.fround(s16(w2 >>> 16) * FIXED), Math.fround(s16(w2) * FIXED)],
        angle: (w3 >>> 23) & 511, growth: (w3 >>> 14) & 511, weightSet: (w3 >>> 5) & 511,
        base: (w4 >>> 23) & 511, element: (w4 >>> 18) & 31, shieldDamage: ((w4 >>> 9) << 24) >> 24,
        soundSeverity: (w4 >>> 6) & 7, soundKind: (w4 >>> 2) & 15, grounded: !!(w4 & 2), airborne: !!(w4 & 1),
        itemFlags: w5,
      };
      // Unlike fighter scripts, item data exceeds the 361 sakurai angle (Flipper authors 362),
      // so the 9-bit angle field is accepted as-is and interpreted by the combat layer.
      if (hit.id > 3 || hit.radius > 100 || hit.damage > 500) throw new Error(`Unsupported item hitbox in ${name}.`);
      events.push({ frame, type: 'create', hit });
      pointer += 24; continue;
    }
    if (opcode === 12 || opcode === 13) {
      const id = (word >>> 23) & 7;
      if (id > 3) throw new Error(`Invalid adjusted item hitbox in ${name}.`);
      events.push({ frame, type: opcode === 12 ? 'damage' : 'radius', id, value: opcode === 12 ? word & 0x1fff : Math.fround((word & 0xffff) * FIXED) });
      pointer += 4; continue;
    }
    if (opcode === 14) { events.push({ frame, type: 'flag', flag: 14, value: word & 0x3ffffff }); pointer += 4; continue; }
    if (opcode === 15) { events.push({ frame, type: 'clear', id: null }); pointer += 4; continue; }
    if (opcode === 16) {
      // it_8027978C: sub-opcode in bits 25–18. 0–2 play a sound; 10/11 manage the loop voice.
      const sub = (word >>> 18) & 255;
      if (sub <= 2) {
        arc.range(pointer, 12);
        const params = arc.u32(pointer + 8);
        events.push({ frame, type: 'sound', sound: arc.u32(pointer + 4), volume: (params >>> 8) & 255, pan: params & 255 });
        pointer += 12; continue;
      }
      if (sub === 10 || sub === 11) { arc.range(pointer, 12); events.push({ frame, type: 'flag', flag: 16, value: sub }); pointer += 12; continue; }
      throw new Error(`Unsupported item sound command ${sub} in ${name}.`);
    }
    if (opcode === 10) {
      arc.range(pointer, 20);
      const w2 = arc.u32(pointer + 8), w3 = arc.u32(pointer + 12), w4 = arc.u32(pointer + 16);
      events.push({ frame, type: 'gfx', effect: arc.u32(pointer + 4) >>> 16, bone: (word >>> 16) & 1023, commonBone: false,
        offset: [Math.fround(s16(w2 >>> 16) * FIXED), Math.fround(s16(w2) * FIXED), Math.fround(s16(w3 >>> 16) * FIXED)],
        range: [Math.fround((w3 & 65535) * FIXED), Math.fround((w4 >>> 16) * FIXED), Math.fround((w4 & 65535) * FIXED)] });
      pointer += 20; continue;
    }
    // 17–19 store itcmd_var0–2 for the per-kind callbacks; keep them as command events.
    if (opcode >= 17 && opcode <= 19) { events.push({ frame, type: 'command', index: opcode - 17, value: word & 0x3ffffff }); pointer += 4; continue; }
    // 20 (it_80279768) raises xDBC_itcmd_var4.flags.x0, a one-tick pulse the interpreter
    // clears before every run (Chikorita's leaf, Blastoise's water); kept as command index 4.
    if (opcode === 20) { events.push({ frame, type: 'command', index: 4, value: 1 }); pointer += 4; continue; }
    if (opcode >= 21 && opcode <= 25) { ignored.add(opcode); pointer += 4; continue; }
    throw new Error(`Unsupported item script opcode ${opcode} in ${name}.`);
  }
  throw new Error(`Item script execution budget exceeded in ${name}.`);
}

function parseAttributes(arc: HsdArchive, common: number, name: string): ItemAttributes {
  const byte = arc.u8(common);
  const attributes: ItemAttributes = {
    heavy: !!(byte & 0x80), actionClass: (byte >>> 3) & 15, holdKind: byte & 7,
    throwSpeedMul: bounded(arc.f32(common + 4), 0, 1000, `${name} throw speed`),
    spinSpeed: bounded(arc.f32(common + 0xc), -10000, 10000, `${name} spin speed`),
    gravity: bounded(arc.f32(common + 0x10), 0, 100, `${name} gravity`),
    terminal: bounded(arc.f32(common + 0x14), 0, 1000, `${name} terminal velocity`),
    popUpSpeed: bounded(arc.f32(common + 0x18), -100, 100, `${name} pop-up speed`),
    damageMul: bounded(arc.f32(common + 0x1c), 0, 1000, `${name} damage multiplier`),
    ecb: { top: arc.f32(common + 0x20), bottom: arc.f32(common + 0x24), right: arc.f32(common + 0x28), left: arc.f32(common + 0x2c) },
    grabRange: [arc.f32(common + 0x38), arc.f32(common + 0x3c)],
    bounce: bounded(arc.f32(common + 0x58), -100, 100, `${name} bounce`),
    scale: bounded(arc.f32(common + 0x60), 0.001, 1000, `${name} scale`),
    destroyGfx: arc.u32(common + 0x64), destroySfx: arc.u32(common + 0x78),
  };
  return attributes;
}

export function parseItemCommonTuning(arc: HsdArchive, common: number): ItemCommonTuning {
  const intervals = Array.from({ length: 5 }, (_, i) => ({
    min: bounded(arc.u32(common + 0xfc + i * 8), 1, 2_000_000, 'spawn interval minimum'),
    max: bounded(arc.u32(common + 0x100 + i * 8), 1, 2_000_000, 'spawn interval maximum'),
  }));
  return {
    lifetime: bounded(arc.u32(common + 0x30), 1, 100000, 'lifetime'),
    reflectedLife: bounded(arc.f32(common + 0x4c), 0, 10, 'reflected life'),
    dropScatter: bounded(arc.f32(common + 0x54), 0, 100, 'drop scatter'),
    shieldBounceX: arc.f32(common + 0x58), shieldBounceY: arc.f32(common + 0x5c), shieldBounceLift: arc.f32(common + 0x60),
    clankMargin: arc.u32(common + 0xb4), reflectVelocity: arc.f32(common + 0xd4), reflectDamageCap: arc.u32(common + 0xd8),
    shieldBounceAngle: bounded(arc.f32(common + 0xe0), 0, 360, 'shield bounce angle'),
    explosionLife: bounded(arc.f32(common + 0xf8), 1, 3600, 'explosion life'),
    thrownSpeedDamage: bounded(arc.f32(common + 0x94), 0, 100, 'thrown speed damage'), thrownDamageOffset: bounded(arc.f32(common + 0x98), -100, 100, 'thrown damage offset'),
    spawnIntervals: intervals,
  };
}

/** Parsed ItCo common table with lazily-built per-state models. Models are render-only and
 * memoized; simulation state never references them beyond the article-key registry. */
export class ItemsData {
  readonly common: ItemCommonTuning;
  readonly kinds = new Map<number, ItemKindData>();
  /** Poké Ball Pokémon + their projectiles (itPublicData xC), keyed by article slot. */
  readonly pokemon = new Map<number, ItemKindData>();
  private readonly models = new Map<string, HsdModel>();
  private readonly clips = new Map<string, AnimationClip | null>();
  private readonly skeletons = new Map<number, ItemJoint[]>();
  private readonly ramps = new Map<string, number[]>();
  private warps: Array<{ x: number[]; y: number[]; sfx: number }> | null = null;
  /** itPublicData x10 (it_804D6D40) +4: the fixed speed a knocked-out Pokémon is launched at
   * (it_8027B964 normalizes the hit's knockback direction to this length). */
  readonly pokemonLaunchSpeed: number;
  constructor(readonly archive: HsdArchive) {
    const root = archive.symbol('itPublicData');
    this.common = parseItemCommonTuning(archive, archive.pointer(root));
    const table = archive.pointer(root + 4);
    for (let kind = 0; kind < COMMON_ARTICLE_COUNT; kind++) {
      const data = this.parseArticle(archive.pointer(table + kind * 4), kind, COMMON_ITEM_NAMES[kind]!);
      if (data) this.kinds.set(kind, data);
    }
    const pokeTable = archive.pointer(root + 0xc);
    for (let slot = 0; slot < 47; slot++) {
      if (!archive.relocations.has(pokeTable + slot * 4)) continue;
      const data = this.parseArticle(archive.u32(pokeTable + slot * 4), POKEMON_BASE + slot, POKEMON_NAMES[slot] ?? `PokeProj${slot}`);
      if (data) this.pokemon.set(slot, data);
    }
    if (!this.kinds.size) throw new Error('ItCo.dat exposes no common item articles.');
    const zako = archive.relocations.has(root + 0x10) ? archive.u32(root + 0x10) : 0;
    this.pokemonLaunchSpeed = zako ? bounded(archive.f32(zako + 4), 0, 100, 'Pokémon launch speed') : 0;
  }
  private parseArticle(article: number, kind: number, name: string): ItemKindData | null {
    if (!article) return null;
    const common = this.archive.pointer(article), states = this.archive.pointer(article + 0xc), model = this.archive.pointer(article + 0x10);
    if (!common) return null;
    const archive = this.archive;
    const hurtList = archive.pointer(article + 8), hurtbones: ItemHurtCapsule[] = [];
    if (hurtList) {
      const count = archive.u32(hurtList), descs = archive.pointer(hurtList + 4);
      if (count > 8) throw new Error(`Unsupported item hurtbone count for ${name}.`);
      for (let i = 0; i < count; i++) {
        const desc = descs + i * 0x20;
        hurtbones.push({ bone: archive.u32(desc), a: vec3(archive, desc + 4), b: vec3(archive, desc + 16), radius: bounded(archive.f32(desc + 28), 0, 100, `${name} hurtbone radius`) });
      }
    }
    // ItemStateArray declares 8 slots, but each article stores only as many ItemStateDesc
    // entries as its state table's highest anim_id; the next structure follows immediately,
    // so the relocation extent bounds the real count (verified: Bat 1, Sword 2, Parasol 8).
    // Slot words are pointers only when the relocation table lists them; other nonzero
    // values (-1 sentinels, inline data) are not dereferenced.
    // Foods owns no state array or base model at all (its food models live elsewhere in ItCo).
    const stateData: ItemStateData[] = [];
    if (states) {
      const stateBytes = Math.min(8 * 0x10, archive.extent(states));
      for (let index = 0; (index + 1) * 0x10 <= stateBytes; index++) {
        const desc = states + index * 0x10;
        const pointerAt = (offset: number) => (archive.relocations.has(desc + offset) ? archive.u32(desc + offset) : 0);
        const script = pointerAt(0xc);
        stateData.push({ animation: pointerAt(0), materialAnimation: pointerAt(4), script: script ? parseItemScript(archive, script, `${name}/${index}`) : null });
      }
      if (!stateData.length && kind < POKEMON_BASE) throw new Error(`Original item ${name} exposes no animation states.`);
    }
    return {
      kind, name, attributes: parseAttributes(archive, common, name), special: archive.pointer(article + 4),
      hurtbones, states: stateData,
      model: model ? { joint: archive.pointer(model), boneCount: archive.u32(model + 4), boneAttachId: archive.u32(model + 8) | 0 } : { joint: 0, boneCount: 0, boneAttachId: -1 },
    };
  }
  /** Resolve a MatchItem kind: < POKEMON_BASE = common table, otherwise a Pokémon slot. */
  kind(kind: number): ItemKindData {
    const data = kind >= POKEMON_BASE ? this.pokemon.get(kind - POKEMON_BASE) : this.kinds.get(kind);
    if (!data) throw new Error(`Item kind ${kind} is not available.`);
    return data;
  }
  /** Foods special block: an array of 16-byte per-type records — record 0's +0 holds the
   * type count; each record carries {+4 model joint, +8 heal, +C carry offset}. */
  private foods(): { special: number } | null {
    const data = this.kinds.get(COMMON_ITEM_NAMES.indexOf('Foods'));
    return data?.special ? { special: data.special } : null;
  }
  foodCount(): number {
    const foods = this.foods();
    if (!foods) return 1;
    const count = this.archive.u32(foods.special);
    return count >= 1 && count <= 64 ? count : 1;
  }
  foodHeal(variant: number): number {
    const foods = this.foods();
    if (!foods) return 5;
    const heal = this.archive.u32(foods.special + Math.max(0, Math.min(this.foodCount() - 1, variant)) * 16 + 8);
    return heal >= 1 && heal <= 999 ? heal : 5;
  }
  /** The food type's own model joint from its record (+4). */
  foodModel(variant: number): HsdModel {
    const key = `food:${variant}`;
    let model = this.models.get(key);
    if (!model) {
      const foods = this.foods();
      if (!foods) throw new Error('Foods records are unavailable.');
      const record = foods.special + Math.max(0, Math.min(this.foodCount() - 1, variant)) * 16;
      if (!this.archive.relocations.has(record + 4)) throw new Error(`Food type ${variant} has no model.`);
      model = loadModel(this.archive, { offset: this.archive.u32(record + 4), name: `item-food-${variant}` });
      this.models.set(key, model);
    }
    return model;
  }
  /** The state's joint animation (HSD_AnimJoint tree in pre-order), null for animation-less
   * descs. Simulation uses it for the anim-end transitions and root motion (it_8027A160). */
  clip(kind: number, state: number): AnimationClip | null {
    const key = `${kind}:${state}`;
    if (!this.clips.has(key)) {
      const desc = this.kind(kind).states[state];
      this.clips.set(key, desc?.animation ? loadJointAnimation(this.archive, desc.animation) : null);
    }
    return this.clips.get(key)!;
  }
  /** it_80293660: the Kinoko article's grow/shrink ramp curves (special +8 = curve 0,
   * +0xC = curve 1), sampled per frame as the joint's X scale (0 = from, 1 = to). */
  kinokoRamp(curve: 0 | 1): number[] {
    const key = `kinoko:${curve}`;
    let samples = this.ramps.get(key);
    if (!samples) {
      const special = this.kinds.get(COMMON_ITEM_NAMES.indexOf('Kinoko'))?.special ?? 0;
      const slot = special + 8 + curve * 4;
      const clip = special && this.archive.relocations.has(slot) ? loadJointAnimation(this.archive, this.archive.u32(slot)) : null;
      const track = clip?.joints[0]?.tracks.find((entry) => entry.type === 8);
      samples = clip && track ? Array.from({ length: Math.max(1, Math.ceil(clip.endFrame)) + 1 }, (_, frame) => sampleTrack(track.keys, frame) ?? 1) : [1];
      this.ramps.set(key, samples);
    }
    return samples;
  }
  /** itWstarAttributes x24/x28: the rider flight paths (HSD_AnimJoint on the fighter root,
   * it_80294364) as per-frame root translations, with each path's pickup SFX. */
  warpPaths(): Array<{ x: number[]; y: number[]; sfx: number }> {
    if (!this.warps) {
      const special = this.kinds.get(COMMON_ITEM_NAMES.indexOf('WStar'))?.special ?? 0, arc = this.archive;
      const count = special ? Math.max(0, Math.min(16, arc.u32(special + 0x24) | 0)) : 0;
      this.warps = [];
      for (let i = 0; i < count; i++) {
        const slot = special + 0x28 + i * 8;
        const clip = arc.relocations.has(slot) ? loadJointAnimation(arc, arc.u32(slot)) : null;
        const root = clip?.joints[0], frames = Math.max(1, Math.ceil(clip?.endFrame ?? 1));
        const sample = (type: number) => { const track = root?.tracks.find((entry) => entry.type === type); return Array.from({ length: frames + 1 }, (_, f) => (track ? sampleTrack(track.keys, f) ?? 0 : 0)); };
        this.warps.push({ x: sample(5), y: sample(6), sfx: arc.u32(slot + 4) | 0 });
      }
    }
    return this.warps;
  }
  /** The article's rest skeleton (HSD_Joint tree, pre-order), without geometry. */
  skeleton(kind: number): ItemJoint[] {
    let joints = this.skeletons.get(kind);
    if (!joints) {
      joints = [];
      const root = this.kind(kind).model.joint, arc = this.archive, out = joints, seen = new Set<number>();
      // Same pre-order walk as loadModel, so indices match the rendered joints.
      const visit = (joint: number, parent: number): void => {
        if (seen.has(joint) || out.length >= 512) throw new Error('Cyclic or oversized item skeleton.');
        seen.add(joint);
        const index = out.length;
        out.push({ parent, flags: arc.u32(joint + 4), rotation: [arc.f32(joint + 0x14), arc.f32(joint + 0x18), arc.f32(joint + 0x1c)],
          scale: [arc.f32(joint + 0x20), arc.f32(joint + 0x24), arc.f32(joint + 0x28)], translation: [arc.f32(joint + 0x2c), arc.f32(joint + 0x30), arc.f32(joint + 0x34)] });
        for (let child = arc.pointer(joint + 8); child; child = arc.pointer(child + 0xc)) visit(child, index);
      };
      if (root) visit(root, -1);
      this.skeletons.set(kind, joints);
    }
    return joints;
  }
  /** The article model without any state animation (anim_id -1 states keep the rest pose). */
  restModel(kind: number): HsdModel {
    const key = `${kind}:rest`;
    let model = this.models.get(key);
    if (!model) {
      const data = this.kind(kind);
      if (!data.model.joint) throw new Error(`Item ${data.name} has no base model joint.`);
      model = loadModel(this.archive, { offset: data.model.joint, name: `item-${data.name}-rest` });
      this.models.set(key, model);
    }
    return model;
  }
  /** Unown letter models (itUnknownAttributes x24: HSD_Joint*[26], swapped in by it_80273318). */
  letterModel(kind: number, letter: number): HsdModel {
    const key = `${kind}:letter${letter}`;
    let model = this.models.get(key);
    if (!model) {
      const special = this.kind(kind).special, slot = special + 0x24 + Math.max(0, Math.min(25, letter)) * 4;
      if (!special || !this.archive.relocations.has(slot)) return this.restModel(kind);
      model = loadModel(this.archive, { offset: this.archive.u32(slot), name: `item-unown-${letter}` });
      this.models.set(key, model);
    }
    return model;
  }
  /** The state's model instance (item model + that state's joint/material animation). */
  stateModel(kind: number, state: number): HsdModel {
    const key = `${kind}:${state}`;
    let model = this.models.get(key);
    if (!model) {
      const data = this.kind(kind), desc = data.states[state];
      if (!desc) throw new Error(`Item ${data.name} has no state ${state}.`);
      if (!data.model.joint) throw new Error(`Item ${data.name} has no base model joint.`);
      model = loadModel(this.archive, { offset: data.model.joint, name: `item-${data.name}-${state}`, animation: desc.animation, materialAnimation: desc.materialAnimation });
      this.models.set(key, model);
    }
    return model;
  }
}

export function parseItemsData(archive: HsdArchive): ItemsData { return new ItemsData(archive); }
