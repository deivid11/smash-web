import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { loadMaterialAnimations } from '../../lib/hsd/material-animation.ts';
import { supportedStage } from '../../lib/game/stages.ts';
import { ModelInstance } from '../../web/src/render/model-instance.ts';

/** Stage texture scrolls come from each map_head entry's MatAnim table. Two stages animate a
 * palette-indexed frame whose palette that table does not carry, so their material animation
 * cannot be decoded: the stage must stay playable (static textures on that object) instead of
 * taking the whole model — and with it match start and the stage thumbnail — down with it. */
const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('stage texture animations', () => {
  let session: HsdAssetSession, disc: Awaited<ReturnType<typeof openDisc>>;
  beforeAll(async () => {
    disc = await openDisc(iso!);
    const info = await verifyMeleeDisc(disc);
    session = new HsdAssetSession({ size: disc.size, read: (offset, length) => disc.read(offset, length) }, info);
  }, 120_000);
  afterAll(async () => { await disc?.close(); });

  it('keeps a stage playable when its texture animation cannot be decoded', async () => {
    for (const id of ['onett', 'mushroom-kingdom'] as const) {
      const model = await session.model(supportedStage(id).asset);
      const animated = model.roots.filter((root) => root.materialAnimationPointer);
      expect(animated.length).toBeGreaterThan(0);
      // The data defect itself: one root's table refuses to decode.
      const failures = animated.filter((root) => {
        try { loadMaterialAnimations(model.archive, root); return false; } catch { return true; }
      });
      expect(failures.length).toBeGreaterThan(0);
      // The model still builds, and says which root lost its animation.
      const instance = new ModelInstance(model, false, false, true);
      try {
        expect(model.warnings.some((warning) => warning.includes('texture animation ignored'))).toBe(true);
      } finally { instance.dispose(); }
    }
  }, 180_000);

  it('still loads the texture animations of a healthy stage', async () => {
    const model = await session.model(supportedStage('final').asset);
    const animated = model.roots.filter((root) => root.materialAnimationPointer);
    expect(animated.length).toBeGreaterThan(0);
    for (const root of animated) expect(loadMaterialAnimations(model.archive, root).size).toBeGreaterThan(0);
    const instance = new ModelInstance(model, false, false, true);
    try {
      expect(model.warnings.some((warning) => warning.includes('texture animation ignored'))).toBe(false);
    } finally { instance.dispose(); }
  }, 180_000);
});
