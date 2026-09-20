# Milestone 03: first playable local slice

This milestone introduced a playable Fox/Mario stock match on Battlefield, replacing animation-only interaction with movement, jumping, original-data attack/hurt capsules, damage, hitlag, knockback, stock loss, respawn, a winner, pause, and rematch.

The initial bridge compiled 18 unchanged functions from the pinned decompilation plus the original RNG. Original common/fighter attributes, bone maps, action scripts, Battlefield scale/collision lines/blast zones, and animations came from the user's server-side ISO. Function extraction preserves the exact source text and records hashes; generated C remains in ignored local build storage.

The private adapter in [engine/gameplay/bridge.h](../engine/gameplay/bridge.h) is not the full GameCube Fighter memory layout. [lib/game/match.ts](../lib/game/match.ts) provides restricted match orchestration and a floor/capsule collision bridge, not the complete original state machine or ECB solver. The practice bot and camera are prototype implementations.

The first playable milestone passed 209 unit tests and 27 browser tests with the original local disc, including actual keyboard/touch input, damage, jumps, stock loss, winner/rematch, and focus-loss pause. It did not establish bit-exact GameCube behavior or rollback correctness.

The subsequent specials/effects/audio work is documented in [docs/MILESTONE_04.md](MILESTONE_04.md). Current launch instructions and controls are in [README.md](../README.md).
