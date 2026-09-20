# Building the body in Blender + VFX and animations

Companion guide to [docs/characters/ADDING_A_FIGHTER.md](ADDING_A_FIGHTER.md) (code
integration, sections 2–3 for probing data) and
[docs/characters/CUSTOM_CHARACTERS.md](CUSTOM_CHARACTERS.md) (2.5D art direction).
This page covers the 3D path: modelling and rigging the full body in Blender, and what
to do with visual effects and animations so that the engine loads them.

> Honest reading first: this repo has **no universal GLB → `FighterContent`
> importer** (see [docs/characters/CUSTOM_CHARACTERS.md](CUSTOM_CHARACTERS.md),
> section 1). The engine reads original HSD files (`PlXXNr.dat` for the model,
> `PlXXAJ.dat` for animations, `EfXXData.dat` for effects). Blender is the
> **authoring** side; the **GLB-to-internal-structures loading** side is tooling that
> has to be built following the exact constraints below. Everything that follows
> must be checked against the engine code. For a local pack, implement an explicit
> model/pose adapter; the pack system does not convert GLB automatically.

## 1. The body: what the engine expects

Code references: [lib/hsd/model.ts](../../lib/hsd/model.ts) (model reader),
[lib/hsd/archive.ts](../../lib/hsd/archive.ts) (HSD archive reader).

### 1.1 Hierarchy = joint order

The skeleton is a tree of joints (`JObj`) traversed in **pre-order** (parent, then
children in order): each joint's index is its visit order, starting at 0.
That index is what the bone table (`boneMaps` in
[lib/game/data.ts](../../lib/game/data.ts), or your entry in
[lib/game/modded-bones.ts](../../lib/game/modded-bones.ts)) translates into a fighter
part. Practical consequences in Blender:

- Name the bones with the game's convention so you do not get lost (`TopN`,
  `TransN`, `XRotN`, `YRotN`, hip, `L*/R*` for arms/legs, `HeadN`,
  weapon/item hand). The engine does not read the names (it reads positions), but your
  bone table and your hurtboxes do depend on you knowing which index is which
  thing.
- Child order matters: reordering siblings in Blender renumbers the joints.
  Freeze the hierarchy before exporting/mapping and do not touch it afterwards.
- The count must match your table exactly (`63/63`, `118/118`…): the loader
  rejects the model if `joints.length !== profile.boneCount`
  ([lib/game/load.ts](../../lib/game/load.ts)). For vanilla fighters the count
  is exact; for modded ones there is tolerance only in clips, not in the model.

```text
0 TopN
└── 1 TransN          ← motion root (see 3.3)
    ├── 2 XRotN
    │   └── 3 YRotN
    │       └── 4 hip (HipN)
    │           ├── 5-10 leg L ...
    │           └── 11-16 leg R ...
    ├── 17+ torso/head/arms ...
    └── N item hand / throw / extra
```

### 1.2 What the engine does NOT evaluate (do not use it)

- **Quaternion** rotations (`flags & 0x20000`): a warning is issued and they are ignored. Use
  Euler XYZ on every bone.
- **Billboard** joints (`flags & 0xf00`): they are ignored. If you want faces that look
  at the camera (auras, flashes), do it as an effect (section 2), not as a bone.
- **Particles/splines** inside the model: they are omitted from the preview. Effects
  go in the effect bank, not hung from the body.
- Safety limit: 20,000 joints / depth of 128; real budgets are
  much smaller (fighters range between 53 and 118 joints).

### 1.3 Meshes and materials

- Each joint can carry draw objects (`DObj`); their ordinals are assigned in
  pre-order and feed `partVisibility` (costumes that hide/show pieces).
  If your character has costumes with alternative pieces, decide the groups
  here, not later.
- One texture per material as an approximation: the engine uses the first diffuse
  UV texture and ignores the rest of the TEV (`warnings: Multi-texture TEV…`). Do not
  design a look that depends on multitexturing.
- Textures in native GameCube formats (the ones decoded by
  [lib/hsd/texture.ts](../../lib/hsd/texture.ts): I4/I8/IA4/IA8, RGB565, RGB5A3,
  RGBA8, CMPR and palettes). Export in powers of two; there is a budget of
  16 M pixels per scene. A draw object without a material is omitted (with a warning).
- Rough budget: vanilla fighter meshes are around a few thousand
  triangles; keep the body + weapon below ~15 k triangles and check
  the model's `stats` on load.

### 1.4 Hurtboxes and gameplay bones

The damage capsules live in `ftData` (part + radii), not in Blender. But
they need sound bones: root/TransN, hip, head, hands, shield bone,
item-hold bone and the capture anchor (`boneMap[52]`). Verify that
all of them exist in your hierarchy before mapping them in
[lib/game/data.ts](../../lib/game/data.ts).

## 2. VFX: two worlds, do not mix them

Reference: `parseEffectModels` in
[lib/game/special-data.ts](../../lib/game/special-data.ts). Each bank entry
is a 20-byte descriptor (symbol + 8): model, animation and material
animation. The ID of a `gfx` event in a script is `gfx_id % 1000` of its bank.

### 2.1 Model effects (the ones that DO show up as-is)

They are mini HSD models with the same rules as section 1 (joints, simple
materials, optional animation). Examples the engine draws today: Fox
`shine-start/loop/hit`, `firefox-launch/charge`; Mario `fireball-muzzle`,
`tornado`; Kirby `cutter-blade/trail/burst`, `hammer-ground/air`. If your effect
is geometric (light sword, spinning top, shaped ball), create it in Blender as
a small standalone model with its own (short) animation and register it
in the bank table (`names: [[ordinal, 'name'], …]`).

### 2.2 Particle effects (the ones the engine does NOT emulate)

Most ACE banks are particle-bank (`efLib`) descriptors,
not models: the loader accepts them with `names: []` and draws nothing equivalent.
The project guardrails say it clearly: partial support for
materials/billboards and explicit supplemental approximations, **without**
TEV equivalence or full AX mixing. For these cases, in Blender + code:

1. Identify each effect by its ID (`gfx % 1000`) and note which script triggers it
   (the `gfx` events show up in the probe from section 3 of
   [docs/characters/ADDING_A_FIGHTER.md](ADDING_A_FIGHTER.md)).
2. Decide per effect: (a) simple geometry of your own (ring, cone, textured
   plane) registered as a model effect; or (b) a bounded cosmetic approximation
   in the renderer (maximum life/size, cleanup on roster change or stock
   loss), marked as an approximation in the docs.
3. Never use the effect's size as gameplay reach: the hitboxes rule.

### 2.3 Where they live

Per-fighter bank (`EfXXData.dat`, or the shared vanilla bank / `EfCoData.dat`
as a fallback, like Daisy, Fay or Skull Kid) plus `EfCoData.dat` for common things
(KO lightning, dust). Everything comes in through `ACE_ASSETS`/`SPECIAL_ASSETS` in
[lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts) with exact name and
size.

## 3. Animations: clips the engine accepts first time

Reference: [lib/hsd/animation.ts](../../lib/hsd/animation.ts) (`loadFigatree`,
`decodeKeyframes`, `fighterActions`).

- **One file per action** (`PlXXAJ.dat` is a catalogue): each figatree is a
  self-contained HSD archive (u32 length + a single symbol) with a per-joint
  track table terminated by 255.
- **Clip joint count = model joint count**, except for the trimmed-clip
  tolerance for modded fighters (`trimmedClips: true` — trailing joints without tracks
  stay in bind pose; vanilla ones require exactness).
- **60 fps clock**: `endFrame` is the duration; the simulation samples
  `animationFrame` (presentation never advances charge/hitlag clocks).
- **Real root motion**: only the TransN translation in track types 5/6/7
  (X/Y/Z), read by `rootDelta`. If your dash/advance must move the fighter,
  animate it there; if the clip carries no net translation (the Skull Kid `SpecialS` case),
  the engine does not invent it and the advance is authored in the engine with a documented
  constant. For rises, combine `flag101/102` (takeoff) with velocity.
- **Names**: the action table maps name → figatree offset/size.
  Respect duplicates with hitbox-bearing variants (the `*_ACTION_KEYS` pin the
  good index) and do not reuse the engine's timeout/fall names.
- In Blender: animate at 60 fps, clean curves (the decoder validates key
  budgets), readable contact poses on the frames where the script declares hits, and
  loops (walking, turns, charges) that close without a jump. Export the exact
  duration per action — `endFrame` rules cancels, IASA and rollback.

## 4. Voices and custom audio

DSP-ADPCM samples (8–48 kHz, mono/stereo) in `audio/us/<name>.ssm` banks
with their own base and count; jump/airJump/KO come from `ftData+0x4c`. The ACE
SEM carries no scripts for new banks: voice lines are triggered as
direct samples from the special ticks. Prepare clean WAVs (no
background noise, normalised, no loops unless the design calls for it) and map
one sample per special; the announcer stays on the generic cue until it has
its own call.

## 5. Blender → engine delivery checklist

- [ ] Frozen hierarchy + 54-entry table + count == joints of the Nr.
- [ ] No quaternions or billboards; no particles hung from the body.
- [ ] Visibility groups defined for costumes; DObjs with a material.
- [ ] Power-of-two textures, GameCube formats, within budget.
- [ ] Hurtboxes/shield/item/ledge-snap mapped to existing joints.
- [ ] One figatree per action with correct count and `endFrame`; root motion
      only where the design calls for it.
- [ ] Effects classified (model vs particle) with `gfx % 1000` IDs and their
      declared approximation.
- [ ] Voices per special + jump/KO; pending announcer declared.
- [ ] Everything verified with the probe (section 2 of
      [docs/characters/ADDING_A_FIGHTER.md](ADDING_A_FIGHTER.md)) before requesting
      integration: zero `MISSING`, zero `parse-err`, voices with their own base.
