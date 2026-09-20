import type { MatchEvent, MatchFighter } from './match.ts';
import type { Projectile } from './projectiles.ts';
import type { GameContent } from './load.ts';
import { BSONIC_CODE, type BSonicSpringData } from './bsonic-data.ts';
import { bsonicSpringTouch } from './bsonic.ts';
import { floorY } from './data.ts';

/** Black Sonic's spring (PlSc itFunction item 0). `phase` is the item state: 'idle' is state 0
 * (a grounded spawn: falls onto the floor and waits to be stomped), 'fall' is state 1 (an
 * airborne spawn dropping with its hitbox), 'rebound' is state 1 after its floor bounce
 * (xDB0 = 1: popped up, collision off, dropping through the stage). The item's own velocity
 * lives here: the shared projectile loop only sweeps its hitbox between the positions. */
export interface BSonicSpringRuntime { phase: 'idle' | 'fall' | 'rebound'; vx: number; vy: number }
export type BSonicSpringProjectile = Projectile & { bsonicSpring: BSonicSpringRuntime };

const f32 = Math.fround;
/** Fighter states whose air collision runs the stomp test (ft_80081D0C → ft_80081A00). */
const STOMPING = new Set(['fall', 'jump', 'airjump', 'helpless', 'attack', 'special']);
/** The fighter side of the stomp segment is its ECB foot span; the port has no per-fighter ECB
 * width, so a fixed half width stands in for coll_data.ecb.left/right. */
const FOOT_HALF_WIDTH = 3;

export function bsonicSpringData(owner: MatchFighter): BSonicSpringData {
  const spring = owner.content.specials.articles.bsonic?.spring;
  if (!spring) throw new Error(`${owner.content.profile.name} has no Black Sonic spring.`);
  return spring;
}
/** M347_Anim → ptr_03678+8: spawned at the owner's position in state_var1's state (0 grounded
 * SpecialHi, 1 aerial), life x29cc; only a state-0 spawn sets xDD0 (the stomp flag). */
export function spawnBSonicSpring(id: number, owner: MatchFighter, at: [number, number], grounded: boolean): BSonicSpringProjectile {
  const spring = bsonicSpringData(owner);
  return {
    id, kind: 'bsonic-spring', owner: owner.slot, x: at[0], y: at[1], vx: 0, vy: 0, age: 0, life: Math.ceil(spring.lifetime),
    data: spring, hit: { ...spring.airHit! }, reflectionCooldown: 0, victims: new Set(), speed: 0,
    bsonicSpring: { phase: grounded ? 'idle' : 'fall', vx: 0, vy: 0 },
  };
}
/** it_80272860: gravity toward the article's x10, no further pull past x14 (no hard clamp). */
function gravity(state: BSonicSpringRuntime, spring: BSonicSpringData): void {
  if (state.vy >= 0 || -state.vy < spring.terminal) state.vy = f32(state.vy - spring.gravity);
}
/** The highest static floor the spring's bottom crossed between `fromY` and `toY` at `x`. */
function floorCrossed(content: GameContent, x: number, fromY: number, toY: number): number | null {
  let best: number | null = null;
  for (const floor of content.stage.floors) {
    if (x < Math.min(floor.a[0], floor.b[0]) || x > Math.max(floor.a[0], floor.b[0])) continue;
    const y = floorY(floor, x);
    if (fromY >= y && toY <= y && (best === null || y > best)) best = y;
  }
  return best;
}

/** One frame of the spring (item anim → phys → move → coll). Returns false when it is destroyed.
 * The shared loop has already aged it and removes it once its life runs out (S0/S1_Anim). */
export function advanceBSonicSpring(item: BSonicSpringProjectile, fighters: readonly MatchFighter[], content: GameContent, events: MatchEvent[]): boolean {
  const spring = item.data as BSonicSpringData, state = item.bsonicSpring, owner = fighters[item.owner];
  // The shared loop moves by vx/vy; this article moves itself, so it hands over a still item.
  item.vx = 0; item.vy = 0;
  if (state.phase === 'idle') {
    // S0_Anim: every grounded spring of an owner whose ft_var43 is cleared vanishes.
    if (!owner?.bsonic.spring) return false;
    // S0_Phys (it_80272860) + S0_Coll (it_8026E414, landing callback empty): drop onto a floor, stay.
    gravity(state, spring);
    const nextY = f32(item.y + state.vy), floor = floorCrossed(content, item.x, item.y, nextY);
    if (floor !== null) { item.y = floor; state.vy = 0; } else item.y = nextY;
    stomp(item, spring, fighters, events);
    return true;
  }
  if (state.phase === 'fall') {
    // S1_Phys: gravity; a velocity turned upward by the last floor bounce pops the spring up
    // (x0270 → life 60, x026C spin, x0264 rise) and ends its collision (xDB0 = 1).
    gravity(state, spring);
    if (state.vy > 0) {
      state.phase = 'rebound'; state.vy = 1; item.life = 60;
      item.y = f32(item.y + state.vy);
      return true;
    }
    // S1_Coll (it_8026E15C): a floor reflects the fall with the article's x58 bounce.
    const nextY = f32(item.y + state.vy), floor = floorCrossed(content, item.x, item.y, nextY);
    if (floor !== null) {
      item.y = floor; state.vy = f32(-state.vy * spring.bounce); state.vx = f32(state.vx * spring.bounce);
      events.push({ type: 'bounce', player: item.owner, x: item.x, y: item.y });
    } else item.y = nextY;
    return true;
  }
  // Rebound: S1_Phys keeps pulling it down; S1_Coll skips the stage entirely.
  gravity(state, spring);
  item.y = f32(item.y + state.vy);
  return true;
}

/** ft_80081A00 / it_80274D6C: an airborne fighter whose feet cross the spring's top line from
 * above this frame stomps it, and Item_80269B60 runs its jumped_on callback (ptr_03bf4). */
function stomp(item: BSonicSpringProjectile, spring: BSonicSpringData, fighters: readonly MatchFighter[], events: MatchEvent[]): void {
  const line = f32(item.y + spring.top);
  for (const fighter of fighters) {
    if (fighter.grounded || fighter.velocity.y >= 0 || !STOMPING.has(fighter.state)) continue;
    if (Math.abs(fighter.x - item.x) > spring.halfWidth + FOOT_HALF_WIDTH) continue;
    const before = f32(fighter.y - fighter.velocity.y - fighter.knockback.y);
    if (before < line || fighter.y > line) continue;
    // ptr_03bf4: the spring re-arms (state 0, life x29cc) and launches whoever landed on it.
    item.life = Math.ceil(spring.lifetime);
    if (fighter.content.profile.kind === 'Sc') {
      const sound = bsonicSpringTouch(fighter);
      if (sound !== null) events.push({ type: 'sound', player: fighter.slot, x: fighter.x, y: fighter.y, sound, volume: 127, pan: 64 });
      continue;
    }
    // Everyone else: the spring sound on the owner, JumpF (JumpB with the stick against the
    // facing) and self_vel.y += x29d0, one jump spent.
    events.push({ type: 'sound', player: item.owner, x: item.x, y: item.y, sound: BSONIC_CODE.sounds.spring, volume: 127, pan: 64 });
    const stick = fighter.previous.x, back = (stick < 0 && fighter.facing > 0) || (stick > 0 && fighter.facing < 0);
    fighter.special = null; fighter.attackName = null; fighter.smash = null; fighter.jab = null; fighter.fastFall = false;
    fighter.state = 'jump'; fighter.animation = back && fighter.content.clips.has('JumpB') ? 'JumpB' : 'JumpF';
    fighter.animationFrame = 0; fighter.animationRate = 1; fighter.stateFrame = 0; fighter.animationEpoch++;
    fighter.jumpsUsed = 1;
    fighter.velocity = { x: fighter.velocity.x, y: f32(fighter.velocity.y + BSONIC_CODE.spring.otherBounce) };
  }
}
