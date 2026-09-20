# Luigi: original ISO fighter

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Luigi runs his own `ftLuigi` code and data (`PlLg.dat`, `ftDataLuigi`) with a dedicated
handler in [lib/game/luigi.ts](../../lib/game/luigi.ts). No WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Lg` |
| Native `FTKIND_LUIGI` | 17 |
| Stable selector index | **27** |
| Parameter symbol | `ftDataLuigi` (`ftLuigiAttributes`: missile/smash, SJP, cyclone blocks) |
| Model | `PlLgNr.dat`: 61 joints, 65 meshes |
| Metadata / animations | `PlLg.dat` / `PlLgAJ.dat` (260 actions) |
| Effects | `EfLgData.dat`, `effLuigiDataTable` (particle-only, no models emulated) |
| Voices/SFX | `audio/us/luigi.ssm` |
| Announcer | `0x7C844` (`gm_80168C5C`, `CKIND_LUIGI = 7`), sample 1496 — plays on CSS pick |

Specials use action entries **243–259** ([lib/game/luigi-data.ts](../../lib/game/luigi-data.ts)).
The three ground `SpecialS` entries are Launch (hit, no gfx), Misfire (hit, fire gfx)
and Fly (command only); air Fly continues the air-launch clip, matching the native
`SpecialAirS2` keep-frame transition.

## Normals

Jab `Attack11/12/13`, dash, three tilts, three smashes (`AttackS4S` central),
five aerials — all hitboxes from Luigi's own scripts.

## Specials

| Move | Implemented behavior |
| --- | --- |
| **Fireball** — neutral | Flag-24 spawn (same contract as Mario) of Luigi's own article (slot 0). His fireball uses the `itUnkAttributes` layout (speed/lifetime, no angle — flies straight with article gravity), parsed by the dedicated `luigi-fire` article branch, not the Mario layout. |
| **Green Missile** — side | Start → Hold charge (`chargeFrames`/frame, smash-enter precharge, auto-release past max) → misfire die (`HSD_Randi(chance) == 0` via simulation RNG, rolled once at release) → Launch/Misfire → Fly → End. Damage is `tilt + charge * slope` on the launch capsule (misfire uses its fixed script hit). Velocities follow `ftLg_SpecialSFly_Enter` (charge-scaled, fixed misfire pair); air fly uses the native fall/gravity-start pair and X decel after cmd0. A connecting missile stops dead and ends (`OnGiveDamage`). |
| **Super Jump Punch** — up | Mario-shaped aim/reverse handling with Luigi's stick ranges and angle difference, root-motion rise, post-cmd0 air damping by `VEL_Y`, helpless with his landing lag and freefall mobility. |
| **Cyclone** — down | Exact enter dip (`TAP_MOMENTUM - TAP_Y_VEL_MAX`), grounded spins that stay grounded, and mash-gated rise: a fresh B press inside the cmd2 script window adds `TAP_Y_VEL_MAX` grounded (going airborne) or ascends toward it airborne. Air drift and end friction use his momentum blocks; landing lag is his integer count. |

### Explicit limitations

- Missile fly holds its clip's last frame and caps travel at 150 frames; the native flies until hit/landing/edge (same feel, bounded for rollback safety).
- Landing mid-fly resolves to the ground End state; exact ground/air end latching is simplified.
- SJP sweetspot placement follows the original script hitboxes; no additional sweetspot logic is invented.
- Kirby does not copy Luigi yet (`PlKbCpLg.dat` not loaded).

## State and online

Missile charge and the rolled misfire flag live in `SpecialRuntime.luigi` (snapshot-owned,
like Roy's charge). No wall-clock or `Math.random` use; misfire draws simulation RNG.
Registered in rooms; allowlist (`PlLg*.dat`, `EfLgData.dat`, `audio/us/luigi.ssm`) needs
joint frontend/server deploy.

## Validation

- [tests/unit/luigi-real.test.ts](../../tests/unit/luigi-real.test.ts): registration, 61-joint skeleton, full normals, fireball spawn, missile charge/release/finish, cyclone mash-rise, SJP recovery, poses both facings, snapshot restore + deterministic replay.
