# Milestone 07: walking and charged smashes

## Controls

- **P1 / solo:** Left Shift + A/D walks. A/D without the modifier still runs, preserving the previous keyboard mapping.
- **P2:** hold the slash key with left/right arrows to walk. Right Shift remains shield, not walk.
- **Walk mode: ON/OFF** in the toolbar locks P1/solo movement to walking, including the touch arrows. It persists across pause/rematch; held directions are still cleared on focus loss and pause.
- **Gamepad:** gentle horizontal input walks; input at the original dash threshold selects running. Walk mode can also force walking at full stick deflection.
- **Side smash:** hold K (P1/solo), M (P2), STRONG (touch), or the existing strong-attack gamepad button. Left/right chooses the side when starting. Release the strong button to swing, or keep holding until automatic maximum release.
- The existing **down smash** also honors its original charge command. Aerial attacks do not gain a charge mechanic.

## Walking

The prototype previously ran the Run physics callback even with a small stick deflection. It now has a separate `walk` state with original `WalkSlow`, `WalkMiddle`, and `WalkFast` clips.

Four additional original function bodies are extracted **unchanged** into the private WASM build:

- `getWalkAccel`, `ftWalkCommon_GetWalkType`, `ftWalkCommon_800E0060` from upstream `ftwalkcommon.c`.
- `ftCo_800DEEB8` from upstream `ft_0DF0.c` for charge-dependent damage scaling.

Walking uses the original acceleration/base, taper, friction, velocity target and stride thresholds. The ordinary full-stick walking limits are Fox **1.6** and Mario **1.1**, versus their run limits of 2.2 and 1.5. Stride rate is derived from velocity and the character's three original animation-scaling attributes, with phase-preserving transitions between clips. Native footstep cues are retained as ground-only events without replaying already-passed cues when changing stride.

The walking threshold is read separately from the previous general stick deadzone. Keyboard/touch walk mode affects locomotion, not aiming, air drift, special direction or throw direction. Walking uses standing jab/grab selection rather than pretending to be a dash attack/grab.

## Charging

[lib/game/moves.ts](../lib/game/moves.ts) now retains action opcode 56: charge point, maximum hold duration, fixed-point damage multiplier and color-animation id. Fox's side smash holds at original animation frame 7. The supported Fox/Mario smash commands specify a 60-frame maximum; multipliers come from the disc, **not** an invented universal 1.4.

[lib/game/smash.ts](../lib/game/smash.ts) adapts the PreCharge/Charging/Release state flow. Hold time is separate from animation time: the native windup pose freezes, no attack hitboxes are active during the hold, and release resumes the original animation/timeline. A quick tap stays uncharged; a continued held button does not automatically start a second attack after maximum release. Pause/hitlag freeze charging; interruption, KO, rematch and leaving the supporting floor clear it.

The original C damage-scaling function is applied to copies of active hit definitions, including late hits. Shared action definitions are not mutated. The original `kb_smashcharge_mul` vulnerability (1.2 here) applies to incoming knockback while charging, before the adapter's angle/speed/hitstun calculation.

The browser shows a charge meter, a **supplemental** warm pulse, and the original charge cue 123 once after the original five-frame delay. The full original color/shake table and rumble implementation are not ported.

## Scope and provenance

The bridge now builds **27 unchanged original functions plus RNG**, with function/source hashes in [web/public/wasm/gameplay.build.json](../web/public/wasm/gameplay.build.json). The current binary is 11,159 bytes. Its source checkout remains pinned and untouched. Walking/charge state selection, collision flow and some feedback remain explicit prototype adapters, not the complete GameCube engine.

This milestone does **not** implement the full dash-flick timer, pivot/dash-dance, tilt/up-smash selection, all IASA cancels, surface-specific footstep overrides, or original GX color/shake callbacks. The strong button is the prototype's explicit smash control, not a claim of full original controller equivalence.

No server asset names were added: all three walking clips and charge data come from the existing 17 allowlisted resources. The browser still simulates/renders/plays audio locally without per-frame asset requests.

## Verification

With the local ISO: **318 unit + 16 local browser + 35 server browser tests = 369 passing**.

New coverage includes original C walking acceleration/caps/stride thresholds, both directions, gentle-stick threshold, walk/run transitions, standing attack/grab selection, footstep timing, frozen charge poses, tap/partial/full charge, actual damage and knockback, late-hit immutability, maximum release, original sound cadence, incoming vulnerability, interruption/fall/KO cleanup, pause and both keyboard players' charge/walk controls. Touch-mode tests wait for an actual simulation tick rather than assuming that one 17 ms clock step always advances a 60 Hz simulation.
