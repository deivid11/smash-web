import { HsdArchive } from '../hsd/archive.ts';
import { loadModel, type HsdModel } from '../hsd/model.ts';
import { loadJointAnimation } from '../hsd/animation.ts';
import { ParticleBank } from '../hsd/particle-bank.ts';

export interface EffectModel { model:HsdModel; life:number; particles:Array<{frame:number;generator:number;bone:number}> }
export type BurnEvent={frame:number;type:'color';rgba:[number,number,number,number]}
  /** lb_800140F8: blend the overlay from its current value to rgba over `frames` frames. */
  |{frame:number;type:'blend';rgba:[number,number,number,number];frames:number}
  /** ftAction_80071028 inside a color script: `bone` is the raw part index (0x8D cycles the five effect parts). */
  |{frame:number;type:'particle';generator:number;bone?:number};
export interface BurnSequence { events:BurnEvent[]; life:number }
/** ftCo_8008DA4C: the victim's color script per hit element; the knockback level (0-3 by
 * burnThresholds) picks one of four scripts for fire/electric/ice/dark, every other element
 * plays common script 4 (the white hit flash). */
export interface HitColorScripts { normal:BurnSequence; electric:BurnSequence[]; ice:BurnSequence[]; dark:BurnSequence[] }
export interface CommonEffectsData {
  models:ReadonlyMap<number,EffectModel>; particles:ParticleBank;
  burns:BurnSequence[]; knockbackScale:number; burnThresholds:[number,number,number];
  hitColors:HitColorScripts;
  /** ftCommonData x3F0: knockback at which ftColl_80078538 swaps the normal spark (1000) for the 1011 flash. */
  sparkFlashKnockback:number;
  /** ftCommonData x3F4: HSD_Randi(n)==0 adds the 1007 sparkle generator on severity>=1 hits (hit_spark_variant 0). */
  sparkExtraOdds:number;
  /** efAsync 0x415 -> efLib_Create_AttachChild(0x25): the block a frozen fighter is sealed in.
   * Its table entry declares no lifetime because ftCo_DamageIce destroys it by hand. */
  iceBlock:HsdModel;
}
/** ftcoll's element-indexed effect table. An attacker species is never a fire flag. */
export const HIT_EFFECT_IDS:readonly (number|null)[]=[1000,1002,1001,1004,1145,1005,null,null,null,1000,1000,null,null,1046,null,null];
/** efAsync_Dispatch: gfx ID -> model descriptor in effCommonDataTable. */
export const COMMON_MODEL_EFFECTS:ReadonlyMap<number,number>=new Map([[1003,7],[1004,8],[1013,16],[1014,17],[1015,18],[1016,19],[1017,20],[1018,21],[1021,3],[1023,5],[1028,24],[1030,4],[1059,1],[1060,2]]);
/** effCommonDataTable entry for the frozen block (efAlt kind 0x25). */
export const ICE_BLOCK_MODEL=37;
export const COMMON_PARTICLE_EFFECTS:ReadonlyMap<number,number>=new Map([[1001,12],[1002,20],[1046,406],[1011,11],[1007,66],[1022,263],[1029,44],[1031,60],[1041,75],[1038,67],[1012,72],[1042,19],[1043,55],[1044,225],[1094,27],[1290,95]]);

/** PlCo color scripts (fire 11..14, electric 15..18, ice 31..34, dark 35..38, normal 4). These are
 * NOT fighter action scripts: opcodes 10..20 use the ColorOverlay table in lb_013B.c (light
 * overlay commands 13..17 are skipped: no rim light port), 21/22 are the fighter GFX/SFX
 * commands. Effect ids below 1000 are common-bank generator ids (efLib_CreateGenerator). */
export function parseBurnSequence(arc:HsdArchive,script:number):BurnSequence {
  let pointer=script,frame=0;const events:BurnEvent[]=[],returns:number[]=[],loops:Array<{pointer:number;left:number}>=[];
  for(let budget=0;budget<4096;budget++){
    const word=arc.u32(pointer),op=word>>>26,value=word&0x3ffffff;
    if(op===0||op===10)return {events,life:frame};
    if(op===1||op===11){frame+=value;if(frame>600)throw Error('Fire color script exceeds frame budget.');pointer+=4;}
    else if(op===3){if(value<1||value>64||loops.length>4)throw Error('Invalid fire color loop.');loops.push({pointer:pointer+4,left:value});pointer+=4;}
    else if(op===4){const loop=loops.at(-1);if(!loop)throw Error('Unmatched fire color loop.');if(--loop.left>0)pointer=loop.pointer;else{loops.pop();pointer+=4;}}
    else if(op===5){if(returns.length>4)throw Error('Fire color call depth exceeded.');returns.push(pointer+8);pointer=arc.pointer(pointer+4);}
    else if(op===6){const target=returns.pop();if(target===undefined)throw Error('Unmatched fire color return.');pointer=target;}
    else if(op===12||op===20){events.push({frame,type:'color',rgba:[0,0,0,0]});pointer+=4;}
    else if(op===13||op===14||op===15)pointer+=8; // Light overlay set/blend: unported.
    else if(op===16||op===17)pointer+=4; // Light rotation / light off: unported.
    else if(op===18){const color=arc.u32(pointer+4);events.push({frame,type:'color',rgba:[color>>>24,(color>>>16)&255,(color>>>8)&255,color&255]});pointer+=8;}
    else if(op===19){const color=arc.u32(pointer+4);if(value<1||value>600)throw Error('Invalid color blend length.');events.push({frame,type:'blend',rgba:[color>>>24,(color>>>16)&255,(color>>>8)&255,color&255],frames:value});pointer+=8;}
    else if(op===21){
      const effect=arc.u32(pointer+4)>>>16,bone=(word>>>18)&255;
      // efAsync_Dispatch 0x412/0x413/0x414: joint-attached generators 0x13 (electric arcs), 0x37 (flames), 0xE1 (smoke).
      const generator=effect===1042?19:effect===1043?55:effect===1044?225:effect<1000?effect:COMMON_PARTICLE_EFFECTS.get(effect);
      if(generator===undefined)throw Error(`Unsupported color script effect ${effect}.`);
      events.push({frame,type:'particle',generator,bone});pointer+=20;
    }
    else if(op===22)pointer+=12; // Sound scheduling remains with the existing audio mixer.
    else throw Error(`Unsupported fire color opcode ${op}.`);
  }
  throw Error('Fire color command budget exceeded.');
}
export function parseCommonEffects(arc:HsdArchive,common:HsdArchive):CommonEffectsData {
  const root=arc.symbol('effCommonDataTable'),models=new Map<number,EffectModel>();
  for(const index of new Set([9,10,...COMMON_MODEL_EFFECTS.values()])){
    const entry=root+8+index*20,life=arc.f32(entry);
    if(life<=0||life>120)throw Error('Unsupported common effect lifetime.');
    const model=loadModel(arc,{offset:arc.pointer(entry+4),name:`native-common-${index}`,animation:arc.pointer(entry+8),materialAnimation:arc.pointer(entry+12)});
    const particles:EffectModel['particles']=[],bits=new DataView(new ArrayBuffer(4));
    const animation=loadJointAnimation(arc,model.roots[0]!.animationPointer);
    animation?.joints.forEach((joint,bone)=>{for(const track of joint.tracks)if(track.type===40){const seen=new Set<string>();for(const key of track.keys){
      // JObj's dptcl callback reads the integer member of the animation value union.
      bits.setFloat32(0,key.p0);const value=bits.getUint32(0),bank=value&63,generator=(value>>>6)&0xffffff;
      if(bank!==0)throw Error('Unexpected common effect particle bank.');
      const stamp=`${key.time}:${generator}`;if(!seen.has(stamp)){particles.push({frame:key.time,generator,bone});seen.add(stamp);}
    }}});
    particles.sort((a,b)=>a.frame-b.frame);
    models.set(index,{model,life,particles});
  }
  const iceEntry=root+8+ICE_BLOCK_MODEL*20;
  const iceBlock=loadModel(arc,{offset:arc.pointer(iceEntry+4),name:`native-common-${ICE_BLOCK_MODEL}`,animation:arc.pointer(iceEntry+8),materialAnimation:arc.pointer(iceEntry+12)});
  const base=common.symbol('ftLoadCommonData'),parameters=common.pointer(base),colors=common.pointer(base+24);
  const script=(i:number)=>parseBurnSequence(common,common.pointer(colors+i*8)),scripts=(first:number)=>[0,1,2,3].map(i=>script(first+i));
  const sparkFlashKnockback=common.f32(parameters+0x3f0),sparkExtraOdds=common.u32(parameters+0x3f4);
  if(!(sparkFlashKnockback>0&&sparkFlashKnockback<10000)||sparkExtraOdds<1||sparkExtraOdds>1000)throw Error('Unsupported common hit spark parameters.');
  return {models,particles:new ParticleBank(arc,arc.pointer(root),arc.pointer(root+4)),burns:scripts(11),knockbackScale:common.f32(parameters+0x154),burnThresholds:[common.f32(parameters+0x158),common.f32(parameters+0x15c),common.f32(parameters+0x160)],
    hitColors:{normal:script(4),electric:scripts(15),ice:scripts(31),dark:scripts(35)},sparkFlashKnockback,sparkExtraOdds,iceBlock};
}
