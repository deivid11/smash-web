import { parseRoyParameters, type RoySpecialData } from './roy-data.ts';
import { parseDkParameters, type DkSpecialData } from './dk-data.ts';
import { parseFalconParameters, type FalconSpecialData } from './falcon-data.ts';
import { parseLinkParameters, type LinkSpecialData } from './link-data.ts';
import { parseSamusParameters, type SamusSpecialData } from './samus-data.ts';
import { parsePikachuParameters, type PikachuSpecialData } from './pikachu-data.ts';
import { parseMewtwoParameters, type MewtwoSpecialData, type ShadowMewtwoSpecialData } from './mewtwo-data.ts';
import { parsePurinParameters, type PurinSpecialData } from './purin-data.ts';
import { parseNessParameters, type NessSpecialData, type NessArticles } from './ness-data.ts';
import { parseKoopaParameters, type KoopaSpecialData } from './koopa-data.ts';
import { parseGkParameters, type GkSpecialData } from './gk-data.ts';
import { parsePeachParameters, type PeachSpecialData, type PeachArticles } from './peach-data.ts';
import { parseZeroParameters, type ZeroSpecialData } from './zero-data.ts';
import { parseToadParameters, type ToadSpecialData } from './toad-data.ts';
import { parseTailsParameters, type TailsSpecialData, type TailsShotData } from './tails-data.ts';
import { parseMetaKnightParameters, type MetaKnightSpecialData } from './metaknight-data.ts';
import { parseSonicParameters, type SonicSpecialData, type SonicSpringData } from './sonic-data.ts';
import { parseRaichuParameters, type RaichuSpecialData } from './raichu-data.ts';
import { parseLizardonParameters, type LizardonSpecialData, type LizardonArticles } from './lizardon-data.ts';
import { parseWolfParameters, type WolfSpecialData } from './wolf-data.ts';
import { parseDiddyParameters, type DiddySpecialData } from './diddy-data.ts';
import { parseDededeParameters, type DededeSpecialData } from './dedede-data.ts';
import { parseWarioParameters, type WarioSpecialData } from './wario-data.ts';
import { parseShadowParameters, type ShadowSpecialData } from './shadow-data.ts';
import { parseBlastoiseParameters, type BlastoiseSpecialData } from './blastoise-data.ts';
import { parseLucasParameters, type LucasSpecialData } from './lucas-data.ts';
import { parseMetalSonicParameters, type MetalSonicSpecialData } from './metal-data.ts';
import { parseNintenParameters, type NintenSpecialData } from './ninten-data.ts';
import { parseDaisyParameters, type DaisySpecialData } from './daisy-data.ts';
import { parseMarthParameters, type MarthSpecialData } from './marth-data.ts';
import { parseGanonParameters, type GanonSpecialData } from './ganon-data.ts';
import { parsePichuParameters, type PichuSpecialData } from './pichu-data.ts';
import { parseFalcoParameters, type FalcoSpecialData } from './falco-data.ts';
import { parseDrMarioParameters, type DrMarioSpecialData } from './drmario-data.ts';
import { parseLuigiParameters, type LuigiSpecialData, type DrLuigiSpecialData, type LuigiBooSpecialData } from './luigi-data.ts';
import { parseFayParameters, type FaySpecialData } from './fay-data.ts';
import { parseBSonicParameters, type BSonicSpecialData, type BSonicArticles } from './bsonic-data.ts';
import { parseKnucklesParameters, type KnucklesSpecialData } from './knuckles-data.ts';
import { parseLucinaParameters, type LucinaSpecialData } from './lucina-data.ts';
import type { SkullKidSpecialData } from './sd-data.ts';
import { parseMetalMarioParameters, type MetalMarioSpecialData } from './metalmario-data.ts';
import { parseLc2Parameters } from './lc2-data.ts';
import { parseSkullKidParameters } from './sd-data.ts';
import { parseChunLiParameters, type ChunLiSpecialData } from './chunli-data.ts';
import { parsePopoParameters, type PopoSpecialData } from './popo-data.ts';
import { parseZeldaParameters, type ZeldaSpecialData } from './zelda-data.ts';
import { parseSeakParameters, type SeakSpecialData } from './seak-data.ts';
import { parseGamewatchParameters, type GamewatchSpecialData } from './gamewatch-data.ts';
import { parseYoshiParameters, type YoshiSpecialData } from './yoshi-data.ts';
import { HsdArchive } from '../hsd/archive.ts';
import { loadModel, type HsdModel, type V3 } from '../hsd/model.ts';
import { loadJointAnimation } from '../hsd/animation.ts';
import { ParticleBank } from '../hsd/particle-bank.ts';
import type { FighterProfile, OriginalFighterKind } from './data.ts';
import type { HitDefinition } from './moves.ts';

export type SpecialDirection = 'neutral' | 'side' | 'up' | 'down';
export interface ReflectorData { bone: number; offset: V3; radius: number; damageMultiplier: number; speedMultiplier: number; maxDamage: number; keepOwner: boolean }
export interface ArticleData { model: HsdModel; attachmentBone?: number; hit: HitDefinition | null; throwHit?:HitDefinition|null; speed: number; angle: number; lifetime: number; gravity: number; terminal: number; bounce: number; minSpeed: number; scale: number; sound: number; rayScale: number; deceleration: number }
export interface FoxSpecialData {
  kind: 'Fx'; neutral: { speed: number; angle: number };
  side: { delay: number; divisor: number; friction: number; gravity: number; endGround: number; endAir: number; endFriction: number; endAirFriction: number; endDelay: number; endGravity: number; landing: number; mobility: number };
  up: { delay: number; divisor: number; friction: number; gravity: number; aimThreshold: number; frames: number; slowAfter: number; speed: number; decay: number; landing: number; mobility: number };
  down: { releaseLag: number; delay: number; divisor: number; gravity: number; reflect: ReflectorData };
}
export interface MarioSpecialData {
  kind: 'Mr'; cape: { divisor: number; friction: number; boost: number; gravity: number; terminal: number; reflect: ReflectorData };
  up: { mobility: number; landing: number; reverseThreshold: number; aimThreshold: number; angle: number; momentum: number; gravity: number; airScale: number };
  down: { initial: number; groundSpeed: number; airSpeed: number; groundAccel: number; airAccel: number; endFriction: number; boost: number; cap: number; landing: number };
}
export interface CustomSpecialData { kind: 'custom' }
/** ftKb_DatAttrs (third_party/melee/src/melee/ft/kinds/ftKirby/types.h); copy-ability blocks are not read. */
export interface KirbySpecialData {
  kind: 'Kb';
  jumps: { turnFrames: number; turnThreshold: number; impulseX: number; accelMultiplier: number; speedMultiplier: number; vertical: number[] };
  inhale: { mouthX: number; mouthY: number; pullSpeed: number; stickDown: number; walkStick: number; walkSpeed: number; holdFrames: number; holdDivisor: number; resistance: number; spit: { speed: number; deceleration: number; angle: number }; star: { speed: number; gravity: number } };
  hammer: { airBoost: number; landingLag: number };
  cutter: { verticalDamping: number; driftMultiplier: number; spawnX: number; spawnY: number; reverseRange: number };
  /** Fox copy blaster (ftKb_SpecialNFx_800FDF30): launch angle/speed and the hand-relative spawn offset. */
  copyLaser: { angle: number; speed: number; offset: V3 };
  stone: { maxFrames: number; minFrames: number; fallSpeed: number; hp: number; slideMax: number; freefall: number };
}
// Link ships one layout for both kinds; single-literal variants keep negative discriminant narrowing sound.
export type FighterSpecialData = RoySpecialData | MarthSpecialData | FoxSpecialData | FalcoSpecialData | MarioSpecialData | DrMarioSpecialData | LuigiSpecialData | DrLuigiSpecialData | LuigiBooSpecialData | PopoSpecialData | ZeldaSpecialData | SeakSpecialData | GamewatchSpecialData | YoshiSpecialData | CustomSpecialData | KirbySpecialData | SamusSpecialData | PikachuSpecialData | PichuSpecialData | (LinkSpecialData & { kind: 'Lk' }) | (LinkSpecialData & { kind: 'Cl' }) | FalconSpecialData | GanonSpecialData | DkSpecialData | MewtwoSpecialData | ShadowMewtwoSpecialData | PurinSpecialData | NessSpecialData | KoopaSpecialData | PeachSpecialData | ZeroSpecialData | ToadSpecialData | MetaKnightSpecialData | (SonicSpecialData & { kind: 'Sn' }) | RaichuSpecialData | LizardonSpecialData | WolfSpecialData | DiddySpecialData | DededeSpecialData | WarioSpecialData | (ShadowSpecialData & { kind: 'Sh' }) | BlastoiseSpecialData | LucasSpecialData | MetalSonicSpecialData | NintenSpecialData | DaisySpecialData | FaySpecialData | BSonicSpecialData | (KnucklesSpecialData & { kind: 'Kx' }) | LucinaSpecialData | MetalMarioSpecialData | SkullKidSpecialData | ChunLiSpecialData | GkSpecialData | TailsSpecialData;
export interface SpecialAssets { parameters: FighterSpecialData; particles?: ParticleBank; articles: { projectile?: ArticleData; accessory?: ArticleData; ghost?: ArticleData; fay?: { laser: ArticleData; gun: ArticleData; sniper: ArticleData }; chunli?: { kiko: ArticleData }; link?: { boomerang: ArticleData; lateBoomerang: ArticleData; returning: ArticleData; bomb: ArticleData; explosion: ArticleData; bows: ArticleData[] }; pikachu?: { thunder: ArticleData; groundJolt: ArticleData; groundPath: V3[]; thunderLength: number; thunderTip: number }; koopa?: { flame: ArticleData; speed: [number, number]; angle: [number, number] }; samus?: { charges: ArticleData[]; hold: ArticleData; missile: ArticleData; superMissile: ArticleData; bomb: ArticleData; explosion: ArticleData; bombLaunchY: number; bombBlast: Array<{ frame: number; radius: number | null }> }; mewtwo?: { charges: ArticleData[]; disable: ArticleData; wobblePeriod: number }; ness?: NessArticles; peach?: PeachArticles; zero?: { shot: ArticleData; charged: ArticleData }; toad?: { ice: ArticleData; bigIce: ArticleData }; lizardon?: LizardonArticles; wolf?: { laser: ArticleData; gun: ArticleData; muzzle: V3 }; diddy?: import('./diddy-data.ts').DiddyArticles; dedede?: { gordo: ArticleData; star: ArticleData }; blastoise?: { water: ArticleData; spray: ArticleData }; lucas?: { freeze: ArticleData; fire: ArticleData }; metal?: { shot: ArticleData; spark: ArticleData }; ninten?: { pellet: ArticleData }; zelda?: { travel: ArticleData; blast: ArticleData }; seak?: { needles: ArticleData; chain: ArticleData; vanish: ArticleData }; gamewatch?: { sausage: ArticleData; parachute: ArticleData; judge: ArticleData; outlines: { sausage: number[]; parachute: number[]; judge: number[] } }; yoshi?: { egg: ArticleData; star: ArticleData }; sonic?: { spring: SonicSpringData }; bsonic?: BSonicArticles; tails?: { shot: TailsShotData } }; effects: Map<string, HsdModel>; /** m-ex model effects (script gfx 5000+n) with their table lifetimes. */ mexEffects?: Map<number, { model: HsdModel; life: number; follow?: boolean }>; sounds: { jump: number; airJump: number; ko: number }; /** m-ex fighter SEM bank for `5000 + n` code sounds (lib/game/ace-voices.ts). */ soundBank?: number }
/** One Kirby copy ability from PlKbCpXx.dat (KirbyHatStruct): the hat model plus the copied special's items.
 * Beyond Fox/Mario the copied shot reuses the source fighter's own articles/parameters (kept as references).
 * `hatHidden` lists hat draw-object ordinals hidden for costume-0 alternative 0 (ftParts_8007487C),
 * so multi-material hats (Link green/white) show only the selected side. `sword` is the
 * Roy/Marth copy blade (hat_dynamics[0] joint, via ftCommon_SetAccessory), not an item. */
export type CopySource = 'Fx' | 'Mr' | 'Lk' | 'Cl' | 'Ss' | 'Pk' | 'Ca' | 'Dk' | 'Mt' | 'Fe' | 'Fc' | 'Dr' | 'Gn' | 'Pc' | 'Ms';
export interface CopyAbility { source: CopySource; hat?: HsdModel; hatHidden?: number[]; sword?: HsdModel; projectile?: ArticleData; accessory?: ArticleData; sourceParameters: FighterSpecialData; sourceArticles: SpecialAssets['articles'] }
const fixed = Math.fround(0.003906);
const signed16 = (n: number) => (n << 16) >> 16;

export function parseSpecialParameters(arc: HsdArchive, profile: FighterProfile): FighterSpecialData {
  if (profile.kind === 'Lk' || profile.kind === 'Cl') return parseLinkParameters(arc, profile.kind) as FighterSpecialData;
  if (profile.kind === 'Fe') return parseRoyParameters(arc, profile);
  if (profile.kind === 'Ms') return parseMarthParameters(arc, profile);
  if (profile.kind === 'Pk') return parsePikachuParameters(arc);
  if (profile.kind === 'Pc') return parsePichuParameters(arc);
  if (profile.kind === 'Ss') return parseSamusParameters(arc);
  if (profile.kind === 'Ca' || profile.kind === 'Bf') return parseFalconParameters(arc);
  if (profile.kind === 'Gn') return parseGanonParameters(arc);
  if (profile.kind === 'Fc') return parseFalcoParameters(arc, profile);
  if (profile.kind === 'Dr') return parseDrMarioParameters(arc, profile);
  if (profile.kind === 'Lg' || profile.kind === 'Dl' || profile.kind === 'Lb') return parseLuigiParameters(arc, profile.kind);
  if (profile.kind === 'Fy') return parseFayParameters(arc);
  if (profile.kind === 'Sc') return parseBSonicParameters(arc);
  if (profile.kind === 'Kx') return parseKnucklesParameters(arc);
  if (profile.kind === 'Lu') return parseLucinaParameters(arc, profile);
  if (profile.kind === 'MM') return parseMetalMarioParameters(arc, profile);
  if (profile.kind === 'Lc2') return parseLc2Parameters(arc);
  if (profile.kind === 'Sd') return parseSkullKidParameters(arc);
  if (profile.kind === 'Cn') return parseChunLiParameters(arc);
  if (profile.kind === 'Pp') return parsePopoParameters(arc);
  if (profile.kind === 'Zd') return parseZeldaParameters(arc, profile);
  if (profile.kind === 'Sk') return parseSeakParameters(arc);
  if (profile.kind === 'Gw') return parseGamewatchParameters(arc, profile);
  if (profile.kind === 'Ys') return parseYoshiParameters(arc);
  if (profile.kind === 'Dk') return parseDkParameters(arc);
  if (profile.kind === 'Mt' || profile.kind === 'Sm') return parseMewtwoParameters(arc, profile, profile.kind);
  if (profile.kind === 'Pr') return parsePurinParameters(arc);
  if (profile.kind === 'Ns') return parseNessParameters(arc, profile);
  if (profile.kind === 'Kp') return parseKoopaParameters(arc);
  if (profile.kind === 'Gk') return parseGkParameters(arc);
  if (profile.kind === 'Pe') return parsePeachParameters(arc, profile);
  if (profile.kind === 'Zx') return parseZeroParameters(arc);
  if (profile.kind === 'Td') return parseToadParameters(arc);
  if (profile.kind === 'Ts') return parseTailsParameters(arc);
  if (profile.kind === 'Mk') return parseMetaKnightParameters(arc);
  if (profile.kind === 'Sn') return parseSonicParameters(arc);
  if (profile.kind === 'Rc') return parseRaichuParameters(arc);
  if (profile.kind === 'Lz') return parseLizardonParameters(arc);
  // Wolf SSBU runs PlWf's compiled kit byte for byte (lib/game/wolf-data.ts).
  if (profile.kind === 'Wf' || profile.kind === 'WfU') return parseWolfParameters(arc, profile);
  if (profile.kind === 'Dd') return parseDiddyParameters(arc);
  if (profile.kind === 'De') return parseDededeParameters(arc);
  if (profile.kind === 'Wr') return parseWarioParameters(arc);
  if (profile.kind === 'Sh') return parseShadowParameters(arc);
  if (profile.kind === 'Bl') return parseBlastoiseParameters(arc);
  if (profile.kind === 'Lc') return parseLucasParameters(arc);
  if (profile.kind === 'Nm') return parseMetalSonicParameters(arc, profile);
  if (profile.kind === 'Nt') return parseNintenParameters(arc);
  if (profile.kind === 'Da') return parseDaisyParameters(arc, profile);
  const root = [...arc.symbols.values()][0]!, base = arc.pointer(root + 4);
  const f = (offset: number) => { const value = arc.f32(base + offset); if (Math.abs(value) > 1000) throw new Error('Special parameter exceeds supported bounds.'); return value; };
  const reflect = (offset: number): ReflectorData => {
    const p = base + offset, bone = arc.u32(p), radius = arc.f32(p + 20);
    if (bone >= profile.boneCount || radius <= 0 || radius > 100) throw new Error('Invalid original reflector data.');
    return { bone, offset: [arc.f32(p+8),arc.f32(p+12),arc.f32(p+16)], radius, damageMultiplier: arc.f32(p+24), speedMultiplier: arc.f32(p+28), maxDamage: arc.u32(p+4), keepOwner: arc.u8(p+32)!==0 };
  };
  if (profile.kind === 'Kb') {
    const u = (offset: number) => arc.u32(base + offset);
    const jumpCount = u(0x28);
    if (jumpCount < 1 || jumpCount > 5) throw new Error('Unsupported original multi-jump count.');
    const data: KirbySpecialData = {
      kind: 'Kb',
      jumps: { turnFrames: u(0), turnThreshold: f(4), impulseX: f(8), accelMultiplier: f(0xc), speedMultiplier: f(0x10), vertical: Array.from({ length: jumpCount }, (_, i) => f(0x14 + i * 4)) },
      inhale: { mouthX: f(0x38), mouthY: f(0x3c), pullSpeed: f(0x50), stickDown: f(0x78), walkStick: f(0x74), walkSpeed: f(0x7c), holdFrames: f(0x5c), holdDivisor: f(0x58), resistance: f(0x54), spit: { speed: f(0x88), deceleration: f(0x8c), angle: f(0x90) }, star: { speed: f(0x94), gravity: f(0x98) } },
      hammer: { airBoost: f(0xcc), landingLag: f(0xd0) },
      cutter: { verticalDamping: f(0xd4), driftMultiplier: f(0xd8), spawnX: f(0xdc), spawnY: f(0xe0), reverseRange: f(0xe4) },
      copyLaser: { angle: f(0x230), speed: f(0x234), offset: [0, 1.45, 5.016] },
      stone: { maxFrames: u(0xec), minFrames: u(0xf0), fallSpeed: f(0x104), hp: u(0x108), slideMax: f(0x100), freefall: f(0x114) },
    };
    if (data.jumps.turnFrames < 1 || data.jumps.turnFrames > 60 || data.stone.maxFrames < 1 || data.stone.maxFrames > 600 || data.stone.minFrames > data.stone.maxFrames || data.stone.hp > 500 || data.inhale.pullSpeed <= 0 || data.inhale.holdFrames < 1 || data.inhale.holdFrames > 1200 || data.inhale.holdDivisor <= 0 || data.inhale.resistance < 0 || data.inhale.walkStick <= 0 || data.inhale.walkSpeed <= 0) throw new Error('Unsupported original Kirby special parameters.');
    return data;
  }
  if (profile.kind === 'Fx') return {
    kind: 'Fx', neutral: { speed:f(0x14), angle:f(0x10) },
    side: { delay:f(0x24), divisor:f(0x28), friction:f(0x2c), gravity:f(0x30), endGround:f(0x34), endAir:f(0x3c), endFriction:f(0x38), endAirFriction:f(0x40), endDelay:f(0x44), endGravity:f(0x48), landing:f(0x50), mobility:f(0x4c) },
    up: { delay:f(0x54), divisor:f(0x58), friction:f(0x5c), gravity:f(0x60), aimThreshold:f(0x64), frames:f(0x68), slowAfter:f(0x70), speed:f(0x74), decay:f(0x78), landing:f(0x90), mobility:f(0x8c) },
    down: { releaseLag:f(0x98), delay:arc.u32(base+0xa4), divisor:f(0xa8), gravity:f(0xac), reflect:reflect(0xb0) },
  };
  return {
    kind:'Mr', cape:{ divisor:f(0), friction:f(4), boost:f(8), gravity:f(12), terminal:f(16), reflect:reflect(0x60) },
    up:{ mobility:f(0x18), landing:f(0x1c), reverseThreshold:f(0x20), aimThreshold:f(0x24), angle:f(0x28), momentum:f(0x2c), gravity:f(0x30), airScale:f(0x34) },
    down:{ initial:f(0x38), groundSpeed:f(0x3c), airSpeed:f(0x40), groundAccel:f(0x44), airAccel:f(0x48), endFriction:f(0x4c), boost:f(0x54), cap:f(0x58), landing:arc.u32(base+0x5c) },
  };
}
export function itemHit(arc: HsdArchive, pointer: number): HitDefinition | null {
  for (let steps=0;steps<64;steps++) {
    const w=arc.u32(pointer), op=w>>>26;
    if(op===0) return null;
    if(op===11) {
      arc.range(pointer,24); const a=arc.u32(pointer+4),b=arc.u32(pointer+8),c=arc.u32(pointer+12),d=arc.u32(pointer+16);
      return { id:(w>>>23)&7, group:(w>>>20)&7, bone:(w>>>13)&127, damage:w&8191, radius:Math.fround((a>>>16)*fixed), offset:[Math.fround(signed16(a)*fixed),Math.fround(signed16(b>>>16)*fixed),Math.fround(signed16(b)*fixed)], angle:c>>>23, growth:(c>>>14)&511, weightSet:(c>>>5)&511, base:d>>>23, element:(d>>>18)&31, soundSeverity:(d>>>6)&7, soundKind:(d>>>2)&15, grounded:!!(d&2), airborne:!!(d&1) };
    }
    if(op===5 || op===7) { pointer=arc.pointer(pointer+4); continue; }
    pointer += op===10 ? 20 : 4;
  }
  throw new Error('Item hitbox script budget exceeded.');
}
/** Article { x0 ItemAttr* common, x4 special, x8 hurtbones, xC states, x10 model }. A null common block
 * (Kirby copy items) takes gravity/terminal/bounce/scale/sound from the supplied fallback article. */
function readArticle(arc: HsdArchive, article: number, name: string, fallback?: ArticleData): ArticleData {
  const common=arc.pointer(article), special=arc.pointer(article+4), states=arc.pointer(article+12), model=arc.pointer(article+16);
  if(!common&&!fallback) throw new Error(`Original ${name} article has no common attributes.`);
  const object=loadModel(arc,{offset:arc.pointer(model),name,animation:arc.pointer(states),materialAnimation:arc.pointer(states+4)});
  const hitScript=arc.pointer(states+12), hit=hitScript?itemHit(arc,hitScript):null;
  const isFire=name==='fireball'||name==='megavitamin', isLuigiFire=name==='luigi-fire', isLaser=name==='laser', isCutter=name==='cutter';
  if((isFire||isLuigiFire||isLaser||isCutter)&&!special) throw new Error(`Original ${name} article has no special attributes.`);
  const c=(offset:number,key:'gravity'|'terminal'|'bounce'|'scale')=>common?arc.f32(common+offset):fallback![key];
  // itKirbyCutterBeamAttributes: x0 speed, x4 vel, x8 lifetime, xC deceleration.
  return { model:object, hit, ...(isLaser?{throwHit:itemHit(arc,arc.pointer(states+28))}:{}),
    speed:isFire?arc.f32(special):isLuigiFire?arc.f32(special):isCutter?arc.f32(special):0, angle:isFire?arc.f32(special+4):0,
    lifetime:isFire?arc.f32(special+8):isLuigiFire?arc.f32(special+4):isLaser?arc.f32(special):isCutter?arc.f32(special+8):30,
    gravity:c(16,'gravity'), terminal:c(20,'terminal'), bounce:c(0x58,'bounce'), minSpeed:isFire?arc.f32(special+16):0,
    scale:c(0x60,'scale'), sound:common?arc.u32(common+0x78):fallback!.sound, rayScale:isLaser?arc.f32(special+4):1,
    deceleration:isCutter?arc.f32(special+12):0,
  };
}
/** Article model roots vary per fighter: some slots point at the JObj directly, others at a
 * one-pointer descriptor. Resolve deterministically by probing the double dereference first. */
export function articleModel(arc: HsdArchive, article: number, name: string, states: number): HsdModel {
  const direct = arc.pointer(article + 16);
  const options = { name, animation: arc.pointer(states), materialAnimation: arc.pointer(states + 4) };
  try { return loadModel(arc, { offset: arc.pointer(direct), ...options }); }
  catch { return loadModel(arc, { offset: direct, ...options }); }
}
export function parseArticle(arc: HsdArchive, index: number, name: string): ArticleData {
  const root=[...arc.symbols.values()][0]!, table=arc.pointer(root+0x48);
  return readArticle(arc, arc.pointer(table+index*4), name);
}
/** ftDataKirbyCopyXx (KirbyHatStruct): +0 hat joint, +4 FtPartsDesc, +C.. the copied special's item
 * articles (ftKb_SpecialN_800F16D0: Fox laser + blaster, Mario fireball) and accessory joints
 * (ftkirbyspecialmars.c: Roy/Marth sword via hat_dynamics[0] + SetAccessory). */
/** Draw objects hidden for hat costume-0 alternative 0 (ftParts_8007487C on the hat desc).
 * Best-effort: any malformed table leaves the hat fully visible rather than failing the fighter. */
function parseHatHidden(arc: HsdArchive, root: number): number[] | undefined {
  try {
    const visTable = arc.pointer(root + 8);
    const set0 = arc.pointer(visTable);
    const groupCount = arc.u32(set0);
    if (groupCount < 1 || groupCount > 16) return undefined;
    const table = arc.pointer(set0 + 4);
    const visible = new Set<number>();
    const hidden = new Set<number>();
    for (let group = 0; group < groupCount; group++) {
      const alternatives = arc.u32(table + group * 8);
      const list = arc.pointer(table + group * 8 + 4);
      if (alternatives < 1 || alternatives > 16) return undefined;
      for (let alt = 0; alt < alternatives; alt++) {
        const size = arc.u32(list + alt * 8);
        const indices = arc.pointer(list + alt * 8 + 4);
        if (size > 128) return undefined;
        for (const dobj of [...arc.slice(indices, size)]) (alt === 0 ? visible : hidden).add(dobj);
      }
    }
    return [...hidden].filter((dobj) => !visible.has(dobj)).sort((a, b) => a - b);
  } catch { return undefined; }
}
export function parseCopyAbility(arc: HsdArchive, source: CopySource, sourceSpecials: SpecialAssets): CopyAbility {
  const root=[...arc.symbols.values()][0]!;
  // KirbyHatStruct(+0 hat_joint) holds for Fox/Mario; other archives vary their root layout
  // (DK keeps no mesh there, some point elsewhere). A hat that fails to parse stays hatless.
  let hat: HsdModel | undefined;
  try { const model=loadModel(arc,{offset:arc.pointer(root),name:`kirby-hat-${source}`}); if(model.stats.meshes) hat=model; }
  catch { hat=undefined; }
  if(!hat&&(source==='Fx'||source==='Mr')) throw new Error(`Kirby ${source} hat has no geometry.`);
  const hatHidden=hat?parseHatHidden(arc,root):undefined;
  // Roy's copy blade rides as an accessory joint (hat_dynamics[0]), not an item article.
  let sword: HsdModel | undefined;
  if(source==='Fe') {
    try { const model=loadModel(arc,{offset:arc.pointer(root+0xc),name:`kirby-sword-${source}`}); if(model.stats.meshes) sword=model; }
    catch { sword=undefined; }
  }
  const base={ source, ...(hat?{hat}:{}), ...(hatHidden?.length?{hatHidden}:{}), ...(sword?{sword}:{}), sourceParameters: sourceSpecials.parameters, sourceArticles: sourceSpecials.articles };
  // Only the Fox/Mario shots come from the copy archive itself; every other copy fires the
  // source fighter's own articles, so the archive only supplies the hat here.
  if(source!=='Fx'&&source!=='Mr') return base;
  const fallback=sourceSpecials.articles.projectile;
  if(!fallback) throw new Error(`Kirby ${source} copy source has no projectile article.`);
  const projectile=readArticle(arc, arc.pointer(root+0xc), source==='Fx'?'laser':'fireball', fallback);
  if(!projectile.hit) throw new Error(`Kirby ${source} copy projectile has no hit definition.`);
  const accessory=source==='Fx'?readArticle(arc, arc.pointer(root+0x10), 'blaster'):undefined;
  return { ...base, projectile, ...(accessory?{accessory}:{}) };
}
/** Effect descriptor ordinals are gfx_id % 1000 of each character's effect bank (efLib). */
const EFFECT_TABLES: Record<OriginalFighterKind, { symbol: string; names: Array<[number, string]> }> = {
  Lk: { symbol: 'effLinkDataTable', names: [] },
  Cl: { symbol: 'effLinkDataTable', names: [] }, // Young Link shares Link's bank; EfClData.dat does not exist.
  Fe: { symbol: 'effEmblemDataTable', names: [] }, // Native fire particles/sword trails are not model descriptors.
  Ms: { symbol: 'effMarsDataTable', names: [] }, // Marth's sword trails are particle-bank descriptors, like Roy.
  Pk: { symbol: 'effPikachuDataTable', names: [] }, // Particle-bank descriptors are not interchangeable with model descriptors.
  Pc: { symbol: 'effPikachuDataTable', names: [] }, // Pichu shares Pikachu's bank; EfPcData.dat does not exist.
  // Fox efSync ids are sequential into this table: 1160 reflector loop, 1161 reflector
  // start, 1162 reflector hit, 1163 firefox charge, 1164 firefox launch (see
  // ftFx_SpecialLw_Create*GFX / ftFx_SpecialHi_Create*GFX). The Ness rows below
  // confirm the same sequential convention (1262 hold, 1263 flight, 1264 magnet).
  Fx: { symbol: 'effFoxDataTable', names: [[0, 'shine-loop'], [1, 'shine-start'], [2, 'shine-hit'], [3, 'firefox-charge'], [4, 'firefox-launch']] },
  Fc: { symbol: 'effFoxDataTable', names: [[0, 'shine-loop'], [1, 'shine-start'], [2, 'shine-hit'], [3, 'firefox-charge'], [4, 'firefox-launch']] }, // Falco shares Fox's bank; EfFcData.dat does not exist.
  Mr: { symbol: 'effMarioDataTable', names: [[0, 'fireball-muzzle'], [1, 'tornado']] },
  Dr: { symbol: 'effMarioDataTable', names: [[0, 'fireball-muzzle'], [1, 'tornado']] }, // Dr. Mario shares Mario's bank; EfDrData.dat does not exist.
  // 0x1388–0x138A: Final Cutter start (efalt 0x494); 0x138C/0x138D: hammer spawn (0x496/0x497).
  // Only entries 0-2 are model descriptors (efAlt kinds 0x7D0-0x7D2); the rest of the Samus
  // bank is particle generators (hsd_8039EFAC), which are not model descriptors.
  Ss: { symbol: 'effSamusDataTable', names: [[0, 'screw-attack']] },
  Mt: { symbol: 'effMewtwoDataTable', names: [] }, // Shadow/psychic particles are particle-bank descriptors, not model descriptors.
  Ca: { symbol: 'effCaptainDataTable', names: [] }, // Flame/wind particles are particle-bank descriptors, not model descriptors.
  Gn: { symbol: 'effGanonDataTable', names: [] }, // Warlock particles are particle-bank descriptors, not model descriptors.
  Dk: { symbol: 'effDonkeyDataTable', names: [] }, // Giant Punch sparkles/Kong trails are particle-bank descriptors, not model descriptors.
  Pr: { symbol: 'effPurinDataTable', names: [] }, // Rollout sparks/Sing notes are particle-bank descriptors, not model descriptors.
  Kp: { symbol: 'effKoopaDataTable', names: [] }, // Flame/claw particles are particle-bank descriptors, not model descriptors.
  Pe: { symbol: 'effPeachDataTable', names: [] }, // Heart/glitter particles are particle-bank descriptors, not model descriptors.
  // Entries 0-2 are the only model descriptors in Ness's bank; the rest is particle
  // generators. They are efSync ids 1262/1263 (ftNs_Special(Air)HiHold and the PK Thunder 2
  // flight, both on FtPart_HipN) and the efAsync 1264 PSI Magnet shield on FtPart_L1stNb.
  Ns: { symbol: 'effNessDataTable', names: [[0, 'pk-thunder-aura'], [1, 'pk-thunder-2-aura'], [2, 'psi-magnet']] },
  Kb: { symbol: 'effKirbyDataTable', names: [[0, 'cutter-blade'], [1, 'cutter-trail'], [2, 'cutter-burst'], [3, 'dash-fire'], [4, 'hammer-ground'], [5, 'hammer-air']] },
  Lg: { symbol: 'effLuigiDataTable', names: [[0, 'fireball-muzzle'], [1, 'tornado']] }, // idx1 is the Cyclone spin (5 meshes/170 tris, same shape as Mario tornado).
  Ys: { symbol: 'effYoshiDataTable', names: [] },
  Pp: { symbol: 'effIceclimberDataTable', names: [] },
  Zd: { symbol: 'effZeldaDataTable', names: [] },
  Sk: { symbol: 'effZeldaDataTable', names: [] }, // Sheik shares Zelda's bank; EfSkData.dat does not exist.
  Gw: { symbol: 'effCommonDataTable', names: [] }, // Mr. Game & Watch has no EfGwData.dat; particle-only.
  Zx: { symbol: 'effZeroDataTable', names: [] }, // ACE saber/buster particles are particle-bank descriptors, not model descriptors.
  Td: { symbol: 'effToadDataTable', names: [] },
  Mk: { symbol: 'effMetaDataTable', names: [] },
  // efSync 0x1388 (spin ball, Sonic_GFXSpin), 0x1389 (trail ribbon, SpawnTrailEffect), 0x138B
  // (spin-dash charge sparkle, SpecialS_SpawnChargeEffect) and 0x138E (dash streak, OnFrame).
  Sn: { symbol: 'effSonicDataTable', names: [[0, 'sonic-spin'], [1, 'sonic-trail'], [3, 'sonic-charge'], [6, 'sonic-run']] },
  Rc: { symbol: 'effRaichuDataTable', names: [] },
  Lz: { symbol: 'effLizardonDataTable', names: [] },
  // PlWf's accessory4 callbacks hold models 0-3 like Fox's (0x1388 shine loop, 0x1389 start,
  // 0x138A hit, 0x138B firefox charge); the launch spawns model 4 (efSync 0x138C, the Fire Wolf
  // flame), whose joint animation carries an HSD user-data track (see loadJointAnimation).
  Wf: { symbol: 'effWolfDataTable', names: [[0, 'shine-loop'], [1, 'shine-start'], [2, 'shine-hit'], [3, 'firefox-charge'], [4, 'firefox-launch']] },
  Dd: { symbol: 'effDiddyDataTable', names: [] },
  De: { symbol: 'effDededeDataTable', names: [] },
  Wr: { symbol: 'effWarioDataTable', names: [] },
  Sh: { symbol: 'effShadowDataTable', names: [] },
  Bl: { symbol: 'effKoopaDataTable', names: [] },
  // The ACE Ness clones ship Ness's own bank head: entries 0-2 are byte-identical PSI model
  // descriptors (3/2/68, 10/9/223 and 12/7/470 joints/meshes/triangles), so they name the same.
  Lc: { symbol: 'effLucasDataTable', names: [[0, 'pk-thunder-aura'], [1, 'pk-thunder-2-aura'], [2, 'psi-magnet']] },
  Nm: { symbol: 'effNmDataTable', names: [] },
  Nt: { symbol: 'effNintenDataTable', names: [[0, 'pk-thunder-aura'], [1, 'pk-thunder-2-aura'], [2, 'psi-magnet']] },
  Da: { symbol: 'effPeachDataTable', names: [] },
  Fy: { symbol: 'effFoxDataTable', names: [] }, // Fay shares Fox's bank; no EfFyData.dat.
  Sc: { symbol: 'effSonicDataTable', names: [] },
  Dl: { symbol: 'effLuigiDataTable', names: [[0, 'fireball-muzzle'], [1, 'tornado']] }, // DrLuigi shares Luigi's bank; no EfDlData.dat.
  Kx: { symbol: 'effSonicDataTable', names: [] },
  Lu: { symbol: 'effMarsDataTable', names: [] }, // Lucina shares Marth's bank; no EfLuData.dat.
  Lc2: { symbol: 'effLucas2DataTable', names: [[0, 'pk-thunder-aura'], [1, 'pk-thunder-2-aura'], [2, 'psi-magnet']] },
  Sm: { symbol: 'effMewtwoDataTable', names: [] }, // Shadow Mewtwo shares Mewtwo's bank; no EfSmData.dat.
  Lb: { symbol: 'effLuigiDataTable', names: [[0, 'fireball-muzzle'], [1, 'tornado']] }, // Luigi & Boo share Luigi's bank; no EfLbData.dat.
  MM: { symbol: 'effMarioDataTable', names: [[0, 'fireball-muzzle'], [1, 'tornado']] }, // Metal Mario shares Mario's bank; no EfMMData.dat.
  Sd: { symbol: 'effCommonDataTable', names: [] }, // Skull Kid has no EfSdData.dat; particle-only.
  Cn: { symbol: 'effCommonDataTable', names: [] }, // Chun-Li has no EfCnData.dat; particle-only.
  Gk: { symbol: 'effKoopaDataTable', names: [] }, // Giga Bowser reuses EfKpData.dat; particle-bank descriptors, not model descriptors.
  Ts: { symbol: 'effTailsDataTable', names: [] },
  Bf: { symbol: 'effBloodDataTable', names: [] }, // Blood Falcon ships his own EfBfData.dat over Falcon's particle conventions.
  WfU: { symbol: 'effWolfDataTable', names: [[0, 'shine-loop'], [1, 'shine-start'], [2, 'shine-hit'], [3, 'firefox-charge'], [4, 'firefox-launch']] }, // Wolf SSBU shares Wolf's EfWfData.dat.
};
/** The fighter bank's own particle generators (efLib_CreateGenerator ids are absolute, e.g.
 * Bowser's flame is 0x2EE5-0x2EE8 inside a bank that starts at 12000). Fighters whose archive
 * carries no generator table keep none. */
export function parseEffectParticles(arc: HsdArchive, kind: OriginalFighterKind): ParticleBank | undefined {
  const root=arc.symbol(EFFECT_TABLES[kind].symbol);
  try { return new ParticleBank(arc,arc.pointer(root),arc.pointer(root+4)); } catch { return undefined; }
}
/** m-ex effect files (ACE fighters) carry an effBehaviorTable whose first count is the number of
 * model entries: script gfx 5000+n spawns entry n (x0 lifetime, x4 JObj, x8/xC animations). An
 * entry that does not load is left out rather than failing the fighter. */
/** effBehaviorTable = {model count, u8 behavior[], generator count, u8 behavior[]}. Model
 * behavior 6 rides its spawning bone (Sonic's spin ball, Charizard's Flare Blitz aura,
 * Raichu's roll glow); the others play where they spawned. */
export function parseMexEffectModels(arc: HsdArchive, kind: OriginalFighterKind): Map<number,{model:HsdModel;life:number;follow:boolean}> | undefined {
  if (!arc.symbols.has('effBehaviorTable')) return undefined;
  const table = arc.symbol('effBehaviorTable'), count = arc.u32(table), behaviors = arc.pointer(table + 4), root = arc.symbol(EFFECT_TABLES[kind].symbol) + 8, out = new Map<number,{model:HsdModel;life:number;follow:boolean}>();
  if (count > 64) return undefined;
  for (let index = 0; index < count; index++) {
    const desc = root + index * 20, life = arc.f32(desc);
    try {
      const model = loadModel(arc, { offset: arc.pointer(desc + 4), name: `mex-effect-${kind}-${index}`, animation: arc.pointer(desc + 8), materialAnimation: arc.pointer(desc + 12) });
      // The renderer parses the joint animation lazily; a corrupt one (PlLz entry 4, the Flare
      // Blitz aura) must be rejected here rather than throw inside the frame loop.
      for (const root of model.roots) loadJointAnimation(arc, root.animationPointer);
      out.set(index, { model, life: Number.isFinite(life) ? life : 0, follow: behaviors !== 0 && arc.u8(behaviors + index) === 6 });
    } catch { /* unsupported entry */ }
  }
  return out;
}
export function parseEffectModels(arc: HsdArchive, kind: OriginalFighterKind): Map<string,HsdModel> {
  const table=EFFECT_TABLES[kind], root=arc.symbol(table.symbol)+8;
  return new Map(table.names.map(([index,name])=>{
    const desc=root+index*20;
    return [name,loadModel(arc,{offset:arc.pointer(desc+4),name,animation:arc.pointer(desc+8),materialAnimation:arc.pointer(desc+12)})];
  }));
}
