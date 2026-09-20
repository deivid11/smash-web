# Third-party research and rendering credits

## Melee decompilation (doldecomp/melee)

Function extraction, fighter/stage parameters, action scripts, and match-flow research read the pinned upstream checkout. The upstream tree stays unchanged; adapter code lives outside it, and only selected original functions compile behind the gameplay bridge (see `README.md` and `docs/MILESTONE_03.md`).

- Repository: https://github.com/doldecomp/melee.git
- Pinned commit: `0bac93a5ee2f985dac6220bd36ed7078ae6ac0c9` (mirrored in `third_party/melee.lock.json`)
- Disc: USA GALE01 revision 2.

Public source availability does not grant redistribution rights: no upstream code, game asset, or reference executable is relicensed or redistributed here.

## ACE 2.0 (Akaneia-fork m-ex build)

The modded-fighter reference data (Zero, Toad, Meta Knight, Sonic, Raichu, Charizard, Wolf, Diddy Kong, King Dedede, Wario, Shadow, Blastoise, Lucas, Metal Sonic, Ninten, Daisy, Fay, Sonic BM, Dr. Luigi, Knuckles, Lucina, Lucas TDX, Shadow Mewtwo, Luigi & Boo, Metal Mario, Skull Kid, Chun-Li, Giga Bowser, Tails, Blood Falcon, Wolf SSBU: parameters, bone tables, and action keys in `docs/characters/`) was read from the ACE 2.0 extension build, an Akaneia-fork m-ex project.

- Authorship: the ACE 2.0 build is the work of Chri222k and the ACE contributors; it builds on Team Akaneia's Akaneia build and on the m-ex framework. All modded characters, animations and move designs are credited to them; this project claims no authorship of that content.
- Repository: https://github.com/Chri222k/ACE-BUILD-PUBLIC- (mexproj reference commit `7a5c107cf1`, per `docs/characters/ACE_FIGHTERS.md`)
- The extension disc is read locally at the owner's request (verified by executable SHA-1 in `lib/disc.ts`) and never redistributed.

## noclip.website

The HSD archive, joint, material, envelope, GX descriptor, and FObj/figatree format interpretation in this project is informed by and adapted from noclip.website's SYSDOLPHIN and SuperSmashBrosMelee implementations.

- Repository: https://github.com/magcius/noclip.website
- Inspected revision: `6b16cfda00ef5af3ee2a66d8b928bb0bf700e5b6`
- Relevant upstream files: `src/SYSDOLPHIN/SYSDOLPHIN.ts`, `src/SYSDOLPHIN/SYSDOLPHIN_Render.ts`, `src/SuperSmashBrosMelee/Melee_ft.ts`, `src/SuperSmashBrosMelee/Melee_map_head.ts`, and `src/gx/gx_displaylist.ts`.
- Copyright (c) 2018 Jasper St. Pierre.
- Full upstream notice and MIT terms: [third_party/noclip.LICENSE](noclip.LICENSE).

This project uses its own bounded parser and Three.js viewer adapter, not the complete noclip rendering framework. The original HSD decompilation was also consulted; notably, Hermite tangents are scaled by segment duration according to the original spline evaluation.

## Three.js

Three.js supplies the WebGL renderer, buffer abstractions, math types, and OrbitControls. The exact dependency is pinned in [package-lock.json](../package-lock.json). MIT license: [web/public/licenses/three.LICENSE](../web/public/licenses/three.LICENSE).

## React and React DOM

React and React DOM provide the declarative UI and cached-store subscriptions. Versions are pinned in [package-lock.json](../package-lock.json). MIT licenses are distributed at [web/public/licenses/react.LICENSE](../web/public/licenses/react.LICENSE) and [web/public/licenses/react-dom.LICENSE](../web/public/licenses/react-dom.LICENSE).

## ws

The server-side WebSocket room transport uses ws (MIT); it is not included in the browser application. License: [third_party/ws.LICENSE](ws.LICENSE).

## @noble/hashes

The local SHA-1 compatibility fallback and SHA256 content/state fingerprints for non-secure LAN HTTP origins use @noble/hashes (MIT). Its version is pinned in [package-lock.json](../package-lock.json), and its license is distributed at [web/public/licenses/noble-hashes.LICENSE](../web/public/licenses/noble-hashes.LICENSE). This is a legacy disc checksum, not an authentication mechanism.

## vgmstream

SSM container and Nintendo DSP ADPCM interpretation in [lib/game/audio.ts](../lib/game/audio.ts), and HALPST music interpretation in [lib/game/music.ts](../lib/game/music.ts), were informed by vgmstream, notably its `src/meta/ngc_ssm.c`, `src/coding/ngc_dsp_decoder.c`, `src/meta/halpst.c`, and `src/layout/blocked_halpst.c`. A separate native reference build was used for PCM comparison. Inspected revision: `09c9f40caae4747e44b6a993b3d5b654cef4d1f7`, https://github.com/vgmstream/vgmstream. Full notice/license: [third_party/vgmstream.LICENSE](vgmstream.LICENSE).

The browser distribution includes the applicable notices under [web/public/licenses/](../web/public/licenses/). These software licenses do not grant rights to distribute Nintendo/HAL game assets. No game assets are included in the viewer build.
