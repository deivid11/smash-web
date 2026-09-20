# Ice Climbers duo (prototype Nana partner)

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Popo runs his own `ftPopo` code and data (`PlPp.dat`, `ftDataPopo`) with a dedicated
handler in [lib/game/popo.ts](../../lib/game/popo.ts). **Nana fights beside him as a
prototype partner entity** ([lib/game/nana.ts](../../lib/game/nana.ts)): she follows
Popo with deterministic kinematics, mirrors his animation while synced, swings
the same hammer from her own pose (duo hits can land twice in one frame), and
keeps her own damage pool. No WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Pp` |
| Native `FTKIND_POPO` | 10 |
| Stable selector index | **28** |
| Parameter symbol | `ftDataPopo` (`ftIceClimberAttributes`; partner x1A5C/x7C/x2222 fields unread) |
| Model | `PlPpNr.dat`: 49 joints, 45 meshes |
| Partner model | `PlNnNr.dat`: same 49-joint skeleton (validated at load; her `Re/Gr/Or` skins mirror Popo's costume order) |
| Metadata / animations | `PlPp.dat` / `PlPpAJ.dat` (260 actions) |
| Effects | `EfIcData.dat`, `effIceclimberDataTable` (particle-only) |
| Voices/SFX | `audio/us/ice.ssm` |
| Announcer | `0x7C83B` (`gm_80168C5C`, `CKIND_POPONANA = 14`), sample 1487 |

Specials use the leader (`_0`) action entries **242–259**
([lib/game/popo-data.ts](../../lib/game/popo-data.ts)). Nana swings the same leader
scripts from her own pose; her mirrored `_1` scripts (251, 252, 256, 257) stay
unloaded, so desyncs are out of scope.

## Normals

Jab `Attack11/12`, dash, side tilts (`AttackS3S` central), `AttackHi3/Lw3`, smashes
`AttackS4/Hi4/Lw4`, five aerials — all hitboxes from Popo's own scripts.

## Specials

| Move | Implemented behavior |
| --- | --- |
| **Ice Shot** — neutral | Hammer swing spawns the ice block on cmd0 (verified event). Air use stalls the fall once per airtime (`x224C` latch → `popoHoverUsed`, reset on landing). The block accelerates on slopes with the native normal-sign rule (`x18`/`x1C` selected by velocity-vs-normal sign, scaled by `x14`), dies below `x24`, and while sliding its damage is `\|vel\| * x30 + x2C` recomputed every frame ([lib/game/popo-projectiles.ts](../../lib/game/popo-projectiles.ts)). Life starts at `x0` ticks. |
| **Squall Hammer** — side | S1 raise into the S2 spinning advance with the original enter velocities, script hitboxes and clip lengths; ends idle grounded, helpless airborne. |
| **Belay** — up | Solo-geometry native path: Start, Throw rise (`xA4` once, `xA8`/`xAC` fall after), Throw2, helpless. The partner-throw heights stay unported, so Belay always rises the solo distance even with Nana active. Landing takes the original 25-frame lag. Ledge behavior is whatever the shared ledge system gives any helpless fighter. |
| **Blizzard** — down | cmd0==1 opens the spray interval, cmd0==2 closes it; a puff spawns every `xB8` frames from L3rdNa (part 26) plus the `xBC`/`xC0` offsets, inside the native downward-forward cone (`xC..x10` around straight down, simulation RNG) at `x4` speed with `x8` per-frame drift. |

### Explicit limitations (duo portdoc gaps)

- Nana is a synced prototype partner, not the original AI: she runs toward an
  anchor behind Popo, jumps after a rising Popo and lands on whatever floor is
  below (no input-delay desyncs, no recovery AI — beyond 120 units she regroups
  beside him with brief protection instead of flying/Belaying back).
- She mirrors Popo's animation/frame while synced and idles (Wait1/Fall) across
  grabs, captures, throws, ledges, tethers and downed states, so she never
  duplicates a held victim or floats on a ledge pose.
- Her hammer echoes every non-grab strike from her pose (separate victim keys,
  so duo double-hits are real); she never grabs, detects, shields, counters or
  captures, and grabs pass through her.
- She keeps her own percent (shown beside Popo's in the HUD): strikes knock
  her into a short tumble with real knockback coupling. Past a blast line she
  is KO'd into Sopo rules (Popo fights on) and revives on his next stock;
  Popo's KO hides her and respawns the duo together.
- Projectiles and items ignore Nana (fighter-strike scope only); Belay/Squall
  always take the solo-geometry branches; Blizzard sprays from Popo alone.
- Ice graze-accelerated melting (extra `x4` life loss on slow wall/victim grazes) is not modeled; blocks live their full `x0` ticks.
- Blizzard spray origin falls back down the finger chain if part 26 is unmapped (never crashes; exact when mapped).
- Squall S1→S2 and Belay phase advances run on clip ends; exact Nana-sync/cmd2 pull timings are simplified.
- Kirby does not copy Popo yet (`PlKbCpPp.dat` not loaded).

## State and online

Spray interval clock and hover latch live in `SpecialRuntime.popo` plus the
snapshot-owned `popoHoverUsed` fighter flag. Ice damage/position are projectile
state. Nana's plain-data state rides the owning fighter through snapshots,
rollback and the relay hash (no RNG, no wall clock). No wall-clock or
`Math.random` use. Registered in rooms; allowlist (`PlPp*.dat`, `PlNn*.dat`,
`EfIcData.dat`, `audio/us/ice.ssm`) needs joint frontend/server deploy.

## Validation

- [tests/unit/popo-real.test.ts](../../tests/unit/popo-real.test.ts): registration, 49-joint skeleton, full normals, ice spawn + sliding damage, blizzard spray, Squall advance/finish, Belay rise/helpless, poses both facings, snapshot restore + deterministic replay.
- [tests/unit/nana.test.ts](../../tests/unit/nana.test.ts): follow/jump/land/wall/blast/regroup/tumble kinematics, mirror rules, costume plumbing and lineup wiring — no disc required.
- [tests/unit/nana-real.test.ts](../../tests/unit/nana-real.test.ts): twin-model load, duo spawn, follow convergence, echo damage, Nana percent/tumble, Sopo KO + revive, rollback restore + deterministic replay.
