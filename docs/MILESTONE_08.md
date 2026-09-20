# Custom-character milestone: optional local packs

The former bundled-character implementation has been extracted from the public source tree. Character-specific implementation, artwork and research remain in ignored local storage; they are not required by a fresh clone.

The current supported extension boundary is documented in [docs/characters/CUSTOM_CHARACTERS.md](characters/CUSTOM_CHARACTERS.md). Public code includes an authored, asset-free tutorial under [examples/characters/training-dummy/](../examples/characters/training-dummy/).

Local factories supply authored profiles, timelines, special hooks, snapshot-owned state and disposable presentation. Shared original C routines remain unchanged. Multiplayer protocol v10 requires matching pack identities and byte hashes.

Only the generic framework and the authored tutorial belong in the public repository; private character implementations and artwork are not distributed with it.
