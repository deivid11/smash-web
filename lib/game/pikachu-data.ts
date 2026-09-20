import type { HsdArchive } from '../hsd/archive.ts';
import { Matrix4, Vector3 } from 'three';
import { loadModel, type V3 } from '../hsd/model.ts';
import { loadJointAnimation, sampleTrack } from '../hsd/animation.ts';
import { jointMatrix } from '../hsd/transform.ts';
import { itemHit, type ArticleData, type SpecialAssets } from './special-data.ts';
import type { FighterContent } from './load.ts';

/** ftPikachuAttributes, USA 1.02. Integers are deliberately not read as floats. */
export interface PikachuSpecialData {
  kind: 'Pk';
  neutral: { groundX: number; groundY: number; airX: number; airY: number; landing: number };
  side: { maxCharge: number; damage: number; damagePerFrame: number; divisor: number; friction: number; gravity: number; speed: number; speedPerFrame: number; lift: number; travelGravity: number; terminal: number; endDivisor: number; endFriction: number; endGravity: number };
  up: { delay: number; frames: number; gravity: number; threshold: number; slope: number; speed: number; secondDecay: number; endDrift: number; endMomentum: number; angleDifference: number; mobility: number; landing: number; pitch: number; scale: [number, number, number] };
  down: { boost: number; gravity: number; contactY: number; speed: number; contactX: number; contactHeight: number; cloudOffset: number; height: number; count: number; delay: number };
}
export function parsePikachuParameters(arc: HsdArchive): PikachuSpecialData {
  const base = arc.pointer(arc.symbol('ftDataPikachu') + 4);
  const f = (o: number) => { const v = arc.f32(base + o); if (!Number.isFinite(v) || Math.abs(v) > 1000) throw new Error('Invalid original Pikachu parameter.'); return v; };
  const u = (o: number) => { const v = arc.u32(base + o); if (v > 600) throw new Error('Invalid original Pikachu counter.'); return v; };
  const p: PikachuSpecialData = {
    kind: 'Pk', neutral: { groundX: f(0), groundY: f(4), airX: f(8), airY: f(12), landing: f(16) },
    side: { maxCharge: f(0x24), damage: f(0x28), damagePerFrame: f(0x2c), divisor: f(0x30), friction: f(0x34), gravity: f(0x38), speed: f(0x3c), speedPerFrame: f(0x40), lift: f(0x44), travelGravity: f(0x48), terminal: f(0x4c), endDivisor: f(0x50), endFriction: f(0x54), endGravity: f(0x58) },
    up: { delay: u(0x5c), frames: u(0x60), gravity: f(0x64), threshold: f(0x8c), slope: f(0x90), speed: f(0x94), secondDecay: f(0x98), endDrift: f(0x9c), endMomentum: f(0xa4), angleDifference: u(0xa8), mobility: f(0xac), landing: f(0xb0), pitch: f(0x78), scale: [f(0x7c), f(0x80), f(0x84)] },
    down: { boost: f(0xb4), gravity: f(0xb8), contactY: f(0xbc), speed: f(0xc0), contactX: f(0xc4), contactHeight: f(0xc8), cloudOffset: f(0xcc), height: f(0xd0), count: u(0xd4), delay: u(0xd8) },
  };
  if (p.side.maxCharge <= 0 || p.side.divisor <= 0 || p.side.endDivisor <= 0 || p.up.frames < 1 || p.down.count < 1 || p.down.count > 8 || p.down.speed >= 0) throw new Error('Unsupported original Pikachu special bounds.');
  return p;
}
/** ftPk_SM order: repeated figatrees carry different scripts. Wait is Pikachu's actual idle. */
export const PIKACHU_ACTION_KEYS = [
  { key: 'Wait1', index: 2, figatree: 'Wait' },
  ...['SpecialN', 'SpecialAirN', 'SpecialSStart', 'SpecialSHold', 'SpecialSLaunch', 'SpecialSTravel', 'SpecialSEnd', 'SpecialAirSStart', 'SpecialAirSHold', 'SpecialAirSLaunch', 'SpecialAirSEnd', 'SpecialHiStart', 'SpecialHiTravel', 'SpecialHiEnd', 'SpecialAirHiStart', 'SpecialAirHiTravel', 'SpecialAirHiEnd', 'SpecialLwStart', 'SpecialLwLoop', 'SpecialLwHit', 'SpecialLwEnd', 'SpecialAirLwStart', 'SpecialAirLwLoop', 'SpecialAirLwHit', 'SpecialAirLwEnd']
    .map((key, i) => ({ key, index: 240 + i, figatree: key === 'SpecialAirSLaunch' ? 'SpecialS' : key.replace('SLaunch', 'S').replace('STravel', 'S').replace('HiTravel', 'HiStart').replace('LwHit', 'LwLoop') })),
] as const;
export const PIKACHU_MOVES: FighterContent['moves'] = {
  jab: 'Attack11', dash: 'AttackDash', strong: 'AttackS4', sideTilt: 'AttackS3S', upTilt: 'AttackHi3', downTilt: 'AttackLw3',
  upSmash: 'AttackHi4', downSmash: 'AttackLw4', neutralAir: 'AttackAirN', forwardAir: 'AttackAirF', backAir: 'AttackAirB', upAir: 'AttackAirHi', downAir: 'AttackAirLw',
};
/** Verified ftPk_Init_OnLoad slots: 0 thunder, 1 jolt controller/air spark, 2 ground wave.
 * The ground wave advances via its original joint animation; the prototype supports horizontal floors only. */
export function parsePikachuArticles(arc: HsdArchive): SpecialAssets['articles'] {
  const table = arc.pointer(arc.symbol('ftDataPikachu') + 0x48);
  const read = (index: number, name: string): ArticleData => {
    const article = arc.pointer(table + index * 4), common = arc.pointer(article), special = arc.pointer(article + 4), states = arc.pointer(article + 12), model = arc.pointer(article + 16);
    const script = arc.pointer(states + 12), joint = arc.pointer(model);
    // Slot 1 has no JObj: native code draws its spark via efSync 0x4BD, not a substitute fighter model.
    const object = joint ? loadModel(arc, { offset: joint, name, animation: arc.pointer(states), materialAnimation: arc.pointer(states + 4) })
      : { archive: arc, roots: [], fogEntries: [], warnings: ['Native jolt spark is particle-only; supplemental electric strokes are used.'], stats: { joints: 0, meshes: 0, vertices: 0, triangles: 0, textures: 0 } };
    const data: ArticleData = { model: object, hit: script ? itemHit(arc, script) : null,
      speed: index === 1 ? arc.f32(special + 8) : 0, angle: index === 1 ? arc.f32(special + 4) : 0, lifetime: index === 2 ? 100 : arc.f32(special),
      gravity: arc.f32(common + 16), terminal: arc.f32(common + 20), bounce: arc.f32(common + 0x58), minSpeed: 0, scale: arc.f32(common + 0x60), sound: arc.u32(common + 0x78), rayScale: 1, deceleration: 0 };
    return data;
  };
  const thunder = read(0, 'pikachu-thunder'), projectile = read(1, 'pikachu-jolt'), groundJolt = read(2, 'pikachu-ground-jolt');
  const thunderSpecial = arc.pointer(arc.pointer(table) + 4);
  return { projectile, accessory: groundJolt, pikachu: { thunder, groundJolt, groundPath: groundJoltPath(groundJolt), thunderLength: arc.f32(thunderSpecial + 4), thunderTip: arc.f32(thunderSpecial + 8) } };
}
/** it_802B3F20 reads joint 6 as the jolt controller position. Bake its original FK once,
 * so authoritative surface tracing never reads Three.js render objects or allocates poses per tick. */
function groundJoltPath(article: ArticleData): V3[] {
  const root=article.model.roots[0]!, clip=loadJointAnimation(article.model.archive,root.animationPointer);
  if(!clip || clip.endFrame < 1 || clip.endFrame > 120 || !root.joints[6]) throw new Error('Unsupported original ground-jolt animation.');
  return Array.from({length:Math.ceil(clip.endFrame)+1},(_,frame)=>{
    const poses:Array<{matrix:Matrix4;accumulated:V3}>=[];
    for(let index=0;index<root.joints.length;index++){
      const joint=root.joints[index]!, rotation:V3=[...joint.rotation],scale:V3=[...joint.scale],translation:V3=[...joint.translation];
      const tracks=clip.joints[index];
      for(const track of tracks?.tracks??[]){
        const value=sampleTrack(track.keys,Math.min(frame,tracks!.endFrame));if(value===undefined)continue;
        if(track.type>=1&&track.type<=3)rotation[track.type-1]=value;
        else if(track.type>=5&&track.type<=7)translation[track.type-5]=value;
        else if(track.type>=8&&track.type<=10)scale[track.type-8]=value;
      }
      const parent=joint.parent>=0?poses[joint.parent]:undefined,parentScale=parent?.accumulated??[1,1,1];
      const accumulated:V3=joint.flags&8?[...parentScale] as V3:[scale[0]*parentScale[0]!,scale[1]*parentScale[1]!,scale[2]*parentScale[2]!];
      const matrix=new Matrix4();jointMatrix(matrix,scale,rotation,translation,accumulated);if(parent)matrix.premultiply(parent.matrix);poses.push({matrix,accumulated});
    }
    const point=new Vector3().setFromMatrixPosition(poses[6]!.matrix).multiplyScalar(article.scale);
    return [Math.fround(point.x),Math.fround(point.y),Math.fround(point.z)];
  });
}
