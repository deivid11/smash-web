# Marth: original ISO clone of Roy (Marth/Mars)

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Marth uses the shared `MarsAttributes` layout with his own data (`PlMs.dat`, `ftDataMars`). Orchestration is the shared Roy/Marth handler in [lib/game/roy.ts](../../lib/game/roy.ts); tipper vs fire lives in hitbox data, not separate scripts. No WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Ms` |
| Native `FTKIND_MARS` | 18 |
| Stable selector index | **26** |
| Parameter symbol | `ftDataMars` (same layout as `ftDataEmblem`) |
| Model | `PlMsNr.dat`: 90 joints |
| Metadata / animations | `PlMs.dat` / `PlMsAJ.dat` (271 actions) |
| Effects | `EfMsData.dat`, `effMarsDataTable` (particle-only) |
| Voices/SFX | `audio/us/mars.ssm` |
| Announcer | `0x7C846` (`gm_80168C5C`, `CKIND_MARS = 9`), sample 1498 — plays on CSS pick via `announcerCue` |

Specials use entries **239–270** ([lib/game/marth-data.ts](../../lib/game/marth-data.ts)): `SpecialNStart/Loop/End/EndFull` (+air), full sword-dance chain `S1/S2Hi/S2Lw/S3Hi/S3S/S3Lw/S4Hi/S4S/S4Lw` (+air), `SpecialHi/AirHi`, `SpecialLw/LwHit/AirLw/AirLwHit`. The second `NEnd` maps to `EndFull` (Roy's full-charge pattern).

## Normals

Jab `Attack11/12`, dash, side tilt `AttackS31` (Marth/Roy use `S31`, not `S3S`), `AttackHi3/Lw3`, smashes `AttackS4/Hi4/Lw4`, five aerials. All from Marth's own scripts.

## Specials

Parameters from `ftDataMars` ([lib/game/marth-data.ts](../../lib/game/marth-data.ts)): Shield Breaker charge/damage/divisor/friction, Dancing Blade divisor/friction/boost/gravity/terminal (+ common threshold), Dolphin Slash mobility/landing/reverse/threshold/angle/momentum/airScale/gravity/terminal, Counter divisor/friction/gravity/terminal/multiplier/hitlag/bone/offset/radius.

| Move | Behavior |
| --- | --- |
| **Shield Breaker** — neutral | Charge → release with `baseDamage + trunc(charge/30)*damagePerSecond`; full charge plays `EndFull`. |
| **Dancing Blade** — side | Four stages with Hi/Lw branches on stick threshold; root-motion advance on later stages. |
| **Dolphin Slash** — up | Reverse/aim, root-motion rise, helpless with Marth's landing/mobility. |
| **Counter** — down | `cmd1` sphere; on hit, `counterDamage = trunc(trunc(hit.damage)*multiplier)`, facing flip, `Hit` phase. |

### Explicit limitations

- Same prototype gaps as Roy (no sword trails/fire particles, counter uses generic partner flow where applicable).
- Kirby does not copy Marth yet (would reuse `FeSpecial` anims).

## State and online

Shares `SpecialRuntime.roy` (charge/full/stage/branch/failed/descending) and `counterDamage`. Snapshot/rollback coverage follows Roy. Rooms + allowlist (`PlMs*.dat`, `EfMsData.dat`, `audio/us/mars.ssm`).

## Validation

- [tests/unit/marth-real.test.ts](../../tests/unit/marth-real.test.ts): registration, 90-joint skeleton, jab2/S31 mapping, Shield Breaker charge, Dancing Blade branch, Dolphin Slash, Counter sphere/trigger, restore + rollback.
