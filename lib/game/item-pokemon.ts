// Poké Ball Pokémon (third_party/melee/src/melee/it/it_279C.c + it/kinds/it*.c): the per-kind
// state tables, spawn callbacks and accessory hooks transcribed from the decomp. Every tuning
// number is read from the kind's own ItCo special-attribute block; hitboxes, damage and the
// itcmd trigger variables come from each state's item script (lib/game/item-data.ts).
import { Matrix4, Vector3 } from 'three';
import type { GameContent } from './load.ts';
import type { MatchFighter, MatchEvent, PoseProvider } from './match.ts';
import type { ItemsData } from './item-data.ts';
import type { MatchItem, ItemImpact } from './item-engine.ts';
import { activeHits, type HitDefinition } from './moves.ts';
import { sampleTrack } from '../hsd/animation.ts';
import { jointMatrix } from '../hsd/transform.ts';
import type { V3 } from '../hsd/model.ts';
import { POKEMON_BASE } from './item-kinds.ts';
import { floorY } from './data.ts';
import { traceStage } from './link-hookshot.ts';
import { pointSegmentDistanceSquared, segmentDistanceSquared } from './collision.ts';
import { type HurtboxCache, hurtSweepCandidate } from './hurt-cache.ts';
import { shieldBubble } from './combat.ts';
import { linkHits } from './link.ts';

const f32 = Math.fround;
const HALF_PI = Math.PI / 2;
const DEG = 0.017453292;
/** Item_80268E5C flags: ITEM_UNK_0x1 keeps the running animation/script, ITEM_ANIM_UPDATE reloads them. */
const KEEP = 1, ANIM = 2;

/** it_803F23CC slots (kind - It_PKind_Start). 30-45 are the Pokémon's own projectiles. */
export const PK = {
  Tosakinto: 0, Chicorita: 1, Kabigon: 2, Kamex: 3, Matadogas: 4, Lizardon: 5, Fire: 6, Thunder: 7, Freezer: 8, Sonans: 9,
  Hassam: 10, Unknown: 11, Entei: 12, Raikou: 13, Suikun: 14, Kireihana: 15, Marumine: 16, Lugia: 17, Houou: 18, Metamon: 19,
  Pippi: 20, Togepy: 21, Mew: 22, Cerebi: 23, Hitodeman: 24, Lucky: 25, Porygon2: 26, Hinoarashi: 27, Maril: 28, Fushigibana: 29,
  Leaf: 30, Water: 31, Gas1: 32, Gas2: 33, Flame1: 34, UnownSwarm: 38, Aero1: 39, SacredFire: 42, Star: 43, LuckyEgg: 44, CyndaFlame: 45,
} as const;

/** Per-state anim_id columns of each kind's ItemStateTable (-1: no animation and no script). */
const ANIM_IDS: Record<number, readonly number[]> = {
  0: [0, 1, 2, -1, -1], 1: [0, 1, -1], 2: [0, 1, -1], 3: [0, 1, 2, -1], 4: [0, 1, -1], 5: [0, 1, 2, 3],
  6: [0, 1, 2], 7: [0, 1, 2], 8: [0, 1, 2], 9: [0, 1, -1], 10: [0, 1, 2, -1], 11: [0, 1, -1],
  12: [0, -1], 13: [0, -1], 14: [0, -1], 15: [0, 1, 2, 3, 4], 16: [0, 1, 2, 3, 4, 5, 6],
  17: [0, 1, 2, 3, 4, 5], 18: [0, 1, 2, 3, 4, 5], 19: [0, 1, -1], 20: [0, 1, 2, 3, 4, 5], 21: [0, 1, 2, 3, 4, 5, 6],
  22: [0, 1, 2], 23: [0, 1, 2], 24: [0, 1, -1], 25: [-1, -1, 1, 2, 3, 0, -1], 26: [0, 1], 27: [-1, 1, -1],
  28: [-1, 0, -1, -1], 29: [0, 1, -1],
};

/** The shared materialize block the Poké Ball injects (it_8027AAA0 → itPokemonSpawn_ItemVars). */
export interface PokemonMaterialize {
  gravity: number; terminal: number; fall: number; step: number; keys: number[];
  rate: number; countdown: number; count: number; index: number; phase: number; delta: number;
}
/** Rollback-safe per-Pokémon state (plain numbers only). Field names follow the Item struct. */
export interface PokemonState {
  st: number;            // current ItemStateTable row (Item::msid)
  anim: number;          // loaded ItemStateDesc (-1: animation removed)
  frame: number; speed: number; freshAnim: boolean;   // x5CC / x5D0
  script: number; scriptFrame: number; freshScript: boolean; cursor: number;
  var0: number; var1: number; var2: number; flag4: number;   // xDAC/xDB0/xDB4, xDBC pulse
  scale: number;         // root joint scale (HSD_JObjSetScale on the item jobj)
  z: number; vz: number; air: boolean;
  life: number; half: number;   // xD44 / xD48
  rootPrev: V3; rootDelta: V3;  // pokemon_spawn x10 / x4 (it_8027A160)
  v: number[];           // per-kind item vars (xDD4 + 0x60 onward)
  rotY: number | null; tilt: number; spin: V3;
  hidden: boolean; letter: number;
  hurt: boolean; taken: number; last: number; dir: number; angle: number;
  acc: number; target: number; grab: boolean; blast: boolean;
  m: PokemonMaterialize | null;
}

export interface PokemonHost {
  readonly content: GameContent;
  readonly data: ItemsData;
  random(): number;
  spawn(kind: number, x: number, y: number): MatchItem;
  remove(item: MatchItem): void;
  /** Item_804A0E24: the last two released kinds and the once-per-match Mew/Celebi latch. */
  memory: { last: number; previous: number; legend: number };
  alive(item: MatchItem): boolean;
  /** It_Kind_Egg (Chansey's non-healing egg), null when the article is unavailable. */
  commonEgg: number | null;
  /** it_8026D3CC: whether any healing item (Heart, Tomato, Foods) is enabled. */
  healingEnabled?(): boolean;
}
export interface PokemonContext {
  fighters: readonly MatchFighter[]; poses: PoseProvider; hurtCache: HurtboxCache;
  impacts: ItemImpact[]; events: MatchEvent[];
}

type Fn = (D: PokemonDriver, it: MatchItem, pk: PokemonState) => void;
type Pred = (D: PokemonDriver, it: MatchItem, pk: PokemonState) => boolean;
type Coll = (D: PokemonDriver, it: MatchItem, pk: PokemonState, prev: V3) => boolean;
interface Row { anim?: Pred; phys?: Fn; coll?: Coll }
interface Kind {
  rows: Row[]; spawned: Fn; acc?: Record<number, Fn>;
  /** dmg_received (Chansey/Cyndaquil/Marill knock-outs, Wobbuffet's wobble). */
  damaged?: Fn;
  /** dmg_dealt: false keeps the item alive; true destroys it. */
  dealt?: (D: PokemonDriver, it: MatchItem, pk: PokemonState) => boolean;
  /** hit_shield returning true: the projectile is consumed by the shield. */
  shieldDestroys?: boolean;
  /** dynamic bone whose translation drives the item (it_8027A160), for render zeroing. */
  rootBone?: number;
  /** Particle-only originals (efSync generators outside the loaded banks): a common hit effect
   * re-emitted along the path every `every` frames stands in for the item's own generator. */
  trail?: { effect: number; every: number };
}

export function newPokemonState(scale: number): PokemonState {
  return {
    st: 0, anim: -1, frame: 0, speed: 1, freshAnim: true, script: -1, scriptFrame: 0, freshScript: true, cursor: 0,
    var0: 0, var1: 0, var2: 0, flag4: 0, scale, z: 0, vz: 0, air: true, life: 0, half: 0,
    rootPrev: [0, 0, 0], rootDelta: [0, 0, 0], v: new Array(16).fill(0), rotY: null, tilt: 0, spin: [0, 0, 0],
    hidden: false, letter: 0, hurt: false, taken: 0, last: 0, dir: 1, angle: 0,
    acc: 0, target: -1, grab: false, blast: true, m: null,
  };
}

/** it_80272860: gravity toward `-g`, capped at `term` only while falling against it. */
function gravityStep(velocity: number, g: number, term: number): number {
  const fallDir = g < 0 ? -1 : 1, velDir = velocity < 0 ? -1 : 1;
  if (velDir !== fallDir) return Math.abs(velocity) < term ? f32(velocity - g) : velocity;
  return f32(velocity - g);
}

// ---------------------------------------------------------------------------------------------
// Shared rows and callbacks
// ---------------------------------------------------------------------------------------------
/** it_80279FF8 / it_8027A09C / it_8027A118: grow out of the ball, fall on its injected gravity. */
const matAnim: Pred = (D, it) => { D.materializeAnim(it); return false; };
const matPhys: Fn = (D, it) => { D.materializePhys(it); };
const matRow = (land?: Fn, phys: Fn = matPhys): Row => ({ anim: matAnim, phys, coll: (D, it, _pk, prev) => D.materializeColl(it, prev, land) });
const gravityPhys: Fn = (D, it, pk) => { if (pk.air) D.gravity(it, D.attr(it).gravity, D.attr(it).terminal); };
const airGroundColl: Coll = (D, it, pk, prev) => { if (pk.air) D.airColl(it, prev); else D.groundColl(it); return false; };
const zeroVel: Fn = (_D, it, pk) => { it.vx = 0; it.vy = 0; pk.vz = 0; };
const tickLife: Pred = (_D, _it, pk) => { if (pk.life <= 0) return true; pk.life -= 1; return false; };
const preTickLife: Pred = (_D, _it, pk) => { pk.life -= 1; return pk.life <= 0; };
const animEnds: Pred = (D, it) => !D.playing(it);
const aboveTop: (D: PokemonDriver, it: MatchItem) => boolean = (D, it) => it.y > D.blast.top;

// ---------------------------------------------------------------------------------------------
// Kind tables
// ---------------------------------------------------------------------------------------------
const KINDS: Record<number, Kind> = {};

// Goldeen (ittosakinto.c): flops on root motion with a random ±x8 hop, lifetime x4.
{
  const flop: Fn = (D, it, pk) => {
    D.gfx(it, 0x46e); pk.air = true;
    if (pk.v[0]! >= 3) pk.v[0] = 0;
    D.enter(it, pk.v[0]!, ANIM);
    pk.v[1] = D.F(it, 8); if (D.randi(2) !== 0) pk.v[1] = -pk.v[1]!;
  };
  const flopRow: Row = {
    anim: (D, it, pk) => { D.rootSample(it, 1); return tickLife(D, it, pk); },
    phys: (D, it, pk) => { D.rootApply(it); it.vx = f32(it.vx + pk.v[1]!); },
    coll: (D, it, pk, prev) => {
      const floor = D.floorSweep(it, prev);
      if (!D.playing(it)) { pk.v[0]!++; if (floor) flop(D, it, pk); else { pk.air = true; D.enter(it, 3, ANIM); } }
      else if (floor) { pk.v[0]!++; flop(D, it, pk); }
      return false;
    },
  };
  KINDS[PK.Tosakinto] = {
    rootBone: 1,
    rows: [flopRow, flopRow, flopRow,
      { phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal), coll: (D, it, pk, prev) => { D.airColl(it, prev, () => flop(D, it, pk)); return false; } },
      matRow((D, it, pk) => { zeroVel(D, it, pk); flop(D, it, pk); })],
    spawned: (D, it, pk) => { pk.v[0] = 0; pk.life = D.F(it, 4); D.initSpawn(it, D.F(it, 0)); D.sound(it, 0x272e); pk.air = true; D.enter(it, 4, ANIM); },
  };
}

// Chikorita (itchicorita.c): x4+1 leaf-throw loops; the script's var4 pulse throws each leaf.
{
  const loop: Fn = (D, it, pk) => { if (pk.v[0] === -1) pk.v[0] = D.I(it, 4); D.enter(it, 0, ANIM); pk.acc = 1; };
  const phys: Fn = (D, it, pk) => {
    D.rootApply(it);
    if (pk.air) { pk.v[1] = gravityStep(pk.v[1]!, D.attr(it).gravity, D.attr(it).terminal); it.vy = pk.v[1]!; }
    else pk.v[1] = 0;
  };
  KINDS[PK.Chicorita] = {
    rootBone: 1,
    rows: [
      { anim: (D, it, pk) => {
        D.rootSample(it, 1);
        if (!D.playing(it)) { if (pk.v[0]! <= 0) { pk.v[0] = 0; D.enter(it, 1, ANIM); } else { pk.v[0]!--; D.enter(it, 0, ANIM); pk.acc = 1; } }
        return false;
      }, phys, coll: airGroundColl },
      { anim: (D, it) => { D.rootSample(it, 1); return !D.playing(it); }, phys, coll: airGroundColl },
      matRow((D, it, pk) => { zeroVel(D, it, pk); loop(D, it, pk); }),
    ],
    acc: { 1: (D, it, pk) => {
      if (!pk.flag4) return;
      pk.flag4 = 0;
      // it_802C9B20: the leaf reads Chikorita's x8/xC spawn offset and x10 speed.
      D.child(it, PK.Leaf, f32(it.x + D.F(it, 8) * it.facing), f32(it.y + D.F(it, 0xc)), pk.z, f32(D.F(it, 0x10) * it.facing), 0, 0, it.facing);
      D.sound(it, 0x2710);
    } },
    spawned: (D, it, pk) => { D.faceNearest(it); pk.v[0] = -1; pk.flag4 = 0; D.initSpawn(it, D.F(it, 0)); pk.v[1] = 0; pk.air = true; D.enter(it, 2, ANIM); D.sound(it, 0x2711); },
  };
  KINDS[PK.Leaf] = {
    rows: [{ anim: tickLife, coll: (D, it, _pk, prev) => D.anyContact(it, prev) }],
    spawned: (D, it, pk) => { pk.life = D.F(it, 0); D.enter(it, 0, ANIM); },
  };
}

// Snorlax (itkabigon.c): stands, leaps off the top at x4 when the script raises var1, hides for
// x10 frames, then drops from the top blast line at x8 scaled to xC until it leaves the bottom.
{
  const drop: Fn = (D, it, pk) => { pk.hidden = true; D.enter(it, 1, ANIM); it.vy = 0; pk.scale = pk.v[2]!; D.sound(it, 0x2724); };
  KINDS[PK.Kabigon] = {
    rows: [
      { anim: (D, it, pk) => {
        if (pk.var1) { it.vy = pk.v[0]!; pk.air = true; if (pk.var2) pk.var2 = 0; }
        if (aboveTop(D, it)) drop(D, it, pk);
        return false;
      }, phys: (D, it, pk) => { if (!pk.var1) gravityPhys(D, it, pk); }, coll: (D, it, pk, prev) => (pk.var1 ? false : airGroundColl(D, it, pk, prev)) },
      { anim: (D, it, pk) => {
        if (!pk.var0) {
          if (pk.v[3]! <= 0) { pk.var0 = 1; pk.hidden = false; it.y = f32(D.blast.top); it.vy = pk.v[1]!; D.quake(it, 'small'); }
          else pk.v[3]!--;
        } else if (it.y < D.blast.bottom) return true;
        if (!D.playing(it)) { D.enter(it, 1, ANIM); pk.scale = pk.v[2]!; }
        return false;
      } },
      matRow((D, it, pk) => { zeroVel(D, it, pk); D.enter(it, 0, ANIM); D.quake(it, 'medium'); }),
    ],
    spawned: (D, it, pk) => {
      pk.v[0] = D.F(it, 4); pk.v[1] = D.F(it, 8); pk.v[2] = D.F(it, 0xc); pk.v[3] = D.I(it, 0x10);
      pk.blast = true; pk.var0 = 0; pk.var1 = 0; pk.var2 = 1;
      D.initSpawn(it, D.F(it, 0)); D.sound(it, 0x2723); pk.air = true; D.enter(it, 2, ANIM);
    },
  };
}

// Blastoise (itkamex.c): x4+1 firing loops; each var4 pulse fires a Hydro Pump from alternating
// cannons (±x10 depth) and kicks it back at x18, bled off by x1C.
{
  const fire: Fn = (D, it, pk) => {
    if (pk.v[0] === -1) { pk.v[0] = D.I(it, 4); pk.v[2] = D.F(it, 0x18); pk.v[3] = D.F(it, 0x1c); }
    D.enter(it, 1, ANIM); pk.acc = 1;
  };
  KINDS[PK.Kamex] = {
    rows: [
      { anim: (D, it, pk) => { if (!D.playing(it)) fire(D, it, pk); return false; }, phys: gravityPhys, coll: airGroundColl },
      { anim: (D, it, pk) => {
        if (!D.playing(it)) { if (pk.v[0]! <= 0) { pk.v[0] = 0; it.vx = 0; D.enter(it, 2, ANIM); } else { pk.v[0]!--; fire(D, it, pk); } }
        return false;
      }, phys: (D, it, pk) => {
        if (it.vx && ((it.vx > 0 && it.facing <= 0) || (it.vx <= 0 && it.facing > 0))) it.vx = f32(it.vx + pk.v[3]! * it.facing);
        gravityPhys(D, it, pk);
      }, coll: airGroundColl },
      { anim: animEnds, phys: gravityPhys, coll: airGroundColl },
      matRow((D, it, pk) => { zeroVel(D, it, pk); D.enter(it, 0, ANIM); }),
    ],
    acc: { 1: (D, it, pk) => {
      if (!pk.flag4) return;
      const depth = f32((pk.v[1] ? -1 : 1) * D.F(it, 0x10) * it.facing);
      D.child(it, PK.Water, f32(it.x + D.F(it, 8) * it.facing), f32(it.y + D.F(it, 0xc)), f32(pk.z + depth), f32(D.F(it, 0x14) * it.facing), 0, 0, it.facing);
      pk.v[1] = pk.v[1] ? 0 : 1;
      D.sound(it, it.facing === 1 ? 0x271d : 0x271c);
      it.vx = f32(pk.v[2]! * -it.facing);
      pk.flag4 = 0;
    } },
    spawned: (D, it, pk) => {
      D.faceNearest(it); pk.v[0] = -1; pk.flag4 = 0; pk.v[1] = 0; pk.v[2] = 0; pk.v[3] = 0;
      D.initSpawn(it, D.F(it, 0)); pk.air = true; D.enter(it, 3, ANIM); D.sound(it, 0x271e);
    },
  };
  KINDS[PK.Water] = {
    shieldDestroys: true,
    rows: [{ anim: preTickLife, phys: (_D, _it, pk) => { if (pk.scale < 1) pk.scale = f32(pk.scale + 0.06); }, coll: (D, it, _pk, prev) => D.anyContact(it, prev) }],
    spawned: (D, it, pk) => { pk.life = D.F(it, 0); D.enter(it, 0, ANIM); pk.scale = 0.2; },
  };
}

// Weezing (itmatadogas.c): hovers where its fall timer ends; while var0 is up it puffs a gas
// every (s32)x4 frames at a random angle (Gas1 at x8, Gas2 at xC).
{
  const gas = (D: PokemonDriver, it: MatchItem, pk: PokemonState, slot: number, speed: number): void => {
    const angle = D.randi(360) * DEG;
    D.child(it, slot, it.x, it.y, pk.z, f32(speed * Math.cos(angle)), f32(speed * Math.sin(angle)), 0, it.facing);
    pk.v[1] = pk.v[1] ? 0 : 1;
    if (pk.v[1]) D.sound(it, 0x2712 + D.randi(3));
  };
  KINDS[PK.Matadogas] = {
    rows: [
      { anim: animEnds, coll: (D, it, _pk, prev) => { D.airColl(it, prev); return false; } },
      { anim: (D, it, pk) => { if (!D.playing(it)) { D.enter(it, 0, ANIM); pk.rotY = 0; } return false; }, coll: (D, it, _pk, prev) => { D.airColl(it, prev); return false; } },
      { anim: matAnim, phys: (D, it, pk) => {
        if (D.materializePhys(it)) { zeroVel(D, it, pk); D.enter(it, 1, ANIM); pk.rotY = 0; pk.acc = 1; }
      }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
    ],
    acc: { 1: (D, it, pk) => {
      if (!pk.var0) return;
      if (--pk.v[0]! === 0) {
        pk.v[0] = Math.trunc(D.F(it, 4));
        if (D.randi(2) === 0) gas(D, it, pk, PK.Gas1, D.F(it, 8)); else gas(D, it, pk, PK.Gas2, D.F(it, 0xc));
      }
    } },
    spawned: (D, it, pk) => {
      pk.var0 = 0; pk.v[0] = Math.trunc(D.F(it, 4)); pk.v[1] = 0;
      D.initSpawn(it, D.F(it, 0)); pk.air = true; D.enter(it, 2, ANIM); pk.rotY = 0; D.sound(it, 0x2715);
    },
  };
  const gasKind: Kind = {
    rows: [{ anim: tickLife, phys: (D, it, pk) => {
      const k = D.slot(it) === PK.Gas1 ? D.F(it, 4) : D.F(it, 8);
      it.vx = f32(it.vx * k); it.vy = f32(it.vy * k); pk.vz = f32(pk.vz * k);
    } }],
    spawned: (D, it, pk) => { pk.life = D.F(it, 0); D.enter(it, 0, ANIM); },
  };
  KINDS[PK.Gas1] = gasKind; KINDS[PK.Gas2] = gasKind;
}

// Charizard (itlizardon.c): x4+1 breath loops; the script's var1 flips the breath side and
// var0 streams a flame every x14 frames from mouth bone 0x32 at [xC, x8]° and speed x10.
{
  const breath: Fn = (D, it, pk) => { if (pk.v[0] === -1) pk.v[0] = D.I(it, 4); D.enter(it, 2, ANIM); pk.acc = 1; };
  KINDS[PK.Lizardon] = {
    rows: [
      matRow((D, it, pk) => { zeroVel(D, it, pk); D.enter(it, 1, ANIM); }),
      { anim: (D, it, pk) => { if (!D.playing(it)) breath(D, it, pk); return false; }, phys: gravityPhys, coll: airGroundColl },
      { anim: (D, it, pk) => {
        if (!D.playing(it)) { if (pk.v[0]! <= 0) { pk.v[0] = 0; D.enter(it, 3, ANIM); } else { pk.v[0]!--; breath(D, it, pk); } }
        return false;
      }, phys: gravityPhys, coll: airGroundColl },
      { anim: animEnds, phys: gravityPhys, coll: airGroundColl },
    ],
    acc: { 1: (D, it, pk) => {
      if (pk.var1) { pk.v[1] = pk.v[1] ? 0 : 1; pk.v[2] = D.I(it, 0x14); pk.var1 = 0; }
      if (!pk.var0) return;
      const next = pk.v[2]! - 1; pk.v[2] = next;
      if (next !== 0) return;
      pk.v[2] = D.I(it, 0x14);
      const mouth = D.bonePoint(it, 0x32, [0, 0, 0]);
      const angle = f32(DEG * (D.F(it, 8) - D.randi(Math.trunc(D.F(it, 8) - D.F(it, 0xc)))));
      const side = pk.v[1] ? -1 : 1, speed = D.F(it, 0x10);
      if (D.child(it, PK.Flame1 + D.randi(4), mouth[0], mouth[1], mouth[2], f32(side * speed * Math.cos(angle)), f32(speed * Math.sin(angle)), 0, side)) {
        pk.v[3] = pk.v[3] ? 0 : 1;
        if (pk.v[3]) D.sound(it, 0x2716 + D.randi(3));
      }
    } },
    spawned: (D, it, pk) => {
      pk.var0 = 0; pk.var1 = 0; pk.var2 = 0; pk.v[0] = -1; pk.v[1] = 0; pk.v[2] = 0; pk.v[3] = 0;
      pk.air = true; D.enter(it, 0, ANIM); D.initSpawn(it, D.F(it, 0)); D.sound(it, 0x2719);
    },
  };
  const flame: Kind = {
    shieldDestroys: true, trail: { effect: 1002, every: 3 },
    rows: [{ anim: tickLife, phys: (D, it, pk) => { const k = D.F(it, 4); it.vx = f32(it.vx * k); it.vy = f32(it.vy * k); pk.vz = f32(pk.vz * k); }, coll: (D, it, _pk, prev) => D.anyContact(it, prev) }],
    spawned: (D, it, pk) => { pk.life = D.F(it, 0); pk.half = f32(pk.life * D.data.common.reflectedLife); D.enter(it, 0, ANIM); },
  };
  for (let slot = PK.Flame1; slot < PK.Flame1 + 4; slot++) KINDS[slot] = flame;
}

// Moltres (itfire.c): leaves the ground at x4, then flaps (vy reset to x8) and climbs by xC per
// frame until it passes the top blast line.
{
  const flap: Fn = (D, it) => { D.gfx(it, 0x463); it.vy = D.F(it, 8); D.enter(it, 2, ANIM); };
  KINDS[PK.Fire] = {
    rows: [
      { anim: matAnim, phys: (D, it, pk) => {
        if (D.materializePhys(it)) { D.gfx(it, 0x464); zeroVel(D, it, pk); it.vy = D.F(it, 4); D.enter(it, 1, ANIM); }
      }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
      { anim: (D, it, pk) => { if (!D.playing(it)) flap(D, it, pk); return false; } },
      { anim: (D, it, pk) => { if (!D.playing(it)) flap(D, it, pk); return aboveTop(D, it); }, phys: (D, it) => { it.vy = f32(it.vy + D.F(it, 0xc)); } },
    ],
    spawned: (D, it, pk) => { it.facing = 0; pk.var0 = 0; pk.air = true; D.enter(it, 0, ANIM); D.initSpawn(it, D.F(it, 0)); },
  };
}

// Zapdos (itthunder.c): root motion from the grandchild bone; the discharge state's var0 starts
// an ascent that accelerates by x8 per frame from x4.
{
  const discharge: Fn = (D, it, pk) => { D.enter(it, 2, ANIM); pk.v[2] = 0; pk.var1 = 0; };
  KINDS[PK.Thunder] = {
    rootBone: -2,
    rows: [
      { anim: matAnim, phys: (D, it, pk) => {
        if (D.materializePhys(it)) { zeroVel(D, it, pk); pk.v[0] = D.I(it, 0xc); pk.v[1] = 1; D.enter(it, 1, ANIM); }
      }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
      { anim: (D, it, pk) => { D.rootSample(it, D.grandchild(it)); if (!D.playing(it)) discharge(D, it, pk); return false; },
        phys: (D, it) => D.rootApply(it), coll: (D, it, _pk, prev) => { D.airColl(it, prev); return false; } },
      { anim: (D, it, pk) => { D.rootSample(it, D.grandchild(it)); if (!D.playing(it)) discharge(D, it, pk); return aboveTop(D, it); },
        phys: (D, it, pk) => {
          D.rootApply(it);
          if (pk.var0) { pk.v[2] = D.F(it, 4); pk.var0 = 0; pk.var1 = 1; }
          if (pk.var1) pk.v[2] = f32(pk.v[2]! + D.F(it, 8));
          it.vy = pk.v[2]!;
        } },
    ],
    spawned: (D, it, pk) => { it.facing = 0; pk.var0 = 0; pk.air = true; D.enter(it, 0, ANIM); D.initSpawn(it, D.F(it, 0)); },
  };
}

// Articuno (itfreezer.c): hovers through its blizzard state, then the ascent state's var0 lifts
// it at x4 plus x8 per frame.
{
  const ascend: Fn = (D, it, pk) => { D.enter(it, 2, ANIM); pk.var1 = 0; };
  KINDS[PK.Freezer] = {
    rows: [
      { anim: matAnim, phys: (D, it, pk) => {
        if (D.materializePhys(it)) { zeroVel(D, it, pk); D.enter(it, 1, ANIM); pk.acc = 1; }
      }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
      { anim: (D, it, pk) => { if (!D.playing(it)) ascend(D, it, pk); return false; }, coll: (D, it, _pk, prev) => { D.airColl(it, prev); return false; } },
      { anim: (D, it, pk) => { if (!D.playing(it)) ascend(D, it, pk); return aboveTop(D, it); },
        phys: (D, it, pk) => {
          if (pk.var0) { it.vy = D.F(it, 4); pk.var0 = 0; pk.var1 = 1; }
          if (pk.var1) it.vy = f32(it.vy + D.F(it, 8));
        } },
    ],
    // itFreezer_802CD090 consumes the blizzard state's var1 pulse (its 0x462 burst).
    acc: { 1: (D, it, pk) => { if (pk.var1) { D.gfx(it, 0x462); pk.var1 = 0; } } },
    spawned: (D, it, pk) => { it.facing = 0; pk.var0 = 0; pk.var1 = 0; pk.air = true; D.enter(it, 0, ANIM); D.initSpawn(it, D.F(it, 0)); },
  };
}

// Wobbuffet (itsonans.c): a driven pendulum on bone 4. Hits set the swing (x8 × damage × side)
// and arm the counter hitbox at min(damage × x4, xC), decaying by x20; it lives x24 frames.
{
  const wobble: Fn = (D, it, pk) => {
    gravityPhys(D, it, pk);
    if (pk.var0) {
      const angle = pk.v[1]!, vel = pk.v[0]!;
      if (angle > 0 && vel > 0) pk.v[0] = f32(vel + D.F(it, 0x14));
      else if (angle <= 0 && vel <= 0) pk.v[0] = f32(vel - D.F(it, 0x14));
      else if (angle > 0 && vel <= 0) pk.v[0] = f32(vel - D.F(it, 0x10));
      else pk.v[0] = f32(vel + D.F(it, 0x10));
      if (Math.abs(pk.v[1]!) < D.F(it, 0x1c) && Math.abs(pk.v[0]!) < D.F(it, 0x1c)) { pk.v[1] = 0; pk.v[0] = 0; pk.var0 = 0; }
      else pk.v[1] = f32(pk.v[1]! + pk.v[0]!);
      const max = D.F(it, 0x18);
      if (pk.v[1]! > max) { pk.v[0] = f32(pk.v[0]! * -0.9); pk.v[1] = max; }
      else if (pk.v[1]! < -max) { pk.v[0] = f32(pk.v[0]! * -0.9); pk.v[1] = -max; }
      pk.tilt = f32(DEG * pk.v[1]!);
    }
    // it_80272460 writes (u32)x68 into hitbox 0 every frame; the counter reads pk.v[2].
    pk.v[3] = pk.v[2]!;
    pk.v[2] = f32(pk.v[2]! - D.F(it, 0x20));
  };
  KINDS[PK.Sonans] = {
    rows: [
      { anim: (D, it, pk) => { if (!D.playing(it)) { D.enter(it, 1, ANIM); D.sound(it, 0x272b); } pk.life -= 1; return false; }, phys: wobble, coll: airGroundColl },
      { anim: (_D, _it, pk) => { pk.life -= 1; return pk.life === 0; }, phys: wobble, coll: airGroundColl },
      { anim: matAnim, phys: (D, it, pk) => {
        if (D.materializePhys(it)) { zeroVel(D, it, pk); pk.hurt = true; D.enter(it, 0, ANIM); }
      }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
    ],
    damaged: (D, it, pk) => {
      const impulse = f32(D.F(it, 8) * (pk.last * pk.dir));
      if (!pk.var0) { pk.v[0] = impulse; pk.var0 = 1; }
      else if (Math.abs(pk.v[0]!) < Math.abs(impulse)) pk.v[0] = impulse;
      pk.v[2] = Math.min(f32(pk.last * D.F(it, 4)), D.F(it, 0xc));
      // Each blow arms a fresh counter, so it can answer the same attacker again.
      it.victims.clear();
    },
    dealt: (_D, _it, pk) => { pk.v[0] = f32(pk.v[0]! * -1); return false; },
    spawned: (D, it, pk) => {
      it.facing = 0; pk.var0 = 0; pk.life = D.I(it, 0x24); pk.v[0] = 0; pk.v[1] = 0; pk.v[2] = 0;
      D.initSpawn(it, D.F(it, 0)); pk.air = true; D.enter(it, 2, ANIM);
    },
  };
}

// Scizor (ithassam.c): dashes x18 frames at x4, re-aims at the nearest fighter above (spinning
// 180° over x20 frames when it turns), dashes x1C more ignoring terrain, then leaves toward the camera.
{
  const dash: Fn = (D, it, pk) => {
    D.enter(it, 1, ANIM); D.rootSample(it, 2);
    pk.life = D.I(it, 0x18); it.vx = f32(D.F(it, 4) * it.facing);
    pk.v[0] = f32(D.F(it, 4) * it.facing); pk.v[1] = 0; pk.v[2] = 0;
  };
  const aim: Fn = (D, it, pk) => {
    const target = D.nearestAbove(it) ?? D.nearestOpponent(it) ?? D.ownerFighter(it);
    const point = target ? D.center(target) : [it.x, it.y, 0] as V3;
    const dy = f32(point[1] + D.F(it, 8) - it.y), dx = f32(point[0] - it.x), angle = Math.atan2(dy, dx), speed = D.F(it, 4);
    pk.v[0] = f32(speed * Math.cos(angle)); pk.v[1] = f32(speed * Math.sin(angle) + D.F(it, 0xc)); pk.v[2] = 0;
    it.vx = pk.v[0]!; it.vy = pk.v[1]!; pk.vz = 0;
    D.faceVelocity(it);
  };
  const leave: Fn = (D, it, pk) => {
    D.enter(it, 2, ANIM); D.rootSample(it, 2);
    const eye = D.cameraEye(), dx = eye[0] - it.x, dy = eye[1] - it.y, dz = eye[2] - pk.z, length = Math.hypot(dx, dy, dz) || 1, speed = D.F(it, 4);
    pk.v[0] = f32(dx / length * speed); pk.v[1] = f32(dy / length * speed); pk.v[2] = f32(dz / length * speed);
    it.vx = 0; it.vy = 0; pk.vz = 0; it.facing = 0; pk.rotY = 0;
  };
  KINDS[PK.Hassam] = {
    rootBone: 2,
    rows: [
      { anim: (D, it, pk) => { D.rootSample(it, 2); if (!D.playing(it)) dash(D, it, pk); return false; },
        phys: (D, it, pk) => { D.rootApply(it); gravityPhys(D, it, pk); }, coll: airGroundColl },
      { anim: (D, it, pk) => {
        if (!D.playing(it)) D.enter(it, 1, ANIM);
        D.rootSample(it, 2);
        if (pk.var1) {
          pk.rotY = f32((pk.rotY ?? 0) + DEG * Math.trunc(180 / D.I(it, 0x20)));
          if (++pk.var1 > D.I(it, 0x20)) { pk.var1 = 0; pk.rotY = null; }
        }
        if (--pk.life < 0) {
          if (pk.var0) leave(D, it, pk);
          else {
            const previous = it.facing;
            aim(D, it, pk);
            if (previous !== it.facing) { pk.var1 = 1; pk.rotY = f32(HALF_PI * previous); }
            pk.var0 = 1; pk.life = D.I(it, 0x1c); pk.air = true;
          }
        }
        return false;
      }, phys: (D, it, pk) => {
        D.rootApply(it);
        if (pk.air) { pk.v[1] = f32(pk.v[1]! - D.F(it, 0x14)); if (pk.v[1]! < -D.F(it, 0x10)) pk.v[1] = -D.F(it, 0x10); }
        it.vx = f32(it.vx + pk.v[0]!); it.vy = f32(it.vy + pk.v[1]!); pk.vz = f32(pk.vz + pk.v[2]!);
      }, coll: (D, it, pk, prev) => (pk.var0 ? false : airGroundColl(D, it, pk, prev)) },
      { anim: (D, it) => { D.rootSample(it, 2); return !D.playing(it); },
        phys: (D, it, pk) => { D.rootApply(it); it.x = f32(it.x + pk.v[0]!); it.y = f32(it.y + pk.v[1]!); pk.z = f32(pk.z + pk.v[2]!); } },
      matRow((D, it, pk) => { zeroVel(D, it, pk); D.enter(it, 0, ANIM); pk.rootPrev = [0, 0, 0]; pk.rootDelta = [0, 0, 0]; D.rootSample(it, 2); }),
    ],
    spawned: (D, it, pk) => { D.faceNearest(it); pk.var0 = 0; pk.var1 = 0; D.initSpawn(it, D.F(it, 0)); pk.air = true; D.enter(it, 3, ANIM); D.sound(it, 0x2721); },
  };
}

// Unown (itunknown.c): drifts off-screen (x4 accel, xC/x10 fall), turns into a hidden emitter on a
// random blast edge and sends x18 mini-Unown at the camera every x20 + rand(x1C) frames.
{
  const emitter: Fn = (D, it, pk) => {
    pk.hidden = true; zeroVel(D, it, pk);
    const b = D.blast, edge = D.randi(4);
    const spanY = (): number => D.randi(Math.trunc(b.top - b.bottom)) + b.bottom, spanX = (): number => D.randi(Math.trunc(b.right - b.left)) + b.left;
    pk.v[9] = edge;
    if (edge === 0) { pk.v[3] = b.right; pk.v[4] = spanY(); }
    else if (edge === 1) { pk.v[3] = b.left; pk.v[4] = spanY(); }
    else if (edge === 2) { pk.v[3] = spanX(); pk.v[4] = b.top; }
    else { pk.v[3] = spanX(); pk.v[4] = b.bottom; }
    pk.v[5] = 0;
    const interest = D.cameraInterest(), angle = Math.atan2(interest[1] - pk.v[4]!, interest[0] - pk.v[3]!), speed = D.F(it, 0x14);
    pk.v[6] = f32(speed * Math.cos(angle)); pk.v[7] = f32(speed * Math.sin(angle)); pk.v[8] = 0;
    D.faceVelocity(it);
    D.enter(it, 1, ANIM);
    D.sound(it, D.randi(2) !== 0 ? 0x271a : 0x271b);
  };
  const emit: Fn = (D, it, pk) => {
    const range = D.cameraHeight() / 3, jitter = D.randi(Math.trunc(range)) - range / 2;
    const vertical = pk.v[9]! <= 1;
    D.child(it, PK.UnownSwarm, f32(pk.v[3]! + (vertical ? 0 : jitter)), f32(pk.v[4]! + (vertical ? jitter : 0)), pk.v[5]!, pk.v[6]!, pk.v[7]!, pk.v[8]!, it.facing);
  };
  KINDS[PK.Unknown] = {
    rows: [
      { anim: (D, it, pk) => {
        const b = D.blast;
        if (it.x > b.right || it.x < b.left || it.y > b.top || it.y < b.bottom) emitter(D, it, pk);
        return false;
      }, phys: (D, it, pk) => { D.gravity(it, D.F(it, 0xc), D.F(it, 0x10)); it.vx = f32(it.vx + D.F(it, 4) * pk.v[0]!); } },
      { anim: (D, it, pk) => {
        if (--pk.v[1]! < 0) {
          emit(D, it, pk);
          if (--pk.v[2]! === 0) return true;
          pk.v[1] = D.I(it, 0x20) + D.randi(D.I(it, 0x1c));
        }
        return false;
      } },
      { anim: matAnim, phys: (D, it, pk) => {
        if (D.materializePhys(it)) { zeroVel(D, it, pk); it.vy = D.F(it, 8); D.enter(it, 0, ANIM); }
      }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
    ],
    spawned: (D, it, pk) => {
      pk.letter = D.randi(26); pk.v[0] = D.randi(2) !== 0 ? 1 : -1; pk.v[1] = 0; pk.v[2] = D.I(it, 0x18);
      pk.blast = false; it.facing = 0; D.initSpawn(it, D.F(it, 0)); pk.air = true; D.enter(it, 2, ANIM);
    },
  };
  KINDS[PK.UnownSwarm] = {
    rows: [{ anim: preTickLife, phys: (D, it, pk) => {
      pk.spin = [f32(pk.spin[0] + pk.v[1]! * DEG), f32(pk.spin[1] + pk.v[2]! * DEG), f32(pk.spin[2] + pk.v[3]! * DEG)];
      if (pk.v[0]) it.vx = f32(it.vx * D.F(it, 0x20)); else it.vy = f32(it.vy * D.F(it, 0x20));
    } }],
    spawned: (D, it, pk) => {
      pk.letter = D.randi(26); pk.blast = false; pk.life = D.I(it, 0);
      if (Math.abs(it.vx) > Math.abs(it.vy)) { it.vy = f32(it.vy * D.F(it, 0x1c)); pk.v[0] = 0; }
      else { it.vx = f32(it.vx * D.F(it, 0x1c)); pk.v[0] = 1; }
      pk.v[1] = D.randi(Math.trunc(D.F(it, 4) + D.F(it, 8))) - D.F(it, 8);
      pk.v[2] = D.randi(Math.trunc(D.F(it, 0xc) + D.F(it, 0x10))) - D.F(it, 0x10);
      pk.v[3] = D.randi(Math.trunc(D.F(it, 0x14) + D.F(it, 0x18))) - D.F(it, 0x18);
      D.enter(it, 0, ANIM);
    },
  };
}

// Entei / Raikou / Suicune (itentei.c, itraikou.c, itsuikun.c): land with a heavy quake, then the
// roar state's script (var0 starts, var1 stops) carries the whole attack; gone at its end.
for (const [slot, effect, cry] of [[PK.Entei, 0x468, 0x2741], [PK.Raikou, 0x46d, 0x2745], [PK.Suikun, 0x469, 0x2749]] as const) {
  KINDS[slot] = {
    rows: [
      { anim: (D, it, pk) => {
        if (pk.var1) { pk.var1 = 0; pk.var2 = 0; }
        if (!D.playing(it)) return true;
        if (pk.var2 && --pk.v[0]! === 0) { D.sound(it, cry + 1 + D.randi(3)); pk.v[0] = D.I(it, 4); }
        return false;
      }, phys: gravityPhys, coll: airGroundColl },
      matRow((D, it, pk) => { D.quake(it, 'large'); D.sound(it, 9); zeroVel(D, it, pk); D.enter(it, 0, ANIM); pk.acc = 1; pk.v[0] = D.I(it, 4); }),
    ],
    acc: { 1: (D, it, pk) => { if (pk.var0) { pk.var0 = 0; pk.var2 = 1; D.gfx(it, effect); D.sound(it, cry); } } },
    spawned: (D, it, pk) => { D.faceNearest(it); pk.var0 = 0; pk.var1 = 0; pk.var2 = 0; D.initSpawn(it, D.F(it, 0)); pk.air = true; D.enter(it, 1, ANIM); },
  };
}

// Bellossom (itkireihana.c): dances on bone-1 root motion (hopping into its airborne rows when the
// bob turns upward off the floor) for x4 loops, then a final dance; pollen every x8 frames.
{
  const pollen = (D: PokemonDriver, it: MatchItem, pk: PokemonState, cry: boolean): void => {
    if (--pk.v[1]! !== 0) return;
    D.gfx(it, 0x470);
    if (cry && --pk.v[2]! === 0) { D.sound(it, D.randi(2) ? 0x2726 : 0x2727); pk.v[2] = D.I(it, 0xc); }
    pk.v[1] = D.I(it, 8);
  };
  const fallPhys: Fn = (D, it, pk) => {
    D.rootApply(it);
    pk.v[3] = f32(pk.v[3]! + D.attr(it).gravity);
    if (pk.v[3]! > D.attr(it).terminal) pk.v[3] = D.attr(it).terminal;
    it.vy = -pk.v[3]!;
  };
  const hop = (next: number): Coll => (D, it, pk, prev) => {
    if (!D.floorSweep(it, prev) && pk.v[4]! < 0 && pk.rootDelta[1] > 0) { D.enter(it, next, KEEP); if (next === 2) D.rootSample(it, 1); }
    return false;
  };
  const land = (next: number): Coll => (D, it, pk, prev) => {
    D.airColl(it, prev, () => { D.enter(it, next, KEEP); D.rootSample(it, 1); pk.v[3] = 0; });
    return false;
  };
  KINDS[PK.Kireihana] = {
    rootBone: 1,
    rows: [
      matRow((D, it, pk) => { zeroVel(D, it, pk); D.enter(it, 1, ANIM); pk.v[3] = 0; }),
      { anim: (D, it, pk) => {
        pk.v[4] = pk.rootDelta[1]; D.rootSample(it, 1);
        if (!D.playing(it)) {
          if (--pk.v[0]! <= 0) { D.enter(it, 3, ANIM); pk.v[3] = 0; }
          else { zeroVel(D, it, pk); D.enter(it, 1, ANIM); pk.v[3] = 0; }
        }
        return false;
      }, phys: (D, it, pk) => { pollen(D, it, pk, true); D.rootApply(it); }, coll: hop(2) },
      { anim: (D, it, pk) => {
        D.rootSample(it, 1);
        if (!D.playing(it)) { if (pk.v[0]!-- <= 0) D.enter(it, 4, ANIM); else D.enter(it, 1, ANIM); }
        return false;
      }, phys: (D, it, pk) => { pollen(D, it, pk, false); fallPhys(D, it, pk); }, coll: land(1) },
      { anim: (D, it, pk) => { pk.v[4] = pk.rootDelta[1]; D.rootSample(it, 1); return !D.playing(it); }, phys: (D, it) => D.rootApply(it), coll: hop(4) },
      { anim: (D, it) => { D.rootSample(it, 1); return !D.playing(it); }, phys: fallPhys, coll: land(3) },
    ],
    spawned: (D, it, pk) => {
      it.facing = 0; pk.var0 = 0; pk.v[0] = D.I(it, 4); pk.air = true; D.enter(it, 0, ANIM);
      D.initSpawn(it, D.F(it, 0)); D.sound(it, 0x2725); pk.v[1] = D.I(it, 8); pk.v[2] = D.I(it, 0xc); pk.v[3] = 0; pk.v[4] = 0;
    },
  };
}

// Electrode (itmarumine.c): hovers, drops once its emerge anim passes frame x4, then the fuse state
// runs its whole animation; 0xB4 - x8 frames in it arms (sparks, beep, grabbable). Anim end,
// a thrown landing or the hand timer all end in the state-6 blast (owner-safe, see hits()).
{
  KINDS[PK.Marumine] = {
    rows: [
      { anim: matAnim, phys: (D, it) => { if (D.materializePhys(it)) D.enter(it, 1, KEEP); }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
      { anim: (D, it, pk) => { if (!D.playing(it)) { pk.grab = false; D.enter(it, 5, ANIM); pk.acc = 1; } return false; },
        coll: (D, it, pk, prev) => { if (!D.floorSweep(it, prev) && pk.frame >= D.I(it, 4)) { pk.speed = 0; D.enter(it, 2, KEEP); } return false; } },
      { phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal),
        coll: (D, it, pk, prev) => { D.airColl(it, prev, () => { pk.speed = 1; D.enter(it, 1, KEEP); }); return false; } },
      { anim: (D, it) => { if (!D.playing(it)) D.explode(it); return false; } },
      { anim: (D, it) => { if (!D.playing(it)) D.explode(it); return false; }, phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal),
        coll: (D, it, _pk, prev) => { if (D.anyContact(it, prev)) D.explode(it); return false; } },
      { anim: (D, it) => { if (!D.playing(it)) D.explode(it); return false; }, phys: gravityPhys, coll: airGroundColl },
      { anim: (_D, _it, pk) => { pk.life -= 1; return pk.life <= 0; } },
    ],
    acc: {
      1: (D, it, pk) => {
        if (--pk.v[0]! < 0) {
          if (--pk.v[1]! === 0) { D.gfx(it, 0x471); pk.v[1] = D.I(it, 0xc); }
          pk.grab = true;
          if (pk.var0) { pk.var0 = 0; D.sound(it, 0x271f); }
        }
      },
      2: (D, it, pk) => { if (--pk.v[1]! === 0) { D.gfx(it, 0x471); pk.v[1] = D.I(it, 0xc); } },
    },
    dealt: (D, it, pk) => { if (pk.st === 4) D.explode(it); return false; },
    spawned: (D, it, pk) => {
      it.facing = 0; pk.v[0] = 0xb4 - D.I(it, 8); D.initSpawn(it, D.F(it, 0)); zeroVel(D, it, pk);
      pk.air = true; D.enter(it, 0, ANIM); pk.v[1] = D.I(it, 0xc); pk.var0 = 1;
    },
  };
}

// Lugia (itlugia.c): climbs out the top, glides x14+1 frames into the background at x10 depth
// speed, settles back to its spawn height (x18 solved descent), then fires three Aeroblast
// streams from mouth bone 25 at a random-walking target while var0 is up.
{
  const beam = (D: PokemonDriver, it: MatchItem, pk: PokemonState, slot: number, speed: number): void => {
    // it_802D208C: the shared target steps x3C in a random heading around xA4, staying within
    // x40 of the spawn point (the heading flips 180° when a step would leave that circle).
    for (let attempt = 0; attempt < 16; attempt++) {
      const offset = D.randi(Math.trunc((D.F(it, 0x34) - D.F(it, 0x38)) / 2));
      const heading = D.randi(2) !== 0 ? offset + (pk.v[14]! - D.F(it, 0x34) / 2) : offset + (pk.v[14]! + D.F(it, 0x38) / 2);
      const tx = f32(pk.v[11]! + D.F(it, 0x3c) * Math.cos(heading * DEG)), ty = f32(pk.v[12]! + D.F(it, 0x3c) * Math.sin(heading * DEG));
      if (Math.hypot(pk.v[1]! - tx, pk.v[2]! - ty, pk.v[3]! - pk.v[13]!) > D.F(it, 0x40)) { pk.v[14] = pk.v[14]! + 180; continue; }
      pk.v[11] = tx; pk.v[12] = ty; break;
    }
    const dx = pk.v[11]! - pk.v[4]!, dy = pk.v[12]! - pk.v[5]!, dz = pk.v[13]! - pk.v[6]!, scale = Math.hypot(dx, dy, dz) / speed || 1;
    D.child(it, slot, pk.v[4]!, pk.v[5]!, pk.v[6]!, f32(dx / scale), f32(dy / scale), f32(dz / scale), 0);
  };
  const flight = (D: PokemonDriver, it: MatchItem, pk: PokemonState): void => {
    D.enter(it, 4, ANIM);
    const drop = it.y - pk.v[2]!, rate = D.F(it, 0x18);
    pk.v[7] = f32(-((-rate + Math.sqrt(8 * rate * drop + rate * rate)) / 2));
  };
  KINDS[PK.Lugia] = {
    rootBone: 1,
    rows: [
      { anim: matAnim, phys: (D, it, pk) => { if (D.materializePhys(it)) { zeroVel(D, it, pk); D.enter(it, 1, ANIM); } }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
      { anim: (D, it, pk) => { D.rootSample(it, 1); if (!D.playing(it)) { pk.v[7] = -D.F(it, 4); D.enter(it, 2, ANIM); } return false; }, phys: (D, it) => D.rootApply(it) },
      { anim: (D, it) => { D.rootSample(it, 1); return false; }, phys: (D, it, pk) => {
        D.rootApply(it);
        pk.v[7] = f32(pk.v[7]! + (D.playing(it) ? D.F(it, 8) : D.F(it, 0xc)));
        it.vy = f32(it.vy + pk.v[7]!);
        if (aboveTop(D, it)) { it.vy = 0; D.enter(it, 3, ANIM); }
      } },
      { anim: (D, it) => { D.rootSample(it, 1); if (!D.playing(it)) D.enter(it, 3, ANIM); return false; }, phys: (D, it, pk) => {
        D.rootApply(it);
        if (pk.v[0]!-- !== 0) pk.vz = D.F(it, 0x10); else { pk.vz = 0; flight(D, it, pk); }
      } },
      { anim: (D, it) => { D.rootSample(it, 1); if (!D.playing(it)) D.enter(it, 4, ANIM); return false; }, phys: (D, it, pk) => {
        D.rootApply(it);
        pk.v[7] = f32(pk.v[7]! + D.F(it, 0x18));
        it.vy = pk.v[7]!;
        if (it.vy > 0) {
          it.vy = 0;
          D.enter(it, 5, ANIM);
          pk.v[8] = 1; pk.v[9] = 0.7; pk.v[10] = 0.4;
          const mouth = D.bonePoint(it, 25, [0, 0, 0]);
          pk.v[11] = pk.v[1]!; pk.v[12] = f32(pk.v[2]! + D.F(it, 0x40)); pk.v[13] = pk.v[3]!;
          pk.v[4] = mouth[0]; pk.v[5] = mouth[1]; pk.v[6] = mouth[2]; pk.v[14] = 0;
          pk.acc = 1; pk.blast = true;
        }
      } },
      { anim: (D, it) => { D.rootSample(it, 1); return !D.playing(it); }, phys: (D, it) => D.rootApply(it) },
    ],
    acc: { 1: (D, it, pk) => {
      if (!pk.var0) return;
      pk.v[8] = f32(pk.v[8]! + D.F(it, 0x20)); pk.v[9] = f32(pk.v[9]! + D.F(it, 0x28)); pk.v[10] = f32(pk.v[10]! + D.F(it, 0x30));
      if (pk.v[8]! >= 1) { pk.v[8] = f32(pk.v[8]! - 1); beam(D, it, pk, PK.Aero1, D.F(it, 0x1c)); D.sound(it, 0x274d + D.randi(3)); }
      if (pk.v[9]! >= 1) { pk.v[9] = f32(pk.v[9]! - 1); beam(D, it, pk, PK.Aero1 + 1, D.F(it, 0x24)); }
      if (pk.v[10]! >= 1) { pk.v[10] = f32(pk.v[10]! - 1); beam(D, it, pk, PK.Aero1 + 2, D.F(it, 0x2c)); }
    } },
    spawned: (D, it, pk) => {
      pk.v[1] = it.x; pk.v[2] = it.y; pk.v[3] = pk.z; it.facing = 0; pk.var0 = 0; pk.v[0] = D.I(it, 0x14);
      pk.blast = false; pk.air = true; D.enter(it, 0, ANIM); D.initSpawn(it, D.F(it, 0)); pk.v[7] = 0;
    },
  };
  const aero: Kind = {
    rows: [{ anim: tickLife, phys: (D, it, pk) => { pk.vz = f32(pk.vz * D.F(it, 4 + (D.slot(it) - PK.Aero1) * 4)); }, coll: (D, it, _pk, prev) => D.floorSweep(it, prev) }],
    spawned: (D, it, pk) => { pk.life = D.F(it, 0); D.enter(it, 0, ANIM); },
  };
  for (let slot = PK.Aero1; slot < PK.Aero1 + 3; slot++) KINDS[slot] = aero;
}

// Ho-oh (ithouou.c): same climb/background glide as Lugia, then its hover state's var1 pulses drop
// a Sacred Fire column on the surface straight below its spawn point.
{
  const column = (D: PokemonDriver, it: MatchItem, pk: PokemonState): void => {
    const x = pk.v[1]!, y = pk.v[2]!, stage = D.host.content.stage;
    const hit = traceStage(stage, [x, y, 0], [x, D.blast.bottom, 0]) ?? traceStage(stage, [x, D.blast.top, 0], [x, y, 0]);
    if (hit) D.child(it, PK.SacredFire, hit.point[0], hit.point[1], 0, 0, 0, 0, 0);
  };
  KINDS[PK.Houou] = {
    rootBone: 1,
    rows: [
      { anim: matAnim, phys: (D, it, pk) => { if (D.materializePhys(it)) { zeroVel(D, it, pk); D.enter(it, 1, ANIM); } }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
      { anim: (D, it, pk) => { D.rootSample(it, 1); if (!D.playing(it)) { pk.v[4] = 0; D.enter(it, 2, ANIM); } return false; }, phys: (D, it) => D.rootApply(it) },
      { anim: (D, it) => { D.rootSample(it, 1); return false; }, phys: (D, it, pk) => {
        D.rootApply(it);
        pk.v[4] = f32(pk.v[4]! + (D.playing(it) ? D.F(it, 8) : D.F(it, 0xc)));
        it.vy = f32(it.vy + pk.v[4]!);
        if (aboveTop(D, it)) { it.vy = 0; D.enter(it, 3, ANIM); }
      } },
      { anim: (D, it) => { D.rootSample(it, 1); if (!D.playing(it)) D.enter(it, 3, ANIM); return false; }, phys: (D, it, pk) => {
        D.rootApply(it);
        const timer = pk.v[0]!; pk.v[0] = timer - 1;
        if (timer !== 0) pk.vz = D.F(it, 0x10); else { pk.vz = 0; D.enter(it, 4, ANIM); pk.v[4] = D.F(it, 0x18); }
      } },
      { anim: (D, it, pk) => { D.rootSample(it, 1); if (!D.playing(it)) { D.enter(it, 5, ANIM); pk.acc = 1; pk.blast = true; } return false; }, phys: (D, it, pk) => {
        D.rootApply(it);
        pk.v[4] = f32(pk.v[4]! + D.F(it, 0x1c));
        it.vy = f32(it.vy + pk.v[4]!);
        if (it.y < pk.v[2]! - 10) it.vy = 0;
      } },
      { anim: (D, it) => { D.rootSample(it, 1); return !D.playing(it); }, phys: (D, it) => D.rootApply(it) },
    ],
    acc: { 1: (D, it, pk) => {
      if (pk.var0) { pk.var0 = 0; D.gfx(it, 0x46f); }
      if (pk.var1) { pk.var1 = 0; column(D, it, pk); }
    } },
    spawned: (D, it, pk) => {
      pk.v[1] = it.x; pk.v[2] = it.y; pk.v[3] = pk.z; it.facing = 0; pk.var0 = 0; pk.var1 = 0; pk.v[0] = D.I(it, 0x14);
      pk.blast = false; pk.air = true; D.enter(it, 0, ANIM); D.initSpawn(it, D.F(it, 0)); pk.v[4] = 0;
    },
  };
  KINDS[PK.SacredFire] = {
    rows: [{ anim: tickLife, coll: (D, it, _pk, prev) => D.floorSweep(it, prev) }],
    spawned: (D, it, pk) => { pk.life = D.F(it, 0); D.enter(it, 0, ANIM); },
  };
}

// Ditto (itmetamon.c): appears, plays one pose and leaves. Nothing else is coded.
KINDS[PK.Metamon] = {
  rows: [
    { anim: animEnds, coll: (D, it, _pk, prev) => { D.airColl(it, prev); return false; } },
    { anim: animEnds, coll: (D, it, _pk, prev) => { D.airColl(it, prev); return false; } },
    matRow((D, it, pk) => { zeroVel(D, it, pk); D.enter(it, 0, ANIM); }),
  ],
  spawned: (D, it, pk) => { D.initSpawn(it, D.F(it, 0)); pk.air = true; D.enter(it, 2, ANIM); D.sound(it, 0x2728); },
};

// Clefairy / Togepi (itpippi.c, ittogepy.c): idle x4 animation loops, then Metronome: one weighted
// draw over [0, x8) picks an outcome state whose own script is the whole move and whose var0 ends it.
for (const [slot, weights, cry] of [[PK.Pippi, [0xc, 0x10, 0x14], 0x272a], [PK.Togepy, [0xc, 0x10, 0x14, 0x18], 0x272c]] as const) {
  const move: Row = { anim: (D, it, pk) => { if (!D.playing(it)) D.reloadAnim(it); return pk.var0 !== 0; }, phys: gravityPhys, coll: airGroundColl };
  KINDS[slot] = {
    rows: [
      { anim: matAnim, phys: (D, it, pk) => { if (D.materializePhys(it)) { zeroVel(D, it, pk); D.enter(it, 1, ANIM); } }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
      { anim: (D, it, pk) => {
        if (!D.playing(it)) {
          if (--pk.v[0]! <= 0) {
            const roll = D.randi(D.I(it, 8));
            let state = 2 + weights.length, sum = 0;
            for (const [index, offset] of weights.entries()) { sum += D.I(it, offset); if (roll < sum) { state = 2 + index; break; } }
            D.enter(it, state, ANIM);
          } else D.reloadAnim(it);
        }
        return false;
      }, phys: gravityPhys, coll: airGroundColl },
      ...Array.from({ length: weights.length + 1 }, () => move),
    ],
    spawned: (D, it, pk) => {
      it.facing = 0; pk.var0 = 0; pk.var1 = 0; pk.var2 = 0; D.initSpawn(it, D.F(it, 0));
      pk.air = true; D.enter(it, 0, ANIM); pk.v[0] = D.I(it, 4); D.sound(it, cry);
    },
  };
}

// Mew / Celebi (itmew.c, itcerebi.c): greet, then fly off at ±x4 with x8 rising by xC per frame.
for (const [slot, effect, cry] of [[PK.Mew, 0x46b, 0x2729], [PK.Cerebi, 0x472, 0]] as const) {
  const greet: Fn = (D, it, pk) => { zeroVel(D, it, pk); D.gfx(it, effect); D.enter(it, 1, ANIM); if (cry) D.sound(it, cry); };
  KINDS[slot] = {
    rows: [
      { anim: matAnim, phys: (D, it, pk) => { if (D.materializePhys(it)) greet(D, it, pk); }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev, greet) },
      { anim: (D, it) => {
        if (!D.playing(it)) { D.enter(it, 2, ANIM); it.vx = D.randi(2) !== 0 ? D.F(it, 4) : -D.F(it, 4); it.vy = D.F(it, 8); }
        return false;
      } },
      { anim: aboveTop, phys: (D, it) => { it.vy = f32(it.vy + D.F(it, 0xc)); } },
    ],
    spawned: (D, it, pk) => { it.facing = 0; pk.air = true; D.enter(it, 0, ANIM); D.initSpawn(it, D.F(it, 0)); },
  };
}

// Staryu (ithitodeman.c): locks on to the lowest-percent opponent, homes to a random offset from
// them for x18..x14 frames (no terrain), then fires x44..x40 stars every x3C+1 frames with recoil.
{
  const approach = (value: number, target: number, max: number, accel: number, decel: number): number => {
    const diff = target - value;
    let next = target;
    if (Math.abs(diff) > Math.abs(accel)) next = diff > 0 ? value + accel : value - accel;
    else if (Math.abs(diff) < Math.abs(decel)) next = diff > 0 ? value + decel : value - decel;
    return f32(next > 0 ? Math.min(next, max) : Math.max(next, -max));
  };
  KINDS[PK.Hitodeman] = {
    rows: [
      { anim: (D, it, pk) => {
        if (pk.var0) return true;
        if (!D.playing(it)) D.enter(it, 0, ANIM);
        pk.v[8] = f32(pk.v[8]! - 1);
        if (pk.v[8]! < 0) {
          const target = D.fighter(pk.target);
          if (target) { it.facing = target.x < it.x ? -1 : 1; pk.rotY = null; } else D.faceNearest(it);
          D.enter(it, 1, ANIM); zeroVel(D, it, pk); D.sound(it, 0x2738);
        }
        return false;
      }, phys: (D, it, pk) => {
        const target = D.fighter(pk.target);
        if (!target) return;
        let dx = f32(target.x + pk.v[0]! - it.x), dy = f32(target.y + pk.v[1]! - it.y);
        const distance = Math.hypot(dx, dy, pk.z);
        if (distance > D.F(it, 0x38)) { const speed = distance * D.F(it, 0x34); dx = f32(dx / distance * speed); dy = f32(dy / distance * speed); }
        pk.v[2] = approach(pk.v[2]!, dx, D.F(it, 0x24), D.F(it, 0x20), D.F(it, 0x1c)); it.vx = pk.v[2]!;
        pk.v[3] = approach(pk.v[3]!, dy, D.F(it, 0x30), D.F(it, 0x2c), D.F(it, 0x28)); it.vy = pk.v[3]!;
      } },
      { anim: (D, it, pk) => {
        if (pk.var0) return true;
        pk.v[9] = f32(pk.v[9]! - 1);
        if (pk.v[9]! < 0) {
          if (--pk.v[10]! < 0) return true;
          pk.v[9] = D.I(it, 0x3c);
          if (D.fighter(pk.target)) {
            it.vx = f32(-it.facing * D.F(it, 0x48));
            if (D.child(it, PK.Star, f32(it.x + it.facing * D.F(it, 0x54)), f32(it.y + D.F(it, 0x58)), pk.z, f32(it.facing * D.F(it, 0x50)), 0, 0, it.facing)) {
              D.sound(it, it.facing === 1 ? 0x2739 : 0x273a);
            }
            pk.var1 = 1;
          }
        }
        if (!D.playing(it)) D.enter(it, 1, ANIM);
        return false;
      }, phys: (D, it, pk) => { if (pk.var1) it.vx = f32(it.vx + it.facing * D.F(it, 0x4c)); } },
      { anim: matAnim, phys: (D, it, pk) => { if (D.materializePhys(it)) { zeroVel(D, it, pk); D.enter(it, 0, ANIM); } }, coll: (D, it, _pk, prev) => D.materializeColl(it, prev) },
    ],
    spawned: (D, it, pk) => {
      it.facing = 0; pk.flag4 = 0; D.initSpawn(it, D.F(it, 0));
      // it_802D43EC: lowest-percent opponent (the thrower when alone), offset [x8,x4] × [x10,xC].
      pk.target = D.lowestPercentOpponent(it) ?? it.owner ?? -1;
      pk.v[0] = f32((D.F(it, 4) - D.F(it, 8)) * D.random() + D.F(it, 8));
      pk.v[1] = f32((D.F(it, 0xc) - D.F(it, 0x10)) * D.random() + D.F(it, 0x10));
      if (D.randi(2) !== 0) pk.v[0] = -pk.v[0]!;
      pk.v[8] = f32(D.F(it, 0x18) + D.randi(Math.trunc(D.F(it, 0x14) - D.F(it, 0x18))));
      pk.v[10] = D.I(it, 0x44) + D.randi(D.I(it, 0x40) - D.I(it, 0x44));
      pk.v[9] = D.I(it, 0x3c); pk.v[2] = 0; pk.v[3] = 0; pk.var0 = 0; pk.var1 = 0;
      pk.air = true; D.enter(it, 2, ANIM); D.sound(it, 0x2738);
    },
  };
  KINDS[PK.Star] = {
    shieldDestroys: true,
    rows: [{ anim: (_D, _it, pk) => { pk.life -= 1; return pk.life <= 0 || pk.var2 !== 0; } }],
    dealt: (_D, _it, pk) => { pk.var2 = 1; return false; },
    spawned: (D, it, pk) => { pk.life = D.F(it, 0); pk.half = f32(pk.life * D.data.common.reflectedLife); pk.var2 = 0; D.gfx(it, 0x46c); D.enter(it, 0, ANIM); },
  };
}

// Chansey (itlucky.c): lays one egg per script var0 pulse through intro/x10+rand(x14) loops/outro;
// eggs heal unless the 1-in-x18 roll (or disabled healing items) makes them item Eggs. xC damage
// knocks her out of the stage.
{
  const lay: Fn = (D, it, pk) => { D.enter(it, pk.v[0]!, ANIM); pk.var0 = 0; pk.acc = 1; };
  const airRow: Row = { phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal),
    coll: (D, it, pk, prev) => { D.airColl(it, prev, () => { zeroVel(D, it, pk); lay(D, it, pk); }); return false; } };
  const layRow: Row = { anim: (D, it, pk) => {
    if (D.playing(it)) return false;
    if (pk.v[0] === 2) pk.v[0] = 3;
    else if (pk.v[0] === 3) { pk.v[1]!--; pk.v[0] = pk.v[1] !== 0 ? 3 : 4; }
    else return true;
    lay(D, it, pk);
    return false;
  }, coll: (D, it, pk) => { D.groundColl(it, () => { D.enter(it, 5, KEEP); pk.var0 = 0; }); return false; } };
  KINDS[PK.Lucky] = {
    rows: [
      matRow((D, it, pk) => { D.enter(it, 1, ANIM); pk.hurt = true; }),
      airRow, layRow, layRow, layRow, airRow,
      { phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal) },
    ],
    acc: { 1: (D, it, pk) => {
      if (!pk.var0) return;
      const vx = f32(D.F(it, 4) * (2 * (D.random() - 0.5))), vy = D.F(it, 8), facing = vx >= 0 ? 1 : -1;
      const at = D.bonePoint(it, 32, [0, 0, 0]);
      const heal = pk.v[2] ? D.randi(D.I(it, 0x18)) : 0;
      D.egg(it, heal !== 0, at[0], at[1], vx, vy, facing);
      D.sound(it, 0x273c);
      pk.var0 = 0;
    } },
    damaged: (D, it, pk) => { if (pk.taken >= D.F(it, 0xc)) { D.knockOut(it); D.enter(it, 6, ANIM); D.bindDesc0(it); } },
    spawned: (D, it, pk) => {
      it.facing = 0; pk.v[0] = 2; pk.v[1] = D.I(it, 0x10) + D.randi(D.I(it, 0x14));
      D.initSpawn(it, D.F(it, 0)); pk.v[2] = D.healingEnabled() ? 1 : 0; D.sound(it, 0x273b);
      pk.var0 = 0; D.enter(it, 0, ANIM); D.bindDesc0(it);
    },
  };
}

// Porygon2 (itporygon2.c): no ball materialize and no attributes; a windup then a root-motion
// lunge along its release facing, gone when the lunge animation ends.
KINDS[PK.Porygon2] = {
  rootBone: 1,
  rows: [
    { anim: (D, it) => { if (!D.playing(it)) { D.enter(it, 1, ANIM); D.sound(it, 0x273f); } D.rootSample(it, 1); return false; },
      phys: (D, it) => D.rootApply(it), coll: (D, it, _pk, prev) => { D.floorSweep(it, prev); return false; } },
    { anim: (D, it) => { if (!D.playing(it)) return true; D.rootSample(it, 1); return false; }, phys: (D, it) => D.rootApply(it) },
  ],
  spawned: (D, it) => { D.initSpawn(it, D.attr(it).scale); D.sound(it, 0x273e); D.enter(it, 0, ANIM); },
};

// Cyndaquil (ithinoarashi.c): each script var0 frame spits a flame from back bone 2 at a random
// [x10, x14] heading and [x4, x8] speed; x4 damage knocks it out.
{
  KINDS[PK.Hinoarashi] = {
    rootBone: 1,
    rows: [
      matRow((D, it, pk) => { D.enter(it, 1, ANIM); pk.hurt = true; zeroVel(D, it, pk); pk.acc = 1; }),
      { anim: (D, it, pk) => {
        if (!D.playing(it)) return true;
        if (pk.v[0] && !pk.v[1]) { if (!pk.v[2]) { pk.v[2] = D.F(it, 8); D.sound(it, 0x2735 + D.randi(3)); } pk.v[2] = f32(pk.v[2]! - 1); }
        D.rootSample(it, 1);
        return false;
      }, phys: (D, it) => D.rootApply(it), coll: (D, it, _pk, prev) => { D.floorSweep(it, prev); return false; } },
      { phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal) },
    ],
    acc: { 1: (D, it, pk) => {
      if (pk.var0) {
        pk.v[0] = 1;
        const at = D.bonePoint(it, 2, [0, 0, 0]);
        D.child(it, PK.CyndaFlame, at[0], at[1], 0, 0, 0, 0, it.facing);
        pk.var0 = 0;
      }
      if (pk.var1) { pk.v[1] = 1; pk.var1 = 0; }
    } },
    damaged: (D, it, pk) => { if (pk.taken >= D.F(it, 4)) { D.knockOut(it); D.enter(it, 2, ANIM); D.bindDesc0(it); } },
    spawned: (D, it, pk) => {
      pk.var0 = 0; pk.var1 = 0; pk.v[0] = 0; pk.v[1] = 0; pk.v[2] = 0;
      D.initSpawn(it, D.attr(it).scale); D.sound(it, 0x2734); D.enter(it, 0, ANIM); D.bindDesc0(it);
    },
  };
  KINDS[PK.CyndaFlame] = {
    shieldDestroys: true, trail: { effect: 1002, every: 3 },
    rows: [{ anim: preTickLife, phys: (D, it) => { it.vy = f32(it.vy + D.F(it, 0xc)); },
      // it_802D6798: floor/wall/ceiling contact only pushes the flame back, so it crawls along terrain.
      coll: (D, it, _pk, prev) => { D.slide(it, prev); return false; } }],
    spawned: (D, it, pk) => {
      pk.life = D.F(it, 0); pk.half = f32(pk.life * D.data.common.reflectedLife);
      const spread = f32((D.F(it, 0x14) - D.F(it, 0x10)) * D.random() + D.F(it, 0x10));
      let angle = (it.facing === 1 ? spread : -spread) - HALF_PI;
      while (angle < 0) angle += 2 * Math.PI;
      while (angle > 2 * Math.PI) angle -= 2 * Math.PI;
      const speed = f32((D.F(it, 8) - D.F(it, 4)) * D.random() + D.F(it, 4));
      it.vx = f32(speed * Math.cos(angle)); it.vy = f32(speed * Math.sin(angle)); pk.vz = 0;
      pk.blast = false; D.enter(it, 0, ANIM);
    },
  };
}

// Marill (itmaril.c): walks at xC (anim speed x10) on bone-1 bob, turning 180° over x8 frames at
// walls; walks off ledges; lives x4 frames; x14 damage knocks it out.
{
  const walk: Fn = (D, it, pk) => {
    zeroVel(D, it, pk); pk.air = true;
    D.enter(it, 1, ANIM); pk.v[0] = f32(D.F(it, 0xc) * it.facing); pk.hurt = true; pk.var0 = 0;
  };
  const lifeAnim: Pred = (_D, _it, pk) => { pk.life -= 1; return pk.life <= 0; };
  KINDS[PK.Maril] = {
    rootBone: 1,
    rows: [
      matRow(walk),
      { anim: (D, it, pk) => {
        D.rootSample(it, 1);
        if (pk.v[3]) {
          pk.rotY = f32((pk.rotY ?? 0) + pk.v[1]!); pk.v[2] = f32(pk.v[2]! - 1);
          if (pk.v[2]! <= 0) { pk.v[3] = 0; pk.rotY = null; }
        }
        return lifeAnim(D, it, pk);
      }, phys: (D, it, pk) => { D.rootApply(it); it.vx = pk.v[0]!; },
      coll: (D, it, pk, prev) => {
        const bits = D.walkSweep(it, prev);
        if (!D.playing(it)) { if (bits & 1) walk(D, it, pk); else D.enter(it, 2, KEEP); }
        else if (bits & 0xc && !pk.v[3]) {
          pk.v[2] = D.F(it, 8); pk.v[1] = f32(Math.PI * -it.facing / D.F(it, 8)); pk.v[3] = 1;
          pk.rotY = f32(HALF_PI * it.facing); it.facing = -it.facing; pk.v[0] = -pk.v[0]!;
        }
        return false;
      } },
      { anim: lifeAnim, phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal), coll: (D, it, pk, prev) => { D.airColl(it, prev, () => walk(D, it, pk)); return false; } },
      { anim: lifeAnim, phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal) },
    ],
    damaged: (D, it, pk) => { if (pk.taken >= D.F(it, 0x14)) { D.knockOut(it); D.enter(it, 3, ANIM); D.bindDesc0(it); } },
    spawned: (D, it, pk) => {
      pk.v[3] = 0; pk.speed = D.F(it, 0x10); D.initSpawn(it, D.F(it, 0)); D.sound(it, 0x273d);
      pk.life = D.F(it, 4); pk.half = f32(pk.life * D.data.common.reflectedLife); D.enter(it, 0, ANIM); D.bindDesc0(it);
    },
  };
}

// Venusaur (itfushigibana.c): plants itself and loops its quake animation (the script's big
// hitbox) until its x4 lifetime runs out; rumble SFX every x8 frames.
{
  const planted: Fn = (D, it, pk) => { zeroVel(D, it, pk); D.enter(it, 1, ANIM); };
  KINDS[PK.Fushigibana] = {
    rows: [
      matRow(planted),
      { anim: (D, it, pk) => {
        if (!D.playing(it)) D.enter(it, 1, ANIM);
        if (!pk.v[1]) { pk.v[1] = D.F(it, 8); D.sound(it, 0x2730 + D.randi(4)); }
        pk.v[1] = f32(pk.v[1]! - 1);
        pk.life -= 1; return pk.life <= 0;
      }, coll: (D, it) => { D.groundColl(it, () => { D.enter(it, 2, ANIM); D.bindDesc0(it); }); return false; } },
      { phys: (D, it) => D.gravity(it, D.attr(it).gravity, D.attr(it).terminal), coll: (D, it, pk, prev) => { D.airColl(it, prev, () => planted(D, it, pk)); return false; } },
    ],
    spawned: (D, it, pk) => {
      D.initSpawn(it, D.F(it, 0)); D.sound(it, 0x272f); pk.life = D.F(it, 4); pk.half = f32(pk.life * D.data.common.reflectedLife);
      pk.v[1] = D.F(it, 8); D.enter(it, 0, ANIM); D.bindDesc0(it);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------
const scratchVector = new Vector3();

export class PokemonDriver {
  private ctx: PokemonContext | null = null;
  private fighterList: readonly MatchFighter[] = [];
  private eventList: MatchEvent[] = [];
  private readonly poseCache = new Map<number, { key: string; matrices: Matrix4[] }>();
  constructor(readonly host: PokemonHost) {}
  get data(): ItemsData { return this.host.data; }
  get blast(): { left: number; right: number; top: number; bottom: number } { return this.host.content.stage.blast; }
  slot(it: MatchItem): number { return it.kind - POKEMON_BASE; }
  attr(it: MatchItem) { return this.data.kind(it.kind).attributes; }
  F(it: MatchItem, offset: number): number { const special = this.data.kind(it.kind).special; return special ? this.data.archive.f32(special + offset) : 0; }
  I(it: MatchItem, offset: number): number { const special = this.data.kind(it.kind).special; return special ? this.data.archive.u32(special + offset) | 0 : 0; }
  random(): number { return this.host.random(); }
  randi(n: number): number { return n > 0 ? Math.min(n - 1, Math.trunc(this.host.random() * n)) : 0; }
  private get fighters(): readonly MatchFighter[] { return this.fighterList; }
  private get events(): MatchEvent[] { return this.eventList; }
  private bind(ctx: PokemonContext): void { this.ctx = ctx; this.fighterList = ctx.fighters; this.eventList = ctx.events; }

  // --- state/animation plumbing ---------------------------------------------------------------
  /** Item_80268E5C: switch state row; anim_id -1 drops animation and script, ANIM reloads both. */
  enter(it: MatchItem, st: number, flags: number): void {
    const pk = it.pk!;
    pk.st = st; pk.acc = 0;
    const animId = ANIM_IDS[this.slot(it)]?.[st] ?? 0;
    const desc = animId >= 0 ? this.data.kind(it.kind).states[animId] : undefined;
    if (animId < 0 || (!desc && flags & ANIM)) { pk.anim = -1; pk.script = -1; pk.frame = 0; }
    else if (flags & ANIM) {
      pk.anim = animId; pk.frame = 0; pk.freshAnim = true;
      pk.script = animId; pk.scriptFrame = 0; pk.freshScript = true; pk.cursor = 0;
      it.victims.clear(); it.activation = -1;
    }
    it.stateIndex = Math.max(0, pk.anim);
  }
  /** it_80273670(gobj, 0, 0): bind desc 0's animation at frame 0 without a script. */
  bindDesc0(it: MatchItem): void {
    const pk = it.pk!;
    if (!this.data.kind(it.kind).states[0]) return;
    pk.anim = 0; pk.frame = 0; pk.freshAnim = true; it.stateIndex = 0;
  }
  /** Item_80268D34: restart the current state's animation; the script keeps running. */
  reloadAnim(it: MatchItem): void {
    const pk = it.pk!, animId = ANIM_IDS[this.slot(it)]?.[pk.st] ?? -1;
    if (animId < 0) return;
    pk.anim = animId; pk.frame = 0; pk.freshAnim = true;
  }
  /** it_80272C6C: true while the joint animation is still playing. */
  playing(it: MatchItem): boolean {
    const pk = it.pk!;
    if (pk.anim < 0) return false;
    const clip = this.data.clip(it.kind, pk.anim);
    return !!clip && pk.frame < clip.endFrame;
  }
  /** Item_802694CC: advance the animation and run the item script up to the new frame. */
  private advance(it: MatchItem): void {
    const pk = it.pk!;
    pk.flag4 = 0;
    if (pk.anim >= 0) { if (pk.freshAnim) pk.freshAnim = false; else pk.frame = f32(pk.frame + pk.speed); }
    if (pk.script < 0) return;
    if (pk.freshScript) pk.freshScript = false; else pk.scriptFrame = f32(pk.scriptFrame + pk.speed);
    const events = this.data.kind(it.kind).states[pk.script]?.script?.events ?? [];
    while (pk.cursor < events.length && events[pk.cursor]!.frame <= pk.scriptFrame) {
      const event = events[pk.cursor++]!;
      if (event.type !== 'command') continue;
      if (event.index === 0) pk.var0 = event.value;
      else if (event.index === 1) pk.var1 = event.value;
      else if (event.index === 2) pk.var2 = event.value;
      else if (event.index === 4) pk.flag4 = 1;
    }
  }

  // --- materialize (it_279C.c) ----------------------------------------------------------------
  /** it_80279CDC: start scale, zeroed root-motion accumulators, intangible, not grabbable. */
  initSpawn(it: MatchItem, scale: number): void {
    const pk = it.pk!;
    pk.rootPrev = [0, 0, 0]; pk.rootDelta = [0, 0, 0]; pk.scale = scale; pk.hurt = false; pk.grab = false;
  }
  /** it_8027AAA0: the ball's itPokemonSpawn attributes seed the grow/fall block. */
  inject(it: MatchItem, ball: MatchItem): void {
    const pk = it.pk!, special = this.data.kind(ball.kind).special, arc = this.data.archive, target = this.attr(it).scale;
    if (!special) return;
    const electrode = this.slot(it) === PK.Marumine, frames = arc.f32(special + 0x18) || 1, count = Math.max(0, Math.min(6, arc.u32(special + 0x38) | 0));
    pk.m = {
      gravity: electrode ? 0 : arc.f32(special + 0xc), terminal: electrode ? 0 : arc.f32(special + 0x10),
      fall: arc.f32(special + 0x14), step: f32((target - pk.scale) / frames),
      keys: Array.from({ length: count }, (_, i) => f32(arc.f32(special + 0x1c + i * 4) * target)),
      rate: arc.f32(special + 0x34), countdown: 0, count, index: 0, phase: 0, delta: pk.scale,
    };
  }
  materializeAnim(it: MatchItem): void {
    const pk = it.pk!, m = pk.m, target = this.attr(it).scale;
    if (!m) return;
    if (m.phase === 0) {
      if (target > m.step + pk.scale) pk.scale = f32(pk.scale + m.step);
      else { pk.scale = target; m.phase = 1; }
      return;
    }
    if (m.phase === 2) return;
    // it_80279E24: step through the squash/stretch keys at x34 frames per key.
    if (m.countdown <= 0) {
      m.countdown = m.rate;
      const key = m.keys[m.index] ?? target;
      if ((m.index & 1) ? key <= pk.scale : key >= pk.scale) {
        pk.scale = key; m.index++;
        m.delta = f32(((m.keys[m.index] ?? m.rate) - pk.scale) / (m.rate || 1));
      }
      if (m.count <= m.index) { m.phase = 2; return; }
    }
    m.countdown -= 1;
    pk.scale = f32(pk.scale + m.delta);
  }
  materializePhys(it: MatchItem): boolean {
    const pk = it.pk!, m = pk.m;
    if (!m) return true;
    this.gravity(it, m.gravity, m.terminal);
    if (m.fall <= 0) { pk.scale = this.attr(it).scale; return true; }
    m.fall -= 1;
    return false;
  }
  materializeColl(it: MatchItem, prev: V3, land?: Fn): boolean {
    const pk = it.pk!;
    if (this.airTrace(it, prev) & 1) { pk.air = false; land?.(this, it, pk); pk.scale = this.attr(it).scale; }
    return false;
  }

  // --- physics helpers --------------------------------------------------------------------------
  gravity(it: MatchItem, g: number, term: number): void { it.vy = gravityStep(it.vy, g, term); }
  /** it_8027A160: the bone's per-frame translation delta (× item scale), bone left at the origin. */
  rootSample(it: MatchItem, bone: number): void {
    const pk = it.pk!, value = this.rootTranslation(it, bone), scale = this.attr(it).scale;
    const scaled: V3 = [0, 1, 2].map((axis) => { const v = f32(value[axis]! * scale); return Math.abs(v) < 0.001 ? 0 : v; }) as V3;
    pk.rootDelta = [f32(scaled[0] - pk.rootPrev[0]), f32(scaled[1] - pk.rootPrev[1]), f32(scaled[2] - pk.rootPrev[2])];
    pk.rootPrev = scaled;
  }
  /** it_8027A344: the bone's depth (z) motion drives world x along the facing. */
  rootApply(it: MatchItem): void { const pk = it.pk!; it.vx = f32(pk.rootDelta[2] * it.facing); it.vy = pk.rootDelta[1]; }
  rootTranslation(it: MatchItem, bone: number): V3 {
    const pk = it.pk!;
    if (pk.anim < 0 || bone <= 0) return [0, 0, 0];
    const clip = this.data.clip(it.kind, pk.anim), joint = clip?.joints[bone];
    const out: V3 = [0, 0, 0];
    if (!joint) return out;
    const time = Math.min(pk.frame, joint.endFrame);
    for (const track of joint.tracks) if (track.type >= 5 && track.type <= 7) out[track.type - 5] = sampleTrack(track.keys, time) ?? 0;
    return out;
  }
  grandchild(it: MatchItem): number {
    const joints = this.data.skeleton(it.kind);
    const index = joints.findIndex((joint) => joint.parent === 1);
    return index > 0 ? index : 1;
  }
  /** Air collision with walls/ceiling push-back; bit 1 floor (downward crossings only), 2 ceiling, 4/8 walls. */
  private airTrace(it: MatchItem, prev: V3): number {
    const stage = this.host.content.stage;
    const contact = traceStage(stage, [prev[0], prev[1], 0], [it.x, it.y, 0]);
    if (!contact) return 0;
    const kind = contact.surface.kind;
    if (kind === 'floor') { it.x = contact.point[0]; it.y = contact.point[1]; it.floor = contact.surface.id; return 1; }
    if (kind === 'ceiling') { it.y = f32(contact.point[1] - 0.01); return 2; }
    const moving = Math.sign(it.x - prev[0]) || 1;
    it.x = f32(contact.point[0] - moving * 0.01);
    return moving > 0 ? 4 : 8;
  }
  /** it_8026E15C family: airborne update; a floor landing grounds the item and runs `land`. */
  airColl(it: MatchItem, prev: V3, land?: () => void): number {
    const bits = this.airTrace(it, prev);
    if (bits & 1) { it.pk!.air = false; land?.(); }
    return bits;
  }
  /** it_8026D62C: grounded follow; walking off the floor goes airborne and runs `left`. */
  groundColl(it: MatchItem, left?: () => void): boolean {
    const floor = this.floorUnder(it.x, it.y);
    if (!floor) { it.pk!.air = true; left?.(); return false; }
    it.y = floor.y; it.floor = floor.id;
    return true;
  }
  /** it_8026DA08: air sweep that reports floor contact (downward crossings), position corrected. */
  floorSweep(it: MatchItem, prev: V3): boolean { return (this.airTrace(it, prev) & 1) !== 0; }
  /** it_8026DB40: floor bit plus wall bits from a body-height sweep. */
  walkSweep(it: MatchItem, prev: V3): number {
    let bits = this.airTrace(it, prev) & 1;
    const lift = 3 * this.attr(it).scale;
    const wall = traceStage(this.host.content.stage, [prev[0], prev[1] + lift, 0], [it.x, it.y + lift, 0]);
    if (wall && wall.surface.kind === 'wall') { const moving = Math.sign(it.x - prev[0]) || 1; it.x = f32(wall.point[0] - moving * 0.01); bits |= moving > 0 ? 4 : 8; }
    return bits;
  }
  /** it_8026DFB0: any floor/wall/ceiling contact. */
  anyContact(it: MatchItem, prev: V3): boolean { return this.airTrace(it, prev) !== 0; }
  /** it_802D6798: collision only corrects the position, so the flame slides along surfaces. */
  slide(it: MatchItem, prev: V3): void {
    const bits = this.airTrace(it, prev);
    if (bits & 1) { const floor = this.floorUnder(it.x, it.y); if (floor) it.y = floor.y; }
  }
  private floorUnder(x: number, y: number): { id: number; y: number } | null {
    let best: { id: number; y: number } | null = null;
    for (const floor of this.host.content.stage.floors) {
      if (x < Math.min(floor.a[0], floor.b[0]) || x > Math.max(floor.a[0], floor.b[0])) continue;
      const fy = floorY(floor, x);
      if (fy > y + 3 || fy < y - 3) continue;
      if (!best || Math.abs(fy - y) < Math.abs(best.y - y)) best = { id: floor.id, y: fy };
    }
    return best;
  }

  // --- fighters / targeting ---------------------------------------------------------------------
  private live(f: MatchFighter): boolean { return f.stocks > 0 && f.state !== 'ko' && f.state !== 'respawn'; }
  private opponents(it: MatchItem): MatchFighter[] { return this.fighters.filter((f) => f.slot !== it.owner && this.live(f)); }
  fighter(slot: number): MatchFighter | undefined { const f = slot >= 0 ? this.fighters[slot] : undefined; return f && this.live(f) ? f : undefined; }
  ownerFighter(it: MatchItem): MatchFighter | undefined { return it.owner === null ? undefined : this.fighters[it.owner]; }
  /** ftLib_800866DC: the fighter's camera-zoom bone (approximated by the body center). */
  center(f: MatchFighter): V3 { return [f.x, f32(f.y + 7 * f.content.profile.attributes.modelScale), 0]; }
  nearestOpponent(it: MatchItem): MatchFighter | undefined {
    let best: MatchFighter | undefined, distance = Infinity;
    for (const f of this.opponents(it)) { const c = this.center(f), d = (it.x - c[0]) ** 2 + (it.y - c[1]) ** 2; if (d < distance) { distance = d; best = f; } }
    return best;
  }
  /** itHassam_802CDE1C: nearest opponent strictly above the item. */
  nearestAbove(it: MatchItem): MatchFighter | undefined {
    let best: MatchFighter | undefined, distance = Infinity;
    for (const f of this.opponents(it)) { const c = this.center(f), d = (it.x - c[0]) ** 2 + (it.y - c[1]) ** 2; if (c[1] > it.y && d < distance) { distance = d; best = f; } }
    return best;
  }
  /** ftLib_80086198: the opponent with the lowest percent. */
  lowestPercentOpponent(it: MatchItem): number | null {
    let best: MatchFighter | undefined;
    for (const f of this.opponents(it)) if (!best || f.percent < best.percent) best = f;
    return best?.slot ?? null;
  }
  /** it_80279C48: face the nearest opponent, a coin flip when there is none. */
  faceNearest(it: MatchItem): void {
    const target = this.nearestOpponent(it);
    it.facing = target ? (it.x - this.center(target)[0] > 0 ? -1 : 1) : (this.randi(2) !== 0 ? 1 : -1);
  }
  /** it_80272980: facing follows the horizontal velocity. */
  faceVelocity(it: MatchItem): void { if (!(Math.abs(it.vx) < 1e-5 && it.facing !== 0)) it.facing = it.vx >= 0 ? 1 : -1; }
  /** Camera_GetTransformInterest / Position: approximated from the stage span (camera not simulated). */
  cameraInterest(): V3 {
    const stage = this.host.content.stage, spawns = stage.spawns;
    return [f32((stage.mainLeft + stage.mainRight) / 2), f32(spawns.reduce((sum, spawn) => sum + spawn[1], 0) / spawns.length + 15), 0];
  }
  cameraEye(): V3 { const interest = this.cameraInterest(); return [interest[0], f32(interest[1] + 10), 150]; }
  cameraHeight(): number { return (this.blast.top - this.blast.bottom) * 0.6; }
  healingEnabled(): boolean { return this.host.healingEnabled?.() ?? true; }

  // --- events -----------------------------------------------------------------------------------
  sound(it: MatchItem, sound: number): void { this.events.push({ type: 'sound', player: it.owner ?? 0, x: it.x, y: it.y, sound, volume: 127, pan: 64 }); }
  gfx(it: MatchItem, effect: number): void { this.events.push({ type: 'gfx', player: it.owner ?? 0, x: it.x, y: it.y, effect, facing: it.facing || 1 }); }
  /** Camera_RequestQuake: the match has no camera shake channel for items yet. */
  quake(_it: MatchItem, _size: 'small' | 'medium' | 'large'): void {}

  // --- spawning ---------------------------------------------------------------------------------
  /** Item_80268B18 for a Pokémon projectile: position = prev_pos, the parent's owner, then Spawned. */
  child(parent: MatchItem, slot: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, facing: number): MatchItem | null {
    if (!this.data.pokemon.has(slot)) return null;
    const it = this.host.spawn(POKEMON_BASE + slot, x, y);
    const pk = it.pk!;
    it.owner = parent.owner; it.facing = facing; it.vx = vx; it.vy = vy; pk.z = z; pk.vz = vz; it.phase = 'act';
    KINDS[slot]?.spawned(this, it, pk);
    return it;
  }
  /** it_8027AB64 + it_8027A4D4: release the ball's Pokémon (`forced` pins the kind for tests). */
  release(ball: MatchItem, fighters: readonly MatchFighter[], events: MatchEvent[], forced: number | null = null): MatchItem | null {
    this.fighterList = fighters; this.eventList = events;
    const memory = this.host.memory, special = this.data.kind(ball.kind).special, arc = this.data.archive;
    let slot: number;
    if (forced !== null) slot = forced;
    else if (this.randi(251) === 0 && memory.legend === 0) { memory.legend = 1; slot = PK.Cerebi; }
    else if (this.randi(251) === 0 && memory.legend === 0) { memory.legend = 1; slot = PK.Mew; }
    else {
      const weight = (i: number) => (special ? arc.u32(special + 0x3c + i * 4) | 0 : 1);
      let total = 1;
      for (let i = 0; i < 30; i++) if (memory.last !== i && memory.previous !== i) total += weight(i);
      const roll = this.randi(total);
      slot = 0;
      for (let i = 0, sum = 0; i < 30; i++) {
        if (memory.last === i || memory.previous === i) continue;
        sum += weight(i);
        if (sum >= roll) { memory.previous = memory.last; memory.last = i; slot = i; break; }
      }
    }
    if (!this.data.pokemon.has(slot)) return null;
    const it = this.host.spawn(POKEMON_BASE + slot, ball.x, ball.y);
    const pk = it.pk!;
    it.owner = ball.owner; it.phase = 'act'; it.vx = 0; it.vy = special ? arc.f32(special + 8) : 2.5; pk.z = 0;
    // ftLib_800864A8: face the side most opponents stand on (coin flip on a tie).
    const lean = this.opponents(it).reduce((sum, f) => sum + Math.sign(this.center(f)[0] - ball.x), 0);
    it.facing = lean < 0 ? -1 : lean > 0 ? 1 : this.randi(2) !== 0 ? 1 : -1;
    KINDS[slot]?.spawned(this, it, pk);
    this.inject(it, ball);
    return it;
  }
  /** Chansey's egg (it_802D51C8): the healing Lucky Egg or a common item Egg, both loose items. */
  egg(_parent: MatchItem, heal: boolean, x: number, y: number, vx: number, vy: number, facing: number): void {
    const kind = heal ? POKEMON_BASE + PK.LuckyEgg : this.host.commonEgg;
    if (kind === null || (heal && !this.data.pokemon.has(PK.LuckyEgg))) return;
    const it = this.host.spawn(kind, x, y);
    it.phase = 'fall'; it.vx = vx; it.vy = vy; it.facing = facing; it.owner = null;
  }

  // --- damage -------------------------------------------------------------------------------
  /** it_80279D38 → it_8027B964: launch along the hit's knockback direction at the fixed ItCo speed. */
  knockOut(it: MatchItem): void {
    const pk = it.pk!, angle = pk.angle === 361 ? (pk.air ? 40 : 0) : pk.angle;
    let vx = f32(-Math.cos(angle * DEG) * pk.dir), vy = f32(Math.sin(angle * DEG));
    if (!pk.air && vy < 0) vy = 0;
    if (!vx && !vy) { vx = f32(0.1 * -pk.dir); vy = 0.1; }
    if (!vy) vy = 0.1;
    const length = Math.hypot(vx, vy) || 1, speed = this.data.pokemonLaunchSpeed || 5;
    it.vx = f32(vx / length * speed); it.vy = f32(vy / length * speed); it.facing = pk.dir;
    pk.air = true; pk.hurt = false; pk.acc = 0;
  }
  /** it_802D1204: Electrode's blast — hidden model, the shared explosion lifetime. */
  explode(it: MatchItem): void {
    const pk = it.pk!;
    if (pk.st === 6) return;
    this.sound(it, 0x2720);
    if (it.phase === 'held') { const holder = it.owner !== null ? this.fighters[it.owner] : undefined; if (holder?.heldItem === it.id) holder.heldItem = null; }
    it.phase = 'act'; pk.grab = false; pk.hidden = true; pk.life = Math.ceil(this.data.common.explosionLife);
    it.vx = 0; it.vy = 0; pk.vz = 0;
    this.enter(it, 6, ANIM);
    this.events.push({ type: 'gfx', player: it.owner ?? 0, x: it.x, y: it.y, effect: 0x410, facing: 1 });
  }

  // --- world entry points -----------------------------------------------------------------------
  pickedUp(it: MatchItem): void { if (this.slot(it) === PK.Marumine) { this.enter(it, 3, KEEP); it.pk!.acc = 2; } }
  thrown(it: MatchItem): void { if (this.slot(it) === PK.Marumine) { it.pk!.grab = false; this.enter(it, 4, KEEP); it.pk!.acc = 2; it.pk!.air = true; } }
  dropped(it: MatchItem): void { if (this.slot(it) === PK.Marumine) { it.pk!.grab = false; this.enter(it, 4, KEEP); it.pk!.air = true; } }
  /** A held Electrode keeps ticking its fuse in the hand. */
  held(it: MatchItem, ctx: PokemonContext): void {
    this.bind(ctx);
    const pk = it.pk!, kind = KINDS[this.slot(it)];
    if (!kind) return;
    this.advance(it);
    kind.rows[pk.st]?.anim?.(this, it, pk);
    if (pk.acc) kind.acc?.[pk.acc]?.(this, it, pk);
  }
  /** One frame of Item_80269528 → Item_802697D4 → Item_80269978 → accessory, then hit collision. */
  tick(it: MatchItem, ctx: PokemonContext): void {
    this.bind(ctx);
    const pk = it.pk!, kind = KINDS[this.slot(it)];
    if (!kind) { this.host.remove(it); return; }
    const prev: V3 = [it.x, it.y, pk.z];
    this.advance(it);
    if (kind.rows[pk.st]?.anim?.(this, it, pk)) { this.host.remove(it); return; }
    if (!this.alive(it)) return;
    kind.rows[pk.st]?.phys?.(this, it, pk);
    if (!this.alive(it)) return;
    it.x = f32(it.x + it.vx); it.y = f32(it.y + it.vy); pk.z = f32(pk.z + pk.vz);
    const b = this.blast;
    if ((pk.blast && (it.x < b.left || it.x > b.right || it.y < b.bottom)) || Math.abs(it.x) > 4000 || Math.abs(it.y) > 4000 || Math.abs(pk.z) > 4000 || it.age > 20000) {
      this.host.remove(it); return;
    }
    if (kind.rows[pk.st]?.coll?.(this, it, pk, prev)) { this.host.remove(it); return; }
    if (!this.alive(it)) return;
    if (pk.acc) kind.acc?.[pk.acc]?.(this, it, pk);
    if (kind.trail && it.age % kind.trail.every === 1) this.gfx(it, kind.trail.effect);
    if (this.alive(it)) this.hits(it, kind);
  }
  private alive(it: MatchItem): boolean { return this.host.alive(it); }

  // --- posed skeleton ---------------------------------------------------------------------------
  /** World matrices of the item skeleton at its current frame: root = T(pos) R_y(facing) S(scale),
   * children from their rest pose plus the loaded animation; root-motion bones held at zero. */
  private pose(it: MatchItem): Matrix4[] {
    const pk = it.pk!, key = `${it.age}:${pk.anim}:${pk.frame}:${it.x}:${it.y}:${pk.z}:${pk.scale}:${it.facing}:${pk.rotY}:${pk.tilt}`;
    const cached = this.poseCache.get(it.id);
    if (cached?.key === key) return cached.matrices;
    const joints = this.data.skeleton(it.kind), clip = pk.anim >= 0 ? this.data.clip(it.kind, pk.anim) : null;
    const kind = KINDS[this.slot(it)], rootBone = kind?.rootBone === -2 ? this.grandchild(it) : kind?.rootBone ?? -1;
    const matrices: Matrix4[] = [], accumulated: V3[] = [];
    for (let index = 0; index < joints.length; index++) {
      const joint = joints[index]!, rotation: V3 = [...joint.rotation], scale: V3 = [...joint.scale], translation: V3 = [...joint.translation];
      const tracks = clip?.joints[index];
      if (tracks) {
        const time = Math.min(pk.frame, tracks.endFrame);
        for (const track of tracks.tracks) {
          const value = sampleTrack(track.keys, time);
          if (value === undefined) continue;
          if (track.type >= 1 && track.type <= 3) rotation[track.type - 1] = value;
          else if (track.type >= 5 && track.type <= 7) translation[track.type - 5] = value;
          else if (track.type >= 8 && track.type <= 10) scale[track.type - 8] = value;
        }
      }
      if (index === 0) {
        translation[0] = it.x; translation[1] = it.y; translation[2] = pk.z;
        rotation[1] = pk.rotY ?? HALF_PI * it.facing;
        scale[0] = scale[1] = scale[2] = pk.scale;
      }
      if (index === rootBone) translation[0] = translation[1] = translation[2] = 0;
      if (index === 4 && this.slot(it) === PK.Sonans) rotation[2] = pk.tilt;
      const parent = joint.parent >= 0 ? matrices[joint.parent] : undefined, parentScale = joint.parent >= 0 ? accumulated[joint.parent]! : [1, 1, 1] as V3;
      accumulated.push(joint.flags & 8 ? [...parentScale] as V3 : [scale[0] * parentScale[0], scale[1] * parentScale[1], scale[2] * parentScale[2]]);
      const matrix = new Matrix4();
      jointMatrix(matrix, scale, rotation, translation, parentScale);
      if (parent) matrix.premultiply(parent);
      matrices.push(matrix);
    }
    if (!matrices.length) {
      const root = new Matrix4();
      jointMatrix(root, [pk.scale, pk.scale, pk.scale], [0, pk.rotY ?? HALF_PI * it.facing, 0], [it.x, it.y, pk.z], [1, 1, 1]);
      matrices.push(root);
    }
    this.poseCache.set(it.id, { key, matrices });
    return matrices;
  }
  /** lb_8000B1CC: a point in a bone's space, in world coordinates. */
  bonePoint(it: MatchItem, bone: number, offset: V3): V3 {
    const matrices = this.pose(it), matrix = matrices[bone] ?? matrices[0]!;
    scratchVector.set(offset[0], offset[1], offset[2]).applyMatrix4(matrix);
    return [f32(scratchVector.x), f32(scratchVector.y), f32(scratchVector.z)];
  }
  forget(id: number): void { this.poseCache.delete(id); }

  // --- collision against fighters ---------------------------------------------------------------
  private hits(it: MatchItem, kind: Kind): void {
    const pk = it.pk!, ctx = this.ctx!;
    if (pk.script < 0) return;
    const script = this.data.kind(it.kind).states[pk.script]?.script;
    if (!script) return;
    const scl = this.attr(it).scale;
    for (const raw of activeHits(script, pk.scriptFrame)) {
      if (raw.activation !== it.activation) { it.victims.clear(); it.activation = raw.activation; }
      let damage = raw.damage;
      // Wobbuffet's counter: hitbox 0 carries (u32)x68, the armed counter damage.
      if (this.slot(it) === PK.Sonans && raw.id === 0) { damage = Math.trunc(pk.v[3]!); if (damage < 1) continue; }
      const center = this.bonePoint(it, raw.bone, raw.offset as V3);
      const hit: HitDefinition = { ...raw, damage, bone: 0, radius: f32(raw.radius * scl), angle: Math.min(361, raw.angle) };
      for (const victim of ctx.fighters) {
        // The summoner is never a victim (itcoll.c's owner test). The original lets Wobbuffet and
        // Electrode's blast (it_80275444, xDCD b5) hit the owner too; this port keeps every
        // Pokémon owner-safe by design decision.
        if (victim.slot === it.owner || it.victims.has(victim.slot) || victim.invulnerable > 0 || victim.state === 'ko' || victim.state === 'respawn') continue;
        const direction = Math.sign(victim.x - center[0]) || (it.facing || 1);
        const shield = shieldBubble(victim, this.host.content, ctx.poses);
        if (shield && pointSegmentDistanceSquared(shield.center, center, center) <= (shield.radius + hit.radius) ** 2) {
          it.victims.add(victim.slot);
          ctx.impacts.push({ item: it, hit, direction, victim, point: center, shield: true });
          if (kind.shieldDestroys) { this.host.remove(it); return; }
          continue;
        }
        const hurts = ctx.hurtCache.get(victim);
        if (!hurtSweepCandidate(hurts, center, center, hit.radius)) continue;
        for (const hurt of hurts.capsules) {
          if (segmentDistanceSquared(center, center, hurt.a, hurt.b) > (hit.radius + hurt.radius) ** 2) continue;
          it.victims.add(victim.slot);
          ctx.impacts.push({ item: it, hit, direction, victim, point: center });
          if (kind.dealt?.(this, it, pk)) { this.host.remove(it); return; }
          break;
        }
        if (!this.alive(it)) return;
      }
    }
  }
  /** Fighter attacks against a hurtable Pokémon's article hurt capsules (dmg_received path). */
  strike(it: MatchItem, ctx: PokemonContext, frozen?: readonly boolean[]): void {
    this.bind(ctx);
    const pk = it.pk!, kind = KINDS[this.slot(it)], data = this.data.kind(it.kind), scl = this.attr(it).scale;
    if (!pk.hurt || !kind?.damaged || !data.hurtbones.length) return;
    for (const f of ctx.fighters) {
      if ((frozen?.[f.slot] ?? f.hitlag > 0) || !['attack', 'special'].includes(f.state) || !f.attackName) continue;
      const move = f.content.attacks.get(f.attackName);
      if (!move) continue;
      for (const hit of linkHits(f, activeHits(move, f.animationFrame))) {
        const key = `${f.slot}:${f.attackSerial}:${hit.group}:${hit.activation}`;
        if (hit.damage <= 0 || hit.element === 8 || it.struckBy.has(key)) continue;
        const point = ctx.poses.point(f, hit.bone, hit.offset);
        const touched = data.hurtbones.some((h) => pointSegmentDistanceSquared(point, this.bonePoint(it, h.bone, h.a), this.bonePoint(it, h.bone, h.b)) <= (hit.radius + h.radius * scl) ** 2);
        if (!touched) continue;
        it.struckBy.add(key);
        pk.taken = f32(pk.taken + hit.damage); pk.last = hit.damage; pk.dir = -(f.facing || 1); pk.angle = hit.angle;
        f.hitlag = Math.max(f.hitlag, this.host.content.physics.hit(f.slot, 0, hit, false).hitlag);
        ctx.events.push({ type: 'gfx', player: f.slot, x: it.x, y: it.y, effect: 1000 });
        kind.damaged(this, it, pk);
        if (!pk.hurt) return;
      }
    }
  }
}

/** Render-side view of a Pokémon item: which model/animation frame to draw and its transforms. */
export interface PokemonRender {
  anim: number; frame: number; scale: number; z: number; rotY: number; hidden: boolean;
  letter: number | null; spin: V3 | null;
  /** Joint translation offsets cancelling the root-motion bone (it_8027A160 leaves it at zero). */
  rootJoint: { joint: number; offset: V3 } | null;
  /** Wobbuffet's bone-4 rotation with the physics tilt written over its animated Z. */
  tilt: { joint: number; rotation: V3 } | null;
}
export function pokemonRender(it: MatchItem, data: ItemsData): PokemonRender {
  const pk = it.pk!, slot = it.kind - POKEMON_BASE, kind = KINDS[slot];
  let rootJoint: PokemonRender['rootJoint'] = null;
  if (kind?.rootBone !== undefined && pk.anim >= 0) {
    const joints = data.skeleton(it.kind), joint = kind.rootBone === -2 ? Math.max(1, joints.findIndex((j) => j.parent === 1)) : kind.rootBone;
    const clip = data.clip(it.kind, pk.anim), tracks = clip?.joints[joint];
    if (tracks) {
      const offset: V3 = [0, 0, 0], rest = joints[joint]?.translation ?? [0, 0, 0];
      const animated: V3 = [...rest] as V3;
      for (const track of tracks.tracks) if (track.type >= 5 && track.type <= 7) animated[track.type - 5] = sampleTrack(track.keys, Math.min(pk.frame, tracks.endFrame)) ?? animated[track.type - 5]!;
      offset[0] = -animated[0]; offset[1] = -animated[1]; offset[2] = -animated[2];
      rootJoint = { joint, offset };
    }
  }
  return {
    anim: pk.anim, frame: pk.frame, scale: pk.scale, z: pk.z, rotY: pk.rotY ?? HALF_PI * it.facing, hidden: pk.hidden,
    letter: slot === PK.Unknown || slot === PK.UnownSwarm ? pk.letter : null,
    spin: slot === PK.UnownSwarm ? pk.spin : null, rootJoint,
    tilt: slot === PK.Sonans ? { joint: 4, rotation: jointRotation(data, it, 4, pk.tilt) } : null,
  };
}
function jointRotation(data: ItemsData, it: MatchItem, joint: number, z: number): V3 {
  const pk = it.pk!, rotation: V3 = [...(data.skeleton(it.kind)[joint]?.rotation ?? [0, 0, 0])] as V3;
  const tracks = pk.anim >= 0 ? data.clip(it.kind, pk.anim)?.joints[joint] : undefined;
  for (const track of tracks?.tracks ?? []) if (track.type >= 1 && track.type <= 3) rotation[track.type - 1] = sampleTrack(track.keys, Math.min(pk.frame, tracks!.endFrame)) ?? rotation[track.type - 1]!;
  rotation[2] = z;
  return rotation;
}
