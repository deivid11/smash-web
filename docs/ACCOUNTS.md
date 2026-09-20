# Accounts, cloud saves, profiles and friends

Optional player accounts on the game server (`scripts/serve.ts`). Nothing in play
requires one. Signing in adds:

- **Cloud saves** for Rift Descent: Mirror talents, relics and keys, champion
  mastery, lifetime stats, best run, and the **saved in-progress descent**.
- A **profile** with a display name, a title, a fighter avatar and a Rift record.
- **Friends**: requests by username, online presence, joining a friend's open
  LAN room with one tap, and sending room invites.

## Pieces

| Layer | File |
| --- | --- |
| JSON contract (shared) | [lib/net/account-protocol.ts](../lib/net/account-protocol.ts) |
| SQLite store: users, sessions, saves, friendships; in-memory presence + invites | [server/accounts.ts](../server/accounts.ts) |
| HTTP routes, bearer auth, body limits, rate limits | [server/account-api.ts](../server/account-api.ts) |
| Route wiring (the only non-GET routes on the server) | [server/http.ts](../server/http.ts) |
| Browser client: session, presence heartbeat, friends, cloud sync | [web/src/account/account-client.ts](../web/src/account/account-client.ts) |
| Rift slot keys + pure sync decision (`planSync`) | [web/src/account/cloud-save.ts](../web/src/account/cloud-save.ts) |
| Screens: SIGN IN, PROFILE, FRIENDS, home entry, invite toast, LAN strip | [web/src/account/account-screens.tsx](../web/src/account/account-screens.tsx) |
| Rift save & quit (in-progress run) | [lib/game/roguelike/suspend.ts](../lib/game/roguelike/suspend.ts) |

The database is Node's built-in `node:sqlite` (Node ≥ 22.13 needs no flag; it
prints an ExperimentalWarning at boot). No native module is compiled.

## Server configuration

- `SMASH_DB_PATH`: SQLite file, default `private/accounts.sqlite` (relative to
  the repo). Set it to `off` to disable accounts; the routes then answer 503
  and the home entry opens an "accounts unavailable" page.
- On a deploy host, keep the file **outside** the rsynced code directory (for
  example `/srv/smash-web/data/accounts.sqlite`) and back up the
  `-wal` file together with the main file.
- `createMeleeServer({ databasePath })` in tests: `':memory:'` works.

## API

Every route is JSON on the game origin, so the existing cross-origin checks in
`server/http.ts` still apply first. Writes need `Content-Type: application/json`.
The session is a bearer token (`Authorization: Bearer …`). It is stored in
localStorage, never in cookies, so cross-site forms cannot act for a player.

| Method + path | Body | Result |
| --- | --- | --- |
| `POST /api/account/register` | `username`, `password`, `displayName?` | `201 { token, account }` |
| `POST /api/account/login` | `username`, `password` | `{ token, account }` |
| `POST /api/account/logout` | — | `{ ok }` |
| `GET /api/account` | — | `{ account }` |
| `DELETE /api/account` | `password` | `{ ok }` (cascades sessions, saves, friendships) |
| `PATCH /api/account/profile` | `displayName?`, `title?`, `avatar?` | `{ account }` |
| `POST /api/account/password` | `current`, `next` | `{ ok }` (other sessions are signed out) |
| `GET /api/saves/rift` | — | `{ save: { data, revision, updatedAt } \| null }` |
| `PUT /api/saves/rift` | `data`, `baseRevision` | `{ revision, updatedAt }`, or `409 { error, save }` when stale |
| `GET /api/friends` | — | `{ friends, incoming, outgoing, invites }` |
| `POST /api/friends/requests` | `username` | friends view (a crossing request accepts) |
| `POST /api/friends/respond` | `userId`, `accept` | friends view |
| `POST /api/friends/remove` | `userId` | friends view (unfriend or cancel) |
| `POST /api/friends/invite` | `userId`, `room` | `{ ok }` (friends only, open lobby only) |
| `POST /api/friends/invites/dismiss` | `id` | `{ ok }` |
| `POST /api/presence` | `activity`, `room` | `{ incoming, onlineFriends, invites }` |
| `POST /api/games` | a `GameReport` | `201 { id }` (`id: null` when that `clientId` was already stored) |
| `GET /api/players?q=&offset=&limit=` | — (**no session**) | `{ players, total }`: every account, most recently active first |
| `GET /api/players/:username` | — (**no session**) | `{ profile, rift, stats, recent }` |

Limits: usernames are 3–20 characters from `[A-Za-z0-9_]` (case-insensitive and
unique). Passwords are 8–128 characters, hashed with scrypt (N = 2^15) and
compared in constant time. Display names are up to 24 characters and titles up
to 32. A save is at most 256 KiB. Sessions last 60 days, slide on use, and cap
at 20 per player. Rate limits per address: 120-request bucket (4/s refill) for
all routes; 10-attempt bucket (1 per 6 s) for sign-in, password and delete;
5 sign-ups per hour.
Behind the gateway proxy, a loopback peer's `X-Real-IP` / `X-Forwarded-For`
names the client.

Presence and invites live in memory. A restart forgets them, and clients
restore presence within one 30 s heartbeat. A friend is online for 75 s after
their last heartbeat. Rooms come from the relay's public lobby list
(`RoomHub.listRooms`), so JOIN appears only for open, non-full lobbies. The room
protocol itself is unchanged.

## Game history and public profiles

While signed in, every finished game is reported by the player's own browser
(`web/src/account/game-report.ts`): local battles, LAN matches (the local seat
only; spectators report nothing), local tournament sets, and each finished Rift
run (win, defeat or abandon). Rift floor fights are not games of their own. A
report carries a random `clientId`, so a retried upload is stored once, and
reports made offline wait in localStorage (`smash-pending-games`) for the next
heartbeat. Reports are self-declared and only displayed: nothing ranks on them.
The server validates and clamps every field, keeps the latest 5000 games per
player, and deletes them with the account. Reports are rate limited per player
(20-report bucket, 1 per 15 s).

The PLAYERS directory and profile pages are public: the directory lists every
registered account, and a profile shows totals over all recorded games (per
mode and per fighter), the last 20 games, and the lifetime Rift record read from
the cloud save. Nothing private (friends, presence, saves) is exposed.

URLs: the game is `/play` (`/` redirects there), the directory `/players` and a
profile `/players/<username>`. The server answers all three with play.html and the
app reads the path, pushing history entries so the browser back button steps from a
profile to the directory. `/play.html` keeps working for the Android shell and the
offline worker, which never rewrites its URL; old `#players` / `#player=` links still open.

## Cloud save rules

The rift slot mirrors four localStorage keys verbatim:
`smash-roguelike-meta`, `smash-roguelike-best`, `smash-roguelike-run` and
`smash-roguelike-fighter`. The key `smash-cloud-link` remembers which account
and revision this browser last synced, and whether it changed since (`dirty`).

`planSync` decides each sync:

- no cloud copy → upload if this device has progress;
- same account, same revision → upload when dirty, otherwise nothing;
- same account, cloud moved on, device unchanged → download;
- a different or unknown account on this device with no local progress → download;
- identical progress → just link;
- both sides differ with real progress → **conflict**. PROFILE shows both
  summaries with KEEP THIS DEVICE / KEEP CLOUD. Progress is never merged or
  overwritten silently.

Every `saveMeta` and run save fires `onRogueSaved` (in
`lib/game/roguelike/meta.ts`), which schedules an upload 1.5 s later. A 409
means another device saved in between, so the client reconciles again. A
download bumps `epoch`, which remounts the Rift setup and drops a stale run
screen (a live fight is never interrupted).

## Rift save & quit

`RogueController.step` writes the run after every settled step. A finished run
clears the save. A run saved during a fight resumes at that floor's intro with
its pre-fight state (Slay the Spire rules). The map is not stored:
`planForRun` regenerates it from the seed label and settings, and it rejects
the save if the plan seed no longer matches. The Rift hub shows CONTINUE
DESCENT when a save exists, and the 💾 corner icon on run screens returns to
the hub without abandoning.

## Tests

- `tests/unit/accounts.test.ts`: service rules (auth, sessions, profile, saves
  and revisions, friends, presence, invites, deletion) and the HTTP layer
  (methods, JSON-only writes, cross-site rejection, rate limit).
- `tests/unit/player-profiles.test.ts`: game reports (dedupe, validation, totals,
  directory order and search, lifetime Rift record, v1→v2 migration), seat result
  rules, and the public HTTP routes.
- `tests/unit/cloud-save.test.ts`: `planSync` cases, rift slot round trip, and
  run save and resume.
- A private browser walkthrough covered two players, friend/invite/join, and a third
  device pulling a cloud save through a conflict. Its local harness is not distributed.
