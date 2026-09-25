/**
 * The original versus-mode crowd (third_party/melee/src/melee/sfx/crowdsfx.c, set up by
 * gmvs.c un_80321900) and the fighter-side calls that feed it:
 *
 * - ftCo_Damage stores the launch magnitude (×angleMult for near-vertical launches,
 *   un_803222EC) and calls un_8032233C: strong hits get a reaction (0x144-0x146), repeat or
 *   comeback hits a cheer (0x140-0x142), and a human attacker past the chant percent can start
 *   the name chant (the attacker's FtSFX x34, replayed until gCrowdConfig max_gasp_count).
 * - Fighter_procUpdate keeps that magnitude only while in hitstun or near the floor edges,
 *   and plays SFX 96 when the fighter drops past the bottom warning line.
 * - A landing near an edge while still carrying the magnitude (un_803224DC) and a helpless
 *   fall entered just below the lowest floor (un_80322598) make the crowd gasp (0x13D-0x13F),
 *   as does a pile of fighters below the stage (un_80321AF4).
 *
 * Deterministic simulation state: it lives in the match snapshot and emits ordinary sound
 * events. The one departure is lbAudioAx_80023710 ("is this voice still playing?"), which is
 * answered from the SSM sample length (frames) instead of the AX mixer, so rollback and
 * every peer agree on when a chant ends. Channel 5 (chant) and 6 (reaction) are the original
 * lbAudioAx_800240B4/8002411C voices: a new sound on a channel cuts the previous one.
 */
import type { CrowdConfig, Floor, StageCameraBounds } from './data.ts';

/** lbAudioAx "no sound" id (0x83D60): a stop request on a crowd channel. */
export const CROWD_SILENCE = 540000;
export const CROWD_CHANT_CHANNEL = 5;
export const CROWD_REACTION_CHANNEL = 6;
/** ft_PlaySFX(fp, 96, 127, 64): the fall-warning sound near the bottom blast line. */
export const BOTTOM_WARNING_SOUND = 96;
/** ftCommon_80080144: Ice Climbers costumes 2+ use the alternate chant. */
const ICE_ALT_CHANT = 0x1fbd1;
const f32 = Math.fround;

/** un_804A2F08 (CrowdSFX_UnkStruct) plus the per-fighter bits the crowd reads. Spawn ids are
 * slot + 1 so 0 keeps meaning "nobody", as in the original. */
export interface CrowdState {
  /** x0/x4/x8: last strong hit's attacker, frames since it, and its magnitude. */
  lastAttacker: number; sinceHit: number; lastKnockback: number;
  /** xC: the fighter whose name the crowd chants; x14 the chant sound. */
  chanted: number; chantSound: number;
  /** x10: quiet frames since the last chant (a new one needs cheerLimit). */
  quiet: number;
  /** x18: chant repeats played; maxChants means no chant is running. */
  chants: number;
  /** x1C/x20: stop the chant at its next repeat, then (x20) cheer. */
  interrupt: boolean; interruptCheer: boolean;
  /** x24: fighters below the lowest floor + blastOffset last frame. */
  nearBlast: number;
  /** x2C/x28 voices as the frame their sound ends (-1 = silent). */
  chantUntil: number; reactionUntil: number;
  /** fp->dmg.x18A4_knockbackMagnitude per slot. */
  knockback: number[];
  /** fp->x2225_b0: the bottom warning has played and is waiting to re-arm. */
  bottomWarned: boolean[];
  /** Previous-frame position/ground/helpless state, for crossings and entries. */
  prevY: number[]; grounded: boolean[]; helpless: boolean[];
}
export function createCrowdState(config: CrowdConfig | undefined, fighters: number): CrowdState {
  const maxChants = config?.maxChants ?? 9;
  return {
    lastAttacker: 0, sinceHit: 0x10000, lastKnockback: 0, chanted: 0, chantSound: CROWD_SILENCE,
    quiet: config?.cheerLimit ?? 0, chants: maxChants, interrupt: false, interruptCheer: false, nearBlast: 0,
    chantUntil: -1, reactionUntil: -1,
    knockback: new Array(fighters).fill(0), bottomWarned: new Array(fighters).fill(false),
    prevY: new Array(fighters).fill(0), grounded: new Array(fighters).fill(true), helpless: new Array(fighters).fill(false),
  };
}

/** What the crowd reads from one fighter each frame. */
export interface CrowdFighter {
  slot: number; x: number; y: number; grounded: boolean;
  /** ko/respawn: ftLib_8008732C (dead motion) or x221F_b3; skipped entirely. */
  out: boolean; helpless: boolean; inHitstun: boolean;
  percent: number; cpu: boolean;
  kind: string; costume?: number; chantSound?: number;
}
/** mpLib_80458868[1]: extents of the enabled floor lines (platforms included). */
export interface FloorBox { left: number; right: number; bottom: number }
export function floorBox(floors: readonly Pick<Floor, 'a' | 'b'>[]): FloorBox {
  let left = Infinity, right = -Infinity, bottom = Infinity;
  for (const floor of floors) for (const [x, y] of [floor.a, floor.b]) { left = Math.min(left, x); right = Math.max(right, x); bottom = Math.min(bottom, y); }
  return Number.isFinite(left) ? { left, right, bottom } : { left: -Infinity, right: Infinity, bottom: 0 };
}
export interface CrowdHost {
  frame: number; config: CrowdConfig; floors: FloorBox;
  camera: StageCameraBounds; blastBottom: number;
  /** Frames the sound plays for; 0 when it cannot be resolved (never counts as playing). */
  duration(sound: number): number;
  sound(sound: number, player: number, channel?: number): void;
}

const category = (config: CrowdConfig, knockback: number): number =>
  knockback >= config.kbHigh ? 3 : knockback >= config.kbMid ? 2 : knockback >= config.kbLow ? 1 : 0;
/** un_80322258 / un_803224DC: within edgeMargin of (or past) the floor extents. */
const nearEdge = (host: CrowdHost, x: number): boolean => x < host.config.edgeMargin + host.floors.left || x > host.floors.right - host.config.edgeMargin;
/** un_803222EC: near-vertical launches impress the crowd less. */
export function crowdKnockback(config: CrowdConfig, knockback: number, angle: number): number {
  return angle > config.angleMin && angle < config.angleMax ? f32(knockback * config.angleMult) : knockback;
}
/** Stage_CalcUnkCamY / Stage_CalcUnkCamYBounds: the SFX 96 line and its re-arm line. */
export function bottomWarningLines(camera: Pick<StageCameraBounds, 'bottom'>, blastBottom: number): { warn: number; rearm: number } {
  const warn = f32(0.5 * (camera.bottom + blastBottom));
  return { warn, rearm: f32(0.5 * (camera.bottom + warn)) };
}

class Crowd {
  constructor(readonly state: CrowdState, readonly host: CrowdHost, readonly fighters: readonly CrowdFighter[]) {}
  private playing(until: number): boolean { return until > this.host.frame; }
  private fighter(spawn: number): CrowdFighter | undefined { return spawn > 0 ? this.fighters.find((f) => f.slot === spawn - 1) : undefined; }
  private emit(sound: number, channel: number, player: number): number {
    this.host.sound(sound, player, channel);
    const frames = this.host.duration(sound);
    return frames > 0 ? this.host.frame + frames : -1;
  }
  /** un_80321CE8. */
  stopReaction(): void { if (this.playing(this.state.reactionUntil)) this.host.sound(CROWD_SILENCE, 0, CROWD_REACTION_CHANNEL); this.state.reactionUntil = -1; }
  /** un_80321CA4 / un_80321CE8_caller (lbAudioAx_8002411C). */
  reaction(sound: number, player = 0): void { this.stopReaction(); this.state.reactionUntil = this.emit(sound, CROWD_REACTION_CHANNEL, player); }
  /** un_80321C28. */
  stopChant(): void { if (this.playing(this.state.chantUntil)) this.host.sound(CROWD_SILENCE, 0, CROWD_CHANT_CHANNEL); this.state.chantUntil = -1; }
  /** un_80321BF8 (lbAudioAx_800240B4). */
  chant(sound: number, player = 0): void { this.state.chantUntil = this.emit(sound, CROWD_CHANT_CHANNEL, player); }
  /** un_80321C70: stop a chant that has already repeated chantInterruptAfter times. */
  interruptChant(): void {
    const s = this.state, c = this.host.config;
    if (s.chants >= c.maxChants || s.chants < c.chantInterruptAfter) return;
    s.interrupt = true;
  }
  /** un_8032201C: the gasp; returns false for category 0. */
  gasp(spawn: number, level: number): boolean {
    if (level <= 0) return false;
    this.reaction(level === 3 ? 0x13d : level === 2 ? 0x13e : 0x13f, Math.max(0, spawn - 1));
    if (spawn !== 0 && this.state.chanted === spawn) this.interruptChant();
    return true;
  }
  /** un_80321EBC: start chanting the attacker's name (cheer first, chant on the next repeat). */
  startChant(spawn: number, knockback: number): boolean {
    const s = this.state, c = this.host.config, attacker = this.fighter(spawn);
    if (!attacker || attacker.cpu || Math.trunc(attacker.percent) < c.chantPercent || s.quiet < c.cheerLimit || s.chanted === spawn) return false;
    s.chantSound = attacker.kind === 'Pp' && (attacker.costume ?? 0) >= 2 ? ICE_ALT_CHANT : attacker.chantSound ?? CROWD_SILENCE;
    if (s.chantSound === CROWD_SILENCE || this.host.duration(s.chantSound) <= 0) return false;
    this.stopChant();
    this.chant(category(c, knockback) === 3 ? 0x140 : 0x141, attacker.slot);
    s.chanted = spawn; s.chants = 0;
    return true;
  }
  /** un_80321D30: a cheer for the attacker (or the chant, for big enough hits). */
  cheer(spawn: number, knockback: number): void {
    const level = category(this.host.config, knockback), player = Math.max(0, spawn - 1);
    if (level >= 2 && this.startChant(spawn, knockback)) { this.stopReaction(); return; }
    if (level === 3) this.reaction(0x140, player); else if (level === 2) this.reaction(0x141, player); else if (level === 1) this.reaction(0x142, player);
    if (spawn !== 0 && this.state.chanted === spawn) this.interruptChant();
  }
  /** un_8032233C, after ftCo_Damage stored the victim's magnitude. */
  hit(attackerSpawn: number, victimSpawn: number): void {
    const s = this.state, c = this.host.config;
    const knockback = s.knockback[victimSpawn - 1] ?? 0, level = category(c, knockback);
    if (level === 0) return;
    const attacker = this.fighter(attackerSpawn);
    if (attacker && (s.knockback[attacker.slot] ?? 0) >= 3) this.cheer(attackerSpawn, knockback);
    else if (s.lastAttacker === attackerSpawn && s.sinceHit < c.comboFrames) this.cheer(attackerSpawn, Math.max(knockback, s.lastKnockback));
    else {
      this.reaction(level === 3 ? 0x144 : level === 2 ? 0x145 : 0x146, victimSpawn - 1);
      if (level === 3 || (level === 2 && s.chanted === victimSpawn)) this.interruptChant();
    }
    s.sinceHit = 0; s.lastAttacker = attackerSpawn; s.lastKnockback = knockback;
  }
  /** Fighter_procUpdate (fighter.c): SFX 96 near the bottom and the magnitude keep/drop rule,
   * then the landing (un_803224DC) and helpless-entry (un_80322598) gasps. */
  fighterFrame(f: CrowdFighter): void {
    const s = this.state, c = this.host.config, slot = f.slot;
    if (f.out) {
      s.knockback[slot] = 0; s.bottomWarned[slot] = false;
      s.prevY[slot] = f.y; s.grounded[slot] = f.grounded; s.helpless[slot] = f.helpless;
      return;
    }
    const lines = bottomWarningLines(this.host.camera, this.host.blastBottom), prevY = s.prevY[slot] ?? f.y;
    if (s.bottomWarned[slot]) { if (prevY <= lines.rearm && f.y > lines.rearm) s.bottomWarned[slot] = false; }
    else if (prevY >= lines.warn && f.y < lines.warn) { this.host.sound(BOTTOM_WARNING_SOUND, slot); s.bottomWarned[slot] = true; }
    if (s.knockback[slot] && !f.inHitstun && !nearEdge(this.host, f.x)) s.knockback[slot] = 0;
    if (f.grounded && !s.grounded[slot] && nearEdge(this.host, f.x) && this.gasp(slot + 1, category(c, s.knockback[slot] ?? 0))) s.knockback[slot] = 0;
    if (f.helpless && !s.helpless[slot]) {
      const floor = this.host.floors.bottom;
      if (f.y < floor && f.y >= c.recoveryLow + floor) this.gasp(slot + 1, f.y > c.recoveryHigh + floor ? 3 : f.y > c.recoveryMid + floor ? 2 : 1);
    }
    s.prevY[slot] = f.y; s.grounded[slot] = f.grounded; s.helpless[slot] = f.helpless;
  }
  /** fn_803219AC: the crowd's own per-frame proc (un_80321A00 + un_80321AF4). */
  proc(): void {
    const s = this.state, c = this.host.config;
    if (s.sinceHit < 0x10000) s.sinceHit++;
    if (s.chants >= c.maxChants) { if (s.quiet < c.cheerLimit) s.quiet++; }
    else if (!this.playing(s.chantUntil)) {
      s.chants++;
      if (s.chants < c.maxChants) {
        if (s.interrupt) {
          s.interrupt = false; s.quiet = 0; s.chants = c.maxChants;
          this.stopChant();
          if (s.interruptCheer) { this.reaction(0x144); s.interruptCheer = false; }
        } else this.chant(s.chantSound, Math.max(0, s.chanted - 1));
      } else { s.quiet = 0; this.stopChant(); this.reaction(0x140); }
    }
    const before = s.nearBlast; let chantedAbove = false;
    s.nearBlast = 0;
    for (const f of this.fighters) {
      if (f.out) continue;
      if (f.y < c.blastOffset + this.host.floors.bottom) s.nearBlast++;
      else if (s.chanted === f.slot + 1) chantedAbove = true;
    }
    if (before < c.nearBlastCount && s.nearBlast >= c.nearBlastCount) {
      if (chantedAbove) this.gasp(s.chanted, 3); else this.reaction(0x13d);
    }
  }
}

/** ftCo_Damage: store the victim's magnitude and let the crowd react (un_8032233C). */
export function crowdHit(state: CrowdState, host: CrowdHost, fighters: readonly CrowdFighter[], attacker: number | null, victim: number, knockback: number, angle: number): void {
  if (victim < 0 || victim >= state.knockback.length || !Number.isFinite(knockback)) return;
  state.knockback[victim] = crowdKnockback(host.config, knockback, angle);
  new Crowd(state, host, fighters).hit(attacker === null || attacker === victim ? 0 : attacker + 1, victim + 1);
}
/** One simulation frame: every fighter's procUpdate share, then the crowd proc. */
export function crowdStep(state: CrowdState, host: CrowdHost, fighters: readonly CrowdFighter[]): void {
  const crowd = new Crowd(state, host, fighters);
  for (const fighter of fighters) crowd.fighterFrame(fighter);
  crowd.proc();
}
/** un_80322314 (ftcommon.c): a fighter swap stops the chant with a closing cheer. */
export function crowdInterruptWithCheer(state: CrowdState, config: CrowdConfig): void {
  if (state.chants >= config.maxChants) return;
  state.interrupt = true; state.interruptCheer = true;
}
