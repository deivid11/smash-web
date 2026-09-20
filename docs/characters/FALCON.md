# Captain Falcon: original ISO character in the prototype

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Captain Falcon uses his own data, neutral model, animations and sounds from Melee USA v1.02. Special orchestration and collisions are still TypeScript adapters of the prototype; no C functions were added to the WASM and upstream was not modified. Ganondorf shares the `ftCaptain_DatAttrs` layout, not the data: nothing of Ganondorf's is loaded.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Ca` |
| Native type `FTKIND_CAPTAIN` | 2 |
| Stable selector index | **8**; this is not a player index |
| Parameter symbol | `ftDataCaptain` |
| Model | `PlCaNr.dat`: 63 joints, 98 meshes |
| Metadata / animations | `PlCa.dat` / `PlCaAJ.dat` (275 actions) |
| Effects | `EfCaData.dat`, `effCaptainDataTable` (identified only; no emulated models) |
| Voices/SFX | `audio/us/captain.ssm`; jump `540000`, aerial jump `60046`, KO `60055` |
| Announcer | `CKIND_CAPTAIN = 0` → `0x7C830`, from the shared bank `nr_name.ssm` |

The specials use the **17 entries 258–274** of the action table, linked by verified index and name ([lib/game/falcon-data.ts](../../lib/game/falcon-data.ts)). `SpecialHiThrow1` (wall bounce, entry 274) shares a figatree with `SpecialHiThrow` but has its own script; it is loaded and verified and is **not** orchestrated because the supported stages have no walls. Falcon splits the ledge pose into `CliffWait1/2`; the shared flow uses `CliffWait1` via verified entry 209.

## Normals and common mechanics

[lib/game/falcon-data.ts](../../lib/game/falcon-data.ts) registers the full jab chain `Attack11/12/13` plus the rapid jab `Attack100*`, dash attack, three tilts (`AttackS3S` middle), three smash attacks (`AttackS4S` middle) and five aerials. Damage, hitboxes, windows, sound and bones come from the scripts. He uses the common support for shield, dodges, grab/pummel/four throws, ledges, KO and rematch.

## Specials

[lib/game/falcon.ts](../../lib/game/falcon.ts) adapts the `ftCa_*` callbacks with the original parameters of `ftDataCaptain`.

| Special | Implemented behaviour |
| --- | --- |
| **Falcon Punch** — neutral | Single ground/air state (`SpecialN`/`SpecialAirN`), original hitboxes f52–57 (27/25/23 %). In the air, `cmd_vars[0]` (f50) redirects the impulse only once using the vertical stick clamped to `[0.125, 0.625]` × 30°, speed 1.95; `cmd_vars[1]` decays the velocity ×0.92 per frame and from f65 onwards he falls under gravity alone. |
| **Raptor Boost** — side | **Element 11, damage 0** detection boxes (f15–35, `cmd_vars[0]` window); they ignore shield and counter and never deal damage. Contact with a fighter → `SpecialS` (7 % uppercut, the ground version keeps 0.18 of the velocity) or `SpecialAirS` (spike, 270°). Aerial variant with its own gravity/terminal velocity (0.05/3.18) accumulated in `cmd_vars[1]`. Aerial miss → helpless fall with lag 20; aerial hit, lag 40. |
| **Falcon Dive** — up | Jump by root motion with clamped drift (`0.85 × air_drift_max`, friction ×1.1). Consumes the jumps on entry. **Element 8** grab boxes on f13; on capture it moves to `SpecialHiCatch` (the script's 5 % hit deals damage without releasing, like the native capture) and then `SpecialHiThrow` releases with the original 12 % explosion (`throw-hit` index 0, immediate). After throwing he ends in a **normal** fall, not helpless. Miss → helpless with lag 30 and mobility 0.72; `cmd_vars[0]` arms the facing reversal (threshold 0.225) and the ledge grab. |
| **Falcon Kick** — down | Ground: root motion with the three damage steps 15/12/9 and endings `SpecialLwEnd`/`SpecialLwEndAir`; air: `SpecialAirLw` descends by root motion, on landing `SpecialAirLwEnd` with its landing hitboxes (9 %), ending in the air → `SpecialAirLwEndAir` → normal fall. Each connected hit multiplies the remaining velocity ×0.6, at most 4 times (native `deal_dmg_cb`). Final slide with original traction 1.6 (ground) / 3.0 (landing). |

### Explicit limits

- Falcon Dive's grab uses the prototype's capturer (anchored to the common grab bone); the victim's native `CaptureCaptain` pose and the second `throw-hit` (index 1) are not ported.
- `SpecialHiThrow1` (Falcon Kick wall bounce) is not orchestrated: there is no wall collision in the supported stages.
- The flame/wind particle generators (`efSync 1167–1171`, `efAsync 0x490`) are identified but not emulated; their entries are not interpreted as models.
- Raptor Boost's detection only considers fighters, not articles (there are no equivalent hittable articles in the prototype).
- No native wall jump (`can_walljump`), no alternate costumes, and the existing material/audio approximations apply.

## State and online

Raptor Boost's gravity accumulator, Falcon Kick's slowdown multiplier/count, the final animation branch and Falcon Dive's fall bit live in `SpecialRuntime.falcon` and are part of the full snapshot and the canonical hash. The Dive's capture uses `combat.partner` like any grab. No RNG of its own and no dependency on real time.

Allowed by the room protocol ([lib/net/protocol.ts](../../lib/net/protocol.ts)). The allowlist extension in [lib/hsd/source-protocol.ts](../../lib/hsd/source-protocol.ts) (`PlCa*.dat`, `EfCaData.dat`, `audio/us/captain.ssm`) requires deploying frontend and server together.

## Validation of this delivery

- [tests/unit/falcon-real.test.ts](../../tests/unit/falcon-real.test.ts): **15/15** with a real ISO. Registration/assets, 63-joint skeleton, the Punch's windows and its aerial redirect, elem-11 detection and Raptor Boost's uppercut, helpless aerial miss, Falcon Dive grab/throw with no helpless state after a hit, the Kick's 0.6 slowdown and its landing, byte-identical restore and rollback with late inputs for two/four players.
- Full unit suite with a real ISO after the change: 848/851 (the 3 remaining failures belong to another agent's in-progress Link import, not to Falcon files).
- [tests/server-browser/falcon.spec.ts](../../tests/server-browser/falcon.spec.ts) was written following Roy's pattern; running it depends on the shared build/port 5274 gate.
- These tests do not demonstrate equivalence with GameCube or full visual fidelity of effects.
