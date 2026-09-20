import { describe, expect, it } from 'vitest';
import { ParticlePlayer } from '../../lib/hsd/particle-player.ts';
import type { ParticleBank, ParticleDefinition } from '../../lib/hsd/particle-bank.ts';

function player(commands: number[]): ParticlePlayer {
  const definition: ParticleDefinition = {id:223,type:0,texture:0,generatorLife:1,life:30,kind:256,gravity:0,friction:0,velocity:[0,0,0],radius:0,angle:0,rate:-1,size:1,parameters:[0,0,0],commands:Uint8Array.from(commands)};
  const bank={definition:()=>definition} as unknown as ParticleBank;
  const result=new ParticlePlayer(bank);result.spawn(223,[0,0,0]);return result;
}
describe('native particle E0 dual color delta', () => {
  it('applies shared signed random deltas to both targets, clamps bytes, and consumes exactly four bytes', () => {
    const p=player([0xcf,0,100,110,120,130,0xdf,0,140,150,160,170,0xe0,20,246,0,127,0x41,0,0xff]);
    p.step();const particle=p.particles[0]!;
    expect(particle.color[0]).toBeGreaterThan(100);expect(particle.color[0]-100).toBe(particle.environment[0]-140);
    expect(particle.color[1]).toBeLessThan(110);expect(particle.color[1]-110).toBe(particle.environment[1]-150);
    expect(particle.color[2]).toBe(120);expect(particle.environment[2]).toBe(160);
    expect(particle.color.every(c=>c>=0&&c<=255&&Number.isInteger(c))).toBe(true);
    expect(particle.frame).toBe(0);expect(p.unsupported.size).toBe(0);
    p.step();expect(p.particles).toHaveLength(0);
  });
  it('restarts the previous color interpolation lengths even after the earlier ramps completed', () => {
    const p=player([0xcf,2,200,200,200,200,0xdf,2,160,160,160,160,0x43,0,0xe0,0,0,0,0,0x41,0,0xff]);
    for(let i=0;i<4;i++)p.step();const particle=p.particles[0]!;
    expect(particle.color).toEqual([200,200,200,200]);expect(particle.environment).toEqual([160,160,160,160]);
    expect(particle.colorRamp).toMatchObject({duration:2,age:0,to:[200,200,200,200]});
    expect(particle.environmentRamp).toMatchObject({duration:2,age:0,to:[160,160,160,160]});
    expect(p.unsupported.size).toBe(0);
  });
});
