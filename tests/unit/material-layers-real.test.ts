import { describe, expect, it } from 'vitest';
import { openDisc } from '../../scripts/node-disc.ts';
import { readExact, verifyAceDisc, verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdArchive } from '../../lib/hsd/archive.ts';
import { isSpecularOnlyLayer, resolveMaterialLayers, textureColorMap, textureCoord } from '../../lib/hsd/model.ts';
import { loadModel } from '../../lib/hsd/model.ts';

const iso = process.env.MELEE_DISC_PATH, aceIso = process.env.MELEE_ACE_ISO;
async function modelOf(file: string, ace = false) {
  const reader = await openDisc((ace ? aceIso : iso)!);
  try {
    const info = ace ? await verifyAceDisc(reader) : await verifyMeleeDisc(reader);
    const entry = info.files.find((f) => f.path === file);
    if (!entry) throw new Error(`Disc is missing ${file}.`);
    return loadModel(new HsdArchive(await readExact(reader, entry.offset, entry.size)));
  } finally {
    await reader.close();
  }
}

/** Character-selector/in-game color regressions, verified against the discs:
 * Luigi/Luigi&Boo black faces and Captain Falcon's white suit come from
 * specular sheen overlays replacing the diffuse; Metal Mario's white body from
 * dropped reflection-coordinate environment layers. */
describe.skipIf(!iso)('fighter material layers on the original disc', () => {
  it('adds (never replaces) specular sheen overlays on Luigi and Captain Falcon', async () => {
    for (const file of ['PlLgNr.dat', 'PlCaNr.dat']) {
      const model = await modelOf(file);
      let sheen = 0, misrouted = 0;
      for (const root of model.roots) for (const part of root.parts) {
        const resolved = resolveMaterialLayers(part.material, (set) => part.geometry.uvs.has(set));
        const specOverlays = part.material.textures.slice(1).filter((t) => isSpecularOnlyLayer(t.flags));
        if (specOverlays.length && resolved.overlay) {
          sheen++;
          if (!resolved.overlayAdditive) misrouted++;
        }
      }
      // Luigi's face/eyes and Falcon's suit/helmet all carry sheen layers.
      expect(sheen).toBeGreaterThan(5);
      expect(misrouted).toBe(0);
    }
  }, 30000);
  it('resolves a textured base layer for every Luigi/Falcon part', async () => {
    for (const file of ['PlLgNr.dat', 'PlCaNr.dat']) {
      const model = await modelOf(file);
      for (const root of model.roots) for (const part of root.parts) {
        const resolved = resolveMaterialLayers(part.material, (set) => part.geometry.uvs.has(set));
        if (part.material.textures.length) expect(resolved.source, `${file} part ${part.dobjIndex}`).toBeDefined();
      }
    }
  }, 30000);
  it('leaves Mr. Game & Watch untextured (spawn diffuse supplies the black)', async () => {
    const model = await modelOf('PlGwNr.dat');
    for (const root of model.roots) for (const part of root.parts) {
      const resolved = resolveMaterialLayers(part.material, (set) => part.geometry.uvs.has(set));
      expect(resolved.source).toBeUndefined();
      expect(resolved.overlay).toBeUndefined();
    }
  }, 30000);
  it('keeps diffuse-role stage decal overlays on the file colormap path', async () => {
    const model = await modelOf('GrNBa.dat');
    let decals = 0;
    for (const root of model.roots) for (const part of root.parts) {
      const resolved = resolveMaterialLayers(part.material, (set) => part.geometry.uvs.has(set));
      if (resolved.overlay && !resolved.overlayReflection && !isSpecularOnlyLayer(resolved.overlay.flags)) decals++;
    }
    expect(decals).toBeGreaterThan(0);
  }, 30000);
  it('keeps the Great Fox hull shading washes on the file REPLACE path', async () => {
    // Corneria's hull middle (0x3c mats with broad SPEC+REPLACE washes) samples the
    // mid-gray artwork directly; forcing those additive blows the hull out white.
    // Fighter sheens (SPEC+BLEND/MODULATE, asserted additive above) are unaffected:
    // no fighter model ships a SPEC+REPLACE overlay (see spec-replace survey).
    const model = await modelOf('GrCn.dat');
    let wash = 0, sheen = 0;
    for (const root of model.roots) for (const part of root.parts) {
      const resolved = resolveMaterialLayers(part.material, (set) => part.geometry.uvs.has(set));
      if (resolved.overlay && isSpecularOnlyLayer(resolved.overlay.flags)) {
        expect(Number.isFinite(part.material.shininess) && part.material.shininess > 0).toBe(true);
        if (textureColorMap(resolved.overlay.flags) === 5) {
          expect(resolved.overlayAdditive).toBe(false);
          wash++;
        } else {
          expect(resolved.overlayAdditive).toBe(true);
          sheen++;
        }
      }
    }
    expect(wash).toBeGreaterThan(5);
    expect(sheen).toBeGreaterThan(0);
  }, 30000);
});

describe.skipIf(!iso || !aceIso)('fighter material layers on the ACE extension disc', () => {
  it('samples Metal Mario chrome from reflection layers, never white', async () => {
    const model = await modelOf('PlMMNr.dat', true);
    let chrome = 0, bare = 0;
    for (const root of model.roots) for (const part of root.parts) {
      const resolved = resolveMaterialLayers(part.material, (set) => part.geometry.uvs.has(set));
      if (!resolved.source) { bare++; continue; }
      if (resolved.sourceReflection) {
        chrome++;
        expect(textureCoord(resolved.source.flags)).toBe(1);
      }
    }
    expect(bare).toBe(0);
    expect(chrome).toBeGreaterThan(40);
  }, 30000);
  it('adds Luigi & Boo sheen overlays like vanilla Luigi', async () => {
    const model = await modelOf('PlLbNr.dat', true);
    let sheen = 0;
    for (const root of model.roots) for (const part of root.parts) {
      const resolved = resolveMaterialLayers(part.material, (set) => part.geometry.uvs.has(set));
      if (resolved.overlay && resolved.overlayAdditive) sheen++;
    }
    expect(sheen).toBeGreaterThan(5);
  }, 30000);
});
