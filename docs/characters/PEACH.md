# Peach (Pe)

Imported 2026-09-14. Selector 15, native FTKIND 9, announcer cue `0x7C84B` (gm_80168C5C CKIND_PEACH=12).
Assets: `PlPe.dat`, `PlPeNr.dat`, `PlPeAJ.dat`, `EfPeData.dat`, `audio/us/peach.ssm`. 114-joint skeleton.
Figatree quirk (verified against ftPe_Submotion): Toad (SpecialN) plays the figatrees NAMED
`SpecialLw`/`SpecialLwHit`; the turnip pull (SpecialLw) plays the figatree NAMED `SpecialN`.

## Mechanics

- **Float** — `stepPeachFloat`: hold jump while descending with the double jump spent to hover
  (Fuwafuwa) for the native 150 frames (xC); one float per airtime, gravity fully cancelled.
- **Weapon smash** — ftPe_AttackS4_Enter: the forward smash draws Club/Pan/Racket at random via the
  match RNG, never the same twice in a row (`peachSmashName`); weapon visibility comes from the
  script's model-part events (GameRigs now applies them for Pe).
- **Turnips (SpecialLw)** — the pull rolls the native 8-face odds table (35/6/5/3/3/4/1/1, damage
  2–30; stitch-face 30). Attack/grab throws the held face with the shared common item-throw
  velocities as a `turnip` projectile whose model shows the face frame. Unported: the 1-in-128
  rare Bob-omb/Mr. Saturn/Beam Sword rolls, re-catching, and the held-item presentation.
- **Toad (SpecialN)** — counter: the xAC ShieldDesc bubble guards during the pose; a blocked hit
  swaps into SpecialNHit and bursts five slot-4 spores (10-frame, article-hit projectiles).
- **Peach Bomber (SpecialS)** — `ftpeachspecials.c`: SStart accelerates by x38 toward x3C (x34
  entry, x40 aerial lift; wall/ceiling latch cmd_vars[0]), then hops into SpecialSJump at x44/x4C
  with the x50→x58 fall and x54 brake from script command 1. The SJump's element-11 detect box
  runs doAirEnd0: the slot-0 explosion item spawns at HipN and Peach rebounds at x60/x64 into
  SpecialAirSEnd1 (a whiff divides by x68/x6C into AirSEnd0); both end in an ordinary Fall.
  Daisy runs the same kit on her own ftDataDaisy values.
- **Parasol (SpecialHi)** — root-motion rise, then ItemParasolOpen slow fall (drift + damped
  gravity); stick down folds into ItemParasolFall.

## Tests

- [tests/unit/peach-real.test.ts](../../tests/unit/peach-real.test.ts): registration, float clock,
  turnip faces/odds, Bomber rebound, Toad counter + spores, weapon-smash randomization, parasol fold.
- [tests/server-browser/koopa-peach.spec.ts](../../tests/server-browser/koopa-peach.spec.ts): real keyboard
  turnip pull/throw and float on the play page.
