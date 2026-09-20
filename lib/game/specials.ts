import type { MatchFighter, PlayerInput } from './match.ts';
import type { MeleePhysics } from './physics.ts';
import type { CommonGameplayData, FighterKind, Floor } from './data.ts';
import type { CombatData } from './combat-data.ts';
import type { SpecialDirection, ReflectorData } from './special-data.ts';
import { pikachuSpecialName, beginPikachuSpecial, stepPikachuSpecial, landPikachuSpecial, type PikachuRuntime } from './pikachu.ts';
import { sampleTrack } from '../hsd/animation.ts';
import type { V3 } from '../hsd/model.ts';
import type { ActiveHit, MoveEvent } from './moves.ts';
import { requireCustomCharacter } from '../custom/registry.ts';
import { roySpecialName, beginRoySpecial, stepRoySpecial, type RoyRuntime } from './roy.ts';
import { samusSpecialName, beginSamusSpecial, stepSamusSpecial } from './samus.ts';
import { kirbySpecialName,beginKirbySpecial,stepKirbySpecial,landKirbySpecial } from './kirby.ts';
import { linkSpecialName, beginLinkSpecial, stepLinkSpecial, landLinkSpecial, type LinkRuntime } from './link.ts';
import { falconSpecialName, beginFalconSpecial, stepFalconSpecial, landFalconSpecial, type FalconRuntime } from './falcon.ts';
import { dkSpecialName, beginDkSpecial, stepDkSpecial, landDkSpecial, type DkRuntime } from './dk.ts';
import { mewtwoSpecialName, beginMewtwoSpecial, stepMewtwoSpecial, landMewtwoSpecial, type MewtwoRuntime } from './mewtwo.ts';
import { purinSpecialName, beginPurinSpecial, stepPurinSpecial, landPurinSpecial, type PurinRuntime } from './purin.ts';
import { nessSpecialName, beginNessSpecial, stepNessSpecial, landNessSpecial, nessBatReflector, type NessRuntime } from './ness.ts';
import { koopaSpecialName, beginKoopaSpecial, stepKoopaSpecial, landKoopaSpecial, type KoopaRuntime } from './koopa.ts';
import { peachSpecialName, beginPeachSpecial, stepPeachSpecial, landPeachSpecial, type PeachRuntime } from './peach.ts';
import { zeroSpecialName, beginZeroSpecial, stepZeroSpecial, landZeroSpecial, type ZeroRuntime } from './zero.ts';
import { toadSpecialName, beginToadSpecial, stepToadSpecial, landToadSpecial } from './toad.ts';
import { tailsSpecialName, beginTailsSpecial, stepTailsSpecial, landTailsSpecial, type TailsRuntime } from './tails.ts';
import { metaKnightSpecialName, beginMetaKnightSpecial, stepMetaKnightSpecial, landMetaKnightSpecial, type MetaKnightRuntime } from './metaknight.ts';
import { sonicSpecialName, beginSonicSpecial, stepSonicSpecial, landSonicSpecial, sonicInterruptible, sonicStopsAtLedge, sonicHitDamage, type SonicRuntime } from './sonic.ts';
import { raichuSpecialName, beginRaichuSpecial, stepRaichuSpecial, landRaichuSpecial, raichuHits, type RaichuRuntime } from './raichu.ts';
import { lizardonSpecialName, beginLizardonSpecial, stepLizardonSpecial, landLizardonSpecial, type LizardonRuntime } from './lizardon.ts';
import { wolfSpecialName, beginWolfSpecial, stepWolfSpecial, landWolfSpecial, wolfReflector, reflectWolf, wolfCanJump, type WolfRuntime } from './wolf.ts';
import { diddySpecialName, beginDiddySpecial, stepDiddySpecial, landDiddySpecial, diddyCatchesLedge, diddyHits, type DiddyRuntime } from './diddy.ts';
import { dededeSpecialName, beginDededeSpecial, stepDededeSpecial, landDededeSpecial, type DededeRuntime } from './dedede.ts';
import { warioSpecialName, beginWarioSpecial, stepWarioSpecial, landWarioSpecial, type WarioRuntime } from './wario.ts';
import { shadowSpecialName, beginShadowSpecial, stepShadowSpecial, landShadowSpecial, type ShadowRuntime } from './shadow.ts';
import { blastoiseSpecialName, beginBlastoiseSpecial, stepBlastoiseSpecial, landBlastoiseSpecial, type BlastoiseRuntime } from './blastoise.ts';
import { lucasSpecialName, beginLucasSpecial, stepLucasSpecial, landLucasSpecial, type LucasRuntime } from './lucas.ts';
import { metalSpecialName, beginMetalSpecial, stepMetalSpecial, landMetalSpecial, metalReflector, reflectMetal, type MetalSonicRuntime } from './metal.ts';
import { nintenSpecialName, beginNintenSpecial, stepNintenSpecial, landNintenSpecial, type NintenRuntime } from './ninten.ts';
import { skullkidSpecialName, beginSkullKidSpecial, stepSkullKidSpecial, landSkullKidSpecial, skullkidSpecialAllowed, skullkidCatchesLedge, type SkullKidRuntime } from './sd.ts';
import { chunliSpecialName, beginChunLiSpecial, stepChunLiSpecial, landChunLiSpecial, type ChunLiRuntime } from './chunli.ts';
import { faySpecialName, beginFaySpecial, stepFaySpecial, landFaySpecial, type FayRuntime } from './fay.ts';
import { bsonicSpecialName, beginBSonicSpecial, stepBSonicSpecial, landBSonicSpecial, bsonicSpecialAllowed, bsonicInterruptible, bsonicStopsAtLedge, bsonicHitDamage, bsonicCatchesLedge, type BSonicRuntime } from './bsonic.ts';
import { knucklesSpecialName, beginKnucklesSpecial, stepKnucklesSpecial, landKnucklesSpecial, type KnucklesRuntime } from './knuckles.ts';
import { luigiSpecialName, beginLuigiSpecial, stepLuigiSpecial, landLuigiSpecial, luigiAttackName, type LuigiRuntime } from './luigi.ts';
import { popoSpecialName, beginPopoSpecial, stepPopoSpecial, landPopoSpecial, type PopoRuntime } from './popo.ts';
import { zeldaSpecialName, beginZeldaSpecial, stepZeldaSpecial, landZeldaSpecial, type ZeldaRuntime } from './zelda.ts';
import { seakSpecialName, beginSeakSpecial, stepSeakSpecial, landSeakSpecial, type SeakRuntime } from './seak.ts';
import { gamewatchSpecialName, beginGamewatchSpecial, stepGamewatchSpecial, landGamewatchSpecial, type GamewatchRuntime } from './gamewatch.ts';
import { yoshiSpecialName, beginYoshiSpecial, stepYoshiSpecial, landYoshiSpecial, type YoshiRuntime } from './yoshi.ts';

export interface SpecialRuntime {
  direction: SpecialDirection; phase: 'start'|'loop'|'travel'|'end'|'hit';
  age: number; delay: number; releaseLag: number; released: boolean; queued: boolean;
  counterDamage?:number;
  pikachu?: PikachuRuntime;
  roy?: RoyRuntime;
  /** Link/Young Link bow charge, boomerang aim and bomb throw state (ftLk callbacks). */
  link?: LinkRuntime;
  /** Captain Falcon motion vars: Raptor fall, Kick slowdown, Dive freefall (ftCaptain_MotionVars). */
  falcon?: FalconRuntime;
  /** Donkey Kong motion vars: swings banked into the active punch, cancel/repeat latches (ftDonkey_MotionVars). */
  dk?: DkRuntime;
  /** Mewtwo motion vars: Shadow Ball charge iteration/full latch and the Teleport zoom timer (ftMewtwo_MotionVars). */
  mewtwo?: MewtwoRuntime;
  /** Jigglypuff motion vars: Rollout charge/roll/turn state (ftPurin_MotionVars.specialn). */
  purin?: PurinRuntime;
  /** Ness motion vars: PK Flash/Thunder article latches, PK Thunder 2 launch and PSI Magnet lag. */
  ness?: NessRuntime;
  /** Bowser motion vars: Klaw bites, Bomb dive latch and the flame cadence. */
  koopa?: KoopaRuntime;
  /** Peach motion vars: Bomber contact, Toad spores and the parasol canopy. */
  peach?: PeachRuntime;
  /** Zero motion vars: Z-Buster charge, Hienkyaku chain latch and the Sentsuizan dive. */
  zero?: ZeroRuntime;
  /** Meta Knight motion vars: Mach Tornado loops and the Dimensional Cape direction. */
  mk?: MetaKnightRuntime;
  /** Sonic motion vars: spin-dash charge, homing-dash budget and the bounce latch. */
  sonic?: SonicRuntime;
  /** Raichu side-roll build-up (ft_var51 steps); his other specials share `pikachu`. */
  raichu?: RaichuRuntime;
  /** Charizard motion vars: flame cadence/groups, rush frames, Fly drift and the rock flags. */
  lizardon?: LizardonRuntime;
  /** Wolf motion state and vars (PlWf's compiled callbacks, lib/game/wolf.ts). */
  wolf?: WolfRuntime;
  /** Tails motion vars: spin-dash loop tier and the helicopter fly budget. */
  tails?: TailsRuntime;
  /** Diddy motion state and vars (PlDd's compiled callbacks, lib/game/diddy.ts). */
  diddy?: DiddyRuntime;
  /** Dedede motion vars: hammer charge. */
  dedede?: DededeRuntime;
  /** Wario motion vars: waft charge. */
  wario?: WarioRuntime;
  /** Shadow motion vars: spin-dash charge, homing-dash budget and bounce latch. */
  shadow?: ShadowRuntime;
  blastoise?: BlastoiseRuntime;
  lucas?: LucasRuntime;
  metal?: MetalSonicRuntime;
  ninten?: NintenRuntime;
  skullkid?: SkullKidRuntime;
  chunli?: ChunLiRuntime;
  fay?: FayRuntime;
  bsonic?: BSonicRuntime;
  knuckles?: KnucklesRuntime;
  /** Luigi motion vars: Green Missile charge and the rolled misfire flag. */
  luigi?: LuigiRuntime;
  /** Ice Climbers spray state and hover-stall latch (Popo-side; Nana has no specials of her own). */
  popo?: PopoRuntime;
  /** Zelda/Sheik din/needle/transform state. */
  zelda?: ZeldaRuntime;
  /** Sheik needle/chain/vanish state. */
  seak?: SeakRuntime;
  /** Game & Watch sausage/judge/oil state. */
  gamewatch?: GamewatchRuntime;
  /** Yoshi egg-trap/roll/throw state. */
  yoshi?: YoshiRuntime;
  /** Samus neutral charge clock and side-special variant. */
  chargeTicks?: number; smashMissile?: boolean;
  /** Kirby: Final Cutter reversal, Stone armor HP / hold timer / transformation toggles (ftKb_SpecialLWVars). */
  reversed?:boolean; stoneHp?:number; stoneShape?:number; stoneFrame?:number; stoneFlicker?:number; stoneShown?:boolean; stoneHeld?:number; stoneLanded?:boolean;
  /** Kirby copy specials: charge frames (Roy/bow), banked swings taken at release (DK) and the full-charge latch. */
  copyCharge?: number; copySwings?: number; copyFull?: boolean;
  startedAir: boolean; aim: number; driftLimit: number; lastFrame: number; serial: number;
}
export type ProjectileKind = 'tails-shot'|'diddy-banana'|'tjolt'|'thunder'|'laser'|'fireball'|'cutter'|'charge'|'missile'|'super-missile'|'bomb'|'arrow'|'boomerang'|'link-bomb'|'shadow-ball'|'disable'|'pk-fire'|'pk-fire-pillar'|'pk-flash'|'pk-thunder'|'koopa-flame'|'turnip'|'toad-spore'|'peach-blast'|'buster'|'buster-charged'|'iceball'|'raichu-jolt'|'lizardon-flame'|'lizardon-rock'|'lizardon-burst'|'wolf-laser'|'diddy-peanut'|'dedede-gordo'|'blastoise-water'|'blastoise-spray'|'lucas-freeze'|'lucas-fire'|'metal-shot'|'ninten-pellet'|'fay-laser'|'fay-sniper'|'chunli-kiko'|'ice-shot'|'blizzard'|'dins-fire'|'needles'|'chain-whip'|'sausage'|'yoshi-egg'|'yoshi-star'|'sonic-spring'|'bsonic-spring'|'skull-bomb';
/** `at` pins the spawn point when the owner moves before shots spawn (Sonic's spring is left
 * where he stood, not where the launch carried him). */
/** `dropped`: the same frame's Coll ended the motion before the end-of-frame accessory callback
 * that fires the shot ran (ChangeMotionState clears accessory4_cb — Metal Sonic's neutral shot). */
export interface ShotIntent { player: number; kind: ProjectileKind; copy?: boolean; charge?: number; rawCharge?: number; aim?: number; fast?: boolean; variant?: number; at?: [number, number]; effect?: number; dropped?: boolean }
/** `roll` is ftCo_8009917C leaving a charging special straight into EscapeF/EscapeB: the step
 * has already finished the special, and the host hands the motion to the combat controller. */
export interface SpecialStep { handled: boolean; shots: ShotIntent[]; sounds: number[]; transform?: FighterKind; roll?: string;
  /** Code-spawned efSync effects (not script gfx): effect id at fighter part `part`, or at the
   * skeleton joint `bone` plus a joint-local `offset` when the code names a joint directly. */
  effects?: Array<{ effect: number; part: number; bone?: number; offset?: V3 }>;
  /** Code-spawned common items at fighter part `part` + joint-local `offset` (Judgment 7's food). */
  items?: Array<{ kind: 'food'; part: number; offset: V3 }>;
  /** Special-owned throw releases (ftCo_800DDDE4-style detaches): `hit` lands on fighter `victim` at
   * `point`, launching toward `direction`, without ordinary hitlag. The special already unlinked
   * the grab. */
  strikes?: Array<{ victim: number; hit: import('./moves.ts').HitDefinition; direction: number; point: V3 }> }
/** What a special may read about the rest of the match: its rivals (Sonic's homing search),
 * team rules, live springs and this frame's button edges (the engine has already folded the
 * frame's input into `previous` when specials step). */
export interface SpecialWorld {
  fighters: readonly MatchFighter[]; teams: boolean; teamOf: (f: MatchFighter) => number;
  springs: ReadonlyArray<{ x: number; y: number }>; jumpPressed: boolean; shieldPressed: boolean;
  /** The floor segment a grounded fighter stands on (surface normal and pass-through checks). */
  floor?: { a: readonly [number, number]; b: readonly [number, number]; oneWay: boolean };
  /** Joint positions of every fighter (Black Sonic's homing aims at the rival's part-4 joint). */
  poses?: import('./match.ts').PoseProvider;
  /** ftCommonData x34: stick·facing at or below it turns (ftCo_800C97A8). */
  turnStick?: number;
  /** A fresh A press this frame (Diddy's SStick/AirSJump IASA read the A|B pressed mask). */
  attackPressed?: boolean;
  /** The fighter already has a banana out (PlDd ft_var2: Banana_Spawn refuses a second one). */
  bananaOut?: boolean;
  /** Tails' shot is still alive (PlTs ft_var1: SpecialN_Enter refuses a second one). */
  tailsShotOut?: boolean;
}
/** A special's native IASA window: 'full' lets any action through, 'aerial' only attacks,
 * 'aerial-jump' attacks and an air jump. */
export function specialInterruptible(f: MatchFighter): 'full' | 'aerial' | 'aerial-jump' | null {
  if (f.content.profile.kind === 'Sn' || f.content.profile.kind === 'Kx' || f.content.profile.kind === 'Sh' || f.content.profile.kind === 'Ts') return sonicInterruptible(f);
  if (f.content.profile.kind === 'Sc') return bsonicInterruptible(f);
  return null;
}
/** Special states whose own Coll decides ledge catches (null keeps the generic up/side rule). */
export function specialCatchesLedge(f: MatchFighter): boolean | null {
  if (f.content.profile.kind === 'Sc') return bsonicCatchesLedge(f);
  if (f.content.profile.kind === 'Sd') return skullkidCatchesLedge(f);
  if (f.content.profile.kind === 'Dd') return diddyCatchesLedge(f);
  return null;
}
/** Grounded special states whose Coll stops at the ledge (ft_800827A0) rather than walking off. */
export function specialStopsAtLedge(f: MatchFighter): boolean {
  if (f.content.profile.kind === 'Sc') return bsonicStopsAtLedge(f);
  return (f.content.profile.kind === 'Sn' || f.content.profile.kind === 'Kx' || f.content.profile.kind === 'Sh' || f.content.profile.kind === 'Ts') && sonicStopsAtLedge(f);
}
/** Special-owned damage rewrites of hitbox 0 (Sonic's level-scaled spin charge). */
export function specialHits(f: MatchFighter, hits: ActiveHit[]): ActiveHit[] {
  if (f.content.profile.kind === 'Rc') return raichuHits(f, hits);
  if (f.content.profile.kind === 'Dd') return diddyHits(f, hits);
  if (f.content.profile.kind === 'Sc' && hits.length > 0) {
    const damage = bsonicHitDamage(f);
    return damage === null ? hits : hits.map((hit, index) => index === 0 ? { ...hit, damage } : hit);
  }
  if ((f.content.profile.kind !== 'Sn' && f.content.profile.kind !== 'Kx' && f.content.profile.kind !== 'Sh' && f.content.profile.kind !== 'Ts') || hits.length === 0) return hits;
  const damage = sonicHitDamage(f);
  if (damage === null) return hits;
  return hits.map((hit, index) => index === 0 ? { ...hit, damage } : hit);
}
export function selectSpecial(input: PlayerInput): SpecialDirection {
  if (input.specialDirection) return input.specialDirection;
  const y = input.y || (input.down ? -1 : 0);
  return y > 0.5 ? 'up' : y < -0.5 ? 'down' : Math.abs(input.x) > 0.28 ? 'side' : 'neutral';
}
function phaseName(f: MatchFighter, direction: SpecialDirection, phase: SpecialRuntime['phase']): string {
  const air = !f.grounded;
  if(f.content.profile.kind==='Fe'||f.content.profile.kind==='Ms'||f.content.profile.kind==='Lu')return roySpecialName(f,direction,phase);
  if(f.content.profile.kind==='Pk'||f.content.profile.kind==='Pc')return pikachuSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Ss')return samusSpecialName(f,direction,phase);
  if(f.content.specials.parameters.kind==='custom')return requireCustomCharacter(f.content.profile.kind).specials.name(direction,phase,air);
  if(f.content.profile.kind==='Kb')return kirbySpecialName(direction,phase,air,f.special?.startedAir??air,f.copyAbility,f.special?.copyFull);
  if(f.content.profile.kind==='Lk'||f.content.profile.kind==='Cl')return linkSpecialName(f,direction,phase,f.special?.link);
  if(f.content.profile.kind==='Ca'||f.content.profile.kind==='Gn'||f.content.profile.kind==='Bf')return falconSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Dk')return dkSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Mt')return mewtwoSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Pr')return purinSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Ns')return nessSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Kp'||f.content.profile.kind==='Gk')return koopaSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Pe'||f.content.profile.kind==='Da')return peachSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Zx')return zeroSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Td')return toadSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Ts')return tailsSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Mk')return metaKnightSpecialName(f,direction,phase,f.special?.mk);
  if(f.content.profile.kind==='Sn')return sonicSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Rc')return raichuSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Lz')return lizardonSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Wf'||f.content.profile.kind==='WfU')return wolfSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Dd')return diddySpecialName(f,direction,phase);
  if(f.content.profile.kind==='De')return dededeSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Wr')return warioSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Sh')return shadowSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Bl')return blastoiseSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Lc')return lucasSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Nm')return metalSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Nt')return nintenSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Lc2')return lucasSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Sm')return mewtwoSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Sd')return skullkidSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Cn')return chunliSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Fy')return faySpecialName(f,direction,phase);
  if(f.content.profile.kind==='Sc')return bsonicSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Kx')return knucklesSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Lg'||f.content.profile.kind==='Dl'||f.content.profile.kind==='Lb')return luigiSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Pp')return popoSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Zd')return zeldaSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Sk')return seakSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Gw')return gamewatchSpecialName(f,direction,phase);
  if(f.content.profile.kind==='Ys')return yoshiSpecialName(f,direction,phase);
  if (f.content.profile.kind === 'Mr' || f.content.profile.kind === 'Dr' || f.content.profile.kind === 'MM') return direction === 'neutral' ? (air?'SpecialAirN':'SpecialN') : direction === 'side' ? (air?'SpecialSAir':'SpecialS') : direction === 'up' ? (air?'SpecialAirHi':'SpecialHi') : (air?'SpecialAirLw':'SpecialLw');
  const prefix=air?'SpecialAir':'Special';
  if(direction==='neutral') return `${prefix}N${phase==='start'?'Start':phase==='end'?'End':'Loop'}`;
  if(direction==='side') return `${prefix}S${phase==='start'?'Start':phase==='end'?'End':''}`;
  if(direction==='up') {
    // ftFx_MS_SpecialHiHold(HoldAir) charge, SpecialHi flight (no separate AirHi
    // figatree; both airs use SpecialHi), SpecialHiLanding ground end,
    // SpecialHiFall air end, SpecialHiBound wall rebound.
    if(phase==='start') return air?'SpecialHiHoldAir':'SpecialHiHold';
    if(phase==='travel') return 'SpecialHi';
    if(phase==='hit') return 'SpecialHiBound';
    return f.grounded?'SpecialHiLanding':'SpecialHiFall';
  }
  return `${prefix}Lw${phase==='start'?'Start':phase==='end'?'End':phase==='hit'?'Hit':'Loop'}`;
}
function phase(f: MatchFighter, next: SpecialRuntime['phase']): void {
  const s=f.special!;s.phase=next;s.lastFrame=-1;
  f.state='special';f.animation=phaseName(f,s.direction,next);f.animationFrame=0;f.stateFrame=0;f.animationEpoch++;
  f.attackName=f.animation;f.attackSerial++;f.victims.clear();
}
export function finishSpecial(f: MatchFighter, helpless=false, lag=0, mobility=1): void {
  f.special=null; f.attackName=null; f.animationFrame=0;f.stateFrame=0;f.animationEpoch++;
  if(helpless&&!f.grounded){f.state='helpless';f.animation='Fall';f.specialLandingLag=lag;f.specialMobility=mobility;f.jumpsUsed=f.content.profile.attributes.maxJumps;}
  else{f.state=f.grounded?'idle':'fall';f.animation=f.grounded?'Wait1':'Fall';}
}
export function beginSpecial(f: MatchFighter, direction: SpecialDirection, input: PlayerInput, common?: CommonGameplayData): void {
  const p=f.content.specials.parameters, air=!f.grounded;
  // Donkey Kong has no aerial Hand Slap state (ftDk_MS_SpecialLw* are ground-only).
  if(p.kind==='Dk'&&direction==='down'&&air)return;
  // SpecialAirSStart_Enter (PlKx): one glide per airtime (ft_var9, cleared by OnLanding).
  if(p.kind==='Kx'&&direction==='side'&&air&&f.glideUsed)return;
  // Black Sonic's exports return untouched while their ft_var50/49/51 latch is set.
  if(p.kind==='Sc'&&!bsonicSpecialAllowed(f,direction))return;
  // Skull Kid's SpecialN only resets the facing while no bomb is ready or detonatable.
  if(p.kind==='Sd'&&!skullkidSpecialAllowed(f,direction))return;
  if(input.x) f.facing=input.x>0?1:-1;
  f.special={direction,phase:'start',age:0,delay:0,releaseLag:0,released:false,queued:false,startedAir:air,aim:Math.PI/2,driftLimit:0,lastFrame:-1,serial:++f.specialSerial};
  // Like LocalMatch.change: RunBrake/TurnRun hold their pose at rate 0, which a special started
  // from the skid would otherwise inherit (its start animation would never play out).
  f.animationRate=1;
  f.fastFall=false;
  if(p.kind==='Fe'||p.kind==='Ms'||p.kind==='Lu')beginRoySpecial(f,direction);
  else if(p.kind==='Pk'||p.kind==='Pc')beginPikachuSpecial(f,direction);
  else if(p.kind==='Ss')beginSamusSpecial(f,direction);
  else if(p.kind==='Kb')beginKirbySpecial(f,direction);
  else if(p.kind==='Lk'||p.kind==='Cl')f.special.link=beginLinkSpecial(f,p,f.link,input,common);
  else if(p.kind==='Ca'||p.kind==='Gn')beginFalconSpecial(f,direction);
  else if(p.kind==='Dk')beginDkSpecial(f,direction);
  else if(p.kind==='Mt')beginMewtwoSpecial(f,direction);
  else if(p.kind==='Pr')beginPurinSpecial(f,direction);
  else if(p.kind==='Ns')beginNessSpecial(f,direction);
  else if(p.kind==='Kp'||p.kind==='Gk')beginKoopaSpecial(f,direction);
  else if(p.kind==='Pe'||p.kind==='Da')beginPeachSpecial(f,direction);
  else if(p.kind==='Zx')beginZeroSpecial(f,direction);
  else if(p.kind==='Td')beginToadSpecial(f,direction);
  else if(p.kind==='Ts')beginTailsSpecial(f,direction);
  else if(p.kind==='Mk')beginMetaKnightSpecial(f,direction);
  else if(p.kind==='Sn')beginSonicSpecial(f,direction);
  else if(p.kind==='Rc')beginRaichuSpecial(f,direction);
  else if(p.kind==='Lz')beginLizardonSpecial(f,direction);
  else if(p.kind==='Wf')beginWolfSpecial(f,direction);
  else if(p.kind==='Dd')beginDiddySpecial(f,direction);
  else if(p.kind==='De')beginDededeSpecial(f,direction);
  else if(p.kind==='Wr')beginWarioSpecial(f,direction);
  else if(p.kind==='Sh')beginShadowSpecial(f,direction);
  else if(p.kind==='Bl')beginBlastoiseSpecial(f,direction);
  else if(p.kind==='Lc')beginLucasSpecial(f,direction);
  else if(p.kind==='Nm')beginMetalSpecial(f,direction);
  else if(p.kind==='Nt')beginNintenSpecial(f,direction);
  else if(p.kind==='Sm')beginMewtwoSpecial(f,direction);
  else if(p.kind==='Sd')beginSkullKidSpecial(f,direction);
  else if(p.kind==='Cn')beginChunLiSpecial(f,direction);
  else if(p.kind==='Fy')beginFaySpecial(f,direction);
  else if(p.kind==='Sc')beginBSonicSpecial(f,direction);
  else if(p.kind==='Kx')beginKnucklesSpecial(f,direction);
  else if(p.kind==='Lg'||p.kind==='Dl'||p.kind==='Lb')beginLuigiSpecial(f,direction);
  else if(p.kind==='Pp')beginPopoSpecial(f,direction);
  else if(p.kind==='Zd')beginZeldaSpecial(f,direction);
  else if(p.kind==='Sk')beginSeakSpecial(f,direction,input);
  else if(p.kind==='Gw')beginGamewatchSpecial(f,direction);
  else if(p.kind==='Ys')beginYoshiSpecial(f,direction);
  else if(p.kind==='custom'){
    requireCustomCharacter(f.content.profile.kind).specials.begin(f,direction,input);
  }else if(p.kind==='Fx'||p.kind==='Fc') {
    if(direction==='side') { f.velocity.x/=p.side.divisor;f.velocity.y=0;f.special.delay=p.side.delay;if(air)f.jumpsUsed=f.content.profile.attributes.maxJumps; }
    if(direction==='up') {f.velocity.x/=p.up.divisor;f.velocity.y=0;f.special.delay=p.up.delay;}
    if(direction==='down'){if(air){f.velocity.x/=p.down.divisor;f.velocity.y=0;}f.special.delay=p.down.delay;f.special.releaseLag=p.down.releaseLag;}
  } else {
    if(direction==='side'){if(air)f.velocity.x/=p.cape.divisor;else f.velocity.y=0;}
    if(direction==='up'){if(air){f.velocity.x*=p.up.momentum;f.velocity.y=0;}}
    if(direction==='down'){f.velocity.y=air?p.down.initial-(f.tornadoUsed?0:p.down.boost):0;f.velocity.x=Math.max(-p.down.airSpeed,Math.min(p.down.airSpeed,f.velocity.x));}
  }
  // A kind-begin may enter a non-start phase directly (full Oil Panic bucket
  // goes straight to its Shoot); only fresh specials take the start pose here.
  if (f.special.phase === 'start') phase(f,'start');
  if(f.special.link)f.animationRate=f.special.link.throwBomb?f.special.link.throwRate:1;
}export function command(f: MatchFighter,index:number):number {
  let value=0;
  for(const event of f.content.timelines.get(f.animation)?.events??[]) {if(event.frame>f.animationFrame)break;if(event.type==='command'&&event.index===index)value=event.value;}
  return value;
}
export function rootDelta(f: MatchFighter):{y:number;z:number} {
  const clip=f.content.clips.get(f.animation)!, tracks=clip.joints[f.content.profile.motionRoot]?.tracks??[];
  const value=(type:number,frame:number)=>{const t=tracks.find((track)=>track.type===type);return t?sampleTrack(t.keys,Math.max(0,Math.min(clip.endFrame,frame)))??0:0;};
  const scale=f.content.profile.attributes.modelScale, previous=f.animationFrame, current=previous+1;
  return {y:Math.fround((value(6,current)-value(6,previous))*scale),z:Math.fround((value(7,current)-value(7,previous))*scale)};
}
export function canShineJump(f:MatchFighter):boolean {
  if(f.content.profile.kind==='Wf'||f.content.profile.kind==='WfU')return wolfCanJump(f);
  return f.special?.direction==='down'&&(f.content.profile.kind==='Fx'||f.content.profile.kind==='Fc'||f.content.profile.kind==='Fy')&&['loop','hit'].includes(f.special.phase)&&(f.grounded||f.jumpsUsed<f.content.profile.attributes.maxJumps);
}
/** ftSs_SpecialLw_8012AEBC replaces the normal capsules with one ungrabbable Morph Ball sphere. */
export function fighterHurts(f: MatchFighter): import('./data.ts').HurtDefinition[] {
  if (f.content.profile.kind === 'Ss' && f.special?.direction === 'down' && command(f, 0) !== 0) return [{ bone: f.content.profile.partJoints[2]!, a: [0,0,0], b: [0,0,0], radius: 3, grabbable: false }];
  return f.content.profile.hurts;
}
export function hurtEnabled(f:MatchFighter,bone:number):boolean {
  if(f.state==='shield-break')return false; // ftCo_80098B20 sets whole-body state 2 until landing.
  let state=0,body=0;
  for(const event of f.content.timelines.get(f.animation)?.events??[]){if(event.frame>f.animationFrame)break;if(event.type==='hurt'&&(event.bone===null||event.bone===bone))state=event.state;if(event.type==='body-state')body=event.state;}
  return state===0&&body===0;
}
export function reflector(f:MatchFighter):ReflectorData|null {
  const s=f.special;if(!s)return null;const p=f.content.specials.parameters;
  if((p.kind==='Fx'||p.kind==='Fc'||p.kind==='Fy')&&s.direction==='down'&&['loop','hit'].includes(s.phase))return p.down.reflect;
  if(p.kind==='Wf')return wolfReflector(f);
  if((p.kind==='Mr'||p.kind==='Dr'||p.kind==='MM')&&s.direction==='side'&&command(f,1)===1)return p.cape.reflect;
  // ftMt_SpecialS_ReflectThink: Confusion's script toggles cmd var 1 between on (1) and off (2).
  if(p.kind==='Mt'&&s.direction==='side'&&command(f,1)===1)return p.side.reflect;
  // Metal Sonic's reflector (Fox's, xB0) is up in SpecialLwLoop/Hit.
  if(p.kind==='Nm')return metalReflector(f);
  // Nayru's Love latches on cmd0 (native promotes it to 2 and stays reflecting).
  if(p.kind==='Zd'&&s.direction==='neutral'&&s.zelda?.reflect)return p.neutral.reflect;
  return null;
}
/** Ness's bat reflect is attack-owned, not special-owned; combined with reflector() by callers. */
export function attackReflector(f:MatchFighter):ReflectorData|null {
  return nessBatReflector(f);
}
/** `from` is the reflected shot (the reflect_hit_cb turns Wolf toward it). */
export function reflectSpecial(f:MatchFighter,from?:{x:number}):void {
  if((f.content.profile.kind==='Fx'||f.content.profile.kind==='Fc'||f.content.profile.kind==='Fy')&&f.special?.direction==='down')phase(f,'hit');
  if(f.content.profile.kind==='Wf'||f.content.profile.kind==='WfU')reflectWolf(f,from);
  if(f.content.profile.kind==='Nm')reflectMetal(f);
}
export function syncSpecialAnimation(f:MatchFighter):void {
  const s=f.special;if(!s)return;
  if(s.direction==='up'&&(f.content.profile.kind==='Mr'||f.content.profile.kind==='Dr'||f.content.profile.kind==='MM'||f.content.profile.kind==='Fe'||f.content.profile.kind==='Ms'||f.content.profile.kind==='Lu'))return;
  f.animation=phaseName(f,s.direction,s.phase);f.attackName=luigiAttackName(f)??f.animation;
}
/** `floor` is the segment the fighter just landed on (Metal Sonic's firefox reads its normal). */
export function landSpecial(f:MatchFighter,floor?:Floor):boolean {
  const s=f.special;if(!s)return false;const p=f.content.specials.parameters;
  if(p.kind==='Fe'||p.kind==='Ms'||p.kind==='Lu') {
    if(s.direction==='up'){finishSpecial(f);f.state='landing';f.animation='Landing';f.landingFrames=p.up.landing;}
    else {f.animation=phaseName(f,s.direction,s.phase);f.attackName=f.animation;}
    return true;
  }
  if(p.kind==='Ss') {
    if(s.direction==='up'){finishSpecial(f);f.state='landing';f.animation='Landing';f.landingFrames=p.up.landing;}
    else if(s.direction==='side')finishSpecial(f);
    else {f.animation=phaseName(f,s.direction,s.phase);f.attackName=f.animation;}
    return true;
  }
  if(p.kind==='Pk'||p.kind==='Pc')return landPikachuSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Kb')return landKirbySpecial(f,()=>finishSpecial(f));
  if(p.kind==='Lk'||p.kind==='Cl')return landLinkSpecial(f,p,s.link!,()=>finishSpecial(f));
  if(p.kind==='Ca'||p.kind==='Gn')return landFalconSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Dk')return landDkSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Mt')return landMewtwoSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Pr')return landPurinSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Ns')return landNessSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Kp'||p.kind==='Gk')return landKoopaSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Pe'||p.kind==='Da')return landPeachSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Zx')return landZeroSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Td')return landToadSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Ts')return landTailsSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Mk')return landMetaKnightSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Sn')return landSonicSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Rc')return landRaichuSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Lz')return landLizardonSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Wf')return landWolfSpecial(f,()=>finishSpecial(f),floor);
  if(p.kind==='Dd')return landDiddySpecial(f,()=>finishSpecial(f));
  if(p.kind==='De')return landDededeSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Wr')return landWarioSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Sh')return landShadowSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Bl')return landBlastoiseSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Lc')return landLucasSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Nm')return landMetalSpecial(f,()=>finishSpecial(f),floor);
  if(p.kind==='Nt')return landNintenSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Sm')return landMewtwoSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Sd')return landSkullKidSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Cn')return landChunLiSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Fy')return landFaySpecial(f,()=>finishSpecial(f));
  if(p.kind==='Sc')return landBSonicSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Kx')return landKnucklesSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Lg'||p.kind==='Dl'||p.kind==='Lb')return landLuigiSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Pp')return landPopoSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Zd')return landZeldaSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Sk')return landSeakSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Gw')return landGamewatchSpecial(f,()=>finishSpecial(f));
  if(p.kind==='Ys')return landYoshiSpecial(f,()=>finishSpecial(f));
  if(p.kind==='custom')return requireCustomCharacter(f.content.profile.kind).specials.land(f,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if((p.kind==='Fx'||p.kind==='Fc')&&s.direction==='up') {
    // ftFx_SpecialHiHold(Air)_Anim charges into the launch; an airborne travel
    // slides until its frames run out (prototype: landing cuts straight to the
    // ground end); the air end lands into SpecialHiLanding from frame 13.
    if(s.phase==='travel'){phase(f,'end');return true;}
    if(s.phase==='end'&&f.animation==='SpecialHiFall'){phase(f,'end');f.animationFrame=13;return true;}
    f.animation=phaseName(f,s.direction,s.phase);f.attackName=f.animation;return true;
  }
  if((s.direction==='up')||((p.kind==='Fx'||p.kind==='Fc')&&s.direction==='side'&&s.phase==='end')) {
    const lag=(p.kind==='Fx'||p.kind==='Fc')?(s.direction==='up'?p.up.landing:p.side.landing):(p.kind==='Mr'||p.kind==='Dr'||p.kind==='MM'?p.up.landing:(p as {up:{landing:number}}).up.landing);
    finishSpecial(f);f.state='landing';f.animation='Landing';f.landingFrames=Math.ceil(lag);return true;
  }
  f.animation=phaseName(f,s.direction,s.phase);f.attackName=f.animation;return true;
}

export function stepSpecial(f:MatchFighter,input:PlayerInput,pressed:boolean,physics:MeleePhysics,dodge:CombatData['dodge'],world?:SpecialWorld):SpecialStep {
  const result:SpecialStep={handled:false,shots:[],sounds:[]};
  const s=f.special;if(!s)return result;
  const p=f.content.specials.parameters,attrs=f.content.profile.attributes;
  if(p.kind==='Fe'||p.kind==='Ms'||p.kind==='Lu')return stepRoySpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Pk'||p.kind==='Pc')return stepPikachuSpecial(f,input,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Ss')return stepSamusSpecial(f,input,pressed,physics,dodge,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='custom')return requireCustomCharacter(f.content.profile.kind).specials.step(f,input,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Kb')return stepKirbySpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Lk'||p.kind==='Cl')return stepLinkSpecial(f,p,s.link!,f.link,input,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Ca'||p.kind==='Gn')return stepFalconSpecial(f,input,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Dk')return stepDkSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Mt')return stepMewtwoSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Pr')return stepPurinSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Ns')return stepNessSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Kp'||p.kind==='Gk')return stepKoopaSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Pe'||p.kind==='Da')return stepPeachSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Zx')return stepZeroSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Td')return stepToadSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Ts')return stepTailsSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Mk')return stepMetaKnightSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Sn')return stepSonicSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Rc')return stepRaichuSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Lz')return stepLizardonSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Wf')return stepWolfSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Dd')return stepDiddySpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='De')return stepDededeSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Wr')return stepWarioSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Sh')return stepShadowSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Bl')return stepBlastoiseSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Lc')return stepLucasSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Nm')return stepMetalSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Nt')return stepNintenSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Sm')return stepMewtwoSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Sd')return stepSkullKidSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Cn')return stepChunLiSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Fy')return stepFaySpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Sc')return stepBSonicSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Kx')return stepKnucklesSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility),world);
  if(p.kind==='Lg'||p.kind==='Dl'||p.kind==='Lb')return stepLuigiSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Pp')return stepPopoSpecial(f,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Zd')return stepZeldaSpecial(f,input,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Sk')return stepSeakSpecial(f,input,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Gw')return stepGamewatchSpecial(f,input,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  if(p.kind==='Ys')return stepYoshiSpecial(f,input,pressed,physics,(helpless,lag,mobility)=>finishSpecial(f,helpless,lag,mobility));
  s.age++;
  if(!input.special)s.released=true;
  if(pressed&&s.age>1&&s.direction==='neutral'&&(p.kind==='Fx'||p.kind==='Fc')&&command(f,0)!==0)s.queued=true;
  if((p.kind==='Fx'||p.kind==='Fc')&&s.direction==='side'&&s.phase==='travel'&&pressed){phase(f,'end');f.velocity.x=f.facing*(f.grounded?p.side.endGround:p.side.endAir);s.delay=p.side.endDelay;}
  const length=f.content.clips.get(f.animation)!.endFrame;
  const end=f.animationFrame>=Math.max(1,length);
  if(p.kind==='Fx'||p.kind==='Fc') {
    if(s.direction==='neutral'&&end){
      if(s.phase==='start')phase(f,'loop');
      else if(s.phase==='loop'){if(s.queued){s.queued=false;phase(f,'loop');}else phase(f,'end');}
      else {finishSpecial(f);return result;}
    } else if(s.direction==='side'&&end) {
      if(s.phase==='start')phase(f,'travel');
      else if(s.phase==='travel'){phase(f,'end');f.velocity.x=f.facing*(f.grounded?p.side.endGround:p.side.endAir);s.delay=p.side.endDelay;}
      else {finishSpecial(f,!f.grounded,p.side.landing,p.side.mobility);return result;}
    } else if(s.direction==='up') {
      if(s.phase==='start'&&end){
        const x=input.x,y=input.y??0; s.aim=Math.abs(x)+Math.abs(y)>=p.up.aimThreshold?Math.atan2(y,x):Math.PI/2;
        if(Math.abs(x)>.125)f.facing=x>0?1:-1;
        phase(f,'travel');f.grounded=false;f.floor=null;f.jumpsUsed=attrs.maxJumps;
        f.velocity=physics.motion(f.slot,p.up.speed,0,1,s.aim);
      } else if(s.phase==='travel'&&f.stateFrame>=p.up.frames){phase(f,'end');return result;}
      else if(s.phase==='end'&&end){if(f.grounded){finishSpecial(f);return result;}finishSpecial(f,true,p.up.landing,p.up.mobility);return result;}
      else if(s.phase==='hit'&&end){if(f.grounded){finishSpecial(f);return result;}finishSpecial(f,true,p.up.landing,p.up.mobility);return result;}
    } else if(s.direction==='down') {
      if(s.phase==='start'&&end)phase(f,'loop');
      else if(s.phase==='hit'&&end)phase(f,'loop');
      else if(s.phase==='end'&&end){finishSpecial(f);return result;}
      else if(s.phase==='loop'){
        s.releaseLag=Math.max(0,s.releaseLag-1);
        if(s.released&&s.releaseLag===0)phase(f,'end');
        else if(end)phase(f,'loop');
        if(input.x&&s.phase==='loop')f.facing=input.x>0?1:-1;
      }
    }
  } else if(end) {
    if(s.direction==='up')finishSpecial(f,true,p.up.landing,p.up.mobility);
    else {if(s.direction==='down'&&!f.grounded)f.tornadoUsed=true;finishSpecial(f,false);}
    return result;
  }
  const events:MoveEvent[]=(f.content.timelines.get(f.animation)?.events??[]).filter((e)=>e.frame>s.lastFrame&&e.frame<=f.animationFrame);
  s.lastFrame=f.animationFrame;
  if(p.kind==='Fx'||p.kind==='Fc') {
    if(s.direction==='neutral') {
      if(events.some((e)=>e.type==='command'&&e.index===2&&e.value===1)) {result.shots.push({player:f.slot,kind:'laser'});result.sounds.push(p.kind==='Fc'?(f.facing>0?100099:100102):(f.facing>0?110103:110106));}
    } else if(s.direction==='side') {
      result.handled=true;
      if(s.phase==='travel'){const delta=rootDelta(f);f.velocity=physics.motion(f.slot,delta.z,delta.y,f.facing);}
      else if(f.grounded){f.velocity={x:physics.customAir(f.slot,{x:f.velocity.x,y:0},0,attrs.terminal,s.phase==='end'?p.side.endFriction:attrs.friction).x,y:0};}
      else {const gravity=s.delay>0?0:(s.phase==='end'?p.side.endGravity:p.side.gravity);s.delay=Math.max(0,s.delay-1);f.velocity=physics.customAir(f.slot,f.velocity,gravity,attrs.terminal,s.phase==='end'?p.side.endAirFriction:p.side.friction);}
    } else if(s.direction==='up') {
      result.handled=true;
      if(s.phase==='start') {const gravity=!f.grounded&&s.delay<=0?p.up.gravity:0;s.delay=Math.max(0,s.delay-1);f.velocity=physics.customAir(f.slot,f.velocity,gravity,attrs.terminal,f.grounded?attrs.friction:p.up.friction);if(f.grounded)f.velocity.y=0;}
      else if(s.phase==='travel'){if(f.stateFrame>=p.up.slowAfter){const decay=physics.motion(f.slot,p.up.decay,0,1,s.aim);f.velocity.x=Math.fround(f.velocity.x-decay.x);f.velocity.y=Math.fround(f.velocity.y-decay.y);}}
      else if(s.phase==='end'){if(f.grounded){f.velocity={x:physics.customAir(f.slot,{x:f.velocity.x,y:0},0,attrs.terminal,attrs.friction).x,y:0};}else{f.velocity=physics.customAir(f.slot,f.velocity,attrs.gravity,attrs.terminal,attrs.airFriction);}}
      else{f.velocity=physics.customAir(f.slot,f.velocity,f.grounded?0:attrs.gravity,attrs.terminal,f.grounded?attrs.friction:attrs.airFriction);if(f.grounded)f.velocity.y=0;}
    } else {
      result.handled=true;
      const gravity=!f.grounded&&s.delay<=0?p.down.gravity:0;s.delay=Math.max(0,s.delay-1);
      f.velocity=physics.customAir(f.slot,f.velocity,gravity,attrs.terminal,f.grounded?attrs.friction:attrs.airFriction);
      if(f.grounded)f.velocity.y=0;
    }
  } else {
    if(s.direction==='neutral') {if(events.some((e)=>e.type==='flag'&&e.flag===24))result.shots.push({player:f.slot,kind:'fireball'});}
    else if(s.direction==='side') {
      result.handled=true;
      if(!f.grounded&&events.some((e)=>e.type==='command'&&e.index===0&&e.value===1)){f.velocity.y=f.capeBoostUsed?0:p.cape.boost;f.capeBoostUsed=true;}
      // ftMr_SpecialS_Phys lb_800119DC wind + itMariocape 1149/1150 sparkles at HipN+3
      // when cmd0 goes 1->2 (script CMD0=1 at f11). Prototype: one-shot fighter-bank
      // generator at HipN (part 4) so the swipe dumps dust on Mario (ground 1008/air 1009).
      if(events.some((e)=>e.type==='command'&&e.index===0&&e.value===1)){(result.effects??=[]).push({effect:f.grounded?6008:6009,part:4});}
      const active=command(f,0)>=1;
      f.velocity=physics.customAir(f.slot,f.velocity,f.grounded?0:active?p.cape.gravity:attrs.gravity,active?p.cape.terminal:attrs.terminal,f.grounded?attrs.friction:p.cape.friction);
      if(f.grounded)f.velocity.y=0;
    } else if(s.direction==='up') {
      result.handled=true;
      if(command(f,0)===0&&Math.abs(input.x)>p.up.aimThreshold) {
        const angle=p.up.angle*((Math.abs(input.x)-p.up.aimThreshold)/(1-p.up.aimThreshold))*Math.PI/180;
        if(Math.abs(angle)>Math.abs(s.aim===Math.PI/2?0:s.aim))s.aim=input.x>0?-angle:angle;
      }
      if(events.some((e)=>e.type==='flag'&&e.flag===20)&&Math.abs(input.x)>p.up.reverseThreshold)f.facing=input.x>0?1:-1;
      if(events.some((e)=>e.type==='flag'&&e.flag===101)||command(f,0)!==0){f.grounded=false;f.floor=null;f.jumpsUsed=attrs.maxJumps;}
      const delta=rootDelta(f), angle=s.aim===Math.PI/2?0:s.aim;
      if(!s.startedAir||command(f,0)!==0)f.velocity=physics.motion(f.slot,delta.z,delta.y,f.facing,angle,s.startedAir?p.up.airScale:1);
      else f.velocity=physics.customAir(f.slot,f.velocity,p.up.gravity,attrs.terminal,0);
      if(f.velocity.y>0.01){f.grounded=false;f.floor=null;}
    } else {
      result.handled=true;
      if(events.some((e)=>e.type==='command'&&e.index===1&&e.value===1)&&!f.grounded)f.tornadoUsed=true;
      if(pressed&&command(f,2)!==0&&!f.tornadoUsed){f.velocity=physics.ascend(f.slot,f.velocity,p.down.boost,p.down.cap);f.grounded=false;f.floor=null;}
      if(command(f,0)!==0)s.driftLimit-=p.down.endFriction;
      const maximum=Math.max(0,(f.grounded?p.down.groundSpeed:p.down.airSpeed)+s.driftLimit);
      f.velocity=physics.drift(f.slot,f.velocity,input.x,f.grounded?p.down.groundAccel:p.down.airAccel,maximum);
      if(!f.grounded)f.velocity=physics.customAir(f.slot,f.velocity,attrs.gravity,attrs.terminal,0);else f.velocity.y=0;
      // PROTOTYPE vortex containment (ftMr_SpecialLw has no suction in C; the original
      // juggles via low-knockback loop hits). Pull nearby rivals toward the tornado
      // centre (f.x, f.y+7, the script offset) so loop victims stay inside for the
      // f38 launcher instead of sliding through. Deterministic, teams-aware.
      if(world){for(const other of world.fighters){if(other===f||other.state==='ko'||other.state==='respawn')continue;if(world.teams&&world.teamOf(other)===world.teamOf(f))continue;const dx=f.x-other.x,dy=(f.y+7)-other.y,dist=Math.hypot(dx,dy);if(dist<14&&dist>0.01){const pull=0.9;other.x=Math.fround(other.x+dx/dist*pull);other.y=Math.fround(other.y+dy/dist*pull*0.6);}}}
    }
  }
  return result;
}
