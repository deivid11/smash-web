# Party chat (global voice)

Voice is no longer tied to a LAN room. A signed-in browser keeps one **party socket**
(`/api/party`, `lib/net/party-protocol.ts`) for the whole page, so a group keeps talking across
menus, local and LAN battles, tournaments and Rift runs — like Xbox Live parties.

- **Channels**: permanent public lounges (`#lobby`, `#lfg`, `#tournaments`, `#rift`, `#es`), 8 seats each.
- **Parties**: created by a player, `OPEN` / `FRIENDS ONLY` (friends of the leader) / `INVITE ONLY`.
  Leader can change privacy, rename and remove members; leadership passes on when they leave; an
  empty party disappears. Friends get invites (5 min TTL). Invite-only parties are listed only to
  members, invitees and friends of members.
- A browser sits in one group at a time. One live socket per account: a second tab takes the group
  over and the first one stands down without reconnecting.
- Members self-report `mic` and `activity` (menus / local / LAN / Rift / tournament).

Server: `server/party-hub.ts` (transport-free `PartyHub` + `attachPartyServer`), wired in
`server/http.ts`; needs accounts (`SMASH_DB_PATH`), otherwise the socket path answers 503. Rooms'
upgrade listener ignores the party path. nginx on the gateway must proxy `/api/party` as a
WebSocket, like `/api/rooms`.

## Audio

`web/src/net/voice-client.ts` is the same WebRTC mesh for both scopes; it talks to a
`VoiceTransport` (RoomClient for room voice, `web/src/net/party-client.ts` for party voice, mesh id =
account id, lower id offers). Only one microphone is live: joining party voice leaves room voice and
the other way round (web/src/play/play-app.tsx).

ICE servers come from `GET /api/voice/config` (`SMASH_ICE_SERVERS`, JSON array; default public STUN,
`[]` = host candidates only). Before this, voice used no ICE servers at all, so it only ever connected
browsers on the same LAN — players meeting through a public Internet host could not hear each other. Symmetric
NATs still need a TURN server in `SMASH_ICE_SERVERS`.

## Fixes found while validating (2026-09-18)

- **Enable-order bug**: the lower slot offered once; if the other player had not enabled voice yet
  the offer was dropped and nothing ever asked again, so the pair never connected. The offerer now
  re-offers every 2.5 s (5 s after five tries) until connected; the answerer restarts cleanly on a
  repeated offer; late answers / stale ICE of a replaced attempt are ignored instead of shown as errors.
- Talk indicators had no hold time and were sampled every 200 ms, so short sounds never lit them.
  Now 100 ms sampling with a 700 ms hold. The level analyser resumes a suspended AudioContext.

## UI

`web/src/play/party-panel.tsx`: 🎧 chip (home settings row and every scene header, badge for invites,
ring while someone talks), the PARTY CHAT dialog (channels · parties · start a party · current group
with per-member volume / mute, mute mic, push-to-talk, invites) — also reachable from Options during
a match — and an in-match overlay naming whoever talks. Native controls only, so the pad works.

## Validation

- Unit: `tests/unit/party-hub.test.ts`, `tests/unit/party-client.test.ts`, `tests/unit/voice.test.ts`.
- Private browser walkthroughs used two Chromium contexts with fake microphones to check
  room voice (connect, hear both ways, mute, push-to-talk, local mute, leave) and party voice
  (channel voice from home, mic flag, match entry, activity, create/join/re-mesh/leave).
  These ad-hoc harnesses are not distributed; use the repository tests for repeatable checks.
