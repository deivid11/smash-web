import { describe, expect, it } from 'vitest';
import { NEUTRAL_ROGUE_MODS } from '../../lib/game/match.ts';
import { applyFloorToMatch, floorSetupFor, type MatchLike } from '../../lib/game/roguelike/apply.ts';
import { combatFloors, generateRun, type FloorPlan } from '../../lib/game/roguelike/generator.ts';
import { computeBoonState, emptyBoonState } from '../../lib/game/roguelike/boons.ts';
import type { PendingFight } from '../../lib/game/roguelike/run-state.ts';
import type { StageGameplayData } from '../../lib/game/data.ts';

const baseStage = (): StageGameplayData => ({
  scale: 1,
  floors: [
    { id: 0, a: [-40, 0], b: [40, 0], oneWay: false },
    { id: 1, a: [-20, 12], b: [-5, 12], oneWay: true },
    { id: 2, a: [5, 12], b: [20, 12], oneWay: true },
  ],
  blast: { left: -100, right: 100, top: 80, bottom: -60 },
  spawns: [[-10, 1, 0], [10, 1, 0]],
  mainLeft: -40,
  mainRight: 40,
  ledges: [],
});

const fakeMatch = (fighters: number): MatchLike => ({
  fighters: Array.from({ length: fighters }, () => ({ stocks: 3, percent: 0, rogue: { ...NEUTRAL_ROGUE_MODS }, poison: null, hex: null })),
  content: { stage: baseStage() },
});

const firstBattle = (seed: string): FloorPlan => combatFloors(generateRun(seed)).find((floor) => floor.kind === 'battle' && !floor.modifier)!;

describe('floor setup application (legal setup ranges only)', () => {
  it('maps a floor to seats, rules and neutral mods', () => {
    const floor = firstBattle('RIFT-APPLY');
    const setup = floorSetupFor(floor, emptyBoonState(), 'Mr');
    expect(setup.seats).toHaveLength(8);
    expect(setup.seats[0]).toMatchObject({ fighter: 'Mr', control: 'human' });
    expect(setup.seats.filter((seat) => seat.control === 'cpu')).toHaveLength(floor.enemies.length);
    expect(setup.stocks).toBe(floor.playerStocks);
    expect(setup.playerMods).toEqual(NEUTRAL_ROGUE_MODS);
    expect(setup.enemyMods.damageDealtMul).toBeCloseTo(floor.foeDamage, 9);
    expect(setup.floorStands).toBe(0);
  });

  it('applies boons, stands and handicaps post-start', () => {
    const floor = { ...firstBattle('RIFT-APPLY2'), handicap: 40, rift: false };
    const boons = computeBoonState([
      { id: 'ember-fury', rarity: 'common', level: 1 },
      { id: 'ember-brand', rarity: 'common', level: 1 },
      { id: 'rift-stock', rarity: 'rare', level: 1 },
      { id: 'rift-warmup', rarity: 'common', level: 1 },
      { id: 'aegis-defiance', rarity: 'rare', level: 1 },
    ]);
    const setup = floorSetupFor(floor, boons, 'Fx', { defiances: 2 });
    const match = fakeMatch(3);
    match.fighters[1]!.hex = { doomTicks: 5, doomAmount: 3, doomBy: 0, weakTicks: 0, weakMul: 1, chillTicks: 0, chillMul: 1, retaliateTicks: 0 };
    applyFloorToMatch(match, setup, floor);
    expect(match.fighters[0]!.stocks).toBe(floor.playerStocks + 1);
    expect(match.fighters[1]!.stocks).toBe(floor.playerStocks);
    expect(match.fighters[1]!.percent).toBe(52);
    expect(match.fighters[2]!.percent).toBe(52);
    expect(match.fighters[0]!.percent).toBe(0);
    expect(match.fighters[0]!.rogue.damageDealtMul).toBeCloseTo(1.1, 6);
    expect(match.fighters[0]!.rogue.venomTicks).toBe(360);
    expect(match.fighters[0]!.rogue.lastStand).toBe(3);
    expect(setup.floorStands).toBe(1);
    expect(match.fighters[1]!.hex).toBeNull();
    expect(() => applyFloorToMatch(fakeMatch(1), setup, floor)).toThrow();
  });

  it('allies rivals on team floors, keeps free-for-alls apart and fields ACE rivals or stand-ins', () => {
    const base = firstBattle('RIFT-APPLY');
    const enemies: FloorPlan['enemies'] = [{ fighter: 'Sn', level: 3, fallback: 'Fx' }, { fighter: 'Mr', level: 3 }];
    const team = floorSetupFor({ ...base, enemies, format: 'team', modifier: null }, emptyBoonState(), 'Kb', { available: () => true });
    expect(team.foes.map((foe) => foe.fighter)).toEqual(['Sn', 'Mr']);
    expect(team.foeMods.map((mods) => mods.team)).toEqual([2, 2]);
    expect(team.playerMods.team).toBe(0);
    const match = fakeMatch(3);
    applyFloorToMatch(match, team, { ...base, enemies, format: 'team', modifier: null });
    expect(match.fighters.map((fighter) => fighter.rogue.team)).toEqual([0, 2, 2]);
    const ffa = floorSetupFor({ ...base, enemies, format: 'ffa', modifier: null }, emptyBoonState(), 'Kb', { available: (kind) => kind !== 'Sn' });
    expect(ffa.foeMods.map((mods) => mods.team)).toEqual([0, 0]);
    expect(ffa.foes[0]).toMatchObject({ fighter: 'Fx', substituted: true, giga: false });
    // Only a missing Giga Bowser gets the heavy stand-in boost.
    expect(ffa.foeMods[0]!.damageTakenMul).toBeCloseTo(ffa.foeMods[1]!.damageTakenMul, 9);
  });

  it('fields boosted bosses with their own stocks and falls back without the ACE disc', () => {
    const plan = generateRun('RIFT-GIGA');
    const giga = plan.map[39]![0]!.floor!;
    const withAce = floorSetupFor(giga, emptyBoonState(), 'Fx', { available: () => true });
    expect(withAce.seats.filter((seat) => seat.control === 'cpu').map((seat) => seat.fighter)).toEqual(['Gk']);
    expect(withAce.foeStocks).toEqual([4]);
    expect(withAce.foes[0]).toMatchObject({ fighter: 'Gk', boss: true, giga: true, substituted: false });
    expect(withAce.foeMods[0]!.damageDealtMul).toBeCloseTo(giga.foeDamage * 1.6 * (withAce.affixes.includes('enraged') ? 1.25 : 1) * (withAce.affixes.includes('infernal') ? 1.15 : 1), 5);
    expect(withAce.foeMods[0]!.lastStand).toBeGreaterThanOrEqual(1);
    expect(withAce.enemyMods.damageTakenMul).toBeLessThan(1);
    const noAce = floorSetupFor(giga, emptyBoonState(), 'Fx', { available: (kind) => kind !== 'Gk' });
    expect(noAce.seats.filter((seat) => seat.control === 'cpu').map((seat) => seat.fighter)).toEqual(['Kp']);
    expect(noAce.foes[0]!.substituted).toBe(true);
    expect(noAce.foeMods[0]!.damageTakenMul).toBeLessThan(withAce.foeMods[0]!.damageTakenMul);
    const match = fakeMatch(2);
    applyFloorToMatch(match, noAce, giga);
    expect(match.fighters[1]!.stocks).toBe(4);
    expect(match.fighters[1]!.rogue.damageDealtMul).toBeCloseTo(noAce.foeMods[0]!.damageDealtMul, 6);
    const crowned = floorSetupFor(giga, emptyBoonState(), 'Fx', { bonusStocks: 1 });
    expect(crowned.stocks).toBe(giga.playerStocks + 1);
  });

  it('hands pact costs and event curses to the foe side', () => {
    const floor = firstBattle('RIFT-PACT');
    const boons = computeBoonState([{ id: 'chaos-frenzy', rarity: 'common', level: 1 }, { id: 'rift-underdog', rarity: 'rare', level: 1 }]);
    const pending: PendingFight[] = [
      { source: 'trophy', fights: 1, levelShift: 1, affixes: ['enraged'], mirror: false, rewardBump: false, scoreBonus: 0 },
      { source: 'echo', fights: 1, levelShift: 0, affixes: [], mirror: true, rewardBump: true, scoreBonus: 200 },
    ];
    const setup = floorSetupFor(floor, boons, 'Pk', { pending });
    expect(setup.enemyMods.damageDealtMul).toBeCloseTo(floor.foeDamage * 1.15 * 1.25, 6);
    expect(setup.enemyMods.speedMul).toBeCloseTo(1.08 * floor.foeSpeedMul, 6);
    expect(setup.affixes).toContain('enraged');
    const cpus = setup.seats.filter((seat) => seat.control === 'cpu');
    expect(cpus).toHaveLength(floor.enemies.length + 1);
    expect(cpus.at(-1)!.fighter).toBe('Pk');
    // Underdog (−1) and the trophy curse (+1) cancel out.
    expect(cpus[0]!.level).toBe(floor.enemies[0]!.level);
  });
});
