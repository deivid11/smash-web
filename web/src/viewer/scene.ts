import type { HsdAssetSession } from '../../../lib/hsd/session.ts';
import { ModelInstance } from '../render/model-instance.ts';

export const scenes = {
  battlefield: ['GrNBa.dat', 'Battlefield'], final: ['GrNLa.dat', 'Final Destination'], yoshi: ['GrSt.dat', 'Yoshi’s Story'],
  fox: ['PlFxNr.dat', 'Fox · original model'], mario: ['PlMrNr.dat', 'Mario · original model'], trophy: ['TyMario.dat', 'Mario · original trophy'],
} as const;
export type SceneMode = keyof typeof scenes;
export interface SceneSelection { mode: SceneMode; fighterCount: string; action: string }
export const isStage = (mode: SceneMode) => mode === 'battlefield' || mode === 'final' || mode === 'yoshi';
export const cameraKind = (mode: SceneMode) => isStage(mode) ? 'stage' : mode === 'trophy' ? 'trophy' : 'closeup';
export interface SceneStats { triangles: number; joints: number; textures: number }

/** Yield before expensive decoding, cancelling both the callback and its waiter. */
function paint(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cancelAnimationFrame(id); reject(signal.reason); };
    const id = requestAnimationFrame(() => { signal.removeEventListener('abort', abort); resolve(); });
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Own newly allocated GPU resources until the caller transfers them to AssetViewer. */
export async function buildScene(session: HsdAssetSession, selection: SceneSelection, signal: AbortSignal, progress: (message: string) => void) {
  const instances: ModelInstance[] = [];
  const { mode, action, fighterCount } = selection;
  const [file, title] = scenes[mode];
  try {
    signal.throwIfAborted();
    progress(`Reading and decoding ${file}…`); await paint(signal);
    const model = await session.model(file); signal.throwIfAborted();
    const main = new ModelInstance(model, !isStage(mode)); instances.push(main);
    let duration = 120;
    const modelCount = isStage(mode) ? Number(fighterCount) : 0;
    const loaded = new Set<string>([file]);
    for (let index = 0; index < modelCount; index++) {
      const fighter = index % 2 === 0 ? 'Fx' : 'Mr';
      const name = `Pl${fighter}Nr.dat`;
      progress(`Reading ${name} and original ${action} animation…`); await paint(signal);
      const actorModel = await session.model(name); signal.throwIfAborted();
      const actor = new ModelInstance(actorModel, true); instances.push(actor);
      const clip = await session.clip(fighter, action); signal.throwIfAborted();
      actor.setAnimation(clip); duration = Math.max(duration, clip.endFrame);
      actor.group.position.set((index - (modelCount - 1) / 2) * 25, 0, 0);
      actor.group.rotation.y = index % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
      loaded.add(name); loaded.add(`Pl${fighter}AJ.dat`);
    }
    if (mode === 'fox' || mode === 'mario') {
      const fighter = mode === 'fox' ? 'Fx' : 'Mr';
      const clip = await session.clip(fighter, action); signal.throwIfAborted();
      main.setAnimation(clip); duration = Math.max(1, clip.endFrame); loaded.add(`Pl${fighter}AJ.dat`);
    }
    const stats: SceneStats = instances.reduce((sum, instance) => ({
      triangles: sum.triangles + instance.model.stats.triangles,
      joints: sum.joints + instance.model.stats.joints,
      textures: sum.textures + instance.model.stats.textures,
    }), { triangles: 0, joints: 0, textures: 0 });
    return { instances, title, duration, loaded: [...loaded], stats, warnings: [...new Set(instances.flatMap((instance) => instance.model.warnings))] };
  } catch (error) {
    for (const instance of instances) instance.dispose();
    throw error;
  }
}
