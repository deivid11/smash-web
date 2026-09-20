# Dr. Mario: original ISO clone of Mario

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Dr. Mario reuses Mario's `ftMario` code and motion names with his own disc data (`PlDr.dat`, `ftDataDrmario`). Special orchestration is the shared Mario/Dr. prototype in [lib/game/specials.ts](../../lib/game/specials.ts); no WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Dr` |
| Native `FTKIND_DRMARIO` | 21 |
| Stable selector index | **23** |
| Parameter symbol | `ftDataDrmario` (same `ftMario_DatAttrs` layout as Mario) |
| Model | `PlDrNr.dat`: 86 joints |
| Metadata / animations | `PlDr.dat` / `PlDrAJ.dat` (252 actions) |
| Effects | `EfMrData.dat`, `effMarioDataTable` (shared; `EfDrData.dat` does not exist) |
| Voices/SFX | `audio/us/drmario.ssm` |
| Announcer | `0x7C832` (`gm_80168C5C`, `CKIND_DRMARIO = 22`), sample 1478 — plays on CSS pick via `announcerCue` |

Specials use Mario's eight motion names (`SpecialN/AirN`, `SpecialS/SAir`, `SpecialHi/AirHi`, `SpecialLw/AirLw`) via `specialsByName`. Articles: Megavitamin pill is **slot 1** and cape **slot 3** (slots 0/2 empty), verified (`PlDr.dat` table). Pill shares the fireball layout (speed 1.4, angle −0.698).

## Normals

Full Mario-like mapping: jab `Attack11/12/13`, dash, three tilts, three smashes (`AttackS4S` central), five aerials. All hitboxes from Dr. Mario's own scripts.

## Specials

Shared Mario-branch parameters from `ftDataDrmario` ([lib/game/drmario-data.ts](../../lib/game/drmario-data.ts)): cape divisor/friction/boost/gravity/terminal + ReflectDesc, up-B mobility/landing/reverse/aim/momentum/gravity, tornado initial/speeds/accels/boost/cap/landing.

| Move | Behavior |
| --- | --- |
| **Megavitamins** — neutral | Flag-24 spawns `fireball`-kind pill with Dr.'s article (distinct speed/damage from Mario's fireball). |
| **Cape** — side | Reflect window on `cmd1`, aerial boost once (`capeBoostUsed`), Mario-branch physics. |
| **Super Jump Punch** — up | Reverse/aim via `cmd0`/flags 20/101, root-motion climb, helpless with Dr.'s landing/mobility. |
| **Tornado** — down | Mash boost (`cmd2`, `tornadoUsed`), drift limits, ground/air physics from Dr.'s params. |

### Explicit limitations

- Pill uses the `fireball` projectile kind (same code path as Mario); no separate `megavitamin` kind yet.
- Kirby does not copy Dr. Mario yet.
- Same prototype floors/collisions/particles as Mario.

## State and online

No Dr.-specific runtime beyond shared Mario fields (`capeBoostUsed`, `tornadoUsed`, `aim`, `driftLimit`). Snapshot/rollback coverage follows Mario. Registered in rooms; allowlist (`PlDr*.dat`, `audio/us/drmario.ssm`, shared `EfMrData.dat`) needs joint deploy.

## Validation

- [tests/unit/drmario-real.test.ts](../../tests/unit/drmario-real.test.ts): registration, 86-joint skeleton, Megavitamin slot-1 speed, cape reflector, restore + rollback.
