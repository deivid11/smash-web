# Milestone 05: jab chains, downward attacks, effect/audio polish

## Controls and move coverage

- Repeated **QUICK** presses (P1 J / P2 N): Mario's `Attack11 → Attack12 → Attack13`; Fox's `Attack11 → Attack12 → Attack100Start → Attack100Loop → Attack100End` when tapping sufficiently often. Holding QUICK alone does not auto-combo. Keep tapping to sustain Fox's rapid kicks.
- **Down + QUICK**: original `AttackLw3` on the ground, `AttackAirLw` in the air.
- **Down + STRONG** (P1 S+K / P2 down-arrow+M): original `AttackLw4`; in the air it also selects `AttackAirLw`.
- Hold down on solid ground for `Squat/SquatWait`; release for `SquatRv`. Existing platform drops and fast-fall remain available. Simultaneous down+attack takes priority over dropping.
- Down aerials use their original multihit scripts, `LandingAirLw`, and down-aerial landing-lag attribute, rather than neutral-aerial landing data.

[lib/game/jab.ts](../lib/game/jab.ts) adapts the restricted flow in upstream `ftCo_Attack1.c` and `ftCo_Attack100.c`. [lib/game/moves.ts](../lib/game/moves.ts) retains action opcodes 29/30 and the rapid-loop check flags. Original attributes supply Fox's 30-frame second-jab window and four press/release-edge rapid threshold; Mario uses 24-frame second/third-jab windows. A jab-local queue retains presses through hitlag, advances only on unfrozen ticks, and clears when interrupted or leaving the allowed state. This is not a general original-engine input buffer or a guarantee all three hits will connect.

Animations, hit definitions and sound cues are loaded from the existing allowlisted archives. No new server resources, per-frame HTTP calls, or upstream source edits were necessary.

## Effects

The original Mario fireball contains a custom TObj TEV color interpolation between orange registers. The previous renderer ignored it. The bounded ADD/SUB implementation in [web/src/render/texture-tev.ts](../web/src/render/texture-tev.ts) now evaluates it, including animated constant/register channels. It is enabled for article/effect instances only: the stage/fighter material pipelines still lack the other graph operations needed to enable it globally without visual regressions.

Final-composite fading now happens **after** texture alpha combination, so texture replacement/blending cannot bypass effect fades. Low-alpha edges are no longer discarded at an arbitrary 3.5% cutoff. The fireball's arbitrary whole-model spin was removed; its native animation remains.

[web/src/render/effect-halo.ts](../web/src/render/effect-halo.ts) adds explicitly **supplemental**, simulation-timed accents: a cyan/blue hexagonal Reflector rim, reflect-hit flash, and a subtle warm fireball halo. Native models remain underneath. These bounded quads are not extracted particles and do not alter collision geometry. Reflector placement/radius follow its original reflector descriptor. Native Reflector opacity is reduced rather than uniformly tinting all of its materials blue.

This is still not a complete HSD particle, TEV, lighting, or billboard implementation; screenshot similarity is not proof of original-engine equivalence.

## Audio evidence and changes

- A real pre-change browser Reflector/normal-play probe measured peak absolute output **0.2741**, with **no samples above 1** in the sampled analyser windows. Ordinary clipping was **not** established as the cause of the perceived quality issue.
- Original Fox blaster/Reflector samples examined here are **16 kHz**; Mario fireball/bounce samples are **32 kHz**. Other bank samples are 8 kHz. The source bandwidth and DSP-ADPCM encoding cannot be restored by increasing a browser output rate.
- Nine native vgmstream PCM comparisons were rerun: **zero mismatches**. The decoder and original sample data remain unchanged.
- [web/src/audio-mix.ts](../web/src/audio-mix.ts) adds headroom compression for crowded mixes, not a full AX mixer or a guaranteed hard limiter. An offline Chromium test compares 24 coherent full-level test voices against the old gain-only graph and requires the protected output peak to stay below 1.
- [web/src/play-audio.ts](../web/src/play-audio.ts) uses 1 ms onset/3 ms ending ramps, 5 ms forced-stop tails, and script panning. Mono center loudness is preserved when introducing equal-power panning. Active voices remain capped at 24, with at most eight short release tails; reset/scope changes are tested for cleanup.

No claim of HD reconstruction, full SEM automation, original AX resampling/reverb, or perceptually identical mixing is made. Music/announcer banks remain out of scope.

## Verification

With the real local ISO: **258 unit tests + 16 local browser tests + 23 server browser tests = 297 passing**. Coverage includes queued/late/held/interrupted jab inputs, Fox rapid-loop exit, Mario's third jab, downward move selection, original down-air multihits/landing, crouch, effect lifetime/reset, original fireball TEV descriptors, offline audio headroom, and bounded loop cleanup.

New input browser tests use a controlled clock to avoid missing short animation windows on a loaded machine. The pre-existing Tornado tap test now does likewise. LAN deployment and screenshots are additionally checked through normal browser controls.

Unported details include general directional attacks beyond this set, smash charging, full IASA/autocancel/L-cancel behavior, crouch-cancel damage modifiers, defensive/ledge mechanics, complete collision/state behavior, and online play. *(Later milestones ported several of these; grounded-normal interrupt frames are covered in [IASA.md](IASA.md).)*
