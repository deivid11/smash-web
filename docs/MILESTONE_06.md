# Milestone 06: defense, grabs/throws, and stage ledges

This extends the local Fox/Mario prototype. It is **not** a full port of the original common fighter state machine or ECB solver.

## Controls

| Action | P1 / solo | P2 keyboard |
| --- | --- | --- |
| Shield (hold) / air dodge (press in air) | U | Right Shift |
| Spot dodge | Shield + down | Shield + down |
| Forward/back roll | Shield + fresh left/right | Shield + fresh left/right |
| Grab | I, or shield + J | Period, or shield + N |
| Pummel while holding someone | J | N |
| Forward/back/up/down throw | A/D/W/S after catching | Arrows after catching |
| Escape capture / dizziness | Repeated fresh buttons/stick movements | Same |

The touch row has SHIELD and GRAB buttons. Standard gamepads use either trigger for a full/digital shield and the left shoulder for grab; the existing right shoulder strong attack remains unchanged.

On a ledge: release the stick/direction first; then up/toward the stage climbs, jump launches a ledge jump, QUICK attacks, SHIELD rolls, and down/away lets go. Only the two **flagged stage ledges** of Battlefield are catchable. Its three pass-through platforms do not gain invented ledge-grab behavior.

## Implemented

- Digital shield: original size/bone, 60-point energy, drain/regeneration, shrinking collision sphere, shield damage, shieldstun/pushback, release animation, and shield-break/dizzy recovery with mash reduction. The shield intercepts melee and projectile collisions; a hit outside the bubble can still reach an exposed hurt capsule.
- Ground spot dodge and directional rolls: original clips, whole-body status script events and root motion; no repeat-roll from simply holding a direction. Rolls remain on the connected supporting floor rather than running off its edge.
- Air dodge: original 3.1 initial speed, stick deadzones, 0.9 decay, script-timed immunity and gravity return, helpless recovery, and 10-frame special landing lag. Landing preserves horizontal momentum for the prototype's wavedash-like slide. No unlimited midair dodge loop.
- Standing/dash grabs: original grab hitboxes (element 8), their frame windows and grabbable hurt-capsule flags; grabs bypass shields but not dodge/ledge intangibility. Simultaneous connecting grabs release both fighters without player-order priority.
- Held pair: bidirectional links, bounded duration and input-edge mashing, original pummel clip/hit, interruption/KO/rematch cleanup, and four throws. Throw definitions and release/turn flags come from the original action scripts; release uses the existing original C knockback helpers. Weight-dependent animation rate uses the fighter's throw mask and the common weight scale.
- Fox throw lasers: distinct original item state-1 hit data (2 damage, not the neutral laser's 3), script shot flags, blaster accessory and original sound cues.
- Ledge catch/wait: original flagged floor endpoints and snap dimensions, descending/hold-down/cooldown eligibility, occupancy, jump-resource restoration, timed invulnerability and hang timeout. Catch/wait/getup positions follow original TransN tracks. Climb, attack, roll and jump have original quick/slow clips selected at the 100-percent threshold.
- Browser feedback: shield-energy HUD, capture/dizzy hints, a bounded procedural shield surface, and translucent dodge indication during intangible frames.

## Data and source basis

- [lib/game/combat-data.ts](../lib/game/combat-data.ts): bounded common parameters from PlCo; digital shield corresponds to original `lightshield_amount = 1`.
- [lib/game/data.ts](../lib/game/data.ts): fighter shield/jump/snap/throw attributes and `LINE_FLAG_LEDGE` endpoint topology.
- [lib/game/moves.ts](../lib/game/moves.ts): retains whole-body status (opcode 26) and throw definitions (34), alongside existing hitboxes and flag events.
- [lib/game/combat.ts](../lib/game/combat.ts): restricted orchestration based on upstream `ftCo_Guard.c`, `ftCo_Escape.c`, `ftCo_EscapeAir.c`, Catch/Capture/Throw routines, `ftcliffcommon.c` and Cliff routines.
- [lib/game/match.ts](../lib/game/match.ts) and [lib/game/projectiles.ts](../lib/game/projectiles.ts): collision priority, shield interceptions, paired-state cleanup and shared movement integration.
- [web/src/render/defense-visuals.ts](../web/src/render/defense-visuals.ts): supplemental shield geometry, **not** extracted original particles.

The original upstream checkout remains unchanged. No new C function bodies were added in this milestone: the existing 23 unchanged C functions plus RNG remain behind the WASM bridge. The new state orchestration is TypeScript informed by original code/data, not compiled full original defense/grab code.

No server asset names were added. All animation/parameter/audio data comes from the existing 17 allowlisted resources. Simulation, input, rendering and audio continue to run in the browser; the ISO and private directories remain unavailable.

## Explicit limitations

- No analog/light shielding, powershields, shield tilting, shield DI, full IASA/DI/SDI or original throw-escape/collision edge cases. A prototype tech/knockdown layer exists (tumble landings: Passive/PassiveStand rolls and wall tech on a 20-frame L/R/Z window with a 40-frame miss lockout; missed techs bounce into DownBoundU/DownWaitU with stand/roll/attack getups on the original clips), but its frame data and intangibility windows are prototype values, not the original tables.
- The held/thrown victim uses its own capture/downed poses attached to the captor's TransN2 anchor, with flat-floor correction. The original cross-character thrown-animation retargeter is **not** implemented. Mario's spinning back-throw victim pose and other exact contacts are therefore approximate.
- Fox throw lasers are aimed through a restricted pose-based adapter rather than the full original item/gun callback graph. Exact downstream hit sequences are not guaranteed.
- Shield break uses original damage/fall/dizzy clips with shortened state orchestration, not every original break-bounce/getup callback.
- Ledge snap is a bounded static-floor adapter, not full ECB/wall/ceiling geometry or every character-specific recovery eligibility rule. Occupancy is two-player and retained through the getup action. No moving-stage ledges or online edgehog resolution.
- The bot can leave ledges and mash out of capture, but is still a simple practice bot, not original Melee AI.

## Verification

With the real local ISO: **293 unit + 16 local browser + 29 server browser tests = 338 passing**.

The new real-disc unit tests cover shield drain/regen, melee and both projectile blocks, shieldstun/break/jump cancel, dodge windows, directional rolls, air-dodge recovery/landing momentum, grab-vs-shield/dodge, pummel/mashing, all four throws for both slots, native throw damage/laser data, simultaneous grabs, KO/reset cleanup, both ledges, no platform grabs, occupancy/cooldown, all getup options, getup attack damage, slow options and repeatable input runs.

Browser tests use normal keyboard/touch controls and a standard-gamepad input stub—not a mutable match/debug API—to exercise defense, grabs/pummel/throw, real ledge catch and climb. Headless Chromium captures are additionally inspected for shield, dodges, held pair, both fighters' throws and ledge hang. These tests demonstrate the prototype's behavior, not GameCube equivalence.
