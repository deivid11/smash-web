# Camera range, off-screen magnifier and crowd

Three pieces of the original versus-match presentation, ported from the decompilation in
`third_party/melee/src/melee`. The camera and magnifier are presentation only. The crowd is
simulation state (it lives in match snapshots and the state hash) that only emits sound events.

## Stage camera range

- **Data.** `parseStageGameplay` in [lib/game/data.ts](../lib/game/data.ts) reads the camera range the same way `Ground_801C39C0` does:
  - The range comes from map points `0x95`/`0x96`, relative to the `0x94` origin; `Stage_GetCamBounds*Offset` adds the origin back, so the absolute corners are stored.
  - Stages without those points use the original "dummy CamRange" fallback (±170, −60…120), exported as `STAGE_CAMERA_DEFAULT`. Among the supported stages this only applies to Pokémon Stadium.
  - Final Destination's range is x ±170, y −80…114, and its blast zone is ±246 / −140…188.
- **Framing.** The classic shot in [web/src/render/play-renderer.ts](../web/src/render/play-renderer.ts) now follows the original rules:
  - **Clamping (`Camera_8002958C`).** Each fighter's framing point is clamped to the range, so a launched fighter drags the shot only as far as the range edge.
  - **Confining (`Camera_8002A768`).** The shot is then shifted so none of its frustum corners on the z=0 plane shows past the range. When the view is wider or taller than the range, it is centred on the range. This is translation only; the zoom is not changed.
  - **Crowded and focus shots (5–8 players).** These clamp the fighter points but keep their own fitting.
  - **Star KO exception.** While a Star KO is climbing, its sky points skip both steps so the star stays in the shot.
  - The pure helpers are `clampToCameraBounds` and `confineCameraTarget` in [web/src/render/camera-framing.ts](../web/src/render/camera-framing.ts).
- **Not ported.** The original camera's own zoom/tracking model is not ported: the subject box extents, `cam_track_ratio`, the per-stage FOV/tilt/pan and its smoothing. The prototype's fit-and-ease is kept inside the range.

## Off-screen magnifier (ifMagnify)

Implemented in [web/src/render/magnify.ts](../web/src/render/magnify.ts) (pure math, unit-tested) and drawn by [web/src/render/magnifier.ts](../web/src/render/magnifier.ts):

- **When a bubble appears (`ftLib_80086A8C`, `Camera_80030BBC`).** A fighter is off-screen when its camera bone projects outside the canvas. The camera bone is `co_attrs x16C`, offset by `x170`, in joint space. Fighters that are KO'd, respawning, swallowed or in a Star KO get no bubble, and neither does anyone while the match is paused.
- **5–8 players.** The player-focus shot for 5–8 players leaves distant rivals out of frame on purpose, so it only shows a bubble for the followed fighter; the original never had more than four fighters. Classic and crowded shots show one for everyone off-screen.
- **Placement (`ifMagnify_802FB73C`/`802FB8C0`).**
  - A ray from the screen centre towards the fighter is clipped to the ±252.7 × ±162.7 rectangle of 640×480. It is then scaled by the IfAll HUD camera (perspective, fov 41.539°, aspect 1.2167, eye z 64), which puts the lupe about 70/79 original pixels in from the edges.
  - The arrow is rotated by `atan2` towards the fighter.
  - Wide screens keep the 67.3-pixel side inset instead of stretching the rectangle.
  - The rectangle is laid out between our top bar and bottom HUD cards, so a bottom bubble is not hidden under a card. With no insets it is exactly the original rectangle.
- **Lens.** An orthographic camera, centred on the camera bone and looking down −z from 300 units, renders only that fighter's model into a render target.
  - Half extent: 0.1 × 64 texels × (camera-box `x14` × model scale) / 8, from `ftData x3C` via `ftLib_80086B80`.
  - Background: the stage's 3×3 `grGroundParam xB8…xD8` colour grid, bilinearly blended by where the fighter sits in the camera range (`ifMagnify_802FBBDC` + `ifMagnify_803F984C`). On Final Destination this is navy `0c0628`.
- **Lupe.** It is rebuilt from `IfAll.dat` "lupe" geometry probed on the USA v1.02 disc: ring 2.772–3.33 HUD units, texture disc 2.772 (UVs spanning its diameter), arrow tip 5.732 and base 3.854 ± 0.646. `IfAll.dat` itself is not a served asset. The texture renders at the display's pixel size instead of the original 64×64.
- **Colours.** Humans use their seat colour. CPU seats use grey, like `gm_80160968`'s CPU slot colour (lifted to match our HUD palette).
- **Not ported.**
  - The side-edge player indicator (`un_802FD928`, which moves a human's tag next to a left/right bubble).
  - Custom (non-disc) fighters drawn through their own skin path show an empty lens.
  - A fighter hidden by the invulnerability blink is missing from the lens on the frames it is hidden, as in the main view.

## Crowd (crowdsfx.c)

[lib/game/crowd.ts](../lib/game/crowd.ts) ports `sfx/crowdsfx.c` together with the fighter-side calls that feed it. It uses the disc's `gCrowdConfig` (PlCo `ftLoadCommonData[21]`: knockback tiers 100/130/160, a ×0.8 multiplier for 75°–115° launches, a 60-frame follow-up window, 100% for a chant, a 1200-frame quiet period, 9 chant repeats and a 15-unit edge margin).

- **Knockback memory (`ftCo_Damage` → `un_803222EC` + `un_8032233C`).** Every launch stores the victim's magnitude. The frame step in `Fighter_procUpdate` keeps it only while the victim is in hitstun or near the floor extents' edges (`mpLib_80458868[1]`).
- **Launch reactions.**
  - A launch plays the reaction for its tier: 0x144, 0x145 or 0x146.
  - A follow-up from the same attacker within 60 frames, or a hit from an attacker who is flying from a launch themselves, plays a cheer instead: 0x140, 0x141 or 0x142.
  - A tier 2+ cheer can start a chant (`un_80321EBC`) if the attacker is human, at 100% or more, the crowd has been quiet for 1200 frames, and the attacker is not already being chanted. The crowd cheers, repeats the attacker's `FtSFX x34` chant up to 8 times, then closes with 0x140.
  - A strong hit on the chanted fighter, or a Zelda/Sheik Transform (`un_80322314`), interrupts the chant.
- **Gasps (0x13D–0x13F).**
  - Landing near an edge while still carrying a launch (`un_803224DC`).
  - Entering a helpless fall less than 80 units below the lowest floor, graded by depth (`un_80322598`).
  - Three or more fighters more than 30 units below the lowest floor (`un_80321AF4`).
- **Fall warning.** SFX 96 plays once per descent past half-way between the camera bottom and the bottom blast line (`Stage_CalcUnkCamY`), and re-arms above `Stage_CalcUnkCamYBounds` (fighter.c).
- **Voices.**
  - The original uses AX channel 5 for the chant (`lbAudioAx_800240B4`) and channel 6 for reactions (`lbAudioAx_8002411C`). Sound events carry `channel`, and [web/src/play-audio.ts](../web/src/play-audio.ts) cuts the previous voice on that channel. A `540000` event only silences it.
  - "Still playing?" (`lbAudioAx_80023710`) is answered from the SSM sample length in frames (`GameSoundLibrary.durationFrames`), so rollback and every peer agree on when a chant ends.
  - All crowd samples live in `main.ssm` (216 gasp, 217/218 cheers). Chants use each fighter's own bank.
- **Not ported or approximated.**
  - The bonus/record counters the original updates alongside (`pl_8003FDA0`, `pl_8003FDC8`).
  - The crowd runs in every match mode here, where the original only starts it in VS mode (`gmvs.c`).
  - Ice Climbers' alternate chant for costumes 2+ assumes our costume index matches the original costume id.

## Tests

- [tests/unit/magnify.test.ts](../tests/unit/magnify.test.ts): edge clipping, placement, HUD insets, lens extent, colour blend, and camera clamp/confine checked against a real three.js camera.
- [tests/unit/crowd.test.ts](../tests/unit/crowd.test.ts): tiers, the angle multiplier, follow-up cheers, the chant cycle, the CPU/percent gates, edge/helpless/pile-up gasps, the fall warning, and replay from a cloned state.
- [tests/unit/offscreen-crowd-real.test.ts](../tests/unit/offscreen-crowd-real.test.ts) (needs `MELEE_DISC_PATH`): Final Destination's camera points and colours, the PlCo crowd config, Mario's camera box and chant, SSM durations, a real forward-smash crowd reaction on channel 6, and snapshot/restore hash equality with the crowd state.
