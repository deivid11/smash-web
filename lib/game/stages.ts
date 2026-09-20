import type { HsdModel } from '../hsd/model.ts';
import { Color } from 'three';
/** Only static floor geometry (flat or bounded slopes) supported by the prototype collision adapter.
 * fogBackground: the map_head entry whose HSD_FogDesc the original loads as the
 * scene fog and background color (Ground_801C1E94 over foo(): the first
 * StageCallbacks entry with flags_b1 set, i.e. BE bit 30 — 0x40000000 or
 * 0xC0000000 — in third_party/melee/src/melee/gr/gr*.c). A null desc there means
 * a black background. Per-object fog ranges come straight from the archive. */
/** Scene background from the original per-stage fog pick: the flagged map
 * entry's fog color, or black when that entry defines none — exactly the
 * game's Ground_801C1E94 fallback. */
export function stageBackground(model: HsdModel, entry: number): Color {
  const fog = Number.isInteger(entry) && entry >= 0 ? model.fogEntries[entry] : null;
  return fog ? new Color(fog.color[0], fog.color[1], fog.color[2]) : new Color(0, 0, 0);
}
export const SUPPORTED_STAGES = [
  { id: 'battlefield', label: 'Battlefield', asset: 'GrNBa.dat', music: 'battlefield', fogBackground: 6, limitations: 'Static original floors/ledges; no complete original stage engine.' },
  { id: 'final', label: 'Final Destination', asset: 'GrNLa.dat', music: 'final', fogBackground: 4, limitations: 'Static original floor/ledges; background animation is not the complete original stage engine.' },
  // staticAreas: grCorneria's load code (grcorneria.c, mpLib_80057BC0 calls) disables
  // collision joints 0–2 and 5–7 — the six runtime Arwing platforms — and leaves joints 3
  // (the hull deck, walls and undersides) and 4 (the small floor under the nose) enabled.
  // hiddenObjects: map roots 2/10 are the close Arwing fly-by models and 5/6 small
  // sequence props the original code spawns on demand; parked they sit inside the
  // arena. The city strips 8/9/4 stay visible: the renderer replays their original
  // conveyor + altitude dips (web/src/render/corneria-flyby.ts, from grcorneria.c).
  { id: 'corneria', label: 'Corneria', asset: 'GrCn.dat', music: 'corneria', staticAreas: [3, 4], hiddenObjects: [2, 5, 6, 10], fogBackground: 7, limitations: 'Static Great Fox hull with the original city-strip flyby replayed visually: Arwing fly-bys, lasers, walls/ceilings, runtime platforms and the ship bob are not simulated.' },
  { id: 'temple', label: 'Hyrule Temple', asset: 'GrSh.dat', music: 'temple', fogBackground: 2, limitations: 'Static original floors/slopes/ledges; wall and ceiling lines block crossings (blocked fighters slide along them), without walljump, wallbounce or push-out.' },
  { id: 'stadium', label: 'Pokémon Stadium', asset: 'GrPs.dat', music: 'stadium', fogBackground: 2, limitations: 'Original transformation cycle over per-form collision sets that scale and rise with the terrain and carry standing fighters; the monitor display, crowd and per-form particle effects are not simulated.' },
  // yoshi-story: grstory.c drives Randall (area 0) along a travel loop with a moving
  // collision box, so only area 1 (main, side/top platforms) is static; the cloud
  // model (map root 2) is hidden with it. Shy Guys carry food without collision.
  { id: 'yoshi-story', label: "Yoshi's Story", asset: 'GrSt.dat', music: 'yoshi-story', staticAreas: [1], hiddenObjects: [2], fogBackground: 3, limitations: 'Static original floors/ledges without traveling Randall (hidden); Shy Guys carry food without collision.' },
  // dream-land: groldpupupu.c never touches collision; Whispy sway is visual-only.
  { id: 'dream-land', label: 'Dream Land N64', asset: 'GrOp.dat', music: 'dream-land', fogBackground: 5, limitations: 'Static original floors/ledges; Whispy sway and wind not simulated.' },
  // peach-castle: grcastle.c init (grCastle_801CD37C) disables every area except 3
  // (castle/tower), 4 and 5 (the traveling yellow platforms, frozen at dock here since
  // lift motion is code-driven). Areas 6-8 and 11-12 are the rest-pose side/brick blocks
  // (floors 16-18/21-22 with their ceilings/walls); kept static so their visuals
  // block and land instead of passing through. They never break or move here.
  // Prototype addition beyond the original init: areas 0 (tiny top cube), 1-2 (sloped
  // side platforms), 9-10 (top one-way flats) and 13-14 (side extensions at
  // castle-deck height) are also frozen at rest so every colored visual lands instead
  // of falling through. Areas 0-3 and 6-14 are world-space lines (no offset); areas
  // 4-5 are joint-local to the yellow-platform owner joints (GrCs map root 6 j1/j4 at
  // (-144/144,205) model units, dock pos from yakumono_param x14=205; stage scale 0.5
  // gives areaOffsets [-72,102.5]/[72,102.5], see lib/game/data.ts AreaOffset). One-way
  // flags are honored (land from above, jump up through, down to drop).
  { id: 'peach-castle', label: "Peach's Castle", asset: 'GrCs.dat', music: 'peach-castle', staticAreas: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], areaOffsets: [[4, -72, 102.5], [5, 72, 102.5]], hiddenObjects: [18, 19, 20], fogBackground: 3, limitations: 'Static castle/tower with side brick blocks frozen at rest (no switch/break behavior); yellow traveling platforms and top/side one-way decks frozen at rest as a prototype addition (original disables all but castle/lift at init and drives the yellows); Bills fly on the original spawn window with prototype straight flight and radial blast, parked Bills hidden.' },
  // onett: gronett.c keeps the town (areas 0-2) always active and toggles areas
  // 3/4 (two overlapping center rooftop lines) during the center-building
  // animations. Areas 0/1 (the awning canopies) and 3/4 (the rooftop) are
  // joint-local: areaOffsets bakes each to its owner joint's rest pose
  // (canopy joints (-108,55.8)/(-49.5,75) and the rooftop joint (9,39.5),
  // model units ×0.9 stage scale; see lib/game/onett.ts ONETT_AREA_BAKES).
  // Map root 1 is never instantiated by the original init (gobjs 0/2/5/4/3
  // only) and stays hidden. Cars, the crossing warning, the collapsible
  // building, the awning springs and the stage SFX all simulate from the
  // original data (lib/game/onett.ts); only map-bank particles stay out.
  { id: 'onett', label: 'Onett', asset: 'GrOt.dat', music: 'onett', hiddenObjects: [1], areaOffsets: [[0, -97.2, 50.22], [1, -44.55, 67.5], [3, 8.1, 35.55], [4, 8.1, 35.55]], fogBackground: 5, limitations: 'Full hazard simulation from original data: 30% car hits with crossing warning, collapsible center rooftop and spring awnings with original SFX; map-bank particles unported.' },
  // mute-city: dynamic road (lib/game/mutecity.ts replays the 60 s
  // grMuteCity_801F04B8 script over grMc_803E34E0 in table order). Init leaves
  // areas 3 (start pad, line 0) and 4 (runtime traveling-deck slot); stops
  // enable the surrounding road and the 2273-3290 flight drops the deck, so
  // staticAreas below is only the starting layout and phases extend it.
  // The 30 map roots below are the F-Zero starting grid (grMc_803E34A4,
  // spawned by grMuteCity_801F044C via grFZeroCar_801CAFBC): the original
  // repositions every one of them along the track splines each frame
  // (grMuteCity_801F1A34), so the rest grid is never visible after init. The
  // prototype has no car simulation, so the grid stays hidden like Corneria's
  // parked Arwings. Cars, camera/blast shifts, sounds and tilt collision stay
  // unported; the middle deck segment spans the full road width (prototype
  // interpretation, see mutecity.ts) and animated fog shifts are frozen.
  { id: 'mute-city', label: 'Mute City', asset: 'GrMc.dat', music: 'mute-city', staticAreas: [3, 4], hiddenObjects: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 32, 33, 34, 35], fogBackground: 30, limitations: 'Traveling road platform on the original 60 s area cycle with the parked starting-grid cars hidden; car hazards, camera/blast shifts, sounds and tilt collision not simulated.' },
  // yoshi-island: gryorster.c spins nine blocks independently (areas 1-9, joints
  // 0xA-0x12) and phases each joint's lines mid-spin (mpLib_80057BC0 disables,
  // mpJointListAdd restores); the island (area 0) is static. Areas 1-9 share
  // identical joint-local rest lines, so areaOffsets bakes each line to its owner
  // joint's rest pose (GrYt map root 1 joints 10-18, scale 0.85). Areas 1-3 are kept
  // as the center bridge row (joints 13/14/15 at (-10/0/10,-5): floors y=0 flush
  // with the island) and areas 4-9 as the six elevated side blocks (joints
  // 10/11/12 at (-45/-35/-25,45) and 16/17/18 at (25/35/45,45): floors y=42.5).
  // Identical locals make any bijection the same world set; the kept ids preserve
  // the verified center bridge while adding the sides.
  { id: 'yoshi-island', label: "Yoshi's Island", asset: 'GrYt.dat', music: 'yoshi-island', staticAreas: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], fogBackground: 1, areaOffsets: [[1, -8.5, -4.25], [2, 0, -4.25], [3, 8.5, -4.25], [4, -38.25, 38.25], [5, -29.75, 38.25], [6, -21.25, 38.25], [7, 21.25, 38.25], [8, 29.75, 38.25], [9, 38.25, 38.25]], limitations: 'All nine blocks spin independently for ~323f when bumped from below or struck (shots and loose items included), phasing out that block\u2019s floor/walls/ceiling while turning; without per-block force accumulation, block damage or the return flight.' },
  // green-greens: grgreens.c drops/breaks blocks from 30 slots (areas 0-29,
  // joint-local rest lines centered at the origin) over area 30 (ground, stumps,
  // platforms, static). The prototype keeps area 30 frozen and simulates the
  // 5x6 block grid (see lib/game/greens.ts) with the original spawn/weight/fall
  // timers, plus Whispy wind/apples on the original event cycle.
  { id: 'green-greens', label: 'Green Greens', asset: 'GrGr.dat', music: 'green-greens', staticAreas: [30], fogBackground: 6, limitations: 'Falling/breakable star blocks with prototype radial bomb blasts (original blast values unported) and Foods for apples; Whispy wind pushes fighters with a prototype tree lean (blow clips, quakes and particles unported).' },
  // venom: grvenom.c init disables areas 3 (mid-deck) and 4 (under-arc), reserved for
  // runtime Arwing dockings; hull and wings (areas 0-1) are static.
  { id: 'venom', label: 'Venom', asset: 'GrVe.dat', music: 'venom', staticAreas: [0, 1, 2], fogBackground: 5, limitations: 'Static Great Fox hull/wings; mid-deck/under-arc excluded per original init; dockings not simulated.' },
  // jungle-japes: grgarden.c never touches collision; Klaptrap and water are hazards/scenery.
  { id: 'jungle-japes', label: 'Jungle Japes', asset: 'GrGd.dat', music: 'jungle-japes', fogBackground: 2, limitations: 'Static island/platforms; Klaptrap and water are decorative.' },
  // fourside: grfourside.c never touches collision; the UFO and crane move without collision.
  { id: 'fourside', label: 'Fourside', asset: 'GrFs.dat', music: 'fourside', fogBackground: 6, limitations: 'Static buildings/crane base; UFO flybys and crane motion not simulated.' },
  // brinstar: grzebes.c rebuilds area 0 (the acid surface) every frame and disables
  // it outside the safe phase, so only areas 1-5 (bridge, pods, main terrain) are
  // static. The stage visual (lava mass, organic sway) is frozen at its rest pose so
  // it cannot desync from the frozen collision; lava rise and bridge breaks excluded.
  { id: 'brinstar', label: 'Brinstar', asset: 'GrZe.dat', music: 'brinstar', staticAreas: [1, 2, 3, 4, 5], fogBackground: 6, limitations: 'Static terrain without the rising acid (excluded per original init); lava and scenery frozen at rest, bridge never breaks.' },
  // kongo-jungle: groldkongo.c never touches collision; areas 0-1 are duplicate
  // center rock lines kept as shipped. The barrel swing and background motion are
  // frozen at rest; the barrel fires nothing and Klap Trap stays decorative.
  { id: 'kongo-jungle', label: 'Kongo Jungle', asset: 'GrOk.dat', music: 'kongo-jungle', fogBackground: 3, limitations: 'Static island/platforms; barrel and background frozen at rest, barrel fires nothing.' },
  // fountain-of-dreams: grizumi.c never disables a joint; areas 0-2 are the three
  // side platforms (identical joint-local lines) baked to their static owner joints'
  // rest poses (GrIz map root 2 joints (0,55.5)/(-47,-1.5)/(47,-1.5), scale 0.75) and
  // area 3 the static base. Platform rise/fall and water shimmer are frozen.
  { id: 'fountain-of-dreams', label: 'Fountain of Dreams', asset: 'GrIz.dat', music: 'fountain-of-dreams', fogBackground: 3, areaOffsets: [[0, 0, 41.625], [1, -35.25, -1.125], [2, 35.25, -1.125]], limitations: 'Static base/platforms placed at rest; platform rise/fall not simulated.' },
  // mushroom-kingdom: grinishie1.c never disables a joint (its callbacks only award
  // block items); all 22 areas stay. Areas 1-19 are nineteen identical joint-local
  // ?-block boxes baked to their static 2-part owner joints' rest poses (GrI1 map root
  // 3 joints j3-j21, scale 0.85; identical locals make any bijection the same world
  // set). The code-driven seesaw pair (areas 20-21, joints 0x14/0x15) rests at the
  // side platforms (GrI1 map root 3 joints j26/j28 at (+/-55.25,29.75), scale 0.85;
  // identical locals make either bijection the same world pair).
  // ? blocks never deplete; Piranha Plants decorative.
  { id: 'mushroom-kingdom', label: 'Mushroom Kingdom', asset: 'GrI1.dat', music: 'mushroom-kingdom', fogBackground: 3, areaOffsets: [[1, -25.5, 29.75], [2, -17.85, 63.75], [3, 17.85, 63.75], [4, 26.35, 63.75], [5, 34.85, 63.75], [6, -89.25, 38.25], [7, -97.75, 38.25], [8, -106.25, 38.25], [9, 89.25, 38.25], [10, 97.75, 38.25], [11, 106.25, 38.25], [12, -17, 29.75], [13, -8.5, 29.75], [14, 0, 29.75], [15, 8.5, 29.75], [16, 17, 29.75], [17, 25.5, 29.75], [18, -34.85, 63.75], [19, -26.35, 63.75], [20, 55.25, 29.75], [21, -55.25, 29.75]], limitations: 'Static ground/pipes/blocks placed at rest with frozen seesaw lifts; ? blocks never deplete, plants decorative.' },
] as const;
/** No per-stage cap: the 5–8 prototype spawn layout drops seats onto the topmost solid
 * floor at each x (slopes included), so every supported stage seats the full eight. */
export const STAGE_PLAYER_LIMITS: Readonly<Partial<Record<StageId, number>>> = {};
export function stagePlayerLimit(id: StageId): number { return STAGE_PLAYER_LIMITS[id] ?? 8; }
export type StageId = typeof SUPPORTED_STAGES[number]['id'];
export function supportedStage(id: StageId): typeof SUPPORTED_STAGES[number] {
  const stage = SUPPORTED_STAGES.find(stage => stage.id === id);
  if (!stage) throw new Error('Unsupported gameplay stage.');
  return stage;
}
