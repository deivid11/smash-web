import { HsdArchive, linkedList } from './archive.ts';
import { decodeKeyframes, type JointAnimation } from './animation.ts';
import type { ModelRoot } from './model.ts';
import { decodeTexture, textureByteSize, type DecodedTexture, type Palette } from './texture.ts';

export interface TextureAnimation { id: number; animation: JointAnimation | null; images: DecodedTexture[] }
export interface MaterialAnimation { animation: JointAnimation | null; textures: TextureAnimation[] }
function aobj(arc: HsdArchive, pointer: number): JointAnimation | null {
  if (!pointer) return null;
  const endFrame = arc.f32(pointer + 4);
  if (endFrame < 0 || endFrame > 100000) throw new Error('Invalid effect animation duration.');
  let keyCount = 0;
  const tracks = linkedList(arc, arc.pointer(pointer + 8), 0, 64).map((track) => {
    const keys = decodeKeyframes(arc.slice(arc.pointer(track + 16), arc.u32(track + 4)), arc.u8(track + 13), arc.u8(track + 14));
    keyCount += keys.length; if (keyCount > 100000) throw new Error('Effect animation key budget exceeded.');
    const start = arc.f32(track + 8); keys.forEach((key) => { key.time += start; });
    return { type: arc.u8(track + 12), keys };
  });
  return { endFrame, tracks };
}
const cache = new WeakMap<ModelRoot, Map<string, MaterialAnimation>>();
export function loadMaterialAnimations(arc: HsdArchive, root: ModelRoot): Map<string, MaterialAnimation> {
  const cached = cache.get(root); if (cached) return cached;
  const result = new Map<string, MaterialAnimation>();
  if (!root.materialAnimationPointer) return result;
  let index = 0, pixels = 0;
  const visited = new Set<number>(), images = new Map<string, DecodedTexture>();
  function image(pointer: number, palettePointer: number): DecodedTexture {
    const key = `${pointer}:${palettePointer}`, cached = images.get(key); if (cached) return cached;
    const width = arc.u16(pointer + 4), height = arc.u16(pointer + 6), format = arc.u32(pointer + 8);
    pixels += width * height; if (pixels > 16_777_216) throw new Error('Effect texture animation pixel budget exceeded.');
    let palette: Palette | undefined;
    if (palettePointer) palette = { format: arc.u32(palettePointer + 4), bytes: arc.slice(arc.pointer(palettePointer), arc.u16(palettePointer + 12) * 2) };
    const decoded = decodeTexture(arc.slice(arc.pointer(pointer), textureByteSize(format, width, height)), format, width, height, palette);
    images.set(key, decoded); return decoded;
  }
  function visit(pointer: number, depth: number): void {
    if (visited.has(pointer) || depth > 128 || index >= root.joints.length) throw new Error('Invalid material animation hierarchy.');
    visited.add(pointer);
    const joint = root.joints[index++]!;
    const dobjs = joint.flags & (0x20 | 0x4000) ? [] : linkedList(arc, arc.pointer(joint.id + 16), 4);
    const materials = linkedList(arc, arc.pointer(pointer + 8), 0);
    materials.forEach((material, i) => {
      const dobj = dobjs[i]; if (dobj === undefined) return;
      const id = arc.pointer(dobj + 8);
      const textures = linkedList(arc, arc.pointer(material + 8), 0, 16).map((texture): TextureAnimation => {
        const imageTable = arc.pointer(texture + 12), paletteTable = arc.pointer(texture + 16);
        const count = arc.u16(texture + 20), palettes = arc.u16(texture + 22);
        if (count > 256 || palettes > 256) throw new Error('Oversized effect texture animation table.');
        return { id: arc.u32(texture + 4), animation: aobj(arc, arc.pointer(texture + 8)),
          images: imageTable ? Array.from({ length: count }, (_, n) => image(arc.pointer(imageTable + n * 4), paletteTable && palettes ? arc.pointer(paletteTable) : 0)) : [] };
      });
      result.set(`${joint.id}:${id}`, { animation: aobj(arc, arc.pointer(material + 4)), textures });
    });
    for (const child of linkedList(arc, arc.pointer(pointer), 4)) visit(child, depth + 1);
  }
  visit(root.materialAnimationPointer, 0);
  cache.set(root, result); return result;
}
