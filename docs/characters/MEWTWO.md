# Mewtwo: original ISO import

See [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md) for the import workflow. This is the **Smash Web** prototype, not the neighboring procedural-character project.

## Content and identifiers

- Disc/runtime kind `Mt`; native `FTKIND_MEWTWO = 16`; stable selector index **10**. Existing choices are not renumbered.
- Exact allowlisted resources: `PlMt.dat`, `PlMtAJ.dat`, `PlMtNr.dat`, `EfMtData.dat`, `audio/us/mewtwo.ssm`. Models, textures and PCM remain in the user's private ISO and are loaded at runtime, not bundled into the static frontend.
- Original neutral model: **68 joints, 46 mesh parts**; common-part mapping has no virtual joints. Weight 85, two jumps, gravity 0.082.
- Character subactions occupy action-table entries **244–262**. `SpecialNLoopFull` (246) and `SpecialAirNLoopFull` (251) reuse the Loop figatrees with their own scripts, and the aerial Teleport zoom reuses the shared `SpecialHiLost` clip; the keyed loader pins each entry by verified index.
- Mewtwo has **one jab plus the original rapid-jab chain** (`Attack11`, `Attack100Start/Loop/End`); there is no fabricated Attack12/Attack13. Tilts are `AttackS3S`/`AttackHi3`/`AttackLw3`, smashes `AttackS4`/`AttackHi4`/`AttackLw4`, plus five aerials.
- Menu announcement `0x7C848` follows `gm_1601` `CKIND_MEWTWO = 0x0A`. In-match cues resolve through Mewtwo's US SSM and the shared SEM table.

## Special moves

Implementation: [lib/game/mewtwo-data.ts](../../lib/game/mewtwo-data.ts), [lib/game/mewtwo.ts](../../lib/game/mewtwo.ts), projectile branches in [lib/game/projectiles.ts](../../lib/game/projectiles.ts).

| Move | Implemented behavior |
| --- | --- |
| **Shadow Ball** | Start → charge loop → full loop / cancel / end, mirroring `ftMt_SpecialN*`. The charge bank lives on the fighter (`mewtwoCharge`, 0–7 cycles of 17 frames from `x0`/`xC`); L/R stores it through the original Cancel states and it survives between uses. Release (A or B, `SpecialNEnd` cmd 1 at frame 8) fires the item-state article for the banked level: per-charge original hitboxes (**3%–25%**), interpolated launch speed/scale, and ground/air recoil per charge (`x4`/`x8`). Taking a hit drops a partial ball but keeps a full one (`ftMt_SpecialN_OnDeath`). The flying wander is a supplemental deterministic approximation of the native child-JObj wobble driven by the snapshot-owned match RNG. |
| **Confusion** | Single grounded/aerial state. The script's cmd var 1 opens/closes the original `ReflectDesc` window (radius 10, 1.5× damage); ownership never transfers, matching native `x2218_b4`. The aerial 1.5-unit boost applies once per airtime (`x223C`). |
| **Teleport** | Start charge, then a 10-frame invisible, intangible zoom at `momentum·stick + momentumAdd` along the stick direction (defaults straight up under the 0.5 dead zone), then the end state keeps `endMul` momentum and finishes helpless with original 30-frame landing lag and 0.4 freefall mobility. |
| **Disable** | The script's cmd 0 spawns the original short-lived article (6 frames at 2.7 units/frame from the L3rdNb hand offsets) with its 1% element-12 hit. |

## Explicit prototype limitations

This import is not proof of whole-engine/GameCube equivalence.

- Confusion's command grab and flip throw (`ftCo_CaptureMewtwo`, `ThrownMewtwo`) are **not ported**; the move currently reflects but does not grab. Disable's gaze-stun reaction (element 12) is not modeled; it lands as a plain 1% hit.
- Grounded Teleport goes momentarily airborne instead of sliding along the floor; surface-angle clamps and wall/ceiling teleport collisions remain unported (horizontal-floor stages only).
- The Shadow Ball wobble and its landed burst states (10–17) are approximations: the wander path is supplemental and surface contact removes the ball instead of playing the native burst.
- Native psychic particle effects, tail physics and full TEV/billboard rendering are incomplete; `effMewtwoDataTable` holds particle-bank descriptors, not model descriptors.
- Kirby does not acquire Mewtwo's copy ability: `PlKbCpMt.dat` is deliberately not loaded or exposed. Alternate costumes are not imported.

## State, replay and resource safety

The Shadow Ball bank (`mewtwoCharge`) and Confusion boost latch (`mewtwoBoostUsed`) are fighter fields inside the generic match snapshot; loop/full/zoom state lives in the serializable `SpecialRuntime.mewtwo`. Projectiles capture as `Mt/mewtwo/charge0..7` and `Mt/mewtwo/disable` keys and restore against the current content graph. The wobble consumes the WASM match RNG, so rollback restore replays identically; no renderer state is authoritative. Teleport invisibility is a render-only branch in [web/src/render/game-rig.ts](../../web/src/render/game-rig.ts).

## Validation

- [tests/unit/mewtwo-real.test.ts](../../tests/unit/mewtwo-real.test.ts): registration/allowlist exactness, 68-joint profile and clips, ftMewtwoAttributes bounds, per-charge articles, 17-frame charge cycles, store-through-cancel, full release with recoil and reset, partial-vs-full charge loss on hit, Confusion reflect window and one-per-airtime boost, Teleport travel/intangibility/helpless, Disable projectile, snapshot restore and a 160-frame rollback replay.
- [tests/server-browser/mewtwo.spec.ts](../../tests/server-browser/mewtwo.spec.ts): mirror selection/HUD, keyboard specials with zero per-frame asset reads, full-charge release, narrow-viewport portrait, exact-asset privacy checks.

**Current delivery status:** original content and playable prototype implementation are present; ISO unit validation is passing (11 Mewtwo cases). Browser screenshots, combined build and the server/browser gate are pending coordinated validation with the concurrent roster/UI changes (Link, Young Link, Captain Falcon and Donkey Kong were landing simultaneously). Online is registered; multi-browser Mewtwo verification is not yet claimed.
