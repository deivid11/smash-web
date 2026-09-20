import type { FighterContent } from './load.ts';
import type { MatchFighter } from './match.ts';

/** Original ground locomotion motions (ftCo_Dash, ftCo_RunBrake, ftCo_TurnRun). They load when
 * the fighter's action table has them; fighters missing any of the three keep the plain Run. */
export const RUN_MOTIONS = ['Dash', 'RunBrake', 'TurnRun'] as const;

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

const WORD = new Uint32Array(1), WORD_F32 = new Float32Array(WORD.buffer);
/** co_attrs.max_run_brake_frames (+0x30). */
export function maxRunBrakeFrames(content: FighterContent): number {
  WORD[0] = content.profile.words[0x30 / 4]!;
  return WORD_F32[0]!;
}

/** Dash, Run, TurnRun and the RunBrake skid keep their facing while the stick points back: only a
 * smash back re-dashes, and TurnRun flips once the old momentum is spent. */
export function skidOwnsFacing(fighter: MatchFighter): boolean {
  if (!hasMeleeRun(fighter.content)) return false;
  return fighter.state === 'run' ? fighter.animation === 'Dash' || fighter.animation === 'Run' || fighter.animation === 'TurnRun'
    : fighter.state === 'idle' && fighter.animation === 'RunBrake';
}

/** Dash, TurnRun and RunBrake play once before handing over; Run and Wait loop. */
export function locomotionLoops(fighter: MatchFighter): boolean {
  return fighter.state === 'idle' ? fighter.animation !== 'RunBrake'
    : fighter.state === 'run' && fighter.animation !== 'Dash' && fighter.animation !== 'TurnRun';
}
