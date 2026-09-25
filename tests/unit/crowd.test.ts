import { describe, expect, it } from 'vitest';
import type { CrowdConfig } from '../../lib/game/data.ts';
import { BOTTOM_WARNING_SOUND, CROWD_CHANT_CHANNEL, CROWD_REACTION_CHANNEL, CROWD_SILENCE, bottomWarningLines, createCrowdState, crowdHit, crowdKnockback, crowdStep, floorBox, type CrowdFighter, type CrowdHost, type CrowdState } from '../../lib/game/crowd.ts';

/** PlCo gCrowdConfig from the USA v1.02 disc (tests/unit/offscreen-crowd-real.test.ts checks it). */
const CONFIG: CrowdConfig = {
  kbLow: 100, kbMid: 130, kbHigh: 160, angleMin: 1.3089969158172607, angleMax: 2.0071287155151367, angleMult: 0.800000011920929,
  comboFrames: 60, chantPercent: 100, cheerLimit: 1200, chantInterruptAfter: 3, maxChants: 9, edgeMargin: 15,
  recoveryHigh: -10, recoveryMid: -30, recoveryLow: -80, nearBlastCount: 3, blastOffset: -30,
};
const FLOORS = floorBox([{ a: [-85.6, 0], b: [85.6, 0] }]);
interface Played { sound: number; player: number; channel?: number; frame: number }
function world(fighters = 2) {
  const played: Played[] = [];
  const state = createCrowdState(CONFIG, fighters);
  const roster: CrowdFighter[] = Array.from({ length: fighters }, (_, slot) => ({ slot, x: slot ? 20 : -20, y: 0, grounded: true, out: false, helpless: false, inHitstun: false, percent: 0, cpu: false, kind: 'Mr', chantSound: 180000 + slot }));
  const host: CrowdHost = {
    frame: 0, config: CONFIG, floors: FLOORS, camera: { left: -170, right: 170, top: 114, bottom: -80 }, blastBottom: -140,
    duration: (sound) => sound === CROWD_SILENCE ? 0 : 30,
    sound: (sound, player, channel) => played.push({ sound, player, channel, frame: host.frame }),
  };
  const step = (frames = 1) => { for (let i = 0; i < frames; i++) { host.frame++; crowdStep(state, host, roster); } };
  const hit = (attacker: number | null, victim: number, knockback: number, angle = 0.7) => crowdHit(state, host, roster, attacker, victim, knockback, angle);
  return { played, state, roster, host, step, hit };
}
const sounds = (played: readonly Played[]) => played.map((entry) => entry.sound);

describe('original crowd reactions (crowdsfx.c)', () => {
  it('reacts to launch magnitude in three tiers and ignores weak hits', () => {
    const w = world();
    w.hit(0, 1, 90); expect(w.played).toEqual([]);
    w.hit(0, 1, 110); w.step(61);
    w.hit(1, 0, 140); w.step(61);
    w.hit(0, 1, 170);
    expect(sounds(w.played)).toEqual([0x146, 0x145, 0x144]);
    expect(w.played.every((entry) => entry.channel === CROWD_REACTION_CHANNEL)).toBe(true);
  });
  it('scales near-vertical launches by angleMult (un_803222EC)', () => {
    expect(crowdKnockback(CONFIG, 150, Math.PI / 2)).toBeCloseTo(120, 4);
    expect(crowdKnockback(CONFIG, 150, 0.5)).toBe(150);
    const w = world();
    w.hit(0, 1, 135, Math.PI / 2); // 108 → tier 1
    expect(sounds(w.played)).toEqual([0x146]);
  });
  it('cheers a follow-up from the same attacker within the combo window, cutting the reaction', () => {
    const w = world();
    w.hit(0, 1, 140); w.step(10); w.hit(0, 1, 105);
    // Follow-up keeps the bigger magnitude: tier 2 cheer (0x141), after stopping the reaction voice.
    expect(sounds(w.played)).toEqual([0x145, CROWD_SILENCE, 0x141]);
  });
  it('chants a human attacker past the chant percent, then closes with a cheer', () => {
    const w = world();
    w.roster[0]!.percent = 120;
    w.hit(0, 1, 140); w.step(10); w.hit(0, 1, 140);
    // The follow-up starts the chant: cheer on the chant voice, the reaction voice cut.
    expect(w.played.slice(-2).map((e) => [e.sound, e.channel])).toEqual([[0x141, CROWD_CHANT_CHANNEL], [CROWD_SILENCE, CROWD_REACTION_CHANNEL]]);
    expect(w.state.chanted).toBe(1);
    w.step(30 * 10);
    const chant = w.played.filter((entry) => entry.sound === 180000);
    expect(chant).toHaveLength(8);
    expect(chant.every((entry) => entry.channel === CROWD_CHANT_CHANNEL && entry.player === 0)).toBe(true);
    expect(w.played.at(-1)!.sound).toBe(0x140);
    expect(w.state.chants).toBe(CONFIG.maxChants);
    // The quiet timer restarts: no new chant for cheerLimit frames.
    w.hit(1, 0, 150); w.step(5); w.hit(1, 0, 150);
    expect(w.state.chanted).toBe(1);
  });
  it('never chants for CPU seats or below the chant percent', () => {
    for (const setup of [(f: CrowdFighter) => { f.percent = 150; f.cpu = true; }, (f: CrowdFighter) => { f.percent = 60; }]) {
      const w = world();
      setup(w.roster[0]!);
      w.hit(0, 1, 140); w.step(10); w.hit(0, 1, 140);
      expect(w.state.chanted).toBe(0);
      expect(w.played.some((entry) => entry.channel === CROWD_CHANT_CHANNEL)).toBe(false);
    }
  });
  it('gasps when a launched fighter lands near an edge, not in the middle', () => {
    const edge = world();
    edge.hit(0, 1, 170); edge.roster[1]!.inHitstun = true; edge.roster[1]!.grounded = false; edge.step();
    Object.assign(edge.roster[1]!, { x: 80, grounded: true, inHitstun: false }); edge.step();
    expect(sounds(edge.played).at(-1)).toBe(0x13d);
    expect(edge.state.knockback[1]).toBe(0);
    const middle = world();
    middle.hit(0, 1, 170); Object.assign(middle.roster[1]!, { x: 0, grounded: false, inHitstun: false }); middle.step();
    middle.roster[1]!.grounded = true; middle.step();
    expect(sounds(middle.played)).toEqual([0x144]);
  });
  it('gasps by depth when a helpless fall starts just below the stage', () => {
    for (const [y, sound] of [[-5, 0x13d], [-20, 0x13e], [-60, 0x13f]] as const) {
      const w = world();
      Object.assign(w.roster[0]!, { y, grounded: false, helpless: true }); w.step();
      expect(sounds(w.played), `y ${y}`).toEqual([sound]);
    }
    const deep = world();
    Object.assign(deep.roster[0]!, { y: -95, grounded: false, helpless: true }); deep.step();
    expect(deep.played).toEqual([]);
  });
  it('plays the bottom warning once per descent (Stage_CalcUnkCamY)', () => {
    const lines = bottomWarningLines({ bottom: -80 }, -140);
    expect(lines).toEqual({ warn: -110, rearm: -95 });
    const w = world();
    const fall = (y: number) => { Object.assign(w.roster[0]!, { y, grounded: false }); w.step(); };
    fall(-100); fall(-112); fall(-130); fall(-100); fall(-120);
    expect(w.played.filter((entry) => entry.sound === BOTTOM_WARNING_SOUND)).toHaveLength(1);
    fall(-90); fall(-115);
    expect(w.played.filter((entry) => entry.sound === BOTTOM_WARNING_SOUND)).toHaveLength(2);
  });
  it('gasps when enough fighters drop below the stage together', () => {
    const w = world(3);
    for (const f of w.roster) Object.assign(f, { y: -40, grounded: false });
    w.step(); w.step();
    expect(sounds(w.played)).toEqual([0x13d]);
  });
  it('is plain data: a cloned state replays the same sounds', () => {
    const a = world(); a.roster[0]!.percent = 120;
    a.hit(0, 1, 140); a.step(5);
    const snapshot: CrowdState = structuredClone(a.state), frame = a.host.frame;
    a.hit(0, 1, 150); a.step(200);
    const tail = a.played.filter((entry) => entry.frame >= frame).map((entry) => [entry.sound, entry.frame]);
    const b = world(); b.roster[0]!.percent = 120; Object.assign(b.state, structuredClone(snapshot)); b.host.frame = frame;
    b.hit(0, 1, 150); b.step(200);
    expect(b.played.map((entry) => [entry.sound, entry.frame])).toEqual(tail);
  });
});
