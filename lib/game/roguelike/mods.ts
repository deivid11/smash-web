/** Pure roguelike math + build summaries. No simulation access, so unit tests
 * in `tests/unit/roguelike-mods.test.ts` cover the numbers the prototype glue
 * in `lib/game/match.ts` applies. */
import type { BoonState } from './boons.ts';
import { NEUTRAL_ROGUE_MODS } from './sim.ts';

const f32 = Math.fround;

/** Final damage coupling: attacker boons × victim softness, like a natively
 * stronger/weaker move. Neutral (1 × 1) returns the base untouched. */
export function scaledDamage(base: number, dealtMul: number, takenMul: number): number {
  const mul = dealtMul * takenMul;
  if (!(mul > 0) || !Number.isFinite(mul)) throw new Error('Invalid prototype damage multiplier.');
  return mul === 1 ? base : f32(base * mul);
}

const percent = (mul: number): string => `${mul >= 1 ? '+' : '−'}${Math.abs(Math.round((mul - 1) * 100))}%`;

export interface BuildStat {
  /** Stable key for styling/tests. */
  key: string;
  label: string;
  value: string;
  /** `good` for the player, `bad` for costs. */
  tone: 'good' | 'bad';
}

/** Every non-neutral number of a build as labeled stats (pause build screen). */
export function buildStats(state: BoonState, es = false): BuildStat[] {
  const p = state.player;
  const n = NEUTRAL_ROGUE_MODS;
  const stats: BuildStat[] = [];
  const add = (key: string, en: string, spanish: string, value: string, tone: 'good' | 'bad' = 'good'): void => {
    stats.push({ key, label: es ? spanish : en, value, tone });
  };
  if (p.damageDealtMul !== n.damageDealtMul) add('dmg', 'Damage', 'Daño', percent(p.damageDealtMul));
  if (p.damageTakenMul !== n.damageTakenMul) add('taken', 'Damage taken', 'Daño recibido', percent(p.damageTakenMul), p.damageTakenMul > 1 ? 'bad' : 'good');
  if (p.knockbackMul !== n.knockbackMul) add('launch', 'Launch power', 'Poder de lanzamiento', percent(p.knockbackMul));
  if (p.knockbackTakenMul !== n.knockbackTakenMul) add('weight', 'Launch taken', 'Lanzamiento recibido', percent(p.knockbackTakenMul));
  if (p.speedMul !== n.speedMul) add('speed', 'Stick speed', 'Velocidad', percent(p.speedMul), p.speedMul < 1 ? 'bad' : 'good');
  if (p.critChance > 0) add('crit', 'Crit chance', 'Prob. crítico', `${Math.round(p.critChance * 100)}% ×${p.critMul.toFixed(1).replace(/\.0$/, '')}`);
  if (p.airCritChance > 0) add('air-crit', 'Air crit bonus', 'Crítico aéreo', `+${Math.round(p.airCritChance * 100)}%`);
  if (p.chainDamage > 0) add('arc', 'Arc spark', 'Arco eléctrico', `${Math.round(p.chainDamage)}% · ${Math.round(p.chainRange)}u`);
  if (p.venomTicks > 0) add('burn', 'Burn', 'Quemadura', `${Math.round(p.venomTicks / 60)}s`);
  if (p.doomDamage > 0 || p.critDoom) add('doom', 'Doom burst', 'Condena', `${Math.round(Math.max(p.doomDamage, p.critDoom ? 6 : 0))}%`);
  if (p.weakTicks > 0) add('jolt', 'Jolt (foe damage)', 'Descarga (daño rival)', percent(p.weakMul));
  if (p.chillTicks > 0) add('slow', 'Undertow (foe speed)', 'Contracorriente (vel. rival)', percent(p.chillMul));
  if (p.thorns > 0) add('thorns', 'Thorns', 'Espinas', `${Math.round(p.thorns)}%`);
  if (p.leech > 0) add('leech', 'Leech', 'Sanguijuela', `${Math.round(p.leech * 100)}%`);
  if (p.lifesteal > 0) add('feast', 'Heal on KO', 'Cura por KO', `${Math.round(p.lifesteal)}%`);
  if (p.rage > 0) add('rage', 'Blood rage', 'Furia de sangre', `+${Math.round(p.rage * 100)}%/50% (max ${Math.round(p.rageCap * 100)}%)`);
  if (p.executeMul !== 1) add('execute', 'Vs 100%+', 'Contra 100%+', percent(p.executeMul));
  if (p.executeKnockbackMul !== 1) add('breaker', 'Launch vs 100%+', 'Lanzam. vs 100%+', percent(p.executeKnockbackMul));
  if (p.openerMul !== 1) add('opener', 'Vs 0% foes', 'Contra 0%', percent(p.openerMul));
  if (p.burnBonusMul !== 1) add('wildfire', 'Vs burning foes', 'Contra quemados', percent(p.burnBonusMul));
  if (p.retaliateMul !== 1) add('retaliate', 'Retaliate hit', 'Represalia', percent(p.retaliateMul));
  if (p.koBlast > 0) add('clap', 'Thunderclap', 'Trueno', `${Math.round(p.koBlast)}%`);
  if (p.lastStand > 0) add('stand', 'Last Stand / floor', 'Última resistencia / piso', `✝×${p.lastStand}`);
  if (p.extraJumps > 0) add('jumps', 'Extra jumps', 'Saltos extra', `+${p.extraJumps}`);
  if (state.bonusStocks > 0) add('stocks', 'Match stocks', 'Vidas de combate', `+${state.bonusStocks}`);
  if (state.coinsPerKo > 0) add('toll', 'Coins per KO', 'Monedas por KO', `+${state.coinsPerKo}`);
  if (state.clockBonus > 0) add('clock', 'Floor clock', 'Reloj', `+${state.clockBonus}s`);
  if (state.scorePerFloor > 0) add('score', 'Score per floor', 'Puntos por piso', `+${state.scorePerFloor}`);
  if (state.enemyStartPercent > 0) add('warmup', 'Rivals start at', 'Rivales empiezan', `+${state.enemyStartPercent}%`);
  if (state.levelShift < 0) add('underdog', 'Rival levels', 'Nivel rival', `${state.levelShift}`);
  if (state.playerStartPercent > 0) add('start', 'You start at', 'Empiezas con', `+${state.playerStartPercent}%`, 'bad');
  if (state.enemyDamageMul !== 1) add('foe-dmg', 'Rival damage', 'Daño rival', percent(state.enemyDamageMul), 'bad');
  if (state.enemySpeedMul !== 1) add('foe-spd', 'Rival speed', 'Velocidad rival', percent(state.enemySpeedMul), 'bad');
  return stats;
}

/** Short build tags for compact strips, e.g. `DMG +25% · CRIT 16%`. */
export function describeBuild(state: BoonState, es = false): string[] {
  return buildStats(state, es).slice(0, 8).map((stat) => `${stat.label.toUpperCase()} ${stat.value}`);
}
