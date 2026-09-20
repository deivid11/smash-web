# Link / Young Link: original-source parity and remaining scope

**Verdict: playable, but not a complete Melee implementation.** Original models, animation clips, move scripts and parameters are loaded from the supported USA 1.02 disc. That alone does not make the prototype's input, collision, item or presentation systems equivalent to the original game.

This audit compares the pinned original revision `0bac93a5ee2f985dac6220bd36ed7078ae6ac0c9` against the current adapter, with real-disc regression tests. It does not claim testing against GameCube execution. Link and Young Link use their own archives and parameters; the fixes below apply to both where their native callbacks are shared.

## Corrections made by this audit

### Bow / arrows

Implementation: [lib/game/link.ts](../../lib/game/link.ts), [lib/game/link-data.ts](../../lib/game/link-data.ts), [lib/game/link-projectiles.ts](../../lib/game/link-projectiles.ts).

- **Damage conversion:** the native arrow interpolates using raw charge and single-precision arithmetic, then passes damage through an unsigned-integer API. Fractional base damage is now truncated instead of being applied directly.
- **Flight lifetime:** **60 ticks for Link, 55 for Young Link**. The separate 50-tick post-impact timer is no longer added to damaging flight.
- **Charge boundary:** a completed startup reaches full charge before processing a release on that same tick, following native animation-before-input ordering.
- Correct existing data is retained: charge caps **60 / 45**, arrow damage endpoints **5–18 / 8–15**, speed endpoints **1.3–5 / 1.3–4**, gravity **0.053 / 0.06**, and the original launch point/angle.

Source: [third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspecialn.c](../../third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspecialn.c) (`ftLk_SpecialNStart_Anim`, loop IASA); [third_party/melee/src/melee/it/kinds/itlinkarrow.c](../../third_party/melee/src/melee/it/kinds/itlinkarrow.c) (`it_802A8C7C`, flight animation/physics); [third_party/melee/src/melee/it/itcoll.c](../../third_party/melee/src/melee/it/itcoll.c) (`it_80272460`, unsigned damage parameter).

### Boomerang

Implementation: [lib/game/link-data.ts](../../lib/game/link-data.ts), [lib/game/link-projectiles.ts](../../lib/game/link-projectiles.ts), [lib/game/projectiles.ts](../../lib/game/projectiles.ts).

- **Three distinct article descriptors:** strong outbound → late outbound at the script's **frame 3** → return. Base damage is **8 / 6 / 3** for Link and **11 / 7 / 2** for Young Link. Previously the initial strong descriptor was skipped.
- **Immutable contact data:** queued body/shield impacts retain their hit and direction even if the projectile switches to return before damage is applied. Previously return damage could replace the outgoing hit.
- **Natural return:** reverses heading immediately at minimum speed, without accelerating until the next return tick.
- **Return acceleration:** **0.047**, not the unrelated **0.167** field. Native natural/contact turn limits are **0.75° / 1.5°** for Link and **1° / 2°** for Young Link, not the 30° surface threshold.
- **Target and budget:** home toward fighter position plus the native **9.67** Y offset, for at most **140** homing ticks; do not chase an animation-dependent hand position. Velocity is calculated before that tick's homing update.
- **Reflection:** releases the old owner's boomerang slot, travels away from the reflector, preserves reflected speed without ordinary deceleration/homing, and uses the saved launch half-life. The supported revision's verified item-common half-life factor is **0.5**: ordinary **70**, Link smash **85**, Young Link smash **90**. This is not half the remaining lifetime.
- **Smash input window:** uses the original common **2 + 4 = 6** ticks, rather than a hardcoded four.
- **Supported-floor incidence:** shallow downward contact bounces without forcing return; steep contact starts return. This is still a floor-only approximation of the native normal-based map solver.

Source: [third_party/melee/src/melee/it/kinds/itlinkboomerang.c](../../third_party/melee/src/melee/it/kinds/itlinkboomerang.c), especially the item-motion-to-animation table, `it_802A0C34`, `it_802A1948`, return physics and `it_802A20E8`; [third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspecials.c](../../third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspecials.c); [third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspecialhi.c](../../third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspecialhi.c) (`ftLk_SpecialHi_GetPosWithAdjustedY`).

### Bombs

Implementation: [lib/game/link.ts](../../lib/game/link.ts), [lib/game/link-projectiles.ts](../../lib/game/link-projectiles.ts), [lib/game/projectiles.ts](../../lib/game/projectiles.ts).

- **Self-explosion:** the blast can now damage its owner. A held bomb remains harmless before detonation; Link can no longer hold it through its fuse without consequence.
- **Shield contact:** an active blast is not deleted by the first shield it touches; its authored hit windows/pulses remain available to other fighters.
- **Attack-to-throw:** normal attack while holding a bomb throws it instead of performing a sword attack. Directional ordinary throws and the abstract STRONG variant use original item-throw scripts/velocity entries.
- **Down-B while holding:** selects the native forward smash throw (`LightThrowF4` / `LightThrowAirF4`), not a normal downward throw based on the stick used to invoke down-B.
- **Backward throws:** turning and release are separate script flags. Turning no longer releases the item prematurely or flips the saved launch direction twice.
- **Scripted timing:** smash throws load their own keyed scripts even though their figatrees reuse ordinary throw names. Native animation multipliers and cmd0 velocity/angle overrides are consumed.
- Existing bomb data remains distinct: both fuses are **300 ticks**; Link has the single shrinking blast, while Young Link has three **2%** activations at authored frames **2, 5, 8**.

Source: [third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspeciallw.c](../../third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspeciallw.c) (`updateBomb`, `spawnBomb`); [third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_ItemThrow.c](../../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_ItemThrow.c); [third_party/melee/src/melee/it/kinds/itlinkbomb.c](../../third_party/melee/src/melee/it/kinds/itlinkbomb.c) (`it_8029F69C`); [third_party/melee/src/melee/it/ithitbox.c](../../third_party/melee/src/melee/it/ithitbox.c) (`it_80275444`).

### Spin Attack / down-air

Implementation: [lib/game/link.ts](../../lib/game/link.ts), [lib/game/match.ts](../../lib/game/match.ts), [lib/game/physics.ts](../../lib/game/physics.ts), [engine/gameplay/core.c](../../engine/gameplay/core.c).

- **Aerial Spin drift:** now calls the actual friction-aware `ftCommon_8007D344` / `ftCommon_8007D140` routines through a separate WASM bridge, instead of D3A8. Neutral stick preserves entry momentum and applies friction instead of snapping horizontal speed to zero. The original function text is extracted unchanged and covered by provenance hashes.
- **Leaving an edge:** a newly started ground Spin is not cancelled by a stale pre-input `canAct` value. It transitions to its aerial animation, consumes both jumps and does not gain a fresh aerial-entry lift.
- **Down-air rebound:** clears fast-fall, disables hitboxes for the original **30 animation-tick** rearm delay, restores the native weak **6 / 8 / 8** hitboxes, and gives each new down-air its own reaction state. Hitlag freezes that timer.
- **Late down-air contact:** seeks to **60 = 90 − 30**. Native initialization derives the end from the down-air figatree's **90-frame duration**, not the on-disc zero placeholder or the script's frame-65 hit clear. Cached hitboxes can rearm after the ordinary script clear, subject to native end timing.

Source: [third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspecialhi.c](../../third_party/melee/src/melee/ft/kinds/ftLink/ftlinkspecialhi.c); [third_party/melee/src/melee/ft/ftcommon.c](../../third_party/melee/src/melee/ft/ftcommon.c); [third_party/melee/src/melee/ft/kinds/ftLink/ftlinkattackair.c](../../third_party/melee/src/melee/ft/kinds/ftLink/ftlinkattackair.c); [third_party/melee/src/melee/ft/kinds/ftLink/ftlink.c](../../third_party/melee/src/melee/ft/kinds/ftLink/ftlink.c) (`ftLk_Init_OnLoad`).

**Lookup caution:** [lib/hsd/animation.ts](../../lib/hsd/animation.ts) filters empty action-table entries. Its array position is not a native raw table index. Native raw action 72 is down-air, but filtered array element 72 is a different animation. Use raw table entries or verified symbols when translating native indices.

## Verified existing attacks

- Own normals, aerials, jab chain and rapid-jab scripts are loaded from each character's archive. The prior jab audit is documented in [docs/JAB_TIMING.md](../JAB_TIMING.md).
- The first forward-smash followup accepts a fresh attack while cmd0 is open: **19–49**, not before 19 or from 50 onward. The second smash uses its own script and hitboxes; clearing the first smash's charge state is consistent with the native state transition.
- Spin's existing aerial lift, gravity multiplier, jump count on direct aerial entry, helpless completion and numeric landing-lag parameter were already present. They should not be replaced with generic tuned physics.

## Still incomplete — do not claim full parity

These findings are not hidden by the successful regression tests:

1. **Shared landing mechanics:** normal aerial autocancel windows and L-cancel are not fully implemented. Link down-air can still receive 50-frame landing lag outside the native active landing window; an eligible native L-cancel would halve it. Landing animation playback is not consistently retimed to the requested lag.
2. **Shared action interrupts:** most normal IASA windows remain unconsumed, apart from the targeted jab-finisher fix. Examples: nair 36 versus clip end 40, bair 30/40, uair 60/70, dair 80/90, second forward smash 50/60, down tilt 32/40. These need move-specific native input-priority handling, not a blanket cancel rule.
3. **Ground overspeed friction:** the common stationary ground wrapper does not reproduce the above-walk-speed multiplier. Running into ground Spin can retain too much horizontal momentum.
4. **General bomb/item system:** no general pickup/re-catch, item hurtboxes/damage, complete low-speed contact bounce, dash throw, shield/Z-drop, or full stick-flick item-throw selection. Contact/detonation and cleanup still include prototype simplifications; the blast timeline is original, not a complete item lifecycle port.
5. **Boomerang catch:** close returns are removed and free the slot, but the original catch animation/reattachment/removal-cmd sequence and its interrupt repertoire are not implemented. Catch is now tested separately from expiration; that does not imply complete native catch behavior.
6. **Arrows and terrain:** embedded arrows on shields/floors and their post-impact states are not implemented. Full walls/ceilings and native swept-item/ECB collision remain outside the slice. The floor grazing rule is not a full surface-normal solver.
7. **Presentation:** six native bow article states are parsed but are not yet presented as attached bow/drawn-arrow props. Boomerang catch visuals, trails and item-loop SFX still need a dedicated visual/audio pass. The blanket projectile fire halo has since been removed; arrow/boomerang facing and shared native slash/fire-hit reactions are handled by [docs/SHARED_VFX.md](../SHARED_VFX.md). Adult arrows/boomerangs are not fire; bombs and Young Link arrows can burn their victims.
8. **Hookshot/grab:** explicitly unsupported in the selector. Passive Hylian-shield behavior, item clashes and every ignored command were not established as complete by this audit. Stale moves, DI/SDI, full TEV/particle/AX behavior and GameCube numerical equivalence are not implied.

## Validation

- [tests/unit/link-parity-real.test.ts](../../tests/unit/link-parity-real.test.ts): targeted original-data regressions for arrows, charge boundary, strong/late/return boomerang hits, immutable damage, natural/contact return, reflection, floor incidence, real catch versus expiry, bomb controls/blasts, Spin drift/edge transition, down-air rearm/seek and state replay.
- [tests/unit/link-real.test.ts](../../tests/unit/link-real.test.ts), [tests/unit/young-link-real.test.ts](../../tests/unit/young-link-real.test.ts), [tests/unit/link-data-real.test.ts](../../tests/unit/link-data-real.test.ts): existing original-asset and gameplay integration coverage, with the corrected arrow flight lifetimes.
- [tests/unit/gameplay-core.test.ts](../../tests/unit/gameplay-core.test.ts): unchanged original-function extraction, source hashes and the expanded native drift bridge.
- [tests/server-browser/link.spec.ts](../../tests/server-browser/link.spec.ts): actual keyboard-driven bomb pull/normal throw, full bow release and boomerang lifecycle for both Link variants.

Validation at completion: build/typecheck passed; **983 of 984 unit tests passed** with real disc data; **22 general browser tests and both Link browser scenarios passed**. The remaining pre-existing failure in [tests/unit/server.test.ts](../../tests/unit/server.test.ts) expects the now-allowlisted Pokémon Stadium asset to be denied; it is unrelated to these gameplay changes.

Original-data tests require a locally configured supported disc. Passing prototype regressions and browser checks is separate from comparing complete matches with the original console engine.
