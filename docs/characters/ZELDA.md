# Zelda: original ISO fighter with Transform

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Zelda runs her own `ftZelda` code and data (`PlZd.dat`, `ftDataZelda`) with a dedicated
handler in [lib/game/zelda.ts](../../lib/game/zelda.ts) and fire physics in
[lib/game/zelda-projectiles.ts](../../lib/game/zelda-projectiles.ts). Her down-B
swaps to Sheik mid-match through shared, snapshot-safe transform infrastructure.
No WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Zd` |
| Native `FTKIND_ZELDA` | 19 |
| Stable selector index | **29** |
| Parameter symbol | `ftDataZelda` (`ftZelda_DatAttrs`) |
| Model | `PlZdNr.dat`: 118 joints, 79 meshes |
| Metadata / animations | `PlZd.dat` / `PlZdAJ.dat` (261 actions) |
| Effects | `EfZdData.dat`, `effZeldaDataTable` (particle-only) |
| Voices/SFX | `audio/us/zs.ssm` (shared Zelda/Sheik bank) |
| Announcer | `0x7C851` (`gm_80168C5C`, `CKIND_ZELDA = 18`), sample 1509 |

Specials use action entries **245–260** ([lib/game/zelda-data.ts](../../lib/game/zelda-data.ts)):
Nayru, Din Start/Loop/End (+air), Farore Start/Travel (+air), Transform Lw/Lw2 (+air).

## Normals

Single jab `Attack11` (no second jab in the table), dash, three tilts, `AttackS4S`,
`AttackHi4/Lw4`, five aerials — all hitboxes from Zelda's own scripts.

## Specials

| Move | Implemented behavior |
| --- | --- |
| **Nayru's Love** — neutral | Spin with script hitboxes; cmd0 latches the original ReflectDesc for the rest of the move (native promotes cmd0 1→2 and stays reflecting). Air variant divides entry velocity and falls with herOriginal gravity. |
| **Din's Fire** — side | Start spawns the fire on cmd0 at the part-89 muzzle plus the `x20`/`x24` offsets; Loop guides while held then Ends on release. The fire accelerates (`x18` to `x1C` cap), steers with the owner's stick inside the deadzone/clamp (`x20`/`x24`/`x28`, 1-frame input lag, deterministic), and detonates on stage/fighter contact or fuse timeout. Blast damage is the exact `guideFrames * x10 + xC` law; blast radius is priced by its own damage (no radius constant exists in her articles — verified by exhaustive state scans at every stride). Knockback shape is borrowed from Mario's fireball (same fire family), flagged in code. |
| **Farore's Wind** — up | Vanish, aimed teleport ride at `(x54*mag + x58)` velocity for the `x48` vanish frames (stick threshold `x50`), then helpless with the original 30-frame landing lag. Invisible during travel like Mewtwo. |
| **Transform** — down | Lw/Lw2 with the original velocity divisors, then an in-place content swap to Sheik (position, percent, stocks, facing, velocity and groundedness carry; moveset/model/WASM attributes swap; snapshot carries the content kind so rollback restores the same side). No dormant partner entity is simulated — unobservable in prototype scope, where 1v1 never exposes the sleeping half. Character select presents the pair as one slot with two starting forms (Zelda or Sheik). |

### Explicit limitations

- Zelda holds still while guiding (the `x28..x34` loop-drift block is unread); travel/blast visuals don't scale (no particle/TEV equivalence, like every fighter).
- Din's travel capsule is inert (impacts skip unexploded fire, mirroring PK Flash); reflection flips it genericallly and stops steering.
- Transforming with a live guided fire detonates it (owner left the loop); native keeps it ballistic.
- Sweetspot/aim nuances of Farore's beyond threshold/distance/landing are simplified; teleport passes through floors.
- Kirby does not copy Zelda yet (`PlKbCpZd.dat` not loaded).

## State and online

Nayru latch, Din's counters/fired flag, Farore aim/travel age live in
`SpecialRuntime.zelda`; fire guide frames and exploded state are projectile
state; transform target rides `SpecialStep.transform` and snapshots. No
wall-clock or `Math.random` use. Registered in rooms; allowlist (`PlZd*.dat`,
`EfZdData.dat`, `audio/us/zs.ssm`) needs joint frontend/server deploy.

## Validation

- [tests/unit/zelda-real.test.ts](../../tests/unit/zelda-real.test.ts): registration, 118-joint skeleton, single jab, both Din articles, Nayru latch via `reflector()`, Din spawn/guide/detonate, Farore recovery, poses both facings, snapshot restore + deterministic replay. Transform both directions is covered in [tests/unit/sheik-real.test.ts](../../tests/unit/sheik-real.test.ts).
