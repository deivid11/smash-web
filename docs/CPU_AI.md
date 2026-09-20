# CPU players and levels

The browser prototype's CPU fighters are driven by [lib/game/cpu.ts](../lib/game/cpu.ts). It is
**prototype code**, not Nintendo's CPU AI: it reads this port's fighter records and emits the same
`PlayerInput` a human controller would. What it borrows from the original game is the **level
ladder** — the per-level numbers that make a level 1 CPU hesitant and passive and a level 9 CPU
relentless. Those numbers were read from the upstream decompilation checkout (never copied as code)
and are listed below with their source functions so they can be audited.

## Choosing a level

- Every CPU seat has a level from 1 (Rookie) to 9 (Elite); the default is 5 (Skilled).
- **Local / solo:** on the battle screen, set a seat to CPU and pick `LV 1…9` next to it.
- **LAN:** only the host configures CPU seats; the level travels in the room protocol (v4) with the
  seat and is included in the match start message so every browser simulates the same brain.
- The HUD shows `CPU L<n>` next to the seat number.

`LocalMatch` takes `cpuLevels` (one entry per dense fighter slot; human slots ignore it). Levels are
part of the match configuration string, so snapshots from differently configured matches are
rejected and rollback peers must agree on them.

## What the level changes

| Mechanic | Level 1 → 9 | Original source |
| --- | --- | --- |
| Neutral frames before every attack | 5–39 → 0 | `ftCo_800B63D8` (ftcpuattack.c) |
| Decision ticks on which attacks are suppressed | 60 % → 40 % → 50 % → 25 % → never from level 5 | `ftCo_800B885C` |
| Window of the 120-frame cycle in which incoming attacks are answered | never (1) → 16 % (2) … 92 % (8) → always (9) | `ftCo_800A5ACC` (ftCo_0A01.c) |
| Extra shield frames after the threat | (9 − level) × 4..7 | `ftCo_800B9F90` |
| Movement stick clamp | 0.57 → 1.0 (walks below the dash threshold) | `ftCo_800AA320` |
| Off-stage drift magnitude | 0.70 → 1.0 | `ftCo_800A9904` |
| Platform drop-through wait | 30 → 1 frames | `ftCo_800A08F0` |
| Projectile reaction lookahead | 10–29 frames (sloppy, early) → 1 | `ftCo_800BB220` |
| Ranged special cooldown | (10 − level) × (15..30) + 10 frames | `ftCo_800B9704` |
| Hit-zone scale | 0.575 → 0.775 of the authored zone (low levels stand closer) | `ftCo_CpuUpdateRecoveryScale` |
| Prefer human targets (rerolled every 300 frames) | 34 % → 66 %, prototype: only while the nearest human is within 40 units past the nearest foe (`HUMAN_CHASE_BAND`), otherwise nearest by 2D distance | `ftCo_800B33B0` + `ftCo_800A53DC` (human-pool search) vs `ftCo_800A4BEC`/`ftCo_800A1AB4` (nearest) |
| Grab escape: stick flip every 3 frames | 10 % → 90 % | `ftCo_800AC30C` |
| Ledge with an enemy within 30 units: roll, else ledge attack | 10 % → 90 % roll | `ftCo_800ACB44` |
| Jump after an elevated target | level 4 and up | `ftCo_800B732C` |
| Grab a shielding target | level 6 and up | `ftCo_800B8A9C` |
| Charge a smash at kill percent | level 5 and up | prototype gate (`ftCo_800ACD5C` gates neutral-B charging at 5) |

`cpuLevelTuning(level)` returns these values for tests and tooling.

## How a decision is made (prototype)

Every frame `cpuInput` runs a priority chain in the spirit of the original's state selection:

1. **Reflexes:** KO/respawn and hitstun emit neutral; captured/dizzy mash by level; a ledge grab
   picks climb/roll/attack/jump once (60/20/10/10 % uncamped); holding a victim pummels or throws
   (throw odds grow with each pummel; from level 5 throws aim at the nearer blast zone or up).
2. **Recovery:** off stage (no floor below or beyond the main platform) the CPU drifts toward the
   nearest ledge with the level's stick magnitude, spends air jumps on the way down, and finally
   aims its up special diagonally when far and straight up when close. Under the stage lip it moves
   outward first.
3. **Defense:** inside the level's duty-cycle window it reads opponents' current move scripts for
   hits that come out within three frames (plus projectile lookahead) and answers with a roll
   (through a close attacker, away from a far one), a shield held for the level's extra frames with
   an out-of-shield grab from level 6, a reflector against projectiles (Fox, Mario, Mewtwo), or an
   air dodge when airborne.
4. **Attack:** every ground move, grab/inhale and aerial has a forward-relative hit zone; the
   target's led position is tested against the level-scaled zones and one candidate is drawn by
   weight (kill moves gain weight above 80 %). The chosen input is queued behind the level's
   hesitation; a turn-around step is prepended when the zone is behind the CPU.
5. **Ranged specials:** blaster/fireball/missile/jolt/boomerang at distance with the cooldown table.
6. **Navigation** ([lib/game/cpu-nav.ts](../lib/game/cpu-nav.ts)): the stage's floors are grouped
   into walkable *islands* (end-to-end solid floors; every soft platform is its own island), and
   islands are linked by **jump**, **drop-through** and **walk-off** moves whose paths were checked
   against the stage's wall and ceiling lines. This is the automatic counterpart of the original's
   island queries plus its hand-authored per-stage waypoint tables (`ftCo_803C6594`, which only
   Hyrule Temple and Great Bay have). Each frame the CPU paths from its island to the target's
   island (or the island nearest a target hanging in the air) and walks to the next link's take-off
   point: a full-hop jump held ten frames like `ftCo_800A0148` (stick toward the landing point when
   it is far, straight up when close), a drop after the level's platform wait, or a walk off the edge.
   Airborne it drifts to the link's landing point and spends air jumps when falling short. On the
   target's island it uses the walk controller: dash when far, clamped walk near, a small random
   stand-off, never walking off the island unless a link says so; when the target is off stage it
   holds the ledge inward. **Wall contact** (pushing the stick without moving for three frames)
   answers with a jump at every level, exactly like the original's `Collide_WallMask` rule, or a
   turn-around when a ceiling is directly above. Level 4+ additionally jumps after airborne targets.

Inputs are produced through a tiny command-script runner (`CpuStep[]`) so presses have real edges
and holds have real durations, mirroring the original's command-script VM at a much smaller scale.

## Teams

Team identity is seat parity (RED = even seats, BLUE = odd seats), resolved through each
fighter's `seatId` — never the dense match order, which shifts when seats are off. Targeting,
melee defense, friendly-fire, hill scoring and the HUD all share that resolver, so CPUs hunt the
other side and ignore teammate melee even with gapped seats (P1+P3 vs P4 aligns RED vs BLUE).
Projectiles and items still hit everyone, so CPUs still shield those from any side.

## Determinism and snapshots

All randomness comes from the match's own `HSD_Rand` fork; the brain (`CpuBrain`) is plain data
inside `MatchState.bots`, cloned into every snapshot and restored by rollback, so CPU decisions are
regenerated identically on every peer and after every rollback. No CPU input is ever transmitted.

## Collision notes (prototype glue, not the original ECB solver)

Fixed while investigating navigation gaps on Temple, Corneria and Pokémon Stadium
with private hole-finding, launch, special and stadium probes:

- **Wall sliding.** A blocked movement used to be cancelled whole, gravity included, pinning
  fighters in mid-air on wall faces. Airborne fighters now slide along the surface (clamped to
  the line's ends, and they pass corner vertices); grounded fighters simply stop at a wall base.
- **Lower-body wall sweep.** Walls are tested against the fighter's lower body (the feet
  point plus `WALL_BODY_HEIGHT` above it, done by extending each wall line down along its own
  direction), not the feet point alone. A feet-only test let anyone walking up a ramp into a
  wall base (Peach's Castle tower sides, Temple/Venom/Corneria step corners) pass under the
  wall's lowest vertex and drop into the terrain. Undersides still use the feet point.
- **Whole-frame checks.** Wall/ceiling and floor crossings are tested from the frame's start
  position, so special-move root motion (Illusion, Skull Bash, Teleport, Falcon Kick, Blazer,
  Screw Attack, Super Jump Punch) can no longer tunnel through terrain.
- **Ground following by chain.** A grounded fighter only follows floors joined end to end with
  the current one (the original's line links), so a fast dash over a plateau lip goes airborne
  instead of snapping down onto the floor below; seams the original stitches at runtime
  (Stadium terrain ↔ aprons) count as joined, and the upper of two overlapping floors wins.
- **Sealed joints.** A fighter standing exactly on a slope counts as above it and floor joints
  get a little span slack, so launches into a slope's first vertex land instead of slipping under.
- **Corneria.** `grCorneria` disables collision joints 0–2 and 5–7 (the Arwing platforms) at
  load and leaves 3 and 4 enabled; the port now keeps area 4, the drop-through floor under the
  nose, which was missing.
- **Pokémon Stadium.** Collision no longer swaps once per transformation. As in
  `grStadium_801D4548`, the sinking terrain's lines scale to 5 % of their height over the
  transform duration and wait flattened; the rising terrain is live from the first rise frame
  at 5 % height and −10 units, climbs to 0 during the first half while growing, and the
  flattened old plate stays live through the rise, sinking to −10 during the second half.
  Standing fighters ride their floor's motion and are pushed up by terrain rising through them.

## Not implemented

Directional influence, teching, the original per-character attack tables and command scripts,
item play, taunts, stage-specific waypoints and the original personalities (Stay/Walk/Escape/…)
are not ported. The ladder numbers are faithful; everything else is a prototype approximation.
