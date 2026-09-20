# Ness (Ns)

Imported 2026-09-14. Selector 13, native FTKIND 8, announcer cue `0x7C84A` (gm_80168C5C CKIND_NESS=11).
Assets: `PlNs.dat`, `PlNsNr.dat`, `PlNsAJ.dat`, `EfNsData.dat`, `audio/us/ness.ssm`. 63-joint skeleton.
Ness names its idle `Wait` and crouch `SquatWait1`; the engine keys map both. ftNessAttributes is fully
named by the decomp (third_party/melee/src/melee/ft/kinds/ftNess/types.h); offsets are copied verbatim.

## Specials

- **PK Flash (SpecialN)** — `lib/game/ness.ts` + `lib/game/ness-projectiles.ts`, itnesspkflash.c.
  The ball launches up (rise 1.2 tilted 3°), charges 1/frame to 100, drifts on the owner's stick
  (0.01 accel, ±2 cap), falls at its own x1C gravity (0.02, max 2), and detonates on release, timeout
  or floor contact. The explosion damage is charge·0.35+1 (max 36) with the charge-scaled radius.
  Fighter side: Start → Hold0 loop → Hold1 (30+25 loop frames) → NEnd; aerial release is freefall
  with 30 frames of landing lag.
- **PK Fire (SpecialS)** — itnesspkfire.c. The bolt flies straight (ground −3.6°·2.0, air −38°·2.5,
  spawn 3.2/1.1 from Ness), lives 20 frames, and turns into the stationary 100-frame multihit pillar
  on any fighter/shield/floor contact. The bolt leaves the FtPart_R2ndNa joint, so its height follows
  the pose rather than a fixed offset. The pillar follows its own state script (PlNs.dat x3F1C): one
  3% strike, nine idle frames, then a 2% hit every eight frames over a 100-frame life, shrinking from
  full scale to the article's 0.5 minimum. Aerial PK Fire lands with 30 frames of lag.
- **PK Thunder (SpecialHi)** — itnesspkthunderball.c + ftnessspecialhi.c. The head flies at speed 2,
  steering 6°/frame toward the stick past 0.5 deflection with the native 45° proportional law, lives
  120 frames and dies on stage lines or enemy contact. Six lagged copies of the PKThunder1 trail
  article ride positions[i·2] of the head's own position ring, so it draws as the original comet.
  Ness floats in the Hold loop (gravity delayed 30 frames, then 0.017). Self-contact uses the native
  `thunderColl` machine, not a hitbox sweep: an 8.33 × 12.33 axis-aligned box around Ness's centre
  +5·scale, disarmed while the ball is still inside him, armed the frame it leaves, firing on
  re-entry. That launches **PK Thunder 2**: momentum 3.6 away from the contact point, decelerating
  0.072/frame, script-owned flight hits, the whole body rotated to `facing·atan2(vx, vy) − π/2`
  (ftPartSetRotX on FtPart_TopN), freefall with 24 frames of landing lag. Unported: the wall rebound/wallhug states (SpecialAirHiRebound) and the
  grounded knockdown-angle DownBound branch.
- **PSI Magnet (SpecialLw)** — ftnessspeciallw.c. Start/Hold arm the native AbsorbDesc (bone 1,
  offset (0, 6.5, 0), radius 8.5): energy projectiles (jolt, laser, fireball, charge shot, shadow ball,
  PK Fire/Flash) are absorbed and heal damage ×2.0 through the SpecialLwHit pulse. Release lag 30;
  air holds fall slowly after 4 frames.

  PSI graphics come from `effNessDataTable` entries 0-2, the only model descriptors in Ness's bank:
  efSync 1262 (the control-loop aura) and 1263 (the PK Thunder 2 burst) on FtPart_HipN, and the
  efAsync 1264 PSI Magnet shield on FtPart_L1stNb.

## Held items

`ftNs_Init_OnLoad` registers two items past the PSI articles: slot 9 `It_Kind_Ness_Bat` and slot 10
`It_Kind_Ness_Yoyo`. Neither carries an article state table, so the article reader tolerates a missing
one. `ftNs_AttackS4_Enter` spawns the bat on the item-hold part for the whole swing and despawns it
with the move; the yo-yo smashes do the same. Both ride `FtPart_R2ndNa` (0x2A) in
[web/src/render/play-effects.ts](../../web/src/render/play-effects.ts) alongside the other held
accessories.

## Normals

- Full jab chain, all tilts/smashes/aerials from the native scripts. The **baseball bat** forward
  smash reflects with the native xB8 ReflectDesc (max 50 damage) while its hits are armed.
- The yo-yo up/down smashes use the shared smash-charge flow; the dedicated AttackHi4/Lw4 charge-hold
  hitbox states (yoyoCurrentFrame/rehit machinery) and the yo-yo's string segments are not ported.

## Tests

- [tests/unit/ness-real.test.ts](../../tests/unit/ness-real.test.ts): registration, decomp attribute and
  article values, PK Fire bolt + pillar multihit, PK Thunder steering into PKT2 with armed flight hits,
  PSI Magnet absorb + heal, PK Flash charge/aim/detonation.
- [tests/server-browser/purin-ness.spec.ts](../../tests/server-browser/purin-ness.spec.ts): real keyboard
  PK Fire, PSI Magnet and PK Thunder on the play page.
