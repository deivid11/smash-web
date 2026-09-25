# Ledge-grab investigation

## Confirmed problems corrected

The real-disc regression suite reproduced 14 failing cases out of 15 before the fixes in this pass. These are prototype corrections based on pinned native source, not a complete ECB/collision port.

| Area | Previous behavior | Correction |
| --- | --- | --- |
| C-stick on a ledge | Every direction became Strong/attack; away/down could not release, toward could not roll. The synthesized attack vector also replaced the actual left stick. | Feed original sticks to ledge callbacks. C-up attacks, C-toward rolls, C-away/down releases after neutral rearming. Consume release input so it cannot also start an aerial/item throw that frame. |
| Diagonal release | Toward-stage X won over a strong downward Y and climbed. | Use the native angle sectors (`atan2(y, abs(x))`, PlCo x20), mirrored at both edges. |
| Buttons | B was ignored; jump took priority over attack and shield. | A/B/Strong attack, then shield/roll, then jump, then climb/drop, following CliffWait's native callback order (Strong remains a prototype button mapping). |
| Tap-up | A fresh upward flick climbed rather than ledge-jumping. | Use native tap-jump threshold/window x70/x74 and existing snapshotted stick history. Soft/aged up can still climb. |
| Motion eligibility | Checked self velocity only, allowing a grab while total movement rose, or rejecting one while total movement fell. | Require actual current Y < frame-start Y, as the native ledge-enabled air collision pass does. |
| Horizontal reach | Checked only the final X, missing fast motion that crossed out of the eligible region. | Sweep the prototype snap envelope between old/new X, as well as old/new Y. |
| Facing/side | Ordinary fall could grab backward, and allowed a small inside-stage tolerance. | Ordinary aerial movement must face the edge; the prototype floor-contact origin must remain outside and below it. Special callbacks retain their existing separate subset policy. |

## Behavior that is intentional

- No ordinary ledge catch while ascending or stationary vertically, holding down at/beyond the native rejection threshold, using an aerial/air dodge, or while the ledge is occupied.
- A ledge release starts the original common-data regrab cooldown (30 frames in USA v1.02).
- CliffCatch must finish before CliffWait accepts options. Buttons pressed too early are not generally buffered.
- Stick climb/drop needs a neutral rearm **during CliffWait**. Holding toward/away through the entire catch does not immediately choose an option. A held C-stick does not count as neutral either.
- Normal falling grabs require facing toward the ledge. Some recovery callbacks allow both sides; that is not permission for every state to grab backward.
- At 100% and above, the original slow ledge-option animations are selected.

## Source and implementation

- `third_party/melee/src/melee/mp/mpcoll.c`: actual-descent check and facing mask in the ledge-enabled air solver; `mpColl_80044164` / `mpColl_800443C4` sweep both axes and include native ECB geometry.
- `third_party/melee/src/melee/ft/ftcliffcommon.c`: down rejection, occupancy, catch entry and pose anchoring.
- `third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_CliffWait.c`: action priority and neutral-rearm initialization.
- `third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_CliffClimb.c`: stick sectors, climb versus release, rearming.
- `third_party/melee/src/melee/ft/ft_0DF1.c`: C-up attack / C-toward roll thresholds and edges.
- `third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Jump.c`: tap-jump threshold/window.
- Adapter code: `lib/game/combat.ts`, `lib/game/combat-data.ts`, `lib/game/match.ts`.
- Regression coverage: `tests/unit/ledge-regressions-real.test.ts`, plus existing defense/ledge and stage suites. Real-disc cases require `MELEE_DISC_PATH`; skipped cases are not verified.

## Remaining risks — not certified native parity

1. **Animated ECB geometry:** the prototype uses its floor-contact origin and parsed snap extents, not native animated ECB left/right/bottom points. Native horizontal reach includes a body-side offset missing here. This can still make a visually close recovery miss.
2. **Occlusion and collision ordering:** native ledge queries include stage-line/joint visibility checks. The prototype integrates walls/floors first and then tests the snap region. Sloped lips, underside corners, joint stitching and moving surfaces require individual reproductions; the sweep correction is not a full collision-solver replacement.
3. **Special-specific eligibility:** most specials still use a generic up/side eligibility fallback; a few have dedicated policies. Native phase and facing rules vary (for example Fox's Fire Fox charge checks facing, while flight/fall can check both sides). Those callbacks need a separate character-by-character audit; this pass deliberately does not apply normal-fall facing restrictions to all recoveries.
4. **Full ledge action fidelity:** general landing/ledge cleanup, occupancy across connected line IDs, intangibility and action-end collision callbacks remain adapter code. The native timeout falls into DamageFall; the prototype still uses ordinary Fall. C-toward roll assumes the ordinary match mode, not every native special-mode restriction.

No upstream source, original-function provenance text, assets, reference captures or deployment are changed by this investigation.
