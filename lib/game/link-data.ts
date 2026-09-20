import type { HsdArchive } from '../hsd/archive.ts';
import { loadModel } from '../hsd/model.ts';
import { itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { ActiveHit } from './moves.ts';
import type { FighterContent } from './load.ts';
import { ITEM_COMMON } from './item-common.ts';
import type { BoneTable, FighterProfile } from './data.ts';
export type LinkKind = 'Lk' | 'Cl';
/** Shared native ftLk_DatAttrs layout, read independently from each fighter archive. */
export interface LinkSpecialData {
  kind: LinkKind;
  neutral: { chargeFrames: number; animationRate: number; landing: number };
  side: { threshold: number; maxAngle: number; speed: number; smashSpeed: number };
  up: { landing: number; momentum: number; drift: number; maxDrift: number; lift: number; gravity: number };
  down: { itemKind: number };
  passiveShield:{bone:number;radius:number;offset:[number,number,number];amount:number};
  dairBounce: number; dairRearmFrames: number; dairRearmDamage: [number,number,number];
  arrow: { lifetime: number; minSpeed: number; maxSpeed: number; minDamage: number; maxDamage: number; gravity: number; stickLife: number; angleLimit: number };
  boomerang: { lifetime: number; smashLifetime: number; lateFrame: number; deceleration: number; acceleration: number; returnSpeed: number; minSpeed: number; turnAngle: number; hitTurnAngle: number; homingFrames: number; targetY: number; surfaceAngle: number; catchRadius: number; soundPeriod: number };
  bomb: { fuse: number; explosionFrames: number; bounce: number; throwMultiplier: number; throwAnimationDivisor: number; impactX: number; impactY: number; friction: number; stopSpeed: number; hitBounceX: number; hitBounceY: number; damageThreshold: number; damageBounceX: number; damageBounceY: number; pickup:[number,number]; hurt:{a:[number,number,number];b:[number,number,number];radius:number}; timeline: Array<{frame:number;hit:ActiveHit|null}> };
}
export function parseLinkParameters(arc: HsdArchive, kind: LinkKind): LinkSpecialData {
  const root=arc.symbol(kind==='Lk'?'ftDataLink':'ftDataClink'),base=arc.pointer(root+4),items=arc.pointer(root+0x48);
  const f=(offset:number)=>{const v=arc.f32(base+offset);if(!Number.isFinite(v)||Math.abs(v)>1000)throw Error('Invalid original Link parameter.');return v;};
  const special=(slot:number)=>arc.pointer(arc.pointer(items+slot*4)+4);
  const arrow=special(3),boomerang=special(1),bomb=special(0);
  const p:LinkSpecialData={kind,neutral:{chargeFrames:f(0),animationRate:f(4),landing:f(8)},side:{threshold:f(0x14),maxAngle:f(0x18)*f(0x1c),speed:f(0x24),smashSpeed:f(0x20)},
    up:{landing:f(0x30),momentum:f(0x34),drift:f(0x38),maxDrift:f(0x3c),lift:f(0x40),gravity:f(0x44)},down:{itemKind:arc.u32(base+0x48)},passiveShield:{bone:arc.u32(base+0xc4),radius:f(0xd4),offset:[f(0xc8),f(0xcc),f(0xd0)],amount:f(0xd8)},dairBounce:f(0x4c),dairRearmFrames:f(0x50),dairRearmDamage:[arc.u32(base+0x58),arc.u32(base+0x5c),arc.u32(base+0x60)],
    arrow:{lifetime:arc.f32(arrow),minSpeed:arc.f32(arrow+4),maxSpeed:arc.f32(arrow+8),minDamage:arc.f32(arrow+12),maxDamage:arc.f32(arrow+16),gravity:arc.f32(arrow+28),stickLife:arc.f32(arrow+24),angleLimit:arc.f32(arrow+32)},
    boomerang:{lifetime:arc.u32(boomerang),smashLifetime:arc.u32(boomerang+4),lateFrame:parseBoomerangLateFrame(arc,arc.pointer(arc.pointer(arc.pointer(items+4)+12)+12)),deceleration:arc.f32(boomerang+12),acceleration:arc.f32(boomerang+12),returnSpeed:arc.f32(boomerang+20),minSpeed:arc.f32(boomerang+24),turnAngle:arc.f32(boomerang+32),hitTurnAngle:arc.f32(boomerang+36),homingFrames:arc.f32(boomerang+40),targetY:f(0x28),surfaceAngle:arc.f32(boomerang+28),catchRadius:arc.f32(boomerang+44),soundPeriod:arc.f32(boomerang+0x38)},
    bomb:{fuse:arc.u32(bomb),explosionFrames:ITEM_COMMON.explosionLife,bounce:arc.f32(bomb+20),throwMultiplier:arc.f32(arc.pointer(root)+0xb0),throwAnimationDivisor:arc.f32(arc.pointer(arc.pointer(items))+0x1c),impactX:arc.f32(bomb+0x24),impactY:arc.f32(bomb+0x28),friction:Math.abs(arc.f32(bomb+0x2c)),stopSpeed:arc.f32(bomb+0x30),hitBounceX:arc.f32(bomb+0x1c),hitBounceY:arc.f32(bomb+0x20),damageThreshold:arc.u32(bomb+0x10),damageBounceX:arc.f32(bomb+0x14),damageBounceY:arc.f32(bomb+0x18),pickup:[arc.f32(arc.pointer(arc.pointer(items))+0x38),arc.f32(arc.pointer(arc.pointer(items))+0x3c)],hurt:parseBombHurt(arc,arc.pointer(arc.pointer(items)+8)),timeline:parseBombTimeline(arc,arc.pointer(arc.pointer(arc.pointer(items)+12)+32+12))},
  };
  if(p.neutral.chargeFrames<1||p.neutral.animationRate<=0||p.bomb.throwAnimationDivisor<=0||p.bomb.fuse>1200||p.arrow.lifetime<1||p.boomerang.lifetime>1200)throw Error('Unsupported original Link special bounds.');
  return p;
}
export function parseLinkShieldAttachment(arc:HsdArchive,bones:BoneTable,profile:FighterProfile):NonNullable<FighterContent['passiveAttachment']> {
  const root=[...arc.symbols.values()][0]!,base=arc.pointer(root+4),part=arc.u32(base+0xc4),binding=bones.virtualAttachments?.find(b=>b.part===part);
  if(!binding||binding.mode!==0||binding.tree!==255)throw Error('Unsupported original passive shield binding.');
  const joint=arc.pointer(arc.pointer(root+0x48)+24),parent=profile.partJoints[binding.parent];
  if(parent===undefined||parent<0||[0x14,0x18,0x1c].some(o=>arc.f32(joint+o)!==0))throw Error('Unsupported original passive shield transform.');
  return {parent,scale:[arc.f32(joint+0x20),arc.f32(joint+0x24),arc.f32(joint+0x28)],offset:[arc.f32(joint+0x2c),arc.f32(joint+0x30),arc.f32(joint+0x34)]};
}
function parseBombHurt(arc:HsdArchive,list:number):LinkSpecialData['bomb']['hurt'] {
  const entry=arc.pointer(list+4);if(arc.u32(list)!==1||arc.u32(entry)!==0)throw Error('Unsupported original bomb hurt attachment.');
  return {a:[arc.f32(entry+4),arc.f32(entry+8),arc.f32(entry+12)],b:[arc.f32(entry+16),arc.f32(entry+20),arc.f32(entry+24)],radius:arc.f32(entry+28)};
}
/** Initial boomerang item script: cmd0 selects the weaker outbound descriptor. */
function parseBoomerangLateFrame(arc:HsdArchive,script:number):number {
  let pointer=script,frame=0;
  for(let steps=0;steps<32;steps++){
    const word=arc.u32(pointer),op=word>>>26,value=word&0x3ffffff;
    if(op===1||op===2){frame=op===1?frame+value:Math.max(frame,value);pointer+=4;}
    else if(op===11)pointer+=24;
    else if(op===17&&value===1&&frame<=120)return frame;
    else throw Error('Unsupported original boomerang transition script.');
  }
  throw Error('Boomerang transition instruction budget exceeded.');
}
/** Bounded item-command subset for both original bomb explosions: Link shrinks one hit;
 * Young Link loops three 2% pulses with real clear/recreate activation boundaries. */
function parseBombTimeline(arc:HsdArchive,script:number):Array<{frame:number;hit:ActiveHit|null}>{
  const timeline:Array<{frame:number;hit:ActiveHit|null}>=[],loops:Array<{pointer:number;left:number}>=[];
  let pointer=script,frame=0,activation=0,hit:ActiveHit|null=null;
  const adjust=(source:ActiveHit,key:'damage'|'radius',value:number):ActiveHit=>({...source,[key]:value});
  for(let steps=0;steps<256;steps++){
    const word=arc.u32(pointer),op=word>>>26,value=word&0x3ffffff;
    if(op===0)return timeline;
    if(op===1||op===2){frame=op===1?frame+value:Math.max(frame,value);if(frame>120)throw Error('Bomb timeline exceeds frame budget.');pointer+=4;continue;}
    if(op===3){if(value<1||value>16||loops.length>4)throw Error('Invalid bomb loop.');loops.push({pointer:pointer+4,left:value});pointer+=4;continue;}
    if(op===4){const loop=loops.at(-1);if(!loop)throw Error('Unmatched bomb loop.');if(--loop.left>0)pointer=loop.pointer;else{loops.pop();pointer+=4;}continue;}
    if(op===11){const original=itemHit(arc,pointer);if(!original)throw Error('Missing bomb pulse.');hit={...original,activation};timeline.push({frame,hit});pointer+=24;continue;}
    if(op===15||op===16){hit=null;activation++;timeline.push({frame,hit});pointer+=4;continue;}
    if(op===12||op===13){if(hit){hit=adjust(hit,op===12?'damage':'radius',op===12?word&0x7fffff:Math.fround((word&0x7fffff)*Math.fround(0.003906)));timeline.push({frame,hit});}pointer+=4;continue;}
    throw Error(`Unsupported original bomb opcode ${op}.`);
  }
  throw Error('Bomb timeline instruction budget exceeded.');
}
export const LINK_MOVES:FighterContent['moves']={jab:'Attack11',jab2:'Attack12',jab3:'Attack13',rapidStart:'Attack100Start',rapidLoop:'Attack100Loop',rapidEnd:'Attack100End',dash:'AttackDash',strong:'AttackS41',sideTilt:'AttackS3',upTilt:'AttackHi3',downTilt:'AttackLw3',upSmash:'AttackHi4',downSmash:'AttackLw4',neutralAir:'AttackAirN',forwardAir:'AttackAirF',backAir:'AttackAirB',upAir:'AttackAirHi',downAir:'AttackAirLw'};
export const LINK_ITEM_MOTIONS=['LightThrowF','LightThrowB','LightThrowHi','LightThrowLw','LightThrowAirF','LightThrowAirB','LightThrowAirHi','LightThrowAirLw'] as const;
export function linkActionKeys(kind:LinkKind):ReadonlyArray<{key:string;index:number;figatree:string}>{
  return [{key:'Wait1',index:2,figatree:'Wait'},...['AttackS42','SpecialNStart','SpecialNLoop','SpecialNEnd','SpecialAirNStart','SpecialAirNLoop','SpecialAirNEnd','SpecialS1','SpecialS2','SpecialS1Empty','SpecialAirS1','SpecialAirS2','SpecialAirS1Empty','SpecialHi','SpecialAirHi','SpecialLw','SpecialAirLw'].map((key,i)=>({key,index:(kind==='Lk'?242:245)+i,figatree:key.replace('Empty','')})),
    // Smash item throws reuse figatrees, but have distinct native scripts.
    ...LINK_ITEM_MOTIONS.map((figatree,i)=>({key:`${figatree}4`,index:(kind==='Lk'?82:85)+i,figatree})),
  ];
}
/** Native item slots: bomb=0, boomerang=1, hookshot=2, arrow=3, bow=4.
 * Hookshot is not silently interpreted as an ordinary projectile. */
export function parseLinkArticles(arc:HsdArchive,kind:LinkKind):SpecialAssets['articles'] {
  const root=arc.symbol(kind==='Lk'?'ftDataLink':'ftDataClink'),table=arc.pointer(root+0x48),parameters=parseLinkParameters(arc,kind);
  const read=(slot:number,state:number,name:string):ArticleData=>{
    const p=arc.pointer(table+slot*4),common=arc.pointer(p),states=arc.pointer(p+12),model=arc.pointer(arc.pointer(p+16)),entry=states+state*16;
    if(!states||entry+16>states+arc.extent(states))throw Error(`Missing original ${kind} ${name} article state.`);
    const hitScript=arc.pointer(entry+12);
    return {model:loadModel(arc,{offset:model,name:`${kind}-${name}`,animation:arc.pointer(entry),materialAnimation:arc.pointer(entry+4)}),attachmentBone:arc.u32(arc.pointer(p+16)+8),hit:hitScript?itemHit(arc,hitScript):null,
      speed:slot===3?parameters.arrow.minSpeed:slot===1?parameters.side.speed:0,angle:0,lifetime:slot===0?parameters.bomb.fuse:slot===1?parameters.boomerang.lifetime:slot===3?parameters.arrow.lifetime:60,
      gravity:arc.f32(common+16),terminal:arc.f32(common+20),bounce:arc.f32(common+0x58),minSpeed:0,scale:arc.f32(common+0x60),sound:arc.u32(common+0x78),rayScale:1,deceleration:0};
  };
  const arrow=read(3,0,'arrow'),boomerang=read(1,0,'boomerang'),lateBoomerang=read(1,1,'boomerang-late'),returning=read(1,2,'boomerang-return'),bomb=read(0,1,'bomb'),explosion=read(0,2,'bomb-explosion');
  explosion.lifetime=parameters.bomb.explosionFrames;
  const bows=Array.from({length:6},(_,i)=>read(4,i,'bow'));
  return {projectile:arrow,accessory:bows[0]!,link:{boomerang,lateBoomerang,returning,bomb,explosion,bows}};
}
