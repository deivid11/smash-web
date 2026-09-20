import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair, rosterPlayers } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { RollbackDriver, normalizeInput } from '../../lib/game/rollback.ts';
import { matchSpawnPoints } from '../../lib/game/spawns.ts';
import { SUPPORTED_STAGES } from '../../lib/game/stages.ts';
import { MUSIC_TRACKS } from '../../lib/game/music.ts';
import { STADIUM_AREAS, STADIUM_FORMS, STADIUM_VARIANTS, type StadiumForm } from '../../lib/game/stadium.ts';
import { parseClientMessage } from '../../lib/net/protocol.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

describe('Pokémon Stadium registration', () => {
  it('registers the stage, music, five transport archives and the room protocol id', () => {
    const entry = SUPPORTED_STAGES.find(stage => stage.id === 'stadium')!;
    expect(entry).toMatchObject({ label: 'Pokémon Stadium', asset: 'GrPs.dat', music: 'stadium' });
    expect(MUSIC_TRACKS.stadium).toBe('audio/pokesta.hps');
    for (const name of ['GrPs.dat', 'GrPs1.dat', 'GrPs2.dat', 'GrPs3.dat', 'GrPs4.dat', 'audio/pokesta.hps']) expect(SERVER_ASSETS).toContain(name);
    for (const name of ['GrPs.usd', 'audio/pokemon.hps', 'audio/pstadium.hps']) expect(SERVER_ASSETS).not.toContain(name);
    const rules = { stage: 'stadium', stocks: 3, timeSeconds: 180 };
    expect(parseClientMessage(JSON.stringify({ type: 'rules', token: 't', rules }))).toMatchObject({ rules });
    expect(STADIUM_FORMS).toHaveLength(5);
    for (const form of STADIUM_FORMS) expect(STADIUM_AREAS[form][0]).toBe(6); // outer aprons always active
  });
});
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Pokémon Stadium original ISO integration', () => {
  let base: GameContent, content: GameContent, rig: GameRigs, game: LocalMatch;
  // Compressed but structurally identical schedule so tests cross several transformations.
  const fast = () => ({ ...base.stadium!, timing: { ...base.stadium!.timing, normalMin: 40, normalMax: 40, variantMin: 50, variantMax: 50, warning: 10, shrink: 12, pause: 6 } });
  const make = (timing: 'original' | 'fast' = 'fast') => {
    rig?.dispose();
    content = { ...rosterPair(base, 'Fx', 'Mr'), ...(timing === 'fast' ? { stadium: fast() } : {}) };
    rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, seed: 7 }); game.start();
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...a }, { ...neutralInput(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const untilForm = (predicate: (form: StadiumForm) => boolean, budget = 400) => {
    for (let i = 0; i < budget; i++) { step(); if (predicate(game.stadium!.form)) return; }
    throw new Error('Transformation did not happen within the budget.');
  };
  beforeAll(async () => { const disc = await openDisc(iso!); try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'stadium'); } finally { await disc.close(); } }, 30000);
  beforeEach(() => make()); afterEach(() => rig?.dispose());
  it('loads the original per-form collision sets, schedule and variant terrain models', () => {
    const stadium = base.stadium!;
    expect(stadium.timing).toEqual({ normalMin: 3600, normalMax: 3800, variantMin: 1200, variantMax: 1800, warning: 300, shrink: 120, pause: 60 });
    expect(stadium.forms.normal.floors.map(f => f.id).sort((a, b) => a - b)).toEqual([34, 35, 36, 51, 52, 53, 54]);
    expect(stadium.forms.fire.floors).toHaveLength(23);
    expect(stadium.forms.grass.floors).toHaveLength(19);
    expect(stadium.forms.water.floors).toHaveLength(20);
    expect(stadium.forms.rock.floors).toHaveLength(18);
    for (const form of STADIUM_FORMS) {
      const stage = stadium.forms[form];
      expect(stage.blast).toEqual(stadium.forms.normal.blast);
      expect(stage.spawns).toEqual(stadium.forms.normal.spawns);
      // The outer aprons keep both grab edges in every form.
      expect(stage.ledges.some(l => l.facing === 1 && l.x < -80)).toBe(true);
      expect(stage.ledges.some(l => l.facing === -1 && l.x > 80)).toBe(true);
    }
    for (const form of STADIUM_VARIANTS) expect(base.stadiumModels?.[form]?.stats.meshes ?? 0).toBeGreaterThan(0);
    expect(matchSpawnPoints(stadium.forms.normal, 8)).toHaveLength(8);
  });
  it.each(STADIUM_FORMS)('%s keeps only its active native wall/ceiling line indices for items and tethers',form=>{
    const arc=base.stageModel.archive,areas=arc.pointer(arc.symbol('coll_data')+0x24),expected:number[]=[];
    for(const area of STADIUM_AREAS[form])for(const offset of [4,8,12]){
      const first=arc.u16(areas+area*0x28+offset),count=arc.u16(areas+area*0x28+offset+2);
      for(let line=first;line<first+count;line++)expected.push(line);
    }
    expect(expected.length).toBeGreaterThan(0);
    expect(base.stadium!.forms[form].surfaces!.filter(s=>s.kind!=='floor').map(s=>s.id).sort((a,b)=>a-b)).toEqual([...new Set(expected)].sort((a,b)=>a-b));
  });
  it('starts in normal form on the flat main floor with the original wait window', () => {
    make('original');
    expect(game.stadium).toMatchObject({ form: 'normal', phase: 'wait', next: null });
    expect(game.stadium!.timer).toBeGreaterThanOrEqual(3600 - 1);
    expect(game.stadium!.timer).toBeLessThanOrEqual(3800);
    expect(game.content.stage.floors.map(f => f.id)).toContain(34);
    for (const fighter of game.fighters) expect(fighter.grounded).toBe(true);
  });
  it('cycles normal → variant → normal, never repeating the same variant back to back', () => {
    untilForm(form => form !== 'normal');
    const first = game.stadium!.form;
    expect(STADIUM_VARIANTS).toContain(first);
    ticks(content.stadium!.timing.shrink + 1); // the flattened old plate stays live until the rise completes
    expect(game.content.stage.floors.map(f => f.id)).not.toContain(34);
    expect(game.stadium!.lastVariant).toBe(first);
    untilForm(form => form === 'normal');
    expect(game.content.stage.floors.map(f => f.id)).toContain(34);
    untilForm(form => form !== 'normal');
    expect(game.stadium!.form).not.toBe(first);
  });
  it('follows the warn/shrink/pause/grow cadence, scales the sinking terrain and keeps the flattened plate live through the rise', () => {
    const timing = content.stadium!.timing;
    ticks(timing.normalMax);
    expect(game.stadium!.phase).toBe('warn');
    expect(game.stadium!.next).not.toBeNull();
    ticks(timing.warning);
    expect(game.stadium!.phase).toBe('shrink');
    expect(game.content.stage.floors.map(f => f.id)).toContain(34); // old ground persists while it shrinks
    const platform = () => game.content.stage.floors.find(f => f.id === 35)!;
    expect(platform().a[1]).toBeCloseTo(25, 3);
    ticks(Math.floor(timing.shrink / 2));
    expect(platform().a[1]).toBeGreaterThan(1.25); expect(platform().a[1]).toBeLessThan(25); // collapsing toward y = 0, like grStadium's scaleY
    ticks(timing.shrink - Math.floor(timing.shrink / 2));
    expect(game.stadium!.phase).toBe('pause');
    expect(platform().a[1]).toBeCloseTo(1.25, 3); // 5 % height
    ticks(timing.pause);
    expect(game.stadium!.phase).toBe('grow');
    expect(game.stadium!.form).not.toBe('normal');
    expect(game.content.stage.floors.map(f => f.id)).toContain(34); // old plate still live during the rise
    const risen = game.content.stage.floors.filter(f => f.id < 34 || f.id > 36);
    expect(risen.some(f => f.a[1] < 0 || f.b[1] < 0)).toBe(true); // new terrain starts at 5 % height, 10 units down
    ticks(timing.shrink + 1);
    expect(game.stadium!.phase).toBe('wait');
    expect(game.content.stage.floors.map(f => f.id)).not.toContain(34);
  });
  it('keeps fighters alive across a transformation: they fall to the new terrain and land', () => {
    untilForm(form => form !== 'normal');
    ticks(120);
    for (const fighter of game.fighters) {
      expect(fighter.stocks).toBe(3);
      expect(fighter.grounded).toBe(true);
      const support = game.content.stage.floors.find(f => f.id === fighter.floor);
      expect(support).toBeDefined();
    }
  });
  it('carries mid-stage fighters onto the risen rock terrain instead of dropping them through it', () => {
    const park = () => game.fighters.forEach((fighter, i) => { fighter.x = i ? 2 : -2; fighter.y = 0; fighter.grounded = true; fighter.floor = 34; fighter.state = 'idle'; fighter.animation = 'Wait1'; rig.sample(fighter); });
    park();
    for (let guard = 0; guard < 12; guard++) {
      untilForm(form => form !== 'normal', 800);
      if (game.stadium!.form === 'rock') break;
      untilForm(form => form === 'normal', 800); park();
    }
    expect(game.stadium!.form).toBe('rock');
    ticks(content.stadium!.timing.shrink + 1); // the cliff rises through them and carries them up
    for (const fighter of game.fighters) {
      expect(fighter.stocks).toBe(3);
      expect(fighter.y).toBeGreaterThan(5); // riding the cliff surface, not buried at y=0 or falling under it
    }
    ticks(60);
    for (const fighter of game.fighters) { expect(fighter.stocks).toBe(3); expect(fighter.grounded).toBe(true); }
  });
  it('keeps fighters parked in the all-form safe band alive across the first ORIGINAL-timing transformation', () => {
    make('original');
    game.fighters[0].x = 30; game.fighters[1].x = 45;
    for (const fighter of game.fighters) { fighter.grounded = true; fighter.floor = 34; fighter.y = 0; rig.sample(fighter); }
    const budget = base.stadium!.timing.normalMax + base.stadium!.timing.warning + base.stadium!.timing.shrink + base.stadium!.timing.pause + 200;
    for (let i = 0; i < budget && game.stadium!.form === 'normal'; i++) step();
    expect(game.stadium!.form).not.toBe('normal');
    ticks(150);
    for (const fighter of game.fighters) {
      expect(fighter.stocks).toBe(3);
      expect(fighter.grounded).toBe(true);
    }
  });
  it('exposes the clock in snapshots and restores mid-transformation deterministically', () => {
    ticks(content.stadium!.timing.normalMax + 5); // inside the warn window
    expect(game.snapshot().stadium?.phase).toBe('warn');
    const state = game.captureState(), form = game.stadium!.form;
    ticks(200);
    const hash = game.stateHash(), later = game.stadium!.form;
    expect(later).not.toBe(form);
    game.restoreState(state);
    expect(game.stadium!.form).toBe(form);
    expect(game.content.stage.floors.map(f => f.id)).toEqual(content.stadium!.forms[form].floors.map(f => f.id));
    ticks(200);
    expect(game.stateHash()).toBe(hash);
    expect(game.stadium!.form).toBe(later);
  });
  it('reproduces the schedule exactly for equal seeds and diverges only by seed', () => {
    const other = new LocalMatch(content, rig, { opponent: 'human', countdown: 0, seed: 7 });
    other.start();
    for (let i = 0; i < 300; i++) { step(); other.step([neutralInput(), neutralInput()]); }
    expect(other.stateHash()).toBe(game.stateHash());
    expect(other.stadium!.form).toBe(game.stadium!.form);
  });
  it.each([2, 4])('reconciles late inputs across transformations in %i slots with events exactly once', count => {
    const selected = { ...rosterPlayers(base, Array.from({ length: count }, () => 'Fx' as const)), stadium: fast() };
    const ra = new GameRigs(selected), rb = new GameRigs(selected);
    try {
      const match = new LocalMatch(selected, ra, { opponent: 'human', countdown: 0, seed: 17 }), reference = new LocalMatch(selected, rb, { opponent: 'human', countdown: 0, seed: 17 }); match.start(); reference.start();
      const driver = new RollbackDriver(match, 0, count, { maxPrediction: 6, historyLimit: 32 }), pending: Array<{ due: number; frame: number; slot: number; input: PlayerInput }> = [];
      const expected: Array<{ frame: number; events: unknown }> = [], emitted: Array<{ frame: number; events: unknown }> = [];
      const input = (frame: number, slot: number) => normalizeInput({ ...neutralInput(), x: Math.sin(frame / 9 + slot) > 0 ? 1 : -1, attack: frame % 37 === slot });
      for (let tick = 0; tick < 400; tick++) {
        for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.due <= tick) { const p = pending.splice(i, 1)[0]!; driver.receive(p.frame, p.slot, p.input); }
        if (reference.frame < 200) { const frame = driver.frame, local = input(frame, 0); if (driver.advance(local)) { driver.receive(frame, 0, local); const inputs = Array.from({ length: count }, (_, slot) => input(frame, slot)); reference.step(inputs); expected.push({ frame, events: structuredClone(reference.events) }); for (let slot = 1; slot < count; slot++) pending.push({ due: tick + 1 + (frame + slot) % 4, frame, slot, input: inputs[slot]! }); } }
        emitted.push(...driver.drainConfirmedEvents().map(({ frame, events }) => ({ frame, events }))); if (reference.frame === 200 && pending.length === 0) break;
      }
      expect(driver.confirmedFrame).toBe(199);
      expect(reference.stadium!.lastVariant).not.toBeNull(); // the run crossed a transformation
      expect(match.stateHash()).toBe(reference.stateHash());
      expect(emitted).toEqual(expected);
      expect(driver.stats.rollbacks).toBeGreaterThan(0);
    } finally { ra.dispose(); rb.dispose(); }
  });
});
