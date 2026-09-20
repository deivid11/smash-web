# Native KO beams and camera shake

## What is implemented

Blast-zone KOs now render the original common KO model rather than the old procedural radial spark:

- [lib/game/ko-effect.ts](../lib/game/ko-effect.ts) loads `effCommonDataTable[0x19]` from the user's `EfCoData.dat`, including its five textured draws and original joint/material animation. The effect's 50-frame lifetime is read from the animation, not invented.
- Placement follows the directional death callbacks: left/right boundary priority, perpendicular-coordinate clamping, and inward-facing rotations for left/right/top/bottom. Root scale and the first four player palettes come from `PlCo.dat`.
- Only the first child draw's TEV constant/register RGB is overridden, matching the original callback. **The pale palette goes to the constant/core, and the saturated palette to register 0/fringe.** The pinned native variadic call evaluates these arguments right-to-left; treating source-text order as execution order reverses them and produces a flat-colored bar. This ordering was checked against the local reference call site (`efAsync_Dispatch`, 0x80065998–0x800659C4), not assumed from the C expression. Alpha, other draws and shared archive data are not recolored. Sparse seats retain their color identity; seats 5–8 use explicitly additional prototype palettes.
- A 24-presentation-frame camera hold frames the native shock-ring center, rather than the off-screen death root. This keeps the burst visible while reducing unnecessary zoom-out.
- [web/src/render/ko-effects.ts](../web/src/render/ko-effects.ts) owns at most eight concurrent native beam instances, with disposal on animation end, reset and rematch. Axial billboards preserve the beam's rotated local axis.
- The model's type-40 `dptcl` cue starts original generator **212 / 0xD4**, including its child flashes, sparks and delayed burst. [web/src/render/ko-particles.ts](../web/src/render/ko-particles.ts) uses the existing bounded particle VM with the native textures, additive flags and root orientation—not an invented glow overlay. Each root is capped at 64 sprites (512 across eight simultaneous KOs), and advances on fixed cosmetic ticks even at fractional display rates. Original bytecode E0's paired signed color-target deltas and interpolation restart are supported for this family.

[web/src/render/camera-shake.ts](../web/src/render/camera-shake.ts) reads the stage's original `quake_model_set` small/medium/large animation slots. It samples their X/Y translation curves instead of generating random noise. KO events request the large quake. Damaging hit events request small/medium/large shake using **prototype damage thresholds**, so even ordinary hits have feedback as requested; this is not the complete original airborne-knockback dispatch.

The quake animation's own duration is used. The original camera's 22-frame request bookkeeping is **not** the lifetime of the stage's 30/30/40-frame quake animations. Responsive viewport scaling and a bounded depth gain replace the original camera's unported zoom-dependent conversion. Overlapping impacts use a bounded strongest-wins rule, not additive eight-player shake.

Camera shake is configurable in GAME OPTIONS (persisted as `smash-camera-shake`): Off disables every quake lens shift, Reduced keeps KO + strong hits (>= 12 damage) while skipping jab-level small quakes, Full is the historical KO + all-hits behavior and the default. `prefers-reduced-motion: reduce` still disables the lens shift independently.

## Simulation and online safety

Both effects consume the same local/confirmed event stream as other presentation effects. They do not inspect speculative fighter state to decide whether a KO happened, generate network input, step WASM, or consume gameplay RNG.

A presentation-only clock lets the last-stock beam and quake finish after the match frame stops. The results backdrop reveals after the initial beam burst instead of immediately blurring it; this cosmetic delay does not postpone the authoritative result. Local pause freezes the effect clock. Camera shake is applied only to the final render pass's projection matrix and restored in `finally`; shake never feeds back into camera tracking, crowd framing or HUD view offsets. The temporary KO framing target is presentation-only; poses, hitboxes and snapshots are unchanged. `prefers-reduced-motion: reduce` disables the lens shift.

Read-only effect diagnostics include `koBeams`, `koParticles`, `koWarnings` and the currently sampled quake offset. They are not rollback state.

## Original source anchors

- [third_party/melee/src/melee/ft/ft_0D31.c](../third_party/melee/src/melee/ft/ft_0D31.c): boundary routing, directional death effects, scale/color arguments and large-quake requests.
- [third_party/melee/src/melee/ef/efasync.c](../third_party/melee/src/melee/ef/efasync.c): effect `0x42B` creates common model `0x19`.
- [third_party/melee/src/melee/ef/eflib.c](../third_party/melee/src/melee/ef/eflib.c): `efLib_SetTevKonstColor` writes RGB only.
- [third_party/melee/src/melee/ft/fighter.c](../third_party/melee/src/melee/ft/fighter.c): common player-color table initialization.
- [third_party/melee/src/melee/gr/grdatfiles.c](../third_party/melee/src/melee/gr/grdatfiles.c) and [third_party/melee/src/melee/gr/grlib.c](../third_party/melee/src/melee/gr/grlib.c): stage quake descriptors and animation playback.
- [third_party/melee/src/melee/cm/camera.c](../third_party/melee/src/melee/cm/camera.c): quake request bookkeeping and viewport conversion.
- [third_party/melee/src/sysdolphin/baselib/jobj.c](../third_party/melee/src/sysdolphin/baselib/jobj.c): the type-40 particle callback interprets the animation value as integer bits.
- [third_party/melee/src/sysdolphin/baselib/particle.c](../third_party/melee/src/sysdolphin/baselib/particle.c): generator child commands and E0 dual-color target deltas.

## Scope and asset safety

This reuses original assets and curves, but is **not a pixel-identical GX/TEV or full native camera implementation**. Screen KOs and the separate `0x42C` variant are not implemented here. The KO particle family now plays, but generator-volume sampling, particle TEV/alpha-test details and RNG remain the existing presentation subset—not a full HSD particle/environment port. No original assets or reference binaries are bundled or committed.

## Star KO (upward blast)

A KO that crosses the **top** blast line within the side bounds (`isTopBlastKO` in [lib/game/ko-effect.ts](../lib/game/ko-effect.ts)) plays the classic spinning Star KO instead of the boundary burst beam ([web/src/render/play-effects.ts](../web/src/render/play-effects.ts) suppresses the beam for it). The KO'd fighter's rig actor is flown up and back into the sky, spinning and shrinking to a distant point, then a bright star twinkles and it vanishes. The motion curve is the pure, unit-tested [web/src/render/star-ko.ts](../web/src/render/star-ko.ts) (`starKoPose`); [web/src/render/play-renderer.ts](../web/src/render/play-renderer.ts) owns the per-slot fly-up, restores the actor's scale/roll on respawn, and feeds the climbing point into camera framing so the shot widens to reveal the star. It runs on the presentation clock (finishes after a last-stock KO, freezes on pause) and never reads speculative state.

This mirrors `ftCo_MS_DeadUpStar` in [third_party/melee/src/melee/ft/ft_0D31.c](../third_party/melee/src/melee/ft/ft_0D31.c) (upward self_vel toward the camera-top offset, +Z drift, per-frame `HSD_JObjAddRotationX` spin, then the `0x42D` twinkle + SFX `0x83`). The prototype keeps the fighter's existing death voice rather than the common star-ding sound, and approximates the tumble with the fighter's frozen launch pose. Coverage: [tests/unit/star-ko.test.ts](../tests/unit/star-ko.test.ts).

The trusted-LAN API adds only the exact `EfCoData.dat` allowlist entry; byte ranges remain bounded. Common hit effects and KO beams share one archive read. Arbitrary disc files, the ISO, executables, repository paths and private reports remain inaccessible. The server/frontend must be staged and validated together before deployment.

Coverage lives in [tests/unit/camera-shake.test.ts](../tests/unit/camera-shake.test.ts), [tests/unit/ko-effects-real.test.ts](../tests/unit/ko-effects-real.test.ts), [tests/browser/ko-effects.spec.ts](../tests/browser/ko-effects.spec.ts), and [tests/server-browser/ko-effects.spec.ts](../tests/server-browser/ko-effects.spec.ts). Real-asset tests require `MELEE_DISC_PATH`; without it, report those tests as skipped.
