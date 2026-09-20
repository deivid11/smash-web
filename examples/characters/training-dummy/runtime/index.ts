import { CapsuleGeometry, Mesh, MeshBasicMaterial } from 'three';
import type { CharacterPack, CustomPackContext } from '@smash/lib/custom/types.ts';
import { makeDummy } from './fighter.ts';

/** An intentionally simple, self-authored capsule. No image/model/game assets are distributed. */
export default function createPack(context: CustomPackContext): CharacterPack {
  const name = (direction: 'neutral' | 'side' | 'up' | 'down', air: boolean) => `${air ? 'SpecialAir' : 'Special'}${({ neutral: 'N', side: 'S', up: 'Hi', down: 'Lw' })[direction]}`;
  return {
    apiVersion: 1, kind: context.kind, name: 'Training Dummy',
    menu: { mark: 'TD', color: 'mint', subtitle: 'Authored tutorial · Basic strikes', provenance: 'Local custom pack · tutorial, not a full fighter' },
    create: () => makeDummy(context.kind),
    initialState: () => ({ specialsUsed: 0 }),
    specials: {
      name: (direction, _phase, air) => name(direction, air),
      begin(fighter, direction) {
        fighter.customState!.specialsUsed = Number(fighter.customState!.specialsUsed) + 1;
        if (direction === 'up') { fighter.grounded = false; fighter.floor = null; fighter.velocity.y = 3.5; }
      },
      step(fighter, _input, physics, finish) {
        fighter.special!.age++;
        if (fighter.animationFrame >= fighter.content.clips.get(fighter.animation)!.endFrame) finish();
        else if (fighter.grounded) fighter.velocity = { x: physics.ground(fighter.slot, fighter.velocity.x, 0), y: 0 };
        else { const a = fighter.content.profile.attributes; fighter.velocity = physics.customAir(fighter.slot, fighter.velocity, a.gravity, a.terminal, a.airFriction); }
        return { handled: true, shots: [], sounds: [] };
      },
      land(_fighter, finish) { finish(); return true; },
    },
    async prepareVisual() {
      return {
        createSkin(actor) {
          const mesh = new Mesh(new CapsuleGeometry(3, 8, 4, 8), new MeshBasicMaterial({ color: 0x52e8c1 }));
          mesh.position.y = 8; actor.group.add(mesh);
          return { render() {}, dispose() { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); } };
        },
        dispose() {},
      };
    },
  };
}
