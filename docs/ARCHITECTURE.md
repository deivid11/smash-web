# Architecture and multiplayer direction

## Decisions

- Preserve original gameplay C where possible; compile adapted code to WASM rather than rewrite mechanics in TypeScript.
- Keep this project separate from the existing custom fighting game.
- Keep upstream pinned and unchanged. Port-specific code belongs outside [third_party/melee/](../third_party/melee/).
- Never bundle the user's disc/assets into the static app. At the user's request, a trusted-LAN API may serve bounded ranges of the selected viewer assets from the private server ISO.
- Support two to eight simulated fighters through a **central-server topology**, with local two-player/practice-bot UI preserved.
- Use Three.js for the isolated HSD asset-inspection viewer. This does not decide the eventual full-game GX runtime backend; native/Aurora integration and faithful TEV behavior remain open work.

## Current implementation

```text
React / TypeScript browser application
  ├─ Default server source → curated HTTP asset ranges from the verified server ISO
  ├─ Optional file picker → bounded local ISO reader → metadata + checksum
  ├─ Original-asset viewer
  │    ├─ HSD archives → joints, geometry, textures, skin envelopes
  │    ├─ Original figatree/FObj clips → preview poses
  │    └─ Three.js/WebGL → images (approximate materials, no gameplay)
  ├─ Play scenes → character/stage selection, local play and online rooms
  ├─ GameSession → fixed-step local simulation, independent per-match C/WASM memory
  ├─ OnlineSession → bounded prediction/rollback, confirmed hashes/events
  ├─ Original SSM/HPS audio → selection cues and looping menu/stage music
  └─ WebAssembly modules
       ├─ original HSD RNG probe
       └─ selected original movement/root-motion/hitlag/knockback routines

Trusted-LAN server
  ├─ Startup ISO/version/executable verification
  ├─ Read-only 26-resource asset API; bounded Range responses
  ├─ Separate same-origin WebSocket room/input relay (no asset bytes)
  └─ Static browser code (no server-side WebGL or game simulation)

Local development tools
  ├─ pinned upstream checkout
  ├─ private reference executable → matching GameCube build
  └─ Emscripten → RNG probe and selected-function gameplay bridge
```

The limited simulation supports two to eight fighters, including original Fox/Mario/Kirby data and optional local character packs. Local play remains two-player/leveled-CPU (see [CPU_AI.md](CPU_AI.md)); online rooms connect two to eight browsers through a central input relay and bounded rollback. It is not the complete Melee engine. Four-model display in the separate inspection viewer is still only a render stress test. See [docs/REACT_ONLINE.md](REACT_ONLINE.md) for implemented flow, architecture and limitations.

### Privacy boundary

Only [web/](../web/) and the required shared code/dependencies are available to the loopback development server. The LAN asset server serves the built browser code plus a read-only API for 21 explicitly allowed game/effect/audio resources. It does not expose the full disc, reference executable, arbitrary disc files, repository files, or machine configuration. See [docs/SERVER_SOURCE.md](SERVER_SOURCE.md).

In server mode, the browser fetches only named asset byte ranges and performs all HSD parsing, animation playback, and rendering itself. In local mode it instead uses `File.slice()` and the secure-context-compatible checksum fallback. Neither mode uploads the browser's disc. Optional performance telemetry is handled by the host; the default server enables intake unless `SMASH_PERF_DIR=off`. See [docs/PERF_TELEMETRY.md](PERF_TELEMETRY.md). A static build contains code/notices and the RNG probe—not game assets. Server-mode assets are separate runtime responses.

The asset server has no user authentication and is intended for a trusted LAN. Room tokens bind player slots to sockets, not to verified accounts. Host/origin checks, response bounds, and private-file blocking are safeguards, not a substitute for access control or permission to redistribute assets.

## Local character packs

[lib/custom/types.ts](../lib/custom/types.ts) defines the trusted build-time character API. [scripts/character-packs.ts](../scripts/character-packs.ts) validates opt-in manifests from ignored private storage and exposes only declared runtime modules/assets via virtual modules and content-addressed asset URLs. No private directory is added to the development server allowlist.

The registry adds factories, menus, special hooks and independently owned visuals. Per-fighter custom state is part of the existing full TS+WASM snapshot/hash boundary. Protocol v10 compares canonical pack-byte hashes before join/spectate/resume and validates custom selections against the room's agreed set. The relay reads metadata only; it never imports pack implementations. See [docs/characters/CUSTOM_CHARACTERS.md](characters/CUSTOM_CHARACTERS.md).

## Future simulation boundary

The current prototype has a full TypeScript+WASM frame-boundary snapshot/restore interface and canonical hashes. The future full C engine should preserve this host-independent boundary:

- Initialize from verified assets and an explicit seed.
- Advance exactly one original simulation tick from a frame-numbered, four-slot input vector.
- Capture/restore all simulation-relevant state.
- Produce render/audio events separately from advancing gameplay.
- Produce a canonical state hash for replay and divergence testing.

Do not tie simulation speed to the display's refresh rate or use elapsed wall-clock time as gameplay input. The playable prototype uses a fixed 60 Hz step with a bounded accumulator. Focus loss pauses local play; online browser suspension closes the shared match rather than pausing one peer. As before, exact original VI timing and complete state equivalence remain unverified. Rendering may interpolate, but it must not change authoritative game state. Browser tab suspension and background throttling require an explicit pause/disconnect policy.

The private C bridge and TS guards share an eight-player capacity. Native spawn data remains unchanged for 2–4 players; 5–8 use an explicit, deterministic prototype layout on a sufficiently wide connected solid floor, with blast/edge margins and separated starting positions. Unsupported layouts reject rather than spawning inside gaps. Extra player capacity is not original Melee behavior.

Do not assume that copying WASM memory is a complete snapshot. Host-side state, pending asynchronous operations, pointers into resources, and any future threads also need defined semantics. Suppress duplicate audio/visual side effects while resimulating.

## Up to eight players, one central server

Target topology:

```text
Browsers 1–4 ── Central server ── Browsers 5–8
```

### First online implementation: input relay

Each browser runs the same simulation locally. The central server authenticates room membership, owns player-slot assignment, validates/rate-limits frame-numbered inputs, and relays them to the other participants. It does not run graphics or require game assets.

Implemented for the prototype:

- Two to eight stable room slots, mapped into dense simulation slots; matching game/WASM/content fingerprints.
- Explicit initial RNG seed, readiness and synchronized match start.
- Full per-frame inputs with strict server ordering, duplicate-safe rollback receipt and a 120-frame history.
- Immediate local prediction capped at eight frames; confirmed state comparisons every 30 frames.
- Full TS+WASM snapshots, confirmed events exactly once and confirmed audio-loop ownership.
- Frame lead/rate/payload bounds, missing-input deadlines and shared disconnect/background termination.
- Same-state completion acknowledgement, room rematch and narrow discard of in-flight messages for the most recently closed match.

The implemented transport is WebSocket with compression disabled and server TCP_NODELAY. TCP head-of-line blocking can still hurt fighting-game latency. Evaluate WebTransport datagrams or server-terminated WebRTC for stricter input latency goals; inputs stay central while voice already meshes peer-to-peer (signaling only via the relay, Opus audio direct). Alternative datagram transports for inputs remain future work.

A relay reduces connection complexity, not network delay. The slowest player's delayed input can still cause predictions/corrections for everyone. Start with nearby players, instrument input age and resimulation cost, and define acceptable latency before promising competitive quality.

### Later option: authoritative headless simulation

The server also runs the real game and determines official state. Browsers still predict locally and reconcile against the server. This requires the port's full headless simulation, asset provisioning/licensing decisions, extra CPU, authoritative input deadlines, and a state synchronization protocol.

Use the same well-tested WASM build initially if that simplifies matching numerical behavior. A faster native server build is an option only after cross-target state equivalence is established. Authority improves outcome validation but does not magically prevent every form of cheating.

### Explicitly out of scope for the first prototype

- Existing Slippi protocol/client compatibility.
- Ranked matchmaking or replay distribution. Accounts and read-only spectators are now implemented prototype features.
- Production hosting, global regions, and DDoS defenses.
- Tournament-quality latency claims.

Rollback/snapshot correctness is tested for this limited prototype; that does not prove complete original offline behavior or numerical equivalence across every browser. The RNG probe remains a separate fixture, not evidence of full-engine equivalence.
