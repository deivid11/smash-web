# Roy: original ISO character in the prototype

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Roy uses his own data, neutral model, animations and sounds from Melee USA v1.02. He is not Marth under another name, nor an implementation of the full engine. Special orchestration and collisions are still TypeScript adapters of the prototype; no C functions were added to the WASM and upstream was not modified.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Fe` |
| Native type `FTKIND_EMBLEM` | 26 (`0x1A`) |
| Stable selector index | **6**; this is not a player index |
| Parameter symbol | `ftDataEmblem` |
| Model | `PlFeNr.dat`: 92 joints, 121 meshes |
| Metadata / animations | `PlFe.dat` / `PlFeAJ.dat` |
| Effects | `EfFeData.dat`, `effEmblemDataTable` |
| Voices/SFX | `audio/us/emblem.ssm`; jump `310066`, KO `310081` |
| Announcer | `CKIND_EMBLEM = 23` → `0x7C83C`, from the shared bank `nr_name.ssm` |

All loaded clips were verified against the model's 92 joints and the parts table of `PlCo.dat`. Weight 85, run speed 1.61, gravity 0.114, terminal velocity 2.4 and scale 1.08 come from Roy's file. Only the neutral costume is loaded. Alternate costumes, Marth's data and Kirby copy files are not exposed.

Roy has no projectile/accessory articles for these moves. [lib/game/special-data.ts](../../lib/game/special-data.ts) allows those fields to be absent; consumers check their availability. **No placeholder projectile is fabricated and none is reused from another character.**

## Normals and common mechanics

[lib/game/roy-data.ts](../../lib/game/roy-data.ts) registers only actions that are present: single jab `Attack11`, dash attack, three tilts (`AttackS31` side), three smash attacks and five aerials. It does not invent `Attack12`. Damage, hitboxes, windows, sound, smash charge and bones come from the scripts. The hitboxes at the base and tip of his sword keep their different values.

He uses the common support for shield, dodges, grab/pummel/four throws, ledges, KO and rematch. Throws still use the shared approximation of victim poses; the full ECB/wall/ceiling geometry is not ported.

## Specials

[lib/game/roy-data.ts](../../lib/game/roy-data.ts) reads the `MarsAttributes` layout of `ftDataEmblem`, distinguishing integers from floats. [lib/game/roy.ts](../../lib/game/roy.ts) adapts the `ftMs_*` callbacks that Roy also uses, with Roy's original parameters, not Marth's.

The **32 entries** 237–268 are linked by verified index and name. `SpecialNEndFull` and `SpecialNEnd` share a figatree but have different scripts, as do the aerial versions.

| Special | Implemented behaviour |
| --- | --- |
| **Flare Blade** — neutral | Start → charge while B is held → release on letting go. Original maximum charge `7 × 30` frames; auto-releases when the counter exceeds 210. Partial release: `6 + trunc(frames / 30) × 5`. Full release: 50 % script, with 10 % self-damage on frame 9, only once. Ground/air variants are preserved. |
| **Double-Edge Dance** — side | Four stages; A or B chains only during `cmd_vars[0]`. Pressing too early invalidates the chain rather than buffering it for free. Stage 2: up or down; stages 3–4: up/middle/down. Threshold `PlCo.x21C` = 0.55. Its own gravity, friction and terminal velocity; aerial impulse 1.2 once per airtime. Stages 3–4 use the clip's translation. The five hits of the final low variant are kept. |
| **Blazer** — up | Original ground/air clip, reversal and tilt windows, root motion, aerial scale 1.1, switch to falling when descending and helpless state at the end. Landing lag 30, mobility 0.6; grants no extra jumps. |
| **Counter** — down | Original sphere on joint 3, offset `(0, −0.5, 0)`, radius 8.5, active between `cmd1` frame 8 and frame 21. Contact from a hit/projectile triggers `SpecialLwHit`; grabs win. Response damage `trunc(trunc(damage received) × 1.5)`, with no artificial minimum. Keeps the script's intangibility and facing towards the attacker. |

Opcode 51 in [lib/game/moves.ts](../../lib/game/moves.ts) decodes `damage_amount` as a **signed 26-bit value**, like `ftAction_80072BF4`, for Flare Blade's self-damage. Its consumption uses the event cursor of the special's instance, not visual callbacks.

### Explicit limits

- The fire generators and the native sword-trail/particle system are not implemented yet. The effects bank is identified and bounded; its entries are not falsely interpreted as models. The sword animations and the shared impact feedback do work.
- Full ledge/wall/ceiling collisions and all of Blazer's recovery rules are not implemented. Its script body state (frames 9–10) is kept; the super armour of later Smash versions is not added.
- Counter uses the prototype's hit resolver; priorities between multiple simultaneous hits and the full behaviour of articles hitting the counter are not equivalent to the original engine.
- The special facing reversal of back air is not added, nor is a complete port of Roy's common callbacks. The original clip/hitboxes are loaded.
- The models keep the existing material/TEV/lighting approximations; audio uses local SSM/SEM, not the full AX mixer.
- Kirby does not yet receive the Flare Blade copy on swallowing Roy.

## State and online

The charge counter, full-charge flag, chain stage/branch, invalid press and Blazer descent live in `SpecialRuntime.roy`. `MatchFighter.roySideBoostUsed` records the aerial impulse already used and resets on landing/respawn. Counter damage and the self-damage cursor also belong to the full state. They are captured/restored and take part in the canonical hash, with no dependency on real time or Three.js.

Roy is allowed by the room protocol in [lib/net/protocol.ts](../../lib/net/protocol.ts). The allowlist extension in [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts) requires deploying frontend and server together after private validation. The live service was not replaced as part of this import.

## Validation of this delivery

- [tests/unit/roy-real.test.ts](../../tests/unit/roy-real.test.ts): **20/20** with a real ISO. Covers profile/skeleton, full/partial scripts, normals, grab/shield/throw, four specials, chain branches, early input, aerial impulse, Counter vs grab, recoil/restore and rollback with late inputs for two/four players and confirmed events exactly once.
- Full unit suite with a real ISO: **779/779** in 41 files, including Fox/Mario/Kirby/Samus/Pikachu, private custom tests and server/network.
- Typecheck and private frontend build: passing. The WASM was neither recompiled nor modified during the shared QA freeze.
- [tests/server-browser/roy.spec.ts](../../tests/server-browser/roy.spec.ts): **8/8** in real Chromium with a private server and a real disc. Selection/mirrors/HUD/portrait, four specials from the keyboard, full recoil, mobile and allowlist. No per-frame asset requests and no page errors.
- The screenshots of selection, both facings in play, recovery and mobile were inspected. The generic portrait camera initially shows Roy's cape; this is a cosmetic limitation, not a change to his authoritative facing.
- The full base browser suite is pending the GPU slot of the shared gate. These tests do not demonstrate equivalence with GameCube, determinism across different browsers or competitive WAN latency.
