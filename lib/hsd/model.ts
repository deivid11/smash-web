// HSD layout interpretation informed by doldecomp and noclip.website.
// See third_party/NOTICE.md and third_party/noclip.LICENSE.
import { HsdArchive, linkedList } from './archive.ts';
import { loadGeometry, type GeometryData } from './geometry.ts';
import { deferredTexture, textureByteSize, type DecodedTexture, type Palette } from './texture.ts';

export type V3 = [number, number, number];
export interface TextureTev {
  colorOp: number; alphaOp: number; colorBias: number; alphaBias: number; colorScale: number; alphaScale: number;
  colorClamp: boolean; alphaClamp: boolean; colorIn: number[]; alphaIn: number[];
  constant: [number, number, number, number]; register0: [number, number, number, number]; register1: [number, number, number, number]; active: number;
}
export interface ModelTexture {
  image: DecodedTexture; flags: number; uvSet: number; wrapS: number; wrapT: number; animId: number;
  scale: V3; translation: V3; rotation: V3; repeatS: number; repeatT: number; blending: number; tev?: TextureTev;
}
export interface ModelMaterial {
  id: number; color: [number, number, number]; alpha: number; renderMode: number;
  /** GX specular power (HSD_Material.shininess): the NdotH exponent scaling the
   * specular TEV stage. Always present in the file block; guarded at parse. */
  shininess: number;
  textures: ModelTexture[]; transparent: boolean; depthWrite: boolean; additive: boolean;
}
export interface ModelJoint {
  id: number; flags: number; parent: number; children: number[];
  rotation: V3; scale: V3; translation: V3; inverseBind: number[];
}
export interface Influence { joint: number; weight: number }
export interface ModelPart {
  owner: number; flags: number; geometry: GeometryData; material: ModelMaterial;
  kind: 'rigid' | 'envelope'; reference: number; envelopes: Influence[][];
  /** Draw-object ordinal in the original traversal order (ftParts dobj_list index). */
  dobjIndex: number;
}
export interface ModelRoot { joints: ModelJoint[]; parts: ModelPart[]; name: string; animationPointer: number; materialAnimationPointer: number;
  /** Zero-based map_head entry this root was built from (roots skip null-joint entries). */
  entry: number;
  /** Original per-object distance fog (HSD_FogDesc at entry +0x1C, applied per map
   * gobj by HSD_FogSet): color as 0-1 floats, start/end in world units (already
   * scaled by grGroundParam). Absent when the entry defines no fog. */
  fog?: ModelFog }
/** Original GX linear-fog parameters for one stage map object. */
export interface ModelFog { color: [number, number, number]; start: number; end: number }
/** HSD_TObj `blend_flags` decoding (third_party/melee src/sysdolphin/baselib/tobj.h):
 * coordinate generation (TEX_COORD_MASK), lightmap stage role (TEX_LIGHTMAP_MASK),
 * TEV color composition (TEX_COLORMAP_*) and TEV alpha composition (TEX_ALPHAMAP_*).
 * The game builds GX TEV stages from exactly these bits (MObjMakeTExp/TObjMakeTExp
 * in mobj.c/tobj.c); the renderer must honor them instead of guessing. Pure. */
export const TEX_COORD_UV = 0;
export const TEX_COORD_REFLECTION = 1;
export function textureCoord(flags: number): number { return flags & 15; }
/** Lightmap role bits (already shifted): 1 diffuse, 2 specular, 4 ambient, 8 ext, 16 shadow. */
export function textureLightmap(flags: number): number { return (flags >>> 4) & 31; }
export const LIGHTMAP_DIFFUSE = 1;
export const LIGHTMAP_SPECULAR = 2;
/** TEV color composition for the texture's stage (0 none, 1 alpha-mask, 2 rgb-mask,
 * 3 blend, 4 modulate, 5 replace, 6 pass, 7 add, 8 sub). */
export function textureColorMap(flags: number): number { return (flags >>> 16) & 15; }
export function textureAlphaMap(flags: number): number { return (flags >>> 20) & 15; }
/** A specular-role-only layer (fighter sheen/highlight blobs) is ADDED to the lit
 * diffuse by the original specular TEV path (MObjMakeTExp RENDER_SPECULAR: the
 * layer feeds `spec`, which is added to `diff`); it must never replace it.
 * Scoped to BLEND/MODULATE/ADD/SUB colormaps: every fighter specular overlay
 * uses one of those, while stage shading washes (Great Fox hull) use REPLACE —
 * full-artwork mid-gray copies that the old path samples directly, so REPLACE
 * keeps the file behavior there (verified: no fighter model ships a
 * SPEC+REPLACE overlay). The RAS COLOR1A1 magnitude stays approximated. */
export function isSpecularOnlyLayer(flags: number): boolean { return textureLightmap(flags) === LIGHTMAP_SPECULAR; }
export function isAdditiveSpecularLayer(flags: number): boolean {
  if (!isSpecularOnlyLayer(flags)) return false;
  const mode = textureColorMap(flags);
  return mode === 3 || mode === 4 || mode === 7 || mode === 8;
}
export interface ResolvedMaterialLayers {
  source?: ModelTexture; overlay?: ModelTexture;
  /** Sample the source with generated reflection coordinates (sphere-mapped normals). */
  sourceReflection: boolean;
  /** Sample the overlay with generated reflection coordinates. */
  overlayReflection: boolean;
  /** Compose the overlay additively (specular path) instead of its file colormap mode. */
  overlayAdditive: boolean;
}
/** Pick the two sampled layers for one draw part. The game samples every TObj in
 * list order through its own stage role; the approximation keeps at most two:
 * the first diffuse/ambient/ext-role layer as the base, plus the first remaining
 * specular-role layer (sheen) or a second diffuse/ext layer (decal) as overlay.
 * Reflection-coordinate layers carry no stored UVs and are sampled with generated
 * sphere-map coordinates. `hasUvSet` reports the part geometry's stored UV sets.
 * Pure (unit-tested); the renderer only binds what this returns. */
export function resolveMaterialLayers(material: ModelMaterial, hasUvSet: (set: number) => boolean): ResolvedMaterialLayers {
  // MObjMakeTExp only chains TObjs with a diffuse/ambient/specular/ext lightmap role;
  // role-less layers (TEX_BUMP maps, HSDRaw leftovers like PlCnNr's clamped skin
  // overlay) never reach the colour TEV, so they must not be sampled here either.
  const textures = material.textures.filter((texture) => textureLightmap(texture.flags) !== 0);
  const uv = textures.filter((texture) => textureCoord(texture.flags) === TEX_COORD_UV && texture.uvSet >= 0 && texture.uvSet < 8);
  const refl = textures.filter((texture) => textureCoord(texture.flags) === TEX_COORD_REFLECTION);
  const source = uv[0] ?? refl[0];
  let overlay = uv.slice(1).find((texture) => hasUvSet(texture.uvSet));
  let overlayReflection = false;
  if (!overlay) {
    const candidate = textures.find((texture) => texture !== source && textureCoord(texture.flags) === TEX_COORD_REFLECTION);
    if (candidate) { overlay = candidate; overlayReflection = true; }
  }
  return {
    source, overlay,
    sourceReflection: !!source && textureCoord(source.flags) === TEX_COORD_REFLECTION,
    overlayReflection,
    overlayAdditive: !!overlay && isAdditiveSpecularLayer(overlay.flags),
  };
}
export interface HsdModel {
  archive: HsdArchive; roots: ModelRoot[]; warnings: string[];
  /** Per map_head entry fog (entry order, null where the entry defines none).
   * The scene background uses the callbacks-flagged entry (Ground_801C1E94);
   * that index is code-side knowledge kept in lib/game/stages.ts. */
  fogEntries: ReadonlyArray<ModelFog | null>;
  stats: { joints: number; meshes: number; vertices: number; triangles: number; textures: number };
}

export function loadModel(archive: HsdArchive, override?: { offset: number; name: string; animation?: number; materialAnimation?: number }): HsdModel {
  const arc = archive;
  const warnings = new Set<string>();
  const materials = new Map<number, ModelMaterial>();
  const images = new Map<string, DecodedTexture>();
  let texturePixels = 0, totalVertices = 0, totalParts = 0, totalJoints = 0;
  const vector = (offset: number): V3 => [arc.f32(offset), arc.f32(offset + 4), arc.f32(offset + 8)];
  function texture(offset: number): ModelTexture {
    arc.range(offset, 0x5c);
    const image = arc.pointer(offset + 0x4c);
    if (!image) throw new Error('Texture descriptor has no image.');
    const paletteOffset = arc.pointer(offset + 0x50);
    const key = `${image}:${paletteOffset}`;
    let decoded = images.get(key);
    if (!decoded) {
      const pixels = arc.pointer(image), width = arc.u16(image + 4), height = arc.u16(image + 6), format = arc.u32(image + 8);
      const bytes = arc.slice(pixels, textureByteSize(format, width, height));
      texturePixels += width * height;
      if (texturePixels > 16_777_216) throw new Error('Scene texture memory budget exceeded.');
      let palette: Palette | undefined;
      if (paletteOffset) {
        const count = arc.u16(paletteOffset + 12);
        palette = { format: arc.u32(paletteOffset + 4), bytes: arc.slice(arc.pointer(paletteOffset), count * 2) };
      }
      // Copies keep only the encoded texels alive (not the whole model archive) until first draw.
      decoded = deferredTexture(bytes.slice(), format, width, height, palette && { format: palette.format, bytes: palette.bytes.slice() });
      images.set(key, decoded);
    }
    const flags = arc.u32(offset + 0x40), tevPointer = arc.pointer(offset + 0x58);
    let tev: TextureTev | undefined;
    if (tevPointer) {
      arc.range(tevPointer, 32);
      const rgba = (at: number): [number, number, number, number] => [0,1,2,3].map(i => arc.u8(at+i)/255) as [number, number, number, number];
      tev = { colorOp: arc.u8(tevPointer), alphaOp: arc.u8(tevPointer+1), colorBias: arc.u8(tevPointer+2), alphaBias: arc.u8(tevPointer+3),
        colorScale: arc.u8(tevPointer+4), alphaScale: arc.u8(tevPointer+5), colorClamp: !!arc.u8(tevPointer+6), alphaClamp: !!arc.u8(tevPointer+7),
        colorIn: [...arc.slice(tevPointer+8,4)], alphaIn: [...arc.slice(tevPointer+12,4)], constant: rgba(tevPointer+16), register0: rgba(tevPointer+20), register1: rgba(tevPointer+24), active: arc.u32(tevPointer+28) };
      if (tev.colorOp > 1 || tev.alphaOp > 1) warnings.add('Custom TEV comparison operations are not evaluated.');
    }
    if ((flags & 15) !== 0) warnings.add('Reflection/toon texture coordinate generation is not evaluated.');
    return {
      image: decoded, flags, tev, uvSet: arc.u32(offset + 12) - 4, animId: arc.u32(offset + 8),
      wrapS: arc.u32(offset + 0x34), wrapT: arc.u32(offset + 0x38),
      repeatS: arc.u8(offset + 0x3c), repeatT: arc.u8(offset + 0x3d), blending: arc.f32(offset + 0x44),
      scale: vector(offset + 0x1c), translation: vector(offset + 0x28), rotation: vector(offset + 0x10),
    };
  }
  function material(offset: number): ModelMaterial {
    const cached = materials.get(offset);
    if (cached) return cached;
    arc.range(offset, 0x18);
    const renderMode = arc.u32(offset + 4);
    const data = arc.pointer(offset + 12);
    if (!data) throw new Error('Missing HSD material data.');
    const color: [number, number, number] = [arc.u8(data + 4) / 255, arc.u8(data + 5) / 255, arc.u8(data + 6) / 255];
    const alpha = arc.f32(data + 12);
    const shininess = arc.f32(data + 16);
    const textures = linkedList(arc, arc.pointer(offset + 8), 4, 16).map(texture);
    if (textures.length > 1) warnings.add('Extra texture layers past the base and one overlay are approximated away, not the full GameCube GX renderer.');
    const pe = arc.pointer(offset + 20);
    const result: ModelMaterial = {
      id: offset, color, alpha: Math.min(1, Math.max(0, alpha)), renderMode,
      shininess: Number.isFinite(shininess) && shininess > 0 ? Math.min(shininess, 255) : 32,
      textures,
      transparent: !!(renderMode & 0x40000000) || (pe !== 0 && arc.u8(pe + 4) === 1),
      depthWrite: pe ? !!(arc.u8(pe) & 32) : !(renderMode & 0x20000000),
      additive: pe !== 0 && arc.u8(pe + 6) === 1 && arc.u8(pe + 4) === 1,
    };
    if (materials.size >= 4096) throw new Error('HSD material budget exceeded.');
    materials.set(offset, result);
    return result;
  }
  function root(offset: number, name: string, animationPointer = 0, materialAnimationPointer = 0, entry = -1, fog?: ModelFog): ModelRoot {
    const joints: ModelJoint[] = [], parts: ModelPart[] = [];
    const visited = new Set<number>();
    let dobjCount = 0;
    function joint(pointer: number, parent: number, depth: number): number {
      if (depth > 128 || visited.has(pointer) || ++totalJoints > 20_000) throw new Error('Cyclic or oversized HSD joint tree.');
      visited.add(pointer); arc.range(pointer, 0x40);
      const index = joints.length;
      const flags = arc.u32(pointer + 4);
      if (flags & 0x20000) warnings.add('Quaternion-specific joint transforms are not evaluated.');
      if (flags & 0xf00) warnings.add('Billboard-specific joint transforms are not evaluated.');
      const inverse = arc.pointer(pointer + 0x38);
      const inverseBind = inverse ? Array.from({ length: 12 }, (_, i) => arc.f32(inverse + i * 4)) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
      const node: ModelJoint = {
        id: pointer, flags, parent, children: [], rotation: vector(pointer + 0x14),
        scale: vector(pointer + 0x20), translation: vector(pointer + 0x2c), inverseBind,
      };
      joints.push(node);
      const contents = arc.pointer(pointer + 0x10);
      const skipContents = !!(contents && (flags & (0x20 | 0x4000)));
      if (skipContents) warnings.add('Particles/splines are omitted from this model-only preview.');
      // Pre-order draw-object ordinals, as ftParts_SetupParts assigns them before descending.
      const dobjList = skipContents ? [] : linkedList(arc, contents, 4), firstDobj = dobjCount;
      dobjCount += dobjList.length;
      const child = arc.pointer(pointer + 8);
      for (const childPtr of linkedList(arc, child, 12, 4096)) node.children.push(joint(childPtr, index, depth + 1));
      for (const [dobjOffset, dobj] of dobjList.entries()) {
        const dobjIndex = firstDobj + dobjOffset;
        const matPtr = arc.pointer(dobj + 8);
        if (!matPtr) { warnings.add('A draw object with no material was omitted.'); continue; }
        const mat = material(matPtr);
        for (const pobj of linkedList(arc, arc.pointer(dobj + 12), 4)) {
          if (++totalParts > 10_000) throw new Error('HSD mesh budget exceeded.');
          const flags = arc.u16(pobj + 12), kind = flags & 0x3000;
          if (kind === 0x3000) throw new Error('Invalid HSD polygon type.');
          if (kind === 0x1000) warnings.add('Morph-target deformation is not evaluated; base geometry only.');
          const geometry = loadGeometry(arc, arc.pointer(pobj + 8), arc.pointer(pobj + 16), arc.u16(pobj + 14) * 32);
          totalVertices += geometry.matrices.length;
          if (totalVertices > 2_000_000) throw new Error('HSD scene vertex budget exceeded.');
          const contents = arc.pointer(pobj + 20);
          const envelopes: Influence[][] = [];
          if (kind === 0x2000 && contents) {
            for (let i = 0; ; i++) {
              const envelope = arc.pointer(contents + i * 4);
              if (envelope === 0) break;
              if (i >= 10) throw new Error('Too many HSD matrix envelopes.');
              const influences: Influence[] = [];
              for (let j = 0; ; j++) {
                const ref = arc.pointer(envelope + j * 8);
                if (ref === 0) break;
                if (j >= 32) throw new Error('Too many HSD skin influences.');
                const weight = arc.f32(envelope + j * 8 + 4);
                if (weight < 0 || weight > 1.0001) throw new Error('Invalid HSD skin weight.');
                influences.push({ joint: ref, weight });
              }
              if (influences.length === 0) throw new Error('Empty HSD skin envelope.');
              envelopes.push(influences);
            }
          }
          // HSDRaw-authored meshes can mark a polygon as enveloped yet ship no envelope
          // list (PlTsNr.dat, joint 0): on console its vertices read stale GX matrix
          // slots from the previous draw. That geometry is unrenderable here — omit it.
          if (kind === 0x2000 && envelopes.length === 0) { warnings.add('A skinned polygon with no envelope list was omitted.'); continue; }
          parts.push({ owner: index, flags, geometry, material: mat, kind: kind === 0x2000 ? 'envelope' : 'rigid', reference: kind === 0 ? contents : 0, envelopes, dobjIndex });
        }
      }
      return index;
    }
    joint(offset, -1, 0);
    const ids = new Set(joints.map((joint) => joint.id));
    for (const part of parts) {
      if (part.kind === 'envelope') {
        for (const env of part.envelopes) for (const influence of env) if (!ids.has(influence.joint)) throw new Error('Skin envelope references a missing joint.');
        for (const matrix of part.geometry.matrices) if (matrix >= part.envelopes.length) throw new Error('Vertex references an invalid skin envelope.');
      } else if (part.reference && !ids.has(part.reference)) throw new Error('Rigid polygon references a missing joint.');
    }
    return { joints, parts, name, animationPointer, materialAnimationPointer, entry, ...(fog ? { fog } : {}) };
  }
  const roots: ModelRoot[] = [];
  const fogEntries: (ModelFog | null)[] = [];
  if (override) { roots.push(root(override.offset, override.name, override.animation, override.materialAnimation)); fogEntries.push(null); }
  else if (arc.symbols.has('map_head')) {
    const head = arc.symbol('map_head');
    const data = arc.pointer(head + 8), count = arc.u32(head + 12);
    if (count > 1024) throw new Error('Too many stage object roots.');
    arc.range(data, count * 0x34);
    // Fog start/end are stored in stage units (Ground_801C1E94 scales them by
    // grGroundParam, the same value parseStageGameplay reports as the stage
    // scale), so bake the scale here and keep every consumer in world units.
    const fogScale = arc.symbols.has('grGroundParam') ? arc.f32(arc.symbol('grGroundParam')) : 1;
    if (!Number.isFinite(fogScale) || fogScale <= 0 || fogScale > 5) throw new Error('Invalid stage scale for fog.');
    const fogAt = (entry: number): ModelFog | null => {
      const desc = arc.pointer(data + entry * 0x34 + 0x1c);
      if (!desc) return null;
      arc.range(desc, 20);
      const start = arc.f32(desc + 8), end = arc.f32(desc + 12);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1e7) throw new Error('Invalid stage fog range.');
      // Degenerate archived ranges (end <= start, e.g. GrGr.dat's 2000/2000
      // entries) disable fog; the background helper falls back to black, as the game does.
      if (end <= start) return null;
      return {
        color: [arc.u8(desc + 16) / 255, arc.u8(desc + 17) / 255, arc.u8(desc + 18) / 255],
        start: Math.fround(start * fogScale), end: Math.fround(end * fogScale),
      };
    };
    for (let i = 0; i < count; i++) {
      const pointer = arc.pointer(data + i * 0x34);
      const animTable = arc.pointer(data + i * 0x34 + 4);
      const animation = animTable && animTable !== 0xffffffff ? arc.pointer(animTable) : 0;
      // Stage material scrolls (Peach's Castle river, etc.) live in the map_head
      // entry's MatAnim table (+0x08, an HSD_MatAnimJoint** variant array parallel
      // to the joint table at +0x04). The loader previously passed 0 here, so every
      // stage texture stayed frozen at its rest pose. Bind variant 0 like the joint
      // path above; multi-variant intros (e.g. GrCs entry 2) rest on an empty
      // variant either way, and single-variant stages are unaffected.
      const matTable = arc.pointer(data + i * 0x34 + 8);
      const materialAnimation = matTable && matTable !== 0xffffffff ? arc.pointer(matTable) : 0;
      const fog = fogAt(i);
      fogEntries.push(fog);
      if (pointer && pointer !== 0xffffffff) roots.push(root(pointer, `Stage object ${i}`, animation, materialAnimation, i, fog ?? undefined));
    }
  } else {
    const symbol = [...arc.symbols].find(([name]) => name.endsWith('_joint'));
    if (!symbol) throw new Error('No supported HSD model root was found.');
    roots.push(root(symbol[1], symbol[0]));
  }
  warnings.add('Lighting and material blending are a viewer approximation, not the full GameCube GX renderer.');
  return {
    archive, roots, fogEntries, warnings: [...warnings],
    stats: { joints: totalJoints, meshes: totalParts, vertices: totalVertices, triangles: roots.reduce((sum, root) => sum + root.parts.reduce((n, part) => n + part.geometry.indices.length / 3, 0), 0), textures: images.size },
  };
}
