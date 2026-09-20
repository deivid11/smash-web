# Jab repeat and chain timing audit

Scope: the original-fighter jab audit, using the user's USA 1.02 disc. Installed custom packs must verify their own authored timings. These are prototype input-flow checks, not proof of whole-engine/GameCube equivalence.

## Character-specific branches

[third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Attack1.c](../third_party/melee/src/melee/ft/kinds/ftCommon/ftCo_Attack1.c) explicitly restarts Attack11 for Pikachu/Pichu instead of entering Attack12. Pikachu is the only currently playable fighter using that branch. Pichu, Marth (which has a different restart branch after Attack12), and Game & Watch are not in this roster; no speculative mappings were added for them. Roy is not Marth.

[lib/game/jab.ts](../lib/game/jab.ts) retains original per-character combo gates, input windows, and rapid-jab thresholds. A missing jab2 does not imply that a fighter should loop jab1: Roy has a single jab, while Mewtwo transitions to its rapid jab.

| Fighter | Jab1 → Jab2 | Jab2 → Jab3 | Rapid entry gate |
| --- | --- | --- | --- |
| Fox | 6 | — | Jab2 frame 6 |
| Mario | 6 | 6 | — |
| Kirby | 6 | — | Jab2 frame 7 |
| Samus | 12 | — | — |
| Pikachu | Restarts Jab1 at 5 | — | — |
| Roy | — | — | — |
| Link | 10 | 10 | Jab2 frame 10 |
| Captain Falcon | 9 | 8 | Jab3 frame 12 |
| Donkey Kong | 10 | — | — |
| Mewtwo | — | — | Jab1 frame 12 |
| Young Link | 10 | 10 | Jab2 frame 10 |

Rapid entry also requires the original press/release threshold. It has priority over the next normal jab when both are eligible. Sustaining and ending rapid attacks uses the original script check flags; holding a normal attack alone does not auto-combo.

## Third-jab recovery correction

The audit found a separate delay in [lib/game/match.ts](../lib/game/match.ts): parsed interrupt frames were not consumed when starting another attack after a third jab. Native `ftCo_Attack13_IASA` delegates to `ftCo_Wait_IASA` once `allow_interrupt` is enabled, after checking rapid-jab entry first.

Fresh grounded attack inputs now use that authored gate, without accelerating the animation or ending a recovery that has no input:

| Third jab | New attack allowed at | Full animation length |
| --- | --- | --- |
| Link / Young Link | 32 | 50 |
| Captain Falcon | 22 | 32 |
| Mario | 22 (unchanged) | 22 |

This is intentionally not a blanket "all attacks end at IASA" rule. Attack11/12 have different native interrupt handlers and do not generally allow a neutral jab restart. For example, Roy's frame-26 IASA must not become a Pikachu-style repeat. This correction covers fresh attack inputs after Jab3; it does not claim to port every original movement, defensive, or special-action interrupt. Premature finisher inputs are not granted a new general-purpose buffer, and hitlag still freezes execution.

## Regression coverage

[tests/unit/jab-roster-real.test.ts](../tests/unit/jab-roster-real.test.ts) checks the full roster: exact combo gates, no held-button auto-combos, all six rapid-jab chains and release paths, missing-jab guards, original finisher interrupt frames, real Link/Young Link three-hit sequences, early-input rejection, unchanged Mario recovery, hitlag, and snapshot/replay determinism.

[tests/unit/pikachu-real.test.ts](../tests/unit/pikachu-real.test.ts) separately locks Pikachu's repeated frame-5 restart and hitlag queue behavior. The original animation, hitbox and sound scripts remain unchanged.
