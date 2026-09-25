# Competitive movement: implementation and validation scope

This is a source-port research prototype, not the complete Melee engine. Passing these tests demonstrates prototype behavior, not numerical equivalence to GameCube hardware or Dolphin.

## Implemented behavior

- Dash entry: Wait, Walk, SquatWait and attack IASAs dash only on a fresh flick (`ftCo_Dash_CheckInput`: |x| ≥ PlCo x3C within x40 frames of crossing the smash deadzone). A held stick walks.
- Dash dancing: a fresh reverse flick enters **Turn**, preserving facing for that entry frame. On the next simulation frame, facing flips; holding the reverse direction starts a new Dash with carried momentum, while releasing to neutral leaves a **pivot**. The input must reach the native dash threshold before the exclusive **PlCo x40** stick-age deadline. Initial Dash also obeys the **x44** reverse lockout; a dash entered from Turn does not reapply that lockout. A fresh reverse flick from standing, walking, crouching or an attack's interrupt window also smash-turns first (`ftCo_Dash_CheckInput` → `ftCo_Turn_Enter_Smash`), so that dash is lockout-free too. A stale, already-held reverse stick keeps the prototype's direct reverse dash. Returning to neutral rearms the input timer. Run instead reverses via TurnRun.
- Body yaw through turns: `Fighter_ChangeMotionState` is the only common writer of TopN's yaw (π/2·facing). The model and its joint-attached hurtboxes keep the facing that Turn or TurnRun began with, while the clip spins the body 180°. A pivot or run turnaround therefore rotates continuously instead of popping when `facing_dir` flips mid-motion.
- Locomotion action sets: each motion accepts only what its original IASA checks (`runPhaseGate` in [lib/game/locomotion.ts](../lib/game/locomotion.ts)). Dash, Run, Turn and TurnRun never crouch or drop through platforms (`ftCo_800D5FB0` is absent there), so a held down waits for the Dash clip to end and squats on that frame. A in Dash/Run is always the dash attack, whatever the stick. The first x44 Dash frames only take side-B, grab, a forward smash (A with the stick forward, or a fresh C-stick, which turns the fighter when pointed back) and a shield roll forward until x48. Up to x4C they take side-B, the dash attack and guard. Run takes every special. RunBrake only takes jump, turnaround and crouch; TurnRun only takes jump. Crouching follows ftCo_Squat/SquatWait/SquatRv_IASA: the crouch-down clip plays out (no dash, walk or stand-up); SquatWait dashes only on a fresh flick and otherwise stands up; standing up only walks. SquatWait and SquatRv take down/up-B but no grab.
- Pivot actions: a jab, smash, jump, standing grab or shield can act on the facing-flip frame. The Turn animation does not loop or flip facing twice. Hitlag freezes the pending flip. Missing Turn clips retain an explicitly non-pivoting direct reverse-dash fallback.
- Short hop: release jump during jump squat; holding jump produces the character's full hop. Stick tap-jump release is also covered.
- Fast fall: fresh down input during descent, including eligible aerial attacks; not during air dodge.
- Aerials: directional move selection, native move data, script-driven hitboxes, and landing lag.
- L-cancel: eligible fresh shield/grab input divides aerial landing lag using the common-data window/divisor. Script command 0 supplies autocancel windows. Custom aerials without that command retain their aerial lag.
- Wavedash-like movement: jump, air dodge diagonally downward, land with retained horizontal momentum, and slide through ten frames of action lockout.

## Native-source comparison and change

`third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Dash.c`, `ftCo_Dash_CheckInput`, checks both stick magnitude and `x670_timer_lstick_tilt_x < dash_smash_window`. Previously the prototype's reverse-dash branch checked only magnitude. `lib/game/data.ts` now reads the separate dash window from PlCo x40, and `lib/game/match.ts` applies it to reverse-dash eligibility using the existing snapshotted stick history.

The subsequent pivot implementation follows `third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Turn.c`: `ftCo_Turn_Enter_Smash` retains facing, the next `ftCo_Turn_Anim_Inner` flips it, and `ftCo_Turn_IASA` can enter Dash only on `just_turned`. The adapter represents this as idle/Turn (standing attacks/grabs), uses the existing animation/state frame for the pending flip, and stores `dashFromTurn` in the snapshotted fighter state for the Dash entry-mode distinction. Turn loads as an optional original animation. Dash entry consumes the shared tilt timer on the Turn follow-up.

The reverse transition also applies Dash IASA's **PlCo x54** velocity reduction, followed by the selected original standing-friction routine. Surface friction multipliers remain fixed at 1 in this subset; this is not icy/special-surface equivalence.

This remains a bounded adapter implementation, not a complete Dash/Turn port. No upstream source or generated original C function text is modified.

## Automated evidence

- `tests/unit/run-brake-real.test.ts`: native dash/run scripts and velocities; reverse flick immediately before/at/after the exclusive window; initial-dash versus Turn-follow-up eligibility; neutral rearming; four-character pivots in both directions; standing smash-turn entry and its stale-stick fallback; four-character continuous body yaw through pivots and run turns; standing pivot actions; Turn entry friction and carried momentum; pending-turn and redash rollback; hitlag; missing-clip fallback; run braking/turning; and edge stopping.
- `tests/unit/wavedash-real.test.ts`: actual jump-button input from the ground through short-hop takeoff and downward air dodge; Fox, Luigi, Mario and Marth; normalized initial dodge speed; retained landing momentum; exactly ten landing frames with attempted actions blocked; shallow versus steep travel in both directions; deterministic rollback replay.
- `tests/unit/aerial-landing-real.test.ts`: short/full hop, aerial landing lag, autocancel, L-cancel success/failure, and Fox drill follow-up timing.
- `tests/unit/gameplay-real.test.ts`, `tests/unit/tap-jump-real.test.ts`, `tests/unit/link-completion-real.test.ts`, and `tests/unit/combat-real.test.ts`: additional movement, landing-window, aerial, and air-dodge coverage.

These suites require `MELEE_DISC_PATH` pointing to a locally owned compatible disc. Without it, the real-disc cases are skipped, not verified. Tests exercise the current local match engine; they do not establish deployed-server version parity or WAN/controller latency.

## Remaining parity gaps

1. **Full Turn behavior:** smash-turn pivots now have the native-source transition shape, but slow standing turns (a held reverse stick without a fresh flick turns instantly and walks), delayed-turn button storage, every simultaneous-input priority, and exact native collision callbacks are not ported. A source-derived test is not an independent GameCube timing trace.
2. **Full Dash IASA:** the reverse-input x44 lockout and Turn entry-mode distinction are implemented. The full x44/x48/x4C attack/item/shield priority branches, initial-dash consumed-timer handling, standing dash/turn transitions, and forward re-dash rules are not fully reproduced.
3. **Distance oracle:** angle tests assert normalized initial speed and relative prototype travel, not exact Melee wavedash distances. A pinned reference trace is still needed for per-character travel, friction, collision geometry, earliest landing timing, slopes, platform edges and wavelands.
4. **Roster coverage:** four-character end-to-end wavedash coverage is not all-character parity. Fighters without the original locomotion clips retain fallback movement; custom fighters can use supplemental prototype behavior.

## Reference-distance validation prerequisite

The local setup has a matching native reference build and a Dolphin executable, but no paired movement movie/state trace was found. Dolphin's command-line movie playback alone does not produce the per-frame fighter-state oracle needed here. Do not substitute a prototype-generated trace for that independent reference.

A reproducible comparison needs a private native capture with:

- USA v1.02 identity and emulator version/settings (or hardware capture provenance), character/costume, stage and starting state;
- exact per-frame stick values, button edges and jump/dodge timing;
- per-frame position, self/ground velocity, facing, action ID, animation frame, grounded flag and landing frame;
- Fox/Luigi/Mario/Marth, mirrored directions, at least shallow and diagonal angles, with the same initial conditions in the prototype.

Compare the first divergent frame before comparing final distance: a collision-frame offset must not be hidden with a positional tolerance or a fitted friction constant. Keep native captures, movies, savestates and private reports in ignored private storage, never in the web root or a commit.

Do not describe this as tournament-accurate movement until those differences have been implemented and independently checked.
