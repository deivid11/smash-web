import { describe, expect, it } from 'vitest';
import {
  initialNanaState, stepNanaState, nanaMirrorsLeader, nanaStrikeHit, fighterHasNana,
  NANA_ANCHOR_BACK, NANA_LOST_DISTANCE, NANA_REGROUP_INVULN,
  type NanaLeader, type NanaTuning, type NanaWorld,
} from '../../lib/game/nana.ts';
import { isPairedSlotKind, selectLineup, ZELDA_SHEIK_SLOT } from '../../lib/game/roster.ts';
import { clampCostumeIndex, nanaCostumeFile, nanaCostumeKey } from '../../lib/game/costumes.ts';
import type { GameContent } from '../../lib/game/load.ts';

const floors = [{ id: 1, a: [-100, 0] as [number, number], b: [100, 0] as [number, number], oneWay: false }];
const blast = { left: -200, right: 200, top: 200, bottom: -100 };
const world: NanaWorld = { floors, surfaces: [], blast };
const tuning: NanaTuning = { runSpeed: 2, jumpSpeed: 5, gravity: 0.3, terminal: 8 };
const leader = (over: Partial<NanaLeader> = {}): NanaLeader =>
  ({ x: 0, y: 0, facing: 1, grounded: true, floor: 1, state: 'idle', ...over });

describe('Nana partner kinematics (no disc required)', () => {
  it('spawns active behind Popo, grounded with him', () => {
    const nana = initialNanaState(-9, 0, 1, 1);
    expect(nana).toMatchObject({ active: true, x: -9, y: 0, facing: 1, grounded: true, floor: 1, percent: 0, tumble: 0 });
  });
  it('mirrors strikes and idles grabs, ledges and downed states', () => {
    for (const state of ['idle', 'walk', 'run', 'attack', 'special', 'hitstun', 'shield', 'helpless', 'fall'] as const) {
      expect(nanaMirrorsLeader(state)).toBe(true);
    }
    for (const state of ['grab', 'holding', 'captured', 'throw', 'grab-release', 'ledge', 'ledge-action', 'ledge-jump', 'tether', 'ko', 'respawn', 'shield-break', 'dizzy', 'bury'] as const) {
      expect(nanaMirrorsLeader(state)).toBe(false);
    }
  });
  it('swings every strike except grabs and detects', () => {
    expect(nanaStrikeHit({ element: 3 })).toBe(true);
    expect(nanaStrikeHit({})).toBe(true);
    expect(nanaStrikeHit({ element: 8 })).toBe(false);
    expect(nanaStrikeHit({ element: 11 })).toBe(false);
  });
  it('only fields Nana for Ice Climbers with a partner model', () => {
    expect(fighterHasNana('Pp', {})).toBe(true);
    expect(fighterHasNana('Pp', undefined)).toBe(false);
    expect(fighterHasNana('Fx', {})).toBe(false);
  });
  it('runs toward the anchor behind Popo', () => {
    const nana = initialNanaState(-40, 0, 1, 1);
    for (let i = 0; i < 20; i++) expect(stepNanaState(nana, leader(), world, tuning)).toBe('follow');
    expect(nana.x).toBeCloseTo(-NANA_ANCHOR_BACK, 5);
    expect(nana.grounded).toBe(true);
    expect(nana.y).toBe(0);
  });
  it('jumps after a rising Popo and lands back on the floor', () => {
    const nana = initialNanaState(-9, 0, 1, 1);
    expect(stepNanaState(nana, leader({ y: 30 }), world, tuning)).toBe('follow');
    expect(nana.grounded).toBe(false);
    for (let i = 0; i < 60; i++) stepNanaState(nana, leader({ y: 30 }), world, tuning);
    // Falls back and lands once Popo holds still above her jump reach story ends.
    for (let i = 0; i < 120; i++) stepNanaState(nana, leader(), world, tuning);
    expect(nana.grounded).toBe(true);
    expect(nana.y).toBeCloseTo(0, 5);
  });
  it('falls off a walked-off edge and lands on lower ground', () => {
    const low = { id: 2, a: [-100, -20] as [number, number], b: [200, -20] as [number, number], oneWay: false };
    const stepped: NanaWorld = { floors: [...floors, low], surfaces: [], blast };
    const nana = initialNanaState(95, 0, 1, 1);
    // Popo drops to the lower floor past the edge; Nana trails him off it,
    // falls, and settles beside him below.
    for (let i = 0; i < 120; i++) stepNanaState(nana, leader({ x: 130, y: -20, grounded: true, floor: 2 }), stepped, tuning);
    expect(nana.grounded).toBe(true);
    expect(nana.floor).toBe(2);
    expect(nana.y).toBeCloseTo(-20, 4);
  });
  it('stops at walls instead of passing through them', () => {
    const wall = { id: 7, a: [10, -50] as [number, number], b: [10, 50] as [number, number], oneWay: false, kind: 'wall' as const };
    const walled: NanaWorld = { floors, surfaces: [wall], blast };
    const nana = initialNanaState(0, 0, 1, 1);
    for (let i = 0; i < 30; i++) stepNanaState(nana, leader({ x: 39 }), walled, tuning);
    expect(nana.x).toBeLessThanOrEqual(10.001);
  });
  it('reports a blast crossing so the match can KO her into Sopo', () => {
    const nana = initialNanaState(0, 0, 1, 1);
    nana.x = 500;
    expect(stepNanaState(nana, leader(), world, tuning)).toBe('blast');
  });
  it('regroups beside a distant Popo with brief protection', () => {
    const nana = initialNanaState(0, 0, 1, 1);
    expect(stepNanaState(nana, leader({ x: NANA_LOST_DISTANCE + 50 }), world, tuning)).toBe('follow');
    expect(nana.x).toBeCloseTo(NANA_LOST_DISTANCE + 50 - NANA_ANCHOR_BACK, 5);
    expect(nana.invulnerable).toBe(NANA_REGROUP_INVULN);
  });
  it('tumbles ballistically on knockback and recovers on landing', () => {
    const nana = initialNanaState(-9, 0, 1, 1);
    nana.tumble = 10; nana.vx = 3; nana.vy = 4; nana.grounded = false; nana.floor = null;
    expect(stepNanaState(nana, leader(), world, tuning)).toBe('follow');
    expect(nana.tumble).toBe(9);
    expect(nana.x).toBeGreaterThan(-9);
    for (let i = 0; i < 120; i++) stepNanaState(nana, leader(), world, tuning);
    expect(nana.tumble).toBe(0);
    expect(nana.grounded).toBe(true);
  });
  it('leaves inactive states alone', () => {
    const nana = initialNanaState(-9, 0, 1, 1);
    nana.active = false; nana.x = 123;
    expect(stepNanaState(nana, leader({ x: 500 }), world, tuning)).toBe('follow');
    expect(nana.x).toBe(123);
  });
  it('repeats identically (deterministic, no RNG or wall clock)', () => {
    const run = () => {
      const nana = initialNanaState(-40, 5, 1, null);
      nana.vy = -1;
      for (let i = 0; i < 60; i++) stepNanaState(nana, leader({ x: Math.sin(i / 7) * 30, y: Math.max(0, 20 - i * 0.2) }), world, tuning);
      return nana;
    };
    expect(run()).toEqual(run());
  });
});

describe('Nana costume plumbing (no disc required)', () => {
  it('uses Nana’s own suffix order under the PlNn prefix (not Popo’s)', () => {
    // USA v1.02 holds PlNn Nr/Aq/Wh/Ye — there are no PlNnRe/Gr/Or files.
    expect(nanaCostumeFile(0)).toBe('PlNnNr.dat');
    expect(nanaCostumeFile(1)).toBe('PlNnAq.dat');
    expect(nanaCostumeFile(2)).toBe('PlNnWh.dat');
    expect(nanaCostumeFile(3)).toBe('PlNnYe.dat');
    expect(nanaCostumeKey(2)).toBe('Pp:nana:2');
    expect(clampCostumeIndex('Pp', 9)).toBe(3);
  });
  it('marks Zelda/Sheik as the one paired slot', () => {
    expect(ZELDA_SHEIK_SLOT).toEqual(['Zd', 'Sk']);
    expect(isPairedSlotKind('Zd')).toBe(true);
    expect(isPairedSlotKind('Sk')).toBe(true);
    expect(isPairedSlotKind('Fx')).toBe(false);
    expect(isPairedSlotKind('Pp')).toBe(false);
  });
  it('wires Nana skins through selectLineup, falling back gracefully', () => {
    const nanaNr = { id: 'nana-nr' }, popoNr = { id: 'popo-nr' }, popoRe = { id: 'popo-re' }, nanaRe = { id: 'nana-re' };
    const popoBase = { profile: { kind: 'Pp' }, model: popoNr, partnerModel: nanaNr };
    const fxBase = { profile: { kind: 'Fx' }, model: { id: 'fox' } };
    const content = { fighters: [], roster: new Map([['Pp', popoBase], ['Fx', fxBase]]) } as unknown as GameContent;
    const picks = [{ fighter: 'Pp' as const, costume: 1 }, { fighter: 'Fx' as const, costume: 0 }];
    const models = new Map([['Pp:1', popoRe], ['Pp:nana:1', nanaRe]]) as unknown as ReadonlyMap<string, import('../../lib/hsd/model.ts').HsdModel>;
    const dressed = selectLineup(content, picks, models);
    expect(dressed.fighters[0]!.model).toBe(popoRe);
    expect(dressed.fighters[0]!.partnerModel).toBe(nanaRe);
    // Her skin missing: Popo still dresses, Nana falls back to default.
    const fallback = selectLineup(content, picks, new Map([['Pp:1', popoRe]]) as unknown as ReadonlyMap<string, import('../../lib/hsd/model.ts').HsdModel>);
    expect(fallback.fighters[0]!.partnerModel).toBe(nanaNr);
    // Default skins keep the roster pair untouched.
    const plain = selectLineup(content, [{ fighter: 'Pp' as const, costume: 0 }, { fighter: 'Fx' as const, costume: 0 }], new Map());
    expect(plain.fighters[0]).toBe(popoBase);
    // No partner model anywhere: solo Popo, no crash.
    const soloBase = { profile: { kind: 'Pp' }, model: popoNr };
    const soloContent = { fighters: [], roster: new Map([['Pp', soloBase], ['Fx', fxBase]]) } as unknown as GameContent;
    expect(selectLineup(soloContent, picks, new Map([['Pp:1', popoRe]]) as unknown as ReadonlyMap<string, import('../../lib/hsd/model.ts').HsdModel>).fighters[0]!.partnerModel).toBeUndefined();
  });
});
