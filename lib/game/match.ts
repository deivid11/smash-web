import type { GameContent, FighterContent } from './load.ts';
import { profiler } from '../perf/profiler.ts';
import type { V3 } from '../hsd/model.ts';
import { pikachuHits, pikachuHitLanded } from './pikachu.ts';
import { activeHits, type ActiveHit, type HitDefinition } from './moves.ts';
import { beginSpecial, canShineJump, finishSpecial, hurtEnabled, fighterHurts, landSpecial, rootDelta, selectSpecial, specialHits, specialInterruptible, specialStopsAtLedge, stepSpecial, syncSpecialAnimation, type SpecialRuntime, type ShotIntent, type ProjectileKind } from './specials.ts';
import { airJumpAllowed, beginAirJump, stepAirJump, stoneAbsorb, kirbyIgnoresLanding, isInhaling, inhaleWalking, loseCopyAbility, kirbyCopyHits, KIRBY_EAT_WALKS } from './kirby.ts';
import type { FighterKind } from './data.ts';
import type { SpecialDirection } from './special-data.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { ProjectileWorld, type ProjectileState } from './projectiles.ts';
import { hitSound } from './audio.ts';
import { beginJab, captureJabInput, stepJab, type JabRuntime } from './jab.ts';
import { commandFrame, commandValue, hasMeleeRun, locomotionLoops, maxRunBrakeFrames, RUN_BRAKE_STICK, RUN_TURN_STICK, skidOwnsFacing, turnRunStartFacing } from './locomotion.ts';
import { CombatController, createCombat, shieldBubble, type CombatRuntime } from './combat.ts';
import { beginSmash, stepSmash, chargedHits, type SmashRuntime } from './smash.ts';
import { cStickActive, cStickEdge, smashHeld } from './smash-stick.ts';
import { royHits, royCounter, triggerRoyCounter } from './roy.ts';
import { seakHits } from './seak.ts';
import { gwShootHits } from './gamewatch.ts';
import { luigiHits, luigiHitLanded } from './luigi.ts';
import { dkHits, cargoWalking } from './dk.ts';
import { falconRaptorDetect, triggerFalconRaptor, falconDiveActive, beginFalconDiveCatch, falconKickHitLanded } from './falcon.ts';
import { aerialLanding, isLink, linkInterruptInput, retimeAerialLanding, retimeLinkLanding, updatePassiveLinkShield } from './link-actions.ts';
import { stepHookshot, stepTether, type HookHost } from './link-hookshot.ts';
import { handleItemInput, stepItemAnimation } from './items.ts';
import { ItemWorld, type ItemWorldState } from './item-engine.ts';
import { fxActive, newItemFx, scaledDamage, scaledKnockback, statusWords, type ItemFx } from './item-status.ts';
import { createLinkState, canLinkSmashFollowup, linkHitLanded, linkHits, resetLinkDair, stepLinkDair, type LinkFighterRuntime } from './link.ts';
import { customCharacter, customInitialState } from '../custom/registry.ts';
import type { CustomState } from '../custom/types.ts';
import { purinHits, purinHitLanded } from './purin.ts';
import { koopaKlawActive, beginKoopaKlawCatch } from './koopa.ts';
import { refuelLizardon, resetLizardonFuel } from './lizardon.ts';
import { bsonicFallLocked, bsonicHitLanded, bsonicOnLanding, bsonicStateChange, createBSonicVars, type BSonicFighterVars } from './bsonic.ts';
import { createSkullKidVars, enterSkullKidFloat, skullkidFloatVelocity, skullkidOnFrame, skullkidOnLanding, stepSkullKidFloat, type SkullKidFighterVars } from './sd.ts';
import { yoshiEggActive, beginYoshiEgg } from './yoshi.ts';
import { wolfHitLanded } from './wolf.ts';
import { beginDiddyCling, diddyAnimRate, diddyFlipActive, stepTrip, tripFrames, type TripState } from './diddy.ts';
import { DIDDY_BANANA } from './diddy-data.ts';
import { peachToadCounter, triggerPeachToad, peachSmashName, stepPeachFloat, peachThrowTurnip, peachBomberDetect } from './peach.ts';
import { warioBashDetect } from './wario.ts';
import { tailsOnLanding, tailsOnInterrupted } from './tails.ts';
import { pointSegmentDistanceSquared } from './collision.ts';
export { pointSegmentDistanceSquared } from './collision.ts';
import { initialNanaState, stepNanaState, nanaStrikeHit, NANA_ANCHOR_BACK, NANA_MIN_TUMBLE, type NanaState } from './nana.ts';
import type { Velocity } from './physics.ts';
import { floorY, MAX_FLOOR_SLOPE, type Floor, type StageGameplayData } from './data.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from './limits.ts';
import { matchSpawnPoints } from './spawns.ts';
import { HILL_CAPTURE_DY, HILL_POINT_EVERY, hillHalfWidth, hillLeader, hillTeamOfSlot, makeHillState, relocateHillZones, scoreHillTick, stepHillCapture, validHillSetup, type HillSetup, type HillState } from './hill.ts';
import { floorChains } from './cpu-nav.ts';
import type { StageSurface } from './data.ts';
import { createStadiumRuntime, stadiumStageAt, stepStadium, type StadiumRuntime } from './stadium.ts';
import { createMuteCityRuntime, MUTE_CITY_ANIM_FRAMES, muteCityDeckSurfaces, muteCityPhaseKey, stepMuteCity, type MuteCityRuntime } from './mutecity.ts';
import { createOnettRuntime, onettAwningTouch, onettBuildingHit, onettCarHitReact, stepOnettAwnings, stepOnettBuilding, stepOnettCars, ONETT_ROOFTOP_IDS, type OnettRuntime } from './onett.ts';
import { createGreensRuntime, stepGreens, greensFloors, greensSurfaces, greensBlockAt, greensBlockForCeiling, removeGreensBlock, greensNeighbors, GREENS_WIND_SPEED, GREENS_WIND_LEFT, GREENS_WIND_RIGHT, GREENS_WIND_TOP, GREENS_WIND_BOTTOM, type GreensRuntime } from './greens.ts';
import { createPeachBillRuntime, detonatePeachBill, stepPeachBill, type PeachBillRuntime } from './peach-bill.ts';
import { itemKind } from './item-kinds.ts';
import type { PlayerControllerMode } from './setup.ts';
import { clampCpuLevel, cpuInput, createCpuBrain, DEFAULT_CPU_LEVEL, isCpuLevel, type CpuBrain, type CpuLevel } from './cpu.ts';
import { NEUTRAL_ROGUE_MODS, POISON_TICK_EVERY, rogueAfterHit, rogueAllied, rogueDefy, rogueEssentialOut, rogueHitScale, rogueMoveMul, rogueOnKo, rogueTick, rogueVenom, type RogueFx, type RogueHex, type RogueMods, type RoguePoison } from './roguelike/sim.ts';

export interface PlayerInput { x: number; jump: boolean; attack: boolean; strong: boolean; down: boolean; y?: number; special?: boolean; specialDirection?: SpecialDirection; shield?: boolean; grab?: boolean; walk?: boolean;
  /** C-stick (right stick) vector: x right, y up, unit circle. Smash-only: it fires
   * and charges smash attacks with its own direction (see `lib/game/smash-stick.ts`)
   * and never moves the fighter, tap-jumps, fast-falls or steers specials. */
  cX?: number; cY?: number }
export const neutralInput = (): PlayerInput => ({ x: 0, y: 0, jump: false, attack: false, strong: false, down: false, special: false, cX: 0, cY: 0 });
export type FighterState = 'idle' | 'walk' | 'run' | 'crouch' | 'squat' | 'jump' | 'airjump' | 'fall' | 'attack' | 'landing' | 'hitstun' | 'ko' | 'respawn' | 'special' | 'helpless' | 'shield' | 'dodge' | 'air-dodge' | 'grab' | 'holding' | 'captured' | 'throw' | 'grab-release' | 'ledge' | 'ledge-action' | 'ledge-jump' | 'shield-break' | 'dizzy' | 'tether' | 'item-throw' | 'item-pickup' | 'bury' | 'frozen';
/** PROTOTYPE (roguelike): per-fighter boon modifiers, hexes and hit hooks for Rift
 * Descent live in `lib/game/roguelike/sim.ts`. Neutral by default so versus play is
 * unchanged; the wrapper in `lib/game/roguelike/apply.ts` assigns them post-countdown.
 * Plain snapshot-owned data (see `captureState`), never original fighter state and
 * never a claim about Melee mechanics. */
export { NEUTRAL_ROGUE_MODS, POISON_TICK_EVERY, type RogueFx, type RogueHex, type RogueMods, type RoguePoison } from './roguelike/sim.ts';
export interface MatchFighter {
  /** Installed-pack mutable state: included in full snapshots and canonical hashes. */
  customState: CustomState | null;
  slot: number; readonly seatId: number; content: FighterContent; x: number; y: number; velocity: Velocity; knockback: Velocity;
  grounded: boolean; floor: number | null; facing: number; state: FighterState; stateFrame: number;
  animation: string; animationFrame: number; animationRate:number; combat:CombatRuntime; attackName: string | null; attackSerial: number;
  percent: number; stocks: number; jumpsUsed: number; hitlag: number; hitstun: number; invulnerable: number;
  shortHop: boolean; fastFall: boolean; downWindow: number; ignoreFloor: number | null; ignoreTicks: number;
  landingFrames: number; previous: PlayerInput; victims: Set<string>;
  /** ftMars fighter var x222C: side-special aerial boost is once per airtime. */
  roySideBoostUsed: boolean;
  special: SpecialRuntime | null; specialSerial: number; animationEpoch: number; specialLandingLag: number; specialMobility: number;
  capeBoostUsed: boolean; tornadoUsed: boolean; jab: JabRuntime | null; smash:SmashRuntime|null;
  /** Ice Shot hover stall is once per airtime (x224C latch). */
  popoHoverUsed: boolean;
  /** Nana partner state (Ice Climbers duo). Null for every other fighter and
   * for solo Popo while no partner model is loaded. Snapshot-owned plain data. */
  nana: NanaState | null;
  /** Multi-jump turn countdown (ft_800CB6EC) and Kirby's once-per-airtime hammer boost (ftKb_SpecialAirS_Enter). */
  airJumpTurn: number; hammerBoostUsed: boolean;
  /** Kirby's copied ability (ftKb_Hat.kind); null means no hat. Lost on KO. */
  copyAbility: FighterKind | null;
  /** Samus stored charge and horizontal-stick age; authoritative and snapshot-owned. */
  samusCharge: number; samusSideTicks: number;
  /** Stored Needle Storm charge 0-6 (persists across cancels, lost on hit/KO). */
  sheikNeedles: number;
  /** Oil Panic charge 0-3+, stored damage, Judgment and Chef last-two memories and the
   * once-per-airtime Judgment hop (x2234). ftGw_Init_OnDeath runs at spawn and on every
   * KO: oil empty, Judgment {1,0}, Chef {1,3}, hop available. */
  gwOil: number; gwOilDamage: number; gwJudge1: number; gwJudge2: number; gwChefA: number; gwChefB: number; gwJudgeHop: boolean;
  /** Donkey Kong fighter var x222C: banked Giant Punch arm swings; kept when interrupted, lost on KO. */
  dkPunchCharge: number;
  /** Sonic ft_var2: the spin-dash charge a full SpecialSHold banks for the next side special. */
  sonicCharge: number;
  /** Knuckles ft_var9: the airtime's one glide is spent (cleared by his OnLanding). */
  glideUsed: boolean;
  /** Black Sonic ft_var50/49/51 once-per-airtime special latches and ft_var43 (his spring is out). */
  bsonic: BSonicFighterVars;
  /** Skull Kid's bomb ammo/cooldown/live bomb, float and aerial-special latches (lib/game/sd.ts). */
  skullkid: SkullKidFighterVars;
  /** Surfaces this frame's movement ran into (coll_data env flags): wall side (-1 left, 1 right)
   * and ceiling. Specials whose native Coll reacts to walls read it on their next step. */
  envContact: { wall: number; ceiling: boolean } | null;
  /** Mewtwo fighter vars: stored Shadow Ball charge (x2234, only a full ball survives hits)
   * and the once-per-airtime Confusion boost (x223C). */
  mewtwoCharge: number; mewtwoBoostUsed: boolean;
  /** Bowser's Fire Breath pool (ftKoopa_FighterVars x222C); recovers outside the special. */
  koopaBreath: number;
  /** Charizard's flame pools (PlLz ft_var1/ft_var2): speed and size of each flame. RefuelFire
   * refills them every frame outside the flamethrower; OnRespawn fills them. */
  lizardonFuel: { speed: number; size: number };
  /** Tails' helicopter fuel burnt since the last landing (PlTs ft_var32 = x3C − this). */
  tailsFuelUsed: number;
  /** Peach: held turnip face (null when empty), float clock and the last drawn weapon smash. */
  peachTurnip: number | null; peachFloat: { available: boolean; timer: number }; peachLastSmash: number;
  /** Link/Young Link held-item ids, smash-throw stick age and dair rebound latch; snapshot-owned. */
  link: LinkFighterRuntime;
  /** Held match-item id (lib/game/item-engine.ts); null when empty-handed. Snapshot-owned. */
  heldItem: number | null;
  /** Item motion states: the Hammer lock and the Warp Star ride. Snapshot-owned. */
  itemStatus: { kind: import('./item-engine.ts').ItemStatusKind; timer: number;
    /** Warp Star ride (ftCo_WarpStar.c): flight path, frames on it, dive phase, launch x, facing. */
    path?: number; frame?: number; fall?: boolean; ox?: number; facing?: number } | null;
  /** Stacking item effects (Bunny Hood, Metal Box, mushroom size, Cloaking Device), applied to
   * the WASM attribute block by ftCo_800D105C's modifier tables (lib/game/item-status.ts). */
  itemFx: ItemFx | null;
  /** ftCo_Bury: ground-element burial. The pose freezes and sinks `sink` per frame for `frames`
   * ticks; `depth` is the accumulated offset below the floor and `timer` the mash-out countdown. */
  bury: { depth: number; sink: number; frames: number; timer: number } | null;
  /** ftCo_DamageIce mv block: the mash-out timer, the block's random spin per air frame and the
   * angle it has turned so far (presentation reads the angle; the sim owns all three). */
  ice: { timer: number; spin: number; angle: number } | null;
  /** PlDd banana Trip_Enter/Trip_Anim on this fighter (MissFoot → DownBoundU → DownStandU inside
   * hitstun); any other state change clears it. */
  trip: TripState | null;
  /** ftCo_Damage recovery inputs: `jumpAt` is the hitstun left at the last jump pressed during
   * hitstun (mv.co.damage.x14, 0 = none), `meteorLock` the meteor-cancel lockout (x1B, -1 when
   * the launch is not a meteor), `jumpAge`/`upSpecialAge` the frames since the last jump /
   * up-special press (fp x685 / x686, capped at 255). Snapshot-owned. */
  hitstunInput: { jumpAt: number; meteorLock: number; jumpAge: number; upSpecialAge: number };
  /** PROTOTYPE (roguelike): boon modifiers + venom DoT. Neutral/null outside Rift Descent. */
  rogue: RogueMods; poison: RoguePoison | null; hex: RogueHex | null;
  /** PROTOTYPE (zombies): infection side. False in every other mode; snapshot-owned. */
  infected: boolean;
  /** Results-screen stats (prototype-owned, snapshot-covered): credited KOs,
   * lost stocks, total damage dealt and the last damaging attacker for KO credit. */
  kos: number; falls: number; damageDealt: number; lastHitBy: number | null;
}
/** Pose caches must be derived solely from the supplied fighter and immutable
 * content. Restore calls sample for every slot; rendering must not affect physics. */
export interface PoseProvider {
  sample(fighter: MatchFighter, prepareDraws?:boolean): void;
  /** Monotonic derived-pose revision, when supported by the provider. */
  revision?(fighter:MatchFighter):number;
  /** Nana's joint point for duo hit/hurt tests. Absent on stub providers, in
   * which case the match silently plays solo Popo (no echo, no Nana victims). */
  partnerPoint?(fighter:MatchFighter,bone:number,offset:V3):V3;
  point(fighter: MatchFighter, bone: number, offset: V3): V3;
}
export interface MatchEvent { type: 'gfx' | 'jump' | 'hit' | 'ko' | 'infect' | 'respawn' | 'end' | 'sound' | 'shot' | 'reflect' | 'bounce' | 'cape' | 'shield' | 'shield-break' | 'grab' | 'throw' | 'ledge' | 'counter' | 'transform' | 'rogue'; player: number; x: number; y: number; damage?: number; sound?: number; volume?: number; pan?: number; scope?: number; projectileKind?: ProjectileKind; element?: number; effect?:number; facing?:number; knockback?:number; /** Hitbox sound severity (ftColl sfx_severity): >=1 may add the random 1007 sparkle. */ severity?:number; floorAngle?:number; /** Script gfx: the resolved joint and offset, for effects that ride their bone. */ bone?:number; offset?:readonly [number,number,number]; kind?: FighterKind; /** PROTOTYPE (roguelike): HUD popup trigger on `rogue` events. */ rogue?: RogueFx }
/** Diagnostic ground-loss trail (prototype only, never hashed): each grounded->airborne
 * support loss with position/floor/reason, so a phantom fall can be reported verbatim
 * as `stage f123 P1 Name (x,y) floor 5 -> air [walk-off]` and reproduced. */
export interface GroundLossEntry { frame: number; player: number; name: string; x: number; y: number; floor: number | null; reason: 'walk-off' | 'drop' | 'chain-gap' | 'lost-support' | 'drop-through'; stage: string; detail: string }
/** Latest ground-loss entries kept per match; bounded so the log cannot grow without limit. */
export const MAX_GROUND_LOSS_ENTRIES = 50;
/** PlCo ftCommonData hitstun recovery values (NTSC 1.02), for content without the parsed table. */
const HITSTUN_RECOVERY = { jumpBuffer: 20, pressGap: 40, meteorAngleMin: 260, meteorAngleMax: 280, meteorLockout: 8 } as const;
/** PROTOTYPE (zombies): horde tuning. The infected hit harder and take more —
 * pressure over durability, on top of original damage/knockback coupling. */
export const ZOMBIE_DEALT_MUL = 1.2;
export const ZOMBIE_TAKEN_MUL = 1.15;
/** Zombies-mode result from live standings: patient zero takes a horde win,
 * otherwise the top clean survivor (versus tiebreak); null only on exact ties
 * or with no result yet. Pure so unit tests pin it without booting a match. */
export function zombieWinner(fighters: ReadonlyArray<Pick<MatchFighter, 'slot' | 'stocks' | 'percent' | 'infected'>>, firstInfected: number | null): number | null {
  const survivors = fighters.filter(fighter => !fighter.infected && fighter.stocks > 0)
    .sort((a, b) => b.stocks - a.stocks || a.percent - b.percent || a.slot - b.slot);
  if (survivors.length === 0) return firstInfected;
  const best = survivors[0]!, second = survivors[1];
  return second !== undefined && best.stocks === second.stocks && best.percent === second.percent ? null : best.slot;
}
/** Yoshi's Island nine blocks (prototype per-block model over gryorster.c areas 1-9).
 * Areas 1-3 are the center bridge row (8.5x8.5 boxes baked flush with the island:
 * floors 10-12 at y=0, ceilings 22-24 underneath at y=-8.5, walls on their sides);
 * areas 4-9 are the six elevated side blocks (floors 13-18 at y=42.5, ceilings
 * 25-30 at y=34). The original spins each block independently when its accumulated
 * contact force passes the yakumono thresholds and disables that joint's collision
 * mid-spin (mpLib_80057BC0, restored with mpJointListAdd); the prototype triggers
 * each block on a direct bump/strike/shot/item contact with the original 323-frame
 * (0x143) spin timing, without force accumulation, block damage or the return flight. */
export const YOSHI_SPIN_FRAMES = 323;
export const YOSHI_BLOCK_COUNT = 9;
/** Floor id per block in area order (0-2 center bridge, 3-8 elevated sides). */
const YOSHI_BLOCK_FLOORS = [10, 11, 12, 13, 14, 15, 16, 17, 18];
/** [ceiling, wall, wall] surface ids per block in area order. */
const YOSHI_BLOCK_SURFACES: ReadonlyArray<readonly [number, number, number]> = [
  [22, 34, 45], [23, 35, 46], [24, 36, 47], [25, 37, 48], [26, 38, 49],
  [27, 39, 50], [28, 40, 51], [29, 41, 52], [30, 42, 53],
];
/** GrYt map-root-1 joint index per block (areas 1-3 map to the center joints
 * 13/14/15, areas 4-9 to the side joints 10/11/12/16/17/18). */
export const YOSHI_BLOCK_JOINTS = [13, 14, 15, 10, 11, 12, 16, 17, 18];
/** World-space block boxes [centerX, topY, bottomY] for proximity tests. */
const YOSHI_BLOCK_BOXES: ReadonlyArray<readonly [number, number, number]> = [
  [-8.5, 0, -8.5], [0, 0, -8.5], [8.5, 0, -8.5],
  [-38.25, 42.5, 34], [-29.75, 42.5, 34], [-21.25, 42.5, 34],
  [21.25, 42.5, 34], [29.75, 42.5, 34], [38.25, 42.5, 34],
];
/** Floors/surfaces with Yoshi's spinning blocks phased out per block (same view as
 * the match's cached active set, for presenters and debug views; other stages pass
 * through). Accepts the per-block timer array (0 = rest with collision). Green
 * Greens appends its live blocks when the runtime is supplied (base stage holds
 * only area 30). */
export function visibleStageCollision(stage: StageGameplayData, stageId: string, yoshiBlocks: readonly number[], greens?: GreensRuntime | null, muteCity?: MuteCityRuntime | null): { floors: readonly Floor[]; surfaces: readonly StageSurface[] } {
  if (stageId === 'green-greens' && greens) {
    const floors = [...stage.floors, ...greensFloors(greens)];
    const surfaces: StageSurface[] = [...(stage.surfaces ?? [])];
    for (const floor of greensFloors(greens)) surfaces.push({ ...floor, kind: 'floor' });
    surfaces.push(...greensSurfaces(greens));
    return { floors, surfaces };
  }
  if (stageId === 'mute-city' && muteCity?.deck) {
    const floors = [...stage.floors, ...muteCity.deck.floors];
    const surfaces: StageSurface[] = [...(stage.surfaces ?? []), ...muteCity.deck.surfaces];
    return { floors, surfaces };
  }
  if (stageId !== 'yoshi-island' || !yoshiBlocks.some((timer) => timer > 0)) return { floors: stage.floors, surfaces: stage.surfaces ?? [] };
  const spinningFloors = new Set<number>(), spinningSurfaces = new Set<number>();
  yoshiBlocks.forEach((timer, block) => {
    if (timer <= 0) return;
    spinningFloors.add(YOSHI_BLOCK_FLOORS[block]!);
    for (const id of YOSHI_BLOCK_SURFACES[block]!) spinningSurfaces.add(id);
  });
  return { floors: stage.floors.filter((floor) => !spinningFloors.has(floor.id)), surfaces: (stage.surfaces ?? []).filter((surface) => !spinningSurfaces.has(surface.id)) };
}
export type Players<T> = [T, T, ...T[]];
/** Per-phase timing of LocalMatch.step (see lib/perf/profiler.ts; timing only, never state). */
const SPAN_STAGE = profiler.span('step.stage'), SPAN_CPU = profiler.span('step.cpu'), SPAN_FIGHTERS = profiler.span('step.fighters'), SPAN_POSES = profiler.span('step.poses'),
  SPAN_COMBAT = profiler.span('step.combat'), SPAN_STRIKES = profiler.span('step.strikes'), SPAN_PROJECTILES = profiler.span('step.projectiles'), SPAN_ITEMS = profiler.span('step.items'),
  SPAN_STAGE_POST = profiler.span('step.stagePost'), SPAN_ANIM = profiler.span('step.anim');
export interface MatchOptions { stocks?: number; seconds?: number; opponent?: 'bot' | 'human'; countdown?: number; player?: number; seed?: number; controllers?: readonly PlayerControllerMode[] | null; seatIds?: readonly number[] | null;
  /** King of the Hill zone rules (local matches only); null is a classic stock battle. */
  hill?: HillSetup | null;
  /** RED (even slots) vs BLUE (odd slots) team battle; free-for-all when false. Local matches only. */
  teams?: boolean;
  /** PROTOTYPE (zombies): infection rules; null/false is a classic stock battle. Local matches only. */
  zombies?: boolean;
  /** CPU level 1-9 per dense slot (human slots ignored); null means every CPU plays at the default level. */
  cpuLevels?: readonly number[] | null;
  /** Match-item rule: -1 off (default), 0-4 index the original ItCo spawn-interval pairs. */
  itemFrequency?: number;
  /** Enabled item kinds (ItemKind ids 0x00-0x22); null means every supported kind. */
  itemSwitches?: readonly number[] | null }
/** In-memory frame-boundary state, not a network or asset serialization format. */
export interface MatchState {
  version: 1; configuration: string; phase: LocalMatch['phase']; frame: number; countdown: number;
  remainingFrames: number; winner: number | null;
  fighters: Array<Omit<MatchFighter, 'content'> & { contentKind: FighterKind }>; projectiles: ProjectileState; items: ItemWorldState;
  physics: Uint8Array; events: MatchEvent[]; shots: ShotIntent[];
  soundCursors: {epoch: number; frame: number}[]; bots: CpuBrain[];
  /** Pokémon Stadium transformation clock; null for static stages. */
  stadium: StadiumRuntime | null;
  /** Yoshi's Island per-block spin timers (frames remaining, 0 = rest with collision).
   * Nine entries in area order (0-2 center bridge, 3-8 elevated sides); all zeros
   * on every other stage. */
  yoshiBlocks: number[];
  /** Green Greens block/wind/apple runtime; null on every other stage. */
  greens: GreensRuntime | null;
  /** Mute City road runtime (scripted area cycle + traveling deck); null elsewhere. */
  muteCity: MuteCityRuntime | null;
  /** King of the Hill runtime (zones, points, relocation clock); null in stock battles. */
  hill: HillState | null;
  /** Onett hazard runtime (cars, warning, building, awnings); null elsewhere. */
  onett: OnettRuntime | null;
  /** Peach Bill runtime (single missile, flight + boom); null elsewhere. */
  peachBill: PeachBillRuntime | null;
  /** First infected slot (patient zero); null until the horde exists. */
  firstInfected: number | null;
}
const f32 = Math.fround;
const between = (value: number, a: number, b: number) => value >= Math.min(a, b) - 0.001 && value <= Math.max(a, b) + 0.001;
/** Parametric intersection (movement o→n at t, line a→b at s), or null when disjoint. */
function lineCrossing(line: Pick<Floor, 'a' | 'b'>, ox: number, oy: number, nx: number, ny: number): { t: number; s: number } | null {
  const fx = line.b[0] - line.a[0], fy = line.b[1] - line.a[1];
  const mx = nx - ox, my = ny - oy;
  const denom = mx * fy - my * fx;
  if (Math.abs(denom) < 1e-9) return null;
  const ax = line.a[0] - ox, ay = line.a[1] - oy;
  const t = (ax * fy - ay * fx) / denom, s = (ax * my - ay * mx) / denom;
  return t >= 0 && t <= 1 && s >= 0 && s <= 1 ? { t, s } : null;
}
/** Lower-body height swept against wall lines. The original tests the ECB's side points,
 * which sit a few units above the feet; a feet-only point test let a fighter walking up a
 * slope into a wall base (Peach's Castle tower sides, Temple/Venom/Corneria step corners)
 * pass under the wall's lowest vertex and drop into the terrain. Only the bottom vertex
 * is extended: the lip a fighter steps over from above is unchanged. */
const WALL_BODY_HEIGHT = 6;
/** The line a movement is tested against: walls grow down by the body height so the
 * feet point sweeps the same region the body segment [feet, feet + height] would. The
 * extension runs along the wall's own direction (original walls lean a hair), so the
 * line stays collinear and a fighter stopped at a wall base still sits on the floor end. */
function blockingLine(surface: StageSurface): Pick<Floor, 'a' | 'b'> {
  const dy = surface.b[1] - surface.a[1];
  if (surface.kind !== 'wall' || Math.abs(dy) < 1e-6) return surface;
  const dx = surface.b[0] - surface.a[0], k = WALL_BODY_HEIGHT / Math.abs(dy);
  return dy > 0
    ? { a: [surface.a[0] - dx * k, surface.a[1] - WALL_BODY_HEIGHT], b: surface.b }
    : { a: surface.a, b: [surface.b[0] + dx * k, surface.b[1] - WALL_BODY_HEIGHT] };
}
/** Parametric time in [0,1] where the movement segment passes from the upper side of a
 * floor's surface to its lower side within the floor span, or null when it never does. */
function floorCrossing(floor: Floor, oldX: number, oldY: number, x: number, y: number): number | null {
  const fx = floor.b[0] - floor.a[0], fy = floor.b[1] - floor.a[1];
  if (Math.abs(fx) < 0.001) return null;
  const side = (px: number, py: number) => (fx * (py - floor.a[1]) - fy * (px - floor.a[0])) * Math.sign(fx);
  // A fighter standing exactly on the surface counts as above it, so a horizontal launch
  // into a rising slope still crosses (and lands) instead of slipping underneath.
  const before = side(oldX, oldY), after = side(x, y);
  if (before < -0.001 || after >= 0) return null;
  const t = before <= 0 ? 0 : before / (before - after);
  // Adjacent floors form a polyline; a little span slack keeps their shared vertices sealed.
  const crossX = oldX + (x - oldX) * t, lo = Math.min(floor.a[0], floor.b[0]) - 0.2, hi = Math.max(floor.a[0], floor.b[0]) + 0.2;
  return crossX >= lo && crossX <= hi ? t : null;
}
/** Sorted keys and set entries, with no resource objects or platform crypto dependency. */
function canonical(value: unknown): string {
  if (value instanceof Set) return `[${[...value].map(canonical).sort().join(',')}]`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite simulation state.');
  return JSON.stringify(value) ?? 'null';
}

/** Restricted match orchestration around original data and C routines.
 * Not the original full state machine, ECB solver, CPU AI or DI.
 * Snapshot/rollback support concerns this prototype only, not GameCube equivalence. */
export class LocalMatch {
  readonly fighters: Players<MatchFighter>;
  readonly content: GameContent;
  readonly events: MatchEvent[] = [];
  /** Diagnostic ground-loss trail, cleared per match; rollback truncates it to the restored frame. */
  readonly groundLossLog: GroundLossEntry[] = [];
  /** Yoshi's Island per-block spin timers (frames remaining, 0 = rest with collision).
   * Nine entries in area order; authoritative and snapshot-owned like the Stadium
   * clock, so rollback and the relay's confirmed hashes stay in lockstep;
   * presentation only reads them. */
  yoshiBlocks: number[] = new Array(YOSHI_BLOCK_COUNT).fill(0);
  /** Backwards-compatible group view: frames remaining on the longest-running block. */
  get yoshiSpin(): number { return this.yoshiBlocks.reduce((max, timer) => Math.max(max, timer), 0); }
  /** Green Greens block/wind/apple runtime (authoritative, snapshot-owned like the
   * Stadium clock); null on every other stage. Presentation only reads it. */
  greens: GreensRuntime | null = null;
  /** Onett hazard runtime (authoritative, snapshot-owned like the Stadium
   * clock); null on every other stage. Presentation only reads it. */
  onett: OnettRuntime | null = null;
  /** Peach Bill runtime (authoritative, snapshot-owned like the Stadium clock);
   * null on every other stage. Presentation only reads it. */
  peachBill: PeachBillRuntime | null = null;
  /** Mute City road runtime (authoritative, snapshot-owned like the Stadium
   * clock); null on every other stage. Presentation only reads it. */
  muteCity: MuteCityRuntime | null = null;
  /** Per-frame combined collision cache for Green Greens (base + live blocks).
   * Recomputed at most once per frame; the Yoshi mask cache below stays separate. */
  private greensCache: { frame: number; stage: StageGameplayData; floors: Floor[]; surfaces: readonly StageSurface[] } | null = null;
  /** King of the Hill runtime; snapshot-owned alongside the Stadium clock. */
  hill: HillState | null = null;
  /** Hill zone ground anchors (spawn-derived); immutable layout input, never snapshot state. */
  private readonly hillAnchors: { x: number; y: number }[] = [];
  readonly projectiles: ProjectileWorld;
  readonly itemWorld: ItemWorld;
  readonly combat: CombatController;
  private shots: ShotIntent[] = [];
  private soundCursors: {epoch: number; frame: number}[];
  phase: 'ready' | 'countdown' | 'playing' | 'ended' = 'ready';
  /** Dynamic-stage clock (Pokémon Stadium); authoritative and snapshot-owned. */
  stadium: StadiumRuntime | null = null;
  frame = 0;
  private restoreRevisionValue=0;
  /** Derived presentation invalidation only; not part of authoritative state. */
  get restoreRevision():number{return this.restoreRevisionValue;}
  countdown = 0;
  remainingFrames: number;
  winner: number | null = null;
  /** First infected slot (patient zero); null until the horde exists. Snapshot-owned. */
  firstInfected: number | null = null;
  readonly options: Required<MatchOptions>;
  readonly controllerKinds: readonly PlayerControllerMode[];
  /** CPU level per dense slot; humans carry the default and never read it. */
  readonly cpuLevels: readonly CpuLevel[];
  private readonly seatIds: readonly number[];
  private bots: CpuBrain[];
  private readonly configuration: string;
  private readonly spawnPoints: readonly V3[];
  /** Phase 5 scratch buffers: reused every step so the 60 Hz loop allocates
   * nothing per frame (inputs, frozen flags, impacts, tested set). Only
   * used inside step(); never retained across calls. */
  private scratchInputs: PlayerInput[] = [];
  private scratchFrozen: boolean[] = [];
  private scratchImpacts: Array<{ attacker: MatchFighter; victim: MatchFighter; hit: ActiveHit; point: V3; shield: boolean; royCounter?: boolean; facing: number; echo?: boolean; nana?: MatchFighter | null; vkey: string }> = [];
  private scratchTested = new Set<number>();
  /** Phase 5: cached active collision set for the current frame (spinning Yoshi blocks
   * phase their terrain out). Recomputed only when the spin mask or stage ref
   * changes, not per fighter per frame. */
  /** Team battle flag for CPU targeting (CpuHost); mirrors the immutable options. */
  get teams(): boolean { return this.options.teams; }
  /** Zombies flag for CPU targeting (CpuHost); mirrors the immutable options. */
  get zombies(): boolean { return this.options.zombies; }
  private floorsCache: { mask: number; onettOut: boolean; muteCityDeck: number; stage: StageGameplayData; floors: Floor[]; surfaces: readonly StageSurface[] } | null = null;

  constructor(content: GameContent, readonly poses: PoseProvider, options: MatchOptions = {}) {
    this.options = { stocks: options.stocks ?? 3, seconds: options.seconds ?? 180, opponent: options.opponent ?? 'bot', countdown: options.countdown ?? 180, player: options.player ?? 0, seed: options.seed ?? 1, controllers: options.controllers ?? null, seatIds: options.seatIds ?? null, cpuLevels: options.cpuLevels ?? null, itemFrequency: options.itemFrequency ?? -1, itemSwitches: options.itemSwitches ?? null, hill: options.hill ?? null, teams: options.teams ?? false, zombies: options.zombies ?? false };
    if (!Number.isInteger(this.options.itemFrequency) || this.options.itemFrequency < -1 || this.options.itemFrequency > 4) throw new Error('Invalid item frequency rule.');
    const switches = this.options.itemSwitches;
    if (switches !== null && (!Array.isArray(switches) || switches.some((kind) => !Number.isInteger(kind) || kind < 0 || kind > 0x22) || new Set(switches).size !== switches.length)) throw new Error('Invalid item switches.');
    this.options.itemSwitches = switches === null ? null : Object.freeze([...switches]);
    if (!Number.isInteger(this.options.stocks) || this.options.stocks < 1 || this.options.stocks > 9 || !Number.isInteger(this.options.seconds) || this.options.seconds < 1 || this.options.seconds > 600 || !Number.isInteger(this.options.countdown) || this.options.countdown < 0 || this.options.countdown > 600 || !['bot', 'human'].includes(this.options.opponent) || !Number.isInteger(this.options.player) || this.options.player < 0 || this.options.player >= content.fighters.length || !Number.isInteger(this.options.seed) || this.options.seed < 0 || this.options.seed > 0xffffffff || content.fighters.length < MIN_MATCH_PLAYERS || content.fighters.length > MAX_MATCH_PLAYERS) throw new Error('Invalid prototype match rules.');
    const {controllers, seatIds, cpuLevels} = this.options;
    if (cpuLevels !== null && (!Array.isArray(cpuLevels) || cpuLevels.length !== content.fighters.length || Array.from(cpuLevels).some(level => !isCpuLevel(level)))) throw new Error('Invalid CPU levels.');
    if (controllers !== null && (!Array.isArray(controllers) || controllers.length !== content.fighters.length || Array.from(controllers).some(kind => kind !== 'human' && kind !== 'cpu'))) throw new Error('Invalid fighter controller roles.');
    if (seatIds !== null && (!Array.isArray(seatIds) || seatIds.length !== content.fighters.length || Array.from(seatIds).some(seat => !Number.isInteger(seat) || seat < 0 || seat >= MAX_MATCH_PLAYERS) || new Set(seatIds).size !== seatIds.length)) throw new Error('Invalid fighter seat IDs.');
    this.options.controllers = controllers === null ? null : Object.freeze([...controllers]);
    this.options.seatIds = seatIds === null ? null : Object.freeze([...seatIds]);
    this.options.cpuLevels = cpuLevels === null ? null : Object.freeze([...cpuLevels]);
    if (!validHillSetup(this.options.hill) && this.options.hill !== null) throw new Error('Invalid hill rules.');
    if (typeof this.options.teams !== 'boolean') throw new Error('Invalid team rules.');
    if (typeof this.options.zombies !== 'boolean') throw new Error('Invalid zombies rules.');
    if (this.options.hill) Object.freeze(this.options.hill);
    this.controllerKinds = this.options.controllers ?? Object.freeze(content.fighters.map((_, slot) => this.options.opponent === 'bot' && slot !== this.options.player ? 'cpu' : 'human'));
    this.seatIds = this.options.seatIds ?? Object.freeze(content.fighters.map((_, slot) => slot));
    this.cpuLevels = Object.freeze(content.fighters.map((_, slot) => this.controllerKinds[slot] === 'cpu' ? clampCpuLevel(cpuLevels?.[slot]) : DEFAULT_CPU_LEVEL));
    Object.freeze(this.options); // Rules/roles/seats are immutable configuration, never caller-owned arrays.
    this.remainingFrames = Math.floor(this.options.seconds * 60);
    this.spawnPoints = matchSpawnPoints(content.stage, content.fighters.length);
    this.content = {...content, physics: content.physics.fork(content.fighters.map(f => f.profile))};
    this.configuration = canonical({rules: {...this.options, controllers: this.controllerKinds, seatIds: this.seatIds, cpuLevels: this.cpuLevels, opponent: controllers === null ? this.options.opponent : 'human', player: controllers !== null || this.options.opponent === 'human' ? 0 : this.options.player}, stage: content.stage, spawns: this.spawnPoints, fighters: content.fighters.map(f => f.profile.kind)});
    this.soundCursors = content.fighters.map(() => ({epoch: -1, frame: -1}));
    this.bots = content.fighters.map((_, slot) => createCpuBrain(this.cpuLevels[slot]!));
    this.projectiles = new ProjectileWorld(this.content);
    // Items that check teams themselves (PlDd's banana Trip_Check): allies never trip.
    this.projectiles.allies = (a, b) => !!this.options.teams && hillTeamOfSlot(this.fighters[a]?.seatId ?? a) === hillTeamOfSlot(this.fighters[b]?.seatId ?? b);
    this.fighters = content.fighters.map((fighter, slot) => this.makeFighter(fighter, slot)) as Players<MatchFighter>;
    if (this.options.hill) {
      this.hillAnchors.push(...this.spawnPoints.map(([x, y]) => ({ x, y })));
      const halfWidth = hillHalfWidth(this.content.stage.blast.left, this.content.stage.blast.right);
      this.hill = makeHillState(this.options.seed, this.hillAnchors, this.options.hill.zones, halfWidth);
      this.hill.points = this.fighters.map(() => 0);
    }
    this.combat = new CombatController({ content: this.content, fighters:this.fighters, poses, events:this.events, projectiles:this.projectiles,
      change:(f,s,a)=>this.change(f,s,a), strike:(a,v,h,p,d,only=false)=>this.applyHit(a,v,h,p,d,false,only) });
    this.content.physics.seed(this.options.seed);
    // The transformation schedule consumes simulation RNG after seeding, so replays reproduce it.
    this.stadium = this.content.stadium ? createStadiumRuntime(this.content.physics, this.content.stadium.timing) : null;
    // Green Greens blocks/wind consume RNG next in fixed order (18 bomb rolls,
    // spawn timer, wind timer, wind direction), so replays reproduce the layout.
    this.greens = this.content.stageId === 'green-greens' ? createGreensRuntime(this.content.physics) : null;
    // Onett cars/building/awnings consume RNG last in fixed order (one discarded
    // car roll at init, then per-machine picks), so replays reproduce crossings.
    this.onett = this.content.stageId === 'onett' && this.content.onettData ? createOnettRuntime(this.content.physics) : null;
    // Peach Bills consume RNG after Onett slot (one spawn-window roll at init),
    // so replays reproduce launches; other stages consume nothing here.
    this.peachBill = this.content.stageId === 'peach-castle' && this.content.peachBillData ? createPeachBillRuntime(this.content.physics, this.content.peachBillData) : null;
    this.muteCity = this.content.stageId === 'mute-city' && this.content.muteCityData ? createMuteCityRuntime() : null;
    // With the item rule off this consumes no RNG, so itemless replays keep their stream.
    this.itemWorld = new ItemWorld(this.content, this.options.itemFrequency, this.options.itemSwitches);
    this.fighters.forEach((fighter) => this.poses.sample(fighter,false));
  }
  private makeFighter(content: FighterContent, slot: number): MatchFighter {
    const spawn = this.spawn(slot);
    const floor = this.content.stage.floors.filter((floor) => between(spawn[0], floor.a[0], floor.b[0]) && floorY(floor, spawn[0]) <= spawn[1] + 0.1).sort((a, b) => floorY(b, spawn[0]) - floorY(a, spawn[0]))[0];
    const fighter: MatchFighter = {
      customState: customInitialState(content.profile.kind),
      slot, seatId: this.seatIds[slot]!, content, x: spawn[0], y: floor ? floorY(floor, spawn[0]) : spawn[1], velocity: { x: 0, y: 0 }, knockback: { x: 0, y: 0 },
      grounded: !!floor, floor: floor?.id ?? null, facing: this.content.fighters.length > 4 ? (spawn[0] < (this.content.stage.mainLeft + this.content.stage.mainRight) / 2 ? 1 : -1) : slot === 0 ? 1 : -1, state: 'idle', stateFrame: 0,
      animation: 'Wait1', animationFrame: 0, animationRate:1, combat:createCombat(this.content), attackName: null, attackSerial: 0, percent: 0, stocks: this.options.stocks,
      jumpsUsed: floor ? 0 : 1, hitlag: 0, hitstun: 0, invulnerable: 0, shortHop: false, fastFall: false,
      downWindow: 0, ignoreFloor: null, ignoreTicks: 0, landingFrames: 0, previous: neutralInput(), victims: new Set(),
      roySideBoostUsed: false, special: null, specialSerial: 0, animationEpoch: 0, specialLandingLag: 0, specialMobility: 1, capeBoostUsed: false, tornadoUsed: false, popoHoverUsed: false, jab: null, smash:null,
      airJumpTurn: 0, hammerBoostUsed: false, copyAbility: null, samusCharge: 0, samusSideTicks: 255, sheikNeedles: 0, gwOil: 0, gwOilDamage: 0, gwJudge1: 1, gwJudge2: 0, gwChefA: 1, gwChefB: 3, gwJudgeHop: false, dkPunchCharge: 0, sonicCharge: 0, glideUsed: false, bsonic: createBSonicVars(), skullkid: createSkullKidVars(), envContact: null, mewtwoCharge: 0, mewtwoBoostUsed: false, koopaBreath: 360, lizardonFuel: { speed: 0, size: 0 }, tailsFuelUsed: 0, peachTurnip: null, peachFloat: { available: true, timer: 0 }, peachLastSmash: -1, link: createLinkState(), heldItem: null, itemStatus: null, itemFx: null, bury: null, ice: null, trip: null, hitstunInput: { jumpAt: 0, meteorLock: -1, jumpAge: 255, upSpecialAge: 255 }, nana: null, rogue: { ...NEUTRAL_ROGUE_MODS }, poison: null, hex: null, infected: false, kos: 0, falls: 0, damageDealt: 0, lastHitBy: null,
    };
    Object.defineProperty(fighter, 'seatId', {writable: false, configurable: false});
    resetLizardonFuel(fighter);
    // The duo spawns together: Nana takes her anchor behind Popo's facing with
    // regroup protection, but only while a partner model is loaded (otherwise
    // the slot stays solo Popo and every Nana path below stays dormant).
    if (content.profile.kind === 'Pp' && content.partnerModel) {
      fighter.nana = initialNanaState(f32(fighter.x - fighter.facing * NANA_ANCHOR_BACK), fighter.y, fighter.facing, fighter.floor);
    }
    return fighter;
  }
  private spawn(slot: number): V3 { return this.spawnPoints[slot]!; }
  start(): void { if (this.phase === 'ready') { this.countdown = this.options.countdown; this.phase = this.countdown > 0 ? 'countdown' : 'playing'; } }
  private change(fighter: MatchFighter, state: FighterState, animation: string): void {
    this.combat?.stateChanged(fighter,state);
    bsonicStateChange(fighter, state);
    fighter.smash=null;
    // Leaving the burial for any reason (a hit, KO) surfaces the body back to floor level.
    if (state !== 'bury' && fighter.bury) { fighter.y = f32(fighter.y + fighter.bury.depth); fighter.bury = null; }
    if (state !== 'frozen' && fighter.ice) fighter.ice = null;
    fighter.trip = null;
    fighter.state = state; fighter.stateFrame = 0; fighter.animation = animation; fighter.animationFrame = 0; fighter.animationRate=1;
    fighter.animationEpoch++;
    if (!['attack','special','grab','throw','ledge-action'].includes(state)) fighter.attackName = null;
    // Samus's installed damage callback drops charge while a special owns it.
    if (state === 'hitstun' && fighter.special && fighter.content.profile.kind === 'Ss') fighter.samusCharge = 0;
    // SpecialS_OnHit: every Spin Dash state installs a take-damage callback that drops the charge.
    if (state === 'hitstun' && fighter.special?.direction === 'side' && (fighter.content.profile.kind === 'Sn' || fighter.content.profile.kind === 'Sh')) fighter.sonicCharge = 0;
    // Stored needles drop when Sheik is hit mid-special, like Samus charge.
    if (state === 'hitstun' && fighter.special && fighter.content.profile.kind === 'Sk') fighter.sheikNeedles = 0;
    // ftMt_SpecialN_OnDeath: taking a hit drops a partial Shadow Ball; only a full one is kept.
    if (state === 'hitstun' && (fighter.content.profile.kind === 'Mt' || fighter.content.profile.kind === 'Sm')) {
      const p = fighter.content.specials.parameters;
      if ((p.kind === 'Mt' || p.kind === 'Sm') && fighter.mewtwoCharge < p.neutral.chargeCycles) fighter.mewtwoCharge = 0;
    }
    // PlTs SpecialHi_OnHit: a hit out of the helicopter leaves x44 fuel.
    if (state === 'hitstun') tailsOnInterrupted(fighter);
    if (state !== 'special') fighter.special = null;
    if (state !== 'attack' && state !== 'idle') fighter.jab = null;
    if (!['attack','grab','holding','tether'].includes(state)) fighter.link.hook = null;
    if(state!=='item-throw')fighter.link.itemThrow=null;
    // Being launched, KO'd or captured knocks a held match item out of the hand.
    if(this.itemWorld&&fighter.heldItem!==null&&['hitstun','ko','captured','shield-break','dizzy'].includes(state))this.itemWorld.dropHeld(fighter);
    if (state !== 'airjump') fighter.airJumpTurn = 0;
    // ftCo_Damage sets x67F to 0xFF: a press before the hit cannot L-cancel the next landing.
    if (state === 'hitstun') { fighter.specialLandingLag = 0; fighter.specialMobility = 1; fighter.link.shieldAge = 255; }
  }
  private canAirJump(fighter: MatchFighter): boolean {
    return fighter.jumpsUsed < fighter.content.profile.attributes.maxJumps + (fighter.rogue?.extraJumps ?? 0) && airJumpAllowed(fighter);
  }
  private airJump(fighter: MatchFighter, input: PlayerInput): void {
    // Multi-jump fighters take their per-jump impulses from their own attributes (Kirby: ftKb_DatAttrs).
    const multi = beginAirJump(fighter, input);
    if (!multi) fighter.velocity = this.content.physics.jump(fighter.slot, fighter.velocity, input.x, false, true);
    // ft_800D2E7C: a held Screw Attack scales the air jump by ftCommonData x800 (ItemScrewAir).
    const screw = !multi && this.itemWorld.screwHeld(fighter);
    const screwMul = this.content.common.itemStatus?.screwJump ?? 1;
    if (screw) fighter.velocity = { x: f32(fighter.velocity.x * screwMul), y: f32(fighter.velocity.y * screwMul) };
    const turn = fighter.airJumpTurn;
    fighter.jumpsUsed++; fighter.fastFall = false; this.change(fighter, 'airjump', screw && fighter.content.clips.has('ItemScrewAir') ? 'ItemScrewAir' : multi ?? 'JumpAerialF'); fighter.airJumpTurn = turn;
    this.events.push({ type: 'jump', player: fighter.slot, x: fighter.x, y: fighter.y, sound: fighter.content.specials.sounds.airJump });
  }
  /** doIasa meteor cancel: knockback velocity is zeroed and hitstun ends before the chosen action. */
  private cancelMeteor(fighter: MatchFighter): void {
    fighter.knockback = { x: 0, y: 0 }; fighter.hitstun = 0;
    fighter.hitstunInput.jumpAt = 0; fighter.hitstunInput.meteorLock = -1;
    this.change(fighter, 'fall', 'Fall');
  }
  private attack(fighter: MatchFighter, name: string, chain = false): void {
    if (!chain) fighter.jab = name === fighter.content.moves.jab ? beginJab(fighter.content) : null;
    this.change(fighter, 'attack', name); fighter.attackName = name; fighter.attackSerial++; fighter.victims.clear();
    if(name===fighter.content.moves.downAir)resetLinkDair(fighter);
    if(fighter.grounded&&(name===fighter.content.moves.strong||name===fighter.content.moves.downSmash||name===fighter.content.moves.upSmash))fighter.smash=beginSmash(fighter.content.attacks.get(name)!);
  }
  step(inputs: readonly PlayerInput[]): void {
    if (inputs.length !== this.fighters.length) throw new Error('Expected one input per fighter.');
    this.events.length = 0; this.shots.length = 0;
    if (this.phase === 'ready' || this.phase === 'ended') return;
    this.frame++; // One network frame clock, including countdown.
    // Mute City's road runs on the animation clock through countdown too (the
    // script is deterministic and eventless), so logic tracks the road visuals
    // exactly at GO instead of fast-forwarding 180 frames of markers.
    if (this.muteCity && this.content.muteCityData) this.stepMuteCityRoad();
    if (this.phase === 'countdown') {
      this.countdown--;
      if (this.countdown <= 0) this.phase = 'playing';
      return;
    }
    this.remainingFrames--;
    profiler.begin(SPAN_STAGE);
    // Yoshi's Island blocks count down their spins independently and settle back
    // with collision; triggers below only fire while each block is at rest.
    if (this.content.stageId === 'yoshi-island') {
      for (let block = 0; block < YOSHI_BLOCK_COUNT; block++) {
        if (this.yoshiBlocks[block]! > 0) this.yoshiBlocks[block]!--;
      }
      if (this.yoshiBlocks.some((timer) => timer < 0 || !Number.isInteger(timer))) throw new Error('Invalid Yoshi block timers.');
    }
    // Green Greens blocks fall, Whispy blows and drops apples (grgreens.c cycle).
    // Apples spawn as Foods (prototype proxy); wind pushes fighters below.
    if (this.content.stageId === 'green-greens' && this.greens) {
      const out = stepGreens(this.greens, this.content.physics);
      for (const apple of out.apples) {
        if (!this.content.items) continue;
        try {
          const kind = itemKind('Foods');
          if (!this.content.items.kinds.has(kind)) continue;
          const item = this.itemWorld.spawnKind(kind, apple.x, apple.y);
          this.events.push({ type: 'bounce', player: 0, x: item.x, y: item.y });
        } catch { /* ItCo without Foods: apples stay decorative this frame. */ }
      }
      if (out.windStarted) {
        this.events.push({ type: 'sound', player: 0, x: 0, y: 20, sound: this.greens.windDir === 0 ? 0x68fb0 : 0x68fb1, volume: 127, pan: 64 });
      }
      if (this.greens.windActive !== 0) {
        const dir = this.greens.windActive === 1 ? -1 : 1;
        for (const fighter of this.fighters) {
          if (fighter.state === 'ko' || fighter.state === 'respawn' || fighter.state === 'captured') continue;
          const inY = fighter.y > GREENS_WIND_BOTTOM && fighter.y < GREENS_WIND_TOP;
          const inX = dir < 0
            ? fighter.x > -GREENS_WIND_RIGHT && fighter.x < -GREENS_WIND_LEFT
            : fighter.x > GREENS_WIND_LEFT && fighter.x < GREENS_WIND_RIGHT;
          if (inX && inY) {
            // Whispy wind slides fighters but never through vertical block walls.
            const nextX = f32(fighter.x + dir * GREENS_WIND_SPEED);
            if (!this.firstSurfaceCrossing(this.activeSurfaces(), fighter.x, fighter.y, nextX, fighter.y, fighter.grounded)) fighter.x = nextX;
          }
        }
      }
      this.greensCache = null;
    }
    if (this.stadium && this.content.stadium) {
      stepStadium(this.stadium, this.content.physics, this.content.stadium.timing);
      // Collision follows the transformation frame by frame (the original re-transforms
      // the terrain's collision vertices with its joint): grounded fighters ride their
      // floor's motion, and fighters over terrain that just vanished lose support or are
      // set onto the surface that replaced it.
      const stage = stadiumStageAt(this.content.stadium, this.stadium);
      if (stage !== this.content.stage) {
        const previous = this.content.stage;
        this.content.stage = stage;
        this.rideMovingFloors(previous);
        this.carryTransformedFighters(previous);
      }
    }
    // Onett cars cross, the building tracks hits and the awnings wobble (gronett.c).
    if (this.content.stageId === 'onett' && this.onett && this.content.onettData) {
      this.stepOnettStage();
    }
    // Peach Bills launch on the original spawn window and cross (grcastle.c).
    if (this.content.stageId === 'peach-castle' && this.peachBill && this.content.peachBillData) {
      this.stepPeachBillStage();
    }
    profiler.end(SPAN_STAGE);
    profiler.begin(SPAN_CPU);
    // Phase 5: reuse scratch buffers instead of allocating per frame.
    const actual = this.scratchInputs;
    actual.length = 0;
    for (let i = 0; i < inputs.length; i++) actual.push(inputs[i]!);
    if (this.options.controllers === null) {
      // Preserve the legacy solo convention: P1 input is redirected to options.player.
      if (this.options.opponent === 'bot') {
        actual[this.options.player] = inputs[0]!;
        for (const fighter of this.fighters) if (fighter.slot !== this.options.player) actual[fighter.slot] = this.botInput(fighter.slot);
      }
    } else {
      // Explicit seats consume dense human inputs. CPU placeholders are ignored;
      // decisions are regenerated from this world's saved brain/RNG/state in slot order.
      for (const fighter of this.fighters) if (this.controllerKinds[fighter.slot] === 'cpu') actual[fighter.slot] = this.botInput(fighter.slot);
    }
    profiler.end(SPAN_CPU);
    profiler.begin(SPAN_FIGHTERS);
    const frozen = this.scratchFrozen;
    frozen.length = 0;
    for (const fighter of this.fighters) frozen.push(fighter.hitlag > 0);
    this.fighters.forEach((fighter, slot) => this.updateFighter(fighter, actual[slot]!));
    // Nana follows Popo's settled pose (KO hides her, respawn carries her out).
    for (const fighter of this.fighters) this.stepNana(fighter);
    this.nudgeGrounded(frozen);
    profiler.end(SPAN_FIGHTERS);
    profiler.begin(SPAN_POSES);
    this.fighters.forEach((fighter) => this.poses.sample(fighter,false));
    profiler.end(SPAN_POSES);
    profiler.begin(SPAN_COMBAT);
    for(const fighter of this.fighters)if(!frozen[fighter.slot]&&fighter.hitlag===0){stepHookshot(fighter,this.hookHost());updatePassiveLinkShield(fighter);}
    this.combat.syncCaptures(); this.combat.resolve(frozen); this.combat.syncCaptures();
    for (const fighter of this.fighters) if (!frozen[fighter.slot] && fighter.hitlag === 0) this.emitSounds(fighter);
    for (const shot of this.shots) {
      if (shot.dropped) continue;
      const actor = this.fighters[shot.player]!;
      const item = this.projectiles.spawn(actor, shot.kind, this.poses, !!shot.copy, shot.charge, shot);
      this.events.push({ type: 'shot', player: actor.slot, x: item.x, y: item.y, projectileKind: item.kind });
    }
    profiler.end(SPAN_COMBAT);
    if (!this.hill) {
      // Stock battles end on a lone survivor — or a lone surviving side in team battles.
      const alive = this.fighters.filter((fighter) => fighter.stocks > 0);
      // PROTOTYPE (zombies): the horde wins the moment no clean survivor holds a stock.
      if (this.options.zombies) { if (!alive.some(fighter => !fighter.infected)) { this.finish(); return; } }
      else {
      const sides = this.options.teams ? new Set(alive.map(fighter => hillTeamOfSlot(fighter.seatId ?? fighter.slot))) : null;
      // PROTOTYPE (roguelike): a Rift floor ends when its champion is out, not the last rival standing.
      if (sides ? sides.size <= 1 : alive.length <= 1 || rogueEssentialOut(this.fighters)) { this.finish(); return; }
      }
    }
    profiler.begin(SPAN_STRIKES);
    const impacts = this.scratchImpacts;
    impacts.length = 0;
    const yoshiTested = this.scratchTested;
    yoshiTested.clear();
    for (const attacker of this.fighters) for (const victim of this.fighters) {
      if (attacker === victim) continue;
      // Prototype team battles: direct strikes, grabs and detects never connect
      // between teammates (projectiles and items still hit everyone).
      if (this.options.teams && hillTeamOfSlot(attacker.seatId ?? attacker.slot) === hillTeamOfSlot(victim.seatId ?? victim.slot)) continue;
      // PROTOTYPE (zombies): direct strikes, grabs and detects never connect
      // between the infected (projectiles and items still hit everyone, as in team battles).
      if (this.options.zombies && attacker.infected && victim.infected) continue;
      // PROTOTYPE (roguelike): allied rivals on a Rift team floor never strike or grab each other.
      if (rogueAllied(attacker, victim)) continue;
      if (!['attack','special','grab','ledge-action'].includes(attacker.state) || !attacker.attackName || frozen[attacker.slot] || attacker.hitlag > 0 || victim.invulnerable > 0 || victim.state === 'ko' || victim.state === 'respawn') continue;
      const hits = this.strikeHits(attacker);
      // Strikes reaching a block start its spin (prototype stand-in for the per-block
      // joint contact accumulation); grabs and Raptor-Boost detects never trigger it.
      if (!yoshiTested.has(attacker.slot)) {
        yoshiTested.add(attacker.slot);
        for (const hit of hits) {
          if (hit.element === 8 || hit.element === 11) continue;
          this.touchStage(this.poses.point(attacker, hit.bone, hit.offset), hit.radius, attacker.slot);
          // The synced partner's hammer reaches the same blocks from her pose.
          const nana = attacker.nana;
          if (nana?.active && this.poses.partnerPoint) this.touchStage(this.poses.partnerPoint(attacker, hit.bone, hit.offset), hit.radius, attacker.slot);
        }
      }
      outer: for (const hit of hits) {
        if (attacker.victims.has(`${victim.slot}:${hit.group}:${hit.activation}`)) continue;
        if ((victim.grounded && !hit.grounded) || (!victim.grounded && !hit.airborne)) continue;
        const point = this.poses.point(attacker, hit.bone, hit.offset);
        const connect = this.strikeConnect(victim, hit, point);
        if (connect) { impacts.push({ attacker, victim, hit, point, shield: connect.shield, ...(connect.royCounter ? { royCounter: true } : {}), facing: attacker.facing, vkey: `${victim.slot}:${hit.group}:${hit.activation}` }); break outer; }
      }
      // Nana echo: the synced partner swings the same hammer from her own pose,
      // so the duo can land both hits in one frame (separate victim keys below).
      // She never grabs or detects, and a tumbling Nana swings nothing.
      const partner = attacker.nana;
      if (partner?.active && partner.tumble <= 0 && this.poses.partnerPoint) {
        for (const hit of hits) {
          if (!nanaStrikeHit(hit)) continue;
          const vkey = `nana:${victim.slot}:${hit.group}:${hit.activation}`;
          if (attacker.victims.has(vkey)) continue;
          if ((victim.grounded && !hit.grounded) || (!victim.grounded && !hit.airborne)) continue;
          const point = this.poses.partnerPoint(attacker, hit.bone, hit.offset);
          const connect = this.strikeConnect(victim, hit, point);
          if (connect) { impacts.push({ attacker, victim, hit, point, shield: connect.shield, ...(connect.royCounter ? { royCounter: true } : {}), facing: partner.facing, echo: true, vkey }); break; }
        }
      }
    }
    // Strikes on Nana: every other fighter's live hits also test her hurtboxes
    // (plus the hitter's own echo, for mirror-ditto parity). Direct damage
    // only — no grabs, shields, counters or captures on the partner.
    if (this.poses.partnerPoint) for (const attacker of this.fighters) for (const owner of this.fighters) {
      const nana = owner.nana;
      if (!nana?.active || nana.invulnerable > 0 || attacker === owner) continue;
      if (this.options.teams && hillTeamOfSlot(attacker.seatId ?? attacker.slot) === hillTeamOfSlot(owner.seatId ?? owner.slot)) continue;
      if (this.options.zombies && attacker.infected && owner.infected) continue;
      if (rogueAllied(attacker, owner)) continue;
      if (!['attack','special','grab','ledge-action'].includes(attacker.state) || !attacker.attackName || frozen[attacker.slot] || attacker.hitlag > 0) continue;
      if (owner.state === 'ko' || owner.state === 'respawn') continue;
      const hits = this.strikeHits(attacker);
      for (const hit of hits) {
        if (!nanaStrikeHit(hit)) continue;
        if ((nana.grounded && !hit.grounded) || (!nana.grounded && !hit.airborne)) continue;
        const origins: Array<{ point: V3; vkey: string }> = [{ point: this.poses.point(attacker, hit.bone, hit.offset), vkey: `vn:${owner.slot}:${hit.group}:${hit.activation}` }];
        const echo = attacker.nana;
        if (echo?.active && echo.tumble <= 0) origins.push({ point: this.poses.partnerPoint!(attacker, hit.bone, hit.offset), vkey: `vne:${owner.slot}:${hit.group}:${hit.activation}` });
        for (const { point, vkey } of origins) {
          if (attacker.victims.has(vkey)) continue;
          for (const hurt of fighterHurts(owner)) {
            if (!hurtEnabled(owner, hurt.bone)) continue;
            const a = this.poses.partnerPoint!(owner, hurt.bone, hurt.a), b = this.poses.partnerPoint!(owner, hurt.bone, hurt.b);
            if (pointSegmentDistanceSquared(point, a, b) <= (hit.radius + hurt.radius) ** 2) { impacts.push({ attacker, victim: owner, hit, point, shield: false, facing: attacker.facing, nana: owner, vkey }); break; }
          }
        }
      }
    }
    // Gather first, apply second: same-frame opposing attacks can trade.
    const clashed = new Set<number>();
    for (const impact of impacts) if (impact.hit.element === 8 && !clashed.has(impact.attacker.slot) && !clashed.has(impact.victim.slot) && impacts.some(other => other.hit.element === 8 && other.attacker === impact.victim && other.victim === impact.attacker)) {
      this.combat.clash(impact.attacker, impact.victim); clashed.add(impact.attacker.slot); clashed.add(impact.victim.slot);
    }
    for (const { attacker, victim, hit, point, shield, royCounter: counter, facing, echo, nana, vkey } of impacts) {
      if(hit.element===11){
        // ftCa_SpecialS_OnDetect: fighter contact turns the dash into the hit stage; no damage is
        // dealt. Record the detect before the stage switch clears the fresh victim set.
        attacker.victims.add(vkey);
        if(falconRaptorDetect(attacker))triggerFalconRaptor(attacker);
        else{
          // ftPe doAirEnd0: the Bomber's SJump detect box sets off the explosion item.
          const blast=peachBomberDetect(attacker);
          // PlWr hurtbox_detect_cb: the Shoulder Bash contact swaps into its 13% hit.
          if(!blast)warioBashDetect(attacker);
          if(blast){const item=this.projectiles.spawn(attacker,blast.kind,this.poses,false,0,blast);this.events.push({type:'shot',player:attacker.slot,x:item.x,y:item.y,projectileKind:item.kind});}
        }
        continue;
      }
      if(hit.element===8){
        if(!clashed.has(attacker.slot)&&!clashed.has(victim.slot)){
          if(attacker.state==='grab')this.combat.catch(attacker,victim);
          else if(isInhaling(attacker))this.combat.inhale(attacker,victim);
          else if(falconDiveActive(attacker)&&this.combat.specialCatch(attacker,victim))beginFalconDiveCatch(attacker);
          else if(koopaKlawActive(attacker)&&this.combat.specialCatch(attacker,victim))beginKoopaKlawCatch(attacker);
          // PlDd SpecialAirSJump's grab boxes (ftCommon_InitGrab): Monkey Flip clings to the captive, which keeps its footing.
          else if(diddyFlipActive(attacker)&&this.combat.specialCatch(attacker,victim,true))beginDiddyCling(attacker,victim,this.content.combat.grab);
          else if(yoshiEggActive(attacker)&&this.combat.bury(victim))beginYoshiEgg(attacker);
        }
        attacker.victims.add(vkey);continue;
      }
      // A special-owned capture (Falcon Dive) takes its owner's hits as damage only; the throw releases.
      if(victim.state==='captured'&&victim.combat.partner===attacker.slot){this.applyHit(attacker,victim,hit,point,facing,false,true);attacker.victims.add(vkey);continue;}
      // Nana takes direct damage only: no counters, shields or captures on the partner.
      if(nana){this.applyNanaHit(attacker,nana,hit,point,facing);attacker.victims.add(vkey);continue;}
      if(this.counter(attacker,victim,hit,!!counter)){attacker.victims.add(vkey);continue;}
      if(shield){this.combat.block(attacker,victim,hit,point);attacker.victims.add(vkey);continue;}
      const cape = (attacker.content.profile.kind === 'Mr' || attacker.content.profile.kind === 'Dr' || attacker.content.profile.kind === 'MM') && attacker.special?.direction === 'side';
      this.applyHit(attacker, victim, hit, point, facing, false, false, cape);
      // Landed callbacks track the attacker's own connect; an echo never re-fires them.
      if (!echo) { pikachuHitLanded(attacker); linkHitLanded(attacker); falconKickHitLanded(attacker); purinHitLanded(attacker); luigiHitLanded(attacker); bsonicHitLanded(attacker); wolfHitLanded(attacker); }
      attacker.victims.add(vkey);
    }
    profiler.end(SPAN_STRIKES);
    profiler.begin(SPAN_PROJECTILES);
    for (const impact of this.projectiles.step(this.fighters, this.poses, this.events, frozen)) {
      const p = impact.projectile;
      // PROTOTYPE (roguelike): an ally's shot fizzles on a Rift team floor (no damage, block or counter).
      if (rogueAllied(this.fighters[p.owner], impact.victim)) continue;
      // PlDd banana Trip_Check: the rival slips (no damage) and the banana flies up.
      if (impact.trip) { this.tripFighter(impact.victim); continue; }
      if(this.counter(this.fighters[p.owner]!,impact.victim,impact.hit,!!impact.royCounter)){this.projectiles.consume(p.id);continue;}
      if(impact.passiveAmount!==undefined){
        const c=this.content.combat.passiveShield;if(!c)throw Error('Missing original passive shield coefficients.');
        const push=(c.stunScale*(impact.hit.damage*(1-(impact.passiveAmount*(c.analogMax-c.analogMin)+c.analogMin)))+this.content.combat.shield.stunBase)*c.push;
        impact.victim.velocity.x=f32(push*impact.direction);
        this.events.push({type:'shield',player:impact.victim.slot,x:impact.point[0],y:impact.point[1],damage:impact.hit.damage});
        this.events.push({type:'sound',player:impact.victim.slot,x:impact.point[0],y:impact.point[1],sound:impact.victim.content.profile.kind==='Cl'?70106:160106,volume:127,pan:64});
      }
      else if(impact.shield)this.combat.block(this.fighters[p.owner]!,impact.victim,impact.hit,impact.point,true);
      else {const owner=this.fighters[p.owner]!;const foxLaser=p.kind==='laser'&&(owner.content.profile.kind==='Fx'||(owner.content.profile.kind==='Kb'&&owner.copyAbility==='Fx'));this.applyHit(owner, impact.victim, impact.hit, impact.point, impact.direction, true, foxLaser, false, p.kind==='laser'?'laser':'fireball');}
    }
    profiler.end(SPAN_PROJECTILES);
    profiler.begin(SPAN_ITEMS);
    for (const impact of this.itemWorld.step(this.fighters, this.poses, this.events, frozen)) {
      const attacker = impact.item.owner === null ? null : this.fighters[impact.item.owner];
      if (!attacker || rogueAllied(attacker, impact.victim)) continue;
      if (impact.shield) this.combat.block(attacker, impact.victim, impact.hit, impact.point, true);
      else this.applyHit(attacker, impact.victim, impact.hit, impact.point, impact.direction, true);
    }
    profiler.end(SPAN_ITEMS);
    profiler.begin(SPAN_STAGE_POST);
    // Shots and loose items striking a block start its spin (prototype stand-in for
    // gryorster.c's per-block item contact accumulation).
    if (this.content.stageId === 'yoshi-island') {
      for (const shot of this.projectiles.items) {
        for (const block of this.yoshiBlocksHit(shot.x, shot.y, 2)) this.startYoshiSpin(block);
      }
      for (const item of this.itemWorld.items) {
        if (item.phase === 'flight' || item.phase === 'fall') for (const block of this.yoshiBlocksHit(item.x, item.y, 2)) this.startYoshiSpin(block);
      }
    }
    // Shots and loose items break Green Greens blocks on contact (grgreens.c
    // material hits); shots are consumed by the block they break.
    if (this.content.stageId === 'green-greens' && this.greens) {
      for (const shot of [...this.projectiles.items]) {
        const broken = greensBlockAt(this.greens, shot.x, shot.y, 4);
        if (broken >= 0) {
          this.projectiles.consume(shot.id);
          this.breakGreensBlock(broken, shot.owner);
        }
      }
      for (const item of [...this.itemWorld.items]) {
        if (item.phase !== 'flight' && item.phase !== 'fall') continue;
        const broken = greensBlockAt(this.greens, item.x, item.y, 4);
        if (broken >= 0) this.breakGreensBlock(broken, item.owner ?? 0);
      }
    }
    // Shots and loose items striking the live rooftop feed the Onett building machine.
    if (this.content.stageId === 'onett' && this.onett) {
      for (const shot of this.projectiles.items) this.hitOnettRooftop(shot.x, shot.y, 2);
      for (const item of this.itemWorld.items) {
        if (item.phase === 'flight' || item.phase === 'fall') this.hitOnettRooftop(item.x, item.y, 2);
      }
    }
    // The hazard car runs fighters over with its original 30% hit.
    if (this.content.stageId === 'onett' && this.onett && this.content.onettData) {
      this.scanOnettCar();
    }
    // Bills detonate on contact with a prototype radial blast.
    if (this.content.stageId === 'peach-castle' && this.peachBill && this.content.peachBillData) {
      this.scanPeachBill();
    }
    // Deferred item status effects: consumable healing and Starman invincibility.
    for (const effect of this.itemWorld.effects) {
      const fighter = this.fighters[effect.slot];
      if (!fighter || fighter.state === 'ko' || fighter.state === 'respawn') continue;
      if (effect.heal !== undefined) fighter.percent = Math.max(0, f32(fighter.percent - effect.heal));
      if (effect.invulnerable !== undefined) fighter.invulnerable = Math.max(fighter.invulnerable, effect.invulnerable);
      if (effect.status !== undefined) {
        const kind = effect.status.kind;
        if (kind === 'mushroom' || kind === 'poison') this.mushroom(fighter, kind === 'mushroom');
        else if (kind === 'bunny' || kind === 'metal' || kind === 'cloak') {
          // ftCommon_8007FA58 / ftCo_800C8348 / ftCo_800C88D4: a repeat pickup refreshes the timer.
          const fx = fighter.itemFx ??= newItemFx();
          if (kind === 'bunny') fx.bunny = effect.status.timer;
          else if (kind === 'metal') { fx.metal = effect.status.timer; fx.metalHealth = effect.status.health ?? 0; }
          else fx.cloak = effect.status.timer;
          this.refreshFxAttributes(fighter);
        } else {
          fighter.itemStatus = { kind, timer: effect.status.timer };
          // ftCo_800C4724: the ride remembers its launch point and facing, then follows the path.
          if (kind === 'warp') {
            Object.assign(fighter.itemStatus, { path: effect.status.path ?? 0, frame: 0, fall: false, ox: fighter.x, facing: fighter.facing });
            fighter.grounded = false; fighter.floor = null; fighter.velocity = { x: 0, y: 0 }; this.change(fighter, 'jump', 'JumpF');
          }
        }
      }
    }
    this.itemWorld.effects.length = 0;
    profiler.end(SPAN_STAGE_POST);
    profiler.begin(SPAN_ANIM);
    for (const fighter of this.fighters) {
      if (!frozen[fighter.slot] && fighter.hitlag === 0 && fighter.state !== 'ko' && fighter.state !== 'respawn') {
        // PlDd OnFrame: Diddy's per-motion animation rates (ftDataDiddy xFC).
        diddyAnimRate(fighter);
        const rate = fighter.state === 'walk' || inhaleWalking(fighter) || cargoWalking(fighter) ? this.walkAnimation(fighter)
          : fighter.state === 'run' && fighter.animation === 'Run' ? Math.min(3, Math.abs(fighter.velocity.x) / Math.max(0.01, fighter.content.profile.attributes.runAnimationScaling)) : 1;
        fighter.animationFrame = f32(fighter.animationFrame + rate*fighter.animationRate); fighter.stateFrame++;
      }
      this.poses.sample(fighter,false);
    }
    this.combat.syncAnchors();
    profiler.end(SPAN_ANIM);
    // King of the Hill runs while the clock does: every fighter in a zone fills
    // their own capture meter, a captured zone pays its owner every second
    // (occupied or not), and the hills relocate on their own clock.
    if (this.hill && this.phase === 'playing') {
      const teamOf = (dense: number): 0 | 1 => hillTeamOfSlot(this.fighters[dense]?.seatId ?? dense);
      const occupants = this.hillOccupants();
      stepHillCapture(this.hill, this.options.teams, occupants, this.fighters.length, teamOf);
      this.hill.tick++;
      if (this.hill.tick >= HILL_POINT_EVERY) { this.hill.tick = 0; scoreHillTick(this.hill, this.options.teams, occupants, teamOf); }
      if (--this.hill.relocateIn <= 0) relocateHillZones(this.hill, this.hillAnchors);
    }
    if (this.remainingFrames <= 0 && this.phase === 'playing') this.finish();
  }
  /** Dense slots currently standing on each active hill zone (grounded, alive, within the patch). */
  private hillOccupants(): number[][] {
    const hill = this.hill!;
    return hill.zones.map(zone => {
      const inside: number[] = [];
      for (const fighter of this.fighters) {
        if (!fighter.grounded || fighter.state === 'ko' || fighter.state === 'respawn' || fighter.state === 'captured') continue;
        if (Math.abs(fighter.x - zone.x) > zone.halfWidth || Math.abs(fighter.y - zone.y) > HILL_CAPTURE_DY) continue;
        inside.push(fighter.slot);
      }
      return inside;
    });
  }
  private walkAnimation(f:MatchFighter):number {
    // Kirby's EatWalk and DK's cargo walk share the ftWalkCommon stride selection with their
    // own clips while the hold continues.
    const carrying=inhaleWalking(f)?KIRBY_EAT_WALKS:cargoWalking(f)?f.content.cargo!.walks:null;
    const type=this.content.physics.walkType(f.slot,f.velocity.x),name=(carrying??['WalkSlow','WalkMiddle','WalkFast'])[type]!;
    if(f.animation!==name){
      const old=f.content.clips.get(f.animation)!.endFrame,next=f.content.clips.get(name)!.endFrame;
      const frame=old>0?Math.floor((f.animationFrame%old)/old*next):0;
      this.change(f,carrying?'holding':'walk',name);f.animationFrame=frame;
      // Seeking into the replacement stride must not replay old footstep cues.
      this.soundCursors[f.slot]={epoch:f.animationEpoch,frame};
    }
    return f.velocity.x*f.facing>0?Math.abs(f.velocity.x)/f.content.profile.attributes.walkAnimationScaling[type]!:0;
  }
  private updateFighter(fighter: MatchFighter, raw: PlayerInput): void {
    let input = { ...raw, x: Math.max(-1, Math.min(1, Number.isFinite(raw.x) ? raw.x : 0)), y: Math.max(-1, Math.min(1, Number.isFinite(raw.y) ? (raw.y || (raw.down ? -1 : 0)) : (raw.down ? -1 : 0))) };
    if (Math.abs(input.x) < (fighter.grounded?this.content.common.walkThreshold:this.content.common.stickDeadzone)) input.x = 0;
    const previous=fighter.previous;
    if (fighter.content.profile.kind === 'Ss') fighter.samusSideTicks = Math.abs(input.x) < 0.8 ? 255 : Math.abs(previous.x) < 0.8 || Math.sign(input.x) !== Math.sign(previous.x) ? 0 : Math.min(255, fighter.samusSideTicks + 1);
    const deadX=this.content.common.itemInput?.smashDeadX??0.8,deadY=this.content.common.itemInput?.smashDeadY??0.8;
    fighter.link.sideTicks = Math.abs(input.x)<deadX?255:Math.abs(previous.x)<deadX||Math.sign(input.x)!==Math.sign(previous.x)?0:Math.min(254,fighter.link.sideTicks+1);
    fighter.link.verticalTicks = Math.abs(input.y)<deadY?255:Math.abs(previous.y??0)<deadY||Math.sign(input.y)!==Math.sign(previous.y??0)?0:Math.min(254,fighter.link.verticalTicks+1);
    let jump = input.jump && !fighter.previous.jump, attack = input.attack && !fighter.previous.attack;
    const releasedAttack = !input.attack && fighter.previous.attack;
    // C-stick smash routing (see `lib/game/smash-stick.ts`): a fresh right-stick
    // flick fires Strong with the flick's own direction; holding it charges like a
    // held Strong button. Attack selection, facing, items and ledge attacks read
    // the merged `atk` vector below, while movement, tap-jump, fast-fall, drops
    // and specials keep reading the left stick (`input`).
    const cEdge = cStickEdge(input, previous);
    const heldStrong = smashHeld(input);
    const useC = cEdge;
    const cX = Number.isFinite(input.cX) ? input.cX! : 0, cY = Number.isFinite(input.cY) ? input.cY! : 0;
    const atkX = useC ? cX : input.x, atkY = useC ? cY : (input.y ?? 0), atkDown = useC ? cY < -0.5 : input.down;
    const low = atkDown || atkY < -0.5;
    let strong = (input.strong && !fighter.previous.strong) || cEdge;
    const down = input.down && !fighter.previous.down;
    let specialPressed = !!input.special && !fighter.previous.special;
    // Tap jump like the original: a fresh upward stick flick counts as a jump press
    // (ftCo threshold ~0.66); holding up never retriggers, and a same-frame attack,
    // smash or special edge keeps its priority (up-tilt/up-smash/up-special inputs).
    if (input.y > 0.66 && (previous.y ?? 0) <= 0.66 && !attack && !strong && !specialPressed) jump = true;
    // Fighter x67F: frames since an L/R/Z press (shield or grab here), read by the L-cancel window.
    fighter.link.shieldAge = (input.shield && !previous.shield) || (input.grab && !previous.grab) ? 0 : Math.min(255, fighter.link.shieldAge + 1);
    // Fighter_UnkIncrementCounters_8006ABEC: the gap since the previous jump / up-special
    // press (x68A / x68B) keeps a mashed input from meteor canceling.
    const recovery = fighter.hitstunInput, jumpGap = recovery.jumpAge, upSpecialGap = recovery.upSpecialAge;
    const upSpecialPressed = specialPressed && selectSpecial(input) === 'up';
    recovery.jumpAge = jump ? 0 : Math.min(255, recovery.jumpAge + 1);
    recovery.upSpecialAge = upSpecialPressed ? 0 : Math.min(255, recovery.upSpecialAge + 1);
    fighter.previous = { ...input };
    // Merged attack vector + original flick-smash windows. `atk` carries the
    // C-stick's direction on its flick frame (with a synthesized Strong hold) and
    // the left stick otherwise; `atkPrev` synthesizes the matching Strong history
    // so item, turnip, tether and ledge code sees a flick exactly like Strong plus
    // that left-stick direction. The flick windows reuse the original PlCo
    // stick-timing thresholds also used for item throws (`lib/game/items.ts`), so
    // tapping the left stick fast while pressing attack smashes like the original
    // game; held directions keep tilts, and run keeps the dash attack.
    const atk: PlayerInput = { ...input, x: atkX, y: atkY, down: atkDown, strong: heldStrong };
    const atkPrev: PlayerInput = { ...previous, strong: !!previous.strong || cStickActive(previous) };
    const itemT = this.content.common.itemInput;
    // Fallbacks repeat the original PlCo values (side window 6, vertical gates
    // ±0.6625 with 4-frame windows) for content that omits the table.
    const flickSide = attack && Math.abs(atkX) >= this.content.common.dashThreshold && fighter.link.sideTicks < (this.content.common.smashInputWindow ?? 6);
    const flickUp = attack && atkY >= (itemT?.smashUp ?? 0.6625) && fighter.link.verticalTicks < (itemT?.upWindow ?? 4);
    const flickDown = attack && atkY <= (itemT?.smashDown ?? -0.6625) && fighter.link.verticalTicks < (itemT?.downWindow ?? 4);
    // Every displacement this frame — special-move helpers, root motion, tethers, the plain
    // velocity step — is checked against walls/ceilings and floors from here, not from the
    // position just before the velocity step (Fire Fox, Illusion, Skull Bash, Teleport,
    // Falcon Kick, Screw Attack and Super Jump Punch used to tunnel through terrain).
    const frameX = fighter.x, frameY = fighter.y;
    if (fighter.invulnerable > 0) fighter.invulnerable--;
    if (fighter.ignoreTicks > 0) fighter.ignoreTicks--; else fighter.ignoreFloor = null;
    if (fighter.downWindow > 0) fighter.downWindow--;
    if (down) fighter.downWindow = this.content.common.fastFallWindow;
    if (fighter.state === 'ko') {
      if (++fighter.stateFrame >= 45 && fighter.stocks > 0) {
        const spawn = this.spawn(fighter.slot);
        fighter.x = spawn[0]; fighter.y = Math.min(this.content.stage.blast.top - 20, Math.max(75, spawn[1] + 40));
        fighter.percent = 0; fighter.poison = null; fighter.combat=createCombat(this.content); fighter.velocity = { x: 0, y: 0 }; fighter.knockback = { x: 0, y: 0 };
        fighter.grounded = false; fighter.floor = null; fighter.jumpsUsed = 1; fighter.hitstun = 0; fighter.hitlag = 0;
        fighter.invulnerable = 150; fighter.capeBoostUsed = false; fighter.tornadoUsed = false; fighter.popoHoverUsed = false; fighter.hammerBoostUsed = false; fighter.mewtwoBoostUsed = false; fighter.copyAbility = null; this.change(fighter, 'respawn', 'Fall');
        this.events.push({ type: 'respawn', player: fighter.slot, x: fighter.x, y: fighter.y });
        // Sopo ends here: Nana revives beside Popo on the platform, protected
        // like him, once a partner model is loaded for the slot.
        if (fighter.nana) {
          const nana = fighter.nana;
          nana.active = true; nana.percent = 0; nana.tumble = 0; nana.lastHitBy = null;
          nana.x = f32(fighter.x - fighter.facing * NANA_ANCHOR_BACK); nana.y = f32(fighter.y);
          nana.vx = 0; nana.vy = 0; nana.grounded = false; nana.floor = null;
          nana.invulnerable = 150; nana.facing = fighter.facing;
        }
      }
      return;
    }
    if (fighter.state === 'respawn') {
      fighter.stateFrame++;
      if (fighter.stateFrame >= 60 || (fighter.stateFrame >= 20 && (input.x !== 0 || jump || attack || strong || cEdge))) this.change(fighter, 'fall', 'Fall');
      else return;
    }
    if (fighter.jab && (!fighter.grounded || !['attack', 'idle'].includes(fighter.state))) fighter.jab = null;
    if (fighter.jab) captureJabInput(fighter.jab, fighter.content, attack && !low && !strong && !specialPressed, releasedAttack);
    if (fighter.hitlag > 0) { fighter.hitlag--; return; }
    // Fighter.c item-effect timers; a running mushroom ramp freezes the fighter (ftCo_Kinoko*).
    if (fighter.itemFx) {
      const fx = fighter.itemFx;
      if (fx.ramp) { this.stepSizeRamp(fighter); return; }
      let changed = false;
      if (fx.size !== 0 && fx.sizeTimer > 0 && --fx.sizeTimer === 0) this.startSizeRamp(fighter, 1, fx.size === 1 ? 1 : 0, 0);
      if (fx.bunny > 0 && --fx.bunny === 0) changed = true;
      if (fx.metal > 0 && (--fx.metal === 0 || fx.metalHealth <= 0)) { fx.metal = 0; changed = true; }
      if (fx.cloak > 0) fx.cloak--;
      if (changed) this.refreshFxAttributes(fighter);
    }
    // PROTOTYPE (roguelike): venom damage-over-time. Percent only — never launches, so
    // poison softens rivals for KOs without ever scoring one by itself.
    if (fighter.poison) {
      fighter.poison.ticks--;
      if (fighter.poison.ticks <= 0) fighter.poison = null;
      else if (fighter.poison.ticks % POISON_TICK_EVERY === 0) {
        fighter.percent = Math.min(999, f32(fighter.percent + fighter.poison.amount));
        this.events.push({ type: 'hit', player: fighter.slot, x: fighter.x, y: fighter.y, damage: fighter.poison.amount });
      }
    }
    if (fighter.hex) rogueTick(fighter, this.events);
    // Wave E item statuses: tick the timer; the Warp Star ride crashes on landing with
    // the star's own script blast, and an expiring Hammer vanishes from the hand.
    if (fighter.itemStatus) {
      fighter.itemStatus.timer--;
      if (fighter.itemStatus.kind === 'warp') {
        const ride = fighter.itemStatus;
        fighter.invulnerable = Math.max(fighter.invulnerable, 2);
        if (!ride.fall) {
          // WarpStarJump: x1C frames on the path, or until past the top blast line; then the
          // rider reappears at the top above the launch point (ftCo_800C4A38).
          ride.frame = (ride.frame ?? 0) + 1;
          if (ride.timer <= 0 || fighter.y > this.content.stage.blast.top) {
            ride.fall = true; fighter.x = ride.ox ?? fighter.x; fighter.y = this.content.stage.blast.top;
            fighter.velocity = { x: 0, y: 0 }; fighter.grounded = false; fighter.floor = null;
          }
        } else if (fighter.grounded) {
          // ftCo_800C4C60: the star crashes into its blast and the rider pops out in JumpB.
          this.itemWorld.warpCrash(fighter, this.events);
          fighter.facing = ride.facing ?? fighter.facing;
          fighter.itemStatus = null;
          fighter.velocity = this.content.physics.jump(fighter.slot, { x: fighter.velocity.x, y: 0 }, 0, false);
          fighter.grounded = false; fighter.floor = null; fighter.jumpsUsed = 1;
          this.change(fighter, 'jump', fighter.content.clips.has('JumpB') ? 'JumpB' : 'JumpF');
        }
      }
      if (fighter.itemStatus && fighter.itemStatus.kind !== 'warp' && fighter.itemStatus.timer <= 0) {
        if (fighter.itemStatus.kind === 'hammer') this.itemWorld.consumeHeld(fighter);
        fighter.itemStatus = null;
      }
    }
    stepLinkDair(fighter);stepItemAnimation(fighter,(state,animation)=>this.change(fighter,state,animation));
    stepPeachFloat(fighter,input);
    // Skull Kid's OnFrame (bomb cooldown, B-detonation from attacks/landings/throws) and his float.
    skullkidOnFrame(fighter,input,specialPressed,fighter.skullkid.bomb!==null&&this.projectiles.items.some(p=>p.id===fighter.skullkid.bomb&&p.kind==='skull-bomb'));
    stepSkullKidFloat(fighter,input);
    if((fighter.content.profile.kind==='Kp'||fighter.content.profile.kind==='Gk')&&fighter.special?.direction!=='neutral'){
      const kp=fighter.content.specials.parameters;
      if(kp.kind==='Kp'||kp.kind==='Gk')fighter.koopaBreath=Math.min(kp.breath.maxStrength,f32(fighter.koopaBreath+kp.breath.recoverStrength));
    }
    refuelLizardon(fighter);
    if(peachThrowTurnip(fighter,atk,atkPrev,this.content.common,this.shots))return;
    if(stepTether(fighter,atk,atkPrev,this.hookHost()))return;
    if (fighter.jab) {
      const next = stepJab(fighter.jab, fighter.content, fighter.animationFrame, fighter.state === 'attack');
      if (next) this.attack(fighter, next, true);
      else if (fighter.state === 'idle' && fighter.jab.window === 0) fighter.jab = null;
    }
    const attrs = fighter.content.profile.attributes;
    if(this.combat.before(fighter,atk,atkPrev))return;
    if(stepSmash(fighter,heldStrong,this.content.common.chargeSoundFrame))this.events.push({type:'sound',player:fighter.slot,x:fighter.x,y:fighter.y,sound:123,volume:127,pan:64});
    let justJumped = false;
    if (fighter.trip && fighter.state === 'hitstun') stepTrip(fighter);
    if (fighter.state === 'hitstun') {
      fighter.hitstun--;
      const rules = this.content.common.hitstunRecovery ?? HITSTUN_RECOVERY;
      if (fighter.hitstun <= 0) {
        this.change(fighter, fighter.grounded ? 'idle' : 'fall', fighter.grounded ? 'Wait1' : 'Fall');
        // ftCo_Damage_IASA: a jump pressed during the last frames of hitstun comes out on the first actionable frame.
        if (recovery.jumpAt > 0 && recovery.jumpAt <= rules.jumpBuffer) jump = true;
        recovery.jumpAt = 0; recovery.meteorLock = -1;
      } else {
        // doIasa (ftCo_Damage.c): after the lockout, a downward meteor launch is canceled by a fresh
        // up-special or midair jump, which drops the knockback; otherwise a jump press is remembered.
        if (recovery.meteorLock > 0) recovery.meteorLock--;
        const meteor = recovery.meteorLock === 0 && !fighter.grounded && fighter.knockback.y < 0;
        if (meteor && upSpecialPressed && upSpecialGap >= rules.pressGap) {
          this.cancelMeteor(fighter);
          beginSpecial(fighter, 'up', input, this.content.common);
        } else if (meteor && jump && jumpGap >= rules.pressGap && this.canAirJump(fighter)) {
          this.cancelMeteor(fighter);
          this.airJump(fighter, input); jump = false; justJumped = true;
        } else if (jump) recovery.jumpAt = fighter.hitstun;
      }
    }
    if (fighter.state === 'landing' && fighter.stateFrame >= fighter.landingFrames) this.change(fighter, 'idle', 'Wait1');
    if (fighter.state === 'attack' && fighter.animationFrame >= fighter.content.clips.get(fighter.animation)!.endFrame) {
      if(fighter.content.hookshot&&fighter.animation==='AirCatch'&&!fighter.grounded){this.change(fighter,'helpless','Fall');fighter.jumpsUsed=attrs.maxJumps;fighter.specialLandingLag=fighter.content.clips.get('Landing')!.endFrame;}
      else this.change(fighter, fighter.grounded ? 'idle' : 'fall', fighter.grounded ? 'Wait1' : 'Fall');
    }
    if ((fighter.state === 'jump' || fighter.state === 'airjump') && fighter.animationFrame >= fighter.content.clips.get(fighter.animation)!.endFrame) this.change(fighter, 'fall', 'Fall');
    if (fighter.state === 'squat') {
      if (!input.jump && input.y <= 0.66) fighter.shortHop = true; // stick held up keeps the full hop
      // Original jump-squat cancels (ftCo KneeBend interrupts): an up-smash or an
      // up-special input during the startup takes over instead of the jump.
      if (specialPressed && selectSpecial(input) === 'up') beginSpecial(fighter, 'up', input);
      else if (((attack && flickUp) || strong) && atkY > 0.5 && fighter.content.moves.upSmash) this.attack(fighter, fighter.content.moves.upSmash);
      else if (fighter.stateFrame >= attrs.jumpStartup) {
        fighter.velocity = this.content.physics.jump(fighter.slot, fighter.velocity, input.x, fighter.shortHop);
        // ftCo_ItemScrew_Enter: a held Screw Attack jumps at ftCo_800CB110's x800 multiplier.
        const screw = this.itemWorld.screwHeld(fighter), screwMul = this.content.common.itemStatus?.screwJump ?? 1;
        if (screw) fighter.velocity = { x: f32(fighter.velocity.x * screwMul), y: f32(fighter.velocity.y * screwMul) };
        fighter.grounded = false; fighter.floor = null; fighter.jumpsUsed = 1; fighter.fastFall = false;
        this.change(fighter, 'jump', screw && fighter.content.clips.has('ItemScrew') ? 'ItemScrew' : 'JumpF'); justJumped = true;
        this.events.push({ type: 'jump', player: fighter.slot, x: fighter.x, y: fighter.y, sound: fighter.content.specials.sounds.jump });
      }
    }
    if (jump && canShineJump(fighter)) finishSpecial(fighter);
    if (canLinkSmashFollowup(fighter, attack || strong)) this.attack(fighter, 'AttackS42', true);
    // ftCo_Attack13_IASA delegates to Wait_IASA after the authored interrupt
    // gate: a fresh attack can restart the chain before its animation ends.
    // Do not generalize this to Attack11/12 (their neutral-attack branches
    // only chain), or finish the recovery without an actual input.
    const finisherGate = fighter.attackName !== null && fighter.attackName === fighter.content.moves.jab3
      ? fighter.content.attacks.get(fighter.attackName)?.interruptFrame : null;
    const finisherAttack = fighter.state === 'attack' && fighter.grounded && (attack || strong)
      && finisherGate != null && fighter.animationFrame >= finisherGate;
    // ftCo_AttackS3_IASA, ftCo_AttackDash_IASA and the rest delegate to ftCo_Wait_IASA once the
    // script's authored interrupt frame has passed, so a grounded normal's recovery takes the next
    // action instead of playing out. The original never ends the move on its own, so this needs a
    // real input; a charging smash still owns the button, and jab 1/2 keep their own chain gate
    // (ftCo_Attack11_IASA runs checkAttack12 before anything else and never restarts jab 1).
    const iasaFrame = fighter.state === 'attack' && fighter.grounded && fighter.attackName !== null
      && fighter.attackName !== fighter.content.moves.jab && fighter.attackName !== fighter.content.moves.jab2
      && fighter.smash?.phase !== 'charging'
      ? fighter.content.attacks.get(fighter.attackName)?.interruptFrame ?? null : null;
    const interruptible = iasaFrame !== null && fighter.animationFrame >= iasaFrame
      && (jump || attack || strong || specialPressed || !!input.shield || !!input.grab || !!input.x || low);
    const interruptedInput=linkInterruptInput(fighter,atk,atkPrev,this.content.common);
    if(interruptedInput){
      input={...interruptedInput,y:interruptedInput.y??0};
      jump=input.jump&&!previous.jump;attack=input.attack&&!previous.attack;strong=(!!input.strong&&!atkPrev.strong)||cStickEdge(input,previous);specialPressed=!!input.special&&!previous.special;
    }
    // Native special IASA windows (Sonic's cancel/landing states once their script raises
    // flag 0, aerials out of the spin-charge jump): hand the input to the normal action pass.
    const specialWindow = fighter.state === 'special' ? specialInterruptible(fighter) : null;
    if (specialWindow && (attack || strong || (specialWindow === 'aerial-jump' && jump) || (specialWindow === 'full' && (jump || specialPressed || !!input.shield || !!input.grab || (fighter.grounded && (!!input.x || low)))))) finishSpecial(fighter);
    const canAct = (interruptedInput!==null || finisherAttack || interruptible || ['idle', 'walk', 'run', 'crouch', 'jump', 'airjump', 'fall'].includes(fighter.state)) && !bsonicFallLocked(fighter, attack || strong || specialPressed || specialWindow !== null);
    if (canAct) {
      const itemHandled=!specialPressed&&!jump&&handleItemInput(fighter,atk,atkPrev,this.projectiles,this.content,(state,animation)=>this.change(fighter,state,animation),this.itemWorld,this.events);
      if (fighter.grounded && atk.x && !input.shield && !itemHandled && !skidOwnsFacing(fighter)) fighter.facing = atk.x > 0 ? 1 : -1;
      if (itemHandled) { /* Native item pickup/throw takes the attack input. */ }
      else if (this.combat.tryAction(fighter,atk,atkPrev)) { /* Defense/grab owns this input. */ }
      // A heavy crate carry blocks specials and jumps (ftCo heavy-item locks).
      else if (specialPressed && !this.itemWorld.heavyHeld(fighter) && !['hammer','warp'].includes(fighter.itemStatus?.kind ?? '')) beginSpecial(fighter, selectSpecial(input), input, this.content.common);
      else if (jump && !justJumped && !this.itemWorld.heavyHeld(fighter) && !['hammer','warp'].includes(fighter.itemStatus?.kind ?? '')) {
        if (fighter.grounded) { fighter.shortHop = false; this.change(fighter, 'squat', 'Landing'); }
        else if (this.canAirJump(fighter)) { this.airJump(fighter, input); justJumped = true; }
      } else if ((attack || strong) && !['hammer','warp'].includes(fighter.itemStatus?.kind ?? '')) {
        const moves = fighter.content.moves;
        const high=atkY>0.5,side=Math.abs(atkX)>0.28;
        const sideSmash = strong || flickSide, upSmash = strong || flickUp, downSmash = strong || flickDown;
        const name = fighter.grounded
          ? (low ? (downSmash ? moves.downSmash : moves.downTilt)
            : high&&(upSmash?moves.upSmash:moves.upTilt) ? (upSmash?moves.upSmash!:moves.upTilt!)
            : sideSmash ? peachSmashName(fighter, this.content.physics) : fighter.state==='run'&&!input.walk ? moves.dash : side&&moves.sideTilt ? moves.sideTilt : moves.jab)
          : low ? moves.downAir : high&&moves.upAir ? moves.upAir : side&&atkX*fighter.facing<0&&moves.backAir ? moves.backAir : strong ? moves.forwardAir : moves.neutralAir;
        // A held battering item swaps grounded forward/neutral normals for its swing
        // (ftCo_Attack_800CCF58); up/down attacks keep the fighter's own moves.
        const swingCategory = fighter.grounded && !low && !high ? (sideSmash ? 'smash' as const : fighter.state === 'run' && !input.walk ? 'dash' as const : side ? 'tilt' as const : 'jab' as const) : null;
        const swing = swingCategory ? this.itemWorld.swingFor(fighter, swingCategory) : null;
        this.attack(fighter, swing ?? name);
      } else if (fighter.grounded) {
        if (low) {
          if (fighter.state !== 'crouch' || fighter.animation === 'SquatRv') this.change(fighter, 'crouch', 'Squat');
          else if (fighter.animation === 'Squat' && fighter.animationFrame >= fighter.content.clips.get('Squat')!.endFrame) this.change(fighter, 'crouch', fighter.content.motions?.crouchWait ?? 'SquatWait');
        } else if (!input.walk && !this.itemWorld.heavyHeld(fighter) && this.stepRunPhase(fighter, input.x)) {
          /* Dash, Run, TurnRun and RunBrake read the stick themselves. */
        } else if (input.x) {
          const walking=!!input.walk||Math.abs(input.x)<this.content.common.dashThreshold||this.itemWorld.heavyHeld(fighter);
          if(walking){if(fighter.state!=='walk')this.change(fighter,'walk','WalkSlow');}
          else if (fighter.state !== 'run') {
            // ftCo_Dash_Enter starts every dash at the full initial velocity; fighters without the Dash motion keep the stick-scaled Run start.
            if (hasMeleeRun(fighter.content)) { fighter.facing = input.x > 0 ? 1 : -1; fighter.velocity.x = f32(fighter.facing * attrs.dashInitial); this.change(fighter, 'run', 'Dash'); }
            else { fighter.velocity.x = f32(input.x * attrs.dashInitial); this.change(fighter, 'run', 'Run'); }
          }
        } else if (fighter.state === 'crouch') {
          if (fighter.animation !== 'SquatRv') this.change(fighter, 'crouch', 'SquatRv');
          else if (fighter.animationFrame >= fighter.content.clips.get('SquatRv')!.endFrame) this.change(fighter, 'idle', 'Wait1');
        } else if (fighter.state !== 'idle') this.change(fighter, 'idle', 'Wait1');
      }
    }
    // Hammer lock (PROTOTYPE): the idle pose swaps for the shared hammer-swing motion.
    if (fighter.itemStatus?.kind === 'hammer' && fighter.state === 'idle' && fighter.animation === 'Wait1' && fighter.content.clips.has('ItemHammerWait')) this.change(fighter, 'idle', 'ItemHammerWait');
    const currentFloor = this.content.stage.floors.find((floor) => floor.id === fighter.floor);
    if (down && fighter.grounded && currentFloor?.oneWay && ['idle', 'walk', 'run', 'crouch'].includes(fighter.state)) {
      this.logGroundLoss(fighter, currentFloor.id, 'drop-through', `drop-through one-way ${currentFloor.id}`);
      fighter.ignoreFloor = currentFloor.id; fighter.ignoreTicks = 12; fighter.grounded = false; fighter.floor = null;
      fighter.jumpsUsed = 1; this.change(fighter, 'fall', 'Fall');
    }
    if (['jump','airjump','fall','attack','helpless'].includes(fighter.state) && !fighter.grounded && fighter.velocity.y < 0 && fighter.downWindow > 0 && input.down) fighter.fastFall = true;
    const specialStep = stepSpecial(fighter, input, specialPressed, this.content.physics, this.content.combat.dodge, fighter.special ? {
      fighters: this.fighters, teams: !!this.options.teams, teamOf: (other) => hillTeamOfSlot(other.seatId ?? other.slot),
      springs: this.projectiles.items.filter((item) => item.kind === 'sonic-spring').map((item) => ({ x: item.x, y: item.y })),
      floor: fighter.floor === null ? undefined : this.content.stage.floors.find((floor) => floor.id === fighter.floor), poses: this.poses,
      jumpPressed: jump, shieldPressed: (!!input.shield && !previous.shield) || (!!input.grab && !previous.grab),
      turnStick: this.content.common.turnStick, attackPressed: attack || strong,
      bananaOut: fighter.content.profile.kind === 'Dd' && this.projectiles.items.some((item) => item.kind === 'diddy-banana' && item.owner === fighter.slot),
      tailsShotOut: fighter.content.profile.kind === 'Ts' && this.projectiles.items.some((item) => item.kind === 'tails-shot' && item.owner === fighter.slot),
    } : undefined);
    this.shots.push(...specialStep.shots);
    for (const fx of specialStep.effects ?? []) {
      const bone = fx.bone ?? fighter.content.profile.partJoints[fx.part];
      if (bone === undefined || bone >= fighter.content.profile.boneCount) continue;
      const point = this.poses.point(fighter, bone, fx.offset ?? [0, 0, 0]);
      this.events.push({ type: 'gfx', player: fighter.slot, x: point[0], y: point[1], effect: fx.effect, facing: fighter.facing });
    }
    for (const spawn of specialStep.items ?? []) {
      const bone = fighter.content.profile.partJoints[spawn.part];
      if (bone === undefined || bone < 0 || bone >= fighter.content.profile.boneCount) continue;
      const point = this.poses.point(fighter, bone, spawn.offset);
      this.itemWorld.spawnFood(point[0], point[1]);
    }
    // Special-owned throw releases (PlDd SpecialS_ThrowDetach): the original knockback, no hitlag.
    for (const strike of specialStep.strikes ?? []) {
      const victim = this.fighters[strike.victim];
      if (!victim || victim.state === 'ko' || victim.state === 'respawn') continue;
      this.applyHit(fighter, victim, strike.hit, strike.point, strike.direction);
      victim.hitlag = 0; fighter.hitlag = 0;
      this.events.push({ type: 'throw', player: fighter.slot, x: victim.x, y: victim.y, damage: strike.hit.damage });
    }
    if (specialStep.transform) this.transformFighter(fighter, specialStep.transform);
    // The step already ended the special; the roll itself belongs to the shared Escape routine.
    if (specialStep.roll) this.combat.roll(fighter, specialStep.roll);
    for (const sound of specialStep.sounds) this.events.push({ type: 'sound', player: fighter.slot, x: fighter.x, y: fighter.y, sound, volume: 127, pan: 64, scope: fighter.special?.serial });
    enterSkullKidFloat(fighter, input, this.content.common.fastFallThreshold, justJumped || attack || strong || specialPressed);
    const controllable = !['hitstun','shield-break','dizzy','air-dodge','ledge-jump','frozen'].includes(fighter.state);
    if (this.combat.physics(fighter)) { /* Original dodge/root-motion parameters. */ }
    else if (specialStep.handled) { /* Special physics already ran through the selected helpers. */ }
    else if (fighter.grounded) {
      const rootMotion = (fighter.state === 'attack' || fighter.state === 'grab') && this.attackRootMotion(fighter);
      // ft_80085030: grounded attack scripts move by their TransN track (dash attacks, lunging smashes); frozen charge frames add nothing.
      fighter.velocity.x = rootMotion ? this.content.physics.motion(fighter.slot, f32(rootDelta(fighter).z * fighter.animationRate), 0, fighter.facing).x
        : fighter.state==='walk'
        ? this.content.physics.walk(fighter.slot,fighter.velocity.x,input.x)
        // ftKb_EatWalk_Phys: ftWalkCommon with acceleration and target scaled by specialn_walk_speed.
        // ftDk_ThrowFWalk_Phys uses the same walk with multiplier 1.
        : inhaleWalking(fighter)
        ? this.content.physics.walk(fighter.slot,fighter.velocity.x,f32(input.x*fighter.content.inhale!.walkSpeed))
        : cargoWalking(fighter)
        ? this.content.physics.walk(fighter.slot,fighter.velocity.x,input.x)
        // ftCo_Dash_Phys skips its entry frame; ftCo_TurnRun_Phys accelerates toward the new side without the run taper.
        : fighter.state==='run'&&fighter.animation==='Dash' ? (fighter.stateFrame===0 ? fighter.velocity.x : this.content.physics.dash(fighter.slot,fighter.velocity.x,input.x))
        : fighter.state==='run'&&fighter.animation==='TurnRun' ? this.content.physics.turnRun(fighter.slot,fighter.velocity.x,input.x,turnRunStartFacing(fighter))
        // ft_80084F3C: standing states (Wait, Squat, Guard, Landing, KneeBend, ground attacks, Damage) double
        // their friction above walk speed. RunBrake, dash attacks and grabs keep their own single friction.
        : fighter.state!=='run'&&fighter.animation!=='RunBrake'&&(isLink(fighter)||(fighter.state!=='grab'&&fighter.state!=='holding'&&fighter.state!=='throw'&&fighter.state!=='captured'&&!(fighter.state==='attack'&&fighter.attackName===fighter.content.moves.dash)))
        ? this.content.physics.stationaryGround(fighter.slot,fighter.velocity.x)
        : this.content.physics.ground(fighter.slot, fighter.velocity.x, fighter.state === 'run' ? input.x : 0);
      fighter.velocity.y = 0;
    } else if (fighter.state === 'frozen') {
      // ftCo_DamageIce_Phys: the block falls under its own lightened gravity and keeps its drift.
      const ice = this.content.combat.ice;
      fighter.velocity = this.content.physics.customAir(fighter.slot, fighter.velocity, f32(attrs.gravity * ice.gravity), attrs.terminal, 0);
    } else if (!justJumped && fighter.itemStatus?.kind !== 'warp') {
      fighter.velocity = skullkidFloatVelocity(fighter, input, this.content.physics) ?? stepAirJump(fighter, input, this.content.physics) ?? this.content.physics.air(fighter.slot, fighter.velocity, controllable ? input.x * (fighter.state === 'helpless' ? fighter.specialMobility : 1) : 0, fighter.fastFall);
      // ftPe_Float_Phys: the hover cancels gravity entirely while Fuwafuwa holds.
      if (fighter.animation === 'Fuwafuwa') fighter.velocity.y = 0;
    }
    fighter.knockback = this.content.physics.decay(fighter.knockback, fighter.grounded, attrs.friction);
    // Warp Star ride: the WarpStarJump/WarpStarFall physics replace the air physics above.
    if (fighter.itemStatus?.kind === 'warp') {
      const ride = fighter.itemStatus, common = this.content.common.itemStatus;
      if (!ride.fall) {
        // WarpStarJump_Phys: the fighter root follows the chosen path's translation deltas.
        const path = this.content.items?.warpPaths()[ride.path ?? 0];
        if (path) {
          const i = Math.min(ride.frame ?? 0, path.x.length - 1), j = Math.max(0, i - 1);
          fighter.velocity = { x: f32(path.x[i]! - path.x[j]!), y: f32(path.y[i]! - path.y[j]!) };
        }
      } else if (common) {
        // WarpStarFall_Phys: ftCommon_Fall(x694, x698) and the x69C/x6A0/x6A4 stick drift.
        const stick = input.x, vy = Math.max(-common.warpTerminal, f32(fighter.velocity.y - common.warpGravity));
        let vx = fighter.velocity.x;
        const target = f32(stick * common.warpDriftMax), accel = f32(stick * common.warpDriftScale + (stick > 0 ? common.warpDriftFlat : -common.warpDriftFlat));
        if (target) {
          if (vx * accel < 0) vx = f32(vx + accel);
          else if (accel > 0) vx = vx + accel > target ? Math.max(vx - common.warpFriction, Math.min(vx, target)) : f32(vx + accel);
          else vx = vx + accel < target ? Math.min(vx + common.warpFriction, Math.max(vx, target)) : f32(vx + accel);
        }
        fighter.velocity = { x: vx, y: vy };
      }
    }
    const oldX = frameX, oldY = frameY;
    // PROTOTYPE (roguelike): speed boons/slows scale only the self-movement step
    // (`rogueMoveMul` is exactly 1 outside Rift Descent and for knockback/attacks/specials).
    const rogueMove = rogueMoveMul(fighter);
    fighter.x = f32(fighter.x + f32((rogueMove === 1 ? fighter.velocity.x : f32(fighter.velocity.x * rogueMove)) + fighter.knockback.x));
    fighter.y = f32(fighter.y + f32(fighter.velocity.y + fighter.knockback.y));
    fighter.envContact = null;
    this.blockSurfaces(fighter, oldX, oldY);
    if (fighter.grounded) {
      if(fighter.state==='dodge'){
        const origin=this.content.stage.floors.find(f=>f.id===fighter.floor);
        if(origin){
          let left=Math.min(origin.a[0],origin.b[0]),right=Math.max(origin.a[0],origin.b[0]);
          for(let pass=0;pass<this.content.stage.floors.length;pass++)for(const floor of this.content.stage.floors){
            const a=Math.min(floor.a[0],floor.b[0]),b=Math.max(floor.a[0],floor.b[0]);
            if(Math.abs(floor.a[1]-oldY)<0.01&&a<=right+0.001&&b>=left-0.001){left=Math.min(left,a);right=Math.max(right,b);}
          }
          fighter.x=Math.max(left+0.001,Math.min(right-0.001,fighter.x));
        }
      }
      // Sloped ground follow: stay attached to any segment whose height at the new x is
      // reachable within this tick's horizontal motion. Flat floors keep the old 0.01 gate.
      // Only floors joined end to end with the current one qualify (the original follows
      // line adjacency): a dash over a plateau lip goes airborne instead of snapping down
      // onto whatever floor lies within the slope tolerance below.
      const follow = Math.abs(fighter.x - oldX) * MAX_FLOOR_SLOPE + 0.1;
      // Spinning Yoshi blocks are phased out of the active set (original disables the
      // joint's lines mid-spin); chain ids still come from the full stage so they stay stable.
      const floors = this.activeFloors();
      const chains = floorChains(this.content.stage), mine = fighter.floor === null ? undefined : chains.get(fighter.floor);
      // Floors of the same chain also bridge sub-unit seams (stitched terrain/body joints on
      // Stadium): a gap counts only when another chain floor continues on the far side.
      const chained = (floor: Floor) => mine !== undefined && chains.get(floor.id) === mine;
      const near = (floor: Floor, margin: number) => fighter.x >= Math.min(floor.a[0], floor.b[0]) - margin && fighter.x <= Math.max(floor.a[0], floor.b[0]) + margin;
      const seam = (floor: Floor) => chained(floor) && near(floor, 1) && floors.some((other) => other !== floor && chained(other) && near(other, 1.5));
      const spans = (floor: Floor) => between(fighter.x, floor.a[0], floor.b[0]) || seam(floor);
      let support = floors.filter((floor) => spans(floor) && Math.abs(floorY(floor, fighter.x) - oldY) < follow && (mine === undefined || chained(floor)))
        .sort((a, b) => Math.abs(floorY(a, fighter.x) - oldY) - Math.abs(floorY(b, fighter.x) - oldY))[0];
      // Where two solid floors overlap a few units apart (a terrain edge running under an
      // apron), the upper one is the walkable surface, as after the original's joint stitching.
      if (support && !support.oneWay) {
        const upper = floors.filter((floor) => !floor.oneWay && floor !== support && between(fighter.x, floor.a[0], floor.b[0]) && floorY(floor, fighter.x) > floorY(support!, fighter.x) && floorY(floor, fighter.x) <= floorY(support!, fighter.x) + 2)
          .sort((a, b) => floorY(b, fighter.x) - floorY(a, fighter.x))[0];
        if (upper) support = upper;
      }
      if (support) { fighter.floor = support.id; fighter.y = floorY(support, fighter.x); }
      else if (inhaleWalking(fighter) || cargoWalking(fighter)) {
        // ftKb_MS_EatFall / ftDk_MS_ThrowFFall are not ported: a carry walk stops at the
        // ledge instead of leaving the ground.
        fighter.x = oldX; fighter.velocity.x = 0;
      }
      else if ((fighter.state === 'idle' || (fighter.state === 'special' && specialStopsAtLedge(fighter))) && floors.some((floor) => floor.id === fighter.floor && between(oldX, floor.a[0], floor.b[0]))) {
        // ftCo_Wait_Coll / ftCo_RunBrake_Coll (ft_80084280): a standing slide stops at the ledge instead of
        // carrying off it. Only a slide past the end of the floor it still stands on; vanishing floors drop it.
        const edge = floors.find((floor) => floor.id === fighter.floor)!;
        fighter.x = f32(Math.max(Math.min(edge.a[0], edge.b[0]) + 0.001, Math.min(Math.max(edge.a[0], edge.b[0]) - 0.001, fighter.x)));
        fighter.y = floorY(edge, fighter.x); fighter.velocity.x = 0;
      }
      else {
        this.logGroundLoss(fighter, fighter.floor, this.groundLossReason(fighter, oldX, oldY, follow, mine, spans), `support lost at (${fighter.x.toFixed(1)},${oldY.toFixed(1)})->(${fighter.x.toFixed(1)},${fighter.y.toFixed(1)})`);
        fighter.grounded = false; fighter.floor = null; fighter.jumpsUsed = Math.max(1, fighter.jumpsUsed);
        // Inputs above may have started an attack/special; the old canAct value
        // must not cancel that new action on this same tick's ledge departure.
        if (['idle','walk','run','crouch'].includes(fighter.state)||fighter.smash) this.change(fighter, 'fall', 'Fall');
        if((fighter.content.profile.kind==='Lk'||fighter.content.profile.kind==='Cl')&&fighter.special?.direction==='up')fighter.jumpsUsed=attrs.maxJumps;
      }
    } else if (!kirbyIgnoresLanding(fighter)) {
      if (fighter.y <= oldY) {
        const candidates = this.activeFloors().filter((floor) => {
          const yLanding = floorY(floor, fighter.x);
          if (floor.id === fighter.ignoreFloor || oldY + 0.001 < floorY(floor, oldX) || fighter.y > yLanding) return false;
          const t = oldY === fighter.y ? 1 : (oldY - yLanding) / (oldY - fighter.y);
          return between(oldX + (fighter.x - oldX) * t, floor.a[0], floor.b[0]) && between(fighter.x, floor.a[0], floor.b[0]);
        }).sort((a, b) => floorY(b, fighter.x) - floorY(a, fighter.x));
        if (candidates[0]) {
          const floor = candidates[0], lo = Math.min(floor.a[0], floor.b[0]), hi = Math.max(floor.a[0], floor.b[0]);
          if (fighter.x < lo || fighter.x > hi) {
            // The span tolerance seals floor seams, but a slide down a leaning wall
            // can end just beyond its adjoining floor. Snapping only y there moves
            // the fighter through the wall. Land where the slide crossed the floor,
            // before it passed the endpoint (Peach's Castle tower ramps).
            const t = floorCrossing(floor, oldX, oldY, fighter.x, fighter.y) ?? 1;
            fighter.x = f32(Math.max(lo, Math.min(hi, oldX + (fighter.x - oldX) * t)));
          }
          this.land(fighter, floor);
        }
      }
      if (!fighter.grounded) {
        // Mostly-horizontal motion can cross a sloped solid's surface from its upper side
        // (Temple hillsides): land on the first crossed surface instead of sinking inside
        // the terrain. One-ways, drop-through and from-below passes stay untouched;
        // walls and ceilings remain unsimulated.
        const crossed = this.activeFloors()
          .map((floor) => ({ floor, t: floor.id === fighter.ignoreFloor || floor.oneWay ? null : floorCrossing(floor, oldX, oldY, fighter.x, fighter.y) }))
          .filter((entry): entry is { floor: Floor; t: number } => entry.t !== null)
          .sort((a, b) => a.t - b.t)[0];
        if (crossed) {
          // A diagonal fall onto a step corner (floor end meeting a vertical wall)
          // crosses the floor while the end point sits past the floor and past the
          // wall. Landing at the end point would teleport through the wall and drop
          // out of the map, so land at the crossing point clamped onto the floor span.
          const crossX = oldX + (fighter.x - oldX) * crossed.t;
          const lo = Math.min(crossed.floor.a[0], crossed.floor.b[0]);
          const hi = Math.max(crossed.floor.a[0], crossed.floor.b[0]);
          fighter.x = f32(Math.max(lo, Math.min(hi, crossX)));
          this.land(fighter, crossed.floor);
        }
      }
    }
    syncSpecialAnimation(fighter);
    this.combat.tryLedge(fighter,input,oldY);
    const blast = this.content.stage.blast;
    // ftCo_800C4724 sets x2222_b7: a Warp Star rider is never taken by the blast zones.
    const riding = fighter.itemStatus?.kind === 'warp';
    if (!riding && (fighter.x < blast.left || fighter.x > blast.right || fighter.y < blast.bottom || fighter.y > blast.top)) {
      // King of the Hill never takes a stock: knocked out fighters always come back.
      // PROTOTYPE (zombies): a last-stock KO infects instead of eliminating;
      // the infected keep one permanent stock and respawn forever.
      if (this.options.zombies && fighter.infected) {
        // The horde never loses its stock: every KO just respawns it.
      } else if (this.options.zombies && fighter.stocks <= 1) {
        fighter.infected = true;
        if (this.firstInfected === null) this.firstInfected = fighter.slot;
        this.events.push({ type: 'infect', player: fighter.slot, x: fighter.x, y: fighter.y });
      } else if (!this.hill && !rogueDefy(fighter, this.events)) fighter.stocks--; // PROTOTYPE (roguelike): Last Stand keeps the stock.
      this.events.push({ type: 'ko', player: fighter.slot, x: fighter.x, y: fighter.y });
      // Results-screen stats: every lost stock is a fall; a surviving rival's
      // last hit readable on the victim credits them the KO (else self-destruct).
      fighter.falls++;
      const killer = fighter.lastHitBy;
      if (killer !== null && killer !== fighter.slot && killer >= 0 && killer < this.fighters.length) this.fighters[killer]!.kos++;
      fighter.lastHitBy = null;
      fighter.poison = null; // A lost stock purges prototype venom.
      // PROTOTYPE (roguelike): vampiric boons heal living holders on any rival KO.
      // Neutral outside Rift Descent; CPU-vs-CPU KOs feeding the player is accepted prototype generosity.
      for (const other of this.fighters) {
        if (other === fighter || (other.rogue?.lifesteal ?? 0) <= 0 || other.state === 'ko' || other.state === 'respawn') continue;
        other.percent = Math.max(0, f32(other.percent - other.rogue.lifesteal));
      }
      if (fighter.hex || (killer !== null && (this.fighters[killer]?.rogue?.koBlast ?? 0) > 0)) rogueOnKo(this.fighters, this.events, fighter, killer);
      fighter.samusCharge = 0; fighter.samusSideTicks = 255; fighter.dkPunchCharge = 0; fighter.sonicCharge = 0; fighter.glideUsed = false; fighter.mewtwoCharge = 0; fighter.sheikNeedles = 0; fighter.gwOil = 0; fighter.gwOilDamage = 0;
      resetLizardonFuel(fighter);
      fighter.customState = customInitialState(fighter.content.profile.kind);
      fighter.link.sideTicks = 255; resetLinkDair(fighter);
      fighter.copyAbility = null; // ftKb_Init_OnDeath: the hat is gone as soon as Kirby dies.
      // Death clears every item effect (hood, metal, size, cloak, hammer, ride) and restores the attributes.
      fighter.itemStatus = null;
      if (fighter.itemFx) { fighter.itemFx = null; this.refreshFxAttributes(fighter); }
      this.change(fighter, 'ko', 'Fall');

    }
  }
  /** ftCo_800D105C: rewrite this slot's WASM attribute prefix with its active item modifiers. */
  private refreshFxAttributes(fighter: MatchFighter): void {
    const common = this.content.common.itemStatus, fx = fighter.itemFx;
    const words = common && fxActive(fx) ? statusWords(fighter.content.profile.words, fx, common) : fighter.content.profile.words;
    this.content.physics.configureSlot(fighter.slot, { ...fighter.content.profile, words });
  }
  /** Fighter_SuperMushroomApply / Fighter_PoisonMushroomApply: the same size refreshes its timer,
   * the opposite one shrinks/grows back to normal, otherwise the ramp toward x678/x680 starts. */
  private mushroom(fighter: MatchFighter, giant: boolean): void {
    const common = this.content.common.itemStatus;
    if (!common) return;
    const fx = fighter.itemFx ??= newItemFx();
    if (fx.ramp) this.finishSizeRamp(fighter);
    if (fx.size === (giant ? 1 : -1)) { fx.sizeTimer = common.sizeFrames; return; }
    if (fx.size === (giant ? -1 : 1)) { this.startSizeRamp(fighter, 1, giant ? 0 : 1, 0); return; }
    this.startSizeRamp(fighter, giant ? common.giantScale : common.smallScale, 0, giant ? 1 : -1);
  }
  /** fn_800D2B30 + fn_800D299C: park the velocity and ease along the Kinoko ramp curve. */
  private startSizeRamp(fighter: MatchFighter, to: number, curve: 0 | 1, size: 0 | 1 | -1): void {
    const fx = fighter.itemFx ??= newItemFx();
    fx.ramp = { from: fx.scale, to, frame: 0, curve, size, bonus: 0 };
    fx.parked = { x: fighter.velocity.x, y: fighter.velocity.y };
    fighter.velocity = { x: 0, y: 0 };
  }
  private stepSizeRamp(fighter: MatchFighter): void {
    const fx = fighter.itemFx!, ramp = fx.ramp!, curve = this.content.items?.kinokoRamp(ramp.curve) ?? [1];
    ramp.frame++;
    const sample = curve[Math.min(ramp.frame, curve.length - 1)]!;
    fx.scale = f32((ramp.to - ramp.from) * sample + ramp.from);
    if (ramp.frame >= curve.length - 1) this.finishSizeRamp(fighter);
  }
  /** ftCo_800D15D0 / ftCo_800D1F6C (and the End states): land on the target scale, restore the
   * parked velocity, arm the x688 timer (+ the percent over x68C, capped by x690, when giant). */
  private finishSizeRamp(fighter: MatchFighter): void {
    const fx = fighter.itemFx, common = this.content.common.itemStatus;
    if (!fx?.ramp) return;
    fx.scale = fx.ramp.to; fx.size = fx.ramp.size;
    if (fx.size !== 0 && common) {
      fx.sizeTimer = common.sizeFrames;
      if (fx.size === 1 && fighter.percent > common.sizeBonusFrom) fx.sizeTimer += Math.min(Math.trunc(fighter.percent - common.sizeBonusFrom), common.sizeBonusMax);
    } else fx.sizeTimer = 0;
    if (fx.parked) fighter.velocity = { x: fx.parked.x, y: fx.parked.y };
    fx.ramp = null; fx.parked = null;
    this.refreshFxAttributes(fighter);
  }
  private hookHost():HookHost {
    return {content:this.content,poses:this.poses,events:this.events,change:(f,state,animation)=>this.change(f,state,animation),ledge:(f,id)=>this.combat.takeLedge(f,id)};
  }
  /** Original ground locomotion for fighters with Dash/RunBrake/TurnRun motions: ftCo_Dash_IASA,
   * ftCo_Run_IASA, ftCo_TurnRun_Anim and ftCo_RunBrake_Anim/IASA. Returns false outside those
   * phases, leaving the stick to the plain walk and dash start. */
  private stepRunPhase(fighter: MatchFighter, x: number): boolean {
    const content = fighter.content;
    const phase = fighter.state === 'run' ? fighter.animation : fighter.state === 'idle' && fighter.animation === 'RunBrake' ? 'RunBrake' : '';
    if ((phase !== 'Dash' && phase !== 'Run' && phase !== 'TurnRun' && phase !== 'RunBrake') || !hasMeleeRun(content)) return false;
    const common = this.content.common, brake = common.runBrakeStick ?? RUN_BRAKE_STICK, turn = common.runTurnStick ?? RUN_TURN_STICK;
    const frame = fighter.animationFrame, ended = frame >= content.clips.get(phase)!.endFrame, forward = x * fighter.facing;
    // The script's cmd_vars[1] frame holds the motion (rate 0) until the momentum is spent.
    const holdAt = commandFrame(content, phase, 1), holding = holdAt !== null && frame >= holdAt && frame < holdAt + 1;
    switch (phase) {
      case 'Dash':
        if (forward <= -common.dashThreshold) {
          // ftCo_Dash_CheckInput → ftCo_Turn_Enter_Smash → ftCo_Dash_Enter: a smash back re-dashes the other
          // way, adding the initial velocity to momentum still carried the old way.
          fighter.facing = -fighter.facing;
          const initial = f32(fighter.facing * content.profile.attributes.dashInitial);
          fighter.velocity.x = fighter.velocity.x * fighter.facing < 0 ? f32(fighter.velocity.x + initial) : initial;
          this.change(fighter, 'run', 'Dash');
        } else if (forward >= brake && commandValue(content, 'Dash', 0, frame)) this.change(fighter, 'run', 'Run'); // fn_800CA5F0
        else if (ended) this.change(fighter, 'idle', 'Wait1'); // ft_8008A2BC
        return true;
      case 'Run':
        if (forward <= turn) this.change(fighter, 'run', 'TurnRun'); // fn_800C9D40
        else if (Math.abs(x) < brake) this.change(fighter, 'idle', 'RunBrake'); // ftCo_RunBrake_CheckInput
        return true;
      case 'TurnRun':
        if (holding) {
          if (fighter.animationRate !== 0) fighter.animationRate = 0;
          else if (fighter.velocity.x * fighter.facing <= 0.01) { fighter.facing = -fighter.facing; fighter.animationRate = 1; }
        }
        // fn_800CA644 keeps running the new way; otherwise the fighter stands.
        if (ended) this.change(fighter, forward >= brake ? 'run' : 'idle', forward >= brake ? 'Run' : 'Wait1');
        return true;
      default: {
        // ftCo_RunBrake_IASA → fn_800C9CEC: while the script keeps cmd_vars[0], pulling back turns the skid
        // around from its current pose (kept before TurnRun's hold frame so the turn still happens).
        if (forward <= turn && commandValue(content, 'RunBrake', 0, frame)) {
          const turnHold = commandFrame(content, 'TurnRun', 1);
          this.change(fighter, 'run', 'TurnRun');
          fighter.animationFrame = turnHold === null ? frame : Math.max(0, Math.min(frame, turnHold - 1));
          return true;
        }
        if (holding) {
          if (fighter.animationRate !== 0) fighter.animationRate = 0;
          else if (fighter.velocity.x === 0) fighter.animationRate = 1;
        }
        if (ended || fighter.stateFrame >= maxRunBrakeFrames(content)) this.change(fighter, 'idle', 'Wait1');
        return true;
      }
    }
  }
  private attackRootMotion(fighter: MatchFighter): boolean {
    const clip = fighter.content.clips.get(fighter.animation);
    return !!clip?.joints[fighter.content.profile.motionRoot]?.tracks.some((track) => track.type === 7);
  }
  private emitSounds(fighter: MatchFighter): void {
    const timeline = fighter.content.timelines.get(fighter.animation); if (!timeline) return;
    const clip = fighter.content.clips.get(fighter.animation)!;
    const loops = ['walk','fall','respawn','helpless'].includes(fighter.state) || locomotionLoops(fighter);
    const frame = loops && clip.endFrame > 0 ? fighter.animationFrame % clip.endFrame : fighter.animationFrame;
    const cursor = this.soundCursors[fighter.slot]!;
    const previous = cursor.epoch !== fighter.animationEpoch || frame < cursor.frame ? -1 : cursor.frame;
    for (const event of timeline.events) if (event.type === 'sound' && (!event.groundOnly||fighter.grounded) && event.frame > previous && event.frame <= frame) {
      this.events.push({ type: 'sound', player: fighter.slot, x: fighter.x, y: fighter.y, sound: event.sound, volume: event.volume, pan: event.pan, scope: fighter.special?.serial });
    }
    // Reuse the snapshotted animation cursor and confirmed event stream. Rendering
    // consumes these once; rollback cannot replay speculative dust/audio spawns.
    for(const event of timeline.events)if(event.type==='gfx'&&(!event.groundOnly||fighter.grounded)&&event.frame>previous&&event.frame<=frame){
      const bone=event.commonBone?fighter.content.profile.boneMap[event.bone]:fighter.content.profile.partJoints[event.bone];
      if(bone===undefined||bone===255||bone>=fighter.content.profile.boneCount)continue;
      const point=this.poses.point(fighter,bone,event.offset??[0,0,0]);
      const floor=this.content.stage.floors.find(f=>f.id===fighter.floor);
      const floorAngle=floor?Math.atan2(floor.b[1]-floor.a[1],floor.b[0]-floor.a[0]):0;
      this.events.push({type:'gfx',player:fighter.slot,x:point[0],y:point[1],effect:event.effect,facing:fighter.facing,floorAngle,bone,offset:event.offset??[0,0,0]});
    }
    cursor.epoch = fighter.animationEpoch; cursor.frame = frame;
  }
  /** Authored + article + projectile-ghost hits currently live on an attacker.
   * Shared by the fighter, Nana-echo and Nana-victim gathers so all three test
   * the same hit list. */
  private strikeHits(attacker: MatchFighter): ActiveHit[] {
    const move = attacker.content.attacks.get(attacker.attackName!)!;
    let hits = specialHits(attacker, purinHits(attacker, kirbyCopyHits(attacker, linkHits(attacker, dkHits(attacker, royHits(attacker, seakHits(attacker, gwShootHits(attacker, luigiHits(attacker, pikachuHits(attacker, chargedHits(attacker,activeHits(move, attacker.animationFrame),this.content.physics)))))))))));
    hits = customCharacter(attacker.content.profile.kind)?.hits?.(attacker, hits) ?? hits;
    if (attacker.special?.direction === 'side' && attacker.special.phase === 'travel' && (attacker.content.profile.kind === 'Fx' || attacker.content.profile.kind === 'Fc')) {
      const ghost = attacker.content.specials.articles.ghost?.hit;
      if (ghost) hits.push({ ...ghost, bone: attacker.content.profile.motionRoot, activation: 0 });
    }
    return hits;
  }
  /** Counter, shield-bubble and hurtbox tests for one hit at one world point.
   * Returns the connect kind, or null when the strike reaches nothing. Element
   * 11 (Raptor-Boost detect) never reaches here; element 8 keeps its grab rules. */
  private strikeConnect(victim: MatchFighter, hit: ActiveHit, point: V3): { shield: boolean; royCounter: boolean } | null {
    if(hit.element===8&&!this.combat.grabbable(victim))return null;
    // Element 11 is Raptor Boost's zero-damage detect box: it ignores shields and counters.
    const counter=hit.element===8||hit.element===11?null:royCounter(victim)??peachToadCounter(victim);
    if(counter){const center=this.poses.point(victim,counter.bone,counter.offset);if(Math.hypot(point[0]-center[0],point[1]-center[1],point[2]-center[2])<=counter.radius+hit.radius)return {shield:false,royCounter:true};}
    const shield=hit.element===8||hit.element===11?null:shieldBubble(victim,this.content,this.poses);
    if(shield&&Math.hypot(point[0]-shield.center[0],point[1]-shield.center[1],point[2]-shield.center[2])<=shield.radius+hit.radius)return {shield:true,royCounter:false};
    for (const hurt of fighterHurts(victim)) {
      if(hit.element===8&&hurt.grabbable===false)continue;
      if (!hurtEnabled(victim, hurt.bone)) continue;
      const a = this.poses.point(victim, hurt.bone, hurt.a), b = this.poses.point(victim, hurt.bone, hurt.b);
      if (pointSegmentDistanceSquared(point, a, b) <= (hit.radius + hurt.radius) ** 2) return {shield:false,royCounter:false};
    }
    return null;
  }
  /** Stage side effects of one connecting strike point (Yoshi spins, Onett
   * rooftop feed, Green Greens breaks); grabs and detects never trigger them. */
  private touchStage(strike: V3, radius: number, slot: number): void {
    for (const block of this.yoshiBlocksHit(strike[0], strike[1], radius)) this.startYoshiSpin(block);
    if (this.content.stageId === 'onett') this.hitOnettRooftop(strike[0], strike[1], radius);
    // Green Greens star blocks break on contact (grGreens material hits).
    if (this.content.stageId === 'green-greens' && this.greens) {
      const broken = greensBlockAt(this.greens, strike[0], strike[1], radius + 2);
      if (broken >= 0) this.breakGreensBlock(broken, slot);
    }
  }
  /** Advances one active Nana after Popo's own update (follow/jump/land/walls
   * via lib/game/nana.ts). A blast-line crossing KOs her into Sopo rules;
   * she revives beside Popo on his next stock. A KO'd Popo hides her, and a
   * respawning Popo carries her out on the platform. */
  private stepNana(fighter: MatchFighter): void {
    const nana = fighter.nana;
    if (!nana?.active) return;
    if (fighter.state === 'ko') { nana.active = false; return; }
    if (fighter.state === 'respawn') {
      nana.x = f32(fighter.x - fighter.facing * NANA_ANCHOR_BACK); nana.y = f32(fighter.y);
      nana.vx = 0; nana.vy = 0; nana.grounded = false; nana.floor = null; nana.tumble = 0;
      return;
    }
    const attrs = fighter.content.profile.attributes;
    const outcome = stepNanaState(nana, { x: fighter.x, y: fighter.y, facing: fighter.facing, grounded: fighter.grounded, floor: fighter.floor, state: fighter.state },
      { floors: this.activeFloors(), surfaces: this.activeSurfaces(), blast: this.content.stage.blast },
      { runSpeed: attrs.runSpeed, jumpSpeed: attrs.jumpSpeed, gravity: attrs.gravity, terminal: attrs.terminal });
    if (outcome !== 'blast') return;
    nana.active = false; nana.percent = 0; nana.tumble = 0; nana.vx = 0; nana.vy = 0;
    this.events.push({ type: 'ko', player: fighter.slot, x: nana.x, y: nana.y });
    const killer = nana.lastHitBy;
    if (killer !== null && killer !== fighter.slot && killer >= 0 && killer < this.fighters.length) this.fighters[killer]!.kos++;
    nana.lastHitBy = null;
  }
  /** Direct strike on an active Nana: her own percent pool drives knockback
   * into her follow velocity plus a short tumble, while Popo fights on (Sopo
   * takes over only if she is launched). No shields, counters, grabs or
   * captures on the partner — an explicit prototype gap. */
  private applyNanaHit(attacker: MatchFighter | null, owner: MatchFighter, incoming: HitDefinition, point: V3, direction: number): void {
    const nana = owner.nana!;
    const rogueMul = (attacker?.rogue?.damageDealtMul ?? 1) * (owner.rogue?.damageTakenMul ?? 1);
    const zombieMul = !this.options.zombies ? 1 : (attacker?.infected ? ZOMBIE_DEALT_MUL : 1) * (owner.infected ? ZOMBIE_TAKEN_MUL : 1);
    const damage = rogueMul === 1 && zombieMul === 1 ? incoming.damage : f32(incoming.damage * rogueMul * zombieMul);
    const hit = damage === incoming.damage ? incoming : { ...incoming, damage };
    // Knockback runs through Popo's own WASM slot: same attributes, same
    // deterministic stream discipline as any other strike this frame.
    const result = this.content.physics.hit(owner.slot, nana.percent, hit, !nana.grounded, 1);
    nana.percent = Math.min(999, f32(nana.percent + hit.damage));
    if (attacker) { attacker.damageDealt = f32(attacker.damageDealt + hit.damage); nana.lastHitBy = attacker.slot; }
    if (attacker) attacker.hitlag = Math.max(attacker.hitlag, result.hitlag);
    nana.vx = f32(Math.cos(result.angle) * result.speed * direction);
    nana.vy = f32(Math.sin(result.angle) * result.speed);
    nana.facing = direction >= 0 ? 1 : -1;
    if (nana.vy > 0.001) { nana.grounded = false; nana.floor = null; }
    nana.tumble = Math.max(NANA_MIN_TUMBLE, Math.ceil(result.hitstun));
    this.events.push({ type: 'hit', player: owner.slot, x: point[0], y: point[1], damage: hit.damage, element: hit.element, severity: hit.soundSeverity, knockback: result.knockback, facing: direction });
    this.events.push({ type: 'sound', player: owner.slot, x: point[0], y: point[1], sound: hitSound(hit.soundKind, hit.soundSeverity), volume: 127, pan: 64 });
  }
  private counter(attacker:MatchFighter,victim:MatchFighter,hit:HitDefinition,royContact=false):boolean {
    if(royContact&&triggerRoyCounter(victim,hit,attacker.x)){
      const p=victim.content.specials.parameters;
      if(p.kind==='Fe'||p.kind==='Ms'||p.kind==='Lu'){attacker.hitlag=Math.max(attacker.hitlag,p.down.hitlag);victim.hitlag=Math.max(victim.hitlag,p.down.hitlag);}
      this.events.push({type:'counter',player:victim.slot,x:victim.x,y:victim.y+10});return true;
    }
    if(peachToadCounter(victim)){
      // ftPe_SpecialN: the blocked hit swaps into SpecialNHit and releases the spores.
      if(Math.abs(attacker.x-victim.x)>0.5)victim.facing=attacker.x>victim.x?1:-1;
      // Impact-stage spawns bypass this.shots: the queue was already drained this frame.
      for (const shot of triggerPeachToad(victim)) {
        const item = this.projectiles.spawn(victim, shot.kind, this.poses, false, shot.charge ?? 0, shot);
        this.events.push({ type: 'shot', player: victim.slot, x: item.x, y: item.y, projectileKind: item.kind });
      }
      attacker.hitlag=Math.max(attacker.hitlag,6);
      this.events.push({type:'counter',player:victim.slot,x:victim.x,y:victim.y+10});return true;
    }
    const events = customCharacter(victim.content.profile.kind)?.counter?.(attacker, victim, hit);
    if (!events) return false;
    this.events.push(...events); return true;
  }
  private applyHit(attacker: MatchFighter | null, victim: MatchFighter, incoming: HitDefinition, point: V3, direction: number, projectile = false, damageOnly = false, cape = false, projectileKind?: ProjectileKind): void {
    // PROTOTYPE (roguelike): boon damage multipliers + venom. Neutral by default, so the
    // original pipeline below is unchanged outside Rift Descent; knockback still couples
    // to final damage exactly like a natively stronger/weaker move.
    // Rift Descent 2.0 lanes (crits, rage, execute, jolt, launch power) fold into the
    // same two multipliers in `lib/game/roguelike/sim.ts`; neutral fighters get 1 × 1.
    const rogueScale = rogueHitScale(this.frame, attacker, victim);
    const rogueMul = rogueScale.damageMul;
    // PROTOTYPE (zombies): the infected hit harder and take more. Neutral
    // outside zombies; knockback still couples to final damage exactly like
    // a natively stronger/weaker move.
    const zombieMul = !this.options.zombies ? 1 : (attacker?.infected ? ZOMBIE_DEALT_MUL : 1) * (victim.infected ? ZOMBIE_TAKEN_MUL : 1);
    const boosted = rogueMul === 1 && zombieMul === 1 ? incoming : { ...incoming, damage: f32(incoming.damage * rogueMul * zombieMul) };
    // ftColl_8007ABD0 / it_80272460: a mushroom-scaled attacker (or item owner) deals rescaled damage.
    const itemCommon = this.content.common.itemStatus;
    const scaled = attacker?.itemFx && attacker.itemFx.scale !== 1 ? { ...boosted, damage: scaledDamage(boosted.damage, attacker.itemFx, itemCommon) } : boosted;
    // A hit finishes a running grow/shrink at once (the Kinoko states' take_dmg_cb).
    if (victim.itemFx?.ramp) this.finishSizeRamp(victim);
    if (attacker?.rogue && attacker.rogue.venomTicks > 0 && victim.state !== 'ko' && victim.state !== 'respawn') {
      victim.poison = rogueVenom(victim.poison, attacker.rogue.venomTicks);
    }
    // Kirby's Stone absorbs damage into its HP; the breaking hit applies only the excess.
    const stone = stoneAbsorb(victim, scaled.damage);
    if (stone?.absorbed) return;
    const hit = stone ? { ...scaled, damage: stone.damage } : scaled;
    if (!cape) loseCopyAbility(victim, this.content.physics);
    const chargeKnockback = victim.smash?.phase==='charging'?this.content.common.chargeVulnerability:1;
    const knockbackMul = f32((rogueScale.knockbackMul === 1 ? chargeKnockback : chargeKnockback * rogueScale.knockbackMul) * scaledKnockback(victim.itemFx, itemCommon));
    const result = this.content.physics.hit(victim.slot, victim.percent, hit, !victim.grounded, knockbackMul);
    // ftCo_Damage: a metal body subtracts ftCommonData metal_armor from the applied knockback
    // (its ×3 weight is already in the WASM attributes).
    if (victim.itemFx && victim.itemFx.metal > 0 && itemCommon && result.knockback > 0) {
      const armored = Math.max(0, f32(result.knockback - itemCommon.metalArmor)), ratio = armored / result.knockback;
      result.knockback = armored; result.speed = f32(result.speed * ratio); result.hitstun = Math.max(1, Math.floor(result.hitstun * ratio));
    }
    // Fighter_TakeDamage_8006CC7C: a cloaked fighter takes no percent; metal loses health.
    if (!(victim.itemFx && victim.itemFx.cloak > 0)) victim.percent = Math.min(999, f32(victim.percent + hit.damage));
    if (victim.itemFx && victim.itemFx.metal > 0) victim.itemFx.metalHealth = f32(victim.itemFx.metalHealth - hit.damage);
    if (victim.state === 'frozen') this.combat.frozenHit(victim, hit.damage, hit.element ?? 0);
    // Results-screen stats: credit dealt damage (even damage-only lasers) and
    // remember the last attacker so the KO block can credit kills vs falls.
    if (attacker) { attacker.damageDealt = f32(attacker.damageDealt + hit.damage); victim.lastHitBy = attacker.slot; }
    if (cape) {
      victim.facing = -victim.facing; victim.velocity.x = -victim.velocity.x;
      this.events.push({ type: 'cape', player: victim.slot, x: point[0], y: point[1] });
    } else if (!damageOnly && (hit.element === 6 || hit.element === 7) && victim.grounded && this.combat.sleep(victim, hit.element === 6 ? 103 : 412)) {
      // HitElement_Nap/Sleep (lb/forward.h): a grounded victim sways asleep instead of launching.
      if (!projectile && attacker) attacker.hitlag = Math.max(attacker.hitlag, result.hitlag);
      victim.hitlag = Math.max(victim.hitlag, result.hitlag);
    } else if (!damageOnly && hit.element === 9 && victim.grounded && this.combat.bury(victim)) {
      // ftCo_800C0CB8: a ground-element hit plants a grounded victim instead of launching it.
      if (!projectile && attacker) attacker.hitlag = Math.max(attacker.hitlag, result.hitlag);
      victim.hitlag = Math.max(victim.hitlag, result.hitlag);
    } else if (!damageOnly && (victim.state === 'frozen' || (hit.element === 5 && result.knockback * this.content.combat.ice.knockbackScale >= this.content.combat.ice.minKnockback))) {
      // ftCo_Damage block_83: an ice hit past the second knockback tier seals the victim instead of
      // launching. A hit on someone already sealed re-enters the block with the new knockback
      // (ftCo_DamageIce_HitWhileFrozen) rather than knocking them out of it; only the timer moves.
      const launch = { x: f32(Math.cos(result.angle) * result.speed * direction), y: f32(Math.sin(result.angle) * result.speed) };
      this.combat.freeze(victim, hit.damage, launch);
      if (!projectile && attacker) attacker.hitlag = Math.max(attacker.hitlag, result.hitlag);
      victim.hitlag = Math.max(victim.hitlag, result.hitlag);
    } else if (!damageOnly) {
      victim.knockback = { x: f32(Math.cos(result.angle) * result.speed * direction), y: f32(Math.sin(result.angle) * result.speed) };
      victim.velocity = { x: 0, y: 0 }; victim.hitstun = result.hitstun; victim.fastFall = false;
      // ftCo_Damage_CalcAngle: a hitbox angle in the meteor range arms the meteor cancel; each launch forgets earlier buffered jumps.
      const recovery = this.content.common.hitstunRecovery ?? HITSTUN_RECOVERY;
      victim.hitstunInput.jumpAt = 0;
      victim.hitstunInput.meteorLock = hit.angle !== 361 && hit.angle >= recovery.meteorAngleMin && hit.angle <= recovery.meteorAngleMax ? recovery.meteorLockout : -1;
      if (victim.knockback.y > 0.001) { victim.grounded = false; victim.floor = null; victim.jumpsUsed = Math.max(1, victim.jumpsUsed); }
      this.change(victim, 'hitstun', result.knockback >= 80 ? 'DamageFlyN' : 'DamageN1');
      if (!projectile && attacker) attacker.hitlag = Math.max(attacker.hitlag, result.hitlag);
      victim.hitlag = Math.max(victim.hitlag, result.hitlag);
    }
    this.events.push({ type: 'hit', player: victim.slot, x: point[0], y: point[1], damage: hit.damage, element: hit.element, severity: hit.soundSeverity, knockback:result.knockback, facing:direction, projectileKind: projectileKind ?? (projectile ? (damageOnly ? 'laser' : 'fireball') : undefined) });
    this.events.push({ type: 'sound', player: victim.slot, x: point[0], y: point[1], sound: hitSound(hit.soundKind, hit.soundSeverity), volume: 127, pan: 64 });
    rogueAfterHit(this.fighters, this.events, attacker, victim, hit.damage, projectile, rogueScale.crit);
  }
  /** PlDd itFunction:2 Trip_Enter: DamageLw1 on the MissFoot animation from frame 3 with 0.4 of the
   * speed, SFX 0x10A; stepTrip bounds it down at frame 14 (lib/game/diddy.ts). */
  private tripFighter(victim: MatchFighter): void {
    this.change(victim, 'hitstun', victim.content.clips.has('MissFoot') ? 'MissFoot' : 'DownWaitU');
    victim.animationFrame = DIDDY_BANANA.tripStart;
    victim.hitstun = tripFrames(victim); victim.hitlag = 0; victim.fastFall = false;
    victim.velocity = { x: f32(victim.velocity.x * DIDDY_BANANA.tripSpeed), y: 0 }; victim.knockback = { x: 0, y: 0 };
    victim.trip = { phase: 'slip' };
    this.events.push({ type: 'sound', player: victim.slot, x: victim.x, y: victim.y, sound: DIDDY_BANANA.tripSound, volume: 127, pan: 64 });
  }
  private nudgeGrounded(frozen: readonly boolean[]): void {
    // Restricted pairwise form of ftCommon_8007DD7C, using the disc's x50
    // nudge bounds and common x450 speed. No team/grab/z-axis paths here.
    for (let i = 0; i < this.fighters.length; i++) for (let j = i + 1; j < this.fighters.length; j++) {
    const a = this.fighters[i]!, b = this.fighters[j]!;
    if (frozen[i] || frozen[j] || !a.grounded || !b.grounded || a.hitlag > 0 || b.hitlag > 0 || a.state === 'ko' || b.state === 'ko' || a.combat.partner!==null || b.combat.partner!==null || Math.abs(a.y - b.y) > 0.01) continue;
    const pa = a.content.profile, pb = b.content.profile;
    const delta = (a.x + pa.nudgeOffset * a.facing) - (b.x + pb.nudgeOffset * b.facing);
    if (Math.abs(delta) < pa.nudgeRadius + pb.nudgeRadius) {
      const direction = delta === 0 ? -1 : Math.sign(delta), amount = this.content.common.nudgeSpeed;
      // The shove never pushes through a vertical wall: each side is checked
      // against the wall/ceiling lines like ordinary movement.
      const surfaces = this.activeSurfaces();
      const nextA = f32(a.x + direction * amount), nextB = f32(b.x - direction * amount);
      if (!this.firstSurfaceCrossing(surfaces, a.x, a.y, nextA, a.y, true)) a.x = nextA;
      if (!this.firstSurfaceCrossing(surfaces, b.x, b.y, nextB, b.y, true)) b.x = nextB;
    }
    }
  }
  /** Original wall and ceiling lines block fighter crossings: the movement segment stops
   * just before the first crossed line and the into-surface momentum is dropped. A blocked
   * fighter then slides along the surface (the remaining axis of the movement is retried on
   * its own), so nobody is pinned mid-air against a wall face. No wallbounce, walljump or
   * push-out of already-embedded positions — this only keeps fighters from passing into
   * solid terrain through its sides and undersides. Walls are swept by the lower body
   * (see WALL_BODY_HEIGHT), undersides by the feet point only. */
  private blockSurfaces(fighter: MatchFighter, oldX: number, oldY: number): void {
    const surfaces = this.activeSurfaces();
    if (surfaces.length === 0 || (fighter.x === oldX && fighter.y === oldY)) return;
    // Ledge actions legitimately cross the lip wall from outside; held/respawning
    // fighters are repositioned by their owners, not by their own movement.
    if (['ledge', 'ledge-action', 'ledge-jump', 'captured', 'respawn', 'ko', 'tether'].includes(fighter.state)) return;
    const first = this.firstSurfaceCrossing(surfaces, oldX, oldY, fighter.x, fighter.y, fighter.grounded);
    if (!first) return;
    // Headbutting a block from below starts its spin (gryorster.c turns a block once
    // its joint contact accumulates); the bonk below still applies this frame. Walls
    // block movement the same way and phase with their block, but horizontal bumps
    // alone never trigger a spin (the original accumulates vertical delta only).
    if (first.kind === 'ceiling') {
      const block = this.yoshiBlockForSurface(first.surface.id);
      if (block >= 0) this.startYoshiSpin(block);
      // Headbutting a Green Greens block from below breaks it (grgreens.c joint
      // contact sets x1_4, which the fall update turns into a break).
      if (this.content.stageId === 'green-greens' && this.greens) {
        const broken = greensBlockForCeiling(first.surface.id);
        if (broken >= 0 && this.greens.blocks[broken]!.status !== 0) this.breakGreensBlock(broken, fighter.slot);
      }
    }
    const newX = fighter.x, newY = fighter.y;
    fighter.envContact = { wall: first.kind === 'wall' ? Math.sign(fighter.x - oldX) || fighter.facing : 0, ceiling: first.kind === 'ceiling' };
    if (first.kind === 'wall') { fighter.velocity.x = 0; fighter.knockback.x = 0; }
    else { fighter.velocity.y = Math.min(0, fighter.velocity.y); fighter.knockback.y = Math.min(0, fighter.knockback.y); }
    // Slide (airborne only): project the movement onto the surface line — a fighter already on
    // a slanted line would otherwise re-cross it every frame and hang in the air — and keep it
    // when it crosses nothing. A grounded fighter pushing into a wall base simply stops.
    const line = first.line, lx = line.b[0] - line.a[0], ly = line.b[1] - line.a[1], length = Math.hypot(lx, ly);
    if (!fighter.grounded && length > 1e-6) {
      // Slide from the CURRENT point (which sits a hair off the line after an earlier
      // back-off) rather than re-projecting onto the line, or the slide's own end would count
      // as a crossing; never slide past the line's ends, where a wall base meets a floor.
      const sOld = ((oldX - line.a[0]) * lx + (oldY - line.a[1]) * ly) / (length * length);
      const along = ((newX - oldX) * lx + (newY - oldY) * ly) / length;
      const sNew = Math.max(0, Math.min(1, sOld + along / length)), travel = (sNew - sOld) * length;
      const slideX = oldX + (lx / length) * travel, slideY = oldY + (ly / length) * travel;
      const rises = first.kind === 'ceiling' && slideY > oldY;
      if (!rises && Math.hypot(slideX - oldX, slideY - oldY) > 1e-6 && !this.firstSurfaceCrossing(surfaces, oldX, oldY, slideX, slideY, false)) { fighter.x = f32(slideX); fighter.y = f32(slideY); return; }
    }
    const backed = Math.max(0, first.t - 0.001);
    fighter.x = f32(oldX + (newX - oldX) * backed);
    fighter.y = f32(oldY + (newY - oldY) * backed);
  }
  private firstSurfaceCrossing(surfaces: readonly StageSurface[], oldX: number, oldY: number, x: number, y: number, grounded: boolean): { t: number; kind: 'wall' | 'ceiling'; surface: StageSurface; line: Pick<Floor, 'a' | 'b'> } | null {
    if (x === oldX && y === oldY) return null;
    let first: { t: number; kind: 'wall' | 'ceiling'; surface: StageSurface; line: Pick<Floor, 'a' | 'b'> } | null = null;
    for (const surface of surfaces) {
      if (surface.kind === 'floor') continue;
      if (surface.kind === 'ceiling' && y <= oldY) continue; // undersides block upward motion only
      const line = blockingLine(surface);
      const hit = lineCrossing(line, oldX, oldY, x, y);
      if (hit === null) continue;
      // A graze on the wall's TOP vertex is a fighter stepping over the lip it hangs
      // from — never a crossing. A graze on its BOTTOM vertex is a step base and blocks a
      // walking fighter; an airborne fighter simply passes the corner (a slide that ended on
      // a vertex would otherwise freeze there forever).
      if (hit.s <= 0.001 || hit.s >= 0.999) {
        const grazedY = hit.s <= 0.001 ? line.a[1] : line.b[1], otherY = hit.s <= 0.001 ? line.b[1] : line.a[1];
        if (surface.kind === 'ceiling' || grazedY >= otherY || !grounded) continue;
      }
      if (!first || hit.t < first.t) first = { t: hit.t, kind: surface.kind, surface, line };
    }
    return first;
  }
  /** grStadium terrain grows/sinks under standing fighters (mpLib carries its riders);
   * this adapter swaps collision once per transformation, so carry fighters across the
   * height change explicitly. Only positions that were on/above the old ground ride up —
   * a fighter already under the old stage is never rescued — and columns whose new
   * surface sits far below simply become ordinary falls. */
  /** mpGetSpeed riders: a grounded fighter follows the vertical motion of the floor it stands on. */
  /** One frame of the Mute City road (grmutecity.c): the 60 s area script, then
   * the traveling deck. Runs on the animation clock through countdown too (see
   * step()), so the script cursor, markers and deck track the road visuals at
   * GO instead of fast-forwarding. */
  private stepMuteCityRoad(): void {
    const runtime = this.muteCity, data = this.content.muteCityData;
    if (!runtime || !data) return;
    const animFrame = this.frame % MUTE_CITY_ANIM_FRAMES;
    const wrapped = animFrame === 0 && this.frame > 0;
    const { areasChanged } = stepMuteCity(runtime, data, animFrame, wrapped);
    if (areasChanged) {
      const phase = data.phases.get(muteCityPhaseKey(runtime.areas));
      if (!phase) throw new Error('Mute City script reached an unparsed area set.');
      if (phase !== this.content.stage) {
        const previous = this.content.stage;
        this.content.stage = phase;
        this.rideMovingFloors(previous);
        this.carryTransformedFighters(previous);
      }
    }
    this.carryMuteCityDeck();
  }
  /** Fighters standing on the traveling deck (ids 49/51/53) follow its motion
   * (mpLib rider follow, grMuteCity_801F2B58 b7): midpoint delta in x plus a
   * snap onto the moved surface, ignored when the deck jumped away (the
   * support check below drops them instead). */
  private carryMuteCityDeck(): void {
    const runtime = this.muteCity;
    if (!runtime?.deck || !runtime.prevDeck) return;
    for (const fighter of this.fighters) {
      if (!fighter.grounded || fighter.floor === null || ['ko', 'respawn', 'captured'].includes(fighter.state)) continue;
      const before = runtime.prevDeck.floors.find((floor) => floor.id === fighter.floor);
      const after = runtime.deck.floors.find((floor) => floor.id === fighter.floor);
      if (!before || !after) continue;
      fighter.x = f32(fighter.x + ((after.a[0] + after.b[0]) / 2 - (before.a[0] + before.b[0]) / 2));
      const surface = floorY(after, fighter.x);
      if (Math.abs(surface - fighter.y) < 8) fighter.y = surface;
    }
  }
  private rideMovingFloors(previous: StageGameplayData): void {
    for (const fighter of this.fighters) {
      if (!fighter.grounded || fighter.floor === null || ['ko', 'respawn', 'captured'].includes(fighter.state)) continue;
      const before = previous.floors.find((floor) => floor.id === fighter.floor), after = this.content.stage.floors.find((floor) => floor.id === fighter.floor);
      if (!before || !after) continue;
      const delta = floorY(after, fighter.x) - floorY(before, fighter.x);
      if (delta !== 0) fighter.y = f32(fighter.y + delta);
    }
    // Rising terrain pushes whoever stands in its way up onto its surface (the original's
    // ECB resolves against the highest floor under the body): switch to any solid floor that
    // just rose through the fighter's feet.
    for (const fighter of this.fighters) {
      if (!fighter.grounded || ['ko', 'respawn', 'captured'].includes(fighter.state)) continue;
      const lifted = this.content.stage.floors.filter((floor) => !floor.oneWay && between(fighter.x, floor.a[0], floor.b[0]) && floorY(floor, fighter.x) > fighter.y + 0.001 && floorY(floor, fighter.x) < fighter.y + 6)
        .sort((a, b) => floorY(b, fighter.x) - floorY(a, fighter.x))[0];
      if (lifted) { fighter.y = floorY(lifted, fighter.x); fighter.floor = lifted.id; }
    }
  }
  private carryTransformedFighters(previous: StageGameplayData): void {
    for (const fighter of this.fighters) {
      if (['ko', 'respawn', 'captured', 'ledge', 'ledge-action', 'ledge-jump'].includes(fighter.state)) continue;
      const solids = (stage: StageGameplayData) => stage.floors.filter((floor) => !floor.oneWay && between(fighter.x, floor.a[0], floor.b[0]));
      const current = solids(this.content.stage);
      const below = current.filter((floor) => floorY(floor, fighter.x) <= fighter.y + 0.1).sort((a, b) => floorY(b, fighter.x) - floorY(a, fighter.x))[0];
      if (!below) {
        if (!solids(previous).some((floor) => floorY(floor, fighter.x) <= fighter.y + 0.1)) continue;
        const surface = current.sort((a, b) => floorY(a, fighter.x) - floorY(b, fighter.x))[0];
        if (!surface) continue;
        if (fighter.grounded) { fighter.y = floorY(surface, fighter.x); fighter.floor = surface.id; }
        else this.land(fighter, surface);
      } else if (fighter.grounded && !this.content.stage.floors.some((floor) => floor.id === fighter.floor) && floorY(below, fighter.x) >= fighter.y - 12) {
        // The ground under this column morphed slightly (plain ↔ pond): follow its surface.
        fighter.y = floorY(below, fighter.x); fighter.floor = below.id;
      }
    }
  }
  /** Zelda/Sheik Transform (ftCommon_8007EFC8): the active moveset, model and
   * WASM attribute prefix swap in place, carrying position, percent, stocks,
   * facing, velocity and groundedness. No dormant partner entity is simulated
   * (unobservable in prototype scope); snapshots carry the content kind so
   * rollback restores the same side of the pair. */
  transformFighter(fighter: MatchFighter, kind: FighterKind): void {
    const target = this.content.roster.get(kind);
    if (!target) throw new Error('Transform target is not loaded.');
    if (target.profile.kind === fighter.content.profile.kind) return;
    // A costumed slot swaps to the paired same-index model (wired by
    // selectLineup); otherwise both sides share the roster default models.
    const paired = fighter.content.transformModel;
    fighter.content = paired ? { ...target, model: paired, costume: fighter.content.costume, transformModel: fighter.content.model } : target;
    this.refreshFxAttributes(fighter);
    fighter.special = null; fighter.attackName = null; fighter.victims.clear();
    fighter.jumpsUsed = 0; fighter.fastFall = false; fighter.hitlag = 0; fighter.hitstun = 0;
    fighter.state = fighter.grounded ? 'idle' : 'fall';
    fighter.animation = fighter.grounded ? 'Wait1' : 'Fall';
    fighter.animationFrame = 0; fighter.animationRate = 1; fighter.animationEpoch++;
    fighter.stateFrame = 0;
    this.events.push({ type: 'transform', player: fighter.slot, x: fighter.x, y: fighter.y, kind });
  }
  /** Debug hot-swap (P key): replace one slot's fighter with another loaded
   * roster kind WITHOUT restarting the match — timer, stocks, percents,
   * positions and every other fighter keep going, so there is no countdown.
   * Generalizes transformFighter (same in-place contract: position, percent,
   * stocks, facing and velocity carry; snapshots carry the content kind so
   * rollback restores the swapped moveset). Fighter-specific transient state
   * (charges, hats, grab links, Nana) resets like a fresh spawn, and a swap
   * out of KO/respawn re-places at the spawn point like the KO flow (stocks
   * already lost stay lost). Throws when the slot or target is invalid. */
  debugSwapFighter(slot: number, kind: FighterKind): void {
    const fighter = this.fighters[slot];
    if (!fighter) throw new Error('Invalid fighter slot.');
    const target = this.content.roster.get(kind);
    if (!target) throw new Error('Debug swap target is not loaded.');
    if (target.profile.kind === fighter.content.profile.kind) return;
    // Release anyone grabbed by / grabbing this slot first: stale partner
    // links would leave the other side frozen in a grab that no longer exists.
    for (const other of this.fighters) {
      if (other.slot === fighter.slot || other.combat.partner !== fighter.slot) continue;
      other.combat.partner = null;
      if (other.state === 'captured' || other.state === 'holding' || other.state === 'throw') {
        this.change(other, other.grounded ? 'idle' : 'fall', other.grounded ? 'Wait1' : 'Fall');
      }
    }
    fighter.content = target;
    // A debug swap is a fresh body: item effects end with the old one.
    fighter.itemFx = null;
    this.content.physics.configureSlot(fighter.slot, target.profile);
    // Fresh combat runtime (drops my side of grab/ledge links) and a clean
    // transient slate; percent, stocks, stats, position and velocity carry.
    fighter.combat = createCombat(this.content);
    fighter.customState = customInitialState(target.profile.kind);
    fighter.victims.clear();
    fighter.special = null; fighter.jab = null; fighter.smash = null;
    fighter.specialLandingLag = 0; fighter.specialMobility = 1;
    fighter.attackName = null; fighter.hitlag = 0; fighter.hitstun = 0;
    fighter.knockback = { x: 0, y: 0 };
    fighter.jumpsUsed = 0; fighter.fastFall = false; fighter.shortHop = false;
    fighter.downWindow = 0; fighter.ignoreFloor = null; fighter.ignoreTicks = 0; fighter.landingFrames = 0;
    fighter.roySideBoostUsed = false; fighter.capeBoostUsed = false; fighter.tornadoUsed = false;
    fighter.popoHoverUsed = false; fighter.airJumpTurn = 0; fighter.hammerBoostUsed = false;
    fighter.copyAbility = null; fighter.samusCharge = 0; fighter.samusSideTicks = 255; fighter.sheikNeedles = 0;
    fighter.gwOil = 0; fighter.gwOilDamage = 0; fighter.gwJudge1 = 1; fighter.gwJudge2 = 0; fighter.gwChefA = 1; fighter.gwChefB = 3; fighter.gwJudgeHop = false;
    fighter.dkPunchCharge = 0; fighter.sonicCharge = 0; fighter.glideUsed = false; fighter.bsonic = createBSonicVars(); fighter.skullkid = createSkullKidVars();
    fighter.envContact = null; fighter.tailsFuelUsed = 0; fighter.mewtwoCharge = 0; fighter.mewtwoBoostUsed = false; fighter.koopaBreath = 360;
    resetLizardonFuel(fighter);
    fighter.peachTurnip = null; fighter.peachFloat = { available: true, timer: 0 }; fighter.peachLastSmash = -1;
    fighter.link = createLinkState();
    if (fighter.bury) { fighter.y = f32(fighter.y + fighter.bury.depth); fighter.bury = null; }
    fighter.ice = null; fighter.trip = null;
    fighter.hitstunInput = { jumpAt: 0, meteorLock: -1, jumpAge: 255, upSpecialAge: 255 };
    // Nana follows the new body: leaving the duo drops her, joining it spawns
    // her at the regroup anchor when a partner model is loaded (solo Popo
    // otherwise, like makeFighter).
    if (target.profile.kind === 'Pp' && target.partnerModel) {
      fighter.nana = initialNanaState(f32(fighter.x - fighter.facing * NANA_ANCHOR_BACK), fighter.y, fighter.facing, fighter.floor);
    } else fighter.nana = null;
    if (fighter.state === 'ko' || fighter.state === 'respawn') {
      const spawn = this.spawn(fighter.slot);
      fighter.x = spawn[0]; fighter.y = Math.min(this.content.stage.blast.top - 20, Math.max(75, spawn[1] + 40));
      fighter.percent = 0; fighter.velocity = { x: 0, y: 0 };
      fighter.grounded = false; fighter.floor = null; fighter.jumpsUsed = 1;
      fighter.invulnerable = 150; fighter.capeBoostUsed = false; fighter.tornadoUsed = false;
      fighter.popoHoverUsed = false; fighter.hammerBoostUsed = false; fighter.mewtwoBoostUsed = false; fighter.copyAbility = null;
      this.change(fighter, 'respawn', 'Fall');
      this.events.push({ type: 'respawn', player: fighter.slot, x: fighter.x, y: fighter.y });
    } else {
      this.change(fighter, fighter.grounded ? 'idle' : 'fall', fighter.grounded ? 'Wait1' : 'Fall');
    }
    this.events.push({ type: 'transform', player: fighter.slot, x: fighter.x, y: fighter.y, kind });
  }
  /** Bitmask of spinning Yoshi blocks (bit i = block i mid-spin, collision phased out). */
  private yoshiSpinMask(): number {
    if (this.content.stageId !== 'yoshi-island') return 0;
    let mask = 0;
    for (let block = 0; block < YOSHI_BLOCK_COUNT; block++) if (this.yoshiBlocks[block]! > 0) mask |= 1 << block;
    return mask;
  }
  /** True while the block holds still with collision (rest pose). */
  private yoshiBlockActive(block: number): boolean {
    return this.content.stageId !== 'yoshi-island' || this.yoshiBlocks[block]! <= 0;
  }
  /** Block index owning a wall/ceiling surface id, or -1 for island terrain. */
  private yoshiBlockForSurface(id: number): number {
    for (let block = 0; block < YOSHI_BLOCK_COUNT; block++) if ((YOSHI_BLOCK_SURFACES[block] as readonly number[]).includes(id)) return block;
    return -1;
  }
  /** Combined Green Greens collision (base terrain + live blocks), recomputed at
   * most once per frame; the Yoshi mask cache below stays separate. */
  private ensureGreensCache(): { floors: Floor[]; surfaces: readonly StageSurface[] } {
    const cached = this.greensCache;
    if (cached && cached.frame === this.frame && cached.stage === this.content.stage) return cached;
    const dynamic = this.greens ? greensFloors(this.greens) : [];
    const floors = [...this.content.stage.floors, ...dynamic];
    const surfaces: StageSurface[] = [...(this.content.stage.surfaces ?? [])];
    for (const floor of dynamic) surfaces.push({ ...floor, kind: 'floor' });
    if (this.greens) surfaces.push(...greensSurfaces(this.greens));
    this.greensCache = { frame: this.frame, stage: this.content.stage, floors, surfaces };
    return this.greensCache;
  }
  /** Breaks a Green Greens block (strike/shot/item/headbutt contact). Normal blocks
   * pop with the original break effect/sound (1032/0x68FB7); bombs detonate with
   * the original bomb effect (1039) and a PROTOTYPE radial hit (12%, radius 20,
   * 45°/80/70 — placeholders, never original block blast data) that shields
   * absorb through the original shield pipeline with knockback still coupled by
   * the original formula. Bomb chains clear neighbours within 15 (the 3x3 neighbourhood). */
  private breakGreensBlock(index: number, breaker: number): void {
    if (this.content.stageId !== 'green-greens' || !this.greens || this.phase !== 'playing') return;
    if (!Number.isInteger(index) || index < 0 || index >= 30 || this.greens.blocks[index]!.status === 0) return;
    const queue = [index];
    const seen = new Set([index]);
    while (queue.length) {
      const current = queue.shift()!;
      const live = this.greens.blocks[current];
      if (!live || live.status === 0) continue;
      const pos = removeGreensBlock(this.greens, current);
      this.greensCache = null;
      if (pos.bomb) {
        this.greensBombBlast(pos.x, pos.y, breaker);
        this.events.push({ type: 'gfx', player: breaker, x: pos.x, y: pos.y, effect: 1039 });
        this.events.push({ type: 'sound', player: breaker, x: pos.x, y: pos.y, sound: 0x68fb7, volume: 127, pan: 64 });
        for (const neighbor of greensNeighbors(this.greens, pos.x, pos.y, 15)) {
          if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
        }
      } else {
        this.events.push({ type: 'gfx', player: breaker, x: pos.x, y: pos.y, effect: 1032 });
        this.events.push({ type: 'sound', player: breaker, x: pos.x, y: pos.y, sound: 0x68fb7, volume: 110, pan: 64 });
      }
    }
  }
  /** Prototype bomb blast (see breakGreensBlock): radial hit, shields hold. */
  private greensBombBlast(x: number, y: number, breaker: number): void {
    const owner = this.fighters[breaker] ?? this.fighters[0]!;
    const hit = { id: 0, group: 0, bone: 0, damage: 12, radius: 20, offset: [0, 0, 0] as [number, number, number], angle: 45, growth: 80, weightSet: 0, base: 70, grounded: true, airborne: true, element: 0 };
    for (const victim of this.fighters) {
      if (victim.state === 'ko' || victim.state === 'respawn' || victim.invulnerable > 0) continue;
      if (Math.hypot(victim.x - x, victim.y - y) > hit.radius + 2) continue;
      const point: [number, number, number] = [x, y, 0];
      const shield = shieldBubble(victim, this.content, this.poses);
      if (shield && Math.hypot(point[0] - shield.center[0], point[1] - shield.center[1], point[2] - shield.center[2]) <= shield.radius + hit.radius) {
        this.combat.block(owner, victim, hit, point, true);
        continue;
      }
      this.applyHit(owner, victim, hit, point, Math.sign(victim.x - x) || owner.facing || 1, true);
    }
  }
  /** One frame of Peach Bills (grcastle.c castle2/castle12): launch on the spawn
   * window, cross straight, boom on contact/timeout. Prototype flight/blast. */
  private stepPeachBillStage(): void {
    const rt = this.peachBill!, data = this.content.peachBillData!;
    const sounds: number[] = [];
    const launched = stepPeachBill(rt, data, this.content.physics, this.content.stage.blast.left, this.content.stage.blast.right, sounds);
    for (const sound of sounds) this.events.push({ type: 'sound', player: 0, x: rt.x, y: rt.y, sound, volume: 127, pan: 64 });
    if (launched) this.events.push({ type: 'gfx', player: 0, x: rt.x, y: rt.y, effect: 1032 });
  }
  /** Bill contact detonates with a prototype radial blast (original values unported). */
  private scanPeachBill(): void {
    const rt = this.peachBill!, data = this.content.peachBillData!;
    if (rt.state !== 1) return;
    const center: [number, number, number] = [rt.x, rt.y, 0];
    const touch = 8 + 2;
    let contact = false;
    for (const victim of this.fighters) {
      if (victim.state === 'ko' || victim.state === 'respawn' || victim.invulnerable > 0) continue;
      let touching = Math.hypot(victim.x - center[0], victim.y - center[1]) <= touch;
      if (!touching) {
        for (const hurt of fighterHurts(victim)) {
          if (!hurtEnabled(victim, hurt.bone)) continue;
          const p = this.poses.point(victim, hurt.bone, hurt.a), q = this.poses.point(victim, hurt.bone, hurt.b);
          if (pointSegmentDistanceSquared(center, p, q) <= (touch + hurt.radius) ** 2) { touching = true; break; }
        }
      }
      if (touching) { contact = true; break; }
    }
    if (!contact) {
      for (const floor of this.content.stage.floors) {
        if (Math.abs(rt.y - (floor.a[1] + floor.b[1]) / 2) > 6) continue;
        if (rt.x >= Math.min(floor.a[0], floor.b[0]) - 2 && rt.x <= Math.max(floor.a[0], floor.b[0]) + 2) { contact = true; break; }
      }
    }
    if (!contact) return;
    const sounds: number[] = [];
    detonatePeachBill(rt, data, sounds);
    for (const sound of sounds) this.events.push({ type: 'sound', player: 0, x: center[0], y: center[1], sound, volume: 127, pan: 64 });
    this.events.push({ type: 'gfx', player: 0, x: center[0], y: center[1], effect: 1039 });
    this.peachBillBlast(center[0], center[1]);
  }
  /** Prototype Bill blast: original damage, prototype knockback/radius, shields hold. */
  private peachBillBlast(x: number, y: number): void {
    const data = this.content.peachBillData!;
    const owner = this.fighters[0]!;
    const hit = { id: 0, group: 0, bone: 0, damage: data.damage, radius: data.radius, offset: [0, 0, 0] as [number, number, number], angle: 45, growth: 80, weightSet: 0, base: 70, grounded: true, airborne: true, element: 0 };
    for (const victim of this.fighters) {
      if (victim.state === 'ko' || victim.state === 'respawn' || victim.invulnerable > 0) continue;
      if (Math.hypot(victim.x - x, victim.y - y) > hit.radius + 2) continue;
      const point: [number, number, number] = [x, y, 0];
      const shield = shieldBubble(victim, this.content, this.poses);
      if (shield && Math.hypot(point[0] - shield.center[0], point[1] - shield.center[1], point[2] - shield.center[2]) <= shield.radius + hit.radius) {
        this.combat.block(owner, victim, hit, point, true);
        continue;
      }
      this.applyHit(null, victim, hit, point, Math.sign(victim.x - x) || 1, true);
    }
  }
  /** Floors with spinning Yoshi blocks phased out per block (original disables each
   * joint's lines mid-spin); every other stage returns the full set untouched. CPU nav
   * graphs still derive from the full stage, so CPUs may path over a spinning block.
   * Phase 5: cached per frame — recomputed only when the spin mask or the
   * stage object changes, not per fighter per frame. */
  private activeFloors(): Floor[] {
    if (this.content.stageId === 'green-greens' && this.greens) return this.ensureGreensCache().floors;
    const mask = this.yoshiSpinMask();
    const onettOut = this.onettRooftopOut();
    const muteCityDeck = this.content.stageId === 'mute-city' && this.muteCity ? this.muteCity.deckRevision : -1;
    const cached = this.floorsCache;
    if (cached && cached.mask === mask && cached.onettOut === onettOut && cached.muteCityDeck === muteCityDeck && cached.stage === this.content.stage) return cached.floors;
    let floors = this.content.stage.floors;
    if (mask !== 0) {
      const spinning = new Set<number>();
      for (let block = 0; block < YOSHI_BLOCK_COUNT; block++) if (mask & (1 << block)) spinning.add(YOSHI_BLOCK_FLOORS[block]!);
      floors = floors.filter((floor) => !spinning.has(floor.id));
    }
    // Onett's center rooftop lines phase out while the building is collapsed
    // (gronett.c disables joints 3/4 through the collapse and rebuild blink).
    if (onettOut) floors = floors.filter((floor) => floor.id !== 46 && floor.id !== 47);
    // Mute City's traveling deck (mp lines 0x31/0x33/0x35) rides above the
    // scripted areas; its rails are walls and join the surfaces below.
    if (this.content.stageId === 'mute-city' && this.muteCity?.deck) floors = [...floors, ...this.muteCity.deck.floors];
    const surfaces = this.activeSurfacesUncached(mask);
    this.floorsCache = { mask, onettOut, muteCityDeck, stage: this.content.stage, floors, surfaces };
    return floors;
  }
  private activeSurfacesUncached(mask = this.yoshiSpinMask()): readonly StageSurface[] {
    if (this.content.stageId === 'green-greens' && this.greens) return this.ensureGreensCache().surfaces;
    const base = this.content.stage.surfaces;
    const deck = this.content.stageId === 'mute-city' ? muteCityDeckSurfaces(this.muteCity) : [];
    const surfaces = deck.length ? [...(base ?? []), ...deck] : base;
    if (!surfaces || mask === 0) return surfaces ?? [];
    const spinning = new Set<number>();
    for (let block = 0; block < YOSHI_BLOCK_COUNT; block++) if (mask & (1 << block)) for (const id of YOSHI_BLOCK_SURFACES[block]!) spinning.add(id);
    return surfaces.filter((surface) => !spinning.has(surface.id));
  }
  private activeSurfaces(): readonly StageSurface[] {
    if (this.content.stageId === 'green-greens' && this.greens) return this.ensureGreensCache().surfaces;
    const mask = this.yoshiSpinMask();
    const cached = this.floorsCache;
    if (cached && cached.mask === mask && cached.onettOut === this.onettRooftopOut() && cached.muteCityDeck === (this.content.stageId === 'mute-city' && this.muteCity ? this.muteCity.deckRevision : -1) && cached.stage === this.content.stage) return cached.surfaces;
    // Populate both halves of the cache together.
    this.activeFloors();
    return this.floorsCache!.surfaces;
  }
  /** Starts one block's spin: its floor/walls/ceiling phase out immediately (the
   * original holds them for a short yakumono delay first) and return after
   * YOSHI_SPIN_FRAMES. Already-spinning blocks ignore retriggers. */
  private startYoshiSpin(block: number): void {
    if (this.content.stageId !== 'yoshi-island' || this.phase !== 'playing') return;
    if (!Number.isInteger(block) || block < 0 || block >= YOSHI_BLOCK_COUNT || this.yoshiBlocks[block]! > 0) return;
    if (!this.content.stage.floors.some((floor) => floor.id === YOSHI_BLOCK_FLOORS[block])) return;
    this.yoshiBlocks[block] = YOSHI_SPIN_FRAMES;
  }
  /** Onett rank order over live fighters (stocks, then percent); rank 0 leads,
   * like gm_8016C6C0 in the original car-gating checks. */
  private onettRanks(): Map<number, number> {
    const alive = this.fighters.filter((fighter) => fighter.state !== 'ko' && fighter.state !== 'respawn');
    const order = [...alive].sort((p, q) => q.stocks - p.stocks || p.percent - q.percent);
    return new Map(order.map((fighter, rank) => [fighter.slot, rank]));
  }
  /** Grounded on the low street (prototype reading of the original pos.y <= 1
   * check: canopies, houses and the rooftop all sit above y = 8). */
  private onettLow(fighter: MatchFighter): boolean {
    if (!fighter.grounded || fighter.floor === null) return false;
    const floor = this.content.stage.floors.find((line) => line.id === fighter.floor);
    return !!floor && Math.min(floor.a[1], floor.b[1]) <= 8;
  }
  /** One frame of Onett cars, warning, building and awnings (gronett.c). */
  private stepOnettStage(): void {
    const rt = this.onett!, data = this.content.onettData!;
    if (rt.warning > 0) rt.warning -= 1;
    for (const fighter of this.fighters) {
      if (!fighter.grounded || fighter.floor === null || fighter.state === 'ko' || fighter.state === 'respawn') continue;
      if (fighter.floor >= 0 && fighter.floor <= 5) onettAwningTouch(rt, data, 0);
      else if (fighter.floor >= 6 && fighter.floor <= 11) onettAwningTouch(rt, data, 1);
    }
    const ranks = this.onettRanks();
    const alive = this.fighters.filter((fighter) => fighter.state !== 'ko' && fighter.state !== 'respawn');
    const sounds: number[] = [];
    const scale = data.scale;
    stepOnettCars(rt, data, this.content.physics,
      this.fighters.map((fighter) => ({ low: alive.includes(fighter) && this.onettLow(fighter), rank: ranks.get(fighter.slot) ?? 0, count: alive.length })),
      sounds, () => { rt.warning = Math.round(data.tuning.warnFrames); });
    for (const sound of sounds) {
      this.events.push({ type: 'sound', player: 0, x: f32((rt.a.x + rt.b.x) / 2 * scale), y: 10, sound, volume: 127, pan: 64 });
    }
    const before = this.onettRooftopOut();
    const buildingSounds: number[] = [];
    const out = stepOnettBuilding(rt, data, this.content.physics, buildingSounds);
    for (const sound of buildingSounds) this.events.push({ type: 'sound', player: 0, x: 8, y: 40, sound, volume: 127, pan: 64 });
    if (out !== before) this.floorsCache = null;
    const awningSounds: number[] = [];
    stepOnettAwnings(rt, data, awningSounds);
    awningSounds.forEach((sound, index) => {
      const floor = this.content.stage.floors.find((line) => line.id === (index === 0 ? 2 : 8));
      const x = floor ? (floor.a[0] + floor.b[0]) / 2 : 0, y = floor ? (floor.a[1] + floor.b[1]) / 2 : 60;
      this.events.push({ type: 'sound', player: 0, x, y, sound, volume: 127, pan: 64 });
    });
  }
  /** True while the center rooftop lines are phased out (building states 5–7). */
  private onettRooftopOut(): boolean {
    if (this.content.stageId !== 'onett' || !this.onett) return false;
    return this.onett.building.state === 5 || this.onett.building.state === 6 || this.onett.building.state === 7;
  }
  /** Strikes, shots and loose items on the live rooftop feed the building machine
   * (prototype stand-in for the rooftop joint contact accumulation, as with
   * Yoshi blocks); merely standing on the roof never counts. */
  private hitOnettRooftop(x: number, y: number, radius: number): void {
    if (this.content.stageId !== 'onett' || !this.onett || !this.content.onettData || this.phase !== 'playing') return;
    if (this.onettRooftopOut()) return;
    const margin = radius + 1;
    for (const id of ONETT_ROOFTOP_IDS) {
      const floor = this.content.stage.floors.find((line) => line.id === id);
      if (!floor) continue;
      const fx = floor.b[0] - floor.a[0], fy = floor.b[1] - floor.a[1];
      const len2 = fx * fx + fy * fy;
      const s = len2 > 0 ? Math.max(0, Math.min(1, ((x - floor.a[0]) * fx + (y - floor.a[1]) * fy) / len2)) : 0;
      const dx = x - (floor.a[0] + fx * s), dy = y - (floor.a[1] + fy * s);
      if (dx * dx + dy * dy <= margin * margin) { onettBuildingHit(this.onett, this.content.onettData); return; }
    }
  }
  /** The hazard car's run-over with its original disc hit data (item states
   * 2–5); the left-to-right car is scriptless in the original and harmless. */
  private scanOnettCar(): void {
    const rt = this.onett!, data = this.content.onettData!, scale = data.scale;
    const a = rt.a;
    if (a.state !== 2 && a.state !== 3 && a.state !== 4 && a.state !== 5 && a.state !== 6) return;
    const car = data.hits[a.car]!;
    const center: V3 = [f32(a.x * scale), f32(car.offsetY * scale), 0];
    const radius = f32(car.size * scale);
    const hit: HitDefinition = {
      id: 0, group: 0, bone: 0, damage: car.damage, radius, offset: [0, 0, 0],
      angle: car.angle, growth: car.growth, weightSet: 0, base: car.base,
      grounded: true, airborne: true, element: car.element,
      soundKind: car.soundKind, soundSeverity: car.soundSeverity,
    };
    let connected = false;
    for (const victim of this.fighters) {
      if (victim.state === 'ko' || victim.state === 'respawn' || victim.invulnerable > 0) continue;
      const shield = shieldBubble(victim, this.content, this.poses);
      if (shield && Math.hypot(center[0] - shield.center[0], center[1] - shield.center[1], center[2] - shield.center[2]) <= shield.radius + radius) {
        this.combat.block(null, victim, hit, center, true, center[0]);
        continue;
      }
      let touching = false;
      for (const hurt of fighterHurts(victim)) {
        if (!hurtEnabled(victim, hurt.bone)) continue;
        const p = this.poses.point(victim, hurt.bone, hurt.a), q = this.poses.point(victim, hurt.bone, hurt.b);
        if (pointSegmentDistanceSquared(center, p, q) <= (radius + hurt.radius) ** 2) { touching = true; break; }
      }
      if (!touching) continue;
      connected = true;
      this.applyHit(null, victim, hit, center, Math.sign(victim.x - center[0]) || 1, true);
    }
    if (connected) {
      const react: number[] = [];
      onettCarHitReact(rt, this.content.physics, react);
      for (const sound of react) this.events.push({ type: 'sound', player: 0, x: center[0], y: center[1], sound, volume: 127, pan: 64 });
    }
  }
  /** Resting block indices whose expanded box contains the point (prototype
   * approximation of the per-block joint collision callback's contact accumulation). */
  private yoshiBlocksHit(x: number, y: number, radius: number): number[] {
    if (this.content.stageId !== 'yoshi-island') return [];
    const margin = radius + 2, found: number[] = [];
    for (let block = 0; block < YOSHI_BLOCK_COUNT; block++) {
      if (!this.yoshiBlockActive(block)) continue;
      const [cx, top, bottom] = YOSHI_BLOCK_BOXES[block]!;
      if (x >= cx - 4.25 - margin && x <= cx + 4.25 + margin && y >= bottom - margin && y <= top + margin) found.push(block);
    }
    return found;
  }
  /** Appends one diagnostic ground-loss entry; rollback truncates by frame so re-steps do not duplicate. */
  private logGroundLoss(fighter: MatchFighter, floor: number | null, reason: GroundLossEntry['reason'], detail: string): void {
    if (this.phase !== 'playing') return;
    this.groundLossLog.push({ frame: this.frame, player: fighter.slot, name: fighter.content.profile.name, x: fighter.x, y: fighter.y, floor, reason, stage: this.content.stageId, detail });
    if (this.groundLossLog.length > MAX_GROUND_LOSS_ENTRIES) this.groundLossLog.splice(0, this.groundLossLog.length - MAX_GROUND_LOSS_ENTRIES);
  }
  /** Classifies a support loss so walk-offs read differently from chain/tolerance gaps. */
  private groundLossReason(fighter: MatchFighter, oldX: number, oldY: number, follow: number, mine: number | undefined, spans: (floor: Floor) => boolean): GroundLossEntry['reason'] {
    const spanning = this.activeFloors().filter((floor) => between(fighter.x, floor.a[0], floor.b[0]));
    if (!spanning.length) return 'walk-off';
    const withinReach = spanning.filter((floor) => Math.abs(floorY(floor, fighter.x) - oldY) < follow);
    if (!withinReach.length) return 'drop';
    if (mine !== undefined) {
      const chains = floorChains(this.content.stage);
      if (withinReach.some((floor) => chains.get(floor.id) !== mine)) return 'chain-gap';
    }
    void oldX;
    if (!withinReach.some((floor) => spans(floor))) return 'lost-support';
    return 'lost-support';
  }
  private land(fighter: MatchFighter, floor: Floor): void {
    const moves = fighter.content.moves, clips = fighter.content.clips;
    const aerials: Array<[string | undefined, string, 'aerialForwardLandingLag' | 'aerialDownLandingLag' | 'aerialBackLandingLag' | 'aerialUpLandingLag' | 'aerialLandingLag']> = [[moves.forwardAir, 'LandingAirF', 'aerialForwardLandingLag'], [moves.downAir, 'LandingAirLw', 'aerialDownLandingLag'], [moves.backAir, 'LandingAirB', 'aerialBackLandingLag'], [moves.upAir, 'LandingAirHi', 'aerialUpLandingLag'], [moves.neutralAir, 'LandingAirN', 'aerialLandingLag']];
    // Back/up aerial landings need their own clips; fighters without them keep the neutral landing.
    const aerial = fighter.state === 'attack' ? aerials.find(([name, clip]) => name !== undefined && name === fighter.attackName && clips.has(clip)) ?? (moves.neutralAir === fighter.attackName ? aerials[4] : undefined) : undefined;
    fighter.y = floorY(floor, fighter.x); fighter.floor = floor.id; fighter.grounded = true; fighter.velocity.y = 0; fighter.knockback.y = 0;
    fighter.roySideBoostUsed = false;fighter.link.tetherUsed=false;fighter.glideUsed=false;bsonicOnLanding(fighter);skullkidOnLanding(fighter);tailsOnLanding(fighter);
    fighter.jumpsUsed = 0; fighter.fastFall = false; fighter.capeBoostUsed = false; fighter.tornadoUsed = false; fighter.popoHoverUsed = false; fighter.hammerBoostUsed = false; fighter.mewtwoBoostUsed = false; resetLinkDair(fighter);
    if (this.combat.land(fighter)) { retimeLinkLanding(fighter); return; }
    if (landSpecial(fighter, floor)) { retimeLinkLanding(fighter); return; }
    if (fighter.state === 'helpless') {
      fighter.landingFrames = Math.max(1, Math.ceil(fighter.specialLandingLag)); this.change(fighter, 'landing', 'Landing'); retimeLinkLanding(fighter); return;
    }
    if (fighter.state !== 'hitstun') {
      const attrs = fighter.content.profile.attributes;
      const landing=aerialLanding(fighter,this.content.common,!!aerial,aerial?attrs[aerial[2]]:attrs.landingLag);
      fighter.landingFrames = Math.max(1, Math.ceil(landing.lag));
      this.change(fighter, 'landing', landing.aerial&&aerial ? aerial[1] : 'Landing');
      if(landing.aerial)retimeAerialLanding(fighter);
    }
  }
  private finish(): void {
    if (this.phase === 'ended') return;
    if (this.hill) {
      // The clock decides: most hill points wins (top contributor takes the
      // winner slot so results, replays and the HUD keep one champion).
      this.winner = hillLeader(this.hill, this.options.teams, this.fighters.map(fighter => fighter.slot), this.fighters.map(fighter => fighter.percent), dense => hillTeamOfSlot(this.fighters[dense]?.seatId ?? dense));
      this.phase = 'ended'; this.events.push({ type: 'end', player: this.winner ?? -1, x: 0, y: 0 });
      return;
    }
    const alive = this.fighters.filter(f => f.stocks > 0);
    if (this.options.teams) {
      // Team stock battle: the side holding more total stocks takes it; the
      // top contributor takes the winner slot (damage, then slot, tiebreak).
      const totals: [number, number] = [0, 0];
      for (const fighter of alive) totals[hillTeamOfSlot(fighter.seatId ?? fighter.slot)] += fighter.stocks;
      if (totals[0] === totals[1]) this.winner = null;
      else {
        const side = (totals[0] > totals[1] ? 0 : 1) as 0 | 1;
        const ranked = alive.filter(fighter => hillTeamOfSlot(fighter.seatId ?? fighter.slot) === side).sort((a, b) => b.stocks - a.stocks || a.percent - b.percent || a.slot - b.slot);
        const best = ranked[0]!, second = ranked[1];
        this.winner = second && best.stocks === second.stocks && best.percent === second.percent ? null : best.slot;
      }
      this.phase = 'ended'; this.events.push({ type: 'end', player: this.winner ?? -1, x: 0, y: 0 });
      return;
    }
    // PROTOTYPE (zombies): patient zero takes a horde win, otherwise the top
    // clean survivor (versus tiebreak); see zombieWinner.
    if (this.options.zombies) {
      this.winner = zombieWinner(this.fighters, this.firstInfected);
      this.phase = 'ended'; this.events.push({ type: 'end', player: this.winner ?? -1, x: 0, y: 0 });
      return;
    }
    const ranked = this.fighters.filter(f => f.stocks > 0).sort((a,b) => b.stocks - a.stocks || a.percent - b.percent);
    const best = ranked[0], second = ranked[1];
    this.winner = !best || (second && best.stocks === second.stocks && best.percent === second.percent) ? null : best.slot;
    this.phase = 'ended'; this.events.push({ type: 'end', player: this.winner ?? -1, x: 0, y: 0 });
  }
  /** CPU decisions come from the leveled prototype brain; see lib/game/cpu.ts. */
  private botInput(slot: number): PlayerInput { return cpuInput(this, slot); }
  captureState(): MatchState {
    return {
      version: 1, configuration: this.configuration, phase: this.phase, frame: this.frame,
      countdown: this.countdown, remainingFrames: this.remainingFrames, winner: this.winner,
      firstInfected: this.firstInfected,
      hill: this.hill ? structuredClone(this.hill) : null,
      fighters: this.fighters.map(({ content, ...state }) => ({ ...structuredClone(state), contentKind: content.profile.kind })),
      projectiles: this.projectiles.captureState(), items: this.itemWorld.captureState(), physics: this.content.physics.captureState(),
      events: structuredClone(this.events), shots: structuredClone(this.shots),
      soundCursors: structuredClone(this.soundCursors), bots: structuredClone(this.bots),
      stadium: this.stadium ? structuredClone(this.stadium) : null,
      yoshiBlocks: [...this.yoshiBlocks],
      greens: this.greens ? structuredClone(this.greens) : null,
      onett: this.onett ? structuredClone(this.onett) : null,
      peachBill: this.peachBill ? structuredClone(this.peachBill) : null,
      muteCity: this.muteCity ? structuredClone(this.muteCity) : null,
    };
  }
  /** Phase 4.2: same snapshot but the 128 KB WASM copy lands in a caller-owned
   * ring buffer instead of allocating a fresh Uint8Array per snapshot. The
   * returned state's physics aliases that buffer until the slot is recycled
   * (slots cycle slower than the retained history window). */
  captureStateInto(physicsTarget: Uint8Array): MatchState {
    const state = this.captureState();
    state.physics = this.content.physics.copyMemoryInto(physicsTarget);
    return state;
  }
  /** Phase 4.3: hash the live state without cloning it first. Shallow fighter
   * copies + shared subsystem refs canonicalize identically to the cloned
   * snapshot (canonical() sorts keys and Set entries; clone preserves values),
   * and the WASM view is hashed without a 128 KB copy. Must be called
   * synchronously at a frame boundary. */
  liveStateHash(): string {
    const runtime = {
      version: 1 as const, configuration: this.configuration, phase: this.phase, frame: this.frame, firstInfected: this.firstInfected,
      countdown: this.countdown, remainingFrames: this.remainingFrames, winner: this.winner,
      hill: this.hill,
      fighters: this.fighters.map(({ content, ...state }) => ({ ...state, contentKind: content.profile.kind })),
      projectiles: this.projectiles.captureState(), items: this.itemWorld.captureState(),
      events: this.events, shots: this.shots,
      soundCursors: this.soundCursors, bots: this.bots,
      stadium: this.stadium, yoshiBlocks: [...this.yoshiBlocks],
      greens: this.greens ? structuredClone(this.greens) : null,
      onett: this.onett,
      peachBill: this.peachBill ? structuredClone(this.peachBill) : null,
      muteCity: this.muteCity ? structuredClone(this.muteCity) : null,
    };
    const hash = sha256.create().update(new TextEncoder().encode(canonical(runtime))).update(this.content.physics.memoryView()).digest();
    return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  restoreState(state: MatchState): void {
    if (state.version !== 1 || state.configuration !== this.configuration || state.fighters.length !== this.fighters.length || state.fighters.some((fighter, slot) => fighter.seatId !== this.seatIds[slot]) || state.physics.byteLength !== this.content.physics.wasm.memory.buffer.byteLength) throw new Error('Incompatible match snapshot.');
    this.restoreRevisionValue++;
    this.content.physics.restoreState(state.physics);
    this.phase = state.phase; this.frame = state.frame; this.countdown = state.countdown;
    this.remainingFrames = state.remainingFrames; this.winner = state.winner; this.firstInfected = state.firstInfected;
    this.hill = state.hill ? structuredClone(state.hill) : null;
    // Preserve fighter identities used by combat/render callers, and never clone resources.
    // Transform (Zelda/Sheik down-B) swaps the live content ref; snapshots carry
    // the content kind so rollback restores the same moveset, model and WASM attrs.
    // Costumes share the kind, so compare kinds (not identity): a costumed slot
    // keeps its skin across rollback instead of reverting to the roster model.
    this.fighters.forEach((fighter, slot) => {
      const {seatId, contentKind, ...runtime} = state.fighters[slot]!;
      if (seatId !== fighter.seatId) throw new Error('Incompatible static fighter seat.');
      const target = this.content.roster.get(contentKind);
      if (!target) throw new Error('Transformed fighter content is missing from the roster.');
      if (target.profile.kind !== fighter.content.profile.kind) {
        // Rollback crossed a Transform: reapply the paired costume model when
        // this slot carries one, mirroring transformFighter's symmetric swap.
        const paired = fighter.content.transformModel;
        fighter.content = paired ? { ...target, model: paired, costume: fighter.content.costume, transformModel: fighter.content.model } : target;
        this.content.physics.configureSlot(fighter.slot, target.profile);
      }
      Object.assign(fighter, structuredClone(runtime));
    });
    this.projectiles.restoreState(state.projectiles);
    this.itemWorld.restoreState(state.items);
    while (this.groundLossLog.length && this.groundLossLog[this.groundLossLog.length - 1]!.frame > this.frame) this.groundLossLog.pop();
    this.events.splice(0, this.events.length, ...structuredClone(state.events));
    this.shots = structuredClone(state.shots); this.soundCursors = structuredClone(state.soundCursors); this.bots = structuredClone(state.bots);
    this.stadium = state.stadium ? structuredClone(state.stadium) : null;
    {
      const blocks = (state as { yoshiBlocks?: unknown; yoshiSpin?: unknown }).yoshiBlocks;
      if (Array.isArray(blocks) && blocks.length === YOSHI_BLOCK_COUNT && blocks.every((timer) => Number.isInteger(timer) && (timer as number) >= 0 && (timer as number) <= YOSHI_SPIN_FRAMES)) this.yoshiBlocks = [...(blocks as number[])];
      else {
        // Backwards-compatible group timer (prototype center-bridge era): a spinning
        // group restores the center row, matching the old phased set.
        const spin = (state as { yoshiSpin?: unknown }).yoshiSpin;
        const timer = typeof spin === 'number' && Number.isInteger(spin) && spin > 0 ? Math.min(YOSHI_SPIN_FRAMES, spin) : 0;
        this.yoshiBlocks = new Array(YOSHI_BLOCK_COUNT).fill(0);
        if (timer > 0) { this.yoshiBlocks[0] = timer; this.yoshiBlocks[1] = timer; this.yoshiBlocks[2] = timer; }
      }
    }
    this.greens = state.greens ? structuredClone(state.greens) : null;
    this.greensCache = null;
    this.onett = state.onett ? structuredClone(state.onett) : null;
    this.peachBill = (state as { peachBill?: unknown }).peachBill ? structuredClone((state as { peachBill: PeachBillRuntime }).peachBill) : null;
    this.muteCity = state.muteCity ? structuredClone(state.muteCity) : null;
    // The active collision set is derived from the restored clock, never left stale.
    if (this.stadium && this.content.stadium) this.content.stage = stadiumStageAt(this.content.stadium, this.stadium);
    if (this.muteCity && this.content.muteCityData) {
      const phase = this.content.muteCityData.phases.get(muteCityPhaseKey(this.muteCity.areas));
      if (!phase) throw new Error('Incompatible match snapshot.');
      this.content.stage = phase;
    }
    // Pose caches are derived, not authoritative state. Recompute without stepping.
    this.fighters.forEach(fighter => this.poses.sample(fighter,false));
  }
  stateHash(state: MatchState = this.captureState()): string {
    const {physics, ...runtime} = state;
    const hash = sha256.create().update(new TextEncoder().encode(canonical(runtime))).update(physics).digest();
    return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  snapshot() {
    const snapshotFighter = (fighter: MatchFighter) => ({ seatId: fighter.seatId, controllerKind: this.controllerKinds[fighter.slot]!, name: fighter.content.profile.name, kind:fighter.content.profile.kind, custom:!!fighter.content.custom, x: fighter.x, y: fighter.y, vx: fighter.velocity.x, vy: fighter.velocity.y, grounded: fighter.grounded, facing: fighter.facing, state: fighter.state, animation: fighter.animation, animationFrame: fighter.animationFrame, percent: fighter.percent, stocks: fighter.stocks, infected: fighter.infected, nana: fighter.nana ? { active: fighter.nana.active, percent: Math.floor(fighter.nana.percent) } : null, jumpsUsed: fighter.jumpsUsed, hitlag: fighter.hitlag, hitstun: fighter.hitstun, smash:fighter.smash?{phase:fighter.smash.phase,frames:fighter.smash.frames,maxFrames:fighter.smash.maxFrames,multiplier:fighter.smash.multiplier}:null, shield: Math.max(0,fighter.combat.shield), shieldStun:fighter.combat.shieldStun, grabbedBy:fighter.state==='captured'?fighter.combat.partner:null, holding:['holding','throw'].includes(fighter.state)?fighter.combat.partner:null, ledge:fighter.combat.ledge, copyAbility: fighter.copyAbility, samusCharge: fighter.samusCharge, dkPunchCharge: fighter.dkPunchCharge, ice: fighter.ice ? { timer: Math.round(fighter.ice.timer) } : null, special: fighter.special ? { direction: fighter.special.direction, phase: fighter.special.phase } : null });
    return { phase: this.phase, frame: this.frame, countdown: this.countdown, remainingFrames: this.remainingFrames, winner: this.winner, controlledPlayer: this.options.player, controllerKinds: this.controllerKinds,
      hill: this.hill ? { teams: this.options.teams, zones: this.hill.zones.map(zone => ({ ...zone })), points: [...this.hill.points], teamPoints: [...this.hill.teamPoints] as [number, number], holders: [...this.hill.holders], relocateIn: this.hill.relocateIn, relocations: this.hill.relocations } : null,
      stadium: this.stadium ? { form: this.stadium.form, next: this.stadium.next, phase: this.stadium.phase, timer: this.stadium.timer } : null,
      fighters: this.fighters.map(snapshotFighter) as Players<ReturnType<typeof snapshotFighter>>,
      projectiles: this.projectiles.items.map((p) => ({ id: p.id, kind: p.kind, owner: p.owner, x: p.x, y: p.y, vx: p.vx, vy: p.vy, damage: p.hit.damage, life: p.life })),
      items: this.itemWorld.items.map((item) => ({ id: item.id, kind: item.kind, phase: item.phase, x: item.x, y: item.y, heldBy: item.phase === 'held' ? item.owner : null })),
      groundLoss: this.groundLossLog.map((entry) => ({ ...entry })),
      yoshiBlocks: [...this.yoshiBlocks], yoshiSpin: this.yoshiSpin, yoshiSpinning: this.yoshiSpin > 0,
      greens: this.greens ? { phase: this.greens.phase, cycle: this.greens.cycle, windActive: this.greens.windActive, windDir: this.greens.windDir, blocks: this.greens.blocks.filter((block) => block.status !== 0).length } : null,
      onett: this.onett ? { warning: this.onett.warning, building: this.onett.building.state, rooftopOut: this.onett.building.state === 5 || this.onett.building.state === 6 || this.onett.building.state === 7, cars: [this.onett.a, this.onett.b].map((car) => ({ x: car.x, dir: car === this.onett!.a ? -1 : 1, visible: car.visible, state: car.state })) } : null,
      peachBill: this.peachBill ? { state: this.peachBill.state, x: this.peachBill.x, y: this.peachBill.y, slot: this.peachBill.slot } : null,
      muteCity: this.muteCity ? { areas: [...this.muteCity.areas], deck: this.muteCity.deckOn, mode: this.muteCity.railMode } : null };
  }
}
