import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { InstancedMesh, Matrix4, Mesh, type ShaderMaterial } from 'three';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadGameContent, type GameContent } from '../../lib/game/load.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import { ModelInstance } from '../../web/src/render/model-instance.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';
import { LocalMatch, neutralInput, type MatchFighter } from '../../lib/game/match.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';

interface PoseLike { matrix: Matrix4; inverseBind: Matrix4; visible: boolean }
interface DrawLike { part: { kind: string; owner: number; reference: number; envelopes: Array<Array<{ joint: number; weight: number }>> }; palette: Matrix4[]; mesh: Mesh }
interface RootLike { source: { joints: Array<{ flags: number; parent: number }> }; poses: PoseLike[]; byId: Map<number, number>; draws: DrawLike[] }

/** The pre-optimization palette algorithm, kept verbatim as the reference. */
function referencePalette(root: RootLike, draw: DrawLike): number[][] {
  const { source, poses } = root, owner = source.joints[draw.part.owner]!, pose = poses[draw.part.owner]!;
  const palette = draw.palette.map(() => new Matrix4());
  if (draw.part.kind === 'rigid') {
    const index = draw.part.reference ? root.byId.get(draw.part.reference)! : draw.part.owner;
    for (const matrix of palette) matrix.copy(poses[index]!.matrix);
    return palette.map(matrix => [...matrix.elements]);
  }
  const node = new Matrix4().identity(), temporary = new Matrix4();
  if (!(owner.flags & 2)) {
    let skeleton = draw.part.owner;
    while (skeleton >= 0 && !(source.joints[skeleton]!.flags & 3)) skeleton = source.joints[skeleton]!.parent;
    if (skeleton === draw.part.owner) node.copy(poses[skeleton]!.inverseBind).invert();
    else {
      node.copy(pose.matrix).invert();
      if (!(source.joints[skeleton]!.flags & 2)) node.premultiply(poses[skeleton]!.inverseBind);
      node.premultiply(poses[skeleton]!.matrix);
    }
  }
  draw.part.envelopes.forEach((influences, index) => {
    const destination = palette[index]!;
    destination.elements.fill(0);
    for (const influence of influences) {
      const bone = poses[root.byId.get(influence.joint)!]!;
      const transform = temporary.copy(bone.matrix);
      if (!(influences.length === 1 && owner.flags & 2)) transform.multiply(bone.inverseBind);
      for (let component = 0; component < 16; component++) destination.elements[component]! += transform.elements[component]! * influence.weight;
    }
    destination.multiply(node);
  });
  return palette.map(matrix => [...matrix.elements]);
}

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('render hot-path optimizations keep presentation identical', () => {
  let base: GameContent, disc: Awaited<ReturnType<typeof openDisc>>;
  const disposables: Array<{ dispose(): void }> = [];
  beforeAll(async () => {
    disc = await openDisc(iso!);
    const info = await verifyMeleeDisc(disc);
    const session = new HsdAssetSession({ size: disc.size, read: async (offset, length) => disc.read(offset, length) }, info);
    base = await loadGameContent(session, new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer, undefined, 'final');
  }, 60_000);
  afterAll(async () => { await disc?.close(); });
  afterEach(() => { for (const item of disposables.splice(0)) item.dispose(); });

  it('prepares bit-identical palettes for every visible draw across fighters, clips and frames', () => {
    const kinds = [...base.roster.keys()].filter((kind): kind is FighterKind => ['Mr', 'Fx', 'Kb', 'Lk', 'Pk', 'Ss', 'Ca', 'Pe', 'Pp', 'Mt'].includes(kind));
    expect(kinds.length).toBeGreaterThan(3);
    let compared = 0;
    for (const kind of kinds) {
      const content = base.roster.get(kind)!, model = new ModelInstance(content.model, true);
      disposables.push(model);
      const clips = ['Wait1', 'Attack11', 'DamageFlyHi', 'JumpF'].map(name => content.clips.get(name)).filter(clip => !!clip);
      for (const clip of clips) {
        model.setAnimation(clip!, false);
        for (const frame of [0, 3, 7.5, 12, 30]) {
          model.update(frame);
          for (const root of (model as unknown as { roots: RootLike[] }).roots) for (const draw of root.draws) {
            if (!draw.mesh.visible) continue;
            expect((draw.palette).map(matrix => [...matrix.elements])).toEqual(referencePalette(root, draw));
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
  });

  it('packs visible palettes into the instance texture and casts one merged instanced silhouette', () => {
    const content = base.roster.get('Kb')!, model = new ModelInstance(content.model, true);
    disposables.push(model);
    model.setSilhouetteShadows(true);
    model.setShadowGround(0, 0.8, 0);
    model.setAnimation(content.clips.get('Attack11')!, false);
    model.update(5);
    // Hide one draw object the way part-visibility tables do (GameRigs fills this per fighter).
    model.hiddenDobjs.add(1);
    model.update(6);
    const internals = model as unknown as { roots: Array<RootLike & { draws: Array<DrawLike & { paletteOffset: number; paletteSlots: number }> }>; paletteData: Float32Array; paletteTexture: { image: { data: Float32Array; width: number } } };
    expect(internals.paletteTexture.image.data).toBe(internals.paletteData);
    expect(internals.paletteTexture.image.width % 4).toBe(0);
    let visible = 0, hidden = 0, nextSlot = 0;
    for (const root of internals.roots) for (const draw of root.draws) {
      expect(draw.paletteOffset).toBe(nextSlot); nextSlot += draw.paletteSlots;
      const material = draw.mesh.material as ShaderMaterial;
      expect(material.uniforms.paletteOffset!.value).toBe(draw.paletteOffset);
      expect(material.uniforms.paletteTexture!.value).toBe(internals.paletteTexture);
      const slots = internals.paletteData.subarray(draw.paletteOffset * 16, (draw.paletteOffset + draw.paletteSlots) * 16);
      if (draw.mesh.visible) {
        visible++;
        expect([...slots]).toEqual(draw.palette.slice(0, draw.paletteSlots).flatMap(matrix => [...new Float32Array(matrix.elements)]));
      } else { hidden++; expect(slots.every(value => value === 0)).toBe(true); }
    }
    expect(visible).toBeGreaterThan(10);
    expect(hidden).toBeGreaterThan(0);
    const shadows: InstancedMesh[] = [];
    model.group.traverse(object => { if (object.name === 'silhouette shadow') shadows.push(object as InstancedMesh); });
    expect(shadows).toHaveLength(1);
    const shadow = shadows[0]!, material = shadow.material as ShaderMaterial;
    expect(shadow).toBeInstanceOf(InstancedMesh);
    expect(shadow.count).toBe(3);
    expect(material.uniforms.paletteTexture!.value).toBe(internals.paletteTexture);
    expect(material.uniforms.opacity!.value).toBe(0.8);
    const vertices = internals.roots.reduce((sum, root) => sum + root.draws.reduce((count, draw) => count + (draw.mesh.geometry.getAttribute('gxMatrix')!.count), 0), 0);
    expect(shadow.geometry.getAttribute('gxSlot')!.count).toBe(vertices);
    model.setShadowTaps(1);
    expect(shadow.count).toBe(1);
    // Identity-local children follow the fighter's world matrix object directly.
    const draws = model.group.children.filter((child): child is Mesh => child instanceof Mesh);
    model.group.position.set(12, 3, 0); model.group.updateMatrixWorld(true);
    expect(draws[0]!.matrixWorld).toBe(model.group.matrixWorld);
    expect(shadow.matrixWorld).toBe(model.group.matrixWorld);
  });
  it('restores cached simulation poses around interpolated render samples without changing the simulation', () => {
    const kinds: FighterKind[] = ['Mr', 'Fx', 'Pk', 'Lk'];
    const make = () => {
      const content = rosterPlayers(base, kinds), rig = new GameRigs(content);
      disposables.push(rig);
      return { rig, match: new LocalMatch(content, rig, { opponent: 'human', controllers: kinds.map(() => 'cpu' as const), cpuLevels: kinds.map(() => 9), countdown: 0, seconds: 600, seed: 77 }) };
    };
    const plain = make(), rendered = make();
    plain.match.start(); rendered.match.start();
    const inputs = kinds.map(() => neutralInput());
    let updates = 0;
    for (const actor of rendered.rig.actors) { const original = actor.update.bind(actor); actor.update = (frame, prepare) => { updates++; original(frame, prepare); }; }
    for (let frame = 0; frame < 480 && plain.match.phase === 'playing'; frame++) {
      plain.match.step(inputs); rendered.match.step(inputs);
      // Presentation between steps: interpolated frames overwrite the shared actor poses.
      for (const fighter of rendered.match.fighters) rendered.rig.sample({ ...fighter, animationFrame: fighter.animationFrame + 0.5 } as MatchFighter);
      if (frame % 20 === 0) expect(rendered.match.stateHash()).toBe(plain.match.stateHash());
    }
    expect(rendered.match.stateHash()).toBe(plain.match.stateHash());
    // Without the cache every step re-evaluates twice after the render pass; restores cut that.
    expect(updates).toBeLessThan(480 * kinds.length * 2.6);
  }, 120_000);
});
