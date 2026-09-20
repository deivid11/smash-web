import type { Projectile } from './projectiles.ts';
import type { MatchFighter, MatchEvent } from './match.ts';
import { floorY, MAX_FLOOR_SLOPE } from './data.ts';
import type { GameContent } from './load.ts';
import type { V3 } from '../hsd/model.ts';

export interface PikachuProjectileRuntime {
  sourceOwner: number; serial: number; segment: number; delay: number; grounded: boolean;
  stopY: number | null; stopped: boolean; collapse: number; scale: number;
  anchorX: number; anchorY: number; waveFrame: number; facing: number;
}
export const pikachuProjectileCenter = (item: Projectile, x: number, y: number): V3 => item.kind === 'thunder'
  ? [x, Math.fround(y + item.hit.offset[1] * (item.pikachu?.scale ?? 1)), 0] : [x, y, 0];
/** The original first thunder article signals only the special which created it, never a new stock/cast. */
export function finishPikachuProjectile(item: Projectile, fighters: readonly MatchFighter[]): void {
  const r = item.pikachu;
  if (item.kind !== 'thunder' || !r || r.segment !== 0) return;
  const s = fighters[r.sourceOwner]?.special;
  if (s?.direction === 'down' && s.serial === r.serial && s.pikachu) s.pikachu.thunderDone = true;
}
/** Horizontal-floor subset of the native linked thunder / ground-jolt articles.
 * Ground arcs use original joint-6 FK; walls and ceiling wrapping remain unported. */
export function stepPikachuProjectile(item: Projectile, previousY: number, content: GameContent, fighters: readonly MatchFighter[], siblings: readonly Projectile[], events: MatchEvent[]): boolean {
  const r = item.pikachu!;
  const ownerFighter = fighters[r.sourceOwner];
  const ownerArticles = ownerFighter?.content.specials.articles.pikachu ?? content.roster.get('Pk')!.specials.articles.pikachu!;
  if (item.kind === 'tjolt') {
    if (r.grounded) {
      const path = ownerArticles.groundPath;
      r.waveFrame=Math.min(r.waveFrame+1,path.length-1);const point=path[r.waveFrame]!;
      item.x=Math.fround(r.anchorX+point[2]*r.facing);item.y=Math.fround(r.anchorY+point[1]);
      const support=content.stage.floors.find(f=>Math.abs(floorY(f,item.x)-r.anchorY)<Math.abs(item.x-r.anchorX)*MAX_FLOOR_SLOPE+0.01&&item.x>=Math.min(f.a[0],f.b[0])&&item.x<=Math.max(f.a[0],f.b[0]));
      if(!support)return false;
      if(item.y<=r.anchorY || r.waveFrame===path.length-1){r.anchorX=item.x;r.waveFrame=0;r.anchorY=floorY(support,item.x);item.y=r.anchorY;events.push({type:'sound',player:item.owner,x:item.x,y:item.y,sound:240079});}
      return true;
    }
    const floor = content.stage.floors.filter(f => item.x >= Math.min(f.a[0], f.b[0]) && item.x <= Math.max(f.a[0], f.b[0]) && (r.grounded ? Math.abs(item.y - floorY(f, item.x)) < 0.01 : previousY >= floorY(f, item.x) && item.y <= floorY(f, item.x))).sort((a,b) => floorY(b, item.x) - floorY(a, item.x))[0];
    if (r.grounded && !floor) return false;
    if (floor && !r.grounded) {
      const ground = ownerArticles.groundJolt;
      if (!ground.hit) throw new Error('Missing original ground-jolt hit.');
      const damageScale = item.hit.damage / item.data.hit!.damage;
      item.data = ground; item.hit = { ...ground.hit, damage: Math.fround(ground.hit.damage * damageScale) };
      item.y = floorY(floor, item.x); item.vy = 0; item.vx = Math.fround(Math.sign(item.vx) * item.speed); r.grounded = true;
      r.anchorX=item.x;r.anchorY=item.y;r.waveFrame=0;r.facing=Math.sign(item.vx)||1;
      events.push({ type: 'sound', player: item.owner, x: item.x, y: item.y, sound: 240079 });
    }
    return true;
  }
  const ownerParams = ownerFighter?.content.specials.parameters;
  const resources = ownerArticles, parameters = (ownerParams?.kind === 'Pk' || ownerParams?.kind === 'Pc' || ownerParams?.kind === 'Rc') ? ownerParams : content.roster.get('Pk')!.specials.parameters;
  if (parameters.kind !== 'Pk' && parameters.kind !== 'Pc' && parameters.kind !== 'Rc') throw new Error('Missing original thunder parameters.');
  const owner = fighters[r.sourceOwner], s = owner?.special;
  if (r.stopY !== null && (r.stopped || item.y <= r.stopY)) {
    item.y = r.stopY; item.vy = 0; r.stopped = true;
    r.collapse++; r.scale = Math.max(0.01, 1 + r.collapse * parameters.down.speed / resources.thunderLength);
    return r.collapse < Math.ceil(resources.thunderLength / -parameters.down.speed);
  }
  const tip = item.y - resources.thunderTip;
  let stop: number | null = null;
  if (r.segment === 0) {
    if (owner && s?.direction === 'down' && s.serial === r.serial && s.pikachu && Math.abs(owner.x - item.x) < Math.abs(parameters.down.contactX) && Math.abs(owner.y + Math.abs(parameters.down.contactY) - tip) < parameters.down.contactHeight) {
      s.pikachu.thunderHit = true; stop = item.y;
    } else {
      const floor = content.stage.floors.filter(f => previousY - resources.thunderTip >= floorY(f, item.x) && tip <= floorY(f, item.x) && item.x >= Math.min(f.a[0], f.b[0]) && item.x <= Math.max(f.a[0], f.b[0])).sort((a,b) => floorY(b, item.x) - floorY(a, item.x))[0];
      if (floor) stop = floorY(floor, item.x) + resources.thunderTip;
    }
    if (stop !== null) for (const sibling of siblings) if (sibling.pikachu?.sourceOwner === r.sourceOwner && sibling.pikachu.serial === r.serial && sibling.kind === 'thunder') {
      // Later segments keep falling until reaching the first segment's stop point.
      sibling.pikachu.stopY = stop;
      if (sibling === item) { sibling.pikachu.stopped = true; sibling.y = stop; sibling.vy = 0; }
    }
  }
  return true;
}
