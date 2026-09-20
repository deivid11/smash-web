# Client performance telemetry and the 8-player render pass

Two things live here: how real clients report where their frame time goes, and what that
data said about eight-player matches (plus what changed because of it).

## 1. Measuring a client

`lib/perf/profiler.ts` is a span profiler shared by the simulation, the rollback driver and
the renderer. A span costs two clock reads, so it stays on in normal play. Spans are named
in families and nest per frame:

| Family | Meaning |
|---|---|
| `frame.input` / `frame.sim` / `frame.audio` / `frame.render` / `frame.hud` / `frame.preview` | the top level of one RAF tick, in order |
| `sim.step` (children `step.*`) | one `LocalMatch.step`: stage hazards, CPU AI, fighters, poses, combat, strikes, projectiles, items, animation |
| `render.*` | stage, fighters, overlays, camera, effects, stadium feed, `render.draw` (the WebGL submission) |
| `pose.update` / `pose.prepare` | pose evaluation and skin palettes; shared by collision and render samples |
| `net.receive` / `net.snapshot` / `net.hash` / `net.resim` / `net.restore` / `net.events` | rollback work; `net.receive` runs in socket handlers, outside the tick |
| `hud.commit` | React's HUD render+commit, flushed in a microtask after `frame.hud` |

`web/src/perf/telemetry.ts` turns per-frame spans into 5-second windows: frame-delta
percentiles and a histogram, JS tick time, post-RAF browser time (measured with a
`MessageChannel` message that lands after the browser's rendering steps), GPU time of the
main draw (`EXT_disjoint_timer_query_webgl2` where available), draw calls and a
per-owner draw breakdown, particle/projectile/item counts, heap size, rollback counters,
the three worst frames with their span breakdown, and Chrome long-animation-frame entries
with script attribution.

Each window also records the match context: player count, fighters, stage, mode, rules,
graphics preset, pixel ratio, drawing-buffer size. The device is described once per
session (user agent, model, cores, memory, DPR, GPU renderer string, Android shell).

Collection is **opt-in**: a client measures nothing until asked. Modes come from `?perf=`
and persist in `localStorage` under `smash-perf-telemetry`:

- `on` collect and upload — share `https://YOUR_HOST/play.html?perf=on` with a tester,
- `local` collect only — for benchmarks and devtools,
- `off` (default) no collection at all.

The choice sticks on that device until someone passes a different `?perf=` value, so a
tester opts in once and every later match keeps reporting.

`window.smashPerf.snapshot()` returns everything collected so far; `.cut()` closes the
current window (harnesses call it around a phase); `.end(reason)` finalizes a match.

## 2. Collecting from clients

`POST /api/perf` (`server/perf-api.ts`) accepts one JSON batch per upload — every 30 s
during a match, at match end, and on `pagehide` (`sendBeacon`). Each accepted batch is one
line in `<SMASH_PERF_DIR>/perf-YYYY-MM-DD.jsonl` (default `private/perf`, `off` disables
the route) with the receive time and a salted hash of the client address. Raw addresses are
never stored. The route is rate limited and caps bodies at 256 KB and days at 256 MB.

Reading requires a bearer token (`SMASH_PERF_TOKEN`; without it the read routes 404):

```
GET /api/perf/files            -> [{ name, size, modified }]
GET /api/perf/files/<name>     -> the raw JSONL
```

## 3. Reading the data

```
npx tsx scripts/perf-report.ts --url https://YOUR_HOST --token "$SMASH_PERF_TOKEN" --days 3
npx tsx scripts/perf-report.ts private/perf --players 8 --matches
```

It merges uploads per match, groups matches by device class and player count, prints the
frame budget as a span tree (JS tick, browser work after the RAF, GPU) and then the
diagnosis: GPU-bound vs main-thread-bound, draw submission, pose/skinning, simulation,
catch-up spiral, rollback, HUD commits, work outside JS, heap pressure, worst frames.
Filters: `--players`, `--mode`, `--device`, `--since`/`--days`, `--match`. `--json <file>`
writes the merged data. Downloads cache under `private/perf-cache/<host>/`.

## 4. What the data said (2026-09-17, eight CPUs on Battlefield)

Measured with a private harness that drove the real UI into an 8-player match, then
collected telemetry, a CPU profile resolved through the build's source maps, and a Chrome
trace. A 4× CPU throttle on the renderer thread was used to stand in for
a phone-class CPU.

The simulation was never the problem (about 5% of the frame). Presentation was: roughly
1,620 draw calls per frame, because each fighter part is its own draw plus three silhouette
shadow taps, and every one of those draws re-uploaded a 160-float skinning palette.

| 8 players on Battlefield | Before | After |
|---|---:|---:|
| Desktop JS per frame | 8.30 ms | 5.07 ms |
| Desktop `render.draw` | 5.70 ms | 2.93 ms |
| Draw calls | 1,620 | 603 |
| Phone-class (CPU ×4) fps | 26.8 | 53.9 |
| Phone-class JS per frame | 34.1 ms | 16.1 ms |
| Phone-class `render.draw` | 22.0 ms | 9.3 ms |
| Simulation steps per frame (CPU ×4) | 2.24 | 1.11 |
| Online (rollback) sim cost, 8 players | 1.23 ms/frame | 0.36 ms/frame |

## 5. What changed

- **Palette texture** (`web/src/render/model-instance.ts`): skinning palettes live in one
  float `DataTexture` per instance (4 texels per matrix); the vertex shader reads its slots
  through `paletteOffset` + `texelFetch`. One texture upload per instance replaced a
  160-float uniform upload per draw.
- **One merged silhouette per fighter**: every part's geometry is merged once, each vertex
  carrying an absolute palette slot, and drawn as a single `InstancedMesh` whose instances
  are the penumbra taps. Hidden parts zero their slots, which collapses them to no
  fragments. ~500 shadow draws became one per fighter. Multiply blending commutes, so the
  result is unchanged (verified pixel-identical at the same frame).
- **`prepare()`**: skips hidden parts, memoizes each joint's skin matrix per pass, caches
  the constant inverse bind and envelope joint indices, and keeps its loops in small helper
  methods — see the V8 note below.
- **Shared world matrices**: draw meshes have identity local transforms, so they reuse the
  fighter group's `matrixWorld` object instead of recomposing and multiplying per mesh.
- **Simulation pose cache** (`web/src/render/game-rig.ts`): the render pass re-poses actors
  at interpolated frames; the next collision sample of the same key restores that exact
  snapshot instead of re-evaluating every track. Poses stay bit-identical, so state hashes
  are unchanged (`tests/unit/render-perf-real.test.ts`).
- **Checkpoint-only state hashes** (`lib/game/rollback.ts`): the full-state hash cost ~3×
  a simulation step and ran on every simulated (and re-simulated) frame, but peers only
  exchange hashes every `ROLLBACK_HASH_INTERVAL` (30) frames. `hashInterval` hashes those
  frames plus the match-ending frame. Same hash values on the same frames, so old and new
  clients stay compatible; the default stays every frame.
- **Crowd camera insets** are sampled twice a second instead of every frame (they forced a
  layout right after each HUD commit).

### V8 note

Folding the old `forEach` callbacks into one large `prepare()` made it ~50% *slower in
Chrome* while a Node microbenchmark showed it 2× faster: the big function blew the
inlining budget, so `Matrix4.copy`/`multiply` stopped being inlined. Splitting it back into
small methods gave the expected win. Always A/B render changes in the browser.

## 6. Where the memory went (2026-09-17)

`performance.memory.usedJSHeapSize` reported ~1.7 GB with the whole roster loaded, but that
number is not the JS object graph: V8's own `Runtime.getHeapUsage` was **210 MB** while
Chrome's memory-infra dump put the renderer at 1527 MB, of which **partition_alloc held
1057 MB** — buffer data, not objects. Measure with a Chrome memory-infra dump,
never with `usedJSHeapSize` alone.

`window.smashMemorySnapshot()` ([lib/game/content-bytes.ts](../lib/game/content-bytes.ts))
censuses loaded content, separating bytes *used* by a view from bytes *pinned* by its
underlying buffer. With every fighter and stage loaded it found:

| Category | Before | After |
|---|---:|---:|
| fighter decoded texture pixels | 267.9 MB | 5.9 MB |
| stage decoded texture pixels | 224.3 MB | 12.7 MB |
| animation streams (30.7 used) | 49.3 MB pinned | unchanged |
| geometry (fighters + stages) | 50.3 MB | unchanged |
| **renderer process (memory-infra)** | **1527 MB** | **~1050 MB** |
| in-match `usedJSHeapSize` (8 players) | ~1550 MB | ~650 MB |

Textures already decoded lazily ([lib/hsd/texture.ts](../lib/hsd/texture.ts)
`deferredTexture`), but the decoded RGBA stayed cached in the closure **after** the GPU
texture was gone: boot uploads every fighter and stage once to capture portraits and stage
previews, so all 492 MB of RGBA stayed resident for the session. The fix gives the deferred
texture a `release()` and calls it from the refcounted GPU cache
([web/src/render/model-resources.ts](../web/src/render/model-resources.ts)) when the last
`THREE.Texture` for an image is evicted; the source bytes (79 MB for everything) stay, so a
later match re-decodes on demand. Frame time is unchanged and portraits still come from the
preview cache.

`HsdAssetSession` also kept an unbounded `fighterArchives` map (one whole `Pl*.dat` per
fighter); it now goes through the bounded archive cache. That measured as noise, so the
remaining ~390 MB of partition_alloc is allocator slack plus browser-side copies, not
retained content.

## 7. On-demand assets (2026-09-17)

Boot used to prefetch the whole roster and every stage behind idle callbacks and never release
any of it, so a client sat at ~200 MB of asset data (and ~990 MB reported) while idling in a
menu. Loading is now demand-driven with a small warm set:

| Moment | Before | After |
|---|---:|---:|
| Game ready | 13.9 MB content / 114 MB heap | 14 MB / 86 MB |
| Menus, after thumbnails | 200.6 MB / 992 MB | 31 MB / ~190 MB |
| 8 seats drafted | 200.6 MB / ~990 MB | 48 MB / ~275 MB |
| During an 8-player match | ~200 MB / ~1550 MB | 52 MB / ~400 MB |

- `GameSession.trimAssets()` keeps the live match, every drafted seat, the `Fx` backdrop
  fallback and the most recently used fighters/stages (`warmFighters`, `warmStages`); the rest
  is dropped with `unloadFighters` / by deleting the stage content. Dropped assets reload
  through the same `ensureFighters`/`ensureStage` + `selectionStatus` path that already gated
  match start, so pressing Start before assets are in shows the existing "Preparing …"
  indicator. An 8-player match starts in ~3 s on a warm cache.
- **Menu thumbnails are images, not models.** Portraits and stage previews persist as data URLs
  in CacheStorage, so a warm visit renders the whole character select without loading a single
  fighter; models load when a seat picks one (and per skin through `ensureCostumes`). A cold
  visit still renders each fighter/stage once to *create* those images — that pass now streams:
  load, capture, release (`captureStagePreviews` does the same for stages), so it peaks around
  31 MB instead of holding everything.
- `loadRosterQueue` now resolves copy-ability sources itself (Kirby parses his copies from ten
  other fighters and `loadOriginalFighter` throws if one is missing). Without this, picking
  Kirby on demand failed. `copySourceKinds` keeps those sources in the warm set while a
  dependent is still queued, so the cold pass does not reload them.
- Effect models opt out of the texture release (`modelTexture(..., releaseDecoded)`): they are
  built and disposed per hit burst, and re-decoding each time hitched the frame.
- Stages that cannot be thumbnailed (`onett`, `mushroom-kingdom` fail today, because their
  texture animation carries a palette-indexed frame without its palette) are recorded as
  attempted, so the progress bar completes and the idle healer stops retrying them forever.
  A material animation that cannot be decoded costs the model its texture scroll only
  (`ModelInstance` warns and continues); the stage stays playable and thumbnailable failures
  never escape as unhandled rejections.

### LAN rooms load on demand too (2026-09-17)

A room is not a match: `GameSession.online` only covers the live simulation, so everything the
menus do in the background keeps running while players are still choosing. That combination
broke LAN start — every peer bounced back to character select the moment the host pressed Start:

- `OnlineSession` hands every room update to `GameSession.setRoomSelection({ picks, stage })`.
  The session **pins** those picks (`trimAssets` never evicts them) and **keeps asking** for
  whatever is missing — on every content change and, while anything is still missing, once a
  second from the frame loop. Before the pin, the thumbnail pass evicted the room's stage
  seconds after it loaded (the warm set holds two stages), and the start gate then failed.
- Ready means "this peer can start this selection". `OnlineSession.setReady` records the
  intent and publishes `ready` only once `matchAssetsReady` holds for the room's current
  picks (the button reads "Loading…" until then, and the server already drops every ready on
  any selection change). That is what `assetsLoaded` promises the room, and it removes the
  race where a peer readies while a fighter is still parsing.
- A skin asked for before its fighter is resident goes on `costumeWaitlist` and is retried
  when that fighter loads: a peer's pick arrives long before the fighter it dresses, and
  `ensureCostumes` used to drop it silently, leaving the gate shut forever.
- An on-demand fighter load that fails is retried twice more (`maxLoadAttempts`); after that
  the room says the fighter cannot load on this browser instead of loading forever.
- Thumbnail captures rebuild the renderer's stage and rigs, so they stand down while a match,
  an online match, *or a finished online match still on screen* owns it (`captureBlocked`):
  a room back in its lobby keeps presenting that match, and a capture would dispose the rigs
  it renders with. They resume from the menu-idle chunker, which also restarts the stage
  thumbnail pass (it stops instead of loading stages it cannot capture).

## 8. Still open

- Fighter part draws (~65 per fighter) dominate what is left. Merging parts that share
  material state would need per-part uniforms moved into attributes: most fighters have
  nearly as many distinct material signatures as parts (Link 96 of 99), so merging only
  pays for Kirby/Pikachu-shaped models.
- Peak memory right after boot still spikes (~1.2 GB reported) until GC reclaims the
  released portrait textures; capturing previews in smaller chunks would flatten it.
- Per-hit effect churn (a `ModelInstance` per burst), the Stadium jumbotron re-render, and
  the 30 Hz HUD rebuild are each worth roughly 0.5–1 ms on a phone-class CPU.
