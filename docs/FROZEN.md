# Frozen (ftCo_DamageIce)

Scope: the ice state an element-5 hit puts a fighter in. A bounded port of one original state, not
a claim of whole-engine equivalence.

## What the original does

[ftCo_Damage.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Damage.c) `block_83`: a hit
whose element is `HitElement_Ice` **and** whose knockback reaches the second tier
(`kb * ftCommonData x154 >= x15C`, the same tiers the burn scripts use) calls
`ftCo_DamageIce_Init` instead of launching. A weaker ice hit launches normally.

[ftCo_DamageIce.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_DamageIce.c):

- The victim is sealed in the block: `ftCommon_InitGrab` arms a mash-out timer of **the hit's own
  damage x `x790`**, the knockback becomes the block's own drift, a random spin between
  `damageice_rot_speed_min/max` is picked, the hurtbox becomes one ungrabbable capsule, and
  `efAsync_Spawn(0x415)` hangs the block model off `FtPart_XRotN`.
- `_Anim`: the block turns on `XRotN` while airborne, the timer falls by `x794` a frame and by
  `x798` for every mashed press, and reaching zero runs `ftCo_80091854`.
- `_Phys`: airborne it falls at `gravity * damageice_gravity_mult`; grounded it keeps standing
  friction. `_Coll` lets the block settle on the floor and keep counting.
- `_OnHit2`: damage taken inside the block removes `damage * damageice_dmg_time_reduction_mult`
  frames, and a **fire** hit zeroes the timer outright.
- `ftCo_Damage.c:955`: a hit on someone already frozen re-enters `DamageIce` — it never knocks
  them out of the block.
- `ftCo_80091854` -> `DamageIceJump`: the block shatters, the fighter pops out with
  `damageicejump_vel_y` and `lstick.x * damageicejump_vel_x_mult`, and `damageicejump_escape_time`
  frames later they drop into a normal fall.

## What this port does

Parameters are read, never invented: `ftCommonData x77C-x7A4` in
[lib/game/combat-data.ts](../lib/game/combat-data.ts) (`combat.ice`) and the per-fighter
`ftCo_DatAttrs x14C/x158/x15C` in [lib/game/data.ts](../lib/game/data.ts) (`iceSize`, `iceJumpY`,
`iceJumpX`). Custom fighters, which author their own attributes, fall back to the common block size
and a 2.3 hop.

- State `'frozen'` with an `ice` runtime (`timer`, `spin`, `angle`) on `MatchFighter`. It is plain
  snapshot data, so rollback and the confirmed-state hash carry it like every other field.
- [lib/game/combat.ts](../lib/game/combat.ts): `freeze` (entry, and re-entry that never re-arms the
  timer), `frozenHit` (damage shortens, fire thaws), the per-frame branch (spin, timer, mash) and
  the `land` case that keeps the block on the floor. Breaking out pops the fighter up and holds
  them in `DamageFlyN` for `damageicejump_escape_time` frames.
- [lib/game/match.ts](../lib/game/match.ts): the element/knockback gate on the hit path, the
  lightened gravity while airborne, and the state's exclusion from the action gate — nothing the
  victim presses is an action (`ftCo_DamageIce_IASA` is empty), only mashing counts.
- Frozen fighters cannot be grabbed (`ftColl_HurtboxInit` marks the block's capsule ungrabbable).
- [web/src/render/play-effects.ts](../web/src/render/play-effects.ts) draws the original block:
  `effCommonDataTable` entry **37** (efAsync `0x415` -> `efLib_Create_AttachChild(0x25)`), placed on
  `FtPart_XRotN` and scaled by the fighter's own `damageice_ice_size` against the common one. That
  entry declares no lifetime because the original destroys it by hand, so it is loaded outside the
  lifetime rule the other common effects follow.
  [web/src/render/game-rig.ts](../web/src/render/game-rig.ts) turns `XRotN` by the simulated angle,
  so fighter and block tumble together.

## Not ported

- The hurtbox is **not** replaced by the block's single capsule; the victim keeps their own
  hurtboxes, so a frozen fighter's hittable volume is their body rather than the ice.
- Wall and ceiling impacts while frozen (`ftCo_DamageIce_Collide`): the original shatters the block
  early or bounces it off with `damageice_speed_mult_on_break`, with a quake and shards.
- `ftCo_DamageIce_Init`'s `x150`/`x154` nudge of `YRotN`, which re-centres the body inside the
  block. Applying it to this rig moved the body further out of the block, not into it, so the block
  stays centred on the joint instead.
- The shatter particles (`efAsync 0x443`) and the block's own entry/exit SFX beyond the break cue.

## Validation

- `tests/unit/combat-real.test.ts` — sealing and the mash-out timer, the ineffectiveness of any
  other input, the no-re-arm rule, thawing on time and on fire, the landing keeping the block,
  ungrabbability, and a snapshot/rollback round trip. Requires `MELEE_DISC_PATH`.
- `tests/unit/ace-wave3-real.test.ts` — Blastoise's ice side special freezing a victim for its own
  damage x the common scale instead of launching them. Requires `MELEE_ACE_ISO` too.
