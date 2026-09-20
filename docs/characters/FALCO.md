# Falco: original ISO clone of Fox

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Falco reuses Fox's `ftFox` code and motion layout with his own disc data (`PlFc.dat`, `ftDataFalco`). Special orchestration is the shared Fox/Falco prototype in [lib/game/specials.ts](../../lib/game/specials.ts); no WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Fc` |
| Native `FTKIND_FALCO` | 22 |
| Stable selector index | **22** |
| Parameter symbol | `ftDataFalco` (same `ftFox_DatAttrs` layout as Fox) |
| Model | `PlFcNr.dat`: 67 joints |
| Metadata / animations | `PlFc.dat` / `PlFcAJ.dat` (278 actions) |
| Effects | `EfFxData.dat`, `effFoxDataTable` (shared with Fox; `EfFcData.dat` does not exist) |
| Voices/SFX | `audio/us/falco.ssm` |
| Announcer | `0x7C834` (`gm_80168C5C`, `CKIND_FALCO = 20`), sample 1480 — plays on CSS pick via `announcerCue` |

Specials use action entries **246–271** ([lib/game/falco-data.ts](../../lib/game/falco-data.ts)): `SpecialNStart/Loop/End`, `SpecialSStart/S/SEnd`, `SpecialHiHold/HoldAir/Hi/Landing/Fall/Bound`, `SpecialLwStart/Loop/Hit/End` (+air). All figatree names are distinct. The illusion article lives in **slot 3** (slot 2 is empty), verified against `PlFc.dat` (`table+0x48`).

## Normals

Full tilt/smash/aerial mapping: jab `Attack11/12` + rapid `Attack100*`, dash, `AttackS3S/Hi3/Lw3`, `AttackS4/Hi4/Lw4`, five aerials. Hitboxes, timings and bones come from Falco's own scripts (e.g., blaster `AttackS4` 6 hits, verified).

## Specials

Shared Fox-branch parameters from `ftDataFalco` ([lib/game/falco-data.ts](../../lib/game/falco-data.ts)): laser speed/angle, Phantasm distances/frictions, Fire Bird aim/frames/speed/decay, Reflector bone/radius/multipliers.

| Move | Behavior |
| --- | --- |
| **Blaster** — neutral | Start/loop/end with queued taps (`cmd0`), laser shots (`laser` kind) using Falco's article (speed 100, distinct from Fox's 35). Sounds reuse Fox's IDs (explicit gap; Falco's SEM blaster IDs not mapped). |
| **Phantasm** — side | Start/travel/end with root-motion travel, early `end` on press, ground/air end distances from Falco's params. |
| **Fire Bird** — up | Hold/start charge, aim from stick vs `aimThreshold`, launch at `speed`, decay after `slowAfter`, helpless with Falco's landing/mobility. |
| **Reflector** — down | Start/loop/hit/end with `releaseLag`, gravity, and Falco's ReflectDesc (shine-jump allowed). |

Articles: laser (slot 0), blaster (slot 1), illusion ghost (slot 3) via `parseArticle`. Falco's laser `throwHit` (thrown-laser branch in [lib/game/combat.ts](../../lib/game/combat.ts)) reuses the same flag-24 path as Fox.

### Explicit limitations

- Blaster/shine SFX reuse Fox's SEM IDs; Falco's own voice bank is loaded but laser/shine cues are not yet remapped.
- Kirby does not copy Falco yet (`PlKbCpFc.dat` not loaded).
- No full TEV/particle equivalence; same prototype floors/collisions as Fox.

## State and online

No Falco-specific runtime beyond the shared Fox `SpecialRuntime` (delay, releaseLag, queued, aim). Snapshot/rollback/canonical hash coverage follows Fox. Registered in [lib/net/protocol.ts](../../lib/net/protocol.ts); allowlist additions (`PlFc*.dat`, `audio/us/falco.ssm`, shared `EfFxData.dat`) require joint frontend/server deploy.

## Validation

- [tests/unit/falco-real.test.ts](../../tests/unit/falco-real.test.ts): registration, 67-joint skeleton, keyed specials, normal hitboxes, Falco laser speed, reflector, restore + 2/4-player rollback.
- Full unit suite with real ISO: 89 files pass (see this delivery's `npm run check`).
