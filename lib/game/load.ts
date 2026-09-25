import type { HsdAssetSession } from '../hsd/session.ts';
import type { HsdModel, V3 } from '../hsd/model.ts';
import type { AnimationClip, FighterAction } from '../hsd/animation.ts';
import type { HsdArchive } from '../hsd/archive.ts';
import { parseCommonEffects, type CommonEffectsData } from './common-effects.ts';
import { fighterAjFile, fighterDatFile, parseCommonGameplay, parseFighterProfile, parseStageGameplay, type CommonGameplayData, type FighterProfile, type StageGameplayData, type FighterKind, type OriginalFighterKind } from './data.ts';
import { parseAttack, type AttackDefinition } from './moves.ts';
import { RUN_MOTIONS } from './locomotion.ts';
import { instantiateGameplay, MeleePhysics } from './physics.ts';
import { parseSpecialParameters, parseArticle, parseCopyAbility, parseEffectModels, parseEffectParticles, parseMexEffectModels, type SpecialAssets, type FighterSpecialData, type CopyAbility, type CopySource } from './special-data.ts';
import { SsmBank, SemTable, GameSoundLibrary } from './audio.ts';
import { parseKoEffect, type KoEffectData } from './ko-effect.ts';
import { parseItemsData, type ItemsData } from './item-data.ts';
import { parseCombatData, COMBAT_MOTIONS, type CombatData } from './combat-data.ts';
import { resolveAceVoice, routeAceSound, SEM_ROUTED_ACE_KINDS, ACE_SSM_RANGES } from './ace-voices.ts';
import { addCustomCharacters, createCustomCharacter, CUSTOM_FIGHTERS } from '../custom/registry.ts';
import { isCustomFighter, type CustomFighterKind } from '../custom/identity.ts';
import { KIRBY_ACTION_KEYS, KIRBY_AIR_JUMPS, KIRBY_MOVES } from './kirby.ts';
import { ROY_ACTION_KEYS, ROY_MOVES } from './roy-data.ts';
import { SAMUS_ACTION_KEYS, parseSamusArticles } from './samus-data.ts';
import { parseLinkHookshot, type HookshotData } from './link-hookshot.ts';
import { LIGHT_ITEM_MOTIONS, SMASH_ITEM_MOTIONS } from './item-common.ts';
import { TAUNT_MOTIONS } from './taunt.ts';
import { PIKACHU_ACTION_KEYS, PIKACHU_MOVES, parsePikachuArticles } from './pikachu-data.ts';
import { MEWTWO_ACTION_KEYS, MEWTWO_MOVES, parseMewtwoArticles } from './mewtwo-data.ts';
import { clampCostumeIndex, costumeModelFile, nanaCostumeFile } from './costumes.ts';
import { PURIN_ACTION_KEYS, PURIN_MOVES, PURIN_AIR_JUMPS } from './purin-data.ts';
import { NESS_ACTION_KEYS, NESS_MOVES, parseNessArticles } from './ness-data.ts';
import { KOOPA_ACTION_KEYS, KOOPA_MOVES, parseKoopaArticles } from './koopa-data.ts';
import { GK_ACTION_KEYS, GK_MOVES, parseGkArticles } from './gk-data.ts';
import { PEACH_ACTION_KEYS, PEACH_MOVES, PEACH_PART_DEFAULTS, parsePeachArticles } from './peach-data.ts';
import { LINK_ITEM_MOTIONS, LINK_MOVES, linkActionKeys, parseLinkArticles, parseLinkShieldAttachment } from './link-data.ts';
import { FALCON_ACTION_KEYS, FALCON_MOVES } from './falcon-data.ts';
import { GANON_ACTION_KEYS, GANON_MOVES } from './ganon-data.ts';
import { FALCO_ACTION_KEYS, FALCO_MOVES } from './falco-data.ts';
import { DRMARIO_MOVES } from './drmario-data.ts';
import { PICHU_ACTION_KEYS, PICHU_MOVES, parsePichuArticles } from './pichu-data.ts';
import { MARTH_ACTION_KEYS, MARTH_MOVES } from './marth-data.ts';
import { LUIGI_ACTION_KEYS, LUIGI_MOVES } from './luigi-data.ts';
import { POPO_ACTION_KEYS, POPO_MOVES, parsePopoArticles } from './popo-data.ts';
import { ZELDA_ACTION_KEYS, ZELDA_MOVES, parseZeldaArticles } from './zelda-data.ts';
import { SEAK_ACTION_KEYS, SEAK_MOVES, parseSeakArticles } from './seak-data.ts';
import { GAMEWATCH_ACTION_KEYS, GAMEWATCH_MOVES, parseGamewatchArticles } from './gamewatch-data.ts';
import { YOSHI_ACTION_KEYS, YOSHI_MOVES, parseYoshiArticles } from './yoshi-data.ts';
import { ZERO_ACTION_KEYS, ZERO_MOVES, parseZeroArticles } from './zero-data.ts';
import { TOAD_ACTION_KEYS, TOAD_MOVES, parseToadArticles } from './toad-data.ts';
import { TAILS_ACTION_KEYS, TAILS_MOVES, parseTailsArticles } from './tails-data.ts';
import { METAKNIGHT_ACTION_KEYS, METAKNIGHT_MOVES, METAKNIGHT_AIR_JUMPS } from './metaknight-data.ts';
import { SONIC_ACTION_KEYS, SONIC_MOVES, SONIC_PART_DEFAULTS, parseSonicArticles } from './sonic-data.ts';
import { RAICHU_ACTION_KEYS, RAICHU_MOVES, parseRaichuArticles } from './raichu-data.ts';
import { LIZARDON_ACTION_KEYS, LIZARDON_MOVES, LIZARDON_AIR_JUMPS, parseLizardonArticles } from './lizardon-data.ts';
import { WOLF_ACTION_KEYS, WFU_ACTION_KEYS, WOLF_MOVES, parseWolfArticles } from './wolf-data.ts';
import { DIDDY_ACTION_KEYS, DIDDY_MOVES, parseDiddyArticles } from './diddy-data.ts';
import { DEDEDE_ACTION_KEYS, DEDEDE_MOVES, DEDEDE_AIR_JUMPS, parseDededeArticles } from './dedede-data.ts';
import { WARIO_ACTION_KEYS, WARIO_MOVES, parseWarioArticles } from './wario-data.ts';
import { SHADOW_ACTION_KEYS, SHADOW_MOVES, parseShadowArticles } from './shadow-data.ts';
import { BLASTOISE_ACTION_KEYS, BLASTOISE_MOVES, parseBlastoiseArticles } from './blastoise-data.ts';
import { LUCAS_ACTION_KEYS, LUCAS_MOVES, parseLucasArticles } from './lucas-data.ts';
import { METALSONIC_ACTION_KEYS, METALSONIC_MOVES, parseMetalSonicArticles } from './metal-data.ts';
import { NINTEN_ACTION_KEYS, NINTEN_MOVES, parseNintenArticles } from './ninten-data.ts';
import { DAISY_ACTION_KEYS, DAISY_MOVES, parseDaisyArticles } from './daisy-data.ts';
import { FAY_ACTION_KEYS, FAY_MOVES, parseFayArticles } from './fay-data.ts';
import { BSONIC_ACTION_KEYS, BSONIC_MOVES, BSONIC_PART_DEFAULTS, parseBSonicArticles } from './bsonic-data.ts';
import { DRLUIGI_ACTION_KEYS, DRLUIGI_MOVES, parseDrLuigiArticles } from './drluigi-data.ts';
import { KNUCKLES_ACTION_KEYS, KNUCKLES_MOVES, parseKnucklesArticles } from './knuckles-data.ts';
import { LUCINA_ACTION_KEYS, LUCINA_MOVES } from './lucina-data.ts';
import { LC2_ACTION_KEYS, LC2_MOVES, parseLc2Articles } from './lc2-data.ts';
import { SM_ACTION_KEYS, SM_MOVES, parseShadowMewtwoArticles } from './smewtwo-data.ts';
import { LB_ACTION_KEYS, LB_MOVES } from './lb-data.ts';
import { MM_ACTION_KEYS, MM_MOVES, parseMetalMarioArticles } from './metalmario-data.ts';
import { SD_ACTION_KEYS, SD_MOVES, parseSkullKidArticles } from './sd-data.ts';
import { CHUNLI_ACTION_KEYS, CHUNLI_MOVES, parseChunLiArticles } from './chunli-data.ts';
import { DK_ACTION_KEYS, DK_MOVES } from './dk-data.ts';
import { supportedStage, type StageId } from './stages.ts';
import { parseMuteCityData, type MuteCityTrackData } from './mutecity.ts';
import { parseStadium, STADIUM_VARIANTS, STADIUM_VARIANT_ARCHIVES, type StadiumData, type StadiumForm } from './stadium.ts';
import { parseOnettData, type OnettData } from './onett.ts';
import { parsePeachBillData, type PeachBillData } from './peach-bill.ts';

export interface FighterContent {
  profile: FighterProfile; model: HsdModel; hookshot?: HookshotData; passiveAttachment?:{parent:number;scale:V3;offset:V3}; custom?: CustomFighterKind; clips: Map<string, AnimationClip>;
  /** Costume index of `model` (0 = the `Nr` default); gameplay never reads it. */
  costume?: number;
  /** Nana's model for Ice Climbers (`PlNn*.dat`, same skeleton as Popo).
   * Absent on sources without her files — the slot plays solo Popo then. */
  partnerModel?: HsdModel;
  /** Paired Zelda/Sheik costume model so a Transform keeps the costume index. */
  transformModel?: HsdModel;
  attacks: Map<string, AttackDefinition>; timelines: Map<string, AttackDefinition>; specials: SpecialAssets;
  moves: { jab: string; jab2?: string; jab3?: string; rapidStart?: string; rapidLoop?: string; rapidEnd?: string;
    dash: string; strong: string; downTilt: string; downSmash: string; neutralAir: string; forwardAir: string; downAir: string; sideTilt?:string; upTilt?:string; upSmash?:string; upAir?:string; backAir?:string };
  /** Native ftData +0x54 five-part cycle for elemental damage effects. */
  effectBones?:number[];
  /** Explicit unavailable original mechanics; never substitute another fighter's script. */
  canGrab?: boolean;
  /** Engine motions whose original clip name differs (Kirby's SquatWait1). */
  motions?: { crouchWait?: string };
  /** Multi-jump fighters: one clip and vertical impulse per air jump (ftCo_800D74A4). */
  airJumps?: { animations: string[]; vertical: number[]; impulseX: number; turnFrames: number; turnThreshold: number; accelMultiplier: number; speedMultiplier: number };
  /** Inhale-style capture: hold/wait/spit/swallow clips, the swallow stick threshold and the
   * victim's escape timer (ftCommon_InitGrab with specialn_base_duration; each mash press
   * subtracts specialn_inhale_resistance, each frame specialn_duration_divisor). */
  inhale?: { hold: string; wait: string; spit: string; swallow: string; stickDown: number; walkStick: number; walkSpeed: number; holdFrames: number; holdDecay: number; mashResistance: number };
  /** Copy abilities this fighter can steal by swallowing (Kirby: Fox and Mario from PlKbCp*.dat). */
  copies?: Partial<Record<CopySource, CopyAbility>>;
  /** Visibility alternative each draw group starts at when the fighter's own spawn code sets them
   * (ftParts_80074A4C) instead of leaving every group on alternative 0. */
  partDefaults?: readonly number[];
  /** Cargo carry (Donkey Kong): the forward throw lifts the victim, then wait/walk states
   * carry it until one of the four cargo throws releases (ftDk_MS_ThrowF*). */
  cargo?: { lift: string; wait: string; walks: readonly [string, string, string]; throws: { f: string; b: string; hi: string; lw: string } };
}
export interface GameContent {
  /** Original common KO beam, absent only in resource-free simulation fixtures. */
  koEffect?: KoEffectData;
  common: CommonGameplayData; combat: CombatData; stage: StageGameplayData; stageModel: HsdModel; stageId: StageId;
  commonEffects?:CommonEffectsData;
  /** Common match-item archive (ItCo.dat); absent when the source manifest does not expose it. */
  items?: ItemsData;
  /** Dynamic-stage data (Pokémon Stadium): per-form collision, original schedule and variant terrain models. */
  stadium?: StadiumData; stadiumModels?: Readonly<Partial<Record<StadiumForm, HsdModel>>>;
  /** Mute City dynamic road (scripted area cycle + traveling deck); set only there. */
  muteCityData?: MuteCityTrackData;
  /** Onett hazard data (car hits, tuning, building clips); present on Onett. */
  onettData?: OnettData;
  /** Peach's Castle Bill tuning (spawn window + damage from yakumono); present there. */
  peachBillData?: PeachBillData;
  fighters: [FighterContent, FighterContent, ...FighterContent[]]; roster: Map<FighterKind,FighterContent>; physics: MeleePhysics; sound: GameSoundLibrary;
}
const TRIP_MOTIONS = ['MissFoot', 'DownBoundU', 'DownStandU'] as const;
/** Tech (ukemi) and knockdown motions: tech in place/rolls, wall tech, the knockdown
 * wait and its getup attack/rolls. Optional like the trip set — a fighter whose source
 * lacks them simply lands out of a tumble the old way. `DownFowardU` is the original's
 * own spelling. */
const TECH_MOTIONS = ['Passive', 'PassiveStandF', 'PassiveStandB', 'PassiveWall', 'DownWaitU', 'DownAttackU', 'DownFowardU', 'DownBackU'] as const;
const BASE_MOTIONS = ['Wait1', 'WalkSlow', 'WalkMiddle', 'WalkFast', 'Run', 'Landing', 'JumpF', 'Fall', 'DamageN1', 'DamageFlyN', 'LandingAirN', 'LandingAirF', 'LandingAirLw', 'Squat', 'SquatRv'] as const;

/** One explicit descriptor per original fighter: no shared fallbacks between characters. */
interface OriginalFighterSpec {
  kind: OriginalFighterKind; effects: string; moves: FighterContent['moves'];
  partDefaults?: readonly number[];
  /** SSM voice bank (`audio/us/<bank>.ssm`); null only while a fighter's bank is unmapped. */
  bank: string | null;
  /** Loaded only when its Pl archive is present (modded extension-disc fighters). */
  optional?: boolean;
  /** HSDRaw-authored clips may omit trailing joints that own no tracks; modded fighters
   * accept those shorter clips (unanimated tails), vanilla fighters stay exact. */
  trimmedClips?: boolean;
  unsupportedActions?: readonly string[]; canGrab?: boolean;
  motions?: FighterContent['motions']; inhale?: FighterContent['inhale']; cargo?: FighterContent['cargo'];
  /** Motions loaded by figatree name besides the base set, moves and combat motions. */
  extraClips: readonly string[];
  /** Non-move motions whose original scripts still drive gameplay (Link's AttackS42 followup, bomb throws). */
  extraAttacks?: readonly string[];
  /** Load every action whose figatree name starts with Special (single-state specials). */
  specialsByName: boolean;
  /** Motions loaded from a verified action-table entry (repeated figatree names). `joints`
   * overrides the expected track count for extended-skeleton clips (Kirby's Mewtwo hat);
   * `scriptFrames` unrolls a script that keeps cycling past its looping clip. */
  keyed: ReadonlyArray<{ key: string; index: number; figatree: string; joints?: number; scriptFrames?: number }>;
  articles(metadata: HsdArchive): SpecialAssets['articles'];
  airJumps?(parameters: FighterSpecialData): FighterContent['airJumps'];
  /** Copy archives; the source fighter must already be loaded so its projectile supplies the missing item common block. */
  copies?: ReadonlyArray<{ source: CopySource; archive: string }>;
}
const FIGHTER_SPECS: readonly OriginalFighterSpec[] = [
  { kind: 'Fe', effects: 'EfFeData.dat', bank: 'emblem', specialsByName: false, keyed: ROY_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: ROY_MOVES, articles: () => ({}) },
  // Donkey Kong has no articles; Giant Punch/Headbutt/Spinning Kong/Hand Slap run on keyed scripts.
  { kind: 'Dk', effects: 'EfDkData.dat', bank: 'dk', specialsByName: false, keyed: DK_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi', 'ThrowFWait', 'ThrowFWalkSlow', 'ThrowFWalkMiddle', 'ThrowFWalkFast', 'ThrowFF', 'ThrowFB', 'ThrowFHi', 'ThrowFLw'],
    extraAttacks: ['ThrowFF', 'ThrowFB', 'ThrowFHi', 'ThrowFLw'], moves: DK_MOVES, articles: () => ({}),
    cargo: { lift: 'ThrowF', wait: 'ThrowFWait', walks: ['ThrowFWalkSlow', 'ThrowFWalkMiddle', 'ThrowFWalkFast'], throws: { f: 'ThrowFF', b: 'ThrowFB', hi: 'ThrowFHi', lw: 'ThrowFLw' } } },
  // Captain Falcon has no articles; Raptor Boost/Dive/Kick run on keyed scripts and root motion.
  { kind: 'Ca', effects: 'EfCaData.dat', bank: 'captain', specialsByName: false, keyed: FALCON_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: FALCON_MOVES, articles: () => ({}) },
  { kind: 'Ss', effects: 'EfSsData.dat', bank: 'samus', canGrab: false, unsupportedActions: ['Catch', 'CatchDash'], specialsByName: false, keyed: SAMUS_ACTION_KEYS, extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: { jab: 'Attack11', jab2: 'Attack12', dash: 'AttackDash', strong: 'AttackS4S', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3', upSmash: 'AttackHi4', downSmash: 'AttackLw4', neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw' },
    articles: parseSamusArticles },
  { kind: 'Fx', effects: 'EfFxData.dat', bank: 'fox', specialsByName: true, keyed: [], extraClips: ['JumpAerialF', 'SquatWait'],
    moves: { jab: 'Attack11', jab2: 'Attack12', rapidStart: 'Attack100Start', rapidLoop: 'Attack100Loop', rapidEnd: 'Attack100End', dash: 'AttackDash', strong: 'AttackS4', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3', upSmash: 'AttackHi4', downSmash: 'AttackLw4', neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw' },
    articles: (metadata) => ({ projectile: parseArticle(metadata, 0, 'laser'), accessory: parseArticle(metadata, 1, 'blaster'), ghost: parseArticle(metadata, 2, 'illusion') }) },
  { kind: 'Mr', effects: 'EfMrData.dat', bank: 'mario', specialsByName: true, keyed: [], extraClips: ['JumpAerialF', 'SquatWait'],
    moves: { jab: 'Attack11', jab2: 'Attack12', jab3: 'Attack13', dash: 'AttackDash', strong: 'AttackS4S', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3', upSmash: 'AttackHi4', downSmash: 'AttackLw4', neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw' },
    articles: (metadata) => ({ projectile: parseArticle(metadata, 0, 'fireball'), accessory: parseArticle(metadata, 2, 'cape') }) },
  // Falco shares Fox's motion layout; illusion lives in slot 3 (slot 2 is empty), values from PlFc.dat.
  { kind: 'Fc', effects: 'EfFxData.dat', bank: 'falco', specialsByName: false, keyed: FALCO_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: FALCO_MOVES,
    articles: (metadata) => ({ projectile: parseArticle(metadata, 0, 'laser'), accessory: parseArticle(metadata, 1, 'blaster'), ghost: parseArticle(metadata, 3, 'illusion') }) },
  // Dr. Mario reuses Mario's motion names/scripts; pill is slot 1 and cape slot 3 (slots 0/2 empty).
  { kind: 'Dr', effects: 'EfMrData.dat', bank: 'drmario', specialsByName: true, keyed: [], extraClips: ['JumpAerialF', 'SquatWait'],
    moves: DRMARIO_MOVES,
    articles: (metadata) => ({ projectile: parseArticle(metadata, 1, 'megavitamin'), accessory: parseArticle(metadata, 3, 'cape') }) },
  // Ganondorf reuses Captain Falcon's scripts/root motion; values come from ftDataGanon.
  { kind: 'Gn', effects: 'EfGnData.dat', bank: 'ganon', specialsByName: false, keyed: GANON_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: GANON_MOVES, articles: () => ({}) },
  // Pichu reuses Pikachu's scripts/articles; self-damage recoil remains an explicit prototype gap.
  { kind: 'Pc', effects: 'EfPkData.dat', bank: 'pichu', specialsByName: false, keyed: PICHU_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: PICHU_MOVES, articles: parsePichuArticles },
  // Marth shares Roy's MarsAttributes layout and sword-dance/counter orchestration; tipper lives in hitbox data.
  { kind: 'Ms', effects: 'EfMsData.dat', bank: 'mars', specialsByName: false, keyed: MARTH_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: MARTH_MOVES, articles: () => ({}) },
  // Luigi: Green Missile charge/misfire, Super Jump Punch and Cyclone run on keyed scripts; fireball is slot 0.
  { kind: 'Lg', effects: 'EfLgData.dat', bank: 'luigi', specialsByName: false, keyed: LUIGI_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: LUIGI_MOVES,
    articles: (metadata) => ({ projectile: parseArticle(metadata, 0, 'luigi-fire') }) },
  // Ice Climbers duo: Ice Shot slide, Squall advance, solo-geometry Belay rise
  // and Blizzard spray puffs, plus Nana's partner model rolling on Popo's own
  // skeleton, clips and scripts (see lib/game/nana.ts). Desyncs, partner-throw
  // Belay heights and projectile/item hits on Nana stay out of scope.
  { kind: 'Pp', effects: 'EfIcData.dat', bank: 'ice', specialsByName: false, keyed: POPO_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: POPO_MOVES, articles: parsePopoArticles },
  // Zelda: Nayru's reflector, guided Din's Fire, Farore's aimed teleport and
  // Transform into Sheik (in-place content swap, snapshot-safe).
  { kind: 'Zd', effects: 'EfZdData.dat', bank: 'zs', specialsByName: false, keyed: ZELDA_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: ZELDA_MOVES, articles: parseZeldaArticles },
  // Sheik: stored Needle Storm, chain whip, Vanish burst and Transform back.
  // Shares Zelda's effect bank and voice bank (no EfSkData.dat on disc).
  { kind: 'Sk', effects: 'EfZdData.dat', bank: 'zs', specialsByName: false, keyed: SEAK_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: SEAK_MOVES, articles: parseSeakArticles },
  // Mr. Game & Watch: Chef sausages, Judgment numbers, Fire parachute and Oil
  // Panic bucket. 2D skeleton with 11 visibility groups; no EfGwData.dat.
  { kind: 'Gw', effects: 'EfCoData.dat', bank: 'gw', specialsByName: false, keyed: GAMEWATCH_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: GAMEWATCH_MOVES, articles: parseGamewatchArticles },
  // Yoshi: Egg Lay trap, Egg Roll, Egg Throw ballistics and Yoshi Bomb stars.
  // No egg shield or double-jump armor in the prototype (documented gaps).
  { kind: 'Ys', effects: 'EfYsData.dat', bank: 'yoshi', specialsByName: false, keyed: YOSHI_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: YOSHI_MOVES, articles: parseYoshiArticles },
  { kind: 'Mt', effects: 'EfMtData.dat', bank: 'mewtwo', specialsByName: false, keyed: MEWTWO_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: MEWTWO_MOVES, articles: parseMewtwoArticles },
  // Bowser: the Fire Breath flame is his only article; Klaw/Fortress/Bomb run on keyed scripts.
  { kind: 'Kp', effects: 'EfKpData.dat', bank: 'koopa', specialsByName: false, keyed: KOOPA_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: KOOPA_MOVES, articles: parseKoopaArticles },
  // Giga Bowser (ACE 2.0): Koopa-family kit on Bowser's part table; reuses
  // EfKpData.dat (no EfGkData.dat on disc). Voice bank audio/us/gkoopa.ssm.
  { kind: 'Gk', effects: 'EfKpData.dat', bank: 'gkoopa', optional: true, trimmedClips: true, specialsByName: false, keyed: GK_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: GK_MOVES, articles: parseGkArticles },
  { kind: 'Ts', effects: 'EfTsData.dat', bank: 'tails', optional: true, trimmedClips: true, specialsByName: false, keyed: TAILS_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: TAILS_MOVES, articles: parseTailsArticles },
  // Blood Falcon (ACE CSS slot 045): Captain Falcon's PlCa.dat moveset verbatim on
  // the PlBf* costume models, with his own EfBfData.dat and Falcon's voice bank.
  { kind: 'Bf', effects: 'EfBfData.dat', bank: 'captain', optional: true, specialsByName: false, keyed: FALCON_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: FALCON_MOVES, articles: () => ({}) },
  // Wolf SSBU (PlWfU.dat, ACE CSS slot 052): Wolf's kit on SSBU-authored clips and
  // the PlWf*_001 models; wolf_001.ssm duplicates wolf.ssm at base 2694.
  { kind: 'WfU', effects: 'EfWfData.dat', bank: 'wolf_001', optional: true, trimmedClips: true, specialsByName: false, keyed: WFU_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: WOLF_MOVES, articles: parseWolfArticles },
  // Peach: explosion/turnip/parasol/Toad/spore articles; float and the weapon smashes are keyed.
  { kind: 'Pe', effects: 'EfPeData.dat', bank: 'peach', specialsByName: false, keyed: PEACH_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    extraAttacks: ['ItemParasolOpen', 'ItemParasolFall', 'AttackS4Club', 'AttackS4Pan', 'AttackS4Racket'], moves: PEACH_MOVES, articles: parsePeachArticles, partDefaults: PEACH_PART_DEFAULTS },
  // Ness: PK Fire/Flash/Thunder articles come from the PlNs x48 item table; PSI Magnet absorbs.
  { kind: 'Ns', effects: 'EfNsData.dat', bank: 'ness', specialsByName: false, keyed: NESS_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait1', 'LandingAirB', 'LandingAirHi'], moves: NESS_MOVES, articles: parseNessArticles, motions: { crouchWait: 'SquatWait1' } },
  // Jigglypuff has no articles; Rollout/Pound/Sing/Rest run on keyed scripts and motion vars.
  { kind: 'Pr', effects: 'EfPrData.dat', bank: 'purin', specialsByName: false, keyed: PURIN_ACTION_KEYS,
    extraClips: [...PURIN_AIR_JUMPS, 'SquatWait1', 'LandingAirB', 'LandingAirHi'], moves: PURIN_MOVES, articles: () => ({}), motions: { crouchWait: 'SquatWait1' },
    airJumps: (parameters) => {
      if (parameters.kind !== 'Pr') throw new Error('Jigglypuff multi-jump data is missing.');
      const { jumps } = parameters;
      return { animations: [...PURIN_AIR_JUMPS].slice(0, jumps.vertical.length), vertical: jumps.vertical, impulseX: jumps.impulseX, turnFrames: jumps.turnFrames, turnThreshold: jumps.turnThreshold, accelMultiplier: jumps.accelMultiplier, speedMultiplier: jumps.speedMultiplier };
    } },
  { kind: 'Pk', effects: 'EfPkData.dat', bank: 'pikachu', specialsByName: false, keyed: PIKACHU_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi'], moves: PIKACHU_MOVES, articles: parsePikachuArticles },
  { kind: 'Lk', effects: 'EfLkData.dat', bank: 'link', specialsByName: false, keyed: linkActionKeys('Lk'),
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi', 'AirCatch', 'AirCatchHit', ...LINK_ITEM_MOTIONS], extraAttacks: ['AttackS42', 'AirCatch', 'AirCatchHit', ...LINK_ITEM_MOTIONS.flatMap(name=>[name,`${name}4`])],
    moves: LINK_MOVES, articles: (metadata) => parseLinkArticles(metadata, 'Lk') },
  // Young Link reads his own PlCl archives/parameters; only the effect bank symbol is shared (EfClData.dat does not exist).
  { kind: 'Cl', effects: 'EfLkData.dat', bank: 'clink', specialsByName: false, keyed: linkActionKeys('Cl'),
    extraClips: ['JumpAerialF', 'SquatWait', 'LandingAirB', 'LandingAirHi', 'AirCatch', 'AirCatchHit', ...LINK_ITEM_MOTIONS], extraAttacks: ['AttackS42', 'AirCatch', 'AirCatchHit', ...LINK_ITEM_MOTIONS.flatMap(name=>[name,`${name}4`])],
    moves: LINK_MOVES, articles: (metadata) => parseLinkArticles(metadata, 'Cl') },
  { kind: 'Kb', effects: 'EfKbData.dat', bank: 'kirby', specialsByName: false, keyed: KIRBY_ACTION_KEYS, extraClips: [...KIRBY_AIR_JUMPS, 'SquatWait1', 'LandingAirB', 'LandingAirHi'],
    moves: KIRBY_MOVES, motions: { crouchWait: 'SquatWait1' }, inhale: { hold: 'Eat', wait: 'EatWait', spit: 'SpecialNSpit', swallow: 'SpecialNDrink', stickDown: 0, walkStick: 0, walkSpeed: 0, holdFrames: 0, holdDecay: 0, mashResistance: 0 },
    // ftKb_Init_OnLoad: item slot 0 is the cutter beam, slot 1 the hammer. Slots 2–3 (inhale stars) are not loaded.
    articles: (metadata) => ({ projectile: parseArticle(metadata, 0, 'cutter'), accessory: parseArticle(metadata, 1, 'hammer') }),
    copies: [{ source: 'Fx', archive: 'PlKbCpFx.dat' }, { source: 'Mr', archive: 'PlKbCpMr.dat' },
      { source: 'Lk', archive: 'PlKbCpLk.dat' }, { source: 'Cl', archive: 'PlKbCpCl.dat' }, { source: 'Ss', archive: 'PlKbCpSs.dat' },
      { source: 'Pk', archive: 'PlKbCpPk.dat' }, { source: 'Ca', archive: 'PlKbCpCa.dat' }, { source: 'Dk', archive: 'PlKbCpDk.dat' },
      { source: 'Mt', archive: 'PlKbCpMt.dat' }, { source: 'Fe', archive: 'PlKbCpFe.dat' }],
    airJumps: (parameters) => {
      if (parameters.kind !== 'Kb') throw new Error('Kirby multi-jump data is missing.');
      const { jumps } = parameters;
      return { animations: KIRBY_AIR_JUMPS.slice(0, jumps.vertical.length), vertical: jumps.vertical, impulseX: jumps.impulseX, turnFrames: jumps.turnFrames, turnThreshold: jumps.turnThreshold, accelMultiplier: jumps.accelMultiplier, speedMultiplier: jumps.speedMultiplier };
    } },
  // Zero (ACE 2.0 m-ex build) loads only when the extension disc supplies PlZx*. His voice
  // bank audio/us/zero.ssm rides along; the dead 5xxx FtSFX ids remap to its samples
  // (lib/game/ace-voices.ts) while hit sounds keep using main.ssm.
  { kind: 'Zx', effects: 'EfZxData.dat', bank: 'zero', optional: true, specialsByName: false, keyed: ZERO_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi', 'AttackS42'],
    extraAttacks: ['AttackS42'], moves: ZERO_MOVES, articles: parseZeroArticles },
  // Toad/Meta Knight/Sonic/Raichu/Charizard (ACE 2.0): same extension-disc contract as
  // Zero, with their voice banks exposed (see ACE_VOICE_OVERRIDES for the FtSFX remap).
  { kind: 'Td', effects: 'EfTdData.dat', bank: 'toad', optional: true, trimmedClips: true, specialsByName: false, keyed: TOAD_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait1', 'LandingAirB', 'LandingAirHi'],
    moves: TOAD_MOVES, motions: { crouchWait: 'SquatWait1' }, articles: parseToadArticles },
  { kind: 'Mk', effects: 'EfMkData.dat', bank: 'metaknight', optional: true, trimmedClips: true, specialsByName: false, keyed: METAKNIGHT_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'JumpAerialF2', 'JumpAerialF3', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: METAKNIGHT_MOVES, articles: () => ({}),
    airJumps: (parameters) => {
      if (parameters.kind !== 'Mk') throw new Error('Meta Knight multi-jump data is missing.');
      const { jumps } = parameters;
      return { animations: [...METAKNIGHT_AIR_JUMPS].slice(0, jumps.vertical.length), vertical: jumps.vertical, impulseX: jumps.impulseX, turnFrames: jumps.turnFrames, turnThreshold: jumps.turnThreshold, accelMultiplier: jumps.accelMultiplier, speedMultiplier: jumps.speedMultiplier };
    } },
  { kind: 'Sn', effects: 'EfSnData.dat', bank: 'sonic', optional: true, trimmedClips: true, specialsByName: false, keyed: SONIC_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: SONIC_MOVES, articles: parseSonicArticles, partDefaults: SONIC_PART_DEFAULTS },
  { kind: 'Rc', effects: 'EfRcData.dat', bank: 'raichu', optional: true, trimmedClips: true, specialsByName: false, keyed: RAICHU_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: RAICHU_MOVES, articles: parseRaichuArticles },
  { kind: 'Lz', effects: 'EfLzData.dat', bank: 'lizardon', optional: true, trimmedClips: true, specialsByName: false, keyed: LIZARDON_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'JumpAerialF2', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: LIZARDON_MOVES, articles: parseLizardonArticles,
    airJumps: (parameters) => {
      if (parameters.kind !== 'Lz') throw new Error('Charizard multi-jump data is missing.');
      const { jumps } = parameters;
      return { animations: [...LIZARDON_AIR_JUMPS].slice(0, jumps.vertical.length), vertical: jumps.vertical, impulseX: jumps.impulseX, turnFrames: jumps.turnFrames, turnThreshold: jumps.turnThreshold, accelMultiplier: jumps.accelMultiplier, speedMultiplier: jumps.speedMultiplier };
    } },
  // Wave 2 (ACE 2.0): Wolf/Diddy/Dedede/Wario/Shadow. Voices mapped via their
  // audio/us/<name>.ssm banks; announcer stays on the generic confirm cue.
  { kind: 'Wf', effects: 'EfWfData.dat', bank: 'wolf', optional: true, trimmedClips: true, specialsByName: false, keyed: WOLF_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: WOLF_MOVES, articles: parseWolfArticles },
  { kind: 'Dd', effects: 'EfDdData.dat', bank: 'diddy', optional: true, trimmedClips: true, specialsByName: false, keyed: DIDDY_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: DIDDY_MOVES, articles: parseDiddyArticles },
  { kind: 'De', effects: 'EfDeData.dat', bank: 'dedede', optional: true, trimmedClips: true, specialsByName: false, keyed: DEDEDE_ACTION_KEYS,
    extraClips: ['JumpAerialF2', 'JumpAerialF3', 'JumpAerialF4', 'JumpAerialF5', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: DEDEDE_MOVES, articles: parseDededeArticles,
    airJumps: () => ({ animations: [...DEDEDE_AIR_JUMPS], vertical: [2.2, 2.0, 1.8, 1.6], impulseX: 0.6, turnFrames: 12, turnThreshold: 0.3, accelMultiplier: 1, speedMultiplier: 1 }) },
  { kind: 'Wr', effects: 'EfWrData.dat', bank: 'wario', optional: true, trimmedClips: true, specialsByName: false, keyed: WARIO_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: WARIO_MOVES, articles: parseWarioArticles },
  { kind: 'Sh', effects: 'EfShData.dat', bank: 'shadow', optional: true, trimmedClips: true, specialsByName: false, keyed: SHADOW_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: SHADOW_MOVES, articles: parseShadowArticles, partDefaults: SONIC_PART_DEFAULTS },
  // Wave 3 (ACE 2.0): Blastoise/Lucas/Metal Sonic/Ninten/Daisy. Daisy shares
  // Peach's vanilla effect bank and her whole kit; the rest use their extension effect banks.
  { kind: 'Bl', effects: 'EfBlData.dat', bank: 'blastoise', optional: true, trimmedClips: true, specialsByName: false, keyed: BLASTOISE_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: BLASTOISE_MOVES, articles: parseBlastoiseArticles },
  // Lucas grabs with the Rope Snake tether (Catch references part 139 like Link's
  // hook tip); the prototype has no tether grab, so he cannot grab yet (Samus rule).
  { kind: 'Lc', effects: 'EfLcData.dat', bank: 'lucas', optional: true, trimmedClips: true, specialsByName: false, keyed: LUCAS_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: LUCAS_MOVES, articles: parseLucasArticles, canGrab: false, unsupportedActions: ['Catch', 'CatchDash'] },
  { kind: 'Nm', effects: 'EfNmData.dat', bank: 'metal_sonic', optional: true, trimmedClips: true, specialsByName: false, keyed: METALSONIC_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: METALSONIC_MOVES, articles: parseMetalSonicArticles },
  { kind: 'Nt', effects: 'EfNtData.dat', bank: 'ninten', optional: true, trimmedClips: true, specialsByName: false, keyed: NINTEN_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: NINTEN_MOVES, articles: parseNintenArticles },
  { kind: 'Da', effects: 'EfPeData.dat', bank: 'daisy', optional: true, trimmedClips: true, specialsByName: false, keyed: DAISY_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    extraAttacks: ['ItemParasolOpen', 'ItemParasolFall', 'AttackS4Club', 'AttackS4Pan', 'AttackS4Racket'], moves: DAISY_MOVES, articles: parseDaisyArticles, partDefaults: PEACH_PART_DEFAULTS },
  // Wave 4 (ACE 2.0): Fay/BSonic/DrLuigi/Knuckles/Lucina. Fay, DrLuigi and
  // Lucina share vanilla effect banks (Fox/Luigi/Marth); Sc/Kx use extension banks.
  { kind: 'Fy', effects: 'EfFxData.dat', bank: 'fay', optional: true, trimmedClips: true, specialsByName: false, keyed: FAY_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: FAY_MOVES, articles: parseFayArticles },
  { kind: 'Sc', effects: 'EfScData.dat', bank: 'bmsonic', optional: true, trimmedClips: true, specialsByName: false, keyed: BSONIC_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: BSONIC_MOVES, articles: parseBSonicArticles, partDefaults: BSONIC_PART_DEFAULTS },
  { kind: 'Dl', effects: 'EfLgData.dat', bank: 'drluigi', optional: true, trimmedClips: true, specialsByName: false, keyed: DRLUIGI_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: DRLUIGI_MOVES, articles: parseDrLuigiArticles },
  { kind: 'Kx', effects: 'EfKxData.dat', bank: 'knuckles', optional: true, trimmedClips: true, specialsByName: false, keyed: KNUCKLES_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: KNUCKLES_MOVES, articles: parseKnucklesArticles, partDefaults: SONIC_PART_DEFAULTS },
  { kind: 'Lu', effects: 'EfMsData.dat', bank: 'lucina', optional: true, trimmedClips: true, specialsByName: false, keyed: LUCINA_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: LUCINA_MOVES, articles: () => ({}) },
  // Wave 5 (ACE 2.0): Lucas TDX / Shadow Mewtwo / Luigi & Boo / Metal Mario /
  // Skull Kid. Sm/Lb/MM/Sd share vanilla effect banks (Mewtwo/Luigi/Mario/common).
  { kind: 'Lc2', effects: 'EfLc2Data.dat', bank: 'lucas_001', optional: true, trimmedClips: true, specialsByName: false, keyed: LC2_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait1', 'LandingAirB', 'LandingAirHi'],
    moves: LC2_MOVES, motions: { crouchWait: 'SquatWait1' }, articles: parseLc2Articles },
  { kind: 'Sm', effects: 'EfMtData.dat', bank: 'smewtwo', optional: true, trimmedClips: true, specialsByName: false, keyed: SM_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: SM_MOVES, articles: parseShadowMewtwoArticles },
  { kind: 'Lb', effects: 'EfLgData.dat', bank: 'luigiandboo', optional: true, trimmedClips: true, specialsByName: false, keyed: LB_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: LB_MOVES, articles: (metadata) => ({ projectile: parseArticle(metadata, 0, 'luigi-fire') }) },
  { kind: 'MM', effects: 'EfMrData.dat', bank: 'mario', optional: true, trimmedClips: true, specialsByName: false, keyed: MM_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: MM_MOVES, articles: parseMetalMarioArticles },
  { kind: 'Sd', effects: 'EfCoData.dat', bank: 'skullkid', optional: true, trimmedClips: true, specialsByName: false, keyed: SD_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait1', 'LandingAirB', 'LandingAirHi'],
    moves: SD_MOVES, motions: { crouchWait: 'SquatWait1' }, articles: parseSkullKidArticles },
  // Wave 6 (ACE 2.0): Chun-Li. No effect bank on disc; common particles only.
  { kind: 'Cn', effects: 'EfCoData.dat', bank: 'chun-li', optional: true, trimmedClips: true, specialsByName: false, keyed: CHUNLI_ACTION_KEYS,
    extraClips: ['JumpAerialF', 'JumpAerialB', 'SquatWait', 'LandingAirB', 'LandingAirHi'],
    moves: CHUNLI_MOVES, articles: parseChunLiArticles },
];

export async function loadGameStage(session: HsdAssetSession, stageId: StageId): Promise<Pick<GameContent, 'stageId' | 'stage' | 'stageModel' | 'stadium' | 'stadiumModels' | 'onettData' | 'muteCityData' | 'peachBillData'>> {
  const definition = supportedStage(stageId), stageModel = await session.model(definition.asset);
  if (stageId === 'stadium') {
    const stadium = parseStadium(stageModel.archive);
    const stadiumModels: Partial<Record<StadiumForm, HsdModel>> = {};
    for (const form of STADIUM_VARIANTS) stadiumModels[form] = await session.model(STADIUM_VARIANT_ARCHIVES[form]);
    return { stageId, stageModel, stage: stadium.forms.normal, stadium, stadiumModels, onettData: undefined, muteCityData: undefined, peachBillData: undefined };
  }
  if (stageId === 'onett') {
    // Onett parses the full area set: the rooftop lines (areas 3/4) stay live
    // until the building machine phases them out, and areas 0/1/3/4 ride
    // their owner joints' rest poses (see lib/game/onett.ts).
    return { stageId, stageModel, stage: parseStageGameplay(stageModel.archive, undefined, 'areaOffsets' in definition ? definition.areaOffsets : undefined), stadium: undefined, stadiumModels: undefined, onettData: parseOnettData(stageModel.archive), muteCityData: undefined, peachBillData: undefined };
  }
  if (stageId === 'mute-city') {
    // The road script starts on areas 3 (start pad) + 4 (deck slot); stops add
    // the surrounding road areas and the flight drops the deck (lib/game/mutecity.ts).
    const muteCityData = parseMuteCityData(stageModel.archive, stageModel);
    const base = muteCityData.phases.get('3,4');
    if (!base) throw new Error('Mute City script never reaches its starting layout.');
    return { stageId, stageModel, stage: base, stadium: undefined, stadiumModels: undefined, onettData: undefined, muteCityData, peachBillData: undefined };
  }
  if (stageId === 'peach-castle') {
    return { stageId, stageModel, stage: parseStageGameplay(stageModel.archive, 'staticAreas' in definition ? definition.staticAreas : undefined, 'areaOffsets' in definition ? definition.areaOffsets : undefined), stadium: undefined, stadiumModels: undefined, onettData: undefined, muteCityData: undefined, peachBillData: parsePeachBillData(stageModel.archive) };
  }
  // Non-dynamic stages must clear any prior stadium payload when spread over existing content.
  return { stageId, stageModel, stage: parseStageGameplay(stageModel.archive, 'staticAreas' in definition ? definition.staticAreas : undefined, 'areaOffsets' in definition ? definition.areaOffsets : undefined), stadium: undefined, stadiumModels: undefined, onettData: undefined, muteCityData: undefined, peachBillData: undefined };
}
/** Onett's stage SFX bank (bounded, curated like the fighter banks); silent when the source omits it. */
async function loadStageSound(session: HsdAssetSession, sound: GameSoundLibrary, stageId: StageId): Promise<void> {
  if (stageId !== 'onett') return;
  try {
    const bank = new SsmBank(await session.bytes('audio/us/onett.ssm'));
    if (!sound.banks.some((other) => other.base === bank.base)) sound.banks.push(bank);
  } catch { /* stage SFX stay silent; hazards and error paths are unaffected */ }
}

/** Stage-picked sound banks ride the shared library (deduped by SSM base). */
async function withStageSound<T extends GameContent>(session: HsdAssetSession, content: T): Promise<T> {
  await loadStageSound(session, content.sound, content.stageId);
  return content;
}

/** Returns new content; existing matches are not mutated and fighters/WASM/audio are reused. */
export async function selectGameStage(content: GameContent, session: HsdAssetSession, stageId: StageId): Promise<GameContent> {
  if (content.stageId === stageId) return content;
  return withStageSound(session, { ...content, ...await loadGameStage(session, stageId) });
}

/** The ACE disc's own SEM (exposed beside the vanilla one), parsed once per session. */
const extensionSems = new WeakMap<HsdAssetSession, Promise<SemTable | undefined>>();
function extensionSem(session: HsdAssetSession): Promise<SemTable | undefined> {
  let table = extensionSems.get(session);
  if (!table) {
    table = session.info.files.some((file) => file.path === 'audio/us/smash2.ace.sem') ? session.bytes('audio/us/smash2.ace.sem').then((bytes) => new SemTable(bytes)) : Promise.resolve(undefined);
    extensionSems.set(session, table);
  }
  return table;
}
async function loadOriginalFighter(session: HsdAssetSession, spec: OriginalFighterSpec, common: CommonGameplayData, progress: (message: string, fraction?: number) => void, loaded: ReadonlyMap<FighterKind, FighterContent>): Promise<FighterContent> {
  const { kind } = spec;
  const metadata = await session.fighterData(kind), profile = parseFighterProfile(metadata, kind, common);
  const model = await session.model(costumeModelFile(kind, 0)), table = await session.actionTable(kind);
  if (model.roots.length !== 1 || model.roots[0]!.joints.length !== profile.boneCount) throw new Error(`Original ${profile.name} model and gameplay bone map disagree.`);
  const clips = new Map<string, AnimationClip>(), attacks = new Map<string, AttackDefinition>(), timelines = new Map<string, AttackDefinition>();
  const parameters = parseSpecialParameters(metadata, profile);
  if (parameters.kind === 'Fe') {
    if (common.specialBranchThreshold === undefined) throw new Error('Roy needs the original common branch threshold.');
    parameters.side.branchThreshold = common.specialBranchThreshold;
  }
  const articles = spec.articles(metadata);
  const effectArchive = await session.archive(spec.effects);
  const effects = parseEffectModels(effectArchive, kind), effectParticles = parseEffectParticles(effectArchive, kind), mexEffects = parseMexEffectModels(effectArchive, kind);
  const soundPtr = metadata.pointer([...metadata.symbols.values()][0]! + 0x4c);
  // ACE FtSFX ids in the dead 5xxx namespace remap to direct bank samples
  // (lib/game/ace-voices.ts); vanilla ids pass through untouched.
  const range = ACE_SSM_RANGES[kind];
  const soundBank = SEM_ROUTED_ACE_KINDS.has(kind) && range ? (await extensionSem(session))?.bankForSample(range.base) : undefined;
  const voice = (slot: 'jump' | 'airJump' | 'ko', raw: number) => soundBank === undefined ? resolveAceVoice(kind, slot, raw) : routeAceSound(soundBank, raw);
  const specials: SpecialAssets = { parameters, articles, effects, particles: effectParticles, ...(mexEffects ? { mexEffects } : {}), sounds: { jump: voice('jump', metadata.u32(soundPtr+16)), airJump: voice('airJump', metadata.u32(soundPtr+20)), ko: voice('ko', metadata.u32(soundPtr+4)) }, ...(soundBank === undefined ? {} : { soundBank }) };
  const inhale = spec.inhale && parameters.kind === 'Kb' ? { ...spec.inhale, stickDown: parameters.inhale.stickDown, walkStick: parameters.inhale.walkStick, walkSpeed: parameters.inhale.walkSpeed, holdFrames: parameters.inhale.holdFrames, holdDecay: parameters.inhale.holdDivisor, mashResistance: parameters.inhale.resistance } : undefined;
  const entries: Array<{ key: string; action: FighterAction; joints?: number; optional?: boolean; scriptFrames?: number }> = [];
  const byName = (name: string) => {
    // ftCo_SM_Landing is raw submotion 35. Earlier dead-camera entries reuse
    // the Landing figatree with an empty script; first-by-name loses its dust.
    const rawLanding=name==='Landing'?metadata.pointer(metadata.pointer([...metadata.symbols.values()][0]!+12)+35*24+12):undefined;
    const action = table.find((action) => action.name === name && (rawLanding===undefined||action.scriptOffset===rawLanding));
    if (!action) throw new Error(`Missing original animation ${profile.name}/${name}.`);
    return { key: name, action };
  };
  for (const name of new Set([...BASE_MOTIONS, 'LightGet', ...LIGHT_ITEM_MOTIONS, ...spec.extraClips, ...Object.values(spec.moves), ...COMBAT_MOTIONS])) if (!spec.keyed.some(entry => entry.key === name) && !spec.unsupportedActions?.includes(name)) entries.push(byName(name));
  // Optional locomotion clips: Dash/RunBrake/TurnRun enable native-style running; Turn adds the smash-turn pivot (lib/game/locomotion.ts).
  for (const name of RUN_MOTIONS) {
    const action = table.find((entry) => entry.name === name);
    if (action && !entries.some((entry) => entry.key === name) && !spec.keyed.some((entry) => entry.key === name)) entries.push({ key: name, action, optional: true });
  }
  // PlDd's banana trips whoever owns a MissFoot animation (Trip_Check → Trip_Enter → DownBoundU);
  // DownStandU stands them back up. Optional: a fighter without MissFoot simply cannot trip.
  for (const name of TRIP_MOTIONS) {
    const action = table.find((entry) => entry.name === name);
    if (action && !entries.some((entry) => entry.key === name) && !spec.keyed.some((entry) => entry.key === name)) entries.push({ key: name, action, optional: true });
  }
  // Tech/knockdown motions (lib/game/match.ts tech + downed states). Optional like trips.
  for (const name of TECH_MOTIONS) {
    const action = table.find((entry) => entry.name === name);
    if (action && !entries.some((entry) => entry.key === name) && !spec.keyed.some((entry) => entry.key === name)) entries.push({ key: name, action, optional: true });
  }
  // Appeal (taunt) motions, with their original scripts so the voice cue and graphics
  // play. Optional: a fighter whose source authors none simply cannot taunt.
  for (const name of TAUNT_MOTIONS) {
    const action = table.find((entry) => entry.name === name);
    if (action && !entries.some((entry) => entry.key === name) && !spec.keyed.some((entry) => entry.key === name)) entries.push({ key: name, action, optional: true });
  }
  for(const name of SMASH_ITEM_MOTIONS){
    const key=`${name}4`;if(spec.keyed.some(e=>e.key===key))continue;
    const action=table.filter(a=>a.name===name)[1];if(!action)throw Error(`Missing original smash item throw ${profile.name}/${name}.`);
    entries.push({key,action});
  }
  if (spec.specialsByName) for (const action of table) if (action.name.startsWith('Special') && !entries.some((entry) => entry.key === action.name)) entries.push({ key: action.name, action });
  for (const { key, index, figatree, joints, scriptFrames } of spec.keyed) {
    const action = table[index];
    if (!action || action.name !== figatree) throw new Error(`Original ${profile.name} action ${index} is not ${figatree}.`);
    entries.push({ key, action, ...(joints ? { joints } : {}), ...(scriptFrames ? { scriptFrames } : {}) });
  }
  const workUnits = entries.length + (spec.copies?.length ?? 0);
  let workDone = 0;
  for (const { key, action, joints, optional, scriptFrames } of entries) {
    progress(`Loading ${profile.name}: ${key}…`, workDone++ / workUnits);
    const clip = optional ? await session.clip(kind, action).catch(() => null) : await session.clip(kind, action);
    if (!clip) continue;
    const expectedJoints = joints ?? profile.boneCount;
    if (clip.joints.length !== expectedJoints && !(spec.trimmedClips && clip.joints.length < expectedJoints)) {
      if (optional) continue;
      throw new Error(`Animation skeleton mismatch: ${key}.`);
    }
    let move: AttackDefinition;
    try { move = action.scriptOffset ? parseAttack(metadata, action.scriptOffset, key, profile, scriptFrames ?? Math.max(1, clip.endFrame)) : { name: key, events: [], interruptFrame: null, ignoredOpcodes: [] }; }
    catch (error) { if (optional) continue; throw error; }
    clips.set(key, clip);
    timelines.set(key, move);
    if (Object.values(spec.moves).includes(key)) {
      if (!key.startsWith('Attack100') && !move.events.some((event) => event.type === 'create')) throw new Error(`No supported original attack hitboxes found for ${key}.`);
      attacks.set(key, move);
    } else if (key.includes('Special') || key.startsWith('Eat') || key.startsWith('LightThrow') || COMBAT_MOTIONS.includes(key) || spec.extraAttacks?.includes(key)
      // A few Appeal scripts author real hitboxes (Luigi's kick, Charizard's flame);
      // the rest are harmless motions and never enter the attack tables.
      // The getup attack strikes from the knockdown (lib/game/match.ts downed state).
      || (key === 'DownAttackU' && move.events.some((event) => event.type === 'create'))
      || ((TAUNT_MOTIONS as readonly string[]).includes(key) && move.events.some((event) => event.type === 'create'))) attacks.set(key, move); // includes copied specials (MrSpecialN, FxSpecialN*)
  }
  // m-ex script sounds are fighter-relative (5000 + n): route them into the fighter's bank.
  if (soundBank !== undefined) for (const move of timelines.values()) for (const event of move.events) if (event.type === 'sound') event.sound = routeAceSound(soundBank, event.sound);
  // Shared battering-item swing subactions (ftswing matrix rows in the common block):
  // six [Swing1, Swing3, Swing4, SwingDash] groups in row order (Sword, Bat, Parasol,
  // Harisen, Star Rod, Lip's Stick), each script carrying authored hitboxes. The block's
  // base index varies per fighter (Fox 99, Mario 97, Kirby 98…), so locate the full
  // 24-entry run instead of assuming an offset. The scripts' hitbox parts target the
  // held weapon, so every hit is rebound to the fighter's item hold bone; a modded
  // table without the run simply keeps throw-only items for that fighter.
  const holdBone = profile.itemHoldBone;
  // Falcon/Ganondorf name the smash swing figatree Swing41; the slot still maps to Swing4.
  const swingSlots: ReadonlyArray<{ key: string; names: readonly string[] }> = [{ key: 'Swing1', names: ['Swing1'] }, { key: 'Swing3', names: ['Swing3'] }, { key: 'Swing4', names: ['Swing4', 'Swing41'] }, { key: 'SwingDash', names: ['SwingDash'] }];
  const swingBase = table.findIndex((_, index) => [0, 1, 2, 3, 4, 5].every((block) => swingSlots.every((slot, part) => slot.names.includes(table[index + block * 4 + part]?.name ?? ''))));
  if (holdBone !== undefined && swingBase >= 0) for (const [block, swingItem] of (['Sword', 'Bat', 'Parasol', 'Harisen', 'StarRod', 'LipStick'] as const).entries()) {
    for (const [offset, slot] of swingSlots.entries()) {
      const action = table[swingBase + block * 4 + offset], key = `${swingItem}${slot.key}`;
      if (!action?.scriptOffset) continue;
      try {
        const clip = await session.clip(kind, action);
        if (clip.joints.length !== profile.boneCount && !(spec.trimmedClips && clip.joints.length < profile.boneCount)) continue;
        const permissive = { ...profile, partJoints: Array.from({ length: 256 }, (_, part) => { const joint = profile.partJoints[part]; return joint !== undefined && joint >= 0 ? joint : holdBone; }) };
        const move = parseAttack(metadata, action.scriptOffset, key, permissive, Math.max(1, clip.endFrame));
        for (const event of move.events) if (event.type === 'create') event.hit.bone = holdBone;
        clips.set(key, clip); timelines.set(key, move); attacks.set(key, move);
      } catch { /* Divergent modded subaction: this fighter throws instead of swinging. */ }
    }
  }
  // Heavy-carry throws (HeavyThrowF/B/Hi/Lw immediately precede the swing block) plus the
  // shared HeavyGet pickup and the shooter subactions, loaded tolerantly by name.
  if (swingBase >= 4) for (const [back, key] of (['HeavyThrowLw', 'HeavyThrowHi', 'HeavyThrowB', 'HeavyThrowF'] as const).entries()) {
    const action = table[swingBase - 1 - back];
    if (action?.name !== key) continue;
    try {
      const clip = await session.clip(kind, action);
      if (clip.joints.length !== profile.boneCount && !(spec.trimmedClips && clip.joints.length < profile.boneCount)) continue;
      clips.set(key, clip);
      timelines.set(key, action.scriptOffset ? parseAttack(metadata, action.scriptOffset, key, profile, Math.max(1, clip.endFrame)) : { name: key, events: [], interruptFrame: null, ignoredOpcodes: [] });
    } catch { /* Missing heavy motion: this fighter cannot lift crates. */ }
  }
  for (const key of ['HeavyGet', 'ItemShoot', 'ItemShootAir', 'ItemHammerWait', 'ItemHammerMove', 'ItemScrew', 'ItemScrewAir'] as const) {
    const action = table.find((entry) => entry.name === key);
    if (!action || clips.has(key)) continue;
    try {
      const clip = await session.clip(kind, action);
      if (clip.joints.length !== profile.boneCount && !(spec.trimmedClips && clip.joints.length < profile.boneCount)) continue;
      clips.set(key, clip);
      timelines.set(key, action.scriptOffset ? parseAttack(metadata, action.scriptOffset, key, profile, Math.max(1, clip.endFrame)) : { name: key, events: [], interruptFrame: null, ignoredOpcodes: [] });
    } catch { /* Missing shared motion: the dependent item action stays unavailable. */ }
  }
  const copies: Partial<Record<CopySource, CopyAbility>> = {};
  for (const copy of spec.copies ?? []) {
    const source = loaded.get(copy.source);
    if (!source) throw new Error(`${profile.name} copy ability needs ${copy.source} loaded first.`);
    progress(`Loading ${profile.name}: ${copy.source} copy ability…`, workDone++ / workUnits);
    copies[copy.source] = parseCopyAbility(await session.archive(copy.archive), copy.source, source.specials);
  }
  const effectParts=metadata.pointer([...metadata.symbols.values()][0]!+0x54);
  const effectBones=effectParts?Array.from({length:5},(_,i)=>profile.partJoints[metadata.u32(effectParts+i*4)]!).filter(bone=>Number.isInteger(bone)&&bone>=0&&bone<profile.boneCount):[];
  // Nana's own model shares Popo's skeleton, clips and scripts (upstream runs
  // her on the same ftPp motion states). Loaded tolerantly: sources without
  // her files keep a solo Popo instead of failing the whole roster.
  let partnerModel: HsdModel | undefined;
  if (kind === 'Pp' && session.info.files.some((file) => file.path === 'PlNnNr.dat')) {
    const nana = await session.model('PlNnNr.dat');
    if (nana.roots.length !== 1 || nana.roots[0]!.joints.length !== profile.boneCount) throw new Error(`Original Nana partner model and gameplay bone map disagree.`);
    partnerModel = nana;
  }
  return { profile, model, clips, attacks, timelines, specials, effectBones, moves: spec.moves, ...((kind==='Lk'||kind==='Cl')?{hookshot:parseLinkHookshot(metadata),passiveAttachment:parseLinkShieldAttachment(metadata,common.boneMaps[kind],profile)}:{}), ...(spec.canGrab === undefined ? {} : { canGrab: spec.canGrab }), ...(spec.motions ? { motions: spec.motions } : {}), ...(spec.airJumps ? { airJumps: spec.airJumps(parameters) } : {}), ...(inhale ? { inhale } : {}), ...(spec.copies ? { copies } : {}), ...(spec.cargo ? { cargo: spec.cargo } : {}), ...(partnerModel ? { partnerModel } : {}), ...(spec.partDefaults ? { partDefaults: spec.partDefaults } : {}) };
}

export async function loadGameContent(session: HsdAssetSession, wasm: BufferSource, progress: (message: string, fraction?: number) => void = () => {}, stageId: StageId = 'battlefield'): Promise<GameContent> {
  // Fractions are phase-weighted overall completion in [0,1]: fighters dominate the wall time.
  progress('Loading fighter data…', 0);
  const commonArchive = await session.archive('PlCo.dat');
  const common = parseCommonGameplay(commonArchive), combat = parseCombatData(commonArchive);
  const effectArchive = await session.archive('EfCoData.dat');
  const commonEffects = parseCommonEffects(effectArchive,commonArchive);
  const koEffect = parseKoEffect(effectArchive, commonArchive);
  // Older LAN manifests do not list ItCo.dat; those sources run itemless rather than failing to load.
  const items = session.info.files.some((file) => file.path === 'ItCo.dat') ? parseItemsData(await session.archive('ItCo.dat')) : undefined;
  const selectedStage = await loadGameStage(session, stageId);
  const originals: FighterContent[] = [], loaded = new Map<FighterKind, FighterContent>();
  for (const [specIndex, spec] of FIGHTER_SPECS.entries()) {
    if (!specAvailable(session, spec)) continue;
    const fighter = await loadOriginalFighter(session, spec, common, (message, fraction = 0) => progress(message, 0.05 + 0.85 * (specIndex + fraction) / FIGHTER_SPECS.length), loaded);
    originals.push(fighter); loaded.set(spec.kind, fighter);
  }
  progress('Loading sounds…', 0.9);
  const sem = new SemTable(await session.bytes('audio/us/smash2.sem'));
  const banks = await Promise.all(['main', ...FIGHTER_SPECS.filter((spec) => loaded.has(spec.kind) && spec.bank !== null).map((spec) => spec.bank!)].map(async (name) => new SsmBank(await session.bytes(`audio/us/${name}.ssm`))));
  const sound = new GameSoundLibrary(sem, banks, await extensionSem(session));
  const pair: [FighterContent, FighterContent] = [loaded.get('Fx')!, loaded.get('Mr')!];
  const physics = new MeleePhysics(await instantiateGameplay(wasm), common, pair.map((fighter) => fighter.profile));
  const roster=new Map<FighterKind,FighterContent>(originals.map(f=>[f.profile.kind,f]));
  addCustomCharacters(roster);
  return withStageSound(session, { common, combat, commonEffects, koEffect, items, ...selectedStage, fighters: pair, roster, physics, sound });
}

/** Phase 2.1 — staged boot. The blocking boot path loads only the common
 * block, the default stage and the default pair (Fox/Mario); the menu opens
 * as soon as that core is ready while the rest of the roster and the extra
 * stages prefetch in the background (see GameSession) or on demand at
 * character select. loadGameContent above stays the single sequential
 * full-load path (progress-contract tests pin it); these helpers share its
 * parsers but report their own coarse progress. */
export const CORE_FIGHTER_KINDS: readonly FighterKind[] = ['Fx', 'Mr'];
async function loadCommonBlock(session: HsdAssetSession): Promise<{ common: CommonGameplayData; combat: CombatData; commonEffects: CommonEffectsData | undefined; koEffect: KoEffectData | undefined; items: ItemsData | undefined }> {
  const commonArchive = await session.archive('PlCo.dat');
  const common = parseCommonGameplay(commonArchive), combat = parseCombatData(commonArchive);
  const effectArchive = await session.archive('EfCoData.dat');
  const commonEffects = parseCommonEffects(effectArchive, commonArchive);
  const koEffect = parseKoEffect(effectArchive, commonArchive);
  const items = session.info.files.some((file) => file.path === 'ItCo.dat') ? parseItemsData(await session.archive('ItCo.dat')) : undefined;
  return { common, combat, commonEffects, koEffect, items };
}
function specAvailable(session: HsdAssetSession, spec: OriginalFighterSpec): boolean {
  // Clone slots resolve to donor archives, so availability checks every resolved
  // file (Blood Falcon's PlCa.dat exists on the vanilla disc; his PlBfNr.dat does not).
  const required = [fighterDatFile(spec.kind), costumeModelFile(spec.kind, 0), fighterAjFile(spec.kind)];
  return !spec.optional || required.every((name) => session.info.files.some((file) => file.path === name));
}
async function loadSoundLibrary(session: HsdAssetSession, kinds: ReadonlySet<FighterKind>): Promise<GameSoundLibrary> {
  const sem = new SemTable(await session.bytes('audio/us/smash2.sem'));
  const names = ['main', ...FIGHTER_SPECS.filter((spec) => kinds.has(spec.kind) && spec.bank !== null).map((spec) => spec.bank!)];
  const banks = await Promise.all(names.map(async (name) => new SsmBank(await session.bytes(`audio/us/${name}.ssm`))));
  return new GameSoundLibrary(sem, banks, await extensionSem(session));
}
/** Blocking core: common block + one stage + CORE_FIGHTER_KINDS. Fractions are
 * coarse 0..1 for the boot progress mapping. */
export async function loadGameCore(session: HsdAssetSession, wasm: BufferSource, progress: (message: string, fraction?: number) => void = () => {}, stageId: StageId = 'battlefield'): Promise<GameContent> {
  progress('Loading fighter data…', 0);
  const { common, combat, commonEffects, koEffect, items } = await loadCommonBlock(session);
  progress('Loading the default stage…', 0.15);
  const selectedStage = await loadGameStage(session, stageId);
  const loaded = new Map<FighterKind, FighterContent>();
  const coreSpecs = FIGHTER_SPECS.filter((spec) => (CORE_FIGHTER_KINDS as readonly string[]).includes(spec.kind));
  for (const [index, spec] of coreSpecs.entries()) {
    const fighter = await loadOriginalFighter(session, spec, common, (message, fraction = 0) => progress(message, 0.2 + 0.6 * (index + fraction) / coreSpecs.length), loaded);
    loaded.set(spec.kind, fighter);
  }
  progress('Loading sounds…', 0.85);
  const sound = await loadSoundLibrary(session, new Set(loaded.keys()));
  const pair: [FighterContent, FighterContent] = [loaded.get('Fx')!, loaded.get('Mr')!];
  const physics = new MeleePhysics(await instantiateGameplay(wasm), common, pair.map((fighter) => fighter.profile));
  const roster = new Map<FighterKind, FighterContent>([...loaded].map(([kind, fighter]) => [kind, fighter] as [FighterKind, FighterContent]));
  addCustomCharacters(roster);
  progress('Core ready.', 1);
  return withStageSound(session, { common, combat, commonEffects, koEffect, items, ...selectedStage, fighters: pair, roster, physics, sound });
}
/** Every file one original fighter load reads (fighter data, model, animation bank, effects,
 * Kirby copy archives, Nana's model), so a transport can download them ahead of the parse. */
export function fighterAssetNames(kind: FighterKind): string[] {
  const spec = FIGHTER_SPECS.find((entry) => entry.kind === kind);
  if (!spec) return [];
  return [fighterDatFile(spec.kind), costumeModelFile(spec.kind, 0), fighterAjFile(spec.kind), spec.effects, ...(spec.copies?.map((copy) => copy.archive) ?? []), ...(kind === 'Pp' ? ['PlNnNr.dat'] : [])];
}
/** Kinds still missing from a core content, in original spec order. */
export function pendingRosterKinds(session: HsdAssetSession, content: GameContent): FighterKind[] {
  return [...FIGHTER_SPECS.filter((spec) => !content.roster.has(spec.kind) && specAvailable(session, spec)).map((spec) => spec.kind), ...CUSTOM_FIGHTERS.filter(kind => !content.roster.has(kind))];
}
/** Copy-ability sources these kinds parse from (Kirby's victims). They must be resident while
 * their dependent loads, so a warm set keeps them until the dependent itself is loaded. */
export function copySourceKinds(kinds: Iterable<FighterKind>): FighterKind[] {
  const sources = new Set<FighterKind>();
  for (const kind of kinds) for (const copy of FIGHTER_SPECS.find((spec) => spec.kind === kind)?.copies ?? []) sources.add(copy.source);
  return [...sources];
}
/** Drops loaded fighters from the roster so their models, clips and decoded textures become
 * collectable. Content already handed to a running match keeps its own references, so this
 * only affects what a later selection reuses: `pendingRosterKinds` reports the dropped kinds
 * as missing again and `loadRosterQueue` reloads them on demand. Sound banks stay (they are
 * shared and small). Returns the kinds actually dropped. */
export function unloadFighters(content: GameContent, kinds: Iterable<FighterKind>): FighterKind[] {
  const dropped: FighterKind[] = [];
  for (const kind of kinds) if (content.roster.delete(kind)) dropped.push(kind);
  return dropped;
}
/** Reorder a pending list so hovered/selected kinds (plus any copy-ability
 * sources they need, e.g. Kirby's victims) load first. Pure: unit-tested. */
export function prioritizeKinds(pending: readonly FighterKind[], requested: readonly FighterKind[]): FighterKind[] {
  const pendingSet = new Set(pending);
  const wanted = requested.filter((kind) => pendingSet.has(kind));
  // Kirby's copy abilities need their source fighters loaded first.
  const kirbySpec = FIGHTER_SPECS.find((spec) => spec.kind === 'Kb');
  const deps: FighterKind[] = [];
  if (wanted.includes('Kb' as FighterKind) && kirbySpec?.copies) {
    for (const copy of kirbySpec.copies) if (pendingSet.has(copy.source) && !wanted.includes(copy.source)) deps.push(copy.source);
  }
  const first = [...deps, ...wanted];
  return [...first, ...pending.filter((kind) => !first.includes(kind))];
}
/** Register a freshly loaded fighter on shared content. Stage contents derived
 * earlier via selectGameStage spread (sharing this map) must observe it, so
 * this mutates the map in place: replacing it would leave every previously
 * derived stage with a stale roster and match start would fail with
 * 'Unknown fighter selection' despite the ready-check passing. */
export function registerRosterFighter(content: GameContent, kind: FighterKind, fighter: FighterContent): void {
  content.roster.set(kind, fighter);
}
/** Background/on-demand rest of the roster, in queue order (spec order unless
 * reprioritized). Mutates content.roster in place and returns the loaded
 * kinds. The full voice-bank library is rebuilt only when `withSound` is set
 * (once, after the whole roster lands — rebuilding per fighter would reparse
 * every SSM bank per fighter on the weakest devices). */
/** Alternate costume model for a loaded fighter (index 0 returns the `Nr`
 * default without fetching). Every costume shares the skeleton, so a bone
 * mismatch rejects a corrupt file instead of misposing the fighter. The
 * session model cache dedupes repeat picks of the same costume. */
export async function loadCostumeModel(session: HsdAssetSession, base: FighterContent, index: number): Promise<HsdModel> {
  const clamped = clampCostumeIndex(base.profile.kind, index);
  if (clamped === 0) return base.model;
  const model = await session.model(costumeModelFile(base.profile.kind, clamped));
  if (model.roots.length !== 1 || model.roots[0]!.joints.length !== base.profile.boneCount) throw new Error(`Original ${base.profile.name} costume model and gameplay bone map disagree.`);
  return model;
}
/** Nana's skin for a costumed Ice Climbers pick (same index as Popo's).
 * Throws like any other costume load when her file is present but corrupt;
 * callers skip her when the source manifest lacks the file. */
export async function loadNanaCostumeModel(session: HsdAssetSession, base: FighterContent, index: number): Promise<HsdModel> {
  if (base.profile.kind !== 'Pp') throw new Error('Only Ice Climbers field a Nana partner.');
  const clamped = clampCostumeIndex('Pp', index);
  if (clamped === 0) {
    if (!base.partnerModel) throw new Error('Nana partner model is not loaded.');
    return base.partnerModel;
  }
  const model = await session.model(nanaCostumeFile(clamped));
  if (model.roots.length !== 1 || model.roots[0]!.joints.length !== base.profile.boneCount) throw new Error('Original Nana costume model and gameplay bone map disagree.');
  return model;
}
export async function loadRosterQueue(session: HsdAssetSession, content: GameContent, queue: readonly FighterKind[], progress: (message: string, fraction?: number) => void = () => {}, withSound = false): Promise<{ kinds: FighterKind[]; sound: GameSoundLibrary | null }> {  const specs = new Map(FIGHTER_SPECS.map((spec) => [spec.kind, spec]));
  const loaded = new Map<FighterKind, FighterContent>();
  for (const [, fighter] of content.roster) if (!isCustomFighter(fighter.profile.kind)) loaded.set(fighter.profile.kind, fighter);
  const kinds: FighterKind[] = [];
  /** Loads one fighter, first pulling in any copy-ability sources it parses from (Kirby's
   * victims): those must be resident at load time, and on-demand selections no longer
   * guarantee the rest of the roster is around. */
  const loadKind = async (kind: FighterKind, report: (message: string, fraction?: number) => void, depth = 0): Promise<void> => {
    if (content.roster.has(kind)) return;
    if (isCustomFighter(kind)) { registerRosterFighter(content, kind, createCustomCharacter(kind)); kinds.push(kind); return; }
    const spec = specs.get(kind as OriginalFighterKind);
    if (!spec || !specAvailable(session, spec)) return;
    if (depth < 2) for (const copy of spec.copies ?? []) {
      if (loaded.has(copy.source)) continue;
      const sourceSpec = specs.get(copy.source as OriginalFighterKind);
      if (sourceSpec && specAvailable(session, sourceSpec)) await loadKind(copy.source, report, depth + 1);
    }
    const fighter = await loadOriginalFighter(session, spec, content.common, report, loaded);
    registerRosterFighter(content, kind, fighter);
    loaded.set(kind, fighter);
    kinds.push(kind);
  };
  for (const [index, kind] of queue.entries()) {
    await loadKind(kind, (message, fraction = 0) => progress(message, (index + fraction) / Math.max(1, queue.length)));
  }
  const sound = withSound ? await loadSoundLibrary(session, new Set([...content.roster.keys()].filter((kind) => !isCustomFighter(kind)))) : null;
  return { kinds, sound };
}
