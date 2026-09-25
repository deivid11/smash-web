import type { FighterContent } from './load.ts';
import type { MatchFighter } from './match.ts';
import type { CommonGameplayData } from './data.ts';
import type { SpecialDirection } from './special-data.ts';

/** Optional original ground locomotion motions. Missing Dash/RunBrake/TurnRun keeps plain Run;
 * missing Turn alone retains the prototype's direct reverse dash without a pivot opportunity. */
export const RUN_MOTIONS = ['Dash', 'RunBrake', 'TurnRun', 'Turn'] as const;

/** Smash-turn is represented by idle/Turn, so its attacks/grabs are standing, not running. */
export function isDashTurn(fighter: MatchFighter): boolean {
  return fighter.state === 'idle' && fighter.animation === 'Turn';
}

/** PlCo ftCommonData x58 (|stick| below it brakes a run) and x38 (stick·facing at or below it
 * turns a run around), NTSC 1.02, for content without the parsed table. */
export const RUN_BRAKE_STICK = 0.625, RUN_TURN_STICK = -0.375;

export function hasMeleeRun(content: FighterContent): boolean {
  return content.clips.has('Dash') && content.clips.has('RunBrake') && content.clips.has('TurnRun');
}

/** Frame at which a motion script first sets cmd_vars[index] (subaction opcode 19); null without one. */
export function commandFrame(content: FighterContent, animation: string, index: number): number | null {
  const events = content.timelines.get(animation)?.events;
  if (events) for (const event of events) if (event.type === 'command' && event.index === index && event.value !== 0) return event.frame;
  return null;
}

/** Value of cmd_vars[index] at `frame`: the last script set at or before it (entries clear it to 0). */
export function commandValue(content: FighterContent, animation: string, index: number, frame: number): number {
  let value = 0;
  const events = content.timelines.get(animation)?.events;
  if (events) for (const event of events) if (event.type === 'command' && event.index === index && event.frame <= frame) value = event.value;
  return value;
}

/** Direction the run had when TurnRun began: ftCo_TurnRun_Anim flips the facing once the hold on the
 * script's cmd_vars[1] frame ends, so a later frame (or that frame playing again) means it has turned. */
export function turnRunStartFacing(fighter: MatchFighter): number {
  const at = commandFrame(fighter.content, 'TurnRun', 1);
  const turned = at !== null && (fighter.animationFrame > at || (fighter.animationFrame >= at && fighter.animationRate !== 0));
  return turned ? -fighter.facing : fighter.facing;
}

/** Facing the model is drawn and posed with. Fighter_ChangeMotionState is the only common
 * writer of TopN's yaw (π/2·facing_dir): Turn and TurnRun flip facing_dir mid-motion while
 * their clips spin the body 180° from the entry yaw, so the body keeps the facing the motion
 * began with. Smash-turn flips on its first Anim callback (stateFrame 1 → 2, frozen in hitlag).
 * Poses are sampled after the frame advance, where only a clip already past TurnRun's hold
 * window has flipped (arriving on the hold frame at rate 1 has not, nor its extrapolation). */
export function bodyFacing(fighter: MatchFighter): number {
  if (isDashTurn(fighter)) return fighter.stateFrame >= 2 ? -fighter.facing : fighter.facing;
  if (fighter.state === 'run' && fighter.animation === 'TurnRun') {
    const at = commandFrame(fighter.content, 'TurnRun', 1);
    return at !== null && fighter.animationFrame >= at + 1 ? -fighter.facing : fighter.facing;
  }
  return fighter.facing;
}

const WORD = new Uint32Array(1), WORD_F32 = new Float32Array(WORD.buffer);
/** co_attrs.max_run_brake_frames (+0x30). */
export function maxRunBrakeFrames(content: FighterContent): number {
  WORD[0] = content.profile.words[0x30 / 4]!;
  return WORD_F32[0]!;
}

/** Ground locomotion owns facing against the bare stick: smash-turn flips on its next Anim
 * callback, while TurnRun flips once the old momentum is spent. */
export function skidOwnsFacing(fighter: MatchFighter): boolean {
  if (!hasMeleeRun(fighter.content)) return false;
  return fighter.state === 'run' ? fighter.animation === 'Dash' || fighter.animation === 'Run' || fighter.animation === 'TurnRun'
    : fighter.state === 'idle' && (fighter.animation === 'RunBrake' || fighter.animation === 'Turn');
}

/** Dash, Turn, TurnRun and RunBrake play once before handing over; Run and Wait loop. */
export function locomotionLoops(fighter: MatchFighter): boolean {
  return fighter.state === 'idle' ? fighter.animation !== 'RunBrake' && fighter.animation !== 'Turn'
    : fighter.state === 'run' && fighter.animation !== 'Dash' && fighter.animation !== 'TurnRun';
}

/** What a locomotion motion's IASA accepts (ftCo_Dash/Run/RunBrake/TurnRun/Turn_IASA); null = the
 * plain standing/walking pass (ftCo_Wait_IASA and friends). Jumps are accepted everywhere.
 * - attack: `dash` = A starts the dash attack whatever the stick (ftCo_AttackDash_CheckInput);
 *   `forward-smash` = only a forward smash input acts (ftCo_AttackS4_8008C114); `standing` = the
 *   whole standing table; `none` = attacks wait.
 * - shield: `guard` = shield/spot-dodge/roll as standing; `roll` = a held shield rolls forward
 *   (ftCo_80099264); `none` = no shield. Grabs (ftCo_800D8A38 / Catch) are separate.
 * - crouch: only Wait/Walk/RunBrake/Ottotto/attack IASAs call ftCo_800D5FB0, so a Dash, Run, Turn
 *   or TurnRun keeps its motion while the stick is held down. */
export interface RunPhaseGate {
  specials: readonly SpecialDirection[]; attack: 'dash' | 'forward-smash' | 'standing' | 'none';
  grab: boolean; shield: 'guard' | 'roll' | 'none'; taunt: boolean; crouch: boolean;
}
const ALL_SPECIALS: readonly SpecialDirection[] = ['neutral', 'side', 'up', 'down'];
export function runPhaseGate(fighter: MatchFighter, common: CommonGameplayData): RunPhaseGate | null {
  if (!hasMeleeRun(fighter.content)) return null;
  const frame = fighter.animationFrame;
  // Anim runs before IASA: on the frame a Dash, Turn or RunBrake clip ends, ft_8008A2BC has already
  // entered Wait and ftCo_Wait_IASA reads the input (a crouch held through a dash starts then).
  const once = fighter.animation === 'Dash' || fighter.animation === 'Turn' || fighter.animation === 'RunBrake';
  if (once && frame >= (fighter.content.clips.get(fighter.animation)?.endFrame ?? Number.POSITIVE_INFINITY)) return null;
  if (fighter.state === 'run') switch (fighter.animation) {
    case 'Dash':
      // Entry arg1=1 (from standing) opens with the x44 window: side-B, grab, forward smash and a
      // shield roll (until x48); then up to x4C side-B, grab, dash attack and guard; later only
      // grab and guard (plus the turn/re-dash, run and jump every branch keeps).
      if (!fighter.dashFromTurn && frame <= (common.dashInitialLockout ?? 4)) {
        return { specials: ['side'], attack: 'forward-smash', grab: true, shield: frame <= (common.dashRollWindow ?? 0) ? 'roll' : 'none', taunt: true, crouch: false };
      }
      if (frame <= (common.dashActionWindow ?? Number.POSITIVE_INFINITY)) return { specials: ['side'], attack: 'dash', grab: true, shield: 'guard', taunt: true, crouch: false };
      return { specials: [], attack: 'none', grab: true, shield: 'guard', taunt: true, crouch: false };
    case 'Run': return { specials: ALL_SPECIALS, attack: 'dash', grab: true, shield: 'guard', taunt: true, crouch: false };
    case 'TurnRun': return { specials: [], attack: 'none', grab: false, shield: 'none', taunt: false, crouch: false };
    default: return null;
  }
  if (fighter.state === 'idle' && fighter.animation === 'RunBrake') return { specials: [], attack: 'none', grab: false, shield: 'none', taunt: false, crouch: true };
  // ftCo_Squat_IASA (the crouch-down clip) takes every special and the grab; ftCo_SquatWait_IASA and
  // ftCo_SquatRv_IASA only down/up-B (x687/x686) and no Catch. Movement out of them: see match.ts.
  if (fighter.state === 'crouch' && fighter.animation === 'Squat' && !(frame >= (fighter.content.clips.get('Squat')?.endFrame ?? 0))) return { specials: ALL_SPECIALS, attack: 'standing', grab: true, shield: 'guard', taunt: true, crouch: true };
  if (fighter.state === 'crouch' && fighter.animation === 'SquatRv') return { specials: ['down', 'up'], attack: 'standing', grab: false, shield: 'guard', taunt: true, crouch: false };
  if (fighter.state === 'crouch') return { specials: ['down', 'up'], attack: 'standing', grab: false, shield: 'guard', taunt: true, crouch: true };
  // ftCo_Turn_IASA: side/down/up-B (no neutral), grab, every standing attack, guard, Appeal, jump.
  if (isDashTurn(fighter)) return { specials: ['side', 'down', 'up'], attack: 'standing', grab: true, shield: 'guard', taunt: true, crouch: false };
  return null;
}
