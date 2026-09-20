# Performance pass 1

Scope: CPU and resource optimizations that leave gameplay, snapshots, rollback
hashes and the network protocol byte-for-byte unchanged. Nothing here changes
physics, native move data or the WASM engine.

## What changed

| Area | Change | Code |
|---|---|---|
| Pose evaluation | Collision passes sample fighters without preparing draw palettes or skinning uploads. Local poses are reused when animation, frame, loop mode, motion root and rotation overrides are unchanged; only world placement and render-only visibility are refreshed. | [web/src/render/game-rig.ts](../web/src/render/game-rig.ts) `sample(fighter, prepareDraws)`, [lib/game/match.ts](../lib/game/match.ts) |
| Hurtbox cache | Per-phase cache of world hurt capsules plus an inflated swept AABB used only as a broad phase. Never serialized or retained across ticks; invalidated by pose revision, state, animation, frame, epoch and special phase. The narrow phase is unchanged and still decides every hit. | [lib/game/hurt-cache.ts](../lib/game/hurt-cache.ts), [lib/game/projectiles.ts](../lib/game/projectiles.ts) |
| Shared GPU storage | Immutable native geometry buffers and decoded textures are reference-counted and shared between instances of the same model. Palettes, material uniforms, opacity and visibility stay per instance. | [web/src/render/model-resources.ts](../web/src/render/model-resources.ts), [web/src/render/model-instance.ts](../web/src/render/model-instance.ts) |
| Asset loading | Bounded LRU caches with in-flight deduplication for archives, models, action tables and animation clips. Failures are never cached; evicted values stay valid for holders. | [lib/hsd/load-cache.ts](../lib/hsd/load-cache.ts), [lib/hsd/session.ts](../lib/hsd/session.ts) |
| Rollback hashing | Post-frame hashes are computed lazily on first request and memoized per retained frame instead of eagerly every simulated tick. Hash algorithm and full TS + WASM coverage are unchanged. | [lib/game/rollback.ts](../lib/game/rollback.ts) |
| Stadium display | The jumbotron framebuffer is captured once per simulation frame and restore revision instead of on every render call. | [web/src/render/play-renderer.ts](../web/src/render/play-renderer.ts) |
| VFX | Particle sprite materials are pooled and reused across bursts and released on disposal. Texture frames, blending and timing are unchanged. | [web/src/render/common-effects.ts](../web/src/render/common-effects.ts) |

## Measured effect

Node 22 on an i9-13900K, Final Destination, all-Mario rosters, 600 samples.
These are CPU timings of the TypeScript simulation and pose layer, not GPU
frame times. Browser results vary with the GPU and device pixel ratio.

| Metric | Before | After |
|---|---:|---:|
| Idle step, 2 players (mean) | 0.22 ms | 0.06 ms |
| Idle step, 8 players (mean) | 0.87 ms | 0.17 ms |
| Dense combat fixture, 8 players (mean) | 1.93 ms | 0.53 ms |
| Rollback tick without corrections, 8 players (mean) | 1.82 ms | 0.29 ms |
| 8 players + 32 distant projectiles (mean) | 2.84 ms | 0.20 ms |
| Joint-point queries per tick in that fixture | 4480 | 140 |
| Startup disc reads / duplicate bytes | 1254 / 811 KB | 1142 / 0 |

## Invariants verified

- Golden replay: seven rosters (including an eight-player mix of Mario, Fox,
  Link, Young Link, Pikachu, Mewtwo, Captain Falcon and Roy) stepped for 600
  ticks with scripted varied inputs produce identical state hashes at all 210
  checkpoints before and after the change.
- Snapshot format and size are unchanged; eight-player snapshots serialize to
  the same byte length and hash across runs.
- Collision-only sampling yields exactly the same poses and palettes as a full
  render sample ([tests/unit/performance-real.test.ts](../tests/unit/performance-real.test.ts)).
- Broad-phase sweeps never reject a narrow-phase hit over deterministic varied
  fixtures ([tests/unit/hurt-cache.test.ts](../tests/unit/hurt-cache.test.ts)).
- Shared storage is released exactly once when the last instance is disposed;
  load caches never cache failures ([tests/unit/load-cache.test.ts](../tests/unit/load-cache.test.ts),
  [tests/unit/render-capacity.test.ts](../tests/unit/render-capacity.test.ts)).

## Graphics quality presets

Game options → **Graphics quality** offers Low, Medium, High and Extra high.
The setting is cosmetic: simulation, snapshots, rollback hashes and the network
protocol never read it. It persists in `localStorage` (`smash-web.graphics`) and
defaults to High, which is the historical fixed behavior.

| Preset | Render scale | Stadium display feed | Live particle sprites |
|---|---|---|---|
| Low | 75% of a 1× ratio | every 8 frames at 256×128 | 96 |
| Medium | 1× | every 4 frames at 512×256 | 192 |
| High | device ratio up to 2× | every 2 frames at 512×256 | unlimited |
| Extra high | 1.5× device ratio up to 3× (supersampling) | every frame at 1024×512 | unlimited |

Particles above the budget stay simulated by the native particle player, so
later frames of the same burst still appear when sprites free up; only the draw
is skipped. Code: [web/src/render/graphics-quality.ts](../web/src/render/graphics-quality.ts),
applied by `PlayRenderer.setQuality`. Tests: [tests/unit/graphics-quality.test.ts](../tests/unit/graphics-quality.test.ts),
[tests/server-browser/graphics.spec.ts](../tests/server-browser/graphics.spec.ts).

## Loading over the network

Measured from a client with ~10 ms RTT and ~90 Mbit/s to the deployed HTTPS host
before this change: 1157 requests, 48 MB, 17.7 s to ready on a cold load and
17.1 s on a warm load, because nothing was cacheable and the loader awaits its
animation reads one at a time (about 100 small ranges per fighter animation file).

Changes, all in play mode only (the asset viewer keeps its partial-range behaviour):

- **Read coalescing** ([lib/hsd/asset-fetch.ts](../lib/hsd/asset-fetch.ts) `coalescingFetcher`):
  an exposed asset at or below 2 MiB is downloaded whole once and every ranged read is
  answered from that copy as an ordinary 206 reply. The choice depends only on the
  manifest size, so the per-range content hashes that feed the online fingerprint are
  unchanged and identical across peers.
- **Persistent cache** (`cachingFetcher` + `cacheStorageStore`): successful ranged
  replies are stored in Cache Storage under the disc identity (game id, executable
  SHA-1, disc size, protocol version). Older disc caches are dropped. Corrupt or
  short entries are ignored and refetched.
- **Static serving** ([server/http.ts](../server/http.ts)): Brotli/gzip negotiated per
  request and compressed once per file version, strong ETags with 304 revalidation,
  and `immutable` caching for hashed bundle names. Asset ranges keep `private, no-store`
  at the HTTP layer; the client cache above owns them.

Tests: [tests/unit/asset-fetch.test.ts](../tests/unit/asset-fetch.test.ts),
[tests/unit/server.test.ts](../tests/unit/server.test.ts).

Measured on the deployed HTTPS host after deployment (same client as above):

| Load | Requests | Transfer | Time to ready |
|---|---:|---:|---:|
| Cold, before | 1157 | 48 MB | 17.7 s |
| Cold, after | 82 | 54 MB | 9.8 s |
| Warm, before | 1157 | 48 MB | 17.1 s |
| Warm, after | 8 | 10 KB | 4.5 s |

The play bundle went from 441 KB to 122 KB on the wire (Brotli). The cold load is
now bandwidth-bound, the warm load is decode-bound. Remaining options: compress
asset ranges on the wire, and load only the selected match before marking ready.

## Not done yet

Stage frustum culling with correct bounds for shader-animated fighters, draw
batching, render-scale / DPR presets, selected-match loading with bounded
background prefetch, and instanced particle batching remain open. Each changes
visible behavior or loading order and needs its own validation.

## Reproduce

These measurements used private benchmark and golden-replay harnesses against the
owner's disc. Those ad-hoc tools and captures are not distributed; the repository's
performance and rollback tests provide the repeatable public checks.
