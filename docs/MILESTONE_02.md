# Milestone 02: original Melee visuals in the browser

## Result

This milestone established rendering of original models, textures, joint hierarchies, skin envelopes, and animation tracks from the user's verified USA v1.02 disc. It originally used local browser file reads. A later user-requested server mode streams selected assets from the server's ISO; see [docs/SERVER_SOURCE.md](SERVER_SOURCE.md). Neither mode bundles game assets into the static app.

**This is a working original-asset viewer, not playable Melee.** It does not run combat, collisions, movement physics, original camera logic, audio, stage scripts, or networking.

Open the development viewer at http://127.0.0.1:5270/viewer.html, select the extracted ISO, and use the scene/animation controls. The static preview uses port 5271 unless overridden when launched.

## Demonstrated scenes

| Scene | Original content read locally | Observed geometry |
| --- | --- | --- |
| Battlefield + Fox + Mario | Stage archive, two fighter models, fighter metadata and animation ranges | 26,269 triangles / 207 joints |
| Final Destination + two fighters | Original stage and background geometry + fighter models | 26,583 triangles / 229 joints |
| Yoshi's Story + two fighters | Original stage, scenery, textures, and fighters | 21,271 triangles / 206 joints |
| Fox close-up | Original skinned model and selected clip | 6,658 triangles / 73 joints |
| Mario close-up | Original skinned model and selected clip | 6,328 triangles / 61 joints |
| Mario trophy | Original static trophy model | 6,016 triangles / 7 joints |
| Battlefield + four models | Two repeated Fox/Mario pairs; a render stress test, not multiplayer | 39,255 triangles |

Idle, walk, run, jab, and neutral-aerial animation clips are selectable. These only drive original pose data; selecting a jab does not implement attacks or hitboxes. Camera orbit, zoom, pause, frame seeking, and local PNG export work. Exported PNGs are labeled as an original-asset viewer without gameplay.

## Implementation

- [lib/hsd/archive.ts](../lib/hsd/archive.ts): bounded big-endian archive tables, relocation targets, symbols, and linked-list checks.
- [lib/hsd/texture.ts](../lib/hsd/texture.ts): tiled I4/I8/IA4/IA8, RGB565, RGB5A3, RGBA8, C4/C8/C14X2, and CMPR texture decoding.
- [lib/hsd/geometry.ts](../lib/hsd/geometry.ts): direct/indexed GX attributes, vertex colors, matrix indexes, and triangle/quad/strip/fan conversion.
- [lib/hsd/model.ts](../lib/hsd/model.ts): JObj/DObj/PObj/MObj/TObj data, stage roots, textures, inverse bind matrices, and skin envelopes.
- [lib/hsd/animation.ts](../lib/hsd/animation.ts): compressed little-endian FObj values, figatree action clips, stage joint animations, and duration-scaled Hermite interpolation.
- [lib/hsd/session.ts](../lib/hsd/session.ts): bounded local asset reads, limited model caching, and action-table range validation.
- [web/src/render/model-instance.ts](../web/src/render/model-instance.ts): HSD transforms/Maya scale compensation, GPU matrix palettes, texture transforms, basic material/alpha modes, and clockwise GX culling conversion.
- [web/src/render/viewer.ts](../web/src/render/viewer.ts): Three.js renderer, camera controls, presentation clock, resource disposal, and PNG output.
- [web/src/viewer-page.ts](../web/src/viewer-page.ts): local disc selection and the visual workbench.

The renderer initially appeared inside-out even though the geometry and textures decoded correctly. GX front-face winding is clockwise relative to Three.js's convention; correcting the cull mapping restored exterior surfaces and background domes. This has a regression test rather than being hidden by permanently disabling culling.

Three.js is used as an **inspection adapter**, not a decision to rewrite the gameplay engine. The RNG WASM target is unchanged; the viewer's animation decoder is TypeScript, not the full C HSD runtime. Research/adaptation credits and licenses are in [third_party/NOTICE.md](../third_party/NOTICE.md).

## Verification

- Production build and strict TypeScript checking passed.
- **91 unit tests passed.** Added tests cover HSD bounds/cycles, tiled texture formats/palettes, GX primitive conversion, culling, joint matrices, animation streams, Hermite timing, and asset-read limits.
- **13 Chromium tests passed with the real local ISO supplied.** They verify nonblank textured rendering, no asset network requests, original animation movement and repeatable seek-back images, multiple scenes, four-model rendering, screenshot download, and privacy/mobile regressions.
- Additional production-preview captures exercised all six scene modes and five Fox animation choices with no browser runtime/shader errors.
- These are rendering/format checks, **not** proof of bit-exact GameCube behavior or full-engine determinism.

Historical screenshots and private capture reports are not shipped in the source or public build.

## Known limitations / next work

- Material evaluation is incomplete: first diffuse UV texture, a subset of color/alpha blending, and approximate lighting. Full multi-texture TEV graphs, reflection/toon coordinates, and material/texture animations remain missing. Some surfaces (particularly Final Destination) visibly differ from the original.
- Game-selected background/mesh visibility and fighter display switches are not executed. Some optional meshes or background layers may be visible when the real game would hide them.
- Billboard, spline, particle, and morph-target behavior is not fully implemented; these are reported rather than presented as faithful effects.
- The preview camera, actor placement, and animation clock are viewer controls. Stage-floor alignment and root-motion gameplay rules are not simulated.
- Shader/resource use is verified in Chromium with software WebGL for tests. This does not establish mobile performance, competitive latency, or broad GPU compatibility.
- Geometry/pose rendering is recognizable and repeatable, but a pixel/pose comparison against the original running game remains necessary.

Next: improve the original material/visibility behavior, add reference comparisons, and then establish a headless original-C simulation boundary before claiming a playable match.
