# Costumes: original Melee skins

General guide: [docs/characters/ORIGINAL_ISO.md](ORIGINAL_ISO.md). Registry: [docs/characters/README.md](README.md).

Every original fighter's alternate costumes are the real `Pl<kind><suffix>.dat`
models from the USA v1.02 disc (94 files, allowlisted by name in
`COSTUME_ASSETS`). Each seat picks a skin on the character select with the
◀ ▶ stepper under its player panel; the seat portrait re-renders in that skin.

## Why skins are visual-only

All costumes of a fighter share the exact same skeleton, action table, scripts,
articles, parameters and physics. Only the model file differs, so a skin never
enters simulation state: rollback snapshots, hashes, replays and online
determinism are identical in every costume. The lineup (`selectLineup` in
[lib/game/roster.ts](../../lib/game/roster.ts)) gives each slot its own content
object sharing everything but the model — mirror matches can wear different
skins.

## Skin lists

Fixed selector order per fighter (Default first), verified file-by-file
against the disc ([tests/unit/costumes-real.test.ts](../../tests/unit/costumes-real.test.ts)):

| Fighter | Skins |
| --- | --- |
| Fox (4) | Default, Green, Lavender, Orange |
| Mario (5) | Default, Blue, Green, Yellow, Black |
| Kirby (6) | Default, Red, Blue, Green, Yellow, White |
| Samus (5) | Default, Green, Black, Lavender, Pink |
| Pikachu (4) | Default, Red, Blue, Green |
| Mewtwo (4) | Default, Red, Blue, Green |
| Roy (5) | Default, Red, Blue, Green, Yellow |
| Link (5) | Default, Red, Blue, Black, White |
| Captain Falcon (6) | Default, Red, Blue, Green, White, Graphite |
| Donkey Kong (5) | Default, Red, Blue, Green, Black |
| Young Link (5) | Default, Red, Blue, Black, White |
| Jigglypuff (5) | Default, Red, Blue, Green, Yellow |
| Ness (4) | Default, Blue, Green, Yellow |
| Bowser (4) | Default, Red, Blue, Black |
| Peach (5) | Default, Blue, Green, Yellow, White |
| Falco (4) | Default, Red, Blue, Green |
| Dr. Mario (5) | Default, Red, Blue, Green, Black |
| Ganondorf (5) | Default, Red, Blue, Green, Lavender |
| Pichu (4) | Default, Red, Blue, Green |
| Marth (5) | Default, Red, Green, Black, White |
| Luigi (4) | Default, White, Pink, Aqua |
| Ice Climbers (4) | Default, Red, Green, Orange |
| Zelda (5) | Default, Red, Blue, Green, White |
| Sheik (5) | Default, Red, Blue, Green, White |
| Mr. Game & Watch (1) | Default only (no alternates on disc) |
| Yoshi (6) | Default, Red, Blue, Yellow, Pink, Aqua |

Local custom packs currently expose one costume and show no stepper. The ACE 2.0
fighters below have full skin sets from the extension disc (147 files,
allowlisted in `ACE_COSTUME_ASSETS`).

| Fighter | Skins |
| --- | --- |
| Zero (6) | Default, Blue, Green, Black, White, Purple |
| Toad (5) | Default, Red, Blue, Green, Yellow |
| Meta Knight (6) | Default, Green, Black, White, Gk, Mr |
| Sonic (7) | Default, Red, Green, Yellow, Black, White, Orange |
| Raichu (6) | Default, Red, Blue, Green, Black, White |
| Charizard (6) | Default, Red, Blue, Green, Yellow, Lavender |
| Wolf (6) | Default, Blue, Green, Yellow, Brown, Red |
| Diddy Kong (6) | Default, Blue, Green, Yellow, White, Pink |
| King Dedede (9) | Default, Blue, Green, White, Black, Magenta, Orange, Pink, Sh |
| Wario (8) | Default, Red, Green, White, Brown, Lavender, Pink, Aqua |
| Shadow (7) | Default, Blue, Green, Yellow, Mg, Mp, Tr |
| Blastoise (6) | Default, Red, Blue, Green, Yellow, Lavender |
| Lucas (7) | Default, Red, Blue, Green, Black, Orange, Pink |
| Metal Sonic (6) | Default, Red, Green, Yellow, Black, Graphite |
| Ninten (6) | Default, Red, Blue, Green, Purple, Aqua |
| Daisy (9) | Default, Red, Blue, Green, White, Black, Lavender, Pink, Tan |
| Fay (4) | Default, Red, Blue, Green |
| Black Sonic (6) | Default, Red, Green, White, Black, We |
| Dr. Luigi (6) | Default, Green, Yellow, Black, Pink, Aqua |
| Knuckles (11) | Default, Green, Yellow, White, Black, Blue, Cyan, Og, Pr, Tk, Wr |
| Lucina (7) | Default, Red, Green, Yellow, White, Black, Ms |
| Lucas TDX (7) | Default, Red, Blue, Green, Lavender, Orange, Cl |
| Shadow Mewtwo (7) | Default, Red, Blue, Green, Lavender, Brown, Ivory |
| Luigi & Boo (5) | Default, White, Pink, Aqua, St |
| Metal Mario (9) | Default, Red, Blue, Green, Yellow, Purple, Cyan, Crimson, Rb |
| Skull Kid (5) | Default, Blue, Green, White, Purple |

Exotic suffixes without canonical color names (`Gk`, `Mr`, `Sh`, `Mg`, `We`, …)
show their raw codes in the stepper. Deliberately excluded non-skins: anims,
HUD art, trophy stubs, Wolf's `_001` duplicates and `U` moveset files, Toad's
element forms, Sonic's `Sw2`, Raichu's `Cp`/`Lt`, Charizard's `Sh`, Meta
Knight's `Dark` (pre-existing boundary). The ACE disc also carries extra
variants for *vanilla* fighters (e.g. `PlMrAq.dat`); those stay unexposed so
vanilla fighters always render vanilla-disc models.

## Loading and online

Skins load lazily: picking one fetches its model (bone-count validated, shared
session cache) and captures the seat portrait; match start waits for missing
skins the same way it waits for fighters. Online rooms sync the skin index per
seat (`costume` on `choose`/`cpu`, room protocol v7); a client missing the
model holds the start like any missing asset.

## Explicit limitations

- Zelda/Sheik share the same five-suffix order, so a Transform keeps the skin
  index on both sides (preloaded before the match, never mid-simulation).
- Kirby's copy hats always use his default-costume models (`PlKbCp*.dat`);
  per-costume hats (`PlKbBuCp*.dat`…) are not wired.
- Nana dresses in her own same-index skin (`PlNn*.dat`, same suffix order as
  Popo); her skins preload before the match like any other costume, and a
  source without her files keeps the duo on her default (solo Popo only when
  her base model is absent entirely).
- A skin that fails to load falls back to Default without blocking the match.
