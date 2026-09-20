# King of the Hill (local prototype)

A local-match variant: floor zones spawn at random ground spots, standing
uncontested inside one scores a point per second, and knocked out fighters
always respawn. The clock decides; most hill points wins.

## Rules

- **Zones A+B (or A only).** Each zone is a ground patch anchored at a random
  spawn-derived spot, half-width from the stage blast span (14–30 units).
  A holder must be grounded, alive and within ±14 units of the hill height.
- **Scoring.** Every second of sole control scores 1 point: free-for-all
  credits the lone holder; teams credit the lone side plus each holder's
  personal tally (used for the winning team's champion). Empty and
  contested zones hold at their current score.
- **Relocation.** Every 20 seconds both zones respawn at new random spots;
  the HUD counts down the shift.
- **Infinite lives.** KOs never take a stock in hill matches; the early
  stock-out finish is disabled and time-up ranks by hill points (damage,
  then slot, breaks ties; full ties draw).
- **Teams (optional).** RED (even seats) vs BLUE (odd seats). Team
  zone-seconds decide; the top contributor takes the winner slot.
- **Stock team battles.** The same RED vs BLUE flag works in normal
  stock matches: the side holding more total stocks takes it, direct
  strikes and grabs never connect between teammates (prototype CPUs hunt
  the other side), but projectiles and items still hit everyone. LAN
  rooms stay stock free-for-all.

## Scope (prototype, not Melee)

- Local/solo only. LAN rooms stay stock battles (`lib/net/protocol.ts`
  untouched).
- Prototype CPUs fight normally and do not play for the hill.
- Zone markers (amber/sky pulsing rings) and the scoreboard are
  supplemental visuals; simulation is ground intervals + integer points.
- Zone placement uses its own seeded stream (`lib/game/hill.ts`
  mulberry32), snapshot-owned like the Stadium clock, so rollback and
  hashes stay exact. Each match rolls a fresh seed for new layouts.

## Where it lives

- Rules: `lib/game/hill.ts`, wired into
  `lib/game/match.ts` options/state/snapshot/finish.
- Draft: `lib/game/setup.ts` `BattleSetup.hill`
  and the shared `BattleSetup.teams` flag;
  `web/src/play/game-session.ts`
  `chooseHill()` (Hyrule Temple preselected), `setRules({ hill })`.
- UI: `web/src/play/mode-select.tsx`
  `#mode-hill`, `web/src/play/battle-select.tsx`
  (`#setup-match-type`, `#setup-hill-zones`, `#setup-teams`),
  `web/src/play/match-hud.tsx` (`#hill-hud`),
  markers in `web/src/render/play-renderer.ts`.
- Tests: `tests/unit/hill.test.ts` (pure rules),
  hill UI contracts in `tests/unit/battle-select.test.ts`,
  `tests/server-browser/hill.spec.ts`
  (temple draft, live scoring, teams).
