import { test, expect } from '@playwright/test';

const iso = process.env.MELEE_DISC_PATH;
test('renders native KO beams in all four directions and restores the camera after shake', async ({ page }, testInfo) => {
  test.skip(!iso, 'Requires the user-owned local ISO.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/viewer.html');
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'ko-test-disc'; document.body.append(input); });
  await page.locator('#ko-test-disc').setInputFiles(iso!);
  await page.evaluate(async root => {
    const local = (path: string) => import(`/@fs/${root}/${path}`);
    const [THREE, {HsdAssetSession}, {verifyMeleeDisc}, {parseStageGameplay}, {parseKoEffect}, {KoEffects}, {ModelInstance}, {CameraShake,parseCameraQuakes}] = await Promise.all([
      'node_modules/three/build/three.module.js','lib/hsd/session.ts','lib/disc.ts','lib/game/data.ts','lib/game/ko-effect.ts',
      'web/src/render/ko-effects.ts','web/src/render/model-instance.ts','web/src/render/camera-shake.ts',
    ].map(local));
    const file = (document.querySelector('#ko-test-disc') as HTMLInputElement).files![0]!;
    const reader = {size: file.size, read: async (offset: number, length: number) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())};
    const session = new HsdAssetSession(reader, await verifyMeleeDisc(reader));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1.5, 1, 2000);
    camera.position.set(0,44,350); camera.lookAt(0,12,0);
    const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); renderer.setSize(900,600); renderer.setClearColor(0x101724);
    renderer.domElement.id='ko-test-canvas'; document.body.replaceChildren(renderer.domElement);
    const stageModel = await session.model('GrNLa.dat'), stage = parseStageGameplay(stageModel.archive), model = new ModelInstance(stageModel);
    model.group.scale.setScalar(stage.scale); scene.add(model.group); model.update(0);
    const effects = new KoEffects(scene,parseKoEffect(await session.archive('EfCoData.dat'),await session.archive('PlCo.dat')));
    const shake = new CameraShake(parseCameraQuakes(stageModel.archive));
    const pixels=()=>{renderer.render(scene,camera);const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;const ctx=canvas.getContext('2d')!;ctx.drawImage(renderer.domElement,0,0);return ctx.getImageData(0,0,900,600).data;};
    const baseline=pixels();
    (window as any).koProbe={draw:(direction:string)=>{
      effects.reset(); const b=stage.blast;
      const [x,y]=direction==='left'?[b.left-1,0]:direction==='right'?[b.right+1,0]:direction==='up'?[0,b.top+1]:[0,b.bottom-1];
      effects.spawn(x,y,['left','right','up','down'].indexOf(direction),b);effects.update(5,camera);
      const after=pixels();let changed=0,brightGain=0;for(let i=0;i<after.length;i+=4){
        if(Math.abs(after[i]!-baseline[i]!)+Math.abs(after[i+1]!-baseline[i+1]!)+Math.abs(after[i+2]!-baseline[i+2]!)>30)changed++;
        if(after[i]!>235&&after[i+1]!>235&&after[i+2]!>235&&Math.min(baseline[i]!,baseline[i+1]!,baseline[i+2]!)<200)brightGain++;
      }
      return {changed,brightGain};
    },details:()=>({particles:effects.particleCount,warnings:effects.warnings}),shake:()=>{shake.events([{type:'ko',player:0,x:0,y:0}]);shake.update(2);const before=camera.projectionMatrix.clone();const restore=shake.apply(camera,900,600);const moved=!before.equals(camera.projectionMatrix);renderer.render(scene,camera);restore();return moved&&before.equals(camera.projectionMatrix);},finish:()=>{effects.update(50,camera);renderer.render(scene,camera);return effects.count;},dispose:()=>{effects.dispose();model.dispose();renderer.dispose();}};
  }, process.cwd());
  for (const direction of ['left','right','up','down']) {
    const pixels=await page.evaluate(direction => (window as any).koProbe.draw(direction), direction);
    expect(pixels.changed).toBeGreaterThan(1000);expect(pixels.brightGain).toBeGreaterThan(100);
    const details=await page.evaluate(() => (window as any).koProbe.details());
    expect(details.particles).toBeGreaterThan(10);expect(details.warnings).toEqual([]);
    await page.locator('#ko-test-canvas').screenshot({path:testInfo.outputPath(`native-ko-${direction}.png`)});
  }
  expect(await page.evaluate(() => (window as any).koProbe.shake())).toBe(true);
  expect(await page.evaluate(() => (window as any).koProbe.finish())).toBe(0);
  await page.evaluate(() => (window as any).koProbe.dispose());
  expect(errors).toEqual([]);
});
