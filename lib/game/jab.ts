import type { FighterContent } from './load.ts';

export interface JabRuntime {
  name: string; window: number; queued: boolean; edges: number;
  comboOpen: boolean; rapidOpen: boolean; rapidInput: boolean; lastFrame: number;
}
export function beginJab(content: FighterContent): JabRuntime {
  return { name: content.moves.jab, window: content.profile.attributes.jab2Window, queued: false,
    edges: 0, comboOpen: false, rapidOpen: false, rapidInput: false, lastFrame: -1 };
}
/** Only a jab-local queue, not a general Melee input buffer. Retain edges in
 * hitlag, but consume them and advance the original windows on unfrozen ticks. */
export function captureJabInput(jab: JabRuntime, content: FighterContent, pressed: boolean, released: boolean): void {
  if (pressed && jab.window > 0) jab.queued = true;
  if (pressed || released) {
    jab.edges = Math.min(100, jab.edges + 1);
    if (jab.name === content.moves.rapidLoop) jab.rapidInput = true;
  }
}
/** Restricted ftCo_Attack1 / ftCo_Attack100 flow. The disc supplies opcode
 * 29/30 gates, jab windows, the press+release threshold and loop check flags. */
export function stepJab(jab: JabRuntime, content: FighterContent, frame: number, attacking: boolean): string | null {
  const moves = content.moves;
  const enter = (name: string) => {
    jab.name = name; jab.queued = false; jab.comboOpen = false; jab.lastFrame = -1;
    jab.window = name === moves.jab2 ? content.profile.attributes.jab3Window : 0;
    if (name === moves.rapidStart || name === moves.rapidLoop) jab.rapidInput = false;
    return name;
  };
  if (attacking) {
    for (const event of content.attacks.get(jab.name)!.events) {
      if (event.frame <= jab.lastFrame || event.frame > frame) continue;
      if (event.type === 'jab') {
        if (event.kind === 'combo' && event.enabled) jab.comboOpen = true;
        if (event.kind === 'rapid') jab.rapidOpen = event.enabled;
      }
      if (jab.name === moves.rapidLoop && event.type === 'flag' && event.flag === 20 && (event.value ?? 0) === 0) {
        if (!jab.rapidInput) return enter(moves.rapidEnd!);
        jab.rapidInput = false;
      }
    }
    jab.lastFrame = frame;
    if (frame >= content.clips.get(jab.name)!.endFrame) {
      if (jab.name === moves.rapidStart) return enter(moves.rapidLoop!);
      if (jab.name === moves.rapidLoop) {
        // The bounded action decoder unfolds one animation cycle. Restart
        // its cursor and hit activations, preserving input since the last check.
        jab.lastFrame = -1; return moves.rapidLoop!;
      }
    }
    const threshold = content.profile.attributes.rapidJabThreshold;
    if (moves.rapidStart && threshold > 0 && jab.rapidOpen && jab.edges >= threshold && !jab.name.startsWith('Attack100')) return enter(moves.rapidStart);
  }
  const withinWindow = jab.window > 0;
  jab.window = Math.max(0, jab.window - 1);
  if ((attacking || withinWindow) && jab.queued && jab.comboOpen) {
    // ftCo_Attack1.c: doAttack12 routes Pikachu back through checkAttack11,
    // not a nonexistent Attack12. Reinitialize its input window and script
    // gates on every tap; the original combo event supplies the repeat timing.
    if (content.profile.kind === 'Pk' && jab.name === moves.jab) {
      Object.assign(jab, beginJab(content));
      return moves.jab;
    }
    const next = jab.name === moves.jab ? moves.jab2 : jab.name === moves.jab2 ? moves.jab3 : undefined;
    if (next) return enter(next);
  }
  return null;
}
