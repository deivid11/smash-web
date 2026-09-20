# Mr. Game & Watch: original ISO fighter

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Game & Watch runs his own `ftGameWatch` code and data (`PlGw.dat`, `ftDataGamewatch`)
with a dedicated handler in [lib/game/gamewatch.ts](../../lib/game/gamewatch.ts).
His 2D skeleton needs 11 part-visibility groups (the loader cap was raised from 8
with a comment citing him). No WASM changes, no upstream edits.

## Identity and resources

| Identifier | Value |
| --- | --- |
| Disc code / `FighterKind` / rooms | `Gw` |
| Native `FTKIND_GAMEWATCH` | 24 |
| Stable selector index | **31** |
| Parameter symbol | `ftDataGamewatch` (`ftGameWatchAttributes`, fully labeled upstream) |
| Model | `PlGwNr.dat`: 53 joints, 129 meshes |
| Metadata / animations | `PlGw.dat` / `PlGwAJ.dat` (269 actions) |
| Effects | `EfCoData.dat`, `effCommonDataTable` (no `EfGwData.dat` exists on disc) |
| Voices/SFX | `audio/us/gw.ssm` |
| Announcer | `0x7C83A` (`gm_80168C5C`, `CKIND_GAMEWATCH = 3`), sample 1486 |

Specials use action entries **241–268** ([lib/game/gamewatch-data.ts](../../lib/game/gamewatch-data.ts)):
Chef, nine ground + nine air Judgment scripts sharing the `SpecialS` figatrees,
Fire, and Oil Catch/Shoot (+air). Article slots follow his init table
(Greenhouse 0 … Panic 7, Chef 8, Rescue 9); Chef (slot 8, 4% hit), the
parachute visual (slot 3) and the Judgment number sign (slot 6) load. Normals'
hand props, the Judge hammer and the oil fill levels ride the fighter model.

## Normals

Jab `Attack11` plus rapid `Attack100` (loop carries the hits), dash, `AttackS3/Hi3/Lw3`,
smashes `AttackS4/Hi4/Lw4`, five aerials — all hitboxes from his own scripts.

## Specials

| Move | Implemented behavior |
| --- | --- |
| **Chef** — neutral | cmd0 spawns a sausage while under the per-use max; type is uniform-random 0–4 excluding the last two thrown (exact anti-repeat via sim RNG), with that type's arc from the Chef table (verified per-type velocities, shared fall). Sausages bounce-stop on floors with the sit life and use the original 4% hit. |
| **Judgment** — side | `ftGw_SpecialS_GetRandomInt`: one draw below the cumulative `x34` weights of every number except the last two rolled; the memory starts at {1,0} at spawn and after every KO (`ftGw_Init_OnDeath`), so a stock never opens on 1 or 2. The matching `SpecialS1–9` script runs with all its own hits: 1 = 2% plus **12% recoil on Game & Watch** (opcode 51), 2 = 4%, 3 = 6% at 140°, 4 = 8% slash, 5 = 4×3% electric, 6 = 12% fire, 7 = 14% **plus a Food from his left thumb when items are on and Food is switched on** (`it_8028FAF4`), 8 = 4% ice (freezes), 9 = 32%. Ground and air versions swap on the same frame. Aerial: momentum divided by `x20`; the first swing of an airtime hops by `x28`, later ones stop the rise until he lands mid-Judgment or is KO'd (`x2234`); falls at `x2C`/`x30` with `x24` friction. Air end falls normally (no helpless). The number sign (article 6) rides his right thumb from the swing on, posed at its number and turned to read forward in both facings. |
| **Fire** — up | Rises on original root motion with Mario-shaped stick tilt, parachute accessory shown during the rise like Mario's cape, original landing lag (or plain fall when zero). |
| **Oil Panic** — down | Bucket window opens on cmd0 (original AbsorbDesc); absorbed energy charges count + damage (never heals) and poses Catch; full bucket (3) releases on entry with `stored * mul + add` stamped onto the Shoot capsules. Charge persists across uses and stocks, cleared on KO. |

### Explicit limitations

- Item-article props are not rendered: greenhouse, manhole, torch, turtle/sparky and the oil splash (the Judgment sign, sausages and parachute are). Props that live on his own model are (Chef pan, Judge hammer, box, key, chair, flag, helmet, the Oil Panic bucket with its fill levels, the dizzy Zs). Gameplay is unaffected.
- Judgment's cosmetic script commands are skipped: opcode 35 (hide a held item during the swing) and opcode 43 (Judgment 1 controller rumble). Electric hits (Judgment 5) use normal hitlag: the engine-wide 1.5× electric multiplier (`ftcoll.c`, `x1960_vibrateMult = x1A4`) is not ported for any fighter.
- The outline pass is approximated: the original draws the hull first without depth writes, then the body, then the hull's depth alone. The hull here writes depth from 0.5 units behind the body along each view ray, which leaves the same rim.
- Turnaround frames (`x7C`) and Chef loop-disable latching are unread simplifications.
- Sausage wall bounce (0.5×) is unported (prototype walls are unsimulated for everyone).
- Kirby does not copy Game & Watch yet (`PlKbCpGw.dat` not loaded).

## Look (renderer)

His file materials are all untextured white. Everything else comes from spawn code, reproduced in [web/src/render/game-rig.ts](../../web/src/render/game-rig.ts) and [web/src/render/model-instance.ts](../../web/src/render/model-instance.ts):

- **Costume color**: `ftMaterial_800BFB4C` writes `ftDataGamewatch` x4[costume] (black, or dark red/blue/green) into every material. `it_8027CE64` gives his articles (sausages, parachute, Judgment sign) the same color, and each article's outline joints (`it_266F_ItemVars`, drawn by the item outline pass `it_8026EECC`) the same rim.
- **Flat**: `x0_GAMEWATCH_WIDTH` (0.01) is the root joint's depth scale (`Fighter_UpdateModelScale`). It is applied to the GPU skinning palette only, so hit/hurtbox joint queries keep the full pose (the original's `x44_mtx` correction). He is drawn unlit, since a flat figure shades uniformly.
- **Part visibility**: each action starts from the `ftGw_Init_OnDeath` defaults (`GAMEWATCH_PART_DEFAULTS`: only body groups 0/2/3 show) and replays its own opcode-31 events. Oil Panic adds the bucket and fill levels like `ftGw_SpecialLw_UpdateBucketModel` (see `gamewatchPartVisibility` in [lib/game/gamewatch.ts](../../lib/game/gamewatch.ts)).
- **Outline**: `ftGw_Init_OnLoad` installs `items[10]` as a fifth visibility set. It holds slightly inflated copies of every body/prop alternative (dobjs 1–15 and others). `ftDrawCommon_80080E18` draws the selected ones in `GAMEWATCH_OUTLINE` (white at 0x80), lerped over the body color, leaving a mid-gray rim around the silhouette. Before this was reproduced, those hulls drew as extra black body and every prop showed at once.

## State and online

Sausage count, Judgment roll, release damage, oil charge/damage, Judge history and
Chef history live in runtime + snapshot-owned fighter fields. All RNG (food type,
hammer number) draws simulation RNG. Registered in rooms; allowlist (`PlGw*.dat`,
`audio/us/gw.ssm`, shared `EfCoData.dat`) needs joint frontend/server deploy.

## Validation

- [tests/unit/gamewatch-real.test.ts](../../tests/unit/gamewatch-real.test.ts): registration, 53-joint skeleton, full normals, sausage spawn, consecutive-Judgment anti-repeat, the {1,0} opening memory, x34 weighting, Judgment 1 recoil, Judgment 7 food (items on/off), the once-per-airtime aerial hop, outline/part visibility, render-only flatten, Fire rise, full-bucket Shoot with charge reset, live Fox-laser bucket catch, poses both facings, snapshot restore + deterministic replay.
