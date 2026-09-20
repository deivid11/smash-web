# Sheik: original ISO fighter with Transform

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Sheik runs her own `ftSeak` code and data (`PlSk.dat`, `ftDataSeak`) with a dedicated
handler in [lib/game/seak.ts](../../lib/game/seak.ts). Her down-B swaps back to Zelda
through the same snapshot-safe transform infrastructure. No WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Sk` |
| Native `FTKIND_SEAK` | 7 |
| Stable selector index | **30** |
| Parameter symbol | `ftDataSeak` (`ftSeakAttributes`) |
| Model | `PlSkNr.dat`: 58 joints, 71 meshes |
| Metadata / animations | `PlSk.dat` / `PlSkAJ.dat` (264 actions) |
| Effects | `EfZdData.dat`, `effZeldaDataTable` (shared; `EfSkData.dat` does not exist) |
| Voices/SFX | `audio/us/zs.ssm` (shared Zelda/Sheik bank) |
| Announcer | `0x7C850` (`gm_80168C5C`, `CKIND_SEAK = 19`), sample 1508 |

Specials use action entries **242–263** ([lib/game/seak-data.ts](../../lib/game/seak-data.ts)),
including the natively misspelled `SpecialNCansel` figatrees. Engine idle `Wait1`
maps to her `Wait` clip (action 2), as with Pikachu.

## Normals

Jab `Attack11/12` plus rapid `Attack100` (loop carries the hits; start/end are
hitless wind-down), dash, `AttackS3/Hi3/Lw3`, smashes `AttackS4/Hi4/Lw4`, five
aerials — all hitboxes from Sheik's own scripts.

## Specials

| Move | Implemented behavior |
| --- | --- |
| **Needle Storm** — neutral | Start into a charging Loop: +1 needle per Loop clip iteration, capped at 6 (native loop counter), stored on the snapshot-owned `sheikNeedles` fighter field like Samus charge (kept through Cancel, lost on hit/KO). Release throws the whole stored count; shield stores instead (Cancel anim, verified). Each thrown needle randomizes its Y from the native scale table plus the grounded/air base (`x4`/`xC`) with the forward offsets (`x0`/`x8`), at article speed `x8` with the native grounded/air angle rule and `x0` lifetime. |
| **Chain** — side | Throw-out script hits, then an anchored whip: the item sits one tip-radius ahead, following the owner, with the slot-1 state-4 tip hit (12%) until release/timeout retracts it. No tether grab — explicit gap below. |
| **Vanish** — up | Vanish, stick-aimed teleport ride (`x44*mag + x48` velocity, `x40` threshold, default straight up) for the `x38` vanish frames, invisible like Mewtwo, then helpless. The slot-2 article hit (12%) lands during the last 5 travel frames (reappear burst window). Landing takes the original 30-frame lag. |
| **Transform** — down | Lw/Lw2 with the original velocity divisors, then an in-place content swap to Zelda (same snapshot-safe machinery as Zelda→Sheik, covered both directions in tests). Character select presents the pair as one slot with two starting forms (Zelda or Sheik). |

### Explicit limitations

- Needles stack at randomized heights (native Y table + sim RNG are exact; per-needle X spread is not modeled).
- Chain has no tether/edge grab, no angling and no wall collide; reach comes from the tip hit's own radius (the article bind pose is coiled, so joint extents were useless — documented in code).
- Vanish reappear burst window (last 5 travel frames) approximates the exact reappear frame; teleport passes through floors.
- Kirby does not copy Sheik yet (`PlKbCpSk.dat` not loaded).

## State and online

Needle count persists on the fighter (snapshot-owned); whip serial/travel age and
vanish aim are runtime/projectile state. Transform rides `SpecialStep.transform`.
No wall-clock or `Math.random` use. Registered in rooms; allowlist (`PlSk*.dat`,
shared `EfZdData.dat`, shared `audio/us/zs.ssm`) needs joint frontend/server deploy.

## Validation

- [tests/unit/sheik-real.test.ts](../../tests/unit/sheik-real.test.ts): registration, 58-joint skeleton, rapid mapping, three articles (needle 3%, chain tip, vanish 12%), charge/store/throw counts, chain extend/retract, Vanish recovery, Zelda→Sheik→Zelda transform with percent carry, transform event, and rollback restore across the swap.
