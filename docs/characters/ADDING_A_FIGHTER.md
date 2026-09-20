# Adding a fighter: code-integration guide

Companion to [docs/characters/CUSTOM_CHARACTERS.md](CUSTOM_CHARACTERS.md) (art direction,
2.5D pipeline) and [docs/characters/ACE_FIGHTERS.md](ACE_FIGHTERS.md) (27 worked
examples, waves 1–6). This page is the **code recipe**: every file you must touch
to take a fighter from data files to selectable, audible, rollback-safe roster
member, plus the failure gallery from real ports.

There are two paths. Pick first; everything below assumes you did.

- **Path A — disc/ACE fighter (recommended).** The moves, hitboxes, animations,
  models, effects and voices already exist as `PlXX.dat` / `PlXXAJ.dat` /
  `PlXXNr.dat` / `EfXXData.dat` / `audio/us/xxx.ssm` on a disc you own. You wire
  them up; you author only orchestration constants (speeds, lags, voices). All
  27 ACE fighters took this path.
- **Path B — fully custom character.** No disc data; you author attributes,
  skeleton, hurtboxes, timelines and art. Follow
  [docs/characters/CUSTOM_CHARACTERS.md](CUSTOM_CHARACTERS.md) sections 4–7 for the
  factory/renderer side, then rejoin this guide at [8. Roster, UI and online](#8-roster-ui-and-online)
  and [10. Tests and gates](#10-tests-and-gates).

---

## 1. Claim an identity

- Two-letter `kind` code, unique across
  [lib/game/data.ts](../../lib/game/data.ts) (`OriginalFighterKind`). Check the ISO
  first: ACE-era codes already taken include `Zx Td Mk Sn Rc Lz Wf Dd De Wr Sh Bl Lc Nm Nt Da Fy Sc Dl Kx Lu Lc2 Sm Lb MM Sd Cn Gk Ts Bf WfU`.
  Clone slots that reuse a donor's data/animation files register them in
  `FIGHTER_FILE_OVERRIDES` (data.ts) and odd model names in `COSTUME_FILE_PATTERNS`.
- Visible name goes in `ORIGINAL_FIGHTERS` with `nativeKind: -1` (custom
  skeletons carry no vanilla index; Zero is the exception — it rides Link's
  table with `nativeKind: 6`).
- New kinds **append** to [lib/game/roster.ts](../../lib/game/roster.ts)
  (`ROSTER_CHOICES`). Never reorder: selector indices, replays and room codes
  depend on stability.

## 2. Probe the data before writing a line

Write throwaway inspection scripts (keep them outside the repo, e.g. next to
your notes — never in `/tmp` shared space blindly, never committed) using
[scripts/node-disc.ts](../../scripts/node-disc.ts),
[lib/disc.ts](../../lib/disc.ts) (`openDisc`/`inspectDisc`/`readExact`) and
[lib/hsd/archive.ts](../../lib/hsd/archive.ts). For a candidate code, extract:

1. `ftData*` symbol name, action-table size, `maxJumps` (`u32` at attrs `+0x58`),
   weight / jump speed / gravity (sanity only).
2. `PlXXNr.dat` model joint count via [lib/hsd/model.ts](../../lib/hsd/model.ts)
   (`loadModel`). **It must equal your bone table count**, or loading throws.
   A model that throws here blocks the port until the model loader is fixed —
   check this first (Tails' `invalid skin envelope` was an enveloped polygon
   with no envelope list; the loader now omits such polygons with a warning).
3. For every standard move (`Attack11/12/13`, `Attack100*`, `AttackDash`,
   `AttackS3S/Hi3/Lw3`, `AttackS4(S)`, `AttackHi4/Lw4`, five aerials): which
   action indices exist and how many `create` events each script carries (via
   [lib/game/moves.ts](../../lib/game/moves.ts) `parseAttack`). **Only moves with
   real hitboxes may go in `moves`** — the loader throws otherwise.
4. For every `Special*`: index, `create` count, `flag` events (especially
   `flag24` = Mario-style projectile spawn, `flag101/102` = ground detach),
   `command` events, and whether the clip carries root motion (joint 1 tracks
   of type 6/7 with net delta — see `rootDelta` in
   [lib/game/specials.ts](../../lib/game/specials.ts)).
5. Article table (`+0x48`): which slots parse via `parseArticle`, with what
   damage/lifetime. Slots can be corrupt, hitless (models only) or carry
   zeroed fields the native spawn used to own (DrLuigi's pill shipped
   `lifetime 0` — authored to 50, documented).
6. `EfXXData.dat` effect symbol and `audio/us/xxx.ssm` base/count. Note the
   **exact filename case** (`chun-li.ssm`, `PlMM.dat` — the allowlist is
   case-sensitive and a wrong case fails loudly at serve time, silently at
   review time).
7. Duplicates: group actions by name. Repeated names are the norm in m-ex
   tables (`Landing` ×3, `Wait1` ×2, triple `SpecialNStart`, `AttackS4` ×3…).
   For each duplicate, record which index carries hits — that index is the one
   you pin (below).

## 3. Bone table

Add to `MODDED_BONE_TABLES` in
[lib/game/modded-bones.ts](../../lib/game/modded-bones.ts): `table(count, map)`
with the 54-entry common-bone → part map in canonical order
(`top, trans, xRot, yRot, hip, waist, lLegA…lFoot, rLegA…rFoot, waistB, bust,
lClavicle…lThumb2, neckN, headN, rClavicle…rThumb2, throw, extra`).
Best source is the mexproj `boneDefinitions` lookup; otherwise author from the
model and validate `map.length === 54`, every entry `255` or `< count`, and
`count` against the Nr joint count. Register it in `boneMaps` in
[lib/game/data.ts](../../lib/game/data.ts). Virtual parts stay empty for these
rigs (every part owns a joint).

## 4. Data file (`lib/game/<name>-data.ts`)

- `parse<Name>Parameters`: assert the `ftData*` symbol exists (cheap tripwire
  against wrong-disc mistakes), return **authored** orchestration constants
  (speeds, lags, charge frames) plus **voice sample IDs** (direct `ssm` sample
  numbers — see section 7). The ACE tuning lives in compiled m-ex code; say so
  in the doc comment. Never claim these are original values.
- `parse<Name>Articles`: one `parseArticle` per used slot. Slots that are
  corrupt, hitless-but-model-only, or slot-duplicates get documented, not
  forced.
- `*_ACTION_KEYS`: one entry per needed clip — `{ key, index, figatree }`.
  Pin the **hitbox-carrying** duplicate (Wolf `SpecialNStart` 244, Shadow
  `SpecialS` 263 over 262, Dedede `SpecialNLoop` 247…). `key` is your clip name,
  `figatree` must equal the table entry's real name (the loader verifies).
  Quirks encountered: bare figatree names without the `_ACTION_` wrapper
  (Knuckles idle/walk/run load *only* through keys), `CliffWait1/2` splits
  (key the first, Falcon-style), `AttackS4` ×3/`AttackS3S` ×3 with the primary
  in the middle (Toad 52, Wario 52).
- `*_MOVES`: only verified-hitting moves. Fields are optional — omit what's
  absent (`sideTilt`, `jab3`, rapid parts). Corrupt clips stay out even if the
  move "should" exist (Wario's 166-byte `Attack13`, Skull Kid's out-of-range
  `AttackHi3`).

## 5. Gameplay file (`lib/game/<name>.ts`)

Four functions plus a snapshot-owned runtime interface, following e.g.
[lib/game/toad.ts](../../lib/game/toad.ts) (single-state) or
[lib/game/sonic.ts](../../lib/game/sonic.ts) (charge/dash phases):

- `*SpecialName(f, direction, phase)` — clip keys per state. Reuse ground clips
  for air when the table has no air variant (BSonic air charge, Skull Kid air Hi).
- `begin*` — init runtime, zero what's held. Grounded holds must **stay
  grounded** until travel launches, or the holder falls through the floor on
  frame 1 (Wolf/Diddy up-special lesson).
- `step*` — advance phases, apply `rootDelta` travel **or** motor velocity
  (check which the clip actually carries — Wolf `SpecialS` bursts 72 units,
  Skull Kid `SpecialS` carries ~0 and needed a motor), fire projectiles on the
  script's own cue (`flag24`, release, charge threshold — never invent spawn
  timing), push voice sample IDs on `s.age === 0`, finish with helpless + lag.
- `land*` — landing lag for travel/up states, re-sync otherwise.

Rules: hitboxes/animations come from scripts; orchestration is labelled
engine-authored; state that affects outcomes lives in the runtime (rollback
restores it — verified by test); cosmetic randomness never touches match RNG.

## 6. Shared logic or new logic?

Prefer the existing family implementation when the kit matches, generalizing
its kind checks (Roy/Marth→Lucina in [lib/game/roy.ts](../../lib/game/roy.ts);
Luigi→DrLuigi→Luigi&Boo in [lib/game/luigi.ts](../../lib/game/luigi.ts);
Mewtwo→Shadow Mewtwo in [lib/game/mewtwo.ts](../../lib/game/mewtwo.ts);
Mario tail for Metal Mario with zero new branches). Generalizing? Then:

- Split single-literal `kind` interfaces into `Base + PerKind` so
  discriminated-union narrowing keeps working everywhere (a `kind: 'Lg'|'Dl'`
  union poisons every downstream `else` branch — real wave-4 breakage).
- Keep vanilla behavior byte-identical: gate every behavior change on the new
  kind (Shadow Mewtwo's voiceless charge ticks, its End-without-command-1
  firing, its hitless-Disable guard).
- New `ProjectileKind`s go in [lib/game/specials.ts](../../lib/game/specials.ts)
  with spawn + physics + absorb/reflect/reflect + capture/restore entries in
  [lib/game/projectiles.ts](../../lib/game/projectiles.ts). Reuse a shared kind
  only when the article layout is identical (DrLuigi/Luigi&Boo fire `fireball`).

## 7. Audio: voices are direct samples

The ACE `smash2.sem` carries **no scripts** for extension banks (verified:
every new bank returns zero cues). So in-match voices are raw `ssm` sample IDs
pushed from `step*` (pick medium-length samples; ~1–3 s lines read as voice,
sub-0.5 s as SFX), played through the direct-sample fallback in
[web/src/play-audio.ts](../../web/src/play-audio.ts). Jump/airJump/KO come from
`ftData+0x4c` verbatim. Announcer stays on the generic `confirm` cue (new
`5100xx` calls all map to the same placeholder sample) — declare it pending
rather than borrowing another fighter's voice. `SsmBank` bases seen so far:
1566 Wolf … 2497 Chun-Li (41 tables and counting — read yours off the probe).

## 8. Roster, UI and online

- [lib/game/load.ts](../../lib/game/load.ts): one `FIGHTER_SPECS` entry —
  `effects` file, `bank` (ssm basename, exact case), `optional: true`,
  `trimmedClips: true`, `keyed`, `extraClips`, `moves`, `articles`, plus
  `airJumps` (only for `maxJumps > 2`), `canGrab: false` (tether grabs like
  Lucas's Rope Snake, part 139), `motions.crouchWait` (tables without
  `SquatWait` use `SquatWait1`).
- [lib/game/roster.ts](../../lib/game/roster.ts): append (never reorder).
- [lib/net/protocol.ts](../../lib/net/protocol.ts): append to `RoomFighter` /
  `ROOM_FIGHTERS` (same order).
- [web/src/play/battle-select.tsx](../../web/src/play/battle-select.tsx): card
  with next stable `id`, honest subtitle + `ACE 2.0 mod fighter` provenance.
- [web/src/render/game-rig.ts](../../web/src/render/game-rig.ts): both
  visibility lists; teleport invisibility if the kit needs it (Mewtwo line).
- `announcerCue` stays generic; extend the `CUSTOM` list in
  [tests/unit/announcer.test.ts](../../tests/unit/announcer.test.ts).
- [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts): every
  `PlXX/AJ/Nr`, `EfXXData` (skip when sharing a vanilla bank — Daisy, Fay,
  DrLuigi, Lucina, Luigi&Boo, Metal Mario, Shadow Mewtwo, Skull Kid) and `ssm`
  file. Exact case. Then verify against the ISO (the check script pattern in
  section 2 — zero `MISSING` lines or `serve` refuses to start).

## 9. The relay rule (read this before testing in browser)

The LAN relay bakes the manifest **at startup**. After any change to
`ACE_ASSETS`, `dist`, or `ROOM_FIGHTERS`, restart it together with the new
build — a new frontend against an old relay fails manifest validation
(`Missing declared modded extension assets.`) and the game sits on
*Loading original assets…* forever; old frontend against new relay fails the
other way. From the repo root:

```bash
MELEE_ACE_ISO=private/disc/ace-2.0.iso node --import tsx scripts/serve.ts
```

Expect `<N> runtime assets available` with N grown by your file count, then
hard-refresh the browser (cached old JS produces the same stall). Never pair
mismatched builds, never serve the repo/home directory, never kill other
projects' processes for a port.

## 10. Tests and gates

- New `tests/unit/ace-wave<N>-real.test.ts`: registration block (selectors,
  room entries, `ACE_ASSETS` ⊆ allowlist / ⊄ `SERVER_ASSETS`, bone counts,
  voice-bank bases) plus integration block (load with real ISO, jab,
  rollback snapshot/restore, one assertion per special: projectile kind seen +
  damage, travel distance, rise peak + helpless/landing, holdable loops).
- Test geometry honestly: melee assertions point-blank (gap 8), projectiles at
  range (gap 40), travel assertions measure displacement not survival (long
  dashes can leave the stage — Wolf Flash covers ~72 units). Deterministic
  RNG means misfires/tunneling reproduce: gap-8 tests can tunnel past
  late-arming hits (document the arming frames; Diddy/Metal missiles want
  gap 20–40).
- Gates, from the repo root with a real ISO:
  `npm run typecheck`, the new test file with `MELEE_DISC_PATH` +
  `MELEE_ACE_ISO`, full `npm run test`, `npm run build`, `npm run test:browser`.
  `test:server-browser` additionally for transport changes. Declare skips;
  never ship an incomplete port as finished.

## 11. Failure gallery (all met in waves 1–6)

- Corrupt figatrees (`HSD data out of bounds`): omit the move/clip, document
  (Wario `Attack13`, Metal `LwStart` → start in Loop).
- Unparseable scripts (out-of-range hitbox ids/opcodes): omit or remap the key
  (Shadow Mewtwo charge loops reuse Start; Skull Kid up tilt omitted).
- `Invalid original hitbox bone` at load: part without a joint — check the
  move's bone against the table (Lucas tether grab → `canGrab: false`).
- Zeroed article fields the native spawn owned (DrLuigi pill `lifetime 0`):
  author the single field at Luigi parity, document.
- Inverted min/max attr blocks (Shadow Mewtwo ball): author flight, keep the
  verbatim common block.
- Wrong-case asset names (`PlMm` vs `PlMM`, `chun-li.ssm`): the disc is
  case-sensitive; the server error names the file.
- Grounded holds falling through floors; air dashes landing early and dying
  mid-travel (Knuckles homing needed a flatter dive); charge loops that never
  release without a second press (Mewtwo pattern needs tap–wait–tap).
- Shared-logic widening breaking narrowing: split interfaces per kind, gate
  behavior changes on the new kind, keep vanilla paths untouched.
