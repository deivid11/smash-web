# ACE 2.0 wave: Toad (Td), Meta Knight (Mk), Sonic (Sn)

Back to [docs/characters/README.md](README.md). Extension-disc architecture and
m-ex quirks: [docs/characters/ZERO.md](ZERO.md) (Zero was the first case).

All three come from the same already-registered ACE 2.0 ISO. The reference mexproj is
commit `7a5c107cf1` of the `Chri222k/ACE-BUILD-PUBLIC-` repo (the main branch was later
reverted to a different layout; the ISO is authoritative): Sonic=031, Meta Knight=042, Toad=057.

## Identity

| | Code | ftData | Joints/Parts | Skeleton | Selector |
| --- | --- | --- | --- | --- | --- |
| Toad | `Td` | `ftDataToad` | 63/63 | own (mexproj table) | 17 |
| Meta Knight | `Mk` | `ftDataMeta` | 84/84 | own; L/R legs share parts 67-71 | 18 |
| Sonic | `Sn` | `ftDataSonic` | 71/71 | own | 19 |
| Raichu | `Rc` | `ftDataRaichu` | 53/53 | own (mexproj 038) | 20 |
| Charizard | `Lz` | `ftDataLizardon` | 64/64 | own (mexproj 029); 3 jumps | 21 |

None has a vanilla donor (Toad matches Ca/Ns in count but its map differs):
the three literal tables live in [lib/game/modded-bones.ts](../../lib/game/modded-bones.ts)
and come in through `boneMaps` in [lib/game/data.ts](../../lib/game/data.ts) (nativeKind -1).

## Engine additions in this wave

1. **Trimmed clips**: HSDRaw omits trailing joints without tracks in some clips (Toad's
   aerials, MK's `LightThrowDash`). The spec carries `trimmedClips: true` in
   [lib/game/load.ts](../../lib/game/load.ts) and the renderer
   ([web/src/render/model-instance.ts](../../web/src/render/model-instance.ts)) leaves those
   joints in bind pose. Vanilla fighters still validate the exact count.
2. **Jab without a chain**: Meta Knight only has `Attack100` (looping multihit); it goes in as
   `moves.jab` directly (exempt from the `create` hitbox requirement by prefix).
3. **Modded multi-jump**: `ftDataMeta` declares 4 jumps; `METAKNIGHT_AIR_JUMPS` uses
   `JumpAerialF/F2/F3` with project-authored vertical speeds (the 160-byte ext block is
   m-ex code, not readable attributes).
4. **Real root motion**: unlike Zero, MK's travelling specials and Toad's
   SpecialHi DO carry root motion; the engine follows them with `rootDelta`.

## Specials (project-authored approximations except hitboxes/animations)

- **Toad**: N = Ice Ball (articles 0/1, 5%/12%; fires on the script's `flag24`, the
  convention of Mario's fireball; `iceball` projectile with fireball physics). S =
  quick scripted jab. Hi = jump with root motion → helpless. Lw = pure script
  (the grounded version has no hits in the original script).
- **Meta Knight**: N = Mach Tornado (Start→Spin in a held loop with drift→End).
  S = Drill Rush (root motion ~61 units, 30 hits). Hi = Shuttle Loop
  (Start→SpecialHi with root motion→SpecialHiEnd→helpless). Lw = Dimensional Cape
  (direction by stick: Lw/LwF/LwB). No articles.
- **Sonic** (replaced by the port of the original code, see "Specials ported from the
  original code" at the end): N = Homing Attack (jump+pause+dive at a fixed angle; real homing is
  future work; bounces into NHit on connect). S/Lw = Spin Dash/Charge (charge by
  holding → roll with the script's hit; Lw reuses S's roll). Hi = Spring
  Jump (instant launch → helpless; the item[0] spring article is not emulated yet).

## Key duplicates in the m-ex tables (see `*_ACTION_KEYS`)

- All three: `Landing` ×3 (primary 13/13/14); duplicated item throws (standard
  SMASH_ITEM_MOTIONS mechanism).
- Td/Mk: idle `Wait` (keyed to `Wait1`); Sn: `Wait1` ×2 (primary 2).
- Td: `AttackS4` ×3 (primary 52); crouch `SquatWait1`.
- Sn: duplicated specials — the keys pin the variants WITH a hitbox (NSpin 249,
  LwHold 266/268, S 262, AirS 264); `SpecialSWallR/L` unmapped.

## Second batch: Raichu and Charizard

- **Raichu** (re-ported from the compiled code, 2026-09-18): it is a **Pikachu clone**.
  `nosym.py --states` on `PlRc.dat` shows that the state table (341-368) runs the decomp's
  `ftPk_*` callbacks as-is for N/Hi/Lw, and `ftDataRaichu` keeps the offsets of
  `ftPikachuAttributes`; that is why `Rc` goes through [lib/game/pikachu.ts](../../lib/game/pikachu.ts)
  like Pichu. N = Thunder Jolt on the cmd0 of frame 32 (article 1: special block in the order
  speed/angle/life = 1 / −0.485 / 120, bounce 0.85; there is no ground wave, slot 2 is a
  copy of the bolt, so it bounces instead of travelling along the ground). Hi = **single-zip**
  Quick Attack: x A8 = 360°, so ftPk's angle check for the second zip is never satisfied.
  Lw = Thunder (4 segments × 8 frames, 5%, burst when they touch him). S = the author's own
  roll (M343/M344/M346/M348/M349/M351/M352, in
  [lib/game/raichu.ts](../../lib/game/raichu.ts)): each cmd0 of the Hold script adds one step
  (cap x2C = 4), speed max(x24, x28·steps), damage x30 + x34·steps; a new B press brakes it, a
  jump cancels it, on leaving over an edge (or releasing/filling in the air) it launches with
  x44/x48 · x4C/x50 and decays x54 per frame. The Hold clips carry the loop flag
  (0x40000000): the clip repeats and the script keeps its own 10-frame cycle (unrolled
  with `scriptFrames`), so the steps land on 0/10/20/30. Glow 5006 is an m-ex effect with
  behavior 6 (`effBehaviorTable`): it follows the bone, like Charizard's aura. The squash
  in SpecialSEnd (joint 4 scale) comes from the clip. Sound: `5000+n` = script n of bank
  80 of ACE's `smash2.sem` (served as `audio/us/smash2.ace.sem`); the code adds 5088 on
  entering Hold. The jolt spawns from part 14. Pending: the roll's deal_dmg/post_hitlag
  callbacks, the compiled logic of the jolt item and the Hi wall cancels (slots 265/266).
  Data quirk: slot 205 (quick ledge roll) reuses the `CliffClimbQuick`
  figatree; keyed as `CliffEscapeQuick`.
- **Charizard** (replaced by the port of the original code, see the end): N = Bowser-style Flamethrower (the flame article uses the
  itKoopaFlame layout; the generic probe rejects it → own parser in
  [lib/game/lizardon-data.ts](../../lib/game/lizardon-data.ts); `lizardon-flame`
  projectile at fixed strength, no breath pool). S = Rock Smash (script). Hi =
  Fly (32 hits, `flag102` lifts off; engine-driven rise) → helpless. Lw = script. 3 jumps
  (`JumpAerialF/F2`). Quirk: its up smash declares a charge multiplier of 0.977 (<1);
  the floor of the opcode 56 validator in [lib/game/moves.ts](../../lib/game/moves.ts)
  drops to 0.5 solely because of this.

## Pending work for the wave

Voices half done: the six banks (`zero/toad/metaknight/sonic/raichu/lizardon.ssm`)
are exposed and the dead 5xxx jump/KO ids remap to direct samples by semantic
slot ([lib/game/ace-voices.ts](../../lib/game/ace-voices.ts); jump1/jump2/rakka4 from the
mexproj, convention validated against vanilla Mario/Fox), and Zx/Td/Mk/Sn emit a special
voice on startup. Unmapped: Rc/Lz specials (banks without semantic names),
damage grunts (`x1C`/`x20`, on no fighter), ledge/grab/passive voices and the
5xxx SFX in the scripts (the ISO's SEM carries no scripts for any custom bank).
Announcer (generic cue), alternate costumes, real homing for Sonic, persistent
spring, MK's glide, Dimensional Cape invisibility. Verification:
[tests/unit/ace-fighters-real.test.ts](../../tests/unit/ace-fighters-real.test.ts) (12
cases) + [tests/server-browser/zero.spec.ts](../../tests/server-browser/zero.spec.ts).

## Third batch (wave 2): Wolf (Wf), Diddy Kong (Dd), King Dedede (De), Wario (Wr), Shadow (Sh)

From the same ACE 2.0 ISO. Reference mexproj, main branch
(`data/fighters/027=Wolf`, `028=Diddy`, `032=Dedede`, `035=Wario`, `038=Shadow`):
`ftDataWolf`, `ftDataDiddy`, `ftDataDedede`, `ftDataWario`, `ftDataShadow`.

| | Code | ftData | Joints/Parts | Selector |
| --- | --- | --- | --- | --- |
| Wolf | `Wf` | `ftDataWolf` | 74/74 | 33 |
| Diddy Kong | `Dd` | `ftDataDiddy` | 73/73 | 34 |
| King Dedede | `De` | `ftDataDedede` | 67/67; 5 jumps | 35 |
| Wario | `Wr` | `ftDataWario` | 63/63 | 36 |
| Shadow | `Sh` | `ftDataShadow` | 71/71 | 37 |

Tables in [lib/game/modded-bones.ts](../../lib/game/modded-bones.ts),
`boneMaps` in [lib/game/data.ts](../../lib/game/data.ts) (nativeKind -1).

### Voices, sounds and VFX (new in this batch)

- **Mapped voices**: specs with `bank: 'wolf'/'diddy'/'dedede'/'wario'/'shadow'` in
  [lib/game/load.ts](../../lib/game/load.ts); banks `audio/us/wolf.ssm` (base 1566/35),
  `diddy.ssm` (1601/31), `dedede.ssm` (1812/33), `wario.ssm` (1916/32),
  `shadow.ssm` (2523/39) exposed in
  [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts). The 2.0 ISO's
  `smash2.sem` carries no scripts for those new banks, so the specials emit
  direct sample IDs (no longer for Wolf and Diddy: their 5xxx go through their SEM bank, see below) and
  [web/src/play-audio.ts](../../web/src/play-audio.ts) plays them with a fallback to a
  direct sample when there is no SEM cue. Jump/airJump/KO come from `ftData+0x4c`,
  with the dead 5xxx ids remapped to samples by semantic slot
  ([lib/game/ace-voices.ts](../../lib/game/ace-voices.ts)). Announcer: generic `confirm` cue (calls
  510055/510056/510060/510062/510063 map to placeholder 1529 in the ISO's SEM).
- **VFX**: banks `EfWfData.dat` (`effWolfDataTable`), `EfDdData.dat`, `EfDeData.dat`,
  `EfWrData.dat`, `EfShData.dat` exposed and parsed as particle
  descriptors (names `[]`, like the previous wave; no full TEV equivalence).
  Script GFX (`effect` 1001-1031, 5000s/6000s) flow through the `gfx` events.

### Specials (project-authored approximations except hitboxes/animations/articles)

- **Wolf** ([lib/game/wolf-data.ts](../../lib/game/wolf-data.ts),
  [lib/game/wolf.ts](../../lib/game/wolf.ts)): **re-ported from the compiled code** (ftFunction
  of `PlWf.dat` decompiled with m2c; itFunction 0/1 for laser and gun). OnLoad copies 0xD4
  bytes of the code block (offset 0xB2C) over `special_attributes`, in the layout of
  `ftFox_DatAttrs`: the tuning comes from there, not from `ftDataWolf`. Fox states 341-369:
  N = gun (article 1) on FtPart 0x43 for the whole move; each script cmd var 1 = 1
  (frame 14) fires the laser (article 0, 3%) from joint 5 of the gun, 2.3/frame,
  life 25, dies on touching the stage; no charge or loop. S = Wolf Flash: 20f charge (x24
  frames without gravity, x28 divisor), dash 351 over the clip's TransN (72 forward, 24 up
  in 2 frames) rotated up to ±10° by the stick; B cuts it short; slash 352 (18%) falls into special
  fall (0.4, lag 20) unless it connects, which gives back the double jump (`ptr_03bac`). Hi = Fox's
  Firefox with Wolf's numbers (3.2, 30 frames, decel 0.1 from frame 6, bound/slide,
  ground travel, lag 18). Lw = Fox's reflector with Wolf wrappers: Start with an 8% hit
  and 2f intangibility, Loop jump-cancellable, turn (364/369), Hit always returns to Loop,
  release lag 18, bubble part 1 (0, 6.5, 0) radius 8.5, ×1.5 damage, ×1.0 speed. Sounds through
  its own SEM bank (`SEM_ROUTED_ACE_KINDS`); auras 0x1388-0x138B like Fox's. Not
  ported: the reflect windbox (`Wind_FighterCreate`), the visual rotation of the turn
  and the launch flame (model 4 of `EfWfData.dat`, corrupt animation).
- **Diddy** ([lib/game/diddy-data.ts](../../lib/game/diddy-data.ts),
  [lib/game/diddy.ts](../../lib/game/diddy.ts),
  [lib/game/diddy-projectiles.ts](../../lib/game/diddy-projectiles.ts)): **re-ported from the
  compiled code** (`ftFunction`/`itFunction` of `PlDd.dat`, which carries its debug
  symbols; analysis kept in private notes). OnLoad copies `ftDataDiddy` x4 (0x100 bytes)
  over `special_attributes`: all the tuning comes from there. States 341-374:
  N = Peanut Popgun: the gun (article 0) appears in the hand (FtPart 0x1F) on the Start's
  cmd0; B held in Charge/Danger counts the charge and releasing fires (`Gun_Shoot`): the
  peanut (article 1) leaves joint 7 of the gun at 2.2..5.7, 45°..7°, 3..12% (base
  10..40, growth 50..100) depending on the charge over Charge+Danger (160 frames), with recoil of
  up to 1.4; it dies on touching any surface. If Danger runs out, the gun explodes (Blow):
  5% self-damage from the script (+5% in the air from code) and an 8% fire hitbox for two frames.
  S = Monkey Flip: fixed jump (2.0·facing, 1.7) with grab boxes (element 8); A/B during the
  jump is the kick (11/9%); on grabbing he climbs onto the opponent's head (his XRotN pinned to the
  captive's), regains the double jump; A kicks (3% + 10% throw, Diddy exits backwards),
  jump hops off the top (3% + 6% spike at 270°); if he does nothing, the captive (grounded) breaks free via
  the grab timer (cap 125, mashing) and both take 4%; in the air the captive falls
  (0.12/2.0) with no way to break free. Special landing 30. Hi = Rocketbarrel Boost: charges while
  B is held (up to 45), the stick tilts ±0.47 → launch at 90° − 60°·tilt, speed
  3.5..4.15 depending on the charge; then he flies with normal gravity and stick drift (0.048/0.6/0.02)
  leaning towards the velocity; the fire hitbox scales 3..8% with speed and disappears
  on slowing down or falling; a ceiling crashes him (5% self-damage, SpecialAirHiDamage); ends in special
  fall with landing 30. Lw = Banana Peel: the banana (article 2) appears in the hand on
  the cmd0 and is thrown backwards (1.7 at 103°) on the cmd1; one at a time; on the ground it lasts 420
  frames and trips grounded opponents who step on it (MissFoot → DownBoundU → DownStandU; the
  banana flies off and disappears on landing); in the air it hits for 3% and bounces. OnFrame readjusts the
  speed of AttackLw3/AttackS4S/AttackAirB/ThrowF and the smash item throws. Sounds
  through its own SEM bank. Approximations: the captive uses its own capture poses (Diddy's
  *Capture figatrees are made for a single skeleton); nobody can pick up the
  banana; after tripping there are no get-up options (the victim gets up automatically); the animation
  blending of the Rocketbarrel charge is reduced to choosing HiCharge or HiChargeF/B.
- **Dedede** ([lib/game/dedede-data.ts](../../lib/game/dedede-data.ts),
  [lib/game/dedede.ts](../../lib/game/dedede.ts)): N = Inhale (held loop
  `SpecialNLoop`; capture not emulated, the prototype leaves it as script damage). S =
  Gordo (article 1, 18%; `dedede-gordo` projectile). Hi = Super Dedede Jump
  (`HiStartL/R`→`HiJump` with rise→`HiLoop` while falling→`HiLandingL` with lag). Lw =
  Jet Hammer (charge by holding `LwHold/Max`→swing `Lw`). 5 jumps
  (`JumpAerialF2/F3/F4/F5` with project-authored vertical speeds 2.2/2.0/1.8/1.6).
- **Wario** ([lib/game/wario-data.ts](../../lib/game/wario-data.ts),
  [lib/game/wario.ts](../../lib/game/wario.ts)): N = Chomp (18 hits; sustained
  while held). S = Shoulder Bash (dash with the `SpecialS` hit). Hi =
  Corkscrew (27 hits; engine-driven rise→helpless). Lw = Waft (60f charge→burp with
  proportional rise→helpless). No articles. Quirk: `Attack13` (166 bytes) and the
  three `Attack100*` carry corrupt figatrees on the ISO (out-of-bounds); the jab stays
  at 11→12 with no third hit or rapid jab.
- **Shadow** ([lib/game/shadow-data.ts](../../lib/game/shadow-data.ts),
  [lib/game/shadow.ts](../../lib/game/shadow.ts)) (replaced by the port of the original code,
  see the end): Sonic clone (same leg/arm
  skeleton). N = Homing (jump+pause+fixed dive; bounce into NHit). S/Lw =
  Spin Dash/Charge (charge→roll with the script's hit; Lw reuses the roll).
  Hi = Chaos Control (instant launch→helpless, Spring convention). No
  articles. Keys pin the variants WITH a hitbox (NSpin 249, LwHold 266, AirLwHold
  268, S 263, AirS 265).

### Duplicates and quirks

- Wf: `Wait1` ×2 (2), `Landing` ×3 (13), `SpecialNStart` ×3 (244 with hits).
- Dd: `Wait1` ×2 (2), `Landing` ×3 (14); specials without duplicates (SpecialSKickLanding,
  SpecialSLanding, SpecialAirSFall and SpecialAirHiJDamage are never used by the code).
- De: `Landing` ×3 (14), `SpecialNLoop` ×2 (247 with hits), `JumpAerialF2` ×4 for the
  aerial ladder; plain `CliffWait`.
- Wr: `Landing` ×3 (14), `AttackS3S` ×3 (52 middle), `CliffWait1/2` (207 as
  `CliffWait`, like Falcon/Ganon).
- Sh: `Wait1` ×2 (2), `Landing` ×3 (14); specials like Sonic but with primaries
  on the second variant (S 263, AirS 265).

### Pending work for this batch

Distinctive announcer, alternate costumes, homing with real tracking, capture for
Inhale/Chomp, Dedede's glide, Shadow's invisibility. Verification:
[tests/unit/ace-wave2-real.test.ts](../../tests/unit/ace-wave2-real.test.ts) (9 cases).

## Fourth batch (wave 3): Blastoise (Bl), Lucas (Lc), Metal Sonic (Nm), Ninten (Nt), Daisy (Da)

From the same ACE 2.0 ISO (mexproj `7a5c107`: 030=Lucas, 036=Daisy, 048=Ninten,
049=Metal Sonic, 054=Blastoise): `ftDataBlastoise`, `ftDataLucas`,
`ftDataMetalsonic`, `ftDataNinten`, `ftDataDaisy`.

| | Code | ftData | Joints/Parts | Selector |
| --- | --- | --- | --- | --- |
| Blastoise | `Bl` | `ftDataBlastoise` | 76/76 | 38 |
| Lucas | `Lc` | `ftDataLucas` | 66/66 (Rope Snake: no grab) | 39 |
| Metal Sonic | `Nm` | `ftDataMetalsonic` | 73/73 | 40 |
| Ninten | `Nt` | `ftDataNinten` | 66/66 | 41 |
| Daisy | `Da` | `ftDataDaisy` | 114/114 (Peach's joint set) | 42 |

Tables in [lib/game/modded-bones.ts](../../lib/game/modded-bones.ts),
`boneMaps` in [lib/game/data.ts](../../lib/game/data.ts) (nativeKind -1).

### Voices, sounds and VFX

- Banks `audio/us/blastoise.ssm` (base 2471/26), `lucas.ssm` (1670/39),
  `metal_sonic.ssm` (2320/40), `ninten.ssm` (2281/39), `daisy.ssm` (1948/30) in
  [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts); special voices
  as direct samples (the ISO's SEM carries no scripts for these banks).
  Jump/airJump/KO from `ftData+0x4c` (5xxx remap in
  [lib/game/ace-voices.ts](../../lib/game/ace-voices.ts)). Generic announcer.
- VFX: `EfBlData.dat` (reused `effKoopaDataTable` symbol),
  `EfLcData.dat` (`effLucasDataTable`), `EfNmData.dat` (`effNmDataTable`),
  `EfNtData.dat` (`effNintenDataTable`); Daisy reuses the vanilla `EfPeData.dat`
  (`effPeachDataTable`, no Ef of her own in ACE). Particles, no full TEV.

### Specials (project-authored approximations except hitboxes/animations/articles)

- **Blastoise** ([lib/game/blastoise-data.ts](../../lib/game/blastoise-data.ts),
  [lib/game/blastoise.ts](../../lib/game/blastoise.ts)): N = Water Gun (`flag24`,
  article 0, 12%; `blastoise-water`). S = Shell Bash (root motion). Hi = Hydro
  Pump (28 hits; engine-driven rise — the root uses types 5/7 — →helpless). Lw =
  Withdraw (`flag24` spray article 1, 2% + slam `LwLanding`).
- **Lucas** ([lib/game/lucas-data.ts](../../lib/game/lucas-data.ts),
  [lib/game/lucas.ts](../../lib/game/lucas.ts)): Ness kit. N = PK Freeze (charge →
  `lucas-freeze` article 3, 2%; freeze status pending, damage only). S = PK Fire
  (`flag24`, article 1, 3%; `lucas-fire`). Hi = Thunder rocket (23 hits →helpless;
  guided ball pending). Lw = PSI Magnet (loop with TransN bubble radius 12,
  heal 1.5 via `nessAbsorber()` in [lib/game/ness.ts](../../lib/game/ness.ts)).
  No grab: the Catch uses the Rope Snake tip (part 139) and stays pending like
  Samus (`canGrab: false`). Keys: `NHold` 247, `AirNHold` 251, `Hi` 259.

  Real PSI block: `PlLc` stores an authentic `ftNessAttributes` 0x18 bytes
  behind the `ftData` x4 pointer (`PlNt` the same, `PlLc2` exact). The PK Fire
  trajectories (ground −0.0628 rad, air −0.6632) and the PK Thunder landing lag
  now come from there; `nessClonePkFire()` in
  [lib/game/lucas-data.ts](../../lib/game/lucas-data.ts) reads them with a checked
  range and falls back to the engine constants if the m-ex layout does not fit. The
  rest of the block (magnet bubble, yo-yo, bat) shifts again after
  `healMul`, so it remains engine-authored.
  PSI graphics: the three ACE banks carry the same entries 0-2 as Ness
  (3/2/68, 10/9/223 and 12/7/470 joints/meshes/triangles), so the PSI Magnet
  shield and the rocket flash are now drawn.
- **Metal Sonic** ([lib/game/metal-data.ts](../../lib/game/metal-data.ts),
  [lib/game/metal.ts](../../lib/game/metal.ts)): ported from the original code. It is a Fox
  clone at engine level: `MxDt.dat` gives it `ftFx_SpecialSStart_Enter`/`AirSStart_Enter` and
  Fox's callbacks as raw DOL pointers in its `move_logic`; `PlNm` overrides N/Hi/Lw
  and part of the callbacks, and reads its constants from the `ftFunction` rodata. N = hover
  (344 on the ground too, `jumpsUsed = 1`): releasing B at 10-14 → weak shot (5 u/f, 8 f),
  at 15-141 → strong (7 u/f, life x0 = 35), holding → `AirNLoop` (24%, −8% self-damage);
  the shot comes out on End f4 unless he lands that frame. S = chargeable Spin Dash
  (steps 15..120 → 2..9 u/f, freezes at 120, shield cancels) → Fox's `AirSEnd`
  (landing 20). Hi = Fox's Firefox with velocity zeroed (3.8 u/f, 20 f, bounce at
  >110°). Lw = Fox's Reflector without IASA (no turn/jump) and with ground friction only on
  `gr_vel`. Quirk: the `SpecialLwStart` figatree (265) is truncated; 360 uses the aerial one.
- **Ninten** ([lib/game/ninten-data.ts](../../lib/game/ninten-data.ts),
  [lib/game/ninten.ts](../../lib/game/ninten.ts)): Ness kit. N = PK Hypnosis
  (loop without damage; sleep pending). S = Slingshot (`flag24`; `ninten-pellet`
  article 1, 3%). Hi = Thunder rocket (23 hits →helpless; guided ball pending).
  Lw = PSI Magnet (same bubble as Lucas). Keys: `NHold` 247, `AirNHold` 251,
  `Hi` 259.
- **Daisy** ([lib/game/daisy-data.ts](../../lib/game/daisy-data.ts)): runs Peach's kit
  ([lib/game/peach.ts](../../lib/game/peach.ts)). Her m-ex state table points Float, Bomber,
  Parasol and the weapon smashes at the DOL's `ftPe_*` callbacks; her `SpecialS`/`SStart_Anim`,
  Toad (M365–368) and the turnip pull (M352/353) are recompilations of the same ftPe logic.
  `ftDataDaisy` keeps Peach's attribute layout with its own values (float 70 f,
  Bomber 4.7, bounce 1.8) and its article table the same five slots. Just like Peach, the
  `SpecialLw*` figatree is Toad (B) and `SpecialN` is the turnip pull (down-B). The Bomber follows
  `ftpeachspecials.c`: SStart accelerates towards x3C, jumps to `SpecialSJump`, and the script's element 11
  detection box triggers `doAirEnd0` → explosion at HipN + bounce → `AirSEnd1` → normal
  fall. Her pull always gives her own turnip (no rare roll). Quirks: `Landing` primary 15
  (not 14), `JumpAerialF/B` ×2 (18/19).

### Pending work for this batch

Distinctive announcer, alternate costumes, homing with real tracking, capture for
Inhale/Chomp, Dedede's glide, Shadow's invisibility. Verification:
[tests/unit/ace-wave2-real.test.ts](../../tests/unit/ace-wave2-real.test.ts) (9 cases).

## Fourth batch (wave 3): Blastoise (Bl), Lucas (Lc), Metal Sonic (Nm), Ninten (Nt), Daisy (Da)

From the same ACE 2.0 ISO (mexproj `7a5c107`: 030=Lucas, 036=Daisy, 048=Ninten,
049=Metal Sonic, 054=Blastoise): `ftDataBlastoise`, `ftDataLucas`,
`ftDataMetalsonic`, `ftDataNinten`, `ftDataDaisy`.

| | Code | ftData | Joints/Parts | Selector |
| --- | --- | --- | --- | --- |
| Blastoise | `Bl` | `ftDataBlastoise` | 76/76 | 38 |
| Lucas | `Lc` | `ftDataLucas` | 66/66 (Rope Snake: no grab) | 39 |
| Metal Sonic | `Nm` | `ftDataMetalsonic` | 73/73 | 40 |
| Ninten | `Nt` | `ftDataNinten` | 66/66 | 41 |
| Daisy | `Da` | `ftDataDaisy` | 114/114 (Peach's joint set) | 42 |

Tables in [lib/game/modded-bones.ts](../../lib/game/modded-bones.ts),
`boneMaps` in [lib/game/data.ts](../../lib/game/data.ts) (nativeKind -1).

### Voices, sounds and VFX

- Banks `audio/us/blastoise.ssm` (base 2471/26), `lucas.ssm` (1670/39),
  `metal_sonic.ssm` (2320/40), `ninten.ssm` (2281/39), `daisy.ssm` (1948/30) in
  [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts); special voices
  as direct samples (the ISO's SEM carries no scripts for these banks).
  Jump/airJump/KO from `ftData+0x4c` (5xxx remap in
  [lib/game/ace-voices.ts](../../lib/game/ace-voices.ts)). Generic announcer.
- VFX: `EfBlData.dat` (reused `effKoopaDataTable` symbol),
  `EfLcData.dat` (`effLucasDataTable`), `EfNmData.dat` (`effNmDataTable`),
  `EfNtData.dat` (`effNintenDataTable`); Daisy reuses the vanilla `EfPeData.dat`
  (`effPeachDataTable`, no Ef of her own in ACE). Particles, no full TEV.

### Specials (project-authored approximations except hitboxes/animations/articles)

- **Blastoise** ([lib/game/blastoise-data.ts](../../lib/game/blastoise-data.ts),
  [lib/game/blastoise.ts](../../lib/game/blastoise.ts)): N = Water Gun (`flag24`,
  article 0, 12%; `blastoise-water`). S = Shell Bash (root motion). Hi = Hydro
  Pump (28 hits; engine-driven rise — the root uses types 5/7 — →helpless). Lw =
  Withdraw (`flag24` spray article 1, 2% + slam `LwLanding`).
- **Lucas** ([lib/game/lucas-data.ts](../../lib/game/lucas-data.ts),
  [lib/game/lucas.ts](../../lib/game/lucas.ts)): Ness kit. N = PK Freeze (charge →
  `lucas-freeze` article 3, 2%; freeze status pending, damage only). S = PK Fire
  (`flag24`, article 1, 3%; `lucas-fire`). Hi = Thunder rocket (23 hits →helpless;
  guided ball pending). Lw = PSI Magnet (loop with TransN bubble radius 12,
  heal 1.5 via `nessAbsorber()` in [lib/game/ness.ts](../../lib/game/ness.ts)).
  No grab: the Catch uses the Rope Snake tip (part 139) and stays pending like
  Samus (`canGrab: false`). Keys: `NHold` 247, `AirNHold` 251, `Hi` 259.

  Real PSI block: `PlLc` stores an authentic `ftNessAttributes` 0x18 bytes
  behind the `ftData` x4 pointer (`PlNt` the same, `PlLc2` exact). The PK Fire
  trajectories (ground −0.0628 rad, air −0.6632) and the PK Thunder landing lag
  now come from there; `nessClonePkFire()` in
  [lib/game/lucas-data.ts](../../lib/game/lucas-data.ts) reads them with a checked
  range and falls back to the engine constants if the m-ex layout does not fit. The
  rest of the block (magnet bubble, yo-yo, bat) shifts again after
  `healMul`, so it remains engine-authored.
  PSI graphics: the three ACE banks carry the same entries 0-2 as Ness
  (3/2/68, 10/9/223 and 12/7/470 joints/meshes/triangles), so the PSI Magnet
  shield and the rocket flash are now drawn.
- **Metal Sonic** ([lib/game/metal-data.ts](../../lib/game/metal-data.ts),
  [lib/game/metal.ts](../../lib/game/metal.ts)): ported from the original code. It is a Fox
  clone at engine level: `MxDt.dat` gives it `ftFx_SpecialSStart_Enter`/`AirSStart_Enter` and
  Fox's callbacks as raw DOL pointers in its `move_logic`; `PlNm` overrides N/Hi/Lw
  and part of the callbacks, and reads its constants from the `ftFunction` rodata. N = hover
  (344 on the ground too, `jumpsUsed = 1`): releasing B at 10-14 → weak shot (5 u/f, 8 f),
  at 15-141 → strong (7 u/f, life x0 = 35), holding → `AirNLoop` (24%, −8% self-damage);
  the shot comes out on End f4 unless he lands that frame. S = chargeable Spin Dash
  (steps 15..120 → 2..9 u/f, freezes at 120, shield cancels) → Fox's `AirSEnd`
  (landing 20). Hi = Fox's Firefox with velocity zeroed (3.8 u/f, 20 f, bounce at
  >110°). Lw = Fox's Reflector without IASA (no turn/jump) and with ground friction only on
  `gr_vel`. Quirk: the `SpecialLwStart` figatree (265) is truncated; 360 uses the aerial one.
- **Ninten** ([lib/game/ninten-data.ts](../../lib/game/ninten-data.ts),
  [lib/game/ninten.ts](../../lib/game/ninten.ts)): Ness kit. N = PK Hypnosis
  (loop without damage; sleep pending). S = Slingshot (`flag24`; `ninten-pellet`
  article 1, 3%). Hi = Thunder rocket (23 hits →helpless; guided ball pending).
  Lw = PSI Magnet (same bubble as Lucas). Keys: `NHold` 247, `AirNHold` 251,
  `Hi` 259.
- **Daisy** ([lib/game/daisy-data.ts](../../lib/game/daisy-data.ts),
  [lib/game/peach.ts](../../lib/game/peach.ts), parameters in [lib/game/daisy-data.ts](../../lib/game/daisy-data.ts)): Peach clone (same `EfPeData`
  bank, turnips via `parsePeachArticles`). N = Toad spores (`flag24`, no
  hits). S = Daisy Bomber (dash → contact `SJump`). Hi = Parasol (`flag102`
  lifts off with root motion →helpless). Lw = Turnip pull (script; item beyond
  the shared faces, pending). Quirks: `Landing` primary 15 (not 14),
  `JumpAerialF/B` ×2 (18/19), `AttackS4` ×4 (245 with hits), plain `CliffWait`.

### Pending work for this batch

Distinctive announcer, costumes, Rope Snake tether, guided Thunder ball, freeze/sleep
status, glide. Verification:
[tests/unit/ace-wave3-real.test.ts](../../tests/unit/ace-wave3-real.test.ts) (8 cases).

## Fifth batch (wave 4): Fay (Fy), Black Sonic (Sc), Dr. Luigi (Dl), Knuckles (Kx), Lucina (Lu)

From the same ACE 2.0 ISO (mexproj `7a5c107`: 041=Fay, 043=Sonic BM, 047=Dr. Luigi,
050=Knuckles, 053=Lucina): `ftDataFay`, `ftDataBSonic`, `ftDataDrLuigi`, `ftDataKx`,
`ftDataLucina`.

| | Code | ftData | Joints/Parts | Selector |
| --- | --- | --- | --- | --- |
| Fay | `Fy` | `ftDataFay` | 73/73 (Fox family) | 43 |
| Black Sonic | `Sc` | `ftDataBSonic` | 68/68 (parts 7/9/11/13/19/50 shared) | 44 |
| Dr. Luigi | `Dl` | `ftDataDrLuigi` | 61/61 (Luigi family) | 45 |
| Knuckles | `Kx` | `ftDataKx` | 71/71 (Sonic layout; base without the `_ACTION_` wrapper) | 46 |
| Lucina | `Lu` | `ftDataLucina` (Mars layout) | 90/90 (Marth family) | 47 |

Tables in [lib/game/modded-bones.ts](../../lib/game/modded-bones.ts),
`boneMaps` in [lib/game/data.ts](../../lib/game/data.ts) (nativeKind -1).

### Voices, sounds and VFX

- Banks `audio/us/fay.ssm` (base 2083/50), `bmsonic.ssm` (2173/33),
  `drluigi.ssm` (2246/35), `knuckles.ssm` (2360/33), `lucina.ssm` (2430/41) in
  [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts); special voices
  as direct samples (the ISO's SEM carries no scripts for these banks).
  Jump/airJump/KO from `ftData+0x4c` (5xxx remap in
  [lib/game/ace-voices.ts](../../lib/game/ace-voices.ts)). Generic announcer.
- VFX: `EfScData.dat`/`EfKxData.dat` (own `effSonicDataTable`); Fay, DrLuigi and
  Lucina reuse the vanilla banks `EfFxData`/`EfLgData`/`EfMsData` (no Ef of
  their own in ACE). Particles, no full TEV.

### Specials (project-authored approximations except hitboxes/animations/articles)

- **Fay** ([lib/game/fay-data.ts](../../lib/game/fay-data.ts),
  [lib/game/fay.ts](../../lib/game/fay.ts)): N = Blaster (`flag24`, article 0, 3%;
  `fay-laser`). S = Sniper tap (`SpecialS`, `flag24`) or charged (`SHoldStart` fires
  on the flag-24 of frame 34 if still held; article 3, 15%; `fay-sniper`).
  Hi = Fire Fay (Hold→engine-driven rise→helpless). Lw = Reflector (Fox-down
  convention with its own reflector; `reflector()`/`canShineJump` already cover `Fy`).
  NSniper/AirNSniper unmapped (trigger pending).
- **Black Sonic** ([lib/game/bsonic-data.ts](../../lib/game/bsonic-data.ts),
  [lib/game/bsonic.ts](../../lib/game/bsonic.ts),
  [lib/game/bsonic-projectiles.ts](../../lib/game/bsonic-projectiles.ts)): ported from the
  compiled code of PlSc (`ftFunction` without symbols, motions 343-369; disassembly
  kept only in private storage). N = Homing Attack (Start with root motion; looks for
  the hip of the nearest opponent at <45, flies at 3/frame for up to 30 frames; the hit bounces
  into `SpecialNEnd` and falls normally, a miss ends in `NEndSpecialFall`). S = dash at 2.6465
  (on flag2 it continues into Run only with the stick forward; otherwise, `SpecialSCancel`; in the air
  the Start floats and he flies straight). Hi = Spring Jump (flag1 launches at 3.75; flag24 leaves the
  spring: article 0, on the ground it is stepped on to bounce —others JumpF +4.5, Black Sonic relaunches
  `SpecialHi`—, in the air it falls with its 6% hit and bounces through the stage). Lw = Spin
  Dash (B after the Hold's flag1 raises the level up to 5; releasing down rolls at 1.9+0.3·level with
  damage 8+2·level, 60 frames, turn, jump into the air). Locks ft_var49/50/51 per airtime.
  - **Visibility on spawn.** The `PlSc` parts table is 10 groups with a single
    alternative each (0–8 body, 9–17 loose layers) and the compiled code (`sc-full.asm`
    0x104–0x190) calls `ftParts_80074A4C` to leave groups 1, 2, 4, 5, 7, 8 and 9 on
    alternative 1 (= nothing) before any script. The port started them all at 0, so the
    Spin Dash ball (dobj 17, 9.6 sphere), the eyelids and the three mouth/hand variants
    were drawn all at once over the body. `BSONIC_PART_DEFAULTS` in
    [lib/game/bsonic-data.ts](../../lib/game/bsonic-data.ts) and `FighterContent.partDefaults`
    start each group where the original leaves it; the scripts (jump, specials) still
    turn the ball on where appropriate. Sonic, Knuckles and Shadow share the same routine with
    `[0, 0, 0, -1]`: group 3 is a second set of hands on the same joint and was drawn
    on top of the first (`SONIC_PART_DEFAULTS`). Metal Sonic and Charizard only touch groups that
    already started at 0.
- **Dr. Luigi** ([lib/game/drluigi-data.ts](../../lib/game/drluigi-data.ts)): Luigi clone —
  the orchestration is shared in [lib/game/luigi.ts](../../lib/game/luigi.ts)
  (`Lg`/`Dl`) and the parameters come from `ftDataDrLuigi` with the same layout.
  N = pill (`flag24`, article 0, 8%; project-authored `lifetime` 50 at Luigi parity because
  the slot carries 0 and the native m-ex spawn supplies it). S = Green Missile with misfire
  (Launch 1 hit / Misfire 6 hits + fire gfx). Hi = Super Jump Punch (`flag102`).
  Lw = Cyclone (13 hits).
- **Knuckles** ([lib/game/knuckles-data.ts](../../lib/game/knuckles-data.ts),
  [lib/game/knuckles.ts](../../lib/game/knuckles.ts)) (replaced by the port of the original
  code, see the end): N = Glide Homing (fixed dive
  shallower than Sonic's to reach mid range; bounce into NHit). S = Spin
  Dash (charge→roll). Hi = rising punch with a hit. Lw = Drill Charge (held spin with
  hits 269/271→roll with speed by charge). Quirk: the base
  (indices 2-13) skips the `_ACTION_` wrapper (`Wait_figatree`, `WalkSlow_figatree`,
  …); the idle/walk/run only load through explicit keys. No articles.
- **Lucina** ([lib/game/lucina-data.ts](../../lib/game/lucina-data.ts)): Marth clone —
  the orchestration is shared in [lib/game/roy.ts](../../lib/game/roy.ts)
  (`Fe`/`Ms`/`Lu`) and the parameters read `ftDataLucina` with the Mars layout (validated
  with the same ranges as Marth). N = Shield Breaker (charge), S = Dancing Blade
  (Hi/Lw chains by stick with Marth's `branchThreshold`), Hi = Dolphin Slash
  (`flag102`), Lw = Counter (native sphere + `triggerRoyCounter`, hitlag in
  [lib/game/match.ts](../../lib/game/match.ts) extended to `Lu`). No side tilt or
  third jab in the table (`AttackS3*` and `Attack13` absent) and no EndFull variants
  (mapped to the plain `End`). No articles.

### Duplicates and quirks

- Fy: `Wait1` ×2 (2), `Landing` ×3 (13). `Attack100End` 47 exists.
- Sc: `Wait1` ×2 (2), `Landing` ×3 (13); single-state specials.
- Dl: `Wait1` ×2 (2), `Landing` ×3 (13); `SpecialS` ×3 (247 Launch / 248 Misfire /
  249 Fly) and ×2 in the air (253/254) like Luigi.
- Kx: `Landing` ×3 (14); `SpecialS` ×2 (265), `SpecialAirS` ×2 (267),
  `SpecialLwHold` ×3 (269 with hit), `SpecialAirLwHold` ×3 (271 with hit),
  `SpecialNSpin` 251 without a hit versus `SpecialNSpina` 252 with a hit.
- Lu: order 239+ identical to Marth except for the `EndFull`s (241/242 and 245/246, both
  plain `NEnd`).

### Pending work for this batch

Fay's NSniper trigger, DrLuigi misfire tuning,
homing tracking (Sonic/Knuckles), Lucina's side tilt and third jab,
costumes, announcer. Verification:
[tests/unit/ace-wave4-real.test.ts](../../tests/unit/ace-wave4-real.test.ts) (8 cases).

## Sixth batch (wave 6): Chun-Li (Cn)

From the same ACE 2.0 ISO (mexproj `7a5c107`: 055=Chun-Li): `ftDataChunLi`, 118 joints
(selector 53). No effects bank on the disc: common VFX.

- **Voices**: `audio/us/chun-li.ssm` (base 2497/26; the bank is called `chun-li`, with a
hyphen like the file) as direct samples; generic announcer.
- **Specials** ([lib/game/chunli-data.ts](../../lib/game/chunli-data.ts),
[lib/game/chunli.ts](../../lib/game/chunli.ts)): N = Kikoken (`flag24`, article 2,
8%; `chunli-kiko`; project-authored flight speed 2.8 because the slot carries native
values). S = Lightning Legs (Start→held 24-hit loop→End; the air version
reuses the ground loop). Hi = Spinning Bird Kick (a single state with real root
motion dz 21/dy 27→helpless). Lw = Tensho kick (root dash of ~25
units with hits on 22-28; the test gap is 30 so as to find them). The
`SpecialNInput` variant and the 13% article remain unmapped (no cue that
distinguishes them). No up tilt: her `AttackHi3` carries a hitbox id outside the vanilla range
and does not parse (documented quirk, not a design gap).
- Duplicates: `Landing` ×3 (15). No rapid loop or `AttackS4`.

Verification: [tests/unit/ace-wave6-real.test.ts](../../tests/unit/ace-wave6-real.test.ts)
(5 cases).

## Seventh batch (wave 7): Giga Bowser (Gk)

From the same ACE 2.0 ISO (`ftDataGkoopa`, 76 joints, selector 54): a clone of the
Koopa family with the same motion-state order as Bowser (subactions
246–271 in [lib/game/gk-data.ts](../../lib/game/gk-data.ts); the two `SpecialSHit`
share a figatree as `Hit0/Hit1`). It mounts Bowser's parts table
(`nativeKind: 5` in [lib/game/data.ts](../../lib/game/data.ts), Zero→Link precedent;
76 joints in both models) and reuses `EfKpData.dat` (no `EfGkData.dat` on the
disc) plus `audio/us/gkoopa.ssm` (base 566).

- **Specials** ([lib/game/koopa.ts](../../lib/game/koopa.ts), `Kp`/`Gk` checks):
  N = looping Fire Breath with a pool (`koopa-flame` from slot 0 of
  `ftDataGkoopa+0x48` via [lib/game/gk-data.ts](../../lib/game/gk-data.ts));
  S = Koopa Klaw with capture/bite/throw; Hi = Whirling Fortress with
  rise and `landingLag`; Lw = diving Bowser Bomb → `SpecialLwLanding`.
  No branches of its own: the kit matches and the orchestration is Bowser's.
- **Explicit limitations**: jump/KO voices silent (the sound
  block carries `540000` sentinels and the ISO's SEM carries no scripts for the new
  bank; same precedent as Knuckles' silent jumps); generic `confirm`
announcer; no alternate costumes.

Verification: [tests/unit/ace-wave7-real.test.ts](../../tests/unit/ace-wave7-real.test.ts)
(6 cases).

## Specials ported from the original code (Sonic, Knuckles, Shadow, Charizard, Black Sonic, Metal Sonic)

Black Sonic and Metal Sonic have their entries in their batches (above). Two findings from those
ports that affect any clone:

- **Metal Sonic runs on Fox's code.** `MxDt.dat` gives it Fox's `ftFx_*` entries
  and its state table uses Fox's callbacks, stored as raw DOL pointers without
  relocation. That is why `nosym.py` showed them as `-`; it now names them.
- **Export 34 is `onlanding`**, according to `m-ex/MexTK/ftFunction.txt`.

The ACE repos on GitHub do not include the fighters' C source: the original logic is the m-ex
`ftFunction` block (and `itFunction` for articles) compiled inside each `Pl*.dat`, with its
relocations. `PlSn`, `PlKx` and `PlLz` keep the author's **debug symbols**
(names of each callback: `SpecialNCharge_Anim`, `SpawnItem_Fire`, …); `PlSh`, `PlSc` and
`PlNm` do not. The local analysis used private Capstone-based tools:

- `disasm.py`: annotated disassembly (DOL names from `symbols.txt`, MexTK fields and
  `special_attributes` values).
- `nosym.py`: the symbol-less equivalent. It splits functions by:
  - m-ex export index;
  - `move_logic` callbacks (`M<motion>_<Anim|IASA|Phys|Coll>`); entries without
    relocation are raw DOL pointers (a clone's vanilla callbacks), not nulls;
  - local calls and tail-calls.
- `attrmap.py`: which attributes each callback of a clone reads compared with Sonic.
- `timelines.mts`, `lz-trace.mts` and `trace.mts`: frame-by-frame traces on the real ISO.

Conventions that came out of this:

- `itFunction` is `{count, MEXFunction*[count]}`.
- Item callback table: states, OnCreate, OnDestroy, OnPickup, …, OnGiveDamage(6), …,
  OnShieldHit(13).
- m-ex effect ids:
  - `5000+n` is model `n` of the fighter's effects file;
  - `6000+n` is generator `bank.first + n` of its particle bank.
  - `effBehaviorTable` = {model count, …, generator count, …}.
  - The renderer already launches both ranges from the script gfx
    ([web/src/render/common-effects.ts](../../web/src/render/common-effects.ts)). Models
    with a life < 1 frame are attachments managed by the code and are not launched.

- **Sonic / Knuckles** ([lib/game/sonic.ts](../../lib/game/sonic.ts),
  [lib/game/sonic-data.ts](../../lib/game/sonic-data.ts)): native state machine with the
  author's names.
  - Homing Attack with a real search for the opponent (radius `x30`, fallback to springs).
  - Spin Dash with stored charge (`ft_var2`).
  - Spring Jump with the persistent spring article
    ([lib/game/sonic-spring.ts](../../lib/game/sonic-spring.ts)).
  - Spin Charge by levels (speed and damage scale with the level).
  - Knuckles: 123 functions identical to Sonic's; his S is his own glide.
- **Shadow** (no symbols): `nosym.py` shows the same state table as Sonic
  (N 341-349, S 356-364, Lw 365-376 = Sonic shifted by 5), so he runs on Sonic's engine
  with his own block:
  - N at the same offsets as Sonic;
  - S at `0xA8-0xD8`;
  - Lw at `0xDC-0x150`.

  Real differences in the code:
  - the full Spin Dash charge ends at animation speed 1 (Sonic reads `xC0` = 2);
  - shield only cancels if pressed after `xA8`;
  - the Spin Charge has no frame cap (its `state_var9` only marks the sound `0x13E9`)
    and the first level does not reset the cooldown.

  His Hi, **Chaos Control** (`0x68-0xA4`), is Mewtwo's Teleport from the decomp
  (`ftmewtwospecialhi.c`) almost verbatim, plus a turn window of `xA0` frames:
  - 16-frame Start;
  - invisible, intangible zoom of `x78` = 8 frames at `x84·stick + x88` (2.08·s + 3.2);
  - along the ground if the stick points towards the floor;
  - collisions with a wall or ceiling at less than `x90`+90° head-on cut the zoom short;
  - exit at `x94` = 0.3 of the velocity;
  - special fall with a landing of 20 (`x9C`).
- **Charizard** ([lib/game/lizardon.ts](../../lib/game/lizardon.ts),
  [lib/game/lizardon-data.ts](../../lib/game/lizardon-data.ts),
  [lib/game/lizardon-projectiles.ts](../../lib/game/lizardon-projectiles.ts)):
  - **Flamethrower.** Uses two fuel tanks per fighter (`ft_var1` = speed,
    `ft_var2` = size):
    - they go from 360 to 40 and from 380 to 60, drop 1 per loop frame and refill 0.7/frame outside it
      (`RefuelFire`);
    - the loop lasts a minimum of 40 frames (`x14`) and then continues while B is held;
    - it releases a flame every 3 frames.

    Each flame:
    - leaves bone 27 at a random angle of 125-145° from the vertical (downwards),
      with speed 1.9-2.2 × speed tank and hitbox × size tank;
    - lasts 28 frames, with a hit only during the first 20;
    - passes through the opponent and shields;
    - reuses the `itKoopaFlame` Coll, so it rolls along the ground.

    The flames share a hit group (`xAC4_ignoreItemID`, renewed every 12): one
    hit marks the victim on every live flame in the group.
  - **S (Flare Blitz-like).** Start → 15 frames (`x54`) of charging forward with the animation's
    root motion (≈3 u/frame, 16%) → End with friction 0.16. In the air, End keeps ×0.55 and
    falls at `x64`, with special landing 30. The `Blown` states exist but nothing enters
    them.
  - **Hi (Fly).** The animation's root motion plus an accumulated stick drift
    (`ftCommon_8007D3A8` with `x70`/`x74`), no gravity; landing 30.
  - **Lw (Rock Smash).** Holds a rock (item 1, common bone `0x34`, removed on leaving the
    state) and on the script flags (frames 26-34) releases 5 fragments (item 2): 3%, 30-110°
    from the vertical, speed 4, 6 frames, no gravity. The model shows one variant per
    floor material (the port uses material 0).
  - **Jumps.** Jigglypuff/Kirby multi-jump at `attrs+0x7C` (jumps of 3 and 2.4, 12-frame
    turn).
  - **Visuals.** Tail fire every frame (6009 → generator 12009) and flames with their
    generator 6005+variant.

Verification in [tests/unit/ace-fighters-real.test.ts](../../tests/unit/ace-fighters-real.test.ts),
[tests/unit/ace-wave2-real.test.ts](../../tests/unit/ace-wave2-real.test.ts) (Shadow) and
[tests/unit/ace-wave4-real.test.ts](../../tests/unit/ace-wave4-real.test.ts) (Knuckles).

## Wave 8: Tails (Ts), Blood Falcon (Bf), Wolf SSBU (WfU)

Completes the playable roster of the ACE 2.0 CSS (mexproj 033, 045, 052). The only things
left out are the non-playable slots (Master Hand, Crazy Hand, Wireframes, Sandbag)
and the CSS's second Giga Bowser (slot 058, `PlGkp.dat`): compared against `PlGk.dat`
it has all 267 scripts and figatrees identical, `PlGkNr_001.dat` is byte for byte
`PlGkNr.dat`, and only two common-attribute words differ (+0xBC 2.5→2.7,
+0xFC 32→50). It is not registered as a separate fighter; its recolors `PlGkRe/Ye/Wh`
become costumes of `Gk`.

| | Code | Data / animations | Model | Skeleton | Selector |
| --- | --- | --- | --- | --- | --- |
| Tails | `Ts` | `PlTs.dat` / `PlTsAJ.dat` | `PlTsNr.dat` + 6 costumes | own, mexproj 033 (72) | 55 |
| Blood Falcon | `Bf` | `PlCa.dat` / `PlCaAJ.dat` (there is no `PlBf.dat`) | `PlBfNr.dat` + 4 costumes | Falcon's table (63) | 56 |
| Wolf SSBU | `WfU` | `PlWfU.dat` / `PlWfUAJ.dat` | `PlWf*_001.dat` (6) | Wolf's table (74) | 57 |

### New mechanism: clone files

`FIGHTER_FILE_OVERRIDES` in [lib/game/data.ts](../../lib/game/data.ts) resolves a slot's
`.dat`/`AJ` to those of its donor (`fighterDatFile`/`fighterAjFile`, used by
[lib/hsd/session.ts](../../lib/hsd/session.ts) and [lib/game/load.ts](../../lib/game/load.ts)).
Models go through `costumeModelFile` in [lib/game/costumes.ts](../../lib/game/costumes.ts)
with `COSTUME_FILE_PATTERNS` (Wolf SSBU's `_001` suffix). `specAvailable` requires all
three resolved files, so a disc without `PlBfNr.dat` does not advertise Blood Falcon
even though `PlCa.dat` exists in vanilla.

### Model loader fix (Tails)

`PlTsNr.dat` carries, on joint 0, a polygon flagged as enveloped (`0x2000`) with no
envelope list and with matrix indices 0-3: on console it reads GX slots from the
previous call. [lib/hsd/model.ts](../../lib/hsd/model.ts) skips it with a warning
instead of rejecting the whole model (before: `Vertex references an invalid skin envelope`).

### Kits

- **Tails** ([lib/game/tails-data.ts](../../lib/game/tails-data.ts),
  [lib/game/tails.ts](../../lib/game/tails.ts)): ported from the compiled m-ex code of
  `PlTs.dat`, which carries the author's debug symbols (analysis
  kept in private notes). All the constants are `ftDataTails` attributes.
  - **N:** tail swipe (6%) plus a shot: article 0 is a small tornado.
    - It leaves part 0x34 at 0.65/frame and floats with the common gravity (0.025 / 0.4).
    - It lands and slides; it lasts 52 + 10 frames and disappears on hitting.
    - Only one at a time (`ft_var1`). In the air the shot lifts him (xC).
  - **S:** rolling spin. `SpecialSStart` → up to 5 `SpecialSLoop` (2% multi-hit):
    - On the ground, the stick accelerates towards 0.8; without stick input, friction 0.03. In the air: gravity
      0.1 / 0.4 and drift.
    - Releasing B → `SpecialSEnd` (4% + 13% finisher, 14% in the air). The aerial version ends in
      special fall.
  - **Hi:** helicopter with fuel (`ft_var32`: 110 on landing, 60 if he gets hit).
    - Holding B spends 2/frame and rises (0.025, 0.3125 while boosting, cap 1.25).
    - Each press adds 0.75 and 4 frames of boost (−20 fuel). Without B, he glides.
    - Out of fuel → `Exhaust`. Special landing of 18.
    - `Cancel` is never used in the code.
  - **Lw:** it is Sonic's spin charge: 57 PlTs functions match PlSn and read their
    block shifted by +0x40. It runs on [lib/game/sonic.ts](../../lib/game/sonic.ts) with
    Tails' values:
    - Run 1.65 / 2.25 / 3, life 100, damage 4-6 (jump 3-5).
  - The action table is compacted (raw = index + 49 up to 272, +50 after that). Voices:
    direct samples from `tails.ssm` (base 1854); KO = `v_tails_rakka4`.
- **Blood Falcon**: Falcon's kit unchanged (`'Bf'` gates alongside `'Ca'`/`'Gn'`),
  his own `EfBfData.dat` (`effBloodDataTable`) and the `captain` bank.
- **Wolf SSBU**: Wolf's kit over SSBU animations; same duplicates with the
  specials one index later (`WFU_ACTION_KEYS`). Its parameters report
  `kind: 'Wf'`: `PlWfU.dat` carries the same ftFunction byte for byte, so it runs the whole
  Wolf port (the laser comes out on its script frame 15). `wolf_001.ssm` duplicates `wolf.ssm`
  sample for sample at base 2694; its sounds go through its SEM bank (101).

Verification: [tests/unit/ace-wave8-real.test.ts](../../tests/unit/ace-wave8-real.test.ts).
