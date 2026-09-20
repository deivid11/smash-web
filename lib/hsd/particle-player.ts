import { ParticleBank, type ParticleDefinition } from './particle-bank.ts';
export type ParticlePoint=[number,number,number];
type Color=[number,number,number,number];
interface Ramp { from:Color; to:Color; age:number; duration:number }
export interface PlayedParticle {
  id:number; definition:ParticleDefinition; position:ParticlePoint; velocity:ParticlePoint; origin:ParticlePoint;
  facing:number|undefined; scale:number; size:number; rotation:number; frame:number; palette:number; kind:number;
  color:Color; environment:Color; life:number; cursor:number; wait:number; mark:number; loop:number; loopCount:number;
  sizeTarget:number; sizeTime:number; rotationTarget:number; rotationTime:number; gravity:number; friction:number;
  colorRamp?:Ramp; environmentRamp?:Ramp; colorDuration:number; environmentDuration:number; depth:number; trail?:number;
  /** efLib_Create*_Attach parents the generator to a moving object, so its particles keep reading
   * that object's position instead of the one they were born at. */
  follow?:()=>ParticlePoint;
  alphaCompare?:{mode:number;first:number;second:number};
}
interface Generator { definition:ParticleDefinition; origin:()=>ParticlePoint; facing:number|undefined; scale:number; life:number; count:number; depth:number; attached:boolean }
/** Bounded CPU playback of the selected original HSD particle bytecodes.
 * Separate cosmetic PRNG: never advances gameplay RNG or authoritative bones.
 * Generator volume sampling and billboard/TEV display remain browser approximations. */
export class ParticlePlayer {
  readonly particles:PlayedParticle[]=[];
  readonly unsupported=new Set<string>();
  private generators:Generator[]=[];
  private serial=0; private seed=1;
  constructor(readonly bank:ParticleBank,readonly capacity=192){}
  private random():number {this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  spawn(id:number,origin:ParticlePoint|(()=>ParticlePoint),facing:number|undefined=undefined,scale=1,depth=0,attached=false):void {
    if(depth>4||this.generators.length>=64)return;
    try{
      const d=this.bank.definition(id);
      this.generators.push({definition:d,origin:typeof origin==='function'?origin:()=>origin,attached:attached&&typeof origin==='function',facing,scale,life:d.generatorLife||1,count:d.kind&256?(d.rate<0?(1+d.rate>0.000000119?1:0):0.9999999):d.rate<0?0:this.random(),depth});
    }catch(error){this.unsupported.add(String(error));}
  }
  /** hsd_80398F8C's cone rotation around the existing velocity. */
  private rotate(v:ParticlePoint,angle:number,azimuth:number):ParticlePoint {
    const a=Math.atan2(v[1],v[2]),e=Math.atan2(v[0],v[1]*Math.sin(a)+v[2]*Math.cos(a)),speed=Math.hypot(...v);
    const x=speed*Math.sin(angle)*Math.cos(azimuth),y=speed*Math.sin(angle)*Math.sin(azimuth),z=speed*Math.cos(angle);
    const outX=x*Math.cos(e)+z*Math.sin(e),outZ=z*Math.cos(e)-x*Math.sin(e);
    return [outX,outZ*Math.sin(a)+y*Math.cos(a),outZ*Math.cos(a)-y*Math.sin(a)];
  }
  private create(g:Generator):void {
    if(this.particles.length>=this.capacity)return;
    const d=g.definition,position:ParticlePoint=[0,0,0],velocity:ParticlePoint=[...d.velocity],type=d.type&15;
    if(type===5)for(let i=0;i<3;i++)position[i]=(this.random()*2-1)*Math.abs(d.parameters[i]!);
    else if(type===8){
      // Sphere emission: native samples sqrt(random) latitude, with a random
      // hemisphere for the full-sphere case (generator.c shape 8).
      let latitude=Math.sqrt(this.random())*(Math.abs(d.parameters[0])||Math.PI);
      if(!d.parameters[0]||Math.abs(Math.abs(d.parameters[0])-Math.PI)<.001){latitude*=.5;if(this.random()<.5)latitude=Math.PI-latitude;}
      const longitude=this.random()*Math.PI*2,speed=Math.hypot(...velocity),radius=d.radius<0?-d.radius:d.radius*Math.sqrt(this.random());
      const direction=[Math.sin(latitude)*Math.cos(longitude),Math.sin(latitude)*Math.sin(longitude),Math.cos(latitude)];
      for(let i=0;i<3;i++){position[i]=direction[i]!*radius;velocity[i]=direction[i]!*speed;}
    }else if(d.radius||d.angle){
      const azimuth=this.random()*Math.PI*2,fraction=d.radius<0?1:this.random(),radius=Math.abs(d.radius)*fraction;
      position[0]=Math.cos(azimuth)*radius;position[1]=Math.sin(azimuth)*radius;
      const speed=Math.hypot(...velocity),cone=Math.abs(d.angle)*fraction;
      if(speed){const [x,y,z]=this.rotate(velocity,cone,azimuth);velocity[0]=x;velocity[1]=y;velocity[2]=z;}
    }
    // psGenerateParticle0 stores life + 1: a life-1 definition is displayed for one frame.
    const p:PlayedParticle={id:++this.serial,definition:d,position,velocity,origin:g.origin(),...(g.attached?{follow:g.origin}:{}),facing:g.facing,scale:g.scale,size:d.size,rotation:0,frame:-1,palette:0,kind:d.kind,color:[255,255,255,255],environment:[0,0,0,0],life:d.life+1,cursor:0,wait:0,mark:0,loop:0,loopCount:0,sizeTarget:d.size,sizeTime:0,rotationTarget:0,rotationTime:0,gravity:d.gravity,friction:d.friction,colorDuration:0,environmentDuration:0,depth:g.depth};
    this.particles.push(p);
  }
  step():void {
    const generators=this.generators.splice(0);
    for(const g of generators){
      g.count+=g.definition.rate<0?-g.definition.rate:g.definition.rate*this.random();
      for(let budget=0;g.count>=1&&budget<32;budget++,g.count--)this.create(g);
      if(--g.life>0)this.generators.push(g);
    }
    for(const p of [...this.particles]){
      try{
        if(p.sizeTime>0){p.size+=(p.sizeTarget-p.size)/p.sizeTime;p.sizeTime--;}
        if(p.rotationTime>0){p.rotation+=(p.rotationTarget-p.rotation)/p.rotationTime;p.rotationTime--;}
        for(const key of ['colorRamp','environmentRamp'] as const){const ramp=p[key];if(ramp){ramp.age++;const t=Math.min(1,ramp.age/ramp.duration),value=ramp.from.map((v,i)=>Math.floor(v+(ramp.to[i]!-v)*t)) as Color;if(key==='colorRamp')p.color=value;else p.environment=value;if(t===1)delete p[key];}}
        if(p.wait>0)p.wait--;
        if(p.wait===0)this.commands(p);
        if(--p.life<=0){this.remove(p);continue;}
        if(p.kind&1)p.velocity[1]-=p.gravity;
        if(p.kind&2)for(const i of [0,1,2] as const)p.velocity[i]*=p.friction;
        for(const i of [0,1,2] as const)p.position[i]+=p.velocity[i];
      }catch(error){this.unsupported.add(`particle ${p.definition.id}: ${String(error)}`);this.remove(p);}
    }
  }
  private remove(p:PlayedParticle):void {const i=this.particles.indexOf(p);if(i>=0)this.particles.splice(i,1);}
  private commands(p:PlayedParticle):void {
    const bytes=p.definition.commands,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const byte=()=>{if(p.cursor>=bytes.length)throw Error('Truncated particle command.');return bytes[p.cursor++]!;};
    const short=()=>byte()*256+byte();
    const number=()=>{if(p.cursor+4>bytes.length)throw Error('Truncated particle float.');const v=view.getFloat32(p.cursor);p.cursor+=4;if(!Number.isFinite(v)||Math.abs(v)>1e6)throw Error('Invalid particle float.');return v;};
    const count=()=>{const v=byte();return v&128?((v&127)<<8)+byte():v;};
    for(let budget=0;budget<256;budget++){
      const op=byte();
      if(op<128){let wait=op&31;if(op&32)wait=wait*256+byte();if(op&64)p.frame=byte();if(wait){p.wait=wait;return;}continue;}
      const cls=op<160?op&248:(op&240)===192||(op&240)===208?op&240:op;
      if(cls>=128&&cls<=152){const target=cls<144?p.position:p.velocity;for(let i=0;i<3;i++)if(op&(1<<i)){const v=number();target[i]=cls===136||cls===152?target[i]!+v:v;}continue;}
      if(cls===192||cls===208){
        const duration=count(),key=cls===192?'color':'environment',to=[...p[key]] as Color;
        p[cls===192?'colorDuration':'environmentDuration']=duration;
        for(let i=0;i<4;i++)if(op&(1<<i))to[i]=byte();
        if(!duration){p[key]=to;delete p[cls===192?'colorRamp':'environmentRamp'];}
        else p[cls===192?'colorRamp':'environmentRamp']={from:[...p[key]],to,age:0,duration};continue;
      }
      switch(op){
        case 0xa0:p.sizeTime=count();p.sizeTarget=number();if(!p.sizeTime)p.size=p.sizeTarget;break;
        case 0xac:p.sizeTime=count();p.sizeTarget=number()+number()*this.random();if(!p.sizeTime)p.size=p.sizeTarget;break;
        case 0xa1:p.frame=-1;break;
        case 0xa2:p.gravity=number();p.kind=p.gravity?p.kind|1:p.kind&~1;break;
        case 0xa3:p.friction=number();p.kind=p.friction===1?p.kind&~2:p.kind|2;break;
        case 0xa4:case 0xa5:case 0xef:{
          const id=short();if(op===0xef)byte();
          this.spawn(id,this.worldPosition(p),p.facing,p.scale,p.depth+1);break;
        }
        case 0xa6:{const base=short(),range=short();p.life=base+Math.floor(this.random()*range);break;} // Set life with random offset.
        case 0xa7:{const threshold=byte();if(threshold>=100*this.random()){p.life=1;return;}break;} // Conditional kill.
        case 0xab:{const scale=number();for(const i of [0,1,2] as const)p.velocity[i]*=scale;break;} // Velocity scale.
        case 0xa8:for(const i of [0,1,2] as const)p.position[i]+=(this.random()*2-1)*number();break;
        case 0xa9:{const angle=number();p.velocity=this.rotate(p.velocity,angle,this.random()*Math.PI*2);break;}
        case 0xad:p.kind|=128;break;
        case 0xae:p.kind&=~96;break;
        case 0xaf:p.kind=(p.kind&~64)|32;break;
        case 0xb0:p.kind=(p.kind&~32)|64;break;
        case 0xb1:p.kind|=96;break;
        // Dual alpha-test interpolation is a display limitation; preserve the
        // authored terminal compare instead of misaligning the command stream.
        case 0xb3:count();p.alphaCompare={mode:byte(),first:byte(),second:byte()};break;
        case 0xb4:p.kind|=8;break;
        case 0xb5:p.kind&=~8;break;
        case 0xb6:p.rotationTime=count();p.rotationTarget+=number();if(!p.rotationTime)p.rotation=p.rotationTarget;break;
        case 0xbc:p.frame=byte()+Math.floor(byte()*this.random());break;
        case 0xbd:{const speed=number()+number()*this.random(),mag=Math.hypot(...p.velocity);if(mag)for(const i of [0,1,2] as const)p.velocity[i]*=speed/mag;break;}
        case 0xe0:{
          // particle.c: dual signed random delta to PrimCol/EnvCol TARGETS.
          // Each channel shares one draw across both colors; restart the previous
          // interpolation duration, even if its earlier ramp has already finished.
          const targets=[p.colorRamp?.to??p.color,p.environmentRamp?.to??p.environment].map(c=>[...c] as Color);
          for(const i of [0,1,2,3] as const){
            const delta=(byte()<<24>>24)*2*this.random();
            for(const target of targets)target[i]=Math.trunc(Math.max(0,Math.min(255,target[i]+delta)));
          }
          for(const [i,key,rampKey,duration] of [[0,'color','colorRamp',p.colorDuration],[1,'environment','environmentRamp',p.environmentDuration]] as const){
            const to=targets[i]!;
            if(duration)p[rampKey]={from:[...p[key]],to,age:0,duration};
            else {p[key]=to;delete p[rampKey];}
          }
          break;
        }
        case 0xe2:p.kind|=0x10000000;break;
        case 0xe3:p.kind&=~0x10000000;break;
        case 0xe4:case 0xe5:{const mode=byte()&3,bit=op===0xe4?0x40000:0x80000;if(mode===0)p.kind&=~bit;else if(mode===1)p.kind|=bit;else if(mode===2)p.kind^=bit;else if(this.random()<.5)p.kind^=bit;break;}
        case 0xe6:p.kind|=0x200000;break;
        case 0xe7:p.kind&=~0x200000;break;
        case 0xe8:{const trail=number();if(trail<0){delete p.trail;p.kind&=~0x100000;}else{p.trail=trail;p.kind|=0x100000;}break;}
        case 0xed:{const base=number(),range=number(),steps=byte(),value=base+range*(steps?Math.floor((steps+1)*this.random())/steps:this.random());p.rotation+=value;p.rotationTarget+=value;break;}
        case 0xfa:p.loopCount=byte();p.loop=p.cursor;break;
        case 0xfb:if(--p.loopCount>0)p.cursor=p.loop;break;
        case 0xfc:p.mark=p.cursor;break;
        case 0xfd:p.cursor=p.mark;break;
        case 0xfe:case 0xff:p.life=1;return;
        default:throw Error(`Unsupported original bytecode 0x${op.toString(16)}.`);
      }
    }
    throw Error('Particle command budget exceeded.');
  }
  worldPosition(p:PlayedParticle):ParticlePoint {
    if(p.follow)p.origin=p.follow();
    // efLib_CreateGenerator uses world axes. Only facing-aware callbacks rotate
    // local Z onto world X; applying that rotation to normal hits turns them edge-on.
    if(p.facing===undefined)return p.position.map((v,i)=>p.origin[i]!+v*p.scale) as ParticlePoint;
    return [p.origin[0]+p.position[2]*p.facing*p.scale,p.origin[1]+p.position[1]*p.scale,p.origin[2]-p.position[0]*p.facing*p.scale];
  }
  /** Per-frame displacement in world units, mapped like worldPosition (facing rotates local Z onto world X). */
  worldVelocity(p:PlayedParticle):ParticlePoint {
    if(p.facing===undefined)return p.velocity.map(v=>v*p.scale) as ParticlePoint;
    return [p.velocity[2]*p.facing*p.scale,p.velocity[1]*p.scale,-p.velocity[0]*p.facing*p.scale];
  }
  clear():void {this.particles.length=0;this.generators.length=0;this.serial=0;this.seed=1;this.unsupported.clear();}
  get generatorCount():number{return this.generators.length;}
}
