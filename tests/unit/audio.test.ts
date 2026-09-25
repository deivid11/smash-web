import { describe,expect,it } from 'vitest';
import { decodeDsp, SsmBank, SemTable, hitSound } from '../../lib/game/audio.ts';
function bank(stereo=false):Uint8Array {
  const head=8+(stereo?2:1)*64,data=stereo?16:8,bytes=new Uint8Array(16+head+data),v=new DataView(bytes.buffer);
  v.setUint32(0,head);v.setUint32(4,data);v.setUint32(8,1);v.setUint32(12,100);v.setUint32(16,stereo?2:1);v.setUint32(20,32000);
  for(let ch=0;ch<(stereo?2:1);ch++){const d=24+ch*64;v.setUint32(d+4,2+ch*16);v.setUint32(d+8,18+ch*16);v.setUint32(d+12,2+ch*16);bytes.fill(ch===0?0x11:0x22,16+head+ch*8+1,16+head+ch*8+8);}
  return bytes;
}
describe('original-format DSP/SSM audio',()=>{
 it('decodes signed nibbles in the correct order',()=>expect([...decodeDsp(new Uint8Array([0,0x1f,0,0,0,0,0,0]),2,new Array(16).fill(0))]).toEqual([1,-1]));
 it('applies predictor history and clamps signed 16-bit output',()=>{const c=new Array(16).fill(0);c[0]=2048;expect(decodeDsp(new Uint8Array([0,0x11,0,0,0,0,0,0]),2,c,32767)[1]).toBe(32767);});
 it('rejects malformed predictor indices',()=>expect(()=>decodeDsp(new Uint8Array([0x80,0,0,0,0,0,0,0]),1,new Array(16).fill(0))).toThrow('predictor'));
 it('rejects truncated blocks',()=>expect(()=>decodeDsp(new Uint8Array(7),14,new Array(16).fill(0))).toThrow('range'));
 it('reads a mono SSM sample',()=>{const b=new SsmBank(bank());expect(b.base).toBe(100);expect([...b.decode(100).channels[0]!]).toEqual(new Array(14).fill(1));});
 it('uses independent channel offsets in stereo SSM samples',()=>{const p=new SsmBank(bank(true)).decode(100);expect([...p.channels[0]!]).toEqual(new Array(14).fill(1));expect([...p.channels[1]!]).toEqual(new Array(14).fill(2));});
 it('handles SSM nibble endpoint remainder one like the reference decoder',()=>{const data=bank();new DataView(data.buffer).setUint32(32,19);expect(new SsmBank(data).decode(100).channels[0]).toHaveLength(13);});
 it('rejects unlisted samples',()=>expect(()=>new SsmBank(bank()).decode(99)).toThrow('not in'));
 it('rejects invalid bank headers',()=>{const data=bank();new DataView(data.buffer).setUint32(8,99999);expect(()=>new SsmBank(data)).toThrow('header');});
 it('rejects invalid sample rates',()=>{const data=bank();new DataView(data.buffer).setUint32(20,1);expect(()=>new SsmBank(data)).toThrow('rate');});
 it('uses the original hit-kind sound mapping',()=>{expect(hitSound(1,0)).toBe(91);expect(hitSound(6,2)).toBe(225);expect(hitSound(0,0)).toBe(540000);});
});
describe('bounded SEM cue extraction',()=>{
 const table=()=>{const b=new Uint8Array(36),v=new DataView(b.buffer);v.setUint32(8,1);v.setUint32(16,1);v.setUint32(20,24);v.setUint32(24,0x01000064);v.setUint32(28,0x060000ff);v.setUint32(32,0x0e000000);return b;};
 it('resolves a logical sound id to its original sample',()=>expect(new SemTable(table()).cues(0)).toEqual([{sample:100,delay:0,gain:1,pitch:1,auxA:0}]));
 it('returns no cue for unavailable/sentinel ids',()=>{const s=new SemTable(table());expect(s.cues(10000)).toEqual([]);expect(s.cues(-1)).toEqual([]);});
 it('rejects out-of-range script pointers',()=>{const b=table();new DataView(b.buffer).setUint32(20,99999);expect(()=>new SemTable(b)).toThrow('range');});
});
