# Shared fire reactions, hit sparks and ground dust

The playable renderer now consumes a bounded subset of the **original common effect bank**, rather than drawing the same ten-line star for every hit. Assets are decoded at runtime from the supported USA 1.02 disc. Nothing is extracted into the public build.

## Original-source mapping

Pinned source: `0bac93a5ee2f985dac6220bd36ed7078ae6ac0c9`.

- [third_party/melee/src/melee/ft/ftcoll.c:726](../third_party/melee/src/melee/ft/ftcoll.c#L726): hit-element table. Normal → 1000, fire → 1002, electric → 1001, slash → 1004. Fire is **an attack property**, not a character-wide flag. Cape/inert/grab handling is not interchangeable with fire.
- [third_party/melee/src/melee/ef/efasync.c:98](../third_party/melee/src/melee/ef/efasync.c#L98): normal hit chooses common model 9/10 and clamps `0.04 * damage + 0.3` to 0.3–1.5. Fire uses particle generator 20; electric uses 12; slash uses model 8 with a random Z rotation. The browser keeps a separate cosmetic seed rather than advancing gameplay RNG.
- [third_party/melee/src/sysdolphin/baselib/jobj.c:470](../third_party/melee/src/sysdolphin/baselib/jobj.c#L470): joint-animation channel 40 invokes particle generators. Its payload is an integer union member, not an ordinary float value. This matters: common hit model 10 has no meshes; its original animation launches generators **306 and 307**.
- [third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Damage.c:156](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Damage.c#L156): fire selects common color-script entries **11–14**, using scaled knockback severity. Their supported-disc durations are **28, 56, 112, 152 frames**. The scripts alternate original RGBA flashes and generators **55 / 225** (flames, then smoke), not a guessed permanent red tint. The same selector gives electric **15–18** (generator 0x13 body arcs on the cycling effect part), ice **31–34**, dark **35–38** (generator 406) and, for every other element, common script **4**: the victim's white hit flash (255,255,255,170 on frame 1, blended down to alpha 20 over six frames, cleared on frame 8). Blend command 19 (`lb_800140F8`) is interpolated per frame; light-overlay commands 13–17 are skipped.
- [third_party/melee/src/melee/ft/ftcoll.c:1385](../third_party/melee/src/melee/ft/ftcoll.c#L1385) `ftColl_80078538`: a normal-element hit spawns the damage-scaled spark (1000) only while knockback stays under `ftCommonData` **x3F0 = 180**; at or above it the **1011** flash (generator 11) plays instead. Hits with sound severity ≥ 1 on a victim whose `co_attrs.hit_spark_variant` is 0 add the **1007** sparkle generator (66, victim facing negated) with `HSD_Randi(x3F4 = 4) == 0` odds, drawn from the renderer's cosmetic seed.
- [third_party/melee/src/sysdolphin/baselib/psdisp.c:775](../third_party/melee/src/sysdolphin/baselib/psdisp.c#L775) `psDispSubMakePolygon` / `psDispSub`: sprites are squares of half-extent `size`; Trail/DirVec sprites turn to the velocity's *screen* direction (previous position → current, projected through the live camera) and Trail sprites span from the previous position to the current one with the sprite's own half-size overhang at both ends. The original rotation axis points away from the viewer, so script rotations are applied as the negative roll.
- [third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_09F7.c:70](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_09F7.c#L70): special part 0x8D cycles the fighter's five effect attachment parts from ftData +0x54. The renderer resolves those through each fighter's own part/joint mapping.
- [third_party/melee/src/melee/ef/efasync.c:261](../third_party/melee/src/melee/ef/efasync.c#L261): run cue **1022 / 0x3FE** launches common particle **263** with facing. The native Run scripts provide each fighter's footfall timing; the renderer does not spawn dust once per browser repaint.
- [third_party/melee/src/melee/ft/ftaction.c:1197](../third_party/melee/src/melee/ft/ftaction.c#L1197): opcode **55** carries the authored ground-contact effect fallback. Landing's **1028 / 0x404** uses common model 24. The opcode was previously skipped.
- [third_party/melee/src/melee/ft/ftmotionstates.c:596](../third_party/melee/src/melee/ft/ftmotionstates.c#L596) and [third_party/melee/src/melee/ft/kinds/ftCommon/forward.h:670](../third_party/melee/src/melee/ft/kinds/ftCommon/forward.h#L670): ordinary Landing uses raw submotion **35**. Earlier dead-camera entries reuse the Landing figatree name with an empty script. The loader now chooses the correct raw entry instead of the first matching name.

## Character behavior

Mario fireballs, Captain Falcon fire attacks, Fox's fire attacks, Roy's fire attacks, Link bombs and Young Link fire arrows all enter the shared fire-hit path when their parsed element is fire. The **victim** receives the reaction, regardless of which supported original fighter is struck.

Adult Link's arrow and boomerang use the **slash element**, not fire. The old catch-all projectile fire halo is removed; an unrecognized projectile kind no longer becomes fiery. Link arrow/boomerang facing is handled separately from fireball animation.

**Falco is not currently in the playable roster.** This work does not claim to import him or his moves. The shared element-based reaction needs no Falco-specific whitelist when his gameplay is added.

## Implementation and safety

- [lib/game/common-effects.ts](../lib/game/common-effects.ts): effect mappings, original model/animation cues and bounded common fire-color-script decoding.
- [lib/hsd/particle-bank.ts](../lib/hsd/particle-bank.ts): embedded command/texture-bank relocation, definition fields, original GX texture/palette decoding. Embedded pointers are relative to the particle bank, not the enclosing DAT. Decoded textures are bounded to 512 entries / 32 MiB.
- [lib/hsd/particle-player.ts](../lib/hsd/particle-player.ts): selected native texture-frame, color, size, velocity, gravity, friction, child-emission, loop and rotation commands. At most 192 live particles, 64 generators and four child levels; malformed or unsupported commands terminate that particle and produce diagnostics.
- [lib/game/moves.ts](../lib/game/moves.ts) and [lib/game/match.ts](../lib/game/match.ts): retain GFX offsets and landing cues, then emit them through the existing snapshotted animation cursor and confirmed event path. No new presentation RNG enters authoritative physics.
- [web/src/render/common-effects.ts](../web/src/render/common-effects.ts): native textured particle quads, animated models, victim attachments and color-script playback; bounded lifetime and reset/disposal.
- [web/src/render/model-instance.ts](../web/src/render/model-instance.ts): separate damage-color overlay, without changing charge tint, fighter opacity or gameplay poses.
- [web/src/render/play-effects.ts](../web/src/render/play-effects.ts) and [web/src/render/play-renderer.ts](../web/src/render/play-renderer.ts): integration and removal of generic hit lines / blanket projectile fire halos. Existing KO effects remain separate.

`window.smashEffectsSnapshot()` is read-only diagnostics for counts and unsupported-particle warnings. It exposes no mutable match controls, assets or private paths.

## Explicit limits

This is **not a complete HSD particle/GX port**. Generator-volume transforms and child inheritance, camera-facing trail geometry, dual alpha-comparison interpolation and prim/environment TEV composition remain bounded browser approximations. Particle random sequences are cosmetic and are not claimed equal to the GameCube's shared RNG stream. Stage-material-specific landing substitutions are not reproduced; the trail tail alpha (`trail` < 1) and the rim-light overlay commands are not drawn.

The work covers shared hit reactions and selected scripted ground effects, not every fighter-specific attack startup, weapon trail or emitter callback. Ice's attachment/attractor graph is not in this subset; existing coin accents and other unported effects must not be described as complete native particles. Native color overlays apply to model-rendered fighters; custom pose-art skins are a separate presentation system.

## Verification

- [tests/unit/common-effects-real.test.ts](../tests/unit/common-effects-real.test.ts): original mappings, fire-script durations, five-bone attachment tables, relative particle-bank pointers, all selected particle scripts/texture frames, resource bounds, cosmetic replay, unchanged match hashes, real run/landing cues, fire-only victim coloring, expiry/reset and no fake Link fire halos.
- [tests/server-browser/vfx.spec.ts](../tests/server-browser/vfx.spec.ts): real keyboard-driven running/jumping/landing, normal hits, Mario fireballs, Young Link fire arrows, Captain Falcon fire attacks and Link bomb self-fire. Screenshots stay outside the repository. Browser tests also reject shader errors and unsupported-particle diagnostics.

Passing these tests verifies this adapter and the selected original data, not whole-match equivalence to console execution.
