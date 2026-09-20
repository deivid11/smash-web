# Pikachu: original ISO import

See [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md) for the import workflow. This is the **Smash Web** prototype, not the neighboring procedural-character project.

## Content and identifiers

- Disc/runtime kind `Pk`; native `FTKIND_PIKACHU = 12`; stable selector index **5**. Existing choices are not renumbered.
- Exact allowlisted resources: `PlPk.dat`, `PlPkAJ.dat`, `PlPkNr.dat`, `EfPkData.dat`, `audio/us/pikachu.ssm`. Models, textures and PCM remain in the user's private ISO and are loaded at runtime, not bundled into the static frontend.
- Original neutral model: **53 joints, 52 mesh parts**; common-part mapping has no virtual joints. Draw-object visibility selects the neutral body/face alternatives.
- Original idle is named **Wait**, not Wait1. The keyed loader maps engine Wait1 to action-table entry 2, preserving its 430-frame original figatree and script.
- Pikachu has **one jab**, Attack11. Repeated QUICK taps restart it at the original script's combo gate (frame 5 in USA 1.02), following the Pikachu branch of `doAttack12` → `checkAttack11`. Each restart resets the jab input window, script cursor and hit activation; taps survive hitlag, but holding QUICK alone does not auto-repeat. `moves.jab2` is optional; there is no fabricated Attack12 or borrowed move.
- Full normal move mapping includes three tilts, three smashes and five aerials. Common shield, dodges, grab, pummel, throws and ledge motions load from Pikachu's own archive.
- Menu announcement `0x7C84D` follows `gm_80168C5C` / `CKIND_PIKACHU = 0x0D`. In-match cues resolve through Pikachu's US SSM and the shared SEM table.

## Special moves

Implementation: [lib/game/pikachu-data.ts](../../lib/game/pikachu-data.ts), [lib/game/pikachu.ts](../../lib/game/pikachu.ts), [lib/game/pikachu-projectiles.ts](../../lib/game/pikachu-projectiles.ts).

| Move | Implemented behavior |
| --- | --- |
| **Thunder Jolt** | Original neutral/aerial script sets cmd0 at frame 18. Uses original ground/air spawn offsets, launch angle, speed and lifetime. Slot 1 is the airborne controller (10%); it has **no model joint**, because native code draws it with an effect. A supplemental electric stroke represents that particle-only spark. On floor contact, switch to slot 2's original ground-wave model and 7% hit definition. Its **joint-6 animation path** is baked from original full FK at load time and drives authoritative arcs and rendering, rather than sliding an unrelated projectile. Floor contacts restart the original arc. Stops at unsupported surface edges. |
| **Skull Bash** | Start → held charge → launch → recovery. Reads maximum charge, damage-per-charge-frame, launch speed, lift, friction and gravity from ftPikachuAttributes. Damage updates the original capsule; the shared travel script supplies the late gravity gate. Launch hitboxes persist through travel, matching the native skip-hit transition. Connecting a damaging hit ends forward travel. Landing uses the original ground end animation. |
| **Quick Attack** | Original 14-frame start, five-tick zip held at animation frame 13, end, and optional second zip at the end script's cmd0 gate. Stick magnitude supplies speed; neutral stick defaults upward. Second zip requires **more than 38°** direction change and uses the original 0.9 speed multiplier. First/second zips retain their separate original 3%/2% scripts. Consumes double jump, ends in helpless aerial fall with original mobility/landing lag. XRotN aim is applied to the same CPU pose used for rendering and collision. |
| **Thunder** | Original start/loop/spawn flag creates **four linked segments**, delayed by eight frames, descending from the original height at the original speed. Uses slot 0's native textured article and 10% hit data. The first segment checks its tip against Pikachu's position; actual self-contact enters the original 17% burst and gives the original aerial boost. Moving away or an intervening platform prevents the burst. Segments stop/collapse at the first contact, share victim history, expire, and notify only their originating cast. |

### Shared parser correction

Pikachu's aerial scripts often consist of a **backward goto into a ground script**. The old parser treated every backward pointer as an already-completed loop, silently dropping aerial hitboxes, commands and sounds. [lib/game/moves.ts](../../lib/game/moves.ts) now follows backward gotos; existing frame, nesting and instruction budgets bound actual loops. Synthetic tests cover script sharing, timed loops and no-time-progress loops. This changes parsing of other original fighters' shared scripts too, so the complete regression suite is required.

## Explicit prototype limitations

This import is not proof of whole-engine/GameCube equivalence.

- Full ECB walls, ceilings, slopes, Quick Attack surface-angle collision branches and ground-jolt wall/ceiling wrapping remain unported. Current stages use horizontal floors.
- Quick Attack's native per-bone squash/stretch and random effect particles are not reproduced. Rotation uses original aim data; supplemental strokes are presentation-only.
- Thunder segment collapse is a bounded scale approximation, not native bit-identical scaling. Native cloud/particle generators and full TEV/billboard rendering are incomplete.
- Jolt reflection reverses the existing arc about its current point; full native surface-normal reflection/rotation and linked-item callback behavior remain outside this slice.
- Kirby does not acquire Pikachu's copy ability: `PlKbCpPk.dat` is deliberately not loaded or exposed. Alternate costumes are not imported.
- No general item pickup, stale moves, DI/SDI or full GameCube audio-mixer equivalence is implied by the original assets.

## State, replay and resource safety

Pikachu-specific charge, launch, zip and thunder state lives inside the serializable `SpecialRuntime.pikachu`. Ground-wave anchors/frame/direction, delayed thunder segment state, source cast identity, stop positions, collapse, victim history and resource IDs are captured in `ProjectileState`. Restore rebinds `Pk/pikachu/thunder` and `Pk/pikachu/groundJolt` to the current content graph. Models and renderer instances are never authoritative state.

The existing 32-projectile budget is retained. The waiting Thunder state also has a lifetime-derived cleanup bound so eviction cannot leave a fighter stuck forever. Supplemental stroke instances are removed when inactive and disposed on rematch/reset. There are no in-match asset fetches in the new code.

## Validation

- [tests/unit/pikachu-real.test.ts](../../tests/unit/pikachu-real.test.ts): profile/53-joint clips, keyed and shared scripts, normal attack bones/facings, actual jab/grab/throw, single-jab behavior, jolt model/path and transitions, original SFX, Skull Bash charge, both Quick Attack zips, same-direction rejection, delayed Thunder/self-contact/miss, snapshot restore, two-/four-slot late-input rollback with exactly-once confirmed events.
- [tests/unit/gameplay-core.test.ts](../../tests/unit/gameplay-core.test.ts): bounded backward-goto regression tests.
- [tests/server-browser/pikachu.spec.ts](../../tests/server-browser/pikachu.spec.ts): new battle-flow helper selection, original portraits/HUD, mirror/rematch, keyboard specials, projectile kinds, per-frame request guard and exact-asset privacy checks. Optional screenshots go to `SMASH_SERVER_ARTIFACT_DIR`.

**Current delivery status:** original content and playable prototype implementation are present; ISO unit validation is passing (**17 Pikachu cases; 759/759 combined unit tests** at the latest coordinated checkout snapshot). Browser screenshots, combined build and server/browser gate are pending coordinated validation with the concurrent roster/UI changes. Online is registered and headless late-input rollback is tested; multi-browser Pikachu verification is not yet claimed.
