# Guides for adding characters

These guides belong to **Smash Web**, the project in this repository. Not to the neighbouring `smash-js` project.

## Choose the right path

| Goal | Guide |
| --- | --- |
| Add a character that already exists on the Melee disc | [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md) |
| See a complete case of that guide (Kirby: virtual parts, multiple jumps, four specials) | [docs/characters/KIRBY.md](KIRBY.md) |
| Samus: limited playable import, articles and tether limits | [docs/characters/SAMUS.md](SAMUS.md) |
| Pikachu: shared scripts, two zips, Thunder Jolt and Thunder segments | [docs/characters/PIKACHU.md](PIKACHU.md) |
| Review Roy: charge, side special chain, recovery and Counter with explicit limits | [docs/characters/ROY.md](ROY.md) |
| Review Captain Falcon: Raptor Boost detection, Falcon Dive grab and Falcon Kick braking | [docs/characters/FALCON.md](FALCON.md) |
| Review Donkey Kong: Giant Punch wind-up charge, ground/air Spinning Kong and ground-only Hand Slap | [docs/characters/DONKEY_KONG.md](DONKEY_KONG.md) |
| Review Mewtwo: storable Shadow Ball charge, Confusion reflection, invisible Teleport and Disable | [docs/characters/MEWTWO.md](MEWTWO.md) |
| Review Falco: Fox clone (illusion slot 3, own laser) | [docs/characters/FALCO.md](FALCO.md) |
| Review Dr. Mario: Mario clone (pill slot 1, cape slot 3) | [docs/characters/DRMARIO.md](DRMARIO.md) |
| Review Ganondorf: Falcon clone (single jab, same scripts) | [docs/characters/GANON.md](GANON.md) |
| Review Pichu: Pikachu clone (same layout, no recoil yet) | [docs/characters/PICHU.md](PICHU.md) |
| Review Marth: Roy clone (same MarsAttributes table, tipper in hitboxes) | [docs/characters/MARTH.md](MARTH.md) |
| Review Luigi: green missile with misfire, Super Jump Punch and cyclone | [docs/characters/LUIGI.md](LUIGI.md) |
| Review Ice Climbers: duo with prototype Nana (chasing, hit echo, own pct) | [docs/characters/POPO.md](POPO.md) |
| Review Zelda: Nayru, guided Din, Farore teleport and Transform | [docs/characters/ZELDA.md](ZELDA.md) |
| Review Sheik: accumulated needles, chain, Vanish and Transform | [docs/characters/SHEIK.md](SHEIK.md) |
| Review Mr. Game & Watch: sausages, Judgment RNG, Fire and Oil Panic | [docs/characters/GAMEWATCH.md](GAMEWATCH.md) |
| Review Yoshi: egg trap, Egg Roll, timed eggs and stars | [docs/characters/YOSHI.md](YOSHI.md) |
| Review skins: 94 original costumes from the disc, per-seat selector, visual-only | [docs/characters/COSTUMES.md](COSTUMES.md) |
| Review Zero: first modded fighter (ACE 2.0/m-ex), dual-source extension disc and custom-authored specials | [docs/characters/ZERO.md](ZERO.md) |
| Review the ACE wave: Toad, Meta Knight and Sonic (mexproj bone tables, trimmed clips, modded multi-jump) | [docs/characters/ACE_FIGHTERS.md](ACE_FIGHTERS.md) |
| Design your own character or one from another universe, with generated/drawn art | [docs/characters/CUSTOM_CHARACTERS.md](CUSTOM_CHARACTERS.md) |
| Integrate a fighter in code (full recipe after 27 ports: probes, bones, specials, voices, roster, tests) | [docs/characters/ADDING_A_FIGHTER.md](ADDING_A_FIGHTER.md) |
| Build a body in Blender + VFX and animations (engine formats, what is/is not emulated) | [docs/characters/BLENDER_PIPELINE.md](BLENDER_PIPELINE.md) |
| Create and install local packs (data, sprites, state and online hashes) | [docs/characters/CUSTOM_CHARACTERS.md](CUSTOM_CHARACTERS.md) |

**There is installation of reviewed local packs, not a universal model-to-fighter importer.** `npm run packs -- install <directory>` copies a manifest and its declared runtime files; `npm run packs -- enable namespace.character` activates it. You have to implement the gameplay/render contract in [lib/custom/types.ts](../../lib/custom/types.ts). Adding a model or an option to the selector does not create moves, collisions or rollback state.

## Three distinct deliverables

1. **Visible asset:** a model or sprite that draws correctly.
2. **Playable character:** attributes, collisions, moves, specials, sound, defence, grabs, ledges and selection.
3. **Online-compatible character:** the above plus serialisable/restorable state, identical content and replay/rollback validation on two and four clients.

Always state which of the three has been completed. An original model does not prove engine fidelity; a custom character does not magically contain original Melee data.

## Common flow

```text
Reference / own ISO
        ↓
Inventory and provenance
        ↓
Inspection and isolated visual test
        ↓
FighterContent + physics/collisions + timelines
        ↓
States/specials and separate presentation
        ↓
Roster + React + audio + room protocol
        ↓
Local tests, rollback, browsers and server limits
```

### Reference code

- [lib/game/load.ts](../../lib/game/load.ts): `FighterContent` contract, roster and stage loading.
- [lib/game/data.ts](../../lib/game/data.ts): profiles, attributes, hurtboxes, bones and stage collisions.
- [lib/game/roster.ts](../../lib/game/roster.ts): selection and stable IDs; two to four active fighters.
- [lib/game/moves.ts](../../lib/game/moves.ts): attack events and active boxes.
- [lib/game/match.ts](../../lib/game/match.ts): simulation, full state and hashes.
- [lib/game/specials.ts](../../lib/game/specials.ts) and [lib/game/combat.ts](../../lib/game/combat.ts): special states and shared mechanics.
- [web/src/render/game-rig.ts](../../web/src/render/game-rig.ts): separation between the pose used by collisions and presentation.
- [web/src/play/game-session.ts](../../web/src/play/game-session.ts): game runtime; React consumes its stores.
- [web/src/play/selection-scenes.tsx](../../web/src/play/selection-scenes.tsx): character cards/selector.
- [lib/net/README.md](../../lib/net/README.md): room contract and online limits.

## Rules that do not change

- Use your own compatible ISO. Do not publish it or copy it into the web directory.
- The upstream checkout stays pinned and unmodified. Adapters go outside it.
- The server serves approved names/ranges; it does not become an arbitrary reader of the disc or the filesystem.
- Original resources are not bundled into the static frontend. Publishable custom art is reviewed separately.
- The simulation does not depend on render FPS, `Date.now()`, CSS animations or audio callbacks.
- Intermediate visual frames do not modify hitboxes, damage or state hashes.
- Review rights/provenance before distributing art, samples or compiled code. A trusted LAN is not the same as permission to publish publicly.

## Validation of these guides

They were reviewed against the current loader, server, React and rollback. The Captain Falcon inventory example was run **read-only**: its files were located, the model was read and it was verified that `Wait1` and the model have 63 joints. That example was documentation only; the later playable import is recorded in [docs/characters/FALCON.md](FALCON.md).

Schemes marked as "proposal" are not APIs or importers that are already available. The link checks and the inspection example check do not replace the tests of a future character.
