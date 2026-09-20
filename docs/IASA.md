# Interrupt frames (IASA) on grounded normals

Scope: how an attack's authored interrupt frame is honoured. This is a bounded port of one
original mechanism, not a claim of whole-engine equivalence.

## What the original does

Subaction command `0x5C` ("Allow Interrupt", opcode **23** in
[lib/game/moves.ts](../lib/game/moves.ts)) sets `fp->allow_interrupt` partway through a move's
script. From that frame, the state's IASA callback hands control to the common actionable set:

- [ftCo_AttackS3.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_AttackS3.c) and
  [ftCo_AttackDash.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_AttackDash.c) call
  `ftCo_Wait_IASA` outright once the flag is set.
- [ftCo_Wait.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Wait.c) `ftCo_Wait_IASA` is
  that set: side special, jab/rapid jab, grab, the four smashes, the three tilts, jump, dash,
  turn and walk.
- [ftCo_Attack1.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Attack1.c)
  `ftCo_Attack11_IASA`/`ftCo_Attack12_IASA` are the exception: they run `checkAttack12`
  **before** and outside the flag, so the A button always belongs to the jab chain, never to a
  restart of jab 1.

The flag never ends the move by itself. Without an input the animation plays to its last frame.

## What this port honours

[lib/game/match.ts](../lib/game/match.ts) (`interruptible`, feeding `canAct`): a **grounded**
attack past its parsed `interruptFrame` joins the same action gate the idle/walk/run states use,
but only on a real input — attack, strong, special, jump, shield, grab, a stick direction or a
crouch. That mirrors `ftCo_Wait_IASA` with this port's action set.

Deliberately excluded:

- **Jab 1 and jab 2.** Their chain, windows and rapid-jab thresholds live in
  [lib/game/jab.ts](../lib/game/jab.ts) and run before the gate; letting the gate take the A
  press would restart jab 1 and reset the rapid-jab edge count. Jab 3 keeps its existing
  finisher gate (`ftCo_Attack13_IASA`) and also reaches the generic one.
- **A charging smash**, which still owns the button until release.
- **Aerials.** `ftCo_AttackAir*_IASA` opens a *smaller* set (aerial attack, air jump, air catch —
  not special or air dodge); Link's is already handled in
  [lib/game/link-actions.ts](../lib/game/link-actions.ts). The generic set here would be wrong
  for them, so airborne attacks still play out.
- **Dodges and specials.** `EscapeN` and a few specials (Ganondorf's `SpecialN`, for instance)
  carry interrupt frames the port does not read; each special's flow is owned by its own module.

## Measured effect

Across the loaded roster (original disc plus the ACE extension fighters), **747** move scripts
carry an interrupt frame, together holding about **4157 frames** of recovery the original lets
you skip and this port previously played out in full. Samples (interrupt/total):

| Fighter | Move | Interrupt | Total |
| --- | --- | --- | --- |
| Marth | `AttackLw3` | 20 | 58 |
| Roy | `AttackDash` | 40 | 58 |
| Marth | `AttackDash` | 40 | 50 |
| Zero | `AttackDash` | 48 | 56 |
| Fox | `AttackDash` | 36 | 40 |
| Zero | `Attack11` | 13 | 25 |

Specials are unaffected: a move like Zero's `SpecialS1` authors no interrupt frame, so its 25
frames play out exactly as before, and the next action still starts on the frame after it ends.

## Validation

`tests/unit/gameplay-real.test.ts` — "hands a grounded normal back to Wait_IASA at its authored
interrupt frame": the dash attack still plays every frame with no input, and shielding inside the
window leaves the move early. Requires `MELEE_DISC_PATH`.
