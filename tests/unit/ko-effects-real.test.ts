import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Scene, PerspectiveCamera, Vector3, type Mesh, type ShaderMaterial } from 'three';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { parseKoEffect, koColors, type KoEffectData } from '../../lib/game/ko-effect.ts';
import { KoEffects } from '../../web/src/render/ko-effects.ts';
import { CameraShake, parseCameraQuakes, type QuakeClips } from '../../web/src/render/camera-shake.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

const iso = process.env.MELEE_DISC_PATH;
it('allowlists exactly the common effect bank, not arbitrary effect files', () => {
  expect(SERVER_ASSETS).toContain('EfCoData.dat');
  expect(SERVER_ASSETS).not.toContain('EfAll.dat');
});
describe.skipIf(!iso)('original KO beam and quake assets', () => {
  let data: KoEffectData, quakes: QuakeClips[];
  const blast = {left: -200, right: 200, bottom: -100, top: 180};
  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      const session = new HsdAssetSession(disc, await verifyMeleeDisc(disc));
      data = parseKoEffect(await session.archive('EfCoData.dat'), await session.archive('PlCo.dat'));
      quakes = await Promise.all(['GrNBa.dat','GrNLa.dat','GrSt.dat','GrCn.dat','GrSh.dat','GrPs.dat'].map(async name => parseCameraQuakes(await session.archive(name))));
    } finally { await disc.close(); }
  }, 120_000);
  it('loads effect 0x19, five native textured draws, 50-frame animation and original scale/palettes', () => {
    expect(data.duration).toBe(50); expect(data.scale).toBeCloseTo(0.8, 6);
    expect(data.model.roots[0]!.parts).toHaveLength(5);
    expect(data.model.roots[0]!.parts.every(p => p.material.textures.length > 0)).toBe(true);
    expect(data.colors).toHaveLength(4);
    // Native MWCC evaluates the two va_args right-to-left: pale -> konst/core,
    // saturated -> tev0/fringe. The opposite mapping makes the old flat red bar.
    expect(data.colors[0]!.constant.map(c => Math.round(c * 255))).toEqual([255,204,204]);
    expect(data.colors[0]!.register0.map(c => Math.round(c * 255))).toEqual([242,89,89]);
    expect(data.cues).toEqual([{frame:0,generator:212,bone:0}]);
    expect(koColors(data, 7).constant).not.toEqual(data.colors[3]!.constant);
  });
  it('plays the original flash/beam visibility and releases after the native animation, even without match ticks', () => {
    const scene = new Scene(), effects = new KoEffects(scene, data), camera = new PerspectiveCamera(); camera.position.set(0, 30, 200);
    effects.spawn(-201, 0, 0, blast);
    const group = scene.children[0]!, beam = group.children[data.colorPart] as Mesh;
    expect(beam.visible).toBe(false); effects.update(5, camera); expect(beam.visible).toBe(true);
    effects.update(15, camera); expect(beam.visible).toBe(false);
    expect(effects.focusPoints[0]!.x).toBeCloseTo(-201 + data.model.roots[0]!.joints[2]!.translation[1] * data.scale, 5);
    expect(effects.focusPoints[0]!.y).toBeCloseTo(0, 5);
    effects.update(4, camera); expect(effects.focusPoints).toEqual([]);
    effects.update(26, camera); expect(effects.count).toBe(0); expect(scene.children).toHaveLength(0); effects.dispose();
  });
  it.each([[-201, 0, 1, 0], [201, 0, -1, 0], [0, 181, 0, -1], [0, -101, 0, 1]])('retains the inward beam axis after axial billboarding at (%i,%i)', (x,y,dx,dy) => {
    const scene = new Scene(), effects = new KoEffects(scene, data), camera = new PerspectiveCamera(); camera.position.set(0, 40, 200); camera.lookAt(0,0,0);
    effects.spawn(x,y,0,blast); effects.update(5,camera);
    const group = scene.children[0]!, mesh = group.children[data.colorPart] as Mesh<never, ShaderMaterial>;
    group.updateMatrixWorld(true);
    const world = group.matrixWorld.clone().multiply(mesh.material.uniforms.palette!.value[0]);
    const axis = new Vector3().setFromMatrixColumn(world,1).normalize();
    expect(axis.dot(new Vector3(dx,dy,0))).toBeCloseTo(1,6); effects.dispose();
  });
  it('changes only each beam instance first-child TEV RGB, and disposes/reset bounds for eight simultaneous KOs', () => {
    const scene = new Scene(), effects = new KoEffects(scene, data), camera = new PerspectiveCamera(); camera.position.z=200;
    const shared = data.model.roots[0]!.parts[data.colorPart]!.material.textures[0]!.tev!;
    const original = structuredClone(shared);
    for(let seat=0;seat<8;seat++) effects.spawn(201,seat,seat,blast);
    effects.update(5,camera); expect(effects.count).toBe(8);
    const first = scene.children[0]!, mesh = first.children[data.colorPart] as Mesh<never, ShaderMaterial>;
    expect(mesh.material.uniforms.tevConstant!.value.toArray().slice(0,3)).toEqual(data.colors[0]!.constant);
    expect(mesh.material.uniforms.tevConstant!.value.w).toBe(original.constant[3]);
    expect(shared).toEqual(original);
    const released=vi.spyOn(mesh.material,'dispose'); effects.spawn(201,0,7,blast);
    expect(effects.count).toBe(8); expect(released).toHaveBeenCalledOnce(); expect(first.parent).toBeNull();
    effects.reset(); expect(scene.children).toHaveLength(0); effects.dispose();
  });
  it('plays native generator 212 and its children without unsupported bytecodes, then frees all sprites', () => {
    const scene=new Scene(),effects=new KoEffects(scene,data),camera=new PerspectiveCamera();camera.position.z=200;
    effects.spawn(0,-101,0,blast);effects.update(5,camera);
    expect(effects.particleCount).toBeGreaterThan(10);
    const particles=scene.getObjectByName('native-ko-particles')!;
    const before=particles.children.map(mesh=>({position:mesh.position.toArray(),scale:mesh.scale.toArray()}));
    effects.update(0,camera);expect(particles.children.map(mesh=>({position:mesh.position.toArray(),scale:mesh.scale.toArray()}))).toEqual(before);
    effects.update(35,camera);expect(effects.warnings).toEqual([]);
    effects.update(10,camera);expect(effects.particleCount).toBe(0);expect(scene.children).toHaveLength(0);effects.dispose();
  });
  it('uses the same fixed particle ticks for fractional and integer presentation steps', () => {
    const camera=new PerspectiveCamera();camera.position.z=200;
    const aScene=new Scene(),bScene=new Scene(),a=new KoEffects(aScene,data),b=new KoEffects(bScene,data);
    a.spawn(201,0,0,blast);b.spawn(201,0,0,blast);
    a.update(5,camera);for(let i=0;i<20;i++)b.update(.25,camera);
    const snapshot=(scene:Scene)=>scene.getObjectByName('native-ko-particles')!.children.map(mesh=>({position:mesh.position.toArray(),scale:mesh.scale.toArray()}));
    expect(snapshot(aScene)).toEqual(snapshot(bScene));expect(a.particleCount).toBe(b.particleCount);a.dispose();b.dispose();
  });
  it('loads original small/medium/large stage quake curves and their actual durations, not the 22-frame bookkeeping timer', () => {
    for(const clips of quakes) {
      expect([clips.small!.endFrame,clips.medium!.endFrame,clips.large!.endFrame]).toEqual([30,30,40]);
      const shake = new CameraShake(clips); shake.events([{type:'ko',player:0,x:0,y:0}]); shake.update(2);
      expect(shake.sample().y).toBeCloseTo(2.3408203125,8);
      shake.update(2); expect(shake.sample().y).toBeLessThan(0); shake.update(36); expect(shake.sample()).toEqual({x:0,y:0});
    }
  });
});
