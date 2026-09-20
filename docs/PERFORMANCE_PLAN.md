# Performance Plan — Smooth on Old Devices (Fire TV / old phones / Chromebooks)

Goal: correct-speed gameplay at a stable render rate on low-end hardware (Fire TV Stick-class:
weak Mali GPU, 4 slow cores, ~1.5 GB usable RAM, 4K panel), fast boot, and no netplay meltdown.

Baseline facts this plan is built on (verified in source, September 2026):

- The game loop simulates on a fixed 60 Hz accumulator but renders every RAF with no skip
  (web/src/play/game-session.ts:298-309). Overloaded devices get slow motion, not dropped frames.
- No FPS/frame-time measurement exists anywhere; graphics preset defaults to `high`
  (web/src/render/graphics-quality.ts:26) and is only changed manually.
- Boot loads all 33 fighters serially, then 14 stages serially, then renders every menu preview
  with synchronous `toDataURL` GPU readbacks, all on the main thread
  (lib/game/load.ts:387-395, web/src/play/game-session.ts:96-141, web/src/play/menu-previews.ts).
- Renderer always uses `antialias: true, preserveDrawingBuffer: true`
  (web/src/render/play-renderer.ts:68); frustum culling is disabled on every mesh
  (web/src/render/model-instance.ts:250, web/src/render/common-effects.ts:103); every draw has
  its own `ShaderMaterial` (web/src/render/model-instance.ts:226-249); skinning `prepare()` runs
  for invisible fighters (web/src/render/play-renderer.ts:258-266); spark effects allocate fresh
  geometry+material per event (web/src/render/play-renderer.ts:227-234).
- Online rollback snapshots every simulated frame: 5+ `structuredClone`s plus a full 128 KB WASM
  memory copy (lib/game/match.ts:1127-1138, lib/game/physics.ts:60), ~120 frames retained
  (~15 MB live); state hashing stringifies the whole state recursively (lib/game/match.ts:171-185).
- The sim loop allocates arrays/closures per frame and floor queries `.filter().sort()` per
  fighter per frame (lib/game/match.ts:338-370, 759-799). Solo play does not snapshot.

Phases are ordered by playability-per-effort. Each is independently shippable and verifiable.
Concurrent-agent note: phases touch mostly disjoint files; Phase 1+2 both touch
web/src/play/game-session.ts — do them on one branch or sequentially.

---

## Phase 1 — Frame-time telemetry, render-skip, auto-quality (highest impact)

The core deliverable: measure, then adapt. One feature, three consumers.

1.1 **Frame-time monitor** (new: web/src/play/frame-monitor.ts)
- Rolling window (~120 RAF) of frame delta and of sim-vs-render cost split
  (wrap the `while` accumulator loop and the `renderer.render` call in game-session).
- Expose rolling p50/p95 and "accumulator saturated" streak counter.
- Surface in the existing debug hook (`window.smashEffectsSnapshot`,
  web/src/play/game-session.ts:151) and as an optional HUD FPS readout behind Game options.

1.2 **Render-skip under load** (web/src/play/game-session.ts:298-313)
- Keep simulation at fixed 60 Hz. When the accumulator stays saturated N consecutive RAFs,
  render every 2nd RAF (then 3rd at deeper saturation); recover hysteretically.
- Cap accumulator catch-up behavior unchanged (max 6 steps) — this phase only decouples
  presentation rate. Acceptance: on a throttled CPU (DevTools 6x), match clock stays real-time
  while render drops to 30/20 fps; no slow motion.

1.3 **Auto-quality stepping** (web/src/render/graphics-quality.ts, game-session.ts:261)
- If p95 frame time > 20 ms sustained for ~5 s, step preset down (high→medium→low); never
  auto-step up past the user's manually chosen preset; persist auto-decisions separately from
  the manual localStorage key (`smash-web.graphics`).
- First-launch heuristic preset: TV user agents (Silk/AFT), `deviceMemory <= 2`,
  `hardwareConcurrency <= 4`, or Mali/Adreno 3xx GPU string → start at `low`; cap pixel ratio so
  the drawing buffer never exceeds 1920×1080 on TV-class devices regardless of panel/dpr.

Tests: extend tests/unit/graphics-quality.test.ts (preset selection heuristic, hysteresis
logic as pure functions); new unit test for the skip/recover state machine.

## Phase 2 — Boot: lazy loading + preview cache (first-impression fix)

2.1 **Lazy fighter/stage loading** (lib/game/load.ts:376-395, web/src/play/game-session.ts:96-141)
- Boot loads: core/common banks + the default stage + nothing else. Menu opens as soon as
  those are ready.
- Fighter archives + SSM banks load on demand at character select (start on hover/focus),
  with `Promise.all` parallelism instead of the serial `await` loop; remaining roster prefetches
  through `requestIdleCallback` after the menu is interactive.
- Stage loads when picked. Guard match start on "all selected assets resolved" with a small
  loading indicator.

2.2 **Menu preview cache** (web/src/play/menu-previews.ts)
- Persist rendered portraits (PNG/JPEG data URLs) in CacheStorage keyed by disc fingerprint +
  renderer version; on warm boot, skip `captureMenuPreviews` entirely.
- Cold boot: capture previews lazily per roster page (or behind idle callbacks), not as one
  synchronous block; capture with a temporary `preserveDrawingBuffer` renderer (see 3.1).

2.3 **Drop redundant hashing** (web/src/play/game-session.ts:104-116)
- The per-asset JS SHA-256 fingerprinting duplicates CPU over every downloaded byte on devices
  where it hurts most. Replace with `crypto.subtle.digest` (off-main-thread native) and hash only
  the manifest/first chunk where full-file integrity is not strictly required.

Acceptance: time-to-menu on a mid phone drops from "tens of seconds + freeze" to < 5 s warm,
menu remains responsive during background prefetch. Tests: loader unit tests for on-demand
resolution and idle prefetch ordering (mock fetcher).

## Phase 3 — Renderer costs (raises the ceiling everywhere)

3.1 **Context flags per preset** (web/src/render/play-renderer.ts:68)
- `preserveDrawingBuffer: false` always for gameplay; preview capture (2.2) uses its own
  short-lived renderer or captures immediately after an explicit render.
- `antialias: false` on `low` (resolution scaling already blurs; MSAA is wasted there).
  Note: these are context-creation flags — changing preset at runtime keeps the current context;
  they apply on next session/renderer rebuild. Document that in graphics-quality.

3.2 **Frustum culling + invisible-fighter skip**
- Re-enable `frustumCulled` on model meshes with correct bounding spheres computed once per
  geometry (skinned parts: conservative expanded bounds) (web/src/render/model-instance.ts:250).
- Skip `rigs.sample()`/`actor.prepare()` for fighters whose group is invisible
  (web/src/render/play-renderer.ts:258-266); skip `stage.update()` for stages with no animated
  parts (web/src/render/play-renderer.ts:255).

3.3 **Shared shader programs**
- Keep per-draw `ShaderMaterial` instances but make Three share the compiled program:
  identical shader source + `customProgramCacheKey()` so N fighters × parts stop compiling and
  binding N distinct programs (web/src/render/model-instance.ts:226-249). Measure program count
  via `renderer.info.programs` before/after.

3.4 **Pooled spark/burst resources**
- Preallocate a small pool of `LineSegments` geometries/materials and reuse for hit sparks
  instead of per-event allocation + 12-frame disposal (web/src/render/play-renderer.ts:227-234).

3.5 **Low-preset extras**
- Disable the Stadium jumbotron render-to-texture entirely on `low`
  (web/src/render/play-renderer.ts:296-322) — show a static texture.
- Optional: generate mipmaps for stage textures (minification-heavy) while keeping
  fighter textures as-is (web/src/render/model-resources.ts:20-22); verify visual parity on
  Battlefield/FD before enabling broadly.

Acceptance: `renderer.info` (calls, triangles, programs) drops measurably on a 4-fighter match;
tests/unit/render-capacity.test.ts extended to pin program sharing and pool bounds.

## Phase 4 — Netplay snapshot/hash cost (old devices in online rooms)

4.1 **Keyframe snapshots + input replay** (lib/game/rollback.ts:104-137)
- Snapshot every 2–4 frames instead of every frame; on rollback to a non-keyframe, restore the
  previous keyframe and resimulate with stored inputs (already retained). Halves-to-quarters
  per-frame cost for the common no-rollback case.

4.2 **Cheaper capture** (lib/game/match.ts:1127-1138, lib/game/physics.ts:60)
- Replace `structuredClone` per subsystem with explicit `serialize()/restore()` into reusable
  preallocated buffers for the hot fighter/projectile/item state; keep `structuredClone` only
  for cold/rare structures. Reuse a ring of `Uint8Array`s for the 128 KB WASM copy instead of
  allocating a fresh one per snapshot.

4.3 **Cheaper hashing** (lib/game/match.ts:171-185, lib/game/rollback.ts:128-149)
- Replace recursive canonical-string SHA-256 with a serialized-buffer hash (reuse 4.2's buffer)
  — same divergence-detection guarantee, no string building. Keep interval at 30 confirmed
  frames.

Compatibility: bump the protocol/rollback version so old and new clients don't cross-hash
(lib/net/protocol.ts). Tests: determinism suite — snapshot/restore/resim equality across N
random frames must hold before and after; hash-equality test between two identically-stepped
matches.

## Phase 5 — Sim-loop GC churn (opportunistic, last)

- Hoist per-frame allocations in `LocalMatch.step`: reuse `actual` input buffer, hitlag flags
  array, impacts array, attacker Set (lib/game/match.ts:338-370).
- Cache stage floor query results per stage (static geometry): precompute sorted floor lists
  once instead of `.filter().sort()` per fighter per frame (lib/game/match.ts:759-799, 1005-1087).
- Only where profiles (Phase 1 telemetry) show GC pauses; do not refactor cold paths.

---

## Verification protocol (applies to every phase)

1. `npm run build` + full unit suite green (rollback determinism tests are the hard gate).
2. Manual: DevTools CPU 6x throttle — match speed stays real-time (Phase 1), boot < 5 s warm
   (Phase 2), `renderer.info` deltas recorded in the PR (Phase 3).
3. Real target: Fire TV / old phone via a jointly validated staged LAN server —
   4-fighter match on Battlefield, `low` preset auto-chosen,
   no slow motion, no visible GC hitches.
4. No behavior change to simulation outcomes: gameplay unit tests (tests/unit/gameplay-real.test.ts
   and per-character suites) must pass untouched.

## Explicit non-goals

- No changes to simulation rules, WASM function bank, or netcode protocol semantics beyond the
  version bump in Phase 4.
- No WebGPU migration, no worker-based rendering (OffscreenCanvas) — revisit only if Phase 1-3
  telemetry shows the main thread still render-bound on target devices.
- No chasing CRT-level input latency; browser/display latency is out of scope.
