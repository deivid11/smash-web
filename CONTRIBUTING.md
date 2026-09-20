# Contributing

This is a limited source-port research prototype, not the complete Melee engine. Describe implemented scope and unported mechanics accurately.

## Content and privacy

- Contribute only material you have permission to share. Public source availability does not establish redistribution rights.
- Never add disc images, archives, extracted game assets, reference executables, compiled upstream code, runtime databases, keys, account data, telemetry, private research reports or local character packs.
- Keep private material outside the web root and in ignored storage. Ignore rules are not HTTP access controls.
- Keep machine paths, private deployment addresses and personal operational notes out of source and documentation.
- Preserve required third-party copyright notices and licenses. See [third_party/NOTICE.md](third_party/NOTICE.md) and [docs/LEGAL.md](docs/LEGAL.md).

## Engineering boundaries

- Keep the pinned upstream checkout unchanged. Adapters belong outside it. Preserve exact extracted function text and provenance checks.
- Preserve original C semantics. Clearly label prototype orchestration and custom-character behavior rather than calling them original mechanics.
- React owns UI; the game session and renderer own the simulation/render loop and their canvas host. Cosmetic interpolation must not alter authoritative state or hitboxes.
- Preserve independent match memories, complete TS+WASM snapshots, canonical confirmed hashes and exactly-once confirmed events/audio.
- Keep the curated ISO asset API separate from multiplayer input transport. Never expose the full disc, arbitrary files or private paths.

## Checks

Run commands from the repository root with the committed npm lockfile:

```sh
npm ci
npm run build:public -- --outDir ../dist-review
SMASH_CHARACTER_PACKS=none npm test
SMASH_CHARACTER_PACKS=none npm run test:browser
```

The build requires the pinned upstream/toolchain setup described in [README.md](README.md). For server or transport changes, also run the relevant server-browser tests against a staged build with your own verified disc. Set `MELEE_DISC_PATH` for local-disc tests; report skips rather than implying that missing-asset tests passed.

Protocol/capacity changes require validating the staged frontend and relay together through the host-only `SMASH_DIST_PATH` override before joint deployment. Never pair a new frontend with an old relay.

Review the exact staged file list and diff before a commit. Do not publish generated builds or binary packages without reviewing their separate redistribution rights. Custom character authoring and local-only installation are documented in [docs/characters/CUSTOM_CHARACTERS.md](docs/characters/CUSTOM_CHARACTERS.md).
