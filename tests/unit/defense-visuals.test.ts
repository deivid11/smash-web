import { describe, expect, it } from 'vitest';
import { Scene, type Mesh, type ShaderMaterial } from 'three';
import { DefenseVisuals } from '../../web/src/render/defense-visuals.ts';
import type { LocalMatch } from '../../lib/game/match.ts';
import type { GameRigs } from '../../web/src/render/game-rig.ts';
import { MAX_MATCH_PLAYERS } from '../../lib/game/limits.ts';
import { PLAYER_PRESENTATIONS } from '../../lib/game/player-colors.ts';

function match(count: number): LocalMatch {
  return {
    content: { combat: { shield: { minimumScale: 0.1, maximum: 60, sizeScale: 1 } } },
    fighters: Array.from({ length: count }, (_, slot) => ({ slot, state: 'shield', grounded: true, animation: 'Guard', combat: { shield: 60, flash: 4 }, content: { profile: { shieldBone: 0, attributes: { shieldSize: 8, modelScale: 1 } } } })),
  } as unknown as LocalMatch;
}
const rigs = { point: (fighter: { slot: number }) => [fighter.slot * 20, 10, 0] } as unknown as GameRigs;
describe('two-to-eight-player defense presentation', () => {
  it.each([2, 4, 5, 6, 7, 8])('renders all %i original-data shield bubbles with the shared slot palette', count => {
    const scene = new Scene(), visuals = new DefenseVisuals(scene);
    visuals.update(match(count), rigs);
    expect(scene.children).toHaveLength(MAX_MATCH_PLAYERS);
    expect(scene.children.filter(mesh => mesh.visible)).toHaveLength(count);
    scene.children.slice(0, count).forEach((mesh, slot) => { expect(mesh.position.x).toBe(slot * 20); expect(mesh.scale.x).toBe(8); const uniforms = ((mesh as Mesh).material as ShaderMaterial).uniforms; expect(uniforms.flash!.value).toBe(0.5); expect(uniforms.color!.value.getHex()).toBe(PLAYER_PRESENTATIONS[slot]!.color); });
    visuals.dispose(); expect(scene.children).toHaveLength(0);
  });
  it('uses persistent sparse seat colors while keeping dense positions and resource slots', () => {
    const scene = new Scene(), visuals = new DefenseVisuals(scene), world = match(2);
    world.fighters.forEach((fighter, slot) => Object.assign(fighter, {seatId: [1, 7][slot]}));
    visuals.update(world, rigs);
    expect(scene.children.slice(0, 2).map(mesh => ((mesh as Mesh).material as ShaderMaterial).uniforms.color!.value.getHex())).toEqual([PLAYER_PRESENTATIONS[1].color, PLAYER_PRESENTATIONS[7].color]);
    expect(scene.children.slice(0, 2).map(mesh => mesh.position.x)).toEqual([0, 20]); visuals.dispose();
  });
  it('hides removed players on a smaller rematch and clears every shield on reset', () => {
    const scene = new Scene(), visuals = new DefenseVisuals(scene);
    visuals.update(match(MAX_MATCH_PLAYERS), rigs); visuals.update(match(2), rigs);
    expect(scene.children.map(mesh => mesh.visible)).toEqual(Array.from({length: MAX_MATCH_PLAYERS}, (_, slot) => slot < 2));
    visuals.reset(); expect(scene.children.every(mesh => !mesh.visible)).toBe(true); visuals.dispose();
  });
});
