# Jigglypuff (Pr)

Imported 2026-09-14. Selector 12, native FTKIND 15, announcer cue `0x7C83D` (gm_80168C5C CKIND_PURIN=15).
Assets: `PlPr.dat`, `PlPrNr.dat`, `PlPrAJ.dat`, `EfPrData.dat`, `audio/us/purin.ssm`. 50-joint skeleton.
Jigglypuff names its idle `Wait` (submotion 2) and its crouch `SquatWait1`; the engine keys map both.

## Movement

- **Five air jumps** (six total): the Fighter_x2D0_t multi-jump block at ftPurinAttributes +0 is
  identical to Kirby's (turn 12 frames, threshold 0.3, verticals 1.65 → 1.25, msid base 341).

## Specials

- **Rollout (SpecialN)** — `lib/game/purin.ts`, ftpurinspecialn.c. Charge loop on the frozen SpecialN
  figatree (50 → 180 charge at 3/frame), release roll at 0.03·(charge−40) up to 6 speed for 90 frames,
  braking turn on a hard opposite stick (xC4 traction, x1C = −0.05·turn velocity, xD0 exit ratio),
  landing bounce (0.4 damped, 0.8 threshold), speed-scaled damage 3·(2+|vel|) gated at 2.0 speed,
  on-hit recoil into SpecialNHit (velocity ×−0.13, +1.6 up) and 30 frames of FallSpecial landing lag.
  The roll spin is the native FtPart_YRotN joint rotation, mirrored by GameRigs. Unported: the xD4 wall
  rebound (the shared surface blocker stops the roll), the JObj scale pop and the capsule-parity toggle.
- **Pound (SpecialS)** — script-owned; the aerial variant boosts along the clamped stick angle
  (0.1–0.5 stick → up to 20°, speed 2.2) and decays at 0.92 per frame under cmd var 1.
- **Sing (SpecialHi)** — script hits carry element 6 (HitElement_Nap): grounded victims sleep 103
  frames in FuraSleepStart/Loop and mash awake through FuraSleepEnd (shared engine sleep, `combat.sleep`).
- **Rest (SpecialLw)** — script-owned point-blank hit (28% fire at part 5, frames 1–2); the long
  L/R clips carry the sleep recovery.

## Tests

- [tests/unit/purin-real.test.ts](../../tests/unit/purin-real.test.ts): registration, attribute/multi-jump
  values, Rollout connect + end, Pound boost, Sing sleep + mash wake, Rest damage, six jumps.
- [tests/server-browser/purin-ness.spec.ts](../../tests/server-browser/purin-ness.spec.ts): real keyboard
  Rollout charge/release and multi-jump on the play page.
