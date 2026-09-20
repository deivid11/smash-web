# Importing an original character: from the ISO to the game

Back to [docs/characters/README.md](README.md).

## 1. Real scope and preparation

The project currently supports Fox, Mario and Kirby through original resources and specific adapters (Kirby is documented in [docs/characters/KIRBY.md](KIRBY.md) as a complete case of this guide). Their basic parsers can be reused, but **changing `Fx` to another code is not enough**. The structures of specials, articles, callbacks, bones and action names vary per character.

You need:

- Your own ISO/GCM of **Melee USA v1.02 / GALE01, revision 2**.
- Node and the project dependencies; the pinned toolchain if you are going to rebuild the WASM.
- A private directory, outside the repository and the web root, for inspections and captures.

All commands in this guide are run **from the root of `smash-web`**. They are not run from the upstream directory.

```bash
npm ci
# Only if this installation does not have the upstream prepared yet:
npm run upstream:setup

# Set the real path of YOUR disc, outside the web root:
export MELEE_DISC_PATH="$PWD/private/disc/my-disc.iso"

# For a disc not yet registered in this installation:
npm run disc:import -- "$MELEE_DISC_PATH"
```

The path in the example is a placeholder: replace the name with the existing file. The importer does not accept 7z/RVZ directly. It does not install every character either: it validates the disc and generates the private report. See [README.md](../../README.md) and [docs/SERVER_SOURCE.md](../SERVER_SOURCE.md) for the initial setup.

Do not repeat the import on an already prepared installation without checking which report/reference build you are using. Do not overwrite a different reference executable.

## 2. Identifying files and IDs

Common patterns —**confirm in the disc index, do not assume**—:

| Resource | Use |
| --- | --- |
| `PlXX.dat` | Attributes, action/script table, hurtboxes and other fighter data |
| `PlXXAJ.dat` | Animations; ranges of the entry are read according to the action table |
| `PlXXNr.dat` | Model/materials/textures of the neutral costume; other suffixes are usually costumes |
| `EfXXData.dat` | The character's effect bank when it exists |
| `PlCo.dat` | Common parameters and bone mappings |
| `audio/us/<bank>.ssm` | The character's SFX samples; the name is not necessarily derived from the code |
| `audio/us/smash2.sem` | Sound ID table/programs, shared |

There may also be shared resources, external references and articles inside the fighter data. The main model is not a complete list of dependencies.

### Verified example: Captain Falcon

On this installation's disc there are `PlCa.dat`, `PlCaAJ.dat`, `PlCaNr.dat`, `EfCaData.dat` and `audio/us/captain.ssm`. The neutral model and `Wait1` were read with **63 joints**, `Wait1` at **60 frames**, 98 meshes and 275 action entries. It is a check of the format, not of playability or full visual fidelity.

Distinguish **four identifiers**:

1. Disc code: `Ca`.
2. Native ID `FTKIND_CAPTAIN`: index 2 in [third_party/melee/src/melee/ft/forward.h](../../third_party/melee/src/melee/ft/forward.h).
3. Internal roster code: the one you register as `FighterKind`, normally `Ca` for this case.
4. Selector identity: use the fighter's `kind`, not a persisted index. Local packs use `custom:namespace.character` and are added after the original roster; see [docs/characters/CUSTOM_CHARACTERS.md](CUSTOM_CHARACTERS.md).

Bank/sample/SEM IDs are yet another classification. Do not deduce them from the selector index.

## 3. Local inspection without enabling new endpoints

This example works before widening the TypeScript unions of the Fox/Mario helpers. It uses `archive()` and `fighterActions()` for generic inspection, without faking another character's type.

```bash
export FIGHTER_CODE=Ca
node --import tsx --input-type=module <<'NODE'
import { openDisc } from './scripts/node-disc.ts';
import { verifyMeleeDisc, readExact } from './lib/disc.ts';
import { HsdAssetSession } from './lib/hsd/session.ts';
import { fighterActions, loadFigatree } from './lib/hsd/animation.ts';

const code = process.env.FIGHTER_CODE ?? 'Ca';
if (!/^[A-Z][A-Za-z]$/.test(code)) throw new Error('Invalid code.');
if (!process.env.MELEE_DISC_PATH) throw new Error('Set MELEE_DISC_PATH.');
const disc = await openDisc(process.env.MELEE_DISC_PATH);
try {
  const info = await verifyMeleeDisc(disc);
  const session = new HsdAssetSession(disc, info);
  console.table(info.files
    .filter(f => f.path.startsWith(`Pl${code}`) || f.path === `Ef${code}Data.dat`)
    .map(f => ({ path: f.path, bytes: f.size })));
  const metadata = await session.archive(`Pl${code}.dat`);
  console.log('Symbols:', [...metadata.symbols.keys()]);
  const actions = fighterActions(metadata);
  console.table(actions.slice(0, 20).map(a => ({
    name: a.name, offset: a.offset, bytes: a.size, script: a.scriptOffset,
  })));
  const model = await session.model(`Pl${code}Nr.dat`);
  const aj = info.files.find(f => f.path === `Pl${code}AJ.dat`);
  const action = actions.find(a => a.name === 'Wait1');
  if (!aj || !action || action.offset < 0 || action.size <= 0 ||
      action.offset + action.size > aj.size) throw new Error('Wait1 out of range.');
  const clip = loadFigatree(await readExact(disc, aj.offset + action.offset, action.size));
  console.log({ code, modelJoints: model.roots[0]?.joints.length,
    animationJoints: clip.joints.length, frames: clip.endFrame,
    meshes: model.stats.meshes, actionCount: actions.length });
  console.log('Warnings:', model.warnings);
} finally { await disc.close(); }
NODE
```

It does not write extracted models/textures or send the disc to another service. Reading an animation is limited to its AJ entry. Keep any research report under private/ignored storage, not under the web root.

Afterwards, do an isolated view with [web/src/render/model-instance.ts](../../web/src/render/model-instance.ts): neutral pose, both facings and several points of an animation. The current viewer also has typed options for Fox/Mario; **it has no universal selector for all characters**. If you extend it, review [web/src/viewer/ViewerApp.tsx](../../web/src/viewer/ViewerApp.tsx) and its components.

## 4. Extending the profile and bone mapping

Review/modify:

- [lib/game/data.ts](../../lib/game/data.ts): `FighterKind`, `CommonGameplayData.boneMaps`, `parseCommonGameplay()` and `parseFighterProfile()`.
- [lib/hsd/session.ts](../../lib/hsd/session.ts): signatures of `fighterData()`, `actionTable()` and `clip()`, today restricted to `Fx | Mr`.

For the new character:

- Use the correct native ID when reading the bone table from `PlCo.dat`.
- Check model, clips and `boneCount`; do not suppress validation to make them fit.
- Review `boneMap`, `motionRoot`, `shieldBone`, hurtboxes/grabbability and ledge snap dimensions.
- Preserve the bits/types of the **0x9c-byte** `words` prefix. There are floats and integers; do not reinterpret every field as a float.
- Audit the display name. The current parser has a Fox/Mario selection, not a generic name registry.
- Verify the attack direction: the model's local **Z** motion is transformed to the stage's **X** axis according to `facing`. Do not "fix" an incorrect mapping by multiplying offsets at random.

Multi-skeleton effects, transformations, morphs or hurtboxes outside the current budget require extending the reader in a justified and bounded way.

## 5. Building `FighterContent`, not just a model

The contract is in [lib/game/load.ts](../../lib/game/load.ts). It needs a profile, model, clips, timelines, attacks, specials and move names.

The current loader has a `['Fx', 'Mr']` loop and specific ternaries. Replace those decisions with an explicit descriptor/dispatcher for the new fighter. **Do not add it to the loop and let it fall into the Mario case.**

Check the real action names. For example, Fox uses `AttackS4`, Mario uses `AttackS4S`; not every fighter has `Attack13` or a rapid jab. Map only the actions that are present and supported. Review the current structural requirements of `moves` when the character does not have the same chain.

Prepare locomotion, jumps/fall, damage/landing, jab/dash/normals/aerials, charge, and the actions required by [lib/game/combat-data.ts](../../lib/game/combat-data.ts). If a character has an incompatible mechanic, implement its branch or declare it out of scope; do not silently substitute a clip with another character's.

[lib/game/moves.ts](../../lib/game/moves.ts) executes a **bounded subset** of scripts. Review each move's `ignoredOpcodes`. A script that parses does not imply that its effects or callbacks have been implemented. Preserve loops, subroutines, command lengths and hit/hurt/charge windows; do not turn an unknown command into a NOP if it alters gameplay.

## 6. Implementing real specials, articles and effects

Main points:

- [lib/game/special-data.ts](../../lib/game/special-data.ts): new parameter structures/layouts, articles and effects.
- [lib/game/specials.ts](../../lib/game/specials.ts): phase names, entry, advance, landing and exit.
- [lib/game/projectiles.ts](../../lib/game/projectiles.ts): projectile behaviour/collision/reflection.
- [web/src/render/play-effects.ts](../../web/src/render/play-effects.ts): accessories, attachments and effects.

Look for the native implementation in the character directories under [third_party/melee/src/melee/ft/kinds/](../../third_party/melee/src/melee/ft/kinds/), the articles under [third_party/melee/src/melee/it/](../../third_party/melee/src/melee/it/) and effects under [third_party/melee/src/melee/ef/](../../third_party/melee/src/melee/ef/).

Do not reuse `ftFox`/`ftMario` offsets to read another structure. `parseArticle()` and `parseEffectModels()` carry assumptions for the cases already integrated; the index, descriptor and state of the new article must be verified. An effect bank may contain pointers to particles before the model descriptors.

A bomb, tether, transformation or fighter pair requires more than a model: lifespan, collisions, owner, damage, mutual references, destruction and rollback state. The current projectile type does not arbitrarily admit every article either.

When a small native function is portable:

1. Add it to the extractor in [scripts/build-gameplay.ts](../../scripts/build-gameplay.ts).
2. Extend only the necessary private ABI in [engine/gameplay/bridge.h](../../engine/gameplay/bridge.h) and the wrapper in [engine/gameplay/core.c](../../engine/gameplay/core.c).
3. Update [lib/game/physics.ts](../../lib/game/physics.ts) and its ABI/provenance tests.
4. Run `npm run wasm:build` and check the function hashes.

**Do not edit upstream or rewrite a function and declare it "original, unchanged".** The bridge is not the full GameCube `Fighter` structure.

## 7. Authorising transport and loading audio

Add **only verified names** to [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts). You can organise a per-character list and combine it into `SERVER_ASSETS`; that organisation is a proposed refactor, not an API that already exists.

The same contract feeds [server/iso-source.ts](../../server/iso-source.ts) and the validation in [lib/hsd/server-source.ts](../../lib/hsd/server-source.ts). Currently `openIsoSource()` requires every declared resource. Changing the list can affect manifest compatibility and requires updating server and client together.

- Keep the read-by-name approach and the maximum ranges; do not open a `Pl*`, `Ef*` or `audio/*` wildcard.
- Do not expose the full ISO, the DOL, arbitrary offsets or the research directory.
- An asset that exceeds the HTTP limit needs a bounded read strategy; do not remove limits to make it pass.
- Register the new SSM in the audio loading of [lib/game/load.ts](../../lib/game/load.ts).
- Verify SEM IDs, sample base, channels, frequency and loops with [lib/game/audio.ts](../../lib/game/audio.ts).
- For the selection announcement, review [web/src/menu-audio.ts](../../web/src/menu-audio.ts) and [web/src/play/game-session.ts](../../web/src/play/game-session.ts). If there is no compatible announcement, use an explicit generic cue; do not pronounce another character's name.

## 8. Registering roster, React and rooms

| Place | What to update |
| --- | --- |
| [lib/game/load.ts](../../lib/game/load.ts) | Build and register the real content |
| [lib/game/roster.ts](../../lib/game/roster.ts) | Add the code to `ROSTER_CHOICES` without reordering existing IDs |
| [web/src/play/selection-scenes.tsx](../../web/src/play/selection-scenes.tsx) | `FIGHTERS`, labels, provenance and portrait types |
| [web/src/play/menu-previews.ts](../../web/src/play/menu-previews.ts) | List of models that generate thumbnails |
| [web/src/play/game-session.ts](../../web/src/play/game-session.ts) | Cues, HUD and preload/fingerprint |
| [web/src/play/match-hud.tsx](../../web/src/play/match-hud.tsx) | Use the explicit `kind` and the fighter's portrait; never reuse another character's art |
| [lib/net/protocol.ts](../../lib/net/protocol.ts) | `RoomFighter` and runtime validation of `choose` |
| [web/src/play/online-panel.tsx](../../web/src/play/online-panel.tsx) | Online selector/cue and labels |

The real UI is React. [web/src/play-page.ts](../../web/src/play-page.ts) is a compatibility entry point; writing imperative HTML there no longer changes the application correctly.

## 9. Full state and replay

[lib/game/match.ts](../../lib/game/match.ts) captures/restores the state; [lib/game/rollback.ts](../../lib/game/rollback.ts) re-simulates inputs. Every new piece of data that affects results must be part of that state: charge, cooldowns, partner, articles, counters, RNG, etc.

- Initialise state fields explicitly, preferably `null` rather than properties that appear/disappear.
- Do not keep authoritative logic solely in a Three.js object, audio or render closure.
- `Set` is covered by the canonical hash; do not assume that a `Map` or a new class serialises/hashes correctly without extending and testing the contract.
- Use the simulation RNG; never `Math.random()` or real time to decide hits.
- Online sound consumes confirmed events. Do not play an irreversible sound on every re-simulation.
- Verify code/WASM/resource fingerprints. Do not disable the rejection of differing versions to accept the new character.

## 10. Delivery checklist

- [ ] Correct model/animations and bones, front and back; warnings documented.
- [ ] Normals and specials with correct damage, timing, hitlag, knockback and resources.
- [ ] Shield/dodge/grab/throw/ledge, KO, pause and rematch with no residual state.
- [ ] Own audio; loops and articles are released.
- [ ] Roster: both local slots, mirror match and online slots 0–3 without confusing ID with slot.
- [ ] Late replay and restore reproduce state; four clients agree.
- [ ] No new asset requests on every frame.
- [ ] Privacy: only approved resources accessible; the rest stays at 404/403.

```bash
npm run typecheck
MELEE_DISC_PATH="$MELEE_DISC_PATH" npm run check
MELEE_DISC_PATH="$MELEE_DISC_PATH" npm run test:server-browser
```

Add real tests equivalent to [tests/unit/gameplay-real.test.ts](../../tests/unit/gameplay-real.test.ts), [tests/unit/specials-real.test.ts](../../tests/unit/specials-real.test.ts), [tests/unit/rollback-real.test.ts](../../tests/unit/rollback-real.test.ts) and the browser/server tests. Without an ISO, some cases are skipped: do not count a skip as verification.

Coordinate ports 5272/5274 and builds if there are several agents. The live service serves `dist`: prepare/validate changes and deploy client, WASM and server allowlist as one compatible set. Do not restart other projects' processes or open up the whole repository to resolve a missing path.

## Common failures

| Symptom | Priority check |
| --- | --- |
| Model visible, character standing still or wrong moves | Loader/dispatcher still falls into Fox or Mario |
| Arms/boxes outside the body | Bone map, costume and clip skeleton, root motion and scale |
| Hit goes backwards | Local Z → stage X convention and `facing` |
| Disappears mid-animation | Visibility flags, materials/alpha, billboard or bone indices |
| Model loads locally but fails on LAN | Allowlist, manifest, exact name, range size and server not updated |
| The new name shows but it talks/attacks like another | Audio, specials, portraits or article ternaries not generalised |
| Works locally and desyncs online | Uncaptured state, non-deterministic RNG/timing, fingerprint or wrong slot |
