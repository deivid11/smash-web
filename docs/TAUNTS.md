# Taunts (Appeal)

Scope: the original per-fighter Appeal motion, entered and ended by this port's match flow.
A bounded port of one original mechanism, not a claim of whole-engine equivalence.

## What the original does

[ftCo_AppealS.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_AppealS.c):

- `ftCo_800DE9B8` fires on a **D-pad up press**. `ftCo_800DE9D8` is called from
  [ftCo_Wait.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Wait.c),
  `ftCo_Walk.c`, `ftCo_Dash.c`, `ftCo_Run.c`, `ftCo_RunDirect.c`, `ftCo_Turn.c`,
  `ftCo_Squat.c` / `ftCo_SquatWait.c` / `ftCo_SquatRv.c`, `ftCo_Landing.c`,
  `ftCo_Ottotto.c` and `ftCo_AttackS4.c` — in `ftCo_Wait_IASA` it sits **after** every
  attack, grab and shield check and **before** jump, dash, turn and walk.
- `ftCo_800DEAE8(gobj, ftCo_MS_AppealSR, ftCo_MS_AppealSL)` picks the motion: the L
  motion only when the fighter faces left **and** its animation table actually holds a
  distinct left clip; otherwise the R motion. Fighters author one `Appeal`, a facing pair
  `AppealR`/`AppealL`, a raised pair `AppealHiR`/`AppealHiL` or a single `AppealLw`.
- Entry clears `allow_interrupt`. `ftCo_AppealS_IASA` gives control back only once the
  subaction script raises the flag again, and then only to specials, attacks, grab and
  shield. `ftCo_AppealS_Anim` returns to Wait when the clip runs out.
- `ftCo_AppealS_Phys` (`ft_80084FA8`) applies the standing friction — doubled above walk
  speed — plus the clip's `TransN` root motion, exactly like a grounded attack.
  `ftCo_AppealS_Coll` (`ft_80084104`) drops the fighter into Fall when the ground goes
  away; there is no Wait-style ledge stop.
- A few Appeal scripts author real hitboxes (Luigi's kick: 1% on frame 45, cleared on 46).

## What this port does

[lib/game/taunt.ts](../lib/game/taunt.ts) resolves the motion with the same rule (a facing
pair only when both sides exist, otherwise the symmetric clip), and
[lib/game/load.ts](../lib/game/load.ts) loads every `Appeal*` motion with its own script,
tolerantly: a source whose fighter authors none simply cannot taunt.

[lib/game/match.ts](../lib/game/match.ts) adds the `taunt` fighter state:

- Entered on a fresh `taunt` press while **grounded**, from `idle`, `walk`, `run` or
  `crouch`, or out of a grounded normal past its interrupt frame; never in the air, never
  while carrying a heavy item, and never out of another Appeal.
- A same-frame attack, strong, special, grab or shield keeps the input; a same-frame jump
  does not, matching the `ftCo_Wait_IASA` order.
- Committal until the clip ends, unless the script raises its interrupt flag — Pikachu,
  Pichu, Raichu (frame 60) and Yoshi (frame 67) do; every other taunt on this source never
  does. Past that frame the Appeal joins the same action gate grounded normals use
  ([docs/IASA.md](IASA.md)); that gate is slightly wider than `ftCo_AppealS_IASA` (it also
  takes jump and movement).
- Standing friction plus the clip's root motion, Fall when the ground goes away, and the
  script's voice cue and graphics through the normal timeline path. A hit ends it like any
  other state (`ftCo_Damage`).
- Appeal scripts that create hitboxes are registered as attacks and strike from the taunt
  state; every other Appeal stays harmless.

Every fighter on the original disc and on the ACE 2.0 extension disc resolves an Appeal.

## Controls

| | Player 1 | Player 2 | Controller |
| --- | --- | --- | --- |
| Taunt | `T` | `B` or numpad `3` | View / Select (button 8) |

All of them are rebindable — keys in **Options → Keyboard**, buttons in
**Options → Controllers**. The original's D-pad drives movement in this port, so the taunt
gets its own button instead.

## Not ported

- **Fox and Falco's Corneria/Venom smash taunt**
  ([ftfoxappeals.c](../third_party/melee/src/melee/ft/kinds/ftFox/ftfoxappeals.c)): the
  `AppealSStart*/AppealS*/AppealSEnd*` three-part side taunt, its once-per-match stage
  check and the Star Fox radio conversation. The clips exist in the fighter files and are
  not loaded.
- The cosmetic articles some taunts spawn: Young Link's milk bottle
  ([ftclinkappeals.c](../third_party/melee/src/melee/ft/kinds/ftCLink/ftclinkappeals.c))
  and Dr. Mario's vitamin pill
  ([ftdrmarioappeals.c](../third_party/melee/src/melee/ft/kinds/ftDrMario/ftdrmarioappeals.c)).
  Both taunts play their own motion, script sounds and graphics without the item.
- Peach's and Zelda's debug-ROM-only appeal branches (`DbLevel >= DbLKind_DebugRom`).

## Tests

[tests/unit/taunt-real.test.ts](../tests/unit/taunt-real.test.ts): motion selection,
roster coverage (original disc, plus the full ACE roster when `MELEE_ACE_ISO` is set),
entry states and priority, the interrupt flag, Luigi's taunt hitbox, and a snapshot /
rollback round trip. The disc-backed cases require `MELEE_DISC_PATH`; without it, report
them as skipped.
