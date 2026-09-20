# React scenes and trusted-LAN multiplayer

This is an experimental source-port prototype, not the complete Melee engine or tournament-ready netplay.

## Play flow

The existing `/play.html`, `/viewer.html` and `/index.html` routes now mount React/TypeScript applications. No router fallback or repository file serving was added.

1. **Characters:** select built-in fighters or an installed local character pack; choose CPU seats with a level 1–9 (see [CPU_AI.md](CPU_AI.md)) or a second local keyboard player and stock rules.
2. **Stage:** choose from fifteen stages. Each playable stage loads the original model and original floor/ledge/blast/spawn data; unsupported collision/stage mechanics are not advertised as playable (see [MENU_AUDIO_STAGES.md](MENU_AUDIO_STAGES.md) for per-stage scope).
3. **Arena:** play, pause locally, rematch or return to selection.
4. **Online room:** create a room and have two to four browsers join — either by typing its six-character code or by picking it from the open-rooms browser list (refreshes every few seconds, per-room Join buttons). Each browser chooses a fighter. The host chooses stage/stocks/time. When the host picks a stage, every browser still on the setup screens follows to the stage screen automatically. The stage screen lists each player as Ready / Not ready. Everybody must mark Ready; any selection/rule change resets readiness. The host starts together. Assets load on demand, so Ready reads "Loading…" until that browser actually holds the room's fighters, skins and stage (see [docs/PERF_TELEMETRY.md](PERF_TELEMETRY.md), "LAN rooms load on demand too"): once everyone is ready, Start cannot fail on missing assets.

Every online browser uses **P1 keyboard/gamepad/touch controls**, regardless of its room slot. Solo Mario's historical local P1 mapping remains compatible. The local UI still offers two keyboard players; the simulation/renderer support up to four fighters through online rooms.

Original menu selection/confirmation/back sounds, Fox/Mario/Kirby announcer cues, menu music and both stage tracks are decoded locally from allowlisted ISO ranges. All three tracks and selection cues are prepared before game-ready so changing a scene or starting a match does not read assets during combat. Audio needs an initial browser gesture. Original SFX and music have independent mute controls, with music volume adjustment. See [docs/MENU_AUDIO_STAGES.md](MENU_AUDIO_STAGES.md) for decoder verification and original resource provenance.

## Immersive display

The arena fills the entire browser viewport: fighter portraits, stocks, damage, shields and timer are overlaid **inside** the canvas area rather than below it. Character/stage selection uses large runtime renders of the already-loaded models. Those thumbnails stay in browser memory; no extracted game artwork is added to the static app.

The **Fullscreen** corner button enters/exits native browser fullscreen after a user gesture. If that API is unavailable, CSS still fills the browser window. Local game options pause and resume the match; online options send neutral local input while peers continue, never pausing everyone unilaterally. Desktop touch controls are opt-in, mobile controls default on during a match, with a D-pad/action cluster and minimum 44-pixel targets. Only menus scroll on small portrait displays; the arena/HUD remain fixed.

Local packs can supply optional presentation modes through the generic pack API. Cosmetic presentation never changes authoritative simulation poses or hitboxes. Protocol v10 requires identical installed pack identities/hashes; see [docs/characters/CUSTOM_CHARACTERS.md](characters/CUSTOM_CHARACTERS.md).

## UI/runtime boundaries

```text
React roots (StrictMode development checks)
  ├── Play scenes / reusable fighter HUD / settings / touch controls / lobby
  ├── Asset Viewer controls + isolated canvas host
  └── Port Lab panels + RNG plot
          |
          | actions / cached external-store snapshots
          v
GameSession (one disposable match runtime)
  ├── fixed 60 Hz simulation ticks, bounded accumulator
  ├── PlayInput (keyboard/gamepads; declarative React pointer handlers)
  ├── LocalMatch -> original-data adapters + independent C/WASM memory
  ├── PlayRenderer / Three.js (not stored in React state)
  ├── PlayAudio / MenuAudio
  └── OnlineSession -> RollbackDriver <-> RoomClient <-> central WebSocket relay
```

Relevant entrypoints:

- [web/src/play/play-app.tsx](../web/src/play/play-app.tsx): scene composition and disposable runtime lifecycle.
- [web/src/play/game-session.ts](../web/src/play/game-session.ts): boot, selection, local/network simulation adapter, render/input/audio lifecycle.
- [web/src/play/online-session.ts](../web/src/play/online-session.ts): dense simulation slot mapping, shared start, frame input relay, confirmed events and hashes.
- [web/src/play/store.ts](../web/src/play/store.ts): cached snapshots for `useSyncExternalStore`; high-frequency HUD updates do not rerender the entire settings tree.
- [web/src/play/menu-previews.ts](../web/src/play/menu-previews.ts): in-memory character and stage images, reusing the single WebGL context at boot.
- [web/src/play/fullscreen.ts](../web/src/play/fullscreen.ts): gesture-driven native fullscreen with viewport fallback.
- [lib/game/rollback.ts](../lib/game/rollback.ts): bounded input/state history and deterministic resimulation.
- [lib/net/README.md](../lib/net/README.md): transport API, bounds, security and failure contracts.

No `innerHTML`/`dangerouslySetInnerHTML` UI replacement is used. Three.js owns only its canvas container; React owns controls, overlays and status. Fetches/listeners/animation loops/graphics/audio are aborted or disposed on teardown, and late asynchronous results cannot mutate unmounted UI. The two legacy TypeScript tool entrypoints remain small compatibility imports into TSX.

## Netplay guarantees and limits

- Two to eight browsers connect through one central WebSocket server for inputs. Voice chat is an optional P2P mesh (see below), not server-relayed audio. No Slippi interoperability or server-authoritative game simulation.
- Membership is bound to a socket/token and stable room slot. Names and six-character room codes are not user accounts or Internet access control.
- The room checks matching compiled-game identity, WASM SHA256 and hashes of loaded original gameplay ranges for both fighters and both supported stages. Custom gameplay is part of the compiled game identity. Music/cosmetic bytes do not decide simulation compatibility.
- Frame zero is the first countdown input tick. The server assigns a common seed and future start timestamp; frame IDs, not equal browser wall clocks, identify authoritative inputs.
- Local input is predicted immediately with no fixed input-delay queue. Missing remote input is predicted from previous state, capped at **8 frames**; the driver stalls rather than guessing indefinitely. Inputs and state history are bounded to **120 frames**.
- Complete snapshots include all mutable TypeScript match/projectile/bot/script state plus the adapter's fixed WASM memory. Immutable assets are rebound, not deep-copied. Each match has its own WASM instance.
- Canonical SHA256 checksums represent confirmed POST-input-frame state. Checkpoints are sent every **30 frames**. Divergence, stale unavailable state or conflicting inputs stops the match rather than pretending peers agree.
- Sounds/effects are emitted exactly once from confirmed events, not repeatedly during rollback. Loop ownership follows confirmed post-frame special scopes; jump sound IDs are captured at the event tick. This is not complete original AX behavior.
- Local Escape/blur pauses only local games. Online Escape does not pause. Return-to-lobby or an explicit leave ends the shared match for everybody. A dropped socket, congestion or a hidden tab holds that human's seat for 90 s instead (protocol v8): the others stall at the prediction cap behind a "MATCH ON HOLD" notice, the client reconnects by itself, and even a restarted browser resumes by replaying the relay's input log (see `lib/net/README.md`, *Held seats and resume*). There is still no silent bot replacement.
- Clean completion requires all peers to attest the same retained confirmed final frame/hash. A predicted knockout is not a confirmed winner.
- The HUD exposes estimated RTT, prediction depth, rollback count and confirmed frame. RTT derives from application ping; it is not a claim of measured controller-to-display latency.

WebSocket runs with compression disabled and server TCP_NODELAY. TCP head-of-line blocking and slow GPUs/tabs can still increase latency. Cross-Chromium/Firefox/Safari numerical equivalence, WAN regions, competitive latency, public hosting security and anti-cheat remain unverified/out of scope. Use nearby players on a trusted LAN. The original asset service still has no user authentication and must not be exposed to the public Internet.

## Voice chat (experimental)

Lobby and in-match voice is an opt-in WebRTC mesh (`web/src/net/voice-client.ts`, UI in `web/src/play/voice-panel.tsx`). Signaling (`voice-offer`/`voice-answer`/`voice-ice`) reuses the same WebSocket relay peer-to-peer; Opus audio bytes never touch the server. Lower room slots offer to higher slots, CPU seats never mesh, and voice errors never close or pause the shared match. Off by default with mute, push-to-talk hold, per-peer volume/mute and speaking indicators. Mic access needs a secure context (https or localhost); plain LAN http IPs block `getUserMedia` with an explicit message. Host-only ICE candidates keep it LAN-local with no Internet STUN/TURN; 5–8 simultaneous talkers and WAN quality remain untested.

## Updating the running server

A new browser build does **not** hot-reload an existing Node asset/relay process. After server code or allowlist changes, restart that game server and reload the clients. A stale process can serve new HTML while returning HTTP 404 to the WebSocket upgrade or omitting music resources. Verify the `/api/rooms` WebSocket handshake and the 21-resource source manifest after updating. On this prepared workstation the service is `smash-web-server.service` under `systemctl --user`; do not stop unrelated projects or services.

## Validation

From the repository root, with `MELEE_DISC_PATH` pointing to the private verified ISO:

```sh
npm run build
npm test
npm run test:browser
npm run test:server-browser -- --workers=1
```

The full server-browser suite includes existing local gameplay/privacy cases, real React selection/music cases, and real two/four independent browser-context matches with confirmed hash comparison. The separate relay-browser suite deliberately tests transport only using fixture fingerprints; do not confuse it with gameplay equivalence. Unit suites exercise delayed/out-of-order four-peer correction, complete state restore, bounded history/prediction, exactly-once events, protocol ownership, timeouts and ISO/audio safety. Software WebGL contexts are expensive; use one worker for the four-browser integration suite to avoid unrelated test contention.
