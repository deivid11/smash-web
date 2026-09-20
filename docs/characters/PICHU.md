# Pichu: original ISO clone of Pikachu

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Pichu reuses Pikachu's `ftPikachu` code with his own data (`PlPc.dat`, `ftDataPichu`). Orchestration is the shared Pikachu/Pichu handler ([lib/game/pikachu.ts](../../lib/game/pikachu.ts), projectiles ([lib/game/pikachu-projectiles.ts](../../lib/game/pikachu-projectiles.ts))); no WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Pc` |
| Native `FTKIND_PICHU` | 23 |
| Stable selector index | **25** |
| Parameter symbol | `ftDataPichu` (same `ftPikachuAttributes` layout) |
| Model | `PlPcNr.dat`: 46 joints |
| Metadata / animations | `PlPc.dat` / `PlPcAJ.dat` (267 actions) |
| Effects | `EfPkData.dat`, `effPikachuDataTable` (shared; `EfPcData.dat` does not exist) |
| Voices/SFX | `audio/us/pichu.ssm`; jolt cue `230067` (Pikachu uses `240076`) |
| Announcer | `0x7C84C` (`gm_80168C5C`, `CKIND_PICHU = 24`), sample 1504 — plays on CSS pick via `announcerCue` |

Specials use entries **242–266** ([lib/game/pichu-data.ts](../../lib/game/pichu-data.ts)) with Pikachu's key scheme (`SLaunch/STravel`, `HiTravel`, `LwHit` for repeated figatrees). Single jab `Attack11` (no `Attack12`), dash, three tilts, three smashes (`AttackS4` central), five aerials.

## Specials

Parameters from `ftDataPichu` ([lib/game/pichu-data.ts](../../lib/game/pichu-data.ts)): jolt spawn/landing, Skull Bash charge/damage/speed/lift, Quick Attack delay/frames/threshold/slope/speed/decay, Thunder boost/count/delay/contact.

| Move | Behavior |
| --- | --- |
| **Thunder Jolt** — neutral | `cmd0` spawns `tjolt` with Pichu's ground/air offsets; ground wave uses Pichu's baked joint-6 path. Sound `230067`. |
| **Skull Bash** — side | Charge → launch → end with Pichu's damage/charge/speed/lift; launch hitboxes persist; landing uses ground end. |
| **Agility** — up | Two zips at frame 13 with Pichu's threshold/speed/decay; second needs >38° change; helpless with Pichu's mobility/landing. |
| **Thunder** — down | Four linked `thunder` segments from Pichu's slot-0 article; self-contact burst (17 %) with aerial boost; platform-blocked. |

Articles: thunder (slot 0), jolt (slot 1), ground wave (slot 2) via `parsePichuArticles` (mirrors Pikachu).

### Explicit limitations

- **No recoil self-damage yet.** Native Pichu damages itself on electric attacks; values were not ported (inventing them would violate original-semantics rules). Tracked as a gap, not silent.
- Pichu's Quick Attack spark suppression (`kind==PICHU` skips `efSync 1012`) is presentation-only; the prototype already uses supplemental strokes.
- Kirby does not copy Pichu yet (would reuse `PkSpecial` anims).

## State and online

Shares `SpecialRuntime.pikachu` and `ProjectileState.pikachu` (charge, zips, thunder segments, anchors, victims). Owner lookup supports both `Pk` and `Pc` rosters. Snapshot/rollback coverage follows Pikachu. Rooms + allowlist (`PlPc*.dat`, `audio/us/pichu.ssm`, shared `EfPkData.dat`).

## Validation

- [tests/unit/pichu-real.test.ts](../../tests/unit/pichu-real.test.ts): registration, 46-joint skeleton, single jab, jolt article/path, Skull Bash charge, both zips, Thunder/self-contact, restore + rollback.
