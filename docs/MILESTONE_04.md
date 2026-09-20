# Milestone 04: Fox/Mario specials, effects, and original sound

## Implemented move set

| Fighter | Neutral | Side | Up | Down |
| --- | --- | --- | --- | --- |
| Fox | Blaster: original shot speed, shot timing, tap repeats, non-flinching lasers | Illusion: original animation root motion, ghost hit data, startup/end states, shortening | Fire Fox: charge hits, directional aiming, launch speed/decay, helpless fall | Reflector: startup hit, held reflector, release lag, projectile ownership/damage reflection, jump cancel |
| Mario | Original fireball article, gravity, lifetime, floor bounces and collision | Original Cape model, timed reflect window, facing reversal, once-per-airtime boost | Original root-motion Super Jump Punch, steering and multi-hit script, helpless fall | Original Tornado multi-hit script, drift, tap-to-rise window and airtime recharge behavior |

Specials use the original fighter/item parameter blocks and action/animation data. This is the full four-direction move **set for the prototype**, not a claim that every edge case matches Melee's complete engine. Existing limitations such as incomplete wall/ceiling/ECB and ledge behavior still affect recovery and collision outcomes.

## Controls

- Solo: choose **Fox or Mario** with the fighter selector; P1 keys and touch buttons control that fighter.
- P1: A/D move, Space jump, W/S aim, J/K attacks, **L special**. Direction + L selects side/up/down; L alone selects neutral.
- P2 in two-player mode: arrows move/aim, **Enter jump**, N/M attacks, **comma special**.
- W/up-arrow now aim rather than tap-jump, avoiding ambiguous up-special keyboard input.
- Touch controls include separate neutral/side/up/down special buttons and an up-aim button.
- Standard gamepads: bottom/top face button jump, left quick attack, right special, right shoulder strong attack.

The bot has since been replaced by a leveled CPU (1–9) whose level ladder follows the original game's CPU tables on a prototype decision layer; see [docs/CPU_AI.md](CPU_AI.md). It is not Nintendo's original CPU AI.

## Original data and numerical routines

[lib/game/special-data.ts](../lib/game/special-data.ts) reads Fox/Mario special attributes, reflector descriptors, original item hit definitions and models, and effect descriptors. [lib/game/specials.ts](../lib/game/specials.ts) orchestrates the restricted state transitions. [lib/game/projectiles.ts](../lib/game/projectiles.ts) handles bounded projectiles, swept capsule checks, ownership changes, and reflected damage.

Original root translation is sampled from the TransN animation tracks, scaled by the original model scale, and applied through the C movement helpers. The WASM bridge now compiles 23 unchanged source functions plus RNG, including the original root-motion rotation, ascend, drift, gravity, hitlag, and knockback helpers. It is 10,182 bytes for the pinned build. See [web/public/wasm/gameplay.build.json](../web/public/wasm/gameplay.build.json) for function hashes and adapter provenance.

Script handling now retains sound, command-variable, spawn, effect, and hurt-state events as well as attack definitions. Loop extraction is bounded to the animation cycle. The full original script/state runtime is not ported.

## VFX

The viewer now loads the native blaster, laser, Illusion, fireball, and Cape item models plus the native reflector/Fire Fox/Mario effect models. Effect material alpha/color, texture-frame/UV animations, and common rigid billboards are supported through [lib/hsd/material-animation.ts](../lib/hsd/material-animation.ts) and [web/src/render/model-instance.ts](../web/src/render/model-instance.ts).

[web/src/render/play-effects.ts](../web/src/render/play-effects.ts) manages bounded projectile models, attached accessories, auras, and trails. Coins, impact accents, fade timing, and ghost color tints include prototype approximations. [docs/MILESTONE_05.md](MILESTONE_05.md) adds jab chains/downward attacks, a limited native fireball color combiner, supplemental Reflector/fireball halos, and audio-mix polish. The complete HSD particle VM, all TEV graphs, and all original effect callbacks are **not** reproduced. Native geometry/textures do not imply pixel-identical output.

## SFX

Original US main/Fox/Mario SSM banks and the SEM sound-id table are read from the server ISO. [lib/game/audio.ts](../lib/game/audio.ts) decodes Nintendo DSP ADPCM locally, preserving channel offsets, coefficients, histories, and loop information. [web/src/play-audio.ts](../web/src/play-audio.ts) plays those PCM samples through a bounded Web Audio mixer; the former oscillator placeholders have been removed.

Move-script sound IDs and the original collision sound-kind table drive cues. Voice count, decode sizes, and caches are bounded. Sound loops stop on scope changes; mute, pause/resume, and rematch stop or suspend the appropriate sources. Audio creation/resumption follows the user's Start/Resume gesture.

Nine reference selections were decoded using a separately built vgmstream CLI and compared against the browser decoder: all checked PCM samples matched exactly after fixing the SSM nibble-endpoint remainder case. The browser mixer's SEM automation, pitch/panning details, aux effects/reverb and voice arbitration remain a subset of the original AX system. Music/announcer banks are not included.

Research/reference credit and license are in [third_party/NOTICE.md](../third_party/NOTICE.md) and [third_party/vgmstream.LICENSE](../third_party/vgmstream.LICENSE).

## Server/privacy

The server allowlist is now 17 resources: the original ten viewer inputs, common gameplay data, two character effect archives, and four US audio resources. The ISO, unrelated character/audio files, executable, and private directories remain unavailable. The browser still performs simulation/rendering/audio; no per-frame server requests are needed after loading. This remains a trusted-LAN service without authentication.

## Verification and remaining scope

Unit checks cover original parameters, all eight specials, laser non-flinch, repeated blaster taps, Illusion shortening, Fire Fox aiming, reflector/Cape return hits and damage multipliers, Cape reversal, Shine jump cancel, Tornado height gain, original effect model loading, DSP/SSM/SEM bounds, and swept geometry. Browser checks exercise special inputs, original SFX playback, solo Mario selection, touch controls, and restricted audio/effect endpoints.

Original-engine equivalence has not been proven. Precise collision/state edge cases, full material/particle behavior, full AX mixing, defensive/ledge mechanics, and online play remain future work. Do not describe this as a complete Melee port.
