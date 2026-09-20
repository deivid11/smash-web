# Create and install local character packs

Custom fighters are **trusted, opt-in, build-time TypeScript extensions**. An installation can add fighters without editing the built-in roster, renderer dispatch, relay fighter list, or upstream C checkout. This is a private extension API for this prototype, not a universal GLB importer, a script sandbox, or the complete Melee Fighter ABI.

## 1. Try the authored example

From the repository root, after the normal toolchain/setup steps:

```sh
npm run packs -- install examples/characters/training-dummy
npm run packs -- enable example.training-dummy
npm run packs -- check
npm run dev
```

The example is a clearly labeled, self-authored capsule with basic strikes and specials. It ships no extracted model, animation, artwork, or audio. It demonstrates registration, native shared physics calls, state snapshots, and disposable rendering—not a complete, balanced fighter.

- Source: [examples/characters/training-dummy/runtime/index.ts](../../examples/characters/training-dummy/runtime/index.ts).
- Attributes, skeleton and timelines: [examples/characters/training-dummy/runtime/fighter.ts](../../examples/characters/training-dummy/runtime/fighter.ts).
- Manifest: [examples/characters/training-dummy/pack.json](../../examples/characters/training-dummy/pack.json).

Installation copies only declared runtime files to ignored [private/characters/](../../private/characters/). `enable` replaces the complete enabled list; to keep several packs, supply all their IDs:

```sh
npm run packs -- enable example.training-dummy yourname.new-fighter
npm run packs -- list
npm run packs -- check
npm run packs -- disable
```

Selection lives in ignored [.local/character-packs.json](../../.local/character-packs.json). No config means no packs. A missing or invalid explicitly enabled pack is an error, not a silent fallback. Restart Vite after changes: pack source and hashes are captured together when its plugin initializes.

A one-command override does not edit the local configuration:

```sh
SMASH_CHARACTER_PACKS=none npm run dev
SMASH_CHARACTER_PACKS=example.training-dummy npm run dev
npm run build:public -- --outDir ../dist-public-candidate
```

`build:public` excludes **all local character packs**. It still builds the ordinary upstream-derived WASM: this is not permission to publish compiled artifacts. Publish reviewed source only unless all redistribution rights have been established.

## 2. Pack layout and manifest

Create a new folder under [private/characters/](../../private/characters/), named for its ID:

```text
private/characters/yourname.new-fighter/
  pack.json
  runtime/index.ts
  runtime/fighter.ts
  runtime/animations.json
  assets/body.webp
  references/                 # private, undeclared, never served
```

Example manifest (every listed file must exist):

```json
{
  "format": 1,
  "id": "yourname.new-fighter",
  "name": "New Fighter",
  "entry": "runtime/index.ts",
  "files": ["runtime/index.ts", "runtime/fighter.ts", "runtime/animations.json"],
  "assets": { "body": "assets/body.webp" }
}
```

Rules enforced by [scripts/character-packs.ts](../../scripts/character-packs.ts):

- IDs have two lowercase components, `namespace.character`. Each component starts with a letter, contains only letters/digits/hyphens, and has at most 24 characters. The runtime fighter kind is `custom:namespace.character`; it cannot overwrite a built-in kind.
- One character per pack; at most 16 packs enabled. Enabled packs are sorted by ID, so discovery order does not change selection or hashes.
- The entry is a declared `.ts` file. List every imported `.ts`, `.tsx`, and `.json` runtime file. Relative imports outside that list fail resolution.
- Runtime asset keys use lowercase letters/digits/hyphens. Supported files are PNG, WebP, JPEG, JSON, Ogg and WAV. Declaring audio only provides a URL; v1 does not automatically integrate a new audio bank.
- Maximum 128 source/data files, 64 asset keys, 8 MiB per file, 32 MiB total declared bytes per pack.
- Absolute paths, dot/traversal components, duplicate source paths and symlink files are rejected. The private directory is never added to Vite's filesystem allowlist.
- Source imports can use `@smash/lib/...` and `@smash/web/src/...` for public runtime modules, plus Three.js and the existing noble hash helpers. Do not import Node tools, undeclared files, or another private pack.

References, masters, private research notes and archives must not appear in `files` or `assets`. The browser receives the opted-in runtime code and declared assets, **not** the rest of the private folder. Ignoring a pack in Git does not hide it from people playing a hosted build containing that pack.

## 3. Entry point and registration

[lib/custom/types.ts](../../lib/custom/types.ts) defines API version 1. Export one default factory:

```ts
import type { CharacterPack, CustomPackContext } from '@smash/lib/custom/types.ts';
import { makeFighter } from './fighter.ts';

export default function createPack(context: CustomPackContext): CharacterPack {
  // Return the complete CharacterPack contract; use the working example as a starting point.
  // context.kind is your namespaced identity.
  // context.assets.body is the generated, content-addressed atlas URL.
  return makeFighter(context);
}
```

The example above illustrates the entry boundary, not a complete fighter implementation. The runnable example supplies the full `CharacterPack` object.

The factory must be deterministic and synchronous. No timers, DOM operations, random IDs or network requests at module initialization. Asset loading belongs to `prepareVisual()`.

Required members:

- `apiVersion: 1`, `kind: context.kind`, `name` and `menu` metadata.
- `create()` returning a **fresh** complete `FighterContent`, with matching `profile.kind` and `custom`, plus `specials.parameters.kind = 'custom'`.
- `specials.name`, `specials.begin`, `specials.step`, and `specials.land`.

The registry automatically adds the installed fighter to loaded content, menus, random character selection and multiplayer choices. Custom factories can be called again after roster eviction; do not store mutable match state in their module scope.

Built-in numeric selector positions changed when the formerly bundled custom slot was removed. Persist namespaced fighter kinds, not menu array indices. Custom entries append after the built-ins; protocol v10 prevents old clients from entering these rooms.

## 4. Physics, collision skeleton and move data

`FighterContent` is defined in [lib/game/load.ts](../../lib/game/load.ts). Its profile and attributes are defined in [lib/game/data.ts](../../lib/game/data.ts).

- Supply a consistent 0x9c-byte `Uint32Array` attribute prefix for the shared C bridge. Write floats and integers correctly (`max_jumps` at 0x58 and `rapid_jab_window` at 0x98 are integers).
- Keep the TypeScript attributes and binary prefix consistent. Use finite, sensible values and valid bone mappings.
- Shared original C/WASM helpers continue to calculate movement, friction and knockback. Authored parameters do not turn a custom fighter into original game content. Never patch the pinned upstream checkout.
- Provide a CPU collision skeleton even for a sprite. Roots, motion root, shield/capture anchors and hurtbox bone indices must exist. Do not use an image's visible bounding box as a hitbox.
- Populate clips, attack definitions, move-selection keys and timelines. Begin with `Wait1`, movement, jumps, landing, damage, defense, grabs/throws and ledge motions before adding attacks.
- Attack events create/clear hitboxes at simulation frames. A drawn effect does not create damage. Respect charge holds, jab windows, landing lag, hitlag and multi-hit activation IDs.

The example's skeleton and flat animation tracks are intentionally minimal. A polished fighter needs real animation, complete state coverage and explicit collision/move testing. No automatic GLB-to-HSD/physics conversion is implemented.

## 5. Specials and rollback-owned state

Use `initialState()` to return finite JSON-compatible per-fighter data. It is cloned into `MatchFighter.customState` for every fighter, reset on KO/hot-swap, and captured/restored/hashed with the rest of the TypeScript state. Initialization rejects non-JSON values, excessive nesting and state larger than 16 KiB.

```ts
initialState: () => ({ charge: 0, uses: 0 })
```

Modify that state only from simulation hooks. Do not keep cooldowns, counters, RNG, owner references or active attacks in a module variable, renderer, texture, React component or closure shared between matches.

- `specials.begin(fighter, direction, input)` initializes a special after the engine creates its common runtime.
- `specials.name(direction, phase, air)` resolves a clip that actually exists.
- `specials.step(fighter, input, physics, finish)` advances one simulation tick. Return the `SpecialStep` event/shot result and use `finish()` to exit coherently.
- `specials.land(fighter, finish)` handles landing and lag explicitly; do not fall through to a built-in character's parameter layout.
- Optional `hits(fighter, hits)` adjusts attack hits.
- Optional `counter(attacker, victim, hit)` returns simulation events or `null`. Normal confirmed-event handling prevents duplicate online audio/events during rollback.
- Optional `status(fighter)` is a **read-only** HUD query.

V1 supports the existing shot/event types, not arbitrary new item/projectile engines or a custom sampled hurtbox ABI. Extending those contracts requires engine work and protocol/rollback tests. Avoid pretending a new projectile is an existing one merely to obtain a renderer.

## 6. Presentation, sprites and resources

`prepareVisual()` runs before the session becomes ready. Load only declared `context.assets` URLs. It returns a session-owned `CustomVisual`:

- `createSkin(actor)` creates per-fighter geometry/materials with `render(...)` and `dispose()`.
- Optional `createEffects(scene)` owns bounded cosmetic effects with `update`, `reset` and `dispose`.
- `dispose()` frees shared resources such as atlas textures after all skins/effects have been disposed.

Filter effects by **your exact kind**, not merely `fighter.content.custom`: several different packs may be present. Remove effects for KO/replaced fighters. Keep clones and mirrors independent while sharing immutable textures.

Skin rendering receives simulation `animationFrame`, cosmetic interpolation alpha, pause status, victory and a presentation choice. Never change the authoritative fighter, collision joints, hitboxes or `customState` while rendering. Pauses, hitlag and smash-charge holds must freeze the correct visual clock.

For sprite artwork:

1. Use real alpha, a fixed pivot, a consistent pixels-per-unit scale and enough padding for weapons/effects.
2. Author genuine temporal samples; a crossfade or transformed still image is not newly drawn animation.
3. Keep body and effect layers registered. Do not center/crop each pose independently.
4. Sample the atlas from simulation frame numbers, not elapsed browser time.
5. Validate image dimensions and keep decoded texture/GPU budgets bounded; compressed-file limits alone do not bound GPU memory.

Optional `presentations` entries add choices to the generic Custom Character Presentation setting. The chosen presentation must never affect gameplay or rollback hashes.

## 7. Multiplayer pack matching

Every enabled pack receives SHA-256 over a canonical manifest plus **every declared source, data and asset byte**. The hash ignores directory location, mtime, manifest file ordering and private undeclared references. Changing runtime code, tuning, animation data, an atlas or metadata changes the identity. This includes more than just the PNG or a user-supplied version label.

Protocol v10 advertises the sorted `{ id, hash }` list alongside existing game/WASM/content fingerprints:

- Joining and spectating require exactly the same enabled pack set and hashes. A mismatch names the missing/different IDs and denies entry before gameplay.
- Held-seat resume also refuses a changed pack set.
- The relay rejects selecting a custom human/CPU fighter absent from that room's agreed pack identities.
- The relay does not import character code, simulate packs or send pack archives. Clients never execute code supplied by a peer.
- Pack comparison is **identity compatibility, not anti-cheat or proof of ownership/rights**. A malicious client can lie about hashes; this prototype is not authoritative.
- V1 deliberately requires identical enabled sets even if an extra fighter is not selected. To play together, enable the same reviewed packs and rebuild both installations. It does not negotiate partial shared rosters.

A host-built installation serves its selected runtime pack content to its browsers, like the rest of its frontend. This is not per-browser drag-and-drop mod loading. Base-game disc checks and local-disc requirements remain unchanged. Custom packs do not provide original game assets.

## 8. Testing and deployment

```sh
npm run packs -- check
npm run typecheck
SMASH_CHARACTER_PACKS=none npm run build -- --outDir ../dist-public-candidate
SMASH_CHARACTER_PACKS=none npm test
SMASH_CHARACTER_PACKS=none npm run test:browser
npm run build -- --outDir ../dist-packs-candidate
npm test
npm run test:browser
```

For private, real-disc integration, supply `MELEE_DISC_PATH` and use the staged build:

```sh
SMASH_DIST_PATH=dist-packs-candidate npm run test:server-browser -- tests/server-browser/character-packs.spec.ts
```

Tests without a supplied disc must report skipped real-disc coverage honestly. Keep test artifacts and original assets private.

Acceptance checklist:

- Public/no-pack clone builds and boots without optional assets or broken imports.
- A new valid pack gets its own name, card and runtime kind; duplicate/unsafe/missing manifests fail.
- The pack works in local mirrors, with built-in fighters, after eviction/reload, and after repeated disposal/recreation.
- Both complete TS and WASM state restore identically; custom state changes alter hashes; resimulation reproduces them.
- Two matching clients can select the pack and start. Missing/different packs fail join/spectate/resume before gameplay.
- The private tree cannot be fetched through either Vite or the LAN server; only declared runtime bytes appear in build output.
- Visual interpolation and presentation choices never change authoritative results.

Protocol changed: **validate the staged frontend and relay together before promoting and restarting together**. Never deploy a v10 frontend against the old running relay. This change does not automatically restart or promote the local service.

## 9. Git and rights

Keep packs under ignored [private/characters/](../../private/characters/) and keep local opt-in configuration ignored. Commit only the framework, safe example, tests and guide. Never force-add private art, original assets, binaries, extracted source, archives or private reports.

Moving formerly tracked files into ignored storage removes them from the next tree only after their tracked deletions are committed. It **does not remove previous commits**. Public publication still requires reviewing/sanitizing the intended history or preparing a clean source export; do not rewrite shared history without authorization.

Review pack provenance and redistribution permission yourself. Installing a pack or keeping it noncommercial does not establish rights to its content. See [docs/LEGAL.md](../LEGAL.md).
