# Rift Descent — solo roguelike prototype

A seeded solo descent played through the existing limited local prototype. One
human walks a Slay the Spire-style map of CPU stock matches, events, rest
sites, shops and treasure, collecting Hades-style patron boons (rarities,
poms, duos). The descent is **50 floors in five acts**, with an act boss every
10 floors, and it is tuned to be nearly impossible: every floor is harder than
the last. Every run pays shards and keys into browser-local permanent
progression.

## Scope honesty (read first)

- Fights reuse the real prototype simulation: `LocalMatch` in
  `lib/game/match.ts`, original fighter/stage data, prototype CPU AI in
  `lib/game/cpu.ts`, original physics/combat data.
- The **map, boons, events, Mirror and rift platform remixes are explicit
  prototype additions, not original Melee behavior** — every roguelike screen
  carries a scope note saying so.
- Setup-lane effects only change legal match setup (stocks, clock, starting
  percents, CPU levels, extra rival seats). Sim-lane effects ride on
  neutral-by-default `RogueMods` + `RogueHex` in `lib/game/roguelike/sim.ts`,
  called from a handful of hook sites in `lib/game/match.ts` (hit scaling,
  post-hit triggers, hex ticks, Last Stand stock refunds, the self-movement
  step, the air-jump budget). Neutral fighters multiply by exactly 1 and never allocate
  a hex, so versus, online and every other mode are unchanged. Launch power
  rides the existing `physics.hit` knockback-multiplier argument; no damage
  formulas, physics constants, move tables or original functions were edited.
- Crits are deterministic hashes of (frame, slots, attack serial); arcs,
  thorns, doom and burn are percent-only and never launch or KO by themselves.
  Arcs, doom, thorns and thunderclaps deal their flat card number (they do not
  scale with damage bonuses), so every card reads exactly what happens.
- Speed boons, slows and boss speed scale only the **position step** of
  self-movement (walk, dash/run, jumps, air and aerial drift) through
  `rogueMoveMul`; stored velocity, knockback, root-motion attacks and specials
  are untouched, so nothing compounds and full tilt (keyboard, Lv9 CPUs) gets
  the full bonus. Burn refreshes keep their tick phase (`rogueVenom`), so
  rapid hits never postpone the next +1%.
- Each boon has a `cap` equal to its lane cap, so a card never shows a larger
  number than it applies. Rarity luck is in probability points (Patron's
  Favor +10% per rank, Compass relic +5/10/15%, Rift Compass +20%).
- Rift floors jitter **pass-through platforms only** (see
  `lib/game/roguelike/procedural-stage.ts`); solid ground, blast zones,
  spawns and ledges stay byte-identical. Visuals are labeled approximate.
- Solo/local only. Online relay is untouched.

## How to play

Every Rift Descent screen is a single viewport page with **no scrolling**
(header · body · footer, sized from the free space; tuned for a 891×411
landscape phone up to desktop). Shared scaffolding lives in
`web/src/play/roguelike-layout.tsx` + `web/src/play/roguelike-screens.css`.

1. **RIFT DESCENT** on the mode screen opens a small screen router
   (`web/src/play/roguelike-setup.tsx`): the **hub** (banner menu like the home
   screen: ENTER THE RIFT, CHAMPION, LOADOUT, MIRROR, DESCENT RULES) and one
   screen per banner. **CHAMPION** shows the whole roster at once (a fitted
   grid) with the fighter's mastery. **LOADOUT** attaches permanent unlocks:
   the champion's **Aspect** (by mastery rank) and **relics** from the vault
   (1 slot, +2 with the Mirror's Relic Satchel). **MIRROR** spends shards.
   **DESCENT RULES** sets the seed (`RIFT-XXXX`, blank = random), wrath and
   **Heat** (0–5: +1 foe level and +8% foe damage per point for +25% score
   each) with an act-1 map preview. BACK / Escape / controller B return to
   the hub.
2. **Blessing**: choose 1 of 3 starting gifts (coins, a rare boon, an epic
   Chaos pact, pocket items, an extra heart, rerolls, a run-wide Last Stand…).
3. **Map**: one act at a time, left → right (10 floors across, 3 lanes, the
   boss on the right), with act pills for the five bosses and a room detail
   panel. Glowing rooms are reachable from your path. Room types: battle,
   elite (rare+ reward, gifts), event, rest, shop, treasure, boss. Combat rooms
   show their **door reward** up front. Run screens keep your lives, coins,
   rerolls, stands, pockets and treasures in the header and the boon rail +
   **BUILD** button (full build as a fitted tile grid) in the footer.
4. **Fight**: the arena stays clear — one small run chip (act · floor, room,
   lives, live Last Stands, foe-gift icons), a slim boss ribbon on boss floors
   (percent and stocks are already on the match HUD cards), and pocket items
   bottom-left on keys **1–3** only while you hold some. Status chips float
   over fighters (burn, doom, jolt, undertow, retaliate ready, Last Stand,
   enraged) and popups call out crits, arcs, doom bursts, thorns,
   thunderclaps, pocket use and KO coins. Bosses **enrage on their last stock**.
   A floor ends the moment **your** last stock is gone, even with several rivals
   still standing (`RogueMods.essential` on the champion → `rogueEssentialOut`
   in `lib/game/roguelike/sim.ts`); it counts as a lost floor.
   **Pause (Esc)** stays the Melee-style camera pause with a small
   **RUN · BUILD** pill: click it (or press **I**) for the full run view with
   tabs **1 BUILD**, **2 RUN** (stats + the act map with your route),
   **3 LOADOUT** and **4 FOES**. Esc goes back to the camera pause; Esc again
   resumes.
5. **Rewards**: pick 1 of 3 (keys 1–3), 🎲 reroll with Fated Authority charges,
   or skip for coins. Poms show the value change (`6.8 → 9`).
6. Before every boss, **Charon's antechamber** sells boons, pocket items, a pom,
   a purge (remove a boon), healing and one reroll.
7. **Act bosses** (floors 10/20/30/40/50): The Warlord → Twin Terrors → The
   Titan → **GIGA BOWSER** → **Rift Sovereign** (Giga Bowser + a boosted
   champion). Bosses carry 3–5 stocks, 2–4 gifts and damage/toughness/launch
   boosts, and enrage on their last stock. Beating one pays a big coin bounty
   (150 → 1000), +1 max life and a full heal, a pocket item, a pick of **1 of 3
   boss treasures** (run-long), and then an EPIC boon.
8. Lose a floor: −1 run life and retry; draws replay free. Clearing floor 50
   wins (+5000). Win or lose, the end screen pays **shards** and **Rift Keys**
   (the n-th boss pays n keys, a win pays 10 more).

## Systems

- **Map** (`lib/game/roguelike/generator.ts`): `length` rows × 3 lanes, bosses
  on every fourth row and the finale (single center node), non-crossing edges
  to neighbouring lanes, pacing rules (row 0 all battles, no early elites/rests,
  no shop right before a boss, ≤1 rest/shop/treasure per row, ≤1 treasure per
  act, a fight in every row). Combat floors keep the old plan data: enemies
  (1–3, `HORDE` 5–7, `SWARM` exactly seven Lv1), level curve, foe damage
  rage, modifiers, affixes, rift remix flag. `ENDURANCE`/`HORDE`/`SWARM`
  upgrade the door reward.
- **Matchups** (`FloorPlan.format`, `floorVersus`): a single rival is a duel;
  2+ rivals are either an allied **team** (`N VS 1`: `RogueMods.team` makes
  `rogueAllied` skip their strikes, grabs, shots, items and CPU targeting —
  multi-slot bosses, the Echo mirror and gauntlet twins always ally) or a
  **free-for-all** (35% of regular 2–3 rival floors, every `HORDE`/`SWARM`). The map detail
  and intro show a badge, and the fight chip a `2v1`/`FFA` tag.
- **Economy** (`lib/game/roguelike/run-state.ts`): a won floor pays
  `(45 clear + (5 + Tailwind Toll) × KOs + 25 flawless) × coinMul`, so clears
  outweigh crowd KOs. Shop prices (boons 90/140/210/260, pom 110, heal 120,
  purge 70, reroll 30, pockets) grow **+25% per act** in `runPrice`; boss
  bounties are 75/150/225/300/400, coin doors `60 + 6×row`, and the Golden Idol
  gives ×1.5 coins. Late shops restock empty boon shelves with poms.
- **Patrons & boons** (`lib/game/roguelike/patrons.ts`,
  `lib/game/roguelike/boons.ts`): VOLTRA (arcs, jolt, thunderclap), MAELSTROM
  (launch power, breaker, anchor, undertow), PYRA (burn, doom, fury,
  wildfire), AEGIS (armor, thorns, Last Stand, retaliate), NOCTURNE (leech,
  feast, blood rage, crimson pact), SAGITTA (crits, lethal, executioner,
  opening shot), ZEPHYR (speed, feather wings, tolls, borrowed time), THE RIFT
  (lives, stocks, score) and CHAOS (pacts). Rarity scales magnitude
  (common ×1, rare ×1.5, epic ×2) and each pom level adds +50% (max Lv5).
  Nine duo boons unlock once two patrons are owned. Owned boons are
  `{ id, rarity, level }`; `computeBoonState` rebuilds the whole build with
  stacking caps every time.
- **Sim lanes** (`lib/game/roguelike/sim.ts`): damage dealt/taken, launch
  power/taken, crit chance/multiplier (+airborne bonus), arc damage/range,
  thorns, leech, blood rage, execute (damage and launch vs 100%+), opener,
  burn bonus, doom, jolt (foe damage down), undertow (foe movement slow),
  retaliate, thunderclap, Last Stand refunds, extra jumps, duo triggers.
- **Foe affixes** (`lib/game/roguelike/affixes.ts`): vampiric, venomous,
  enraged, swift, bulwark, infernal, thorned, titan, deadeye, stormborn,
  undying (never on crowds). Elites 1 (2 at heat 4+), bosses 2, finale 3.
- **Events** (`lib/game/roguelike/events.ts`): Well of Charon, Chaos Gate,
  Fountain of Dreams, Golden Trophy, Blood Altar, Mysterious Hat, Sparring
  Hall, Rift Storm, Wandering Merchant, Echo of Yourself. Curses ride
  `pending` next-fight entries (level shift, extra affixes, a mirror rival,
  upgraded reward, bonus score).
- **Run state** (`lib/game/roguelike/run-state.ts`): pure
  blessing → map → intro/fight/reward | event | rest | shop → … machine with
  rerolls that keep their offer rules, shop sub-offers (pom/purge) with
  refunds, run-wide defiances and flawless tracking (no stock lost).
- **Meta** (`lib/game/roguelike/meta.ts`): Mirror talents (Resilience, Death
  Defiance, Golden Touch, Fated Authority, Deep Pockets, Patron's Favor, Thick
  Skin) with free refunds; shards per run; blessings. localStorage only.
- **Consumables** (`lib/game/roguelike/consumables.ts`): 🧪 Healing Draught,
  💣 Smoke Bomb, ⭐ Star Bit, 🪶 Phoenix Feather (a Last Stand this floor),
  🌩 Storm in a Jar (12% + jolt on every rival).
- **Web** (`web/src/play/roguelike-session.ts`,
  `web/src/play/roguelike-scenes.tsx`, `web/src/play/roguelike-hud.tsx`,
  `web/src/play/roguelike-text.ts`, `web/src/play/roguelike.css`): the
  controller drives `GameSession` through its public API plus
  `session.eventTaps` (confirmed match events → popups/boss enrage). Floors
  whose fighters/stage are still downloading show "Opening the rift…" and bind
  to the real match once it starts; a pause-menu Rematch re-binds the same
  floor. Full EN/ES localization. `?rogueDebug` in the URL exposes
  `window.smashRogueDebug` for browser specs.

## Difficulty and bosses (`lib/game/roguelike/generator.ts`, `lib/game/roguelike/bosses.ts`)

- **Curve**: CPU level `1 + 8·depth^0.8 + wrath + heat` (capped at 9 around
  act 4). The foe side keeps scaling every floor after that: damage
  `1 + 0.05·act + 1.1·depth^1.3` (×1.08 per heat), damage taken down to ×0.45,
  launch taken down to ×0.5, and speed up to +12%. Crowds grow per act (1–2 →
  3–4 rivals), battle gifts go from none to almost certain (often two), elites
  get two gifts past halfway, and elites have 4 stocks from act 4. The player's
  boon caps stay fixed, so the late acts outscale any build.
- **Bosses**: seeded fighters per tier, boosted through `boostMods`. Giga
  Bowser (`Gk`) comes from the ACE 2.0 extension disc; when the source lacks
  `PlGk.dat`, a heavier boosted Bowser stands in and the boss bar says so.
- **Boss treasures**: Titan Heart, War Crown, Patron Blessing, Executioner's
  Edge, Aegis Core, Golden Idol, Phoenix Crown, Eye of the Storm, Rift Compass.
- **Enemy pool** now also includes Falco, Dr. Mario, Ganondorf, Pichu, Marth,
  Luigi, Yoshi, Ice Climbers, Zelda, Sheik and Mr. Game & Watch (smoke-tested as
  boosted Lv9 CPUs on real disc data).

## Permanent unlocks (`lib/game/roguelike/unlocks.ts`, `lib/game/roguelike/meta.ts`)

- **Relics** (Hades Keepsakes): 13 relics, 2 starters. Others unlock by
  lifetime achievements checked at the end of every run (first boss, 3 elites,
  5 runs, 3 bosses, 3 boons from one patron, 8 events, 600 coins spent, a Chaos
  pact, a duo boon, a completed descent, a Heat 1+ descent) or early with
  🗝 **Rift Keys** (1 per boss, +2 per victory). Equipped relics gain XP
  (fights won + 2 per boss) and level Lv1 → Lv2 (8 XP) → Lv3 (20 XP).
  Build relics fold into `computeBoonState` before the caps; run-start relics
  (coins, pockets, rerolls, pacts, Last Stands, lives, shop discount, rarity
  luck) apply in `createRun`.
- **Champion mastery** (Hades Weapon Aspects): every fighter earns XP per run
  (floors, bosses, elites, victory, ×heat) across 8 ranks. Ranks unlock the
  Tempest (2), Bastion (4) and Reaper (6) aspects (Vanguard is free), +1
  reroll (3), aspects Lv2 + 40 coins (5), +1 run life (7) and aspects Lv3 (8).
- **Run report**: the end screen shows keys, shards, mastery XP / rank-ups,
  relic XP / level-ups and newly unlocked relics. Everything persists in
  `localStorage` (`smash-roguelike-meta`); older saves migrate automatically.

## Art (`web/src/play/rogue-art/`, `web/src/play/roguelike-art.tsx`)

Painted assets generated for Rift Descent (not Melee data): patron medallions,
currency/stat icons, room tokens, 48 boon icons, relics, aspects, pocket items,
foe gifts, status marks, Mirror talents, blessings, rarity gems, mastery ranks,
12 event/rest/shop scenes, four rarity card frames and the abyss backdrop.
They are WebP files named by game id (`boon/volt-arc.webp`, `room/boss.webp`…),
bundled through `import.meta.glob` so they get hashed immutable URLs. `Art`
falls back to the old emoji when a file is missing. Boss treasures and bosses
reuse the closest painted pieces (`TREASURE_ART`, `BOSS_ART`). Cards use the
rarity frames with the content inside the frame window (`.rogue-framed`); keep
framed cards in grid tracks, because their percentage padding resolves against
the containing block. The server's static MIME allowlist includes `.webp`.

## Enemy pool

Base-disc originals (`Fx Mr Kb Ss Pk Fe Lk Ca Dk Mt Cl Pr Ns Kp Pe Fc Dr Gn Pc
Ms Lg Ys Pp Zd Sk Gw`), never the player's own
fighter (except the Echo event's mirror rival). About 35% of regular rivals are
ACE 2.0 champions (`ACE_ENEMY_FALLBACKS`: Zero, Toad, Meta Knight, Sonic, …),
each with a base-disc stand-in fielded when the source has no `Pl<kind>.dat`.
Giga Bowser stays a boss slot.

Installed local character packs can be selected as the player. V1 does not automatically add them to the generated enemy pool; their gameplay state remains snapshot-owned. See [docs/characters/CUSTOM_CHARACTERS.md](characters/CUSTOM_CHARACTERS.md).

## Checks (from the repository root)

```sh
npm run typecheck
npm test -- tests/unit/roguelike-
MELEE_DISC_PATH="$PWD/private/disc/Super Smash Bros. Melee (USA) (En,Ja) (v1.02).iso" npm test -- tests/unit/roguelike-mods-real.test.ts
MELEE_DISC_PATH=... npm run test:server-browser -- tests/server-browser/roguelike.spec.ts
```
