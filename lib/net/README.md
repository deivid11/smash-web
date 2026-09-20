# Trusted-LAN room relay

This is a simulation-independent prototype transport, not the original Melee engine,
Dolphin networking, or an Internet-safe service. The HTTP server's curated ISO asset
allowlist and bounded range routes remain separate; room messages never contain assets.

## Browser contract

`web/src/net/room-client.ts` exports `RoomClient`:

- `connect(url?)` resolves after protocol handshake. Default is same-origin `/api/rooms`.
- `fetchRoomList(signal?)` performs a plain same-origin `GET /api/rooms` (same path as the relay; upgrades bypass the JSON handler) and returns the validated lobby directory: code, lobby counts, host name, rules and compatibility fingerprint per open room. No socket, token or match state is exposed.
- `subscribe(listener)` returns an unsubscribe function; `getSnapshot()` is a deeply
  frozen external-store snapshot with stable identity between updates.
- `create({name, fingerprint, rules?})`, `join({code, name, fingerprint})`.
- `choose(fighter)` accepts built-in `RoomFighter` values from `ROOM_FIGHTERS` in
  `lib/net/protocol.ts`, or a namespaced `custom:namespace.character` installed in
  the room's agreed pack set. `updateRules({stage, stocks, timeSeconds})` is host only.
- `setCpu(slot, fighter | null)` (host-only lobby): add/change a CPU or remove it
  to open its seat. Cannot remove/replace a connected human (`SEAT_OCCUPIED`).
- `ready(assetsLoaded)`, `start()` (host only, 2–8 total fighters, at least one human,
  every human ready). CPU seats are always ready; humans load their assets too.
- `sendInput(frame, input, {delay, adv}?)` sends one **binary** frame (`lib/net/input-codec.ts`);
  `sendHash(frame, lowerCaseSha256)`. Both return false while reconnecting: the adapter keeps
  its frames and resends them after `onSynced`.
- `storedResume()` / `resumeStored(fingerprint)` reclaim a held seat after a browser restart.
- `finish(finalConfirmedFrame, finalStateHash)` requires unanimous identical final
  frame/hash before `MATCH_COMPLETE`; the server does not adjudicate gameplay.
- `returnToLobby()`, `background()`, `leave()`, `disconnect()`, `ping()`.
- `sendVoiceOffer(target, sdp)`, `sendVoiceAnswer(target, sdp)`, `sendVoiceIce(target, candidate, sdpMid?, sdpMLineIndex?)` relay room-scoped WebRTC signaling peer-to-peer. Audio bytes never touch the relay.
- All send methods return a boolean. Callbacks `onStart`, `onInput`, `onHash`, `onEnd`, `onVoice`
  are constructor options or assignable instance properties.
- `serverNow()` approximates server time using application-ping RTT. `onStart` fires
  immediately; the simulation adapter waits for `startAt`. Frame IDs, not wall clocks,
  are the simulation authority. This is not a claim of synchronized browser scheduling.

Room slots 0–7 remain stable when someone leaves; the lowest vacant slot is reused and
host ownership transfers to the lowest surviving **human** slot. CPU seats survive
host transfer, but the room is deleted when its last human leaves, even if CPUs remain.
Joining browsers skip CPU seats. Start players are sorted by room slot and may have
gaps. Map all room slots to dense simulation indices at the adapter.

`RoomView.players` and `MatchStart.players` combine human and CPU seats. The server
always includes `control: 'human' | 'cpu'`; omitted control means human only in legacy
in-memory fixtures, not old wire clients. CPUs have `name: 'CPU N'` (slot + 1) and
`ready: true`, but no socket, membership token, input frame counter or heartbeat.
CPU configuration resets all human readiness. Empty seats are absent from players.

JSON inputs (tests, tools) are immediately echoed to **all human members**, including the
sender. Binary inputs (every real client) go to the **other** humans only; both carry the
socket-owned human slot. Per-human-slot frames begin at zero and must arrive
consecutively. CPU inputs are never sent or relayed. The simulation/rollback adapter
uses the shared roles/seed to generate CPU decisions locally; this relay does not run
AI or claim equivalence to original Melee CPU behavior. Hash comparisons, unanimous
finish, frame lead, heartbeats and input timeouts count human sockets only. A single
human plus seven CPUs can confirm and finish without nonexistent CPU packets.

## Identity and lifecycle

The current handshake requires protocol **v10** plus exact `{game, wasm, content, packs}` identity.
`packs` is a sorted list of at most 16 `{id, hash}` entries (absent is equivalent to an empty list).
Each hash covers the canonical local pack manifest and every declared runtime source/data/asset byte.
Join, spectate and held-seat resume reject different sets or hashes before gameplay; human/CPU
selections must belong to the agreed set. Peers never send executable packs through this relay.
See [docs/characters/CUSTOM_CHARACTERS.md](../../docs/characters/CUSTOM_CHARACTERS.md).
Protocol v3 distinguishes human and CPU seats and rejects both v1 and human-only v2
clients at hello/create/join, even if someone reuses a game fingerprint. Protocol v6
adds room-scoped voice signaling and rejects v5 rooms; voice and input rooms must
never mix. Room limits come from
the simulation-free constants in `lib/game/limits.ts`. This is an eight-fighter port
prototype extension, not a claim that original Melee supports eight fighters.
`game` identifies the loaded game build (production bundles should include their
content hash). `wasm` and `content` are lowercase SHA-256 digests. The local helpers in
`lib/net/fingerprint.ts` work without Web Crypto on ordinary HTTP. Hash actual loaded
simulation bytes, including all selectable fighters/stages/custom data; a static
content version label is insufficient. This is compatibility checking, not trusted
attestation or anti-cheat. The server cannot prove a browser loaded assets or simulated
honestly. Every human member must report ready after loading; joins, human/CPU
selections, rules and returns to the lobby invalidate human readiness.

The relay chooses the seed, unique match identity and future shared start time.
Canonical hashes are compared for retained, fully received input frames. Mismatches
close the shared match with `DESYNC`, frame number, disagreeing slots and hashes.
The client adapter must hash canonical confirmed **post-frame** state, not prediction,
wall-clock timestamps, rendered pixels or audiovisual queues.

An explicit leave, a protocol violation or an input stall closes the shared match for
everyone. A **lost transport** (socket close, heartbeat timeout, congestion) or a **hidden
tab** does not: see *Held seats and resume* below. Room membership may remain in `ended` until an explicit lobby
request. Rematches require fresh readiness, seed and match identity. One bounded
just-closed match ID tombstone silently discards valid in-flight inputs/hashes/finish
messages for that match, including during the next rematch. Schema, membership and
rate checks still apply; unrelated or older match IDs remain errors. End reason codes
distinguish `MATCH_COMPLETE`, `DESYNC`, `PEER_LEFT`, `PEER_DISCONNECTED`,
`PEER_BACKGROUND`, `RETURNED_TO_LOBBY`, `INPUT_TIMEOUT`, `TIMEOUT` and `CONGESTION`.

## Binary input frames (v8)

A JSON input frame was ~330 bytes (48-char token + 48-char match id + thirteen named
fields) sixty times a second per human, fanned out to every peer. `lib/net/input-codec.ts`
packs the same frame into **14-15 bytes**: the socket already owns the seat (no token), the
match id is a 4-byte FNV tag, buttons are one byte, and each axis is two bits unless it is
analog (then an exact float64, so the simulation stays bit-identical with the JSON path;
the codec and `normalizeInput` fold `-0` to `0` the same way). Per-message deflate stays
off: it adds latency and cannot beat 3 payload bytes.

Two header bytes ride along and are never simulated or logged: the sender's local **input
delay** and its perceived **frame advantage**. `OnlineSession` uses them for time sync.

## Latency behaviour

- **Input delay** (`RollbackDriver` `inputDelay`, chosen per match from the measured RTT: 1
  frame on a LAN, +1 per ~33 ms, max 4; `?netDelay=N` or localStorage `smash.net.inputDelay`
  overrides). The polled input is scheduled `delay` frames ahead and sent at once, so it
  usually reaches the peers before they simulate that frame: far fewer mispredictions, which
  players see as teleports. Purely local; peers may differ.
- **Frame-advantage sync.** A client whose simulation runs ahead predicts every remote
  input (all corrections land on it) and hits the 8-frame prediction cap. Each side reports
  how far ahead it believes it is; half the difference of the two one-sided views cancels
  latency and leaves the true offset. The client that is ahead gives back one tick at a time.
- **Clock.** The server offset comes from the fastest of the last eight pings (one delayed
  pong used to drag the shared start), with a short ping burst right at `start`.
- A dead link is noticed in ~12 s (2 s pings) instead of ~40 s.

## Held seats and resume (v8)

While a match runs, a human whose socket drops (or whose tab is hidden) keeps the seat for
`RECONNECT_GRACE_MS` (90 s). `RoomView.players[].connected === false` and
`RoomView.graceEndsAt` tell the room; everyone else simply stalls at the prediction cap, so
no fighter is ever driven by invented inputs. Held time counts neither as an input stall nor
against the match's bounded duration. When the grace runs out the match ends with
`PEER_DISCONNECTED` / `PEER_BACKGROUND` and the seat is freed.

The relay logs every accepted input payload per seat. `{type:'resume', code, token, from}`
(the `joined` token; the newest socket wins over a half-open one) answers with
`joined` → `start` carrying `resume: {lastFrame, lastHash, finished}` → the run-length
encoded input backlog from `from` for every human seat → `synced`.

- **Same page, new socket** (`RoomClient` reconnects by itself with backoff): `from` is
  `confirmedFrame + 1`; the backlog flows through the normal rollback `receive`, then the
  adapter resends the local frames/hashes the relay never got.
- **Restarted browser**: the credential lives in localStorage (`smash.room.resume`);
  `OnlineSession` finds it at boot, reopens LAN mode and resumes from frame 0. The match is
  rebuilt from the shared start (seed, seats, rules) and the log is replayed deterministically
  in 12 ms slices (`RollbackDriver.preload` / `replayStep`, snapshots skipped until the last
  dozen frames), sending the checkpoint hashes the relay is still waiting for. No simulation
  state ever crosses the wire. A resumed seat that does not send a frame within
  `RESUME_CATCH_UP_MS` ends the match with `RESUME_TIMEOUT`.

`reconnectGraceMs: 0` (hub/server option) restores the old close-on-any-drop behaviour.

## Bounds and trust

- Native `ws`; no per-message compression; TCP no-delay enabled.
- Exact `/api/rooms` upgrade route, same-origin Origin required, same Host policy as
  the asset server. No cross-origin upgrade, arbitrary path or query-string endpoint.
- Random private membership tokens are bound to one socket at a time. They never appear in
  public room snapshots. During a running match the token also reclaims its own held seat
  (`resume`); it is still not an account, encryption, or protection from someone
  controlling the LAN.
- Strict JSON schemas/keys, 4 KiB payload limit, strictly validated binary input frames only, finite bounded
  controller inputs, maximum eight total human/CPU seats (joining a full room receives
  `ROOM_FULL`, even when CPUs fill it), 32 rooms,
  64 connected peers. Each browser still owns only one controller/slot; local keyboard
  controller counts do not change. Worst-case escaped eight-player room/start JSON
  fits the unchanged 4 KiB inbound budget and the browser's 16 KiB receive guard;
  per-frame input remains a single bounded controller record, not an eight-input batch.
- Per-socket token bucket: 240 units burst, 120 units/second; each input costs one,
  each trickle ICE costs four, each other command costs twelve. Frame lead is bounded to 120 over elapsed 60 Hz
  and the slowest sender. Canonical hash history is bounded to 120 frames.
- Buffered output above 256 KiB disconnects rather than silently dropping inputs.
  Native pings run every five seconds; missing pongs time out after thirty seconds.
  Ten seconds without input ends an active match even if transport pongs continue.
- No full-ISO, reference-executable, arbitrary-disc-file or private-directory route.
  Closing the HTTP server also closes upgraded sockets before releasing resources.

## Voice chat (experimental mesh)

`web/src/net/voice-client.ts` meshes Opus audio directly browser-to-browser for
2–8 humans in the same room. The central relay carries only SDP offers/answers and
trickle ICE (`voice-offer`, `voice-answer`, `voice-ice`); voice bytes never touch it.

- Room-scoped, token-owned, target-routed (never broadcast). CPU seats, self-targets
  and cross-room targets receive `VOICE_TARGET`; voice errors never close the shared
  match, never change readiness and work in lobby/playing/ended while the room lives.
- Lower room slot offers to higher slots; no glare, no duplicate meshes. Leaving,
  disconnect or background closes voice peers alongside the shared match.
- Off by default with local mute, push-to-talk hold, per-peer volume/mute and
  speaking indicators. `getUserMedia` needs a secure context (https or localhost);
  plain LAN http IPs block the mic with an explicit message. LAN-only host candidates
  by default; no STUN/TURN dependency. WAN traversal, SFU mixing and competitive
  latency remain explicitly out of scope.

Tests: `tests/unit/reconnect.test.ts` covers the binary codec, held seats, resume/backlog,
socket takeover, soft background, input delay, log replay equivalence and the `RoomClient`
reconnect/restart paths; `tests/server-browser/reconnect.spec.ts` cuts a real browser's socket
and then reloads it mid-match and requires hash consensus afterwards. `tests/unit/network.test.ts` covers protocol/state transitions, slot-seven and
sparse membership ownership, unanimous eight-member hashes/finish, worst-case payload
sizes, unchanged global/rate bounds and deterministic four/eight-peer injected latency.
`tests/unit/voice.test.ts` covers v6 voice validation, peer-to-peer offer/answer/ICE
relay, self/CPU/cross-room target rejection, match-safe voice errors, trickle rate
costs, `RoomClient` voice callbacks and lower-slot-offers mesh ownership with mocked
WebRTC. `web/src/net/voice-client.ts` meshes Opus audio peer-to-peer; `web/src/play/voice-panel.tsx`
owns the lobby/in-match voice UI while `GameSession`/Three.js keeps the sim/render loop.
Mixed-seat tests cover one human + seven CPUs and two humans + six CPUs, host-only
CPU edits, sparse joining after CPU removal, human ownership/CPU-input spoof rejection,
CPU-preserving host transfer, final-human cleanup, human-only liveness/hash/finish,
and mixed-room desync.
`tests/unit/network-server.test.ts` retains two/four-peer coverage, adds eight actual
WebSockets with ninth-member rejection, shared loss/spoof closure, late closed-match
hash/finish and rematch regressions, mixed-seat native sockets and the RoomClient
`setCpu` API, and tests security/shutdown boundaries; `tests/server-browser/network.spec.ts` uses four native
browser contexts and fixture identities for **transport only**. Those tests do not
establish GameCube behavioral equivalence or whole-engine rollback completeness.
