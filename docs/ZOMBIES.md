# Zombies (infection prototype, local only)

Last stock out joins the horde: a blast KO at one stock respawns the victim
**infected** with one permanent stock instead of eliminating them. The horde
wins the moment no clean survivor holds a stock; the clock expiring with
survivors alive hands them the win.

## Rules

- Setup is the solo stock flow with `MATCH = ZOMBIES`
  ([web/src/play/battle-select.tsx](../web/src/play/battle-select.tsx)): the
  stocks rule sets **survivor** stocks, teams are forced off, hill is cleared.
- Infection is sticky and permanent. The first victim is patient zero and
  takes the winner slot on a horde win
  (`zombieWinner` in [lib/game/match.ts](../lib/game/match.ts)); a survivor
  timeout ranks clean survivors by stocks, then damage (versus tiebreak).
- The infected hit ×1.2 (`ZOMBIE_DEALT_MUL`) and take ×1.15
  (`ZOMBIE_TAKEN_MUL`) — prototype tuning through original damage/knockback
  coupling, like roguelike boons. Same fighters, same movesets.
- Direct strikes, grabs and detects never connect between the infected;
  projectiles and items still hit everyone (team-battle precedent). Survivors
  stay free-for-all. CPUs hunt the other side of the infection and flip
  targets mid-lock when someone turns.
- HUD: infected cards show a 🧟 badge and ∞ stocks; the arena banner calls
  out `NAME IS INFECTED`; results read `ZOMBIES WIN — name patient zero.` or
  `name SURVIVES THE HORDE.`

## Scope and limits

- Local humans + CPUs only (the MATCH picker is local-only, as with hill).
  Online rooms stay stock: infection state is snapshot-owned and hashed, so a
  future relay phase only needs the shared rules handshake, not new transport.
- No arena model tint yet — team sides are HUD-only, as with RED VS BLUE.
- `fighter.infected` and `firstInfected` ride the standard snapshot, so
  rollback restores both; the ready-check roster and stage rosters already
  share one map.

## Tests

- `tests/unit/zombies.test.ts`: result table (horde win, survivor ranking,
  ties, empty) without booting a match.
- `tests/server-browser/zombies.spec.ts`: real solo match, 1 stock, walk-off
  KO must infect (badge + ∞) while the match plays on.
