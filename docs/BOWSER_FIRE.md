# Bowser's Fire Breath: why nothing was drawn

Scope: why the flame was invisible and what now draws it. A bounded port of one effect path, not a
claim of full particle/TEV equivalence.

## The cause

`itKoopaFlame` has **no geometry**. Loading Bowser's article and asking the model for its stats
returns `meshes: 0, vertices: 0, triangles: 0, joints: 1` — an empty joint, where Mario's fireball
has 2 meshes and Fox's laser 4. The projectile renderer drew it faithfully and there was nothing
to draw.

[itkoopaflame.c](../third_party/melee/src/melee/it/kinds/itkoopaflame.c)
`itKoopaFlame_UnkMotion0_Anim` shows where the look actually comes from: the first frame the item
lives, it runs `efSync_Spawn(1243 + x48_gfx, gobj, jobj)` once (`x44_spawned` guards the repeat).
[efsync.c](../third_party/melee/src/melee/ef/efsync.c) resolves `0x4DB`-`0x4DE` to
`efLib_CreateGenerator_Attach_Scale(0x2EE5..0x2EE8)` — four **particle generators attached to the
item**, so they ride it as it travels.

Those ids are not in the common bank. `12005..12008` live in Bowser's own `EfKpData.dat`, whose
generator table starts at 12000 and holds 9 entries. This port only ever read *model* descriptors
out of fighter effect archives, so no fighter particle bank existed to spawn them from.

## What now happens

- [lib/game/special-data.ts](../lib/game/special-data.ts) `parseEffectParticles` reads the
  fighter archive's own `ParticleBank` (fighters whose archive has no generator table keep none),
  exposed as `specials.particles`.
- [web/src/render/common-effects.ts](../web/src/render/common-effects.ts) can host extra players
  besides the common one: `spawnFrom(bank, key, generator, origin, …)`. Every player is stepped and
  drawn through the same sprite pipeline, with sprite keys prefixed per player so ids from
  different banks cannot collide, and each particle's texture read from its own bank.
- [web/src/render/play-effects.ts](../web/src/render/play-effects.ts) spawns the generator once per
  flame, exactly like `x44_spawned`, with a callback origin so the particles follow that flame down
  the screen.

## The palette bug this uncovered

The first flames spawned but every texture failed with `Unsupported palette format 16777218`.
[lib/hsd/particle-bank.ts](../lib/hsd/particle-bank.ts) read the palette format as the whole word
at `+8`. The common bank leaves that word's high half zero, so `0x00000002` happened to read as
RGB5A3 and nothing had ever caught it; Bowser's group stores `0x01000002`. The format is the word's
low half, and it is now read as such — the common bank decodes identically (`0x0002`), and the
fighter banks decode at all.

## Flame kinematics and reach

`itKoopaFlame_Spawn` rolls each flame's speed inside the article's `x8..xC` (1.9-2.2) scaled by the
speed pool (`x222C / da->x10`), and its launch angle inside `x10..x14` (125°-145°), which
`itKoopaFlame_UnkMotion0_Phys` drives as `(sin a, cos a)` with **no gravity and no decay** for the
article's whole 28-frame life. This port used to invent all of that (`speed * (0.45 + 0.55 * pool)`,
a ~10° angle, a pool-scaled lifetime); it now reads the real bounds.

Two behaviours that were cutting the stream short:

- `itKoopaFlame_Logic111_DmgDealt` returns **false**, so a flame is *not* destroyed when it burns
  someone — it passes through and keeps going (it simply never hits the same fighter twice). This
  port removed it on contact, so against an opponent in range the jet never got past them at all
  (measured reach: 0 units, now 19).
- `itKoopaFlame_UnkMotion0_Anim` rescales the hitbox by the range pool every frame, so a draining
  breath burns a thinner stream. The radius now follows the pool.
- The flames leave the mouth aimed 35°-55° **downward**, so they reach the ground almost at once.
  `itKoopaFlame_UnkMotion0_Coll` does not end them there: `itKoopaFlame_Update_Direction` folds every
  touched surface normal into the flame's preferred heading, and `itKoopaFlame_Update_Angle` steers
  the travel angle toward it — 2% of the gap a frame while the two nearly agree, 50% once they do
  not — so a flame that meets the floor rolls along it and curls away. This port deleted flames on
  floor contact, which with the real downward aim killed the whole stream a few units out of the
  mouth. Measured reach: 0 units on contact with an opponent, 19 once flames stopped dying on them,
  **59** now that they ride the floor (the article's own 2.2 x 28-frame ceiling is 61).

## Known gap: the burn rate

`ftKp_SpecialN_IASA` spawns a flame **every frame** while B is held and drains both pools by 1 a
frame. This port spawns one every three frames and drains 2 a frame instead. The cadence is *not*
raised to the original's, because every flame here lands a full hit on a victim who can be hit again
the very next frame: a stationary target already takes ~22 hits and 44% in 90 frames, and the
original cadence would triple that. Whatever bounds the burn in the original (the flame's 20-frame
hitbox window out of its 28-frame life, or a per-victim rehit gate this port does not model) has to
land first.

## Deviations

- The flame's variant (`x48_gfx`, one of four) comes from the same random direction table the
  original uses for the flame's angle. Presentation cannot draw from the simulation's RNG, so the
  variant is taken from the projectile's own id instead — deterministic and rollback-safe, but not
  the original's draw.
- The spawn cadence stays this port's own (see the burn-rate section above).
- Kirby's copied Fire Breath uses `It_Kind_Kirby_KoopaFlame` and generator ids `1189 + x48_gfx`
  from his own bank; only Bowser's path is wired.

## Validation

`tests/unit/koopa-real.test.ts` — the flame article is mesh-free and Bowser's bank answers for all
four flame generators, so a future article/bank regression fails here rather than silently going
invisible again. Requires `MELEE_DISC_PATH`.
