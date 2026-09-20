import { beforeAll, describe, expect, it } from 'vitest';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { parseCommonGameplay, parseFighterProfile } from '../../lib/game/data.ts';
import { linkActionKeys, parseLinkParameters, parseLinkArticles, LINK_MOVES, LINK_ITEM_MOTIONS } from '../../lib/game/link-data.ts';
import { parseAttack, activeHits } from '../../lib/game/moves.ts';
import type { HsdArchive } from '../../lib/hsd/archive.ts';
import type { FighterAction, AnimationClip } from '../../lib/hsd/animation.ts';
import type { FighterProfile } from '../../lib/game/data.ts';
import type { HsdModel } from '../../lib/hsd/model.ts';

const iso=process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('Link and Young Link native content (not roster registration)',()=>{
  const content=new Map<string,{arc:HsdArchive;profile:FighterProfile;model:HsdModel;table:FighterAction[];clips:Map<string,AnimationClip>}>();
  beforeAll(async()=>{
    const disc=await openDisc(iso!);
    try{
      const session=new HsdAssetSession(disc,await verifyMeleeDisc(disc)),common=parseCommonGameplay(await session.archive('PlCo.dat'));
      for(const kind of ['Lk','Cl'] as const){
        const arc=await session.fighterData(kind),profile=parseFighterProfile(arc,kind,common),model=await session.model(`Pl${kind}Nr.dat`),table=await session.actionTable(kind),clips=new Map<string,AnimationClip>();
        for(const key of new Set([...Object.values(LINK_MOVES),...LINK_ITEM_MOTIONS]))clips.set(key,await session.clip(kind,key));
        for(const entry of linkActionKeys(kind)){expect(table[entry.index]?.name).toBe(entry.figatree);clips.set(entry.key,await session.clip(kind,table[entry.index]!));}
        content.set(kind,{arc,profile,model,table,clips});
      }
    }finally{await disc.close();}
  });
  it.each(['Lk','Cl'] as const)('%s uses its own model, translated parts, animations and 120-frame Wait alias',kind=>{
    const c=content.get(kind)!,joints=kind==='Lk'?75:79;
    expect(c.profile.name).toBe(kind==='Lk'?'Link':'Young Link');expect(c.model.roots[0]!.joints).toHaveLength(joints);expect(c.profile.boneCount).toBe(joints);
    expect(c.profile.partJoints.filter(j=>j<0)).toHaveLength(1);expect(c.profile.attributes.weight).toBe(kind==='Lk'?104:85);
    for(const clip of c.clips.values())expect(clip.joints).toHaveLength(joints);
    expect(c.clips.get('Wait1')!.name).toContain('ACTION_Wait_');
    expect(c.profile.partVisibility.groups).toHaveLength(3);
  });
  it.each(['Lk','Cl'] as const)('%s normals and followup retain original scripts on valid joints',kind=>{
    const c=content.get(kind)!;
    for(const name of Object.values(LINK_MOVES)){
      const action=c.table.find(a=>a.name===name)!,clip=c.clips.get(name)!,move=parseAttack(c.arc,action.scriptOffset,name,c.profile,clip.endFrame);
      if(!name.startsWith('Attack100'))expect(move.events.some(e=>e.type==='create')).toBe(true);
      for(const event of move.events)if(event.type==='create')expect(event.hit.bone).toBeLessThan(c.profile.boneCount);
    }
    const first=c.table.find(a=>a.name==='AttackS41')!,second=c.table.find(a=>a.name==='AttackS42')!;
    expect(parseAttack(c.arc,first.scriptOffset,'AttackS41',c.profile,60).events.some(e=>e.type==='command'&&e.index===0&&e.value===1)).toBe(true);
    expect(activeHits(parseAttack(c.arc,second.scriptOffset,'AttackS42',c.profile,60),10).length).toBeGreaterThan(0);
  });
  it.each(['Lk','Cl'] as const)('%s bow/boomerang/spin/bomb motions keep their exact action entries',kind=>{
    const c=content.get(kind)!;
    for(const e of linkActionKeys(kind)){
      const clip=c.clips.get(e.key)!,move=parseAttack(c.arc,c.table[e.index]!.scriptOffset,e.key,c.profile,clip.endFrame);
      if(e.key==='SpecialNStart')expect(move.events).toContainEqual({frame:18,type:'command',index:2,value:1});
      if(e.key==='SpecialS1')expect(move.events).toContainEqual({frame:27,type:'command',index:0,value:1});
      if(e.key==='SpecialS1Empty')expect(move.events.some(e=>e.type==='command'&&e.index===0)).toBe(false);
      if(e.key==='SpecialLw')expect(move.events).toContainEqual({frame:16,type:'flag',flag:24,value:0});
      if(e.key==='SpecialAirHi')expect(move.events.filter(e=>e.type==='create').length).toBeGreaterThan(10);
    }
  });
  it('reads adult/child bow differences and the original common item throw velocities',()=>{
    const adult=parseLinkParameters(content.get('Lk')!.arc,'Lk'),child=parseLinkParameters(content.get('Cl')!.arc,'Cl');
    expect(adult.neutral.chargeFrames).toBe(60);expect(child.neutral.chargeFrames).toBe(45);expect(child.neutral.animationRate).toBeCloseTo(1.33);
    expect(adult.arrow).toMatchObject({minDamage:5,maxDamage:18,maxSpeed:5,lifetime:60});expect(child.arrow).toMatchObject({minDamage:8,maxDamage:15,maxSpeed:4,lifetime:55});
    expect(child.side.maxAngle).toBeGreaterThan(adult.side.maxAngle);expect(child.up.maxDrift).toBeGreaterThan(adult.up.maxDrift);
    expect(adult.bomb.throwMultiplier).toBeGreaterThan(0);
  });
  it.each(['Lk','Cl'] as const)('%s loads only its own arrow, returning boomerang, bomb and six bow states',kind=>{
    const c=content.get(kind)!,articles=parseLinkArticles(c.arc,kind);
    for(const article of [articles.projectile!,articles.link!.boomerang,articles.link!.returning,articles.link!.bomb,articles.link!.explosion,...articles.link!.bows]){expect(article.model.archive).toBe(c.arc);expect(article.model.stats.meshes).toBeGreaterThan(0);}
    expect(articles.link!.bows).toHaveLength(6);expect(articles.projectile!.hit!.element).toBe(kind==='Lk'?3:1);
    expect(articles.link!.returning.hit!.damage).toBe(kind==='Lk'?3:2);
  });
  it('keeps adult shrinking blast and child three-pulse bomb timelines distinct',()=>{
    const adult=parseLinkParameters(content.get('Lk')!.arc,'Lk'),child=parseLinkParameters(content.get('Cl')!.arc,'Cl');
    expect(adult.bomb.fuse).toBe(300);expect(child.bomb.fuse).toBe(300);
    const adultHits=adult.bomb.timeline.filter(e=>e.hit);expect(adultHits[0]!.frame).toBe(0);expect(adultHits[0]!.hit!.damage).toBe(4);expect(new Set(adultHits.map(e=>e.hit!.activation)).size).toBe(1);
    const pulses=child.bomb.timeline.filter(e=>e.hit);expect(pulses.map(e=>e.frame)).toEqual([2,5,8]);expect(pulses.every(e=>e.hit!.damage===2)).toBe(true);expect(new Set(pulses.map(e=>e.hit!.activation)).size).toBe(3);
  });
  it.each(['Lk','Cl'] as const)('%s hookshot catch keeps its native article attachment instead of borrowing a hand grab',kind=>{
    const c=content.get(kind)!,action=c.table.find(a=>a.name==='Catch')!;
    const move=parseAttack(c.arc,action.scriptOffset,'Catch',c.profile,100);
    expect(move.events.some(e=>e.type==='create'&&e.hit.bone===139&&e.hit.element===8)).toBe(true);
    expect(c.profile.boneCount).toBe(kind==='Lk'?75:79);
  });
});
