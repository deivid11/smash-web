# Zero (Zx) — first modded fighter, ACE 2.0 extension disc

Back to [docs/characters/README.md](README.md). Base guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md).

Zero is the first fighter that does **not** come from the vanilla disc: he comes from the
**ACE 2.0** build (an Akaneia fork, m-ex system, repository `Chri222k/ACE-BUILD-PUBLIC-`).
The GitHub repository only contains the MexManager project (`data/fighters/051.json`
defines Zero); the actual files live inside the ISO patched with
`ACE.2.0.patcher.zip` (xdelta over a vanilla v1.02 ISO).

## Identity and files

| Item | Value |
| --- | --- |
| Disc code | `Zx` (`PlZx.dat`, `PlZxAJ.dat`, `PlZxNr.dat` + 5 costumes, `EfZxData.dat`, `GmRstMZx.dat`, `audio/us/zero.ssm`) |
| mexproj | fighter 051, `ftDataZero`, `effZeroDataTable`, soundBank 91 |
| Skeleton | `PlyLink5K` (Link): 76 parts, virtual part 68, 75 joints. The bone table is Link's, read from the **vanilla** `PlCo.dat` (`boneMaps.Zx` in [lib/game/data.ts](../../lib/game/data.ts)) |
| Selector | `ROSTER_CHOICES[16]`, card id 16 in [web/src/play/battle-select.tsx](../../web/src/play/battle-select.tsx) |
| SHA-1 of the ACE 2.0 DOL | `4963ea2dd7528851f2f8340f253052c9e38ce05a` (`ACE_20` in [lib/disc.ts](../../lib/disc.ts)) |

## Extension disc (never replaces the vanilla one)

ACE modifies vanilla files (`PlCo.dat`, effect banks and SSMs), so the modded ISO
**cannot** replace the primary source. The design is dual-source:

- [lib/hsd/modded-source.ts](../../lib/hsd/modded-source.ts): flat vanilla+ACE address
  space; extension entries are rebased after the vanilla `discSize`.
- [server/iso-source.ts](../../server/iso-source.ts): `openIsoSource(vanilla, ace?)`,
  verifies the ACE disc with `verifyAceDisc()` and only exposes `ACE_ASSETS`
  ([lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts)): `PlZx.dat`,
  `PlZxNr.dat`, `PlZxAJ.dat`, `EfZxData.dat` (later extended with Toad/Meta Knight/
  Sonic, see [ACE_FIGHTERS.md](ACE_FIGHTERS.md)). The alternate costumes and `zero.ssm`
  remain unexposed.
- Manifest: optional `modded { id, executableSha1, discSize }` block; the cache
  identity ([lib/hsd/asset-fetch.ts](../../lib/hsd/asset-fetch.ts)) includes it.
- Server: `MELEE_ACE_ISO=private/disc/ace-2.0.iso npm run serve`. Without that variable,
  the `optional: true` spec in [lib/game/load.ts](../../lib/game/load.ts) skips
  Zero, the card is hidden (portrait filter) and all tests skip him.

## m-ex quirks found

1. **HSDRaw animations**: the keyframe streams omit the final duration byte;
   `decodeKeyframes` ([lib/hsd/animation.ts](../../lib/hsd/animation.ts)) now tolerates
   EOF there. The vanilla originals are unchanged.
2. **Rebuilt action table**: `Wait` (not `Wait1`, two entries), three
   `Landing` entries (the vanilla submotion 35 rule does not apply; keyed to index 12),
   duplicated `SpecialS1`/`SpecialAirS1`. See `ZERO_ACTION_KEYS` in
   [lib/game/zero-data.ts](../../lib/game/zero-data.ts).
3. **Special logic in native code**: the attribute block of `ftDataZero`
   is 16 bytes long; the real parameters live in compiled PowerPC (`functions` in the
   mexproj points to code addresses). The constants in `parseZeroParameters()`
   are **approximations authored for this project**; hitboxes, animations and articles do
   come from the scripts of `PlZx.dat`.
4. **No root motion**: no Special has tracks on the motion root; Hienkyaku and
   Ryuenjin carry engine velocities in [lib/game/zero.ts](../../lib/game/zero.ts).
5. **Voice remapped by slot**: `soundBank 91` uses SEM IDs from ACE's smash2.sem (which
   also alters vanilla banks and is not exposed), so the 5xxx ids of the FtSFX
   never resolve. The spec carries `bank: 'zero'` and
   [lib/game/ace-voices.ts](../../lib/game/ace-voices.ts) translates jump/aerial
   jump/KO to the `v_link_jump1/jump2/rakka4` samples of `zero.ssm`, with a special
   voice when each direction starts. Hits still use the common
   sounds; damage grunts are pending (for all fighters).
6. **Announcer**: `announcerCall 510059` does not exist in the vanilla `nr_name.ssm`;
   `announcerCue()` falls back to the generic `confirm` cue.

## Implemented specials

| Move | States | Damage source |
| --- | --- | --- |
| Z-Buster (N) | `SpecialNStart/Loop/End` (+Air); 75f charge | articles 0/1 (`Blaster`): 5%/10%, `buster`/`buster-charged` projectiles in [lib/game/projectiles.ts](../../lib/game/projectiles.ts) |
| Hienkyaku (S) | `SpecialS1` → `SpecialS2` with a second B | dash with no hitbox (like the original) |
| Ryuenjin (Hi) | `SpecialHi`/`SpecialAirHi` → helpless | 16/44 script hits |
| Sentsuizan (Lw) | `SpecialLw` ground; `SpecialAirLw` → `SpecialLwLand` | 16 hits + 4 from the landing |

## Verification

- [tests/unit/zero-real.test.ts](../../tests/unit/zero-real.test.ts): registration without an ISO;
  with `MELEE_DISC_PATH` **and** `MELEE_ACE_ISO`, 10 integration cases (load, jab,
  buster with real damage, Ryuenjin, Hienkyaku, Sentsuizan, rollback with a live projectile).
- Transport verified: manifest with a `modded` block, range reads of
  `PlZx.dat` byte-for-byte identical to the ISO file, `PlZxBu.dat` → 404.
