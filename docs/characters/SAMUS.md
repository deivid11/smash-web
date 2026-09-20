# Samus: original assets, limited playable prototype

Back to [character guides](README.md) and [original ISO procedure](ORIGINAL_ISO.md).

Samus is registered as `Ss`, native `FTKIND_SAMUS = 13`, selector index **4** (existing indices remain stable). This is a **limited playable character**, not a complete Samus engine port. The selector explicitly discloses missing tether/bomb-jump mechanics. Online selection and snapshot resources are wired in; that alone does not establish multi-browser or GameCube equivalence.

## Resources and provenance

Only `PlSs.dat`, `PlSsAJ.dat`, `PlSsNr.dat`, `EfSsData.dat`, and `audio/us/samus.ssm` were added to the exact asset allowlist. Original bytes remain on the privately held USA v1.02 ISO, outside the static build. Other costumes, Kirby's Samus copy archive, arbitrary disc files and the executable remain inaccessible. No upstream files or original C function text were modified by this import.

The neutral model has **60 joints** and 106 meshes. The common table is read at native index 13; model/animation bone counts remain validated. `Wait1` is an engine alias for Samus action **2**, whose original figatree is named `Wait`. Bomb-drop actions are **261/262**, not the earlier 247/248 bomb-jump states with identical animation names. Smash-missile actions **256/258** use the unusual original names `Special`/`SpecialAir`.

`samus-data.ts` reads `ftSs_DatAttrs` with the correct float/integer layout. `ftSs_Init_OnLoad` maps articles 0/1/2 to bomb/charge/missile. Charge shot uses item state **level + 1**, not the harmless held state. Eight distinct original hit definitions deal **3/5/8/11/14/18/21/25** damage. Original-model rendering still approximates reflection/TEV/material lighting.

## Implemented scope

- Own movement attributes, two-hit jab, dash attack, tilts, smashes, five aerials, aerial landing lags, shield/dodges, ledge actions, KO and respawn.
- **Charge Shot:** grounded start → automatic charging; press special again to fire, shield to store, or reach full charge and store automatically. One charge level every 17 hold ticks (`x20 = 16`, strict `>`), seven levels maximum. In air, start goes directly to firing. Charge affects the original item-state hitbox, speed and visual scale. Stored charge is cleared on KO and by the installed special damage callback. The HUD shows stored charge.
  - `ftSs_SpecialNHold_IASA` runs `ftCo_8009917C` before B and before shield: a sideways stick tilt that is still fresh (`x670` under `ftCommonData x320 = 4`, past `x31C = 0.7`), or a C-stick deflected past the same threshold (`ftCo_800DF8B0`, no freshness window), rolls straight out of the charge, and Samus's roll is her Morph Ball. All three exits keep the stored level.
  - The charging orb is the same article in **item state 0** (`it_802B55C8`), presentation-only on `FtPart_RHandNb` with the script's `cmd0`, scaled over the fired levels' own `x18..x1C` ramp as `itSamuschargeshot_UnkMotion0_Anim` does. `SpecialNCancel` destroys it (`ftSs_SpecialN_801291A8`), so a stored charge shows nothing until she charges again. Kirby's copy draws the same orb from Samus's articles.
  - The hold script's `cmd2` re-cues the original five charge-loop sounds (`ftSs_Unk3_803CE6B8`) at the level reached so far.
  - **Added, not in the original:** a full stored charge keeps a small breathing pulse of the held orb on the cannon. Melee flashes her body once as the charge fills (`ftCo_800BFFD0` colanim 53, not ported) and then shows nothing, so a loaded shot was invisible; the pulse stays well under the level-1 charging orb so the two never read alike.
- **Missiles:** quick horizontal stick + special selects the super variant using the three-frame parameter; hold direction first for the homing variant. Own spawn joint, ground/air clips, script release flags, speeds, acceleration, lifespan and turn bounds. Target selection is an explicit prototype approximation: nearest live opponent ahead, stable slot tie-break. Wall/ceiling collision, native target-selection policy, missile clanks and explosion presentation are not ported.
- **Screw Attack:** distinct ground root-motion and aerial 2.5 initial impulse; one early reversal; own multi-hit scripts/intangibility; ends helpless with 24-frame landing lag. The shared horizontal-floor/ledge solver is still prototype code.
  - The electric screw is the original effect: `ftSs_SpecialHi_Enter` spawns `efSync_Spawn(1154)`, which `efAlt` resolves to model kind `0x7D0` = `effSamusDataTable` entry **0**, held at `FtPart_YRotN`'s world position with the fighter's scale and facing (`efLib_Cb_SetScaleRotY_FromFighter`) until the move ends. Entries 0-2 of that table are genuine model descriptors; the rest of the bank is particle generators. Its additive core is drawn at half opacity because the TEV approximation would otherwise hide her inside it.
  - `efLib_Create_Attach` hangs an `lb_8000C1C0` position constraint on the effect's own root joint, so that joint *is* the attach joint's world position; the model's baked root lift (0, 7.72, 0) never applies. The renderer re-anchors joint 0 onto the attach point after posing — adding the lift instead leaves the screw floating over her head. Samus's article models are all anchored at their own origin and need no such correction.
- **Bomb:** own animation/script spawn flag; ground/air hop/drift parameters; timed falling article, horizontal-floor settling, contact/fuse explosion, original blast radius changes (frames 12/15), hit clear at frame 18 and removal at frame 28. Morph Ball uses script-selected transition alternative 1 and ball alternative 2 and the native ungrabbable radius-3 capsule on part 2 while `cmd0` is active.

## Explicit omissions

- **Tether grab, throws initiated by Samus, aerial grapple and tether recovery are disabled.** Catch scripts refer to an external grapple-article bone; the loader does not bypass bone validation or substitute another fighter's grab. Samus can still be grabbed/thrown by others. `canGrab: false` guards normal and shield-grab entry.
- Bomb self-jump, walljump, crouch-start bomb shortcut/cancel windows, moving-item collisions, full item clanks, slopes/walls/ceilings and native bomb collision bounce solver.
- Samus particle generators (including the full-charge sparkles `efSync_Spawn(0x480/0x481)` on a flying max shot), the full-charge body flash (`ftCo_800BFFD0` colanim 53) and missile exhaust/explosions. Only the three model descriptors of the effect archive are used; its particle descriptors are **not** falsely parsed as model descriptors. Item models and script SFX are original; no claim of full particle/TEV/AX equivalence.
- Kirby's Samus copy, alternate costumes and the full GameCube state machine.

## State and validation

`samusCharge` and `samusSideTicks` belong to `MatchFighter`. Charge clocks/variant flags belong to `SpecialRuntime`; missile turn and bomb explosion state belong to `Projectile`. All are captured/restored with match state. Stable `Ss/samus/...` article keys rebind to immutable resources after restore, including the bomb explosion and charged levels. Presentation does not mutate authoritative poses.

- `tests/unit/samus-real.test.ts`: 19 cases covering original profile/actions/articles/audio, scripted body variants, charge/cancel/fire, the held-orb article and Screw Attack effect model, the charge-loop cues and the Morph Ball roll out of a charge, missiles, ground/air recovery, bombs, mirrors, snapshot/restore and KO reset, plus delayed-input rollback with two/four simulated peers and exactly-once confirmed events. Real-data cases require `MELEE_DISC_PATH`.
- `tests/server-browser/samus.spec.ts`: selection/portrait/HUD, mirrors and switching back, all four directional specials, charge storage, the charging orb rendering without a render failure and the roll out of a charge, no per-frame asset requests, exact allowlist and forbidden-file responses.

The isolated real-ISO Samus suite passed **16/16**; together with the shared action/core regressions, **44/44** passed. The subsequent whole-project run was blocked by concurrent Pikachu loading and UI test changes. A full build was attempted but stopped on concurrently edited browser-test type errors. Browser runs are pending the coordinated UI/QA candidate; **no browser-render or multi-browser pass is claimed yet**. Do not treat registration or skipped ISO tests as online validation. Deploy the frontend and updated asset/room server together only after staged validation; this import does not restart the live service automatically.
