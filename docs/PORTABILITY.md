# Initial portability audit

Scope: the pinned source revision in [third_party/melee.lock.json](../third_party/melee.lock.json). This is an initial boundary assessment, not a claim that the full engine has been compiled natively or to WebAssembly.

## Experiment results

1. The supplied archive contained a complete 1,459,978,240-byte ISO. Its integrity test passed, with a warning about 38 bytes after the archive. The original archive was not changed.
2. Disc inspection identified `GALE01`, revision `2`, and indexed **1,209 files** using bounded reads rather than loading the whole image.
3. The executable SHA-1 equals `08e0bf20134dfcb260699671004527b2d6bb1a45`.
4. The original upstream compiler/toolchain rebuilt the matching GameCube executable. The pinned upstream report showed 19,828/19,828 functions matched, 100.00% code/data matched and linked; its separately reported fuzzy metric was 99.99%.
5. Emscripten 6.0.9 built the unchanged RNG translation unit as a 386-byte standalone WASM module with **zero host imports**.
6. Integer RNG progression matched an independent BigInt oracle over 10,000 steps for each of five seeds. Both high-bit seeds and unsigned wraparound are covered. Browser replay and local disc validation passed in Chromium.

The reference build verifies the original target. The tiny RNG experiment establishes the browser compilation/ABI/test pipeline only. It does not prove combat, animation, floating-point behavior, scheduling, or replay fidelity for the whole game.

## Concrete platform boundaries

| Area | Source evidence | Work still needed |
| --- | --- | --- |
| Startup/runtime | [third_party/melee/src/melee/gm/gmmain.c](../third_party/melee/src/melee/gm/gmmain.c) initializes OS, PAD, arenas, GX, video, and seeds RNG from the platform clock. | Explicit host initialization, controlled RNG seeding, frame stepping, async loading, and hardware-independent allocation. |
| Graphics | [third_party/melee/extern/dolphin/src/dolphin/gx/GXInit.c](../third_party/melee/extern/dolphin/src/dolphin/gx/GXInit.c) uses PowerPC assembly, memory-mapped registers, and the write-gather pipe. | Replace the hardware-facing GX API, including TEV, textures, vertex formats, display lists, and copy operations; do not compile hardware register access into WASM. |
| HSD assets | [third_party/melee/src/sysdolphin/baselib/archive.c](../third_party/melee/src/sysdolphin/baselib/archive.c) relocates archive offsets into pointers. | Validate big-endian archive data and convert typed structures/relocations. The ISO filesystem reader is not an HSD archive loader. Blindly byte-swapping every word is incorrect. |
| ABI | [third_party/melee/extern/dolphin/include/dolphin/types.h](../third_party/melee/extern/dolphin/include/dolphin/types.h) uses `long` for 32-bit integers. | Audit widths, alignment, bitfields, function signatures, and pointers. A native LP64 build would not retain these widths automatically; WASM32 alone does not address endianness. |
| Floating-point | [third_party/melee/src/melee/lb/lbtrigf.c](../third_party/melee/src/melee/lb/lbtrigf.c) uses bit-level float operations and the Gekko reciprocal-square-root estimate intrinsic. | Reproduce relevant semantics rather than assuming libc equivalents or compiler defaults match. Disable unsafe math optimizations and compare state traces against the original. |
| Gameplay coupling | [third_party/melee/src/melee/ft/ftcommon.c](../third_party/melee/src/melee/ft/ftcommon.c) couples movement helpers to fighter, stage, item, and HSD state. | Avoid presenting a retyped friction formula as an engine port. Establish a real simulation dependency boundary and test it against reference behavior. |
| Audio/input/saving | HSD and Dolphin abstractions are still GameCube-facing. | Browser audio mixing/scheduling, controller mapping/calibration, and local persistence. Controller adapter compatibility needs device-specific testing. |

## Existing native-port work worth evaluating

[third_party/melee/.nix/CMakeLists.txt](../third_party/melee/.nix/CMakeLists.txt) already describes a `TARGET_PC` **static library** and expects headers through `AURORA_SRC`; [third_party/melee/.nix/melee-gcc-native.nix](../third_party/melee/.nix/melee-gcc-native.nix) packages that recipe.

This is useful prior work, not evidence of a complete runnable PC/browser port. We have not built that target or established Aurora's coverage for Melee. Evaluate [Aurora](https://github.com/encounter/aurora) before writing a bespoke GX backend or replacing HSD with a Three.js scene graph.

## What the RNG adapter does

[engine/compat/Runtime/platform.h](../engine/compat/Runtime/platform.h) supplies just three fixed-width types used by the RNG translation unit. It is intentionally **not** a general Dolphin SDK header replacement.

[scripts/build-wasm.ts](../scripts/build-wasm.ts) compiles upstream source directly, without copying or patching its algorithm. [engine/probe.c](../engine/probe.c) exposes only seed get/set helpers. The exported original functions are `HSD_Rand` and `HSD_Randf`; other functions from the source are not part of the probe's supported API. Binary/source hashes and compiler details are recorded in generated [web/public/wasm/probe.build.json](../web/public/wasm/probe.build.json).

Restoring one RNG seed is straightforward. Restoring an entire game requires considerably more state, including allocation state, callbacks, animations, collision caches, counters, and any asynchronous events affecting gameplay.

## Asset-rendering follow-up

The first visual milestone is implemented: three original stages, Fox/Mario models, a trophy, and original joint-animation clips render through a bounded HSD/Three.js adapter. See [docs/MILESTONE_02.md](MILESTONE_02.md) for scope, screenshots, validation, and limitations.

The adapter follows original joint/skin transforms and animation format data, but it has **not** passed a pixel-perfect or frame-state equivalence comparison against the running GameCube game. Full TEV effects, material animation, stage-specific visibility, original cameras, and gameplay remain outside this viewer. Comparing reference game poses/materials and establishing an original-C simulation boundary are still needed.

No estimate for a faithful complete game or competitive online play is justified by the RNG or asset-viewer experiments alone.
