# Original menu music, selection audio, and gameplay stages

## Scope and private transport

The prototype supports **Battlefield** (`battlefield`, `GrNBa.dat`), **Final Destination** (`final`, `GrNLa.dat`) and **Corneria** (`corneria`, `GrCn.dat`). Each uses the original model, collision floors, ledge flags, blast zones, scale and spawn points from the same archive. Final Destination is not a background swap. Corneria loads only its verified always-active MapJoint area 3 — the sloped Great Fox hull with its three original ledges — through the explicit `staticAreas` declaration in [lib/game/stages.ts](../lib/game/stages.ts); the Arwing and fin platform areas the original stage code spawns and moves at runtime, its walls/ceilings, lasers and the Great Fox guns are not simulated, and its prototype spawn layout caps at four fighters (`STAGE_PLAYER_LIMITS`). The city flyby is replayed visually in [web/src/render/corneria-flyby.ts](../web/src/render/corneria-flyby.ts) from the original code: the three city strips (map roots 8/9/4) run the `grCorneria_801DFC98/801DFF20/801E01A8` conveyor at `yakumono_param->x88` = 2 world units per frame with the `grCorneria_801E03C8` 8→9→4 chain, cruising `base_y` = 250 units below the hull (`grCorneria_801DD674`) and rising through the `grCorneria_801E2228` altitude-dip ramp on a fixed cadence that replaces the original random roll. This is presentation only — a pure function of the match frame that never touches collision or hashes. An Arwing escort joins each cruise segment using the original model (map root 2), the original -90° root yaw, `yakumono_param->x70` scale and the 435-frame banking clip from its own animation table (`grCorneria_801DED50`); its approach/hold/leave path is an explicit supplemental approximation because the native flight splines (`Ground_AnimateStarFoxArwingWithBackground`) are not ported. The verified `hiddenObjects` list still parks the remaining sequence props (roots 5/6/10); Arwing lasers, hover platforms and the ship's own bob (`grCorneria_801E1970`) are not simulated because the hull collision is static. No supported stage is a port of the complete original stage engine; animated background/material behavior remains partial.

**Pokémon Stadium** (`stadium`, `GrPs.dat` + `GrPs1–4.dat`) is the first dynamic stage: [lib/game/stadium.ts](../lib/game/stadium.ts) re-implements the original transformation cycle from `grpstadium.c` over the archives' own data. The five archives share one collision table partitioned by verified areas (outer aprons with both grab edges always active; normal/fire/grass/water/rock each own an area range), and the schedule constants come from the stage's `yakumono_param` (normal 3600–3800 frames, variant 1200–1800, warn 300, shrink/grow 120, pause 60). The clock lives in `LocalMatch.stadium`, advances on simulation frames, draws only simulation RNG, is captured/restored/hashes with the match, and swaps `content.stage` between per-form `StageGameplayData` exactly once per transformation (at the grow edge). Variant selection rerolls so the same variant never repeats back to back, like the original. Renderer terrain swaps, shrink/grow scaling and the base-terrain hide are cosmetic ([web/src/render/play-renderer.ts](../web/src/render/play-renderer.ts)) and read the authoritative clock. Not simulated: the monitor display, crowd, per-form particles, the animated collision during shrink/grow (ground ownership moves in one step) and walls/ceilings.

Ten more versus stages joined the roster, each verified against its original stage code (`third_party/melee/src/melee/gr/gr*.c`) the way Corneria was: only init-active, non-traveling collision loads, through `staticAreas` where the original disables or moves areas, plus `hiddenObjects` where a removed gimmick would otherwise park visibly. **Yoshi's Story** (`yoshi-story`, `GrSt.dat`) loads area 1 and hides Randall's cloud (map root 2); Shy Guys carry food without collision. **Dream Land N64** (`dream-land`, `GrOp.dat`), **Jungle Japes** (`jungle-japes`, `GrGd.dat`) and **Fourside** (`fourside`, `GrFs.dat`) need no selection: their collision code never moves or toggles areas. **Peach's Castle** (`peach-castle`, `GrCs.dat`) loads init-active areas 3–5 with the lift frozen at its dock. **Onett** (`onett`, `GrOt.dat`) is fully simulated from the original data in [lib/game/onett.ts](../lib/game/onett.ts) (`gronett.c`): both car machines with the original states, timers and `HSD_Rand` consumption order (right-to-left cars hit with the `ALDYakuAll` 30% scripts; the left-to-right car is scriptless in the original and harmless), the 60-frame crossing warning banner, the collapsible center rooftop (areas 3–4 phase out through states 5–7), both awning springs as exact `f32` ports, and the stage SFX bank (`audio/us/onett.ssm`: engines, honks, screeches, collapse, awning). Joint-local areas ride their owner joints' rest poses through `areaOffsets`, and map root 1 — never instantiated by the original init (gobjs 0/2/5/4/3 only) — stays hidden. Snapshot-owned like the Stadium clock, so rollback and confirmed hashes stay in lockstep. Map particle-bank generators (tire smoke, awning poof, background flyer) have no prototype pipeline and stay out. **Mute City** (`mute-city`, `GrMc.dat`) runs the original 60 s road cycle from `grmutecity.c` ([lib/game/mutecity.ts](../lib/game/mutecity.ts)): the verbatim `grMc_803E34E0` script toggles collision areas (init leaves the start pad + deck slot; stops add the surrounding road; the 2273–3290 flight drops the deck) and the traveling deck (mp lines 0x31/0x33/0x35) is repositioned every frame from the archived track splines through the ported z-crossing markers, carrying standing fighters; the parked starting-grid cars stay hidden. Not simulated: car hazards and damage, camera/blast shifts, sounds, tilt collision, and animated fog shifts. Per-object distance fog and the lavender background come from the stage's own `HSD_FogDesc` entries like every other stage. **Yoshi's Island** (`yoshi-island`, `GrYt.dat`) phases each block independently when struck. **Green Greens** (`green-greens`, `GrGr.dat`) keeps area 30 frozen and simulates the 5x6 block grid (fall/break, prototype Bob-omb blasts for bombs, Foods for apples) with Whispy wind on the original event cycle (see `lib/game/greens.ts`; blow clips, quakes and particles unported). **Venom** (`venom`, `GrVe.dat`) loads init-active areas 0–2; mid-deck/under-arc stay excluded for runtime dockings. Fountain of Dreams (runtime-stacked platforms), Kongo Jungle (ambiguous rotating-log poses), Flat Zone, Brinstar, Great Bay, Brinstar Depths, Big Blue and the scrolling courses stay out; each failure reason is recorded in the stage research notes. No supported stage is a port of the complete original stage engine; unported stage hazards stay out of simulation (Mute City's starting-grid cars are hidden, Onett's map-bank particles stay out, Klaptrap/wind/UFO/Shy Guys are decorative).

[lib/game/stages.ts](../lib/game/stages.ts) exports `SUPPORTED_STAGES`, `StageId`, and `supportedStage`. [lib/game/load.ts](../lib/game/load.ts) exports:

- `loadGameStage(session, stageId)` → `{ stageId, stage, stageModel }`.
- `selectGameStage(content, session, stageId)` → new content with both stage components replaced. Fighters, cached roster, sound and physics resources are reused; an existing match is not mutated. Create a new match after selection.
- `loadGameContent(session, wasm, progress?, stageId = 'battlefield')`.

The allowlist in [lib/hsd/source-protocol.ts](../lib/hsd/source-protocol.ts) adds precisely four resources to the prior 17:

| Resource | Use |
| --- | --- |
| `audio/menu01.hps` | Original menu music |
| `audio/sp_zako.hps` | Original Battlefield music |
| `audio/sp_end.hps` | Original Final Destination music |
| `audio/corneria.hps` | Original Corneria music |
| `audio/ystory.hps` | Original Yoshi's Story music |
| `audio/old_kb.hps` | Original Dream Land N64 music |
| `audio/castle.hps` | Original Peach's Castle music |
| `audio/onetto.hps` | Original Onett music |
| `audio/mutecity.hps` | Original Mute City music |
| `audio/yorster.hps` | Original Yoshi's Island music |
| `audio/greens.hps` | Original Green Greens music |
| `audio/venom.hps` | Original Venom music |
| `audio/garden.hps` | Original Jungle Japes music |
| `audio/fourside.hps` | Original Fourside music |
| `audio/us/nr_name.ssm` | Original Fox/Mario/Kirby announcements |

The nine new stage archives join `VIEWER_ASSETS` (`GrSt.dat` was already exposed for the inspection viewer). The existing `audio/us/main.ssm` and `audio/us/smash2.sem` supply the menu cues. No decoded audio or extracted assets are copied into the public tree. Every new file fits the 8 MiB bounded response transport with no exception; `audio/garden.hps` (~8.0 MB, ~7.0M samples) is why the decode budget in [lib/game/music.ts](../lib/game/music.ts) is eight million samples per channel. Other music, narrator banks, arbitrary disc files, the executable and the ISO remain inaccessible.

## Browser contract

[web/src/menu-audio.ts](../web/src/menu-audio.ts) exports `MenuAudio`, `MenuSound` and `MENU_SOUND_IDS`:

```ts
const audio = new MenuAudio(session, message => showAudioError(message));
await audio.prepare(); // default: menu plus all thirteen stage tracks + selection cues, no gesture needed
// Invoke directly from a trusted pointer/key gesture, before other asynchronous work:
void audio.unlock();
audio.play('select'); // select | confirm | back | fox | mario | kirby
await audio.setMusic('menu'); // menu | battlefield | final | null
// Independent controls; volumes are clamped to [0,1]:
audio.musicVolume = 0.35;
audio.sfxVolume = 0.8;
audio.musicMuted = false;
audio.sfxMuted = false;
audio.stopAll();
audio.dispose();
```

`prepare(['menu', selectedStage.music])` can load fewer tracks. Await preparation **before starting the match**: prepared track changes and selection cues do not fetch assets. A missing track requested with `setMusic` is prepared on demand. The audio object must be replaced when changing disc/session. `prepare` rejects invalid/missing assets and reports the error; `setMusic` reports preparation errors without aborting gameplay. `stats` exposes played/unavailable counts, last error, current music, prepared tracks and SFX readiness. `play` before gesture/preparation is ignored, never replaced by synthesized tones.

The audio context is created/resumed only by `unlock`. Muting one bus does not affect the other. At most eight SFX voices and one music voice are retained. Only the tracks registered in `MUSIC_TRACKS` can be cached: each decoder accepts at most 8 MiB encoded input and eight million samples per channel (one or two channels). WebAudio buffers replace retained Int16 PCM rather than duplicating it permanently. Menu PCM has a separate one-million-sample budget. Pending preparation is serialized; disposal aborts decode work and discards in-flight read results, stops/disconnects voices, clears caches and closes the context. The shared session owns transport reads, so disposal is logical cancellation, not a claim of aborting a shared HTTP request.

## Original sound IDs and decoder provenance

Menu actions map through `lbAudioAx_80024030` in [third_party/melee/src/melee/lb/lbaudio_ax.c](../third_party/melee/src/melee/lb/lbaudio_ax.c), with action usage confirmed in [third_party/melee/src/melee/mn/mnnamenew.c](../third_party/melee/src/melee/mn/mnnamenew.c): select `0xAE`, confirm `0xAD`, back `0xAC`.

Fox and Mario announcements use `gm_80168C5C` in [third_party/melee/src/melee/gm/gm_1601.c](../third_party/melee/src/melee/gm/gm_1601.c): the CSS passes `char_kind` (CKIND), so kinds 2/8 → sound IDs `0x7C835`/`0x7C845` (510005/510021), resolving through the original SEM to samples 1481/1497. The older CSS `0xC7`/`0xCD` entries resolve to silent placeholders; playing those would not implement the requested announcements. Kirby uses the same table: CKIND 4 → `0x7C83F` (510015), sample 1491 of the same bank — `0x7C83A` is Game & Watch's call (CKIND 3, sample 1486), not Kirby's. Full CKIND map: Falcon 0→`830`, DK 1→`831`, Fox 2→`835`, G&W 3→`83A`, Kirby 4→`83F`, Bowser 5→`840`, Link 6→`842`, Luigi 7→`844`, Mario 8→`845`, Marth 9→`846`, Mewtwo 10→`848`, Ness 11→`84A`, Peach 12→`84B`, Pikachu 13→`84D`, ICs 14→`83B`, Puff 15→`83D`, Samus 16→`84E`, Yoshi 17→`84F`, Zelda 18→`851`, Sheik 19→`850`, Falco 20→`834`, YLink 21→`843`, DrMario 22→`832`, Roy 23→`83C`, Pichu 24→`84C`, Ganon 25→`836`, Yoshi 17→`84F`, ICs 14→`83B`, Zelda 18→`851`, G&W 3→`83A`. All vanilla roster calls plus Falco, Dr. Mario, Ganondorf, Pichu and Marth play through `announcerCue` in [web/src/play/game-session.ts](../web/src/play/game-session.ts) whenever a fighter is picked (local or LAN); custom/ACE fighters keep the generic confirm cue and never borrow another voice.

[lib/game/music.ts](../lib/game/music.ts) validates HALPST headers and bounded block chains, decodes signed DSP ADPCM with original coefficients and per-block histories, and uses the terminal backwards link to identify the exact loop start. Invalid encoding, overlap, truncated blocks, non-boundary loop links and excessive allocations are rejected. See [third_party/NOTICE.md](../third_party/NOTICE.md) for format research and reference licensing. This is not AX mixer, reverb, GameCube resampler or hardware timing equivalence.

Local verification against the credited native vgmstream revision compared every decoded sample of all three complete stereo tracks with **zero mismatches**. Exact sample counts / loop starts at 32 kHz are:

- Menu: 1,824,051 / 229,376.
- Battlefield: 2,751,848 / 344,064.
- Final Destination: 2,860,032 / 172,032.
- Yoshi's Story: 3,801,811 / 458,752.
- Dream Land N64: 2,170,736 / 114,688.
- Peach's Castle: 2,877,879 / 745,472.
- Onett: 3,687,504 / 286,720.
- Mute City: 3,392,121 / 401,408.
- Yoshi's Island: 1,734,331 / 573,440.
- Green Greens: 3,264,148 / 516,096.
- Venom: 2,014,466 / 401,408.
- Jungle Japes: 7,001,839 / 802,816.
- Fourside: 3,783,434 / 401,408.

Synthetic malformed-input and browser-audio-lifecycle tests are in [tests/unit/music.test.ts](../tests/unit/music.test.ts) and [tests/unit/menu-audio.test.ts](../tests/unit/menu-audio.test.ts). Original-disc decoding, audible narrator cues, no-refetch preparation and stage collision/resource reuse tests are in [tests/unit/music-real.test.ts](../tests/unit/music-real.test.ts); they explicitly skip without `MELEE_DISC_PATH`. Native reference files and comparisons remain outside the repository and web root.
