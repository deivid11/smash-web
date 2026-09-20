import { describe, expect, it } from 'vitest';
import {
  isAdditiveSpecularLayer, isSpecularOnlyLayer, resolveMaterialLayers, textureAlphaMap, textureColorMap,
  textureCoord, textureLightmap, type ModelMaterial, type ModelTexture,
} from '../../lib/hsd/model.ts';

const image = { width: 64, height: 64, pixels: new Uint8Array(64 * 64 * 4) } as ModelTexture['image'];
const tex = (flags: number, uvSet = 0): ModelTexture => ({
  image, flags, uvSet, wrapS: 0, wrapT: 0, animId: 0,
  scale: [1, 1, 1], translation: [0, 0, 0], rotation: [0, 0, 0],
  repeatS: 1, repeatT: 1, blending: 1,
});
const mat = (textures: ModelTexture[], renderMode = 0x14): ModelMaterial => ({
  id: 1, color: [1, 1, 1], alpha: 1, renderMode, shininess: 50, textures,
  transparent: false, depthWrite: true, additive: false,
});

describe('HSD TObj flag decoding (tobj.h)', () => {
  it('decodes coordinate generation, lightmap role and TEV maps', () => {
    // Base diffuse layer (Luigi overalls, Mario, single-texture fighters).
    expect(textureCoord(0x50010)).toBe(0);
    expect(textureLightmap(0x50010)).toBe(1);
    expect(textureColorMap(0x50010)).toBe(5);
    // Fighter sheen layer (Luigi face highlight, Falcon suit sheen).
    expect(textureCoord(0x30020)).toBe(0);
    expect(textureLightmap(0x30020)).toBe(2);
    expect(textureColorMap(0x30020)).toBe(3);
    expect(isSpecularOnlyLayer(0x30020)).toBe(true);
    expect(isSpecularOnlyLayer(0x50010)).toBe(false);
    // Reflection environment layer (Metal Mario chrome, Mario face skin).
    expect(textureCoord(0x40081)).toBe(1);
    expect(textureCoord(0x340011)).toBe(1);
    expect(textureLightmap(0x340011)).toBe(1);
    expect(textureColorMap(0x340011)).toBe(4);
    expect(textureAlphaMap(0x340011)).toBe(3);
    expect(isSpecularOnlyLayer(0x40081)).toBe(false);
  });
});

describe('resolveMaterialLayers', () => {
  it('returns nothing for untextured materials (Mr. Game & Watch)', () => {
    const resolved = resolveMaterialLayers(mat([], 0x1), () => false);
    expect(resolved.source).toBeUndefined();
    expect(resolved.overlay).toBeUndefined();
    expect(resolved.overlayAdditive).toBe(false);
  });
  it('never samples role-less layers (MObjMakeTExp skips them: PlCnNr skin, PlGkNr bump maps)', () => {
    // Chun-Li arms/face: diffuse base plus a clamped MODULATE layer with no lightmap role.
    const skin = tex(0x340010), leftover = tex(0x340000);
    const chunli = resolveMaterialLayers(mat([skin, leftover], 0x34), () => true);
    expect(chunli.source).toBe(skin);
    expect(chunli.overlay).toBeUndefined();
    // Giga Bowser: a TEX_BUMP map listed first must not become the colour base.
    const bump = tex(0x1050000), body = tex(0x50010);
    expect(resolveMaterialLayers(mat([bump, body], 0x3c), () => true).source).toBe(body);
  });
  it('resolves a single diffuse layer without overlay', () => {
    const diffuse = tex(0x50010);
    const resolved = resolveMaterialLayers(mat([diffuse]), () => true);
    expect(resolved.source).toBe(diffuse);
    expect(resolved.sourceReflection).toBe(false);
    expect(resolved.overlay).toBeUndefined();
  });
  it('routes a specular-role sheen overlay to the additive path (Luigi face, Falcon suit)', () => {
    const diffuse = tex(0x50010, 0), sheen = tex(0x30020, 1);
    const resolved = resolveMaterialLayers(mat([diffuse, sheen], 0x3c), (set) => set < 2);
    expect(resolved.source).toBe(diffuse);
    expect(resolved.overlay).toBe(sheen);
    expect(resolved.overlayAdditive).toBe(true);
    expect(resolved.overlayReflection).toBe(false);
  });
  it('keeps specular overlays with a REPLACE colormap on the file path (stage washes)', () => {
    // Great Fox hull shading maps: full-artwork mid-gray copies sampled directly.
    const diffuse = tex(0x50010, 0), wash = tex(0x50020, 1);
    const resolved = resolveMaterialLayers(mat([diffuse, wash], 0x3c), (set) => set < 2);
    expect(resolved.overlay).toBe(wash);
    expect(resolved.overlayAdditive).toBe(false);
    expect(isAdditiveSpecularLayer(0x50020)).toBe(false);
    expect(isAdditiveSpecularLayer(0x30020)).toBe(true);
  });
  it('keeps diffuse-role decal overlays on the file colormap path (stage markings)', () => {
    const diffuse = tex(0x50010, 0), decal = { ...tex(0x50010, 1), blending: 0.5 };
    const resolved = resolveMaterialLayers(mat([diffuse, decal]), (set) => set < 2);
    expect(resolved.overlay).toBe(decal);
    expect(resolved.overlayAdditive).toBe(false);
  });
  it('samples a lone reflection layer with generated coordinates (Metal Mario chrome)', () => {
    const env = tex(0x340011);
    const resolved = resolveMaterialLayers(mat([env], 0x40000014), () => false);
    expect(resolved.source).toBe(env);
    expect(resolved.sourceReflection).toBe(true);
    expect(resolved.overlay).toBeUndefined();
  });
  it('keeps a reflection sheen behind a diffuse base with generated overlay coordinates', () => {
    const diffuse = tex(0x50010, 0), sheen = { ...tex(0x40081, 1), blending: 0.45 };
    const resolved = resolveMaterialLayers(mat([diffuse, sheen], 0x3c), (set) => set === 0);
    expect(resolved.source).toBe(diffuse);
    expect(resolved.overlay).toBe(sheen);
    expect(resolved.overlayReflection).toBe(true);
    expect(resolved.overlayAdditive).toBe(false);
  });
  it('ignores overlays whose stored UV set the part geometry lacks', () => {
    const diffuse = tex(0x50010, 0), sheen = tex(0x30020, 1);
    const resolved = resolveMaterialLayers(mat([diffuse, sheen], 0x3c), (set) => set === 0);
    expect(resolved.overlay).toBeUndefined();
    expect(resolved.overlayAdditive).toBe(false);
  });
});
