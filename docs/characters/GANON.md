# Ganondorf: original ISO clone of Captain Falcon

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Ganondorf reuses Captain Falcon's `ftCaptain` code and scripts with his own data (`PlGn.dat`, `ftDataGanon`). Orchestration is the shared Falcon/Ganon handler in [lib/game/falcon.ts](../../lib/game/falcon.ts); no WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Gn` |
| Native `FTKIND_GANON` | 25 |
| Stable selector index | **24** |
| Parameter symbol | `ftDataGanon` (same `ftCaptain_DatAttrs` layout) |
| Model | `PlGnNr.dat`: 84 joints |
| Metadata / animations | `PlGn.dat` / `PlGnAJ.dat` (264 actions) |
| Effects | `EfGnData.dat`, `effGanonDataTable` (particle-only, no models emulated) |
| Voices/SFX | `audio/us/ganon.ssm` |
| Announcer | `0x7C836` (`gm_80168C5C`, `CKIND_GANON = 25`), sample 1482 — plays on CSS pick via `announcerCue` |

Specials use entries **247–263** ([lib/game/ganon-data.ts](../../lib/game/ganon-data.ts)): `SpecialN/AirN`, `SpecialSStart/S`, `SpecialAirSStart/S`, `SpecialHi/AirHi/HiCatch/HiThrow`, `SpecialLw/LwEnd`, `SpecialAirLw/End`, `LwEndAir/AirLwEndAir`, plus `SpecialHiThrow1` (entry 263, wall-rebound figatree reuse, not orchestrated). Ledge uses `CliffWait1` (entry 204).

## Normals

Single jab `Attack11` (Ganon's `Attack12` has no hitboxes and is not mapped), dash, three tilts, three smashes (`AttackS4S` central), five aerials. All from Ganon's own scripts.

## Specials

Shared Falcon parameters from `ftDataGanon` ([lib/game/ganon-data.ts](../../lib/game/ganon-data.ts)).

| Move | Behavior |
| --- | --- |
| **Warlock Punch** — neutral | Ground/air single states, stick redirect, velocity decay (same flow as Falcon Punch with Ganon's numbers). |
| **Gerudo Dragon** — side | Elem-11 detect boxes, ground uppercut vs air spike, Ganon's gravity/terminal/landings. |
| **Dark Dive** — up | Root-motion climb, elem-8 grab → `SpecialHiCatch` → `SpecialHiThrow` (12 % explosion), Ganon's mobility/landing. |
| **Wizard's Foot** — down | Ground/air root motion, on-hit 0.6 slow (bounded), Ganon's tractions/landings. |

### Explicit limitations

- Same prototype gaps as Falcon (no wall rebound, no flame particles, capture uses generic partner anchor).
- Kirby does not copy Ganon yet.

## State and online

Shares `SpecialRuntime.falcon` (grav/slow/slows/branch/freefall). Snapshot/rollback coverage follows Falcon. Rooms + allowlist (`PlGn*.dat`, `EfGnData.dat`, `audio/us/ganon.ssm`) need joint deploy.

## Validation

- [tests/unit/ganon-real.test.ts](../../tests/unit/ganon-real.test.ts): registration, 84-joint skeleton, single-jab mapping, Raptor-window detect, Dive catch/throw, Kick slow, restore + rollback.
