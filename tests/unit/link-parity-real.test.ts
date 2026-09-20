import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import { LocalMatch, neutralInput, type PlayerInput } from '../../lib/game/match.ts';
import { rosterPair } from '../../lib/game/roster.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { linkHitLanded, linkHits } from '../../lib/game/link.ts';
import { activeHits } from '../../lib/game/moves.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Link original-source parity regressions', () => {
  let base: GameContent, rig: GameRigs, game: LocalMatch;
  const f = () => game.fighters[0];
  const make = (kind: 'Lk' | 'Cl' = 'Lk', gap = 80, rival: 'Mr' | 'Fx' = 'Mr') => {
    rig?.dispose(); const content = rosterPair(base, kind, rival); rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 }); game.start();
    game.fighters.forEach((fighter, slot) => {
      fighter.x = (slot ? 1 : -1) * gap / 2; fighter.y = 0; fighter.grounded = true;
      fighter.floor = content.stage.floors.find(floor => !floor.oneWay)!.id; rig.sample(fighter);
    });
  };
  const step = (input: Partial<PlayerInput> = {}, other: Partial<PlayerInput> = {}) => game.step([{ ...neutralInput(), ...input }, { ...neutralInput(), ...other }]);
  const ticks = (count: number, input: Partial<PlayerInput> = {}) => { for (let i = 0; i < count; i++) step(input); };
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try { base = await loadGameContent(new HsdAssetSession(disc, await verifyMeleeDisc(disc)), new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final'); }
    finally { await disc.close(); }
  }, 30000);
  afterEach(() => rig?.dispose());

  it.each(['Lk', 'Cl'] as const)('%s is hurt by its own bomb explosion, not by the held bomb', kind => {
    make(kind); const bomb = game.projectiles.spawn(f(), 'link-bomb', rig);
    ticks(4); expect(f().percent).toBe(0);
    bomb.life = 1; ticks(3);
    expect(bomb.link?.phase).toBe('explosion'); expect(f().link.bomb).toBeNull();
    expect(f().percent).toBe(kind === 'Lk' ? 4 : 2); expect(f().hitstun).toBeGreaterThan(0);
  });
  it('does not destroy an active bomb blast when an opponent shields it', () => {
    make(); const victim = game.fighters[1]; victim.x = 0; rig.sample(victim);
    const bomb = game.projectiles.spawn(f(), 'link-bomb', rig);
    f().link.bomb = null; bomb.link!.phase = 'flight'; bomb.x = 0; bomb.y = 9; bomb.life = 1;
    const shield = victim.combat.shield;
    step({}, { shield: true });
    expect(victim.combat.shield).toBeLessThan(shield); expect(victim.percent).toBe(0);
    expect(game.projectiles.items).toContain(bomb); expect(bomb.link?.phase).toBe('explosion');
    ticks(12); expect(bomb.link?.active).toBe(false); expect(bomb.life).toBe(68);
    ticks(68); expect(game.projectiles.items).not.toContain(bomb);
  });
  it.each(['Lk', 'Cl'] as const)('%s throws a held bomb with a normal attack instead of swinging its sword', kind => {
    make(kind); const bomb = game.projectiles.spawn(f(), 'link-bomb', rig);
    step({ attack: true }); expect(f().animation).toBe('LightThrowF');
    ticks(6); expect(bomb.link?.phase).toBe('held');
    step(); expect(bomb.link?.phase).toBe('flight'); expect(f().link.bomb).toBeNull(); expect(bomb.vx).toBeGreaterThan(0);
  });
  it.each([false, true])('uses the original backward-throw turn and release flags (air=%s)', airborne => {
    make(); f().facing = 1;
    if (airborne) { f().grounded=false; f().floor=null; f().state='fall'; f().animation='Fall'; f().y=80; }
    rig.sample(f()); const bomb=game.projectiles.spawn(f(),'link-bomb',rig);
    f().previous.x=-0.6; f().link.sideTicks=254; // Settled stick selects ordinary, not smash-air, throw.
    step({ attack:true, x:-0.6 }); expect(f().animation).toBe(airborne?'LightThrowAirB':'LightThrowB');
    const turn=airborne?5:3, release=airborne?6:7;
    ticks(turn-1); expect(f().facing).toBe(1); step();
    expect(f().facing).toBe(-1); expect(bomb.link?.phase).toBe('held');
    ticks(release-turn); expect(bomb.link?.phase).toBe('flight'); expect(bomb.vx).toBeLessThan(0);
  });
  it('replays held-bomb throw state and expiration deterministically', () => {
    make(); const bomb=game.projectiles.spawn(f(),'link-bomb',rig); bomb.life=12;
    step({ attack:true }); ticks(3); const state=game.captureState();
    ticks(20); const hash=game.stateHash();
    game.restoreState(state); ticks(20); expect(game.stateHash()).toBe(hash);
  });
  it.each(['Lk', 'Cl'] as const)('%s truncates arrow damage at the native u32 boundary and preserves article data', kind => {
    make(kind); const original=f().content.specials.articles.projectile!.hit!.damage;
    const arrow=game.projectiles.spawn(f(),'arrow',rig,false,0,{player:0,kind:'arrow',charge:0.5});
    expect(arrow.hit.damage).toBe(11); expect(f().content.specials.articles.projectile!.hit!.damage).toBe(original);
  });
  it.each([['Lk',60],['Cl',55]] as const)('%s expires flying arrows after the native %i ticks, not ground-stick lifetime', (kind, lifetime) => {
    make(kind); const arrow=game.projectiles.spawn(f(),'arrow',rig); arrow.y=150;
    expect(arrow.life).toBe(lifetime); ticks(lifetime-1); expect(game.projectiles.items).toContain(arrow);
    step(); expect(game.projectiles.items).not.toContain(arrow);
  });
  it.each(['Lk','Cl'] as const)('%s keeps the early, late and return boomerang hits separate', kind => {
    make(kind); const articles=f().content.specials.articles.link!;
    expect([articles.boomerang.hit!.damage,articles.lateBoomerang.hit!.damage,articles.returning.hit!.damage]).toEqual(kind==='Lk'?[8,6,3]:[11,7,2]);
    const item=game.projectiles.spawn(f(),'boomerang',rig), saved=game.captureState();
    ticks(2); expect(item.data).toBe(articles.boomerang);
    step(); expect(item.data).toBe(articles.lateBoomerang); const hash=game.stateHash();
    game.restoreState(saved); ticks(3); expect(game.stateHash()).toBe(hash);
    expect(game.projectiles.items[0]!.data).toBe(articles.lateBoomerang);
  });
  it.each(['Lk','Cl'] as const)('%s deals the outgoing boomerang hit before changing to return damage', kind => {
    make(kind); const victim=game.fighters[1],item=game.projectiles.spawn(f(),'boomerang',rig);
    item.x=victim.x;item.y=victim.y+9;
    step(); expect(victim.percent).toBe(kind==='Lk'?8:11);
    expect(item.link?.phase).toBe('return');expect(item.hit.damage).toBe(kind==='Lk'?3:2);
    expect(item.link!.turnAngle).toBeCloseTo((kind==='Lk'?1.5:2)*Math.PI/180);
  });
  it('reverses natural boomerang return immediately and only accelerates on the next tick', () => {
    make(); const item=game.projectiles.spawn(f(),'boomerang',rig);
    item.x=30;item.y=9.67;item.speed=0.31;item.vx=0.31;item.vy=0;item.link!.angle=0;
    step();expect(item.link?.phase).toBe('return');expect(item.vx).toBeCloseTo(-0.3,5);expect(item.speed).toBeCloseTo(0.3,5);
    expect(item.link!.homing).toBe(140);step();expect(item.speed).toBeCloseTo(0.347,5);expect(item.link!.homing).toBe(139);
    expect(item.link!.turnAngle).toBeCloseTo(0.75*Math.PI/180);
  });
  it.each([['Lk',false,70],['Lk',true,85],['Cl',false,70],['Cl',true,90]] as const)('%s reflected boomerang uses saved launch half-life (smash=%s)', (kind, fast, life) => {
    make(kind,80,'Fx'); const reflector=game.fighters[1];step({}, {special:true,specialDirection:'down'});
    const item=game.projectiles.spawn(f(),'boomerang',rig,false,0,{player:0,kind:'boomerang',fast});
    item.x=reflector.x+2;item.y=reflector.y+6;item.age=12;item.life-=12;
    step();expect(item.link!.reflected).toBe(true);expect(item.owner).toBe(1);expect(f().link.boomerang).toBeNull();expect(item.life).toBe(life);
    expect(item.vx).toBeGreaterThan(0);expect(item.vy).toBeGreaterThan(0);
    const speed=item.speed,saved=game.captureState();ticks(4);expect(item.speed).toBe(speed);expect(item.life).toBe(life-4);
    const hash=game.stateHash();game.restoreState(saved);ticks(4);expect(game.stateHash()).toBe(hash);
    const replacement=game.projectiles.spawn(f(),'boomerang',rig);expect(f().link.boomerang).toBe(replacement.id);expect(game.projectiles.items).toHaveLength(2);
  });
  it.each([-10,-50])('handles a %i degree downward boomerang floor incidence', angle => {
    make();const item=game.projectiles.spawn(f(),'boomerang',rig,false,0,{player:0,kind:'boomerang',aim:angle*Math.PI/180});
    item.x=0;item.y=0.01;step();
    expect(item.link?.phase).toBe(angle===-10?'flight':'return');expect(item.vy).toBeGreaterThan(0);
  });
  it('distinguishes a real close boomerang catch from lifetime expiration', () => {
    make();const item=game.projectiles.spawn(f(),'boomerang',rig);
    item.link!.phase='return';item.x=f().x+1;item.y=f().y+9.67;item.speed=0.3;item.life=100;
    step();expect(item.life).toBe(99);expect(item.link?.phase).toBe('caught');expect(f().animation).toBe('SpecialS2');
    for(let i=0;i<20&&game.projectiles.items.includes(item);i++)step();
    expect(game.projectiles.items).not.toContain(item);expect(f().link.boomerang).toBeNull();
  });
  it.each([3,4,5,6])('uses the native six-frame boomerang smash window at flick age %i', age => {
    make();ticks(age,{x:1});step({x:1,special:true,specialDirection:'side'});
    expect(f().special?.link?.fast).toBe(age<6);
  });
  it.each(['Lk','Cl'] as const)('%s promotes completed bow startup to full charge before same-tick release', kind => {
    make(kind);step({special:true,specialDirection:'neutral'});
    const p=f().content.specials.parameters;if(p.kind!=='Lk'&&p.kind!=='Cl')throw Error('Link parameters');
    f().animationFrame=f().content.clips.get(f().animation)!.endFrame;f().special!.link!.charge=p.neutral.chargeFrames-18;f().special!.link!.chargeEnabled=true;
    step();expect(f().special!.link!.charge).toBe(p.neutral.chargeFrames);expect(f().special?.phase).toBe('end');
    for(let i=0;i<10&&game.projectiles.items.length===0;i++)step();
    expect(game.projectiles.items[0]!.hit.damage).toBe(p.arrow.maxDamage);
  });
  it('preserves aerial Spin Attack momentum using native D344 friction', () => {
    make();f().grounded=false;f().floor=null;f().state='fall';f().animation='Fall';f().y=80;f().velocity.x=1;
    const p=f().content.specials.parameters;if(p.kind!=='Lk')throw Error('Link parameters');
    step({special:true,specialDirection:'up'});
    expect(f().velocity.x).toBeCloseTo(1*p.up.momentum-f().content.profile.attributes.airFriction,6);
    expect(f().velocity.y).toBeCloseTo(p.up.lift-f().content.profile.attributes.gravity*p.up.gravity,6);
  });
  it('keeps a ground Spin Attack that leaves the edge on its entry tick and consumes both jumps', () => {
    make();f().x=base.stage.mainRight-0.1;f().velocity.x=2;rig.sample(f());
    step({special:true,specialDirection:'up'});
    expect(f().grounded).toBe(false);expect(f().special?.direction).toBe('up');expect(f().animation).toBe('SpecialAirHi');expect(f().jumpsUsed).toBe(2);
    expect(f().velocity.y).toBe(0); // Crossing the edge is not a fresh aerial launch.
  });
  it('clears fast fall and suppresses down-air hits for the native rearm delay, including hitlag', () => {
    make();f().grounded=false;f().floor=null;f().state='attack';f().animation=f().content.moves.downAir;f().attackName=f().animation;f().animationFrame=20;f().y=120;f().fastFall=true;f().velocity.y=-3;
    linkHitLanded(f());expect(f().fastFall).toBe(false);expect(f().link.dairTimer).toBe(30);
    const hits=()=>linkHits(f(),activeHits(f().content.attacks.get(f().animation)!,f().animationFrame));
    expect(hits()).toEqual([]);step();expect(f().velocity.y).toBeGreaterThan(0);expect(f().link.dairTimer).toBe(29);
    f().hitlag=5;ticks(5);expect(f().link.dairTimer).toBe(29);ticks(29);
    expect(f().link.dairTimer).toBe(0);expect(hits().map(hit=>hit.damage)).toEqual([6,8,8]);
    const saved=game.captureState();ticks(3);const hash=game.stateHash();game.restoreState(saved);ticks(3);expect(game.stateHash()).toBe(hash);
  });
  it('rearms cached down-air hitboxes even after the ordinary frame-65 script clear', () => {
    make();f().grounded=false;f().floor=null;f().state='attack';f().animation=f().content.moves.downAir;f().attackName=f().animation;f().animationFrame=50;f().y=120;
    linkHitLanded(f());ticks(30);
    const scripted=activeHits(f().content.attacks.get(f().animation)!,f().animationFrame);
    expect(f().animationFrame).toBe(80);expect(scripted).toEqual([]);
    expect(linkHits(f(),scripted).map(hit=>hit.damage)).toEqual([6,8,8]);
  });
  it('rewinds a late down-air rebound to native end90 minus delay30, then resets on a new aerial', () => {
    make();f().grounded=false;f().floor=null;f().state='attack';f().animation=f().content.moves.downAir;f().attackName=f().animation;f().animationFrame=64;f().y=120;
    expect(f().content.clips.get(f().animation)!.endFrame).toBe(90);linkHitLanded(f());expect(f().animationFrame).toBe(60);
    f().state='fall';f().animation='Fall';step({attack:true,down:true});
    expect(f().animation).toBe('AttackAirLw');expect(f().link.dairTimer).toBe(0);expect(f().link.dairDisabled).toBe(false);
  });
  it.each(['Lk', 'Cl'] as const)('%s uses the native forward smash-throw when down-B is pressed with a bomb held', kind => {
    make(kind); const bomb = game.projectiles.spawn(f(), 'link-bomb', rig);
    step({ special: true, specialDirection: 'down', y: -1 });
    expect(f().animation).toBe('LightThrowF4'); expect(f().special?.link?.throwIndex).toBe(14);
    for (let i = 0; i < 15 && bomb.link?.phase === 'held'; i++) step();
    expect(bomb.link?.phase).toBe('flight'); expect(bomb.vx).toBeGreaterThan(3); expect(bomb.vy).toBeGreaterThan(0);
  });
});
