/** Verified ItCo common scalars for the sole supported USA 1.02 revision.
 * Kept explicit rather than interpreting unrelated fighter-item offsets as timers.
 * Real-disc regressions compare these with itPublicData.x0 at the named offsets. */
export const ITEM_COMMON = Object.freeze({
  reflectedLife: 0.5, // +0x4C
  shieldBounceX: Math.fround(-0.1), // +0x58
  shieldBounceY: Math.fround(-0.3), // +0x5C
  shieldBounceLift: Math.fround(1.3), // +0x60
  explosionLife: 80, // +0xF8, it_8027518C
});
export const LIGHT_ITEM_MOTIONS=['LightThrowF','LightThrowB','LightThrowHi','LightThrowLw','LightThrowDash','LightThrowDrop','LightThrowAirF','LightThrowAirB','LightThrowAirHi','LightThrowAirLw'] as const;
export const SMASH_ITEM_MOTIONS=['LightThrowF','LightThrowB','LightThrowHi','LightThrowLw','LightThrowAirF','LightThrowAirB','LightThrowAirHi','LightThrowAirLw'] as const;
