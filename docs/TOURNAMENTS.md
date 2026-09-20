# Tournaments

Single-elimination 1-v-1 brackets, LOCAL (this device) or LAN / ONLINE (accounts + LAN rooms).
Home → **TOURNAMENT**. Any number of tournaments run side by side, and every one can be left at any
set and resumed later.

## Rules of the tree (`lib/game/tournament/bracket.ts`)

- The bracket is the next power of two ≥ entrants (2–32). Humans are shuffled into the top seeds.
- **CPU fill** (on by default): random CPUs with a level rolled inside a range (default LV 6–9) and a
  random fighter pad the bracket to the chosen size (the wizard offers every power of two up to 32).
  Without the fill, the empty seats are byes for the top seeds. Standard seeding means byes and CPUs
  meet the top seeds first and two byes can never meet.
- Modes: `classic` (stocks + clock, pick every set), `hill` (King of the Hill zones A / A+B, clock
  decides), `random` (RANDOM CHAMP: a champion is rolled for both sides every set). Stocks 1–9,
  time 1–10 min. Items are off. A draw replays the set (`replays` is counted on the match).
- CPU-vs-CPU sets: LOCAL offers 👁 WATCH (a real match) or ⏩ SIMULATE (weight = level²); the LAN
  server simulates them at once so they never block humans.
- Everything random threads through the tournament seed: the engine is pure and unit-tested
  (`tests/unit/tournaments.test.ts`).

## Local (`web/src/play/tournament/local-store.ts`)

State lives in `localStorage['smash-tournaments']` (running brackets are never dropped; the 12 most
recent finished ones are kept). A set is an ordinary local match of exactly two seats
(`GameSession.startTournamentSet`); pads 1 and 2 belong to the two players of the set. When the match
ends `TournamentController.trackLocal` records the winner and the result screen comes up; quitting from
the pause menu records nothing. WALKOVER advances a side whose player is not around.

## LAN / online

- **Server** `server/tournaments.ts` + `server/tournament-api.ts`, JSON contract
  `lib/net/tournament-protocol.ts`, routes under `/api/tournaments` (bearer token of the account API).
  Tables `tournaments` / `tournament_players` live in the accounts SQLite file (`SMASH_DB_PATH`), so the
  same deploy caveat applies. Entrants are **any usernames** (`GET /api/tournaments/users?q=`), friends
  or not; the organizer does not have to play.
- **Set lobby**: a player opens their set and presses READY; check-ins (every 4 s, 20 s TTL, in memory)
  show the rival who is in the lobby / ready. When both are ready the *host side* (side A if human)
  opens an ordinary LAN room with the bracket's rules, seats the CPU rival if there is one and
  publishes the code; the other side auto-joins. Fighters, stage and Ready are the normal room flow.
- **Result**: after `MATCH_COMPLETE` both browsers report the winner (room slot 0 = host side). Two
  matching reports settle the set; a lone report settles after 30 s; different reports mark the set
  `disputed` and the organizer decides. The organizer can also advance a side (walkover), reopen a set
  that nothing was played on top of, cancel and delete. Only a 1-v-1 counts.
- **Spectators** (room protocol v9, `lib/net/protocol.ts`): `{type:'spectate', code, fingerprint}` joins
  a room read-only in any phase. Spectators get every room update, the start, every human's inputs (a
  mid-match join gets the whole input log first) and simulate the match confirmed-only
  (`RollbackDriver.preload` + `replayStep`); they never count for ready / hash / finish quorums and a
  dropped spectator never holds or ends a match. `OnlineSession.spectate(code)` / `leave()`. Live sets
  show ● LIVE in the bracket and a 👁 SPECTATE button. v9 also adds optional `rules.hill` (1|2 zones) so
  King of the Hill sets run online.

## Screens (`web/src/play/tournament/`)

`tournament-screens.tsx` (hub · 4-step wizard PLAYERS → MODE → RULES → BRACKET preview · bracket with
UP NEXT queue · set VS / lobby / result · champion ceremony), `tournament-art.tsx` (SVG cup, laurels,
VS bolt, mode emblems, spotlights, confetti), `tournament.css` (one viewport per page, no scroll),
`controller.ts` (flow for both scopes; it outlives the screens because the arena and the LAN room
unmount them). All controls are native buttons / inputs, so the pad focus navigation drives them.

Private local/LAN walkthroughs also checked versus and spectator flows. Their screenshots
and ad-hoc scripts are not distributed with the source.
