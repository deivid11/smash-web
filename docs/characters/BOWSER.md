# Bowser (Kp)

Imported 2026-09-14. Selector 14, native FTKIND 5, announcer cue `0x7C840` (gm_80168C5C CKIND_KOOPA=5).
Assets: `PlKp.dat`, `PlKpNr.dat`, `PlKpAJ.dat`, `EfKpData.dat`, `audio/us/koopa.ssm`. 76-joint skeleton.

## Specials

- **Fire Breath (SpecialN)** — `lib/game/koopa.ts` + the slot-0 flame article. Flames spawn from the
  mouth every 3 frames while B holds; the shared breath pool (`MatchFighter.koopaBreath`, x222C,
  40–360) drains 2/frame breathing and recovers 0.7/frame otherwise, scaling flame speed and reach.
  Approximations: fixed cadence and mouth offset; the native per-flame arc table is unported.
  The flame article holds no mesh — its whole look is `efSync 0x4DB-0x4DE`, four particle
  generators from `EfKpData` attached to each flame. See [BOWSER_FIRE.md](../BOWSER_FIRE.md).
- **Koopa Klaw (SpecialS)** — element-8 window in the SpecialSStart script feeds `combat.specialCatch`;
  the bite loop (SpecialSHit script) pummels the captured partner (damage-only hits) and a hard
  F/B stick tosses through the shared throw flow with SpecialSEndF/B. The native mash escape and
  the TKoopa* victim overlays are unported.
- **Whirling Fortress (SpecialHi)** — grounded: root motion plus x68 drift under the x60 clamp
  (multihit script); aerial: x54 rise, x58/x5C fall, x64 drift clamp, 50 frames of landing lag.
- **Bowser Bomb (SpecialLw)** — grounded hop by root motion until the script's dive command, aerial
  entry scaled by x80/x84; the plunge forces x94 (−7.5) and lands in the dedicated SpecialLwLanding crash.

## Tests

- [tests/unit/koopa-real.test.ts](../../tests/unit/koopa-real.test.ts): registration, parameters,
  breath decay/recovery + flame hits, Klaw catch/bite/toss, Fortress ground hit + aerial rise, Bomb plunge.
- [tests/server-browser/koopa-peach.spec.ts](../../tests/server-browser/koopa-peach.spec.ts): real keyboard
  Fire Breath and Fortress on the play page.
