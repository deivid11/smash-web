# Kirby: first character imported from the ISO using this guide

Back to [docs/characters/README.md](README.md). General procedure: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md).

Kirby is the third original fighter in the prototype. All of his content comes from the user's own disc (Melee USA v1.02): `PlKb.dat`, `PlKbAJ.dat`, `PlKbNr.dat`, `EfKbData.dat` and `audio/us/kirby.ssm`. No clip, parameter or model is copied from Fox or Mario. He is a **playable, online-compatible character** within the limits listed below; this is not a proof of equivalence with the full engine.

## Identifiers

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` | `Kb` |
| Native `FTKIND_KIRBY` (table index in `PlCo.dat`) | 4 |
| Selector index (`ROSTER_CHOICES`) | 3 |
| Online `RoomFighter` | `'Kb'` |
| Selector announcement | `0x7C83F` (`gm_80168C5C`, `CKIND_KIRBY = 4`), sample 1491 of `audio/us/nr_name.ssm` (`0x7C83A` is the Game & Watch call, CKIND 3) |
| Voice bank | `audio/us/kirby.ssm` (base 633, 52 samples); KO `140145` |

## Bones: 59 parts, 46 joints

`PlCo.dat` declares **59 parts** for Kirby, but `PlKbNr.dat` only has **46 joints**. The difference is 13 "virtual" parts (`Fighter_804D6540`, `ftParts_8007506C`) that `ftParts_SetupParts` skips without consuming a JObj: they are the slots for the copy hats. All bone indices in scripts, hurtboxes, common bones and the shield are **part** indices, not joint indices.

[lib/game/data.ts](../../lib/game/data.ts) now reads the virtual-part table, builds `partJoints` (part → joint or `-1`) and translates once at parse time: `boneMap`, `hurts`, `shieldBone`, `motionRoot`, the hitboxes of [lib/game/moves.ts](../../lib/game/moves.ts) and the reflector. Data that references a virtual part fails at load instead of pointing at the wrong joint. For Fox and Mario the table is empty and the mapping is the identity.

Checked against the disc: hurtboxes on parts 5/42/37/55/49 → joints 5/29/24/42/36; shield and grab anchor on part 57 → joint 44.

## States with a repeated figatree name

The same animation name serves several motion states (`SpecialLw2` for the held stone and for the exit; `SpecialN`/`SpecialNLoop` for the aerial and capture versions). [lib/hsd/session.ts](../../lib/hsd/session.ts) supports loading by action-table entry, and [lib/game/kirby.ts](../../lib/game/kirby.ts) pins each engine key to a specific index while verifying the figatree name (`KIRBY_ACTION_KEYS`). The script of each entry is preserved: `SpecialLw` (index 287) has no commands, `SpecialLwEnd` (288) emits `cmd0=2`.

`SquatWait1` replaces `SquatWait` through `content.motions.crouchWait`; `LandingAirB`/`LandingAirHi` are loaded and landing from back/up aerials uses their original lags (`0xf0`/`0xf4`) for any fighter that has those clips.

## Multiple jumps

Kirby's common aerial-jump multipliers are 0, so `core_air_jump` is of no use. [lib/game/kirby.ts](../../lib/game/kirby.ts) reproduces `ftCo_800D74A4`/`ft_800CB6EC` with `ftKb_DatAttrs`: vertical impulses `2, 2, 1.73, 1.56, 1.33`, horizontal impulse 0.5, a 12-frame turn when jumping backwards (it flips `facing` halfway through), drift scaled ×0.8 during the animation, and the next jump locked until `cmd_vars[0]` from the script (frame 28). Clips `JumpAerialF1`–`JumpAerialF5`.

## Specials

| Special | States | Data and limits |
| --- | --- | --- |
| **Inhale** (neutral) | `SpecialN` → `SpecialNLoop` (while B is held) → `SpecialNEnd`; capture `SpecialNCapture` → `Eat` → `EatWait`; `SpecialNSpit` (A) / `SpecialNDrink` (B or down) | Original grab boxes from the script (element 8). The victim is pulled to the mouth (`specialn_x/y_offset_inhaled`, `inhale_velocity`) and then held with common anchor 52. Spitting and swallowing release with the original `throw` definitions (10 % / 8 %) when `cmd0=1` arrives. Swallowing (`SpecialNDrink`) steals the neutral special of any fighter in the roster (see "Copy abilities"); **there is no star projectile, no jumping with the victim and no inhaled items** (walking with the victim does exist: see below). The swallowed victim is not drawn (`Ft_MF_SkipModel` from `ftCo_CaptureWaitKirby`) and escapes on Kirby's timer: `specialn_base_duration` 250, −`specialn_duration_divisor` (1) per frame and −`specialn_inhale_resistance` (12) per button press (`ftCommon_InitGrab`/`ftCommon_GrabMash`). The bot only inhales at close range. |
| **Hammer** (side) | `SpecialS` (ground) / `SpecialAirS` (air) | Script hitboxes (16/16/23 % on the ground; aerial multi-hit). Vertical impulse 1.5 once per airtime (`x64`), landing lag 16. Leaving the ground cancels into a fall (`ftKb_SpecialS_Coll`). The hammer is article 1 of `PlKb.dat`, attached to part 44 while `cmd0` is 1. |
| **Final Cutter** (up) | `SpecialHi1`/`SpecialAirHi1` → `SpecialAirHi2` → `SpecialAirHi3` → `SpecialHi4` | Ascent by root motion with the 0.9 vertical damper and drift `air_drift_stick_mul × 8`; stick reversal during startup until `cmd3`. Passes through floors for the first 20 frames of `Hi2` (`ftKb_SpecialHi2_Coll`); `Hi3` keeps the descent speed. Lands in `Hi4` and `cmd2=1` fires the beam: article 0 (speed 4, deceleration 0.1, life 25, 6 %). Does not leave Kirby helpless. |
| **Stone** (down) | `SpecialLw1`/`SpecialAirLwStart` → `SpecialLw`/`SpecialAirLw` (frame 0 frozen) → `SpecialLwEnd`/`SpecialAirLwEnd` | Falls at 4.5/frame with the 18 % hitbox. **38 HP** armour (`dmg.x1834`): while HP remains, the hit is absorbed with no damage or knockback; the hit that depletes it applies only the excess and knocks Kirby out of the stone. Releases after 150 frames, or with B after 18. The exit uses the animation's translation and ends in a normal fall (`freefall_toggle = 0`). Stone shapes 1–5 with the simulation RNG and the flicker table `ftKb_Init_803CB490`. |

Out of scope and declared: the stone sliding down slopes (there are no slopes), breath fire/copy items, the beam's ledge/wall hitboxes, `EatJump`/`EatFall`/`EatLanding` (walking with the victim stops at the ledge instead of falling), the intangibility flags during the transformation flicker.

Walking with the victim in the mouth (`ftKb_EatWait_IASA` → `ftWalkCommon_800DFCA4`): from `EatWait`, the stick beyond `specialn_x_axis_range_walk` transitions to `EatWalkSlow`/`EatWalkMiddle`/`EatWalkFast` (actions 265–267) with normal walk physics scaled by `specialn_walk_speed`; spitting and swallowing remain available while walking, and releasing the stick returns to `EatWait`.

## Copy abilities (whole roster)

`ftKb_SpecialNDrink_Anim` → `ftKb_SpecialN_800F1BAC(kind)`: on swallowing, Kirby adopts the victim's hat and neutral special (`ftCo_800BD9E0`: another Kirby hands his over and loses it; a fighter with no copy file loaded, such as a custom pack with no native copy, changes nothing). Original data from `PlKbCpFx.dat` / `PlKbCpMr.dat` (`ftDataKirbyCopyXx`, `KirbyHatStruct`): the hat model at `+0` and the articles of the copied special starting at `+C` (`ftKb_SpecialN_800F16D0`). Those articles carry no common `ItemAttr` block; gravity/terminal/bounce/scale/sound are taken from the original projectile of the copied fighter.

The other eight roster copies (Lk, Cl, Ss, Pk, Ca, Dk, Mt, Fe from `PlKbCpXx.dat`) use the copy actions of `PlKb.dat` itself (294–426; Young Link and Roy in their clone sections with figatrees `LkSpecialN*`/`MsSpecialN*`) with their original hitboxes, and the projectile is fired with the article and parameters of the source fighter: the arrow with Link's full machinery, Thunder Jolt travelling along the ground, the charged shot with `samusCharge`, Shadow Ball with `mewtwoCharge`, and the Ca/Dk/Fe hits with the original charge scaling (`kirbyCopyHits`). The figatrees of the Mewtwo copy animate 53 bones (the hat's tail); only Kirby's 46 are sampled. The hat is drawn when the file has a mesh at `+0` (DK's does not and is left without a hat); the full Flare Blade explosion uses the 50 % script without Roy's self-damage.

| Copy | States | Behaviour |
| --- | --- | --- |
| **Mario** | `MrSpecialN` / `MrSpecialAirN` | The script's `throw` flag launches the copied fireball from `LHandN` (`fn_800F9260`); normal physics. |
| **Fox** | `FxSpecialNStart` → `Loop` → `End` (+`Air`) | Same flow as Fox's Blaster: presses during the loop queue another loop while `cmd_vars[0]` is active, `cmd_vars[2]` fires from part 44 with offset (0, 1.45, 5.016) at `specialn_fx_launch_speed` 7 (`ftKb_SpecialNFx_800FDF30`); the copied blaster is attached to the hand. |

The hat is drawn with the matrix of part 6 (`ftKb_UnkMtxFunc0`). The ability is lost on death (`ftKb_Init_OnDeath`) and with probability 1/32 on every hit that is not a cape hit while nobody is being held (`ftKb_SpecialN_800F5BA4`, `specialn_odds_lose_ability_on_hit`). While he has a hat, the neutral special is the copy and Kirby cannot inhale (as in Melee, where it has to be discarded with a taunt). Out of scope: the star that drops the ability and can be eaten again, discarding it with a taunt (there is no taunt input), the other 23 copies on the disc and the alternate bodies (`PlKbNrCp*.dat`).

## Root motion in ground attacks

While reviewing `ft_80084FA8`/`ft_80085030` it was confirmed that ground attacks move the fighter with the clip's TransN track. Fox (dash attack 35 u, F-smash 25 u) and Mario (dash attack 30 u) also have it and the prototype was ignoring it. [lib/game/match.ts](../../lib/game/match.ts) now applies that translation in `attack` and `grab` when the clip has a Z track, scaled by `animationRate` (a frozen charge does not move). It affects the three original fighters equally.

## Part visibility (stone shapes)

`ftData->x8` stores, per costume (`vis_table[costume][set]`), alternative sets of draw objects (`FtPartsDesc`). Native semantics, verified because the first render showed the stones overlapping the body:

- The draw-object ordinals are those of `ftParts_SetupParts`: **pre-order** (a joint's DObjs before those of its children). [lib/hsd/model.ts](../../lib/hsd/model.ts) numbers each `ModelPart.dobjIndex` this way.
- `ftParts_8007487C` **initially hides all** DObjs listed in sets 0, 1 and 3 (set 2 points to the hat list) and `ftParts_80074B6C` shows only the selected alternative of each group in set 0. For Kirby the three sets cover his 42 DObjs; at rest only the 7 body ones stay visible (`[3,4,5]` and `[6,7,18,19]`, all on the root joint).
- Kirby has 2 groups: group 0 with 7 alternatives (0 = normal, 2–6 = stones, on joint 6) and group 1 (facial features). In the stone, alternative `2 + shape` is selected and group 1 is hidden.

`FighterProfile.partVisibility` exposes `groups` (set 0) and `hidden` (union of 0/1/3); [web/src/render/model-instance.ts](../../web/src/render/model-instance.ts) hides by ordinal. Only costume 0 is parsed. This is original data, not a substitute model.

## Effects and audio

From the `effKirbyDataTable` bank, the descriptors whose id could be attributed in `efalt.c` are linked: `0x1388`–`0x138A` (Final Cutter startup) and `0x138C`/`0x138D` (hammer). The particle generators (`0x49B`/`0x49C`) are not reproduced. All SFX come from the scripts and from `kirby.ssm`; the stone landing uses `0x222E7` like `ftKb_SpecialAirLw_Coll`.

## Transport and registration

- Allowlist in [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts): `PlKb.dat`, `PlKbAJ.dat` (1.7 MB), `PlKbNr.dat` in `VIEWER_ASSETS`; `EfKbData.dat`, `PlKbCpFx.dat`, `PlKbCpMr.dat` and `audio/us/kirby.ssm` in `SPECIAL_ASSETS`. The full allowlist stands at 28 resources (13 viewer + `PlCo.dat` + 10 effects/copies/audio + 4 menu/music). The copy files (`PlKbCp*.dat`, `EfKb??.dat`, costumes) still return 404.
- [lib/game/load.ts](../../lib/game/load.ts) uses an explicit per-fighter descriptor (`FIGHTER_SPECS`); there is no fallback to the Mario case.
- Roster, React, HUD, portraits, cues and the room protocol are registered by `kind`, not by name.

## State and replay

Everything new lives in `MatchFighter` (`airJumpTurn`, `hammerBoostUsed`) or in `SpecialRuntime` (`reversed`, `stoneHp`, `stoneShape`, `stoneFrame`, `stoneFlicker`, `stoneShown`, `stoneHeld`, `stoneLanded`) and in `Projectile.speed`; these are captured with `structuredClone`, enter the canonical hash and are restored. The stone shape uses `physics.random()`.

## Verification

[tests/unit/kirby-real.test.ts](../../tests/unit/kirby-real.test.ts) (requires `MELEE_DISC_PATH`; 22 cases): profile and bone translation, keyed clips, articles/effects, roster/mirrors/solo, hitbox alignment, five jumps and the turn, normals and landings, root motion, each special, stone armour, capture/spit/swallow, snapshot/restore and determinism. [tests/server-browser/kirby.spec.ts](../../tests/server-browser/kirby.spec.ts) (9 cases) covers selection, HUD, specials in the browser, portrait, five jumps, mirrors/returning to Fox and Mario, the allowlist and rejection of copy files.

Result with the real disc (2026-09-09): `tsc --noEmit` clean; `vitest run` 625/625 in 33 files (includes gameplay-real, specials-real, rollback-real, private custom tests and the existing server/network tests); on a private build served on 5275, 41/41 existing browser specs passed (attacks, combat, play, scenes, server, specials and private custom tests) plus 9/9 for Kirby. The multi-browser multiplayer specs were not repeated in this pass because of the parallel eight-player QA; the combined candidate must run them.

Adjustments to existing tests: the synthetic fixture in [tests/unit/gameplay-core.test.ts](../../tests/unit/gameplay-core.test.ts) declares `partJoints`, [tests/unit/menu-audio.test.ts](../../tests/unit/menu-audio.test.ts) includes Kirby's cue and the manifest counts are derived from `VIEWER_ASSETS`.
