import { HsdArchive } from './archive.ts';
import { decodeTexture, textureByteSize, type DecodedTexture, type Palette } from './texture.ts';

export interface ParticleDefinition {
  id:number; type:number; texture:number; generatorLife:number; life:number; kind:number;
  gravity:number; friction:number; velocity:[number,number,number]; radius:number; angle:number; rate:number; size:number;
  parameters:[number,number,number]; commands:Uint8Array;
}
/** Native psInitDataBankLocate offsets are relative to the embedded bank, NOT the DAT.
 * Only requested definitions/textures are decoded. No disc bytes become build assets. */
export class ParticleBank {
  private definitions=new Map<number,ParticleDefinition>();
  private textures=new Map<string,DecodedTexture>();
  private textureBytes=0;
  private offsets:number[];
  private start:number; private count:number; private commandTable:number; private textureCount:number;
  constructor(readonly archive:HsdArchive,private commandBank:number,private textureBank:number){
    const version=archive.u16(commandBank);
    if(version===0){this.start=0;this.count=archive.u32(commandBank+4);this.commandTable=commandBank+8;}
    else if(version>=0x40&&version<=0x43){this.start=archive.u32(commandBank+4);this.count=archive.u32(commandBank+8);this.commandTable=commandBank+12;}
    else throw Error('Unsupported native particle bank version.');
    if(this.count>4096||this.start>50000)throw Error('Particle definition budget exceeded.');
    archive.range(this.commandTable,this.count*4);
    this.offsets=Array.from({length:this.count},(_,i)=>archive.u32(this.commandTable+i*4)).filter(Boolean).map(offset=>archive.range(commandBank+offset,60)).sort((a,b)=>a-b);
    this.textureCount=archive.u32(textureBank);
    if(this.textureCount>256)throw Error('Particle texture-group budget exceeded.');
    archive.range(textureBank+4,this.textureCount*4);
  }
  /** First generator id of the bank (psInitDataBankLocate start). */
  get first():number{return this.start;}
  definition(id:number):ParticleDefinition {
    const cached=this.definitions.get(id);if(cached)return cached;
    if(!Number.isInteger(id)||id<this.start||id>=this.start+this.count)throw Error('Particle definition outside bank.');
    const relative=this.archive.u32(this.commandTable+(id-this.start)*4);if(!relative)throw Error('Missing native particle definition.');
    const p=this.commandBank+relative,a=this.archive,end=this.offsets.find(offset=>offset>p)??this.textureBank;
    if(end<p+60||end-p>8192)throw Error('Invalid particle command bounds.');
    const d:ParticleDefinition={id,type:a.u16(p),texture:a.u16(p+2),generatorLife:a.u16(p+4),life:a.u16(p+6),kind:a.u32(p+8),gravity:a.f32(p+12),friction:a.f32(p+16),velocity:[a.f32(p+20),a.f32(p+24),a.f32(p+28)],radius:a.f32(p+32),angle:a.f32(p+36),rate:a.f32(p+40),size:a.f32(p+44),parameters:[a.f32(p+48),a.f32(p+52),a.f32(p+56)],commands:a.slice(p+60,end-p-60)};
    if(d.life>3600||d.generatorLife>3600||d.texture>=this.textureCount||Math.abs(d.size)>1000)throw Error('Unsupported particle bounds.');
    this.definitions.set(id,d);return d;
  }
  texture(group:number,frame:number,paletteIndex=0):DecodedTexture {
    const key=`${group}:${frame}:${paletteIndex}`,cached=this.textures.get(key);if(cached)return cached;
    if(!Number.isInteger(group)||group<0||group>=this.textureCount)throw Error('Invalid particle texture group.');
    const a=this.archive,relative=a.u32(this.textureBank+4+group*4);if(!relative)throw Error('Missing particle texture group.');
    const p=this.textureBank+relative,count=a.u32(p),format=a.u32(p+4),width=a.u32(p+12),height=a.u32(p+16),palettes=a.u16(p+20),shared=a.u16(p+22);
    if(count>256||!Number.isInteger(frame)||frame<0||frame>=count||width>512||height>512)throw Error('Invalid particle texture frame.');
    const image=this.textureBank+a.u32(p+24+frame*4),length=textureByteSize(format,width,height);
    let palette:Palette|undefined;
    if(format>=8&&format<=10){
      const index=shared&1?0:palettes?paletteIndex:frame;
      if(index<0||index>=(shared&1?1:palettes||count))throw Error('Invalid particle palette index.');
      const address=this.textureBank+a.u32(p+24+(count+index)*4);
      // The palette word keeps the format in its low half; fighter banks (Bowser's flame) set the
      // high half where the common bank leaves it zero, so the whole word is not the format.
      palette={format:a.u16(p+10),bytes:a.slice(address,(format===8?16:format===9?256:16384)*2)};
    }
    if(this.textures.size>=512||this.textureBytes+width*height*4>32*1024*1024)throw Error('Decoded particle texture budget exceeded.');
    const decoded=decodeTexture(a.slice(image,length),format,width,height,palette);this.textureBytes+=decoded.pixels.byteLength;this.textures.set(key,decoded);return decoded;
  }
}
