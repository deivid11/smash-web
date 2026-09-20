import type { MatchEvent, MatchFighter } from './match.ts';
import type { Projectile } from './projectiles.ts';
import type { SonicSpringData } from './sonic-data.ts';
import type { GameContent } from './load.ts';
import { floorY } from './data.ts';

/** Sonic's spring (PlSn itFunction item 0). Idle: sits on the ground and bounces whoever lands
 * on it (Spring_JumpedOn), weaker each time. Fall: an airborne spring drops harmlessly.
 * Rebound: landing pops it up with its only scripted hit and it drops through the stage. */
export interface SonicSpringRuntime { phase: 'idle' | 'fall' | 'rebound'; bounce: number }
export type SonicSpringProjectile = Projectile & { sonicSpring: SonicSpringRuntime };

const f32 = Math.fround;
/** The spring's top sits where SpecialHi_Enter stands Sonic (cur_pos.y + 3.3); its footprint is
 * the port's stand-in for the item's jump-on collision box, which the ACE data does not expose. */
const SPRING_TOP = 3.3, SPRING_HALF_WIDTH = 4;
/** Fighter states that land on an item like on a floor (airborne, not being launched or held). */
const BOUNCEABLE = new Set(['fall', 'jump', 'airjump', 'helpless', 'attack', 'special']);

/** The spring article of whoever spawned it (Sonic's and Knuckles' carry identical data). */
export function sonicSpringData(owner: MatchFighter): SonicSpringData {
  const spring = owner.content.specials.articles.sonic?.spring;
  if (!spring) throw new Error(`${owner.content.profile.name} has no spring article.`);
  return spring;
}
/** Spawn_Spring + OnSpawn: at the owner's feet, Idle on the ground or Fall in the air. */
export function spawnSonicSpring(id: number, owner: MatchFighter, spring: SonicSpringData, at: [number, number], grounded: boolean): SonicSpringProjectile {
  return {
    id, kind: 'sonic-spring', owner: owner.slot, x: at[0], y: at[1], vx: 0, vy: 0, age: 0, life: Math.ceil(spring.lifetime),
    data: spring, hit: { ...spring.reboundHit! }, reflectionCooldown: 0, victims: new Set(), speed: 0,
    sonicSpring: { phase: grounded ? 'idle' : 'fall', bounce: spring.bounce },
  };
}
const supportUnder = (content: GameContent, x: number, y: number) => content.stage.floors.find((floor) =>
  x >= Math.min(floor.a[0], floor.b[0]) && x <= Math.max(floor.a[0], floor.b[0]) && Math.abs(floorY(floor, x) - y) < 0.5);

/** Advances one spring. Returns false once its lifetime ends. Idle and Fall move themselves and
 * never hit; Rebound only sets its velocity and leaves movement and the hit to the shared loop. */
export function advanceSonicSpring(item: SonicSpringProjectile, fighters: readonly MatchFighter[], content: GameContent, events: MatchEvent[]): boolean {
  const spring = item.data as SonicSpringData, state = item.sonicSpring;
  if (item.life <= 0) return false;
  if (state.phase === 'idle') {
    // Idle_Coll: no floor under it any more → Fall_Enter.
    if (!supportUnder(content, item.x, item.y)) { state.phase = 'fall'; return true; }
    item.vx = 0; item.vy = 0;
    // Spring_JumpedOn: a fighter coming down onto the spring enters JumpAerial at the spring's
    // current strength, which then drops by xC down to x8.
    const top = f32(item.y + SPRING_TOP);
    for (const fighter of fighters) {
      if (fighter.grounded || fighter.velocity.y > 0 || !BOUNCEABLE.has(fighter.state)) continue;
      if (Math.abs(fighter.x - item.x) > SPRING_HALF_WIDTH || fighter.y > top || fighter.y < item.y - 1) continue;
      fighter.special = null; fighter.attackName = null; fighter.smash = null; fighter.fastFall = false;
      fighter.state = 'airjump'; fighter.animation = 'JumpAerialF'; fighter.animationFrame = 0; fighter.animationRate = 1;
      fighter.stateFrame = 0; fighter.animationEpoch++;
      fighter.y = top;
      fighter.velocity = { x: fighter.velocity.x, y: state.bounce };
      state.bounce = Math.max(spring.minBounce, f32(state.bounce - spring.bounceDecay));
      events.push({ type: 'sound', player: item.owner, x: item.x, y: item.y, sound: 0x139b, volume: 127, pan: 64 });
    }
    return true;
  }
  if (state.phase === 'fall') {
    // Fall_Phys: the article's own gravity and cap; Fall_Coll lands it into Rebound_Enter.
    item.vy = Math.max(-spring.terminal, f32(item.vy - spring.gravity));
    const nextY = f32(item.y + item.vy);
    const landing = content.stage.floors.filter((floor) => item.x >= Math.min(floor.a[0], floor.b[0]) && item.x <= Math.max(floor.a[0], floor.b[0])
      && item.y >= floorY(floor, item.x) && nextY <= floorY(floor, item.x)).sort((a, b) => floorY(b, item.x) - floorY(a, item.x))[0];
    item.x = f32(item.x + item.vx);
    if (landing) {
      item.y = floorY(landing, item.x);
      // Rebound_Enter: pop up at x18 for x10 frames with the state's hit.
      state.phase = 'rebound'; item.vy = spring.reboundRise; item.life = Math.ceil(spring.reboundLife); item.victims.clear();
      return true;
    }
    item.y = nextY;
    return true;
  }
  // Rebound_Phys: plain article gravity; Rebound_Coll ignores the stage entirely.
  item.vy = Math.max(-spring.terminal, f32(item.vy - spring.gravity));
  return true;
}
