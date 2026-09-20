# Yoshi: original ISO fighter

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Yoshi runs his own `ftYoshi` code and data (`PlYs.dat`, shared `ftDataYoshi` block
read through both the `ftYoshiAttributes` and `ftYs_DatAttrs` views, exactly as the
native code reinterprets the same pointer) with a dedicated handler in
[lib/game/yoshi.ts](../../lib/game/yoshi.ts). No WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Ys` |
| Native `FTKIND_YOSHI` | 14 |
| Stable selector index | **32** |
| Parameter symbol | `ftDataYoshi` |
| Model | `PlYsNr.dat`: 70 joints, 76 meshes |
| Metadata / animations | `PlYs.dat` / `PlYsAJ.dat` (259 actions) |
| Effects | `EfYsData.dat`, `effYoshiDataTable` (particle-only) |
| Voices/SFX | `audio/us/yoshi.ssm` |
| Announcer | `0x7C84F` (`gm_80168C5C`, `CKIND_YOSHI = 17`), sample 1507 |

Specials use action entries **240–258** ([lib/game/yoshi-data.ts](../../lib/game/yoshi-data.ts)).
Engine idle `Wait1` maps to his `Wait` clip, and his egg-shield hold poses (absent
from his table — verified) stand in with frozen idle/flinch clips (below).

## Normals

Jab `Attack11/12`, dash, full tilts (`AttackS3S` central), full smashes, five
aerials — all hitboxes from Yoshi's own scripts. His aerial figatrees carry root
tag 0 instead of 1 (grounded ones carry 1); the loader accepts both after
verifying identical track layout and downstream guards.

## Specials

| Move | Implemented behavior |
| --- | --- |
| **Egg Lay** — neutral | N1 lunge with the original element-8 grab capsules; on connect the victim is egg-trapped (buried with zero sink through the shared bury timer/mash machinery) while Yoshi returns free after the N2 encase — matching the native dynamic (trapper free, victim stuck). Grounded victims only. |
| **Egg Roll** — side | Root-motion advance steered by stick, first loop iteration uses the hitting script and later ones the tired variant (mirroring the two `SpecialSLoop` scripts), release or timeout ends it, air-to-ground transitions keep the iteration. |
| **Egg Throw** — up | B edge creates the held egg; cmd0 throws it with the exact ballistics: speed = held frames × `x100` + `xFC`, angle off the `xF8` base by clamped stick magnitude, spawn at part 31 plus `x104`/`x108`. Egg life comes from its article; it bounces on the generic floor path. |
| **Yoshi Bomb** — down | Root-motion slam; cmd0 bursts a star each way (native impact frames); air landings pose `SpecialLwLanding` for its clip length. Stars use article speed/accel/launch height. |

### Explicit limitations

- No egg shield (hold poses don't exist on disc; mechanical shield — bubble, stun, pushback, break — runs untouched on frozen idle/flinch stand-ins) and no double-jump armor or flutter (generic airjump only).
- No egg-trap visual (victim buries in place with zero sink); encase damage beyond the lay hit is not modeled; egg HP/external break-in is not modeled.
- Egg Roll has no jump cancel and no slope dynamics beyond root motion; second-N1 and lay-egg article visuals are not loaded.
- Transform-style interactions (none for Yoshi) N/A. Kirby does not copy Yoshi yet (`PlKbCpYs.dat` not loaded).

## State and online

Roll iteration, held-egg age and trap state live in `SpecialRuntime.yoshi`;
victim trapping reuses snapshot-owned bury state. Egg/star flight is projectile
state. No wall-clock or `Math.random` use. Registered in rooms; allowlist
(`PlYs*.dat`, `EfYsData.dat`, `audio/us/yoshi.ssm`) needs joint frontend/server deploy.

## Validation

- [tests/unit/yoshi-real.test.ts](../../tests/unit/yoshi-real.test.ts): registration, 70-joint skeleton, full normals, egg/star articles, live egg trap, root-motion roll with finish, timed throws, landing star burst, poses both facings, snapshot restore + deterministic replay.
