# Donkey Kong: original ISO character in the prototype

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Donkey Kong uses his own data, neutral model, animations and sounds from Melee USA v1.02. Special orchestration and collisions are still TypeScript adapters of the prototype; no C functions were added to the WASM and upstream was not modified.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Dk` |
| Native type `FTKIND_DONKEY` | 3 |
| Stable selector index | **9**; this is not a player index |
| Parameter symbol | `ftDataDonkey` (`ftDonkeyAttributes`) |
| Model | `PlDkNr.dat`: 75 joints, 61 meshes |
| Metadata / animations | `PlDk.dat` (289 actions) / `PlDkAJ.dat` |
| Effects | `EfDkData.dat`, `effDonkeyDataTable` (descriptors only; no particle emulation) |
| Voices/SFX | `audio/us/dk.ssm` (there is no `donkey.ssm`) |
| Announcer | `gm_80168C5C` case 1 (`CKIND_DONKEY`) → `0x7C831`, shared bank `nr_name.ssm` |

Weight 114, run speed 1.6, gravity 0.1, scale 1 and two jumps come from DK's file. Only the neutral costume is loaded; `PlDkBk/Bu/Gr/Re.dat` and `PlDkDViWaitAJ.dat` remain unexposed.

File quirks: the idle is named **`Wait`** (mapped to the engine as `Wait1` through a keyed entry, same as Samus), the cancel is spelled **`SpecialNCansel`** on the disc, and the full punch (index 275) and the two Hand Slap endings (287/288) share a figatree with different scripts.

## Normals and common mechanics

[lib/game/dk-data.ts](../../lib/game/dk-data.ts) registers only actions that are present: double jab `Attack11`/`Attack12` (no `Attack13` and no rapid jab), dash attack, three tilts (`AttackS3S` side), three smash attacks (`AttackS4S`) and five aerials. Damage, hitboxes, windows and bones come from the scripts (indices 271–288 verified against `ftDk_Init_MotionStateTable`).

He uses the common support for shield, dodges, grab/pummel, ledges, KO and rematch.

## Specials

[lib/game/dk-data.ts](../../lib/game/dk-data.ts) reads the `ftDonkeyAttributes` layout, distinguishing integers from floats; [lib/game/dk.ts](../../lib/game/dk.ts) adapts the `ftDk_*` callbacks.

| Special | Implemented behaviour |
| --- | --- |
| **Giant Punch** — neutral | Looping wind-up; each pass of the loop accumulates one swing (x222C), maximum 10. B releases the punch with `script damage + swings × 2` and a ground launch of `facing × 0.12 × swings` when the hitbox activates. Shield cancels at the end of the loop, keeping the charge. At 10 swings the state exits on its own; re-entering fires `SpecialNFull`/`SpecialAirNFull` immediately with its own script (no bonus). The aerial version ends helpless with landing lag 20. The charge survives hitstun and is lost on death. |
| **Headbutt** — side | Ground: original clip with ground friction. Air: on entry vx is divided by 1.5, he floats until the script sets `cmd_vars[0]` and then falls with gravity 0.05 and air friction 0.02. Does not leave him helpless. |
| **Spinning Kong** — up | Ground: clamps vx to ±0.85, consumes jumps, drifts with acceleration 0.025 and ends standing. Air: launches at vy 0.675, gravity ×0.07 until the script's `cmd_vars[0]`, drift 0.05 up to ±1.4, grabs ledges while descending and ends helpless with landing lag 40. Landing during the aerial spin continues as the ground spin (`ftDk_SpecialAirHi_Coll`). |
| **Hand Slap** — down | Ground only (there is no aerial state; down+B in the air does nothing). Start → Loop; B during the loop chains another slap; when finished it moves to `SpecialLwEnd`. Leaving the ground cancels into a fall. Its hitboxes only hit grounded opponents, like the original script. |

### Explicit limits

- **Cargo carry is not implemented.** The grab's forward throw uses the original lifting animation (`ThrowF`) without the carry mechanic; the `HeavyWait/ThrowF*` states (indices 247–270) are not loaded. Back/up/down throws work with the common support.
- Headbutt's bury against grounded opponents does not exist in the prototype engine; it applies normal knockback.
- The native charge particles (efSync 1224/1225/1226/1228) are not emulated; the effects bank is identified and bounded.
- The "full charge" sound (`ftCo_800BFFD0(fp, 57, 0)`) is not played; the scripts keep their own cues.
- The grounded punch velocity is applied once when the hitbox activates and decays with the original friction from the next tick on.

## State and online

`MatchFighter.dkPunchCharge` (fighter var x222C) stores the accumulated swings: it survives interruptions, resets on death and takes part in capture/restore and the canonical hash. The latches of the active special (`SpecialRuntime.dk`: swings of the punch in progress, cancel and Hand Slap repeat) live in the full state. `dkPunchCharge` is also exposed in `snapshot()` for HUD/tests.

DK is allowed by the room protocol in [lib/net/protocol.ts](../../lib/net/protocol.ts). The allowlist extension in [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts) (`PlDk.dat`, `PlDkAJ.dat`, `PlDkNr.dat`, `EfDkData.dat`, `audio/us/dk.ssm`) requires deploying frontend and server together after private validation.

## Validation of this delivery

- [tests/unit/dk-real.test.ts](../../tests/unit/dk-real.test.ts): **18/18** with a real ISO. Profile/skeleton, distinct shared scripts, normals, grab/shield/throw, per-loop charge with damage bonus, cancel with the charge kept, auto-exit at 10 swings, immediate full punch, loss on KO and retention in hitstun, landing of the aerial spin, ground-only Hand Slap, zero projectiles, deterministic restore and rollback with late inputs for two/four players.
- Regression of shared suites (menu-audio, roy-real, rollback-real, gameplay-real): **81/81**.
- [tests/server-browser/dk.spec.ts](../../tests/server-browser/dk.spec.ts): selection/mirrors/HUD, four specials from the keyboard, full charge + full punch, mobile and allowlist in real Chromium with a private server and a private staging build (the shared `dist` was not touched).
- These tests do not demonstrate equivalence with GameCube or competitive WAN latency.
