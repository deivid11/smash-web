# Match items

Status: 34 of the 35 match items are playable — containers (light and heavy), battering
swings, throwables, explosives (Bob-omb, Motion-Sensor Bomb), sliding shells, Freezie,
Flipper, shooters (Ray Gun, Super Scope, Fire Flower), Star Rod stars, consumables
(Food/Maxim Tomato/Heart), the Starman, and the Poké Ball with all 30 Pokémon running
their transcribed decomp state tables (see below), and the Wave E statuses: touch
mushrooms (actor-wide size scaling), Bunny Hood, Metal Box, Cloaking Device, the
Screw Attack jump hit, the Hammer lock and the Warp Star ride. Only the Barrel
Cannon remains locked, plus per-kind polish (barrel rolling, scope charge levels,
swing damage scalars); see the roadmap below.

## What is original data

- `ItCo.dat` is parsed at runtime like fighter archives ([lib/game/item-data.ts](../lib/game/item-data.ts)):
  the `itPublicData` root yields the global `ItemCommonData` tuning block and the common
  `Article*[43]` table (kinds `0x00`–`0x2A`). Per kind: the `ItemAttr` block (heavy flag,
  action class, hold kind, throw multiplier, gravity/terminal, ECB, grab range, scale,
  destroy GFX/SFX), hurt capsules, the per-state animation descriptors with their **item
  command scripts** (hitboxes, damage/scale updates, SFX — the same bytecode family as
  fighter subactions, ported in `parseItemScript`), and the model root with its hand
  attach bone. Per-state models load lazily and memoized.
- Kind ids and names mirror the pinned decomp enum/debug tables and are tripwired by
  [tests/unit/item-kinds.test.ts](../tests/unit/item-kinds.test.ts).
- The five scalars the Link-bomb path already pinned (`reflectedLife`, shield bounce,
  explosion life) are re-read from the same offsets and cross-checked on a real disc by
  [tests/unit/item-data-real.test.ts](../tests/unit/item-data-real.test.ts).
- Spawn cadence uses the original frequency-indexed `{min,max}` interval pairs
  (`ItemCommonData +0xFC`); throws use the common 22-entry speed/angle table, the
  fighter's `itemThrowVelocity` and the item's own `x4_throw_speed_mul`; pickup uses the
  fighter's native pickup boxes, `LightGet` and the `LightThrow*` motions.
- Containers (Wave A) read their own ItCo special-attribute blocks: the capsule/egg drop
  count and 1-in-N explosion/dud denominators, the Party Ball's rise velocity/timer,
  damage threshold and landing-break velocity. Fighter attacks strike loose items
  through the articles' hurt capsules; container explosions replay the broken state's
  own script hitboxes with the common explosion GFX `0x410`/SFX `0x74`; spilled contents
  launch with the original scatter (`ItemCommonData +0x54`) and per-kind pop-up speed
  (`ItemAttr +0x18`).

## What is prototype orchestration (explicit deviations)

- Uniform spawn weights over the enabled pool: the per-stage weight table
  (`stage_info.xA0`) and per-stage interval scalar (`Ground_801C2AE8`) are not ported.
- Spawn position is a bounded random x over the main span dropped from above, not
  `Stage_80224FDC`/`mpColl_8004D024`.
- The generic fall/ground/held/flight state machine replaces the per-kind
  `ItemStateTable` callbacks until each wave transcribes them. Flight damage uses the
  article's first scripted hitbox (original damage/angle/element) without the original
  velocity-scaled damage multipliers; kinds whose scripts author no hitbox fall back to a
  labeled prototype contact hit.
- `SUPPORTED_MATCH_ITEMS` spawn: the battering/throwable props (Mr. Saturn, Fan, Beam
  Sword, Home-Run Bat, Parasol, Star Rod, Lip's Stick) plus the Wave A containers
  (Capsule, Egg, Party Ball). Container contents draw uniformly from the enabled generic
  pool instead of the stage-weighted `it_804A0E50` table; the Party Ball's Poké
  Ball/Foods buckets collapse into its original random-items fallback until those kinds
  land. Shoot/consume classes, heavy carries (Crate, Barrel) and standalone explosives
  wait for their waves.
- Swings (Wave C core): a grounded attack with a class-2 battering item plays the shared
  `Swing1/Swing3/Swing4/SwingDash` subactions (one four-motion block per ftswing row;
  the 24-entry run's base index varies per fighter — Fox 99, Mario 97 — and
  Falcon/Ganondorf name the smash swing `Swing41`, so the loader locates the run
  dynamically) through the normal attack pipeline — the scripts
  carry their own authored hitboxes, damages and timings, rebound to the fighter's item
  hold bone so they ride the swung weapon. Up/down attacks keep the fighter's own moves;
  grab throws; air attack still throws (Melee has no aerial item swings). The
  `Fighter_804D654C` per-swing damage/speed scalar and smash-swing charging are not
  applied yet; the Parasol float, Star Rod shots and Lip's Stick flower wait for the
  rest of Wave C/D.

## Rules and scope

- Local battles: the ITEMS button in the battle footer opens the Item Switch menu
  ([web/src/play/item-switch.tsx](../web/src/play/item-switch.tsx)) — the frequency
  ladder (`OFF` … `VERY HIGH` → `MatchOptions.itemFrequency`) plus one toggle tile per
  match item (`MatchOptions.itemSwitches`), with runtime-rendered ItCo model icons.
  Unported kinds are visible but locked. Default is OFF: with the rule off the item
  world consumes no RNG, so itemless replays keep their stream.
- LAN/online rooms do not carry item rules yet (protocol untouched); the select is hidden
  there. A LAN server started before `ItCo.dat` joined `SERVER_ASSETS` serves an older
  manifest; such sources load itemless instead of failing.
- Items are snapshot-owned (`MatchState.items`) and rollback-stable: match items
  reference content only by `kind`/`stateIndex`, never resource objects.

## Roadmap (per-kind waves)

A. ✅ Containers: light (Capsule, Egg, Party Ball) and heavy (Crate, Barrel with
   overhead carry, HeavyGet/HeavyThrow motions, weight-bucket contents). Remaining:
   barrel rolling, stage-weighted `it_804A0E50` contents, coin mode.
Decomp audit, second pass (2026-09-18):
- Thrown items (`xDC8 flags.x14`, set by it_80273F34) add speed × ItemCommonData `x94` (3)
  plus `x98` (-0.4) to their hit damage, minimum 1 (it_8026B1D4).
- Bob-omb: idle `x10`, turn `x4`, walk `x14` at `xC` turning only at walls and walking off
  ledges, then the `x8` fuse; a thrown one only detonates landing faster than `x20`/`x24`.
- Green Shell: struck at damage × `x14` (no slide under `x8`), constant slide clamped to `x4`
  for `x0` frames, owner-hittable after `x24` frames, pops up at `x10` after connecting.
- Flipper timers (`x0`/`x4`/`x8`/`x14`) are s32, Super Scope's `xC[]` cost table is float.
Not yet audited in the same depth: Red Shell homing, Freezie, Motion-Sensor Bomb, Mr. Saturn,
the battering items (per-swing damage scalar, smash charge, Parasol float, Lip's Stick flower),
Star Rod, the shooters' fire modes (Super Scope charge levels, Fire Flower stream), the
containers' contents tables and the spawner's stage weights/positions.

B. ✅ Throwables/explosives: Bob-omb (attribute fuse walk + script blast),
   Motion-Sensor Bomb (stick + inert-hitbox proximity), Green/Red Shell slides with
   homing, Flipper hover, Freezie (prototype extended-stun freeze), Food/Tomato/Heart
   per-record heals, Starman touch invincibility with its authored bounce.
C. ✅ Swings (`ftswing` rows) + Star Rod star emission on swings. Remaining: the
   `Fighter_804D654C` damage scalar, smash-swing charging, Parasol float, Lip's Stick flower.
D. ✅ Shooters: Ray Gun (LGunRay, 16 rounds, refire lockout, empty click), Super Scope
   (level-0 shots from its energy pool), Fire Flower (LGunBeam flame bursts with the
   authored spread — note `It_Kind_L_Gun_Beam` IS the flower's flame). Remaining:
   scope charge levels 1-9, flame crawl-along-terrain.
E. ✅ Status/equipment, audited against the fighter-side decomp (lib/game/item-status.ts):
   - Bunny Hood, Metal Box, mushroom size and Cloaking Device are independent, stacking
     effects (`MatchFighter.itemFx`). `ftCo_800D105C` is reproduced by rewriting the
     fighter's WASM attribute prefix with PlCo `ftLoadCommonData` tables 12–14: the size
     rescale (`ftCo_CalcYScaledKnockback` factors), Bunny Hood (×2 walk/dash/jumps,
     ×1.5 gravity and fall speeds) and metal (×1.55 jumps, ×2 gravity/fall, ×3 weight; walk
     ×0.7 through `ftCo_Walk_Enter`'s accel_mul).
   - Durations come from the original sources: hood item float x0 (720), metal floats
     x0/x4 (700 frames, 50 damage of metal health), cloak `ftCommonData x7CC` (600),
     Hammer `x6AC` (450), mushrooms `x688` (480, +percent over `x68C` capped by `x690`).
   - Mushrooms: ×1.8 / ×0.5 (`x678`/`x680`) through the Kinoko item's 16-frame ramp curves
     with the fighter frozen and its velocity parked (a hit completes the ramp); a repeat
     mushroom refreshes the timer, the opposite one returns to normal. Scaled fighters deal
     `CalcYScaled(damage, s, 0.25)` and take `kb / CalcYScaled(1, s, 0.75)`. The mushroom
     items walk along the ground at x0 toward the stage center, fall with x4 air friction and
     are collected by their own touch hitbox (live from frame 40).
   - Metal subtracts `metal_armor` (30) from applied knockback and breaks after 50 damage.
   - Starman: item gravity/terminal, re-launch at (x10 × dir, x14) on every floor contact,
     collected by its own touch hitbox (frame 16), x0 invincibility.
   - Warp Star: the rider follows one of the star's seven authored flight paths (never the
     previous one) for 120 frames or until past the top, is immune to blast zones meanwhile,
     then dives from the top above the launch point with `ftCommon_Fall(x694, x698)` and the
     `x69C`–`x6A8` stick drift; the diving star carries its meteor script hitbox and crashes
     into its blast, the rider popping out in JumpB.
   - Screw Attack: jumps with it held are `ItemScrew`/`ItemScrewAir` at ×1.25 (`x800`).
   Remaining: Hammer head flying off (12.5% roll, HammerHead projectile), the rider's
   depth swoop (the paths also move in z), the hood model on the head.
F. ✅ Poké Ball: floor-open timers, then the release of it_8027AB64/it_8027A4D4 — the
   ball's own per-Pokémon weight table (`itPokemonSpawn_DatAttrs +0x3C`), exclusion of
   the last two releases, and the once-per-match 1-in-251 Celebi/Mew latch.
   See "Poké Ball Pokémon" below.

## Poké Ball Pokémon (lib/game/item-pokemon.ts)

Each of the 30 Pokémon and its 16 projectile kinds runs its own `it/kinds/it*.c` state
table, transcribed from the decomp: per-state anim/phys/coll callbacks, spawn callback,
`on_accessory` hooks and the dmg_dealt/dmg_received/hit_shield reactions. Shared machinery
follows it_279C.c and item.c:

- **Materialize** (it_8027AAA0/it_80279FF8/it_8027A09C): pop up at the ball's x8, grow
  from the kind's x0 scale to its item scale, squash/stretch through the ball's six keys,
  fall on the ball's injected gravity (zero for Electrode) for x14 frames.
- **Animation/script timeline** (Item_80268E5C, Item_802694CC): state changes reload or keep
  the animation and item script exactly as the original flags say; anim-end transitions
  use the real AnimJoint lengths; opcodes 17-20 raise the itcmd vars/var4 pulse the
  callbacks react to (leaf throws, Hydro Pump shots, Aeroblast windows, Electrode's beep…).
- **Root motion** (it_8027A160/it_8027A344): Goldeen, Chikorita, Zapdos, Scizor, Bellossom,
  Lugia, Ho-oh, Porygon2, Cyndaquil and Marill move by their driving bone's translation.
- **Hitboxes** sit on the posed article skeleton (bone matrices × script offsets), with the
  radius × item scale as `lbColl_80007ECC` does — so Togepi/Raikou/Ho-oh really are
  screen-wide. Chansey, Cyndaquil, Marill and Wobbuffet are hurtable through their article
  capsules; knock-outs launch at itPublicData x10 +4.
- Electrode arms at `0xB4 - x8` frames into its fuse and is then grabbable/throwable (the
  holder becomes its owner). Wobbuffet counters with the blow's damage × x4.
- Pokémon and their projectiles never hit the fighter who threw the ball (itcoll.c's owner
  test). Deliberate deviation: the original's it_80275444 lets Wobbuffet and Electrode's blast
  hit their owner too; here every Pokémon is owner-safe.
- Render scale: HSD_JObjSetScale replaces the root joint's scale, and most Pokémon models carry
  their own root scale on disc (Bellossom 2.6, Mew 2.8, Porygon2 2.1…), so the renderer divides
  that back out and draws the item scale exactly (hitboxes always used the item scale).
- Lugia/Ho-oh glide into the background (item z) and fire from there; Aeroblast beams
  accelerate their depth ×1.09/frame into the stage plane.

Deviations: camera quakes and the Pokémon particle generators (efSync 0x44E-0x473) are not
rendered — Charizard/Cyndaquil flames and the Fire Flower's flame show the common fire hit
effect along their path, Aeroblast borrows the Super Scope beam model, Weezing's gas is
invisible. The camera interest/eye used by Unown and Scizor is approximated from the stage
span. Reflect/absorb reactions of the projectiles are not wired (no reflector hooks for match
items yet). Wobbuffet's counter hitbox is skipped while its armed damage is below 1.
