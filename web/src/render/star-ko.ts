/** Classic upward "Star KO" trajectory (ftCo_MS_DeadUpStar): a fighter launched
 * off the top blast line rises into the sky, recedes into the background and
 * spins while shrinking to a distant point, then twinkles and vanishes. This is
 * the presentation-only motion curve — the simulation already put the fighter in
 * its frozen `ko` state; nothing here feeds back into it.
 *
 * Original reference: third_party/melee/src/melee/ft/ft_0D31.c
 * (ftCo_DeadUpStar_Anim: upward self_vel toward the camera-top offset, +Z drift,
 * per-frame HSD_JObjAddRotationX spin, then effAsync 0x42D twinkle + SFX 0x83). */
export interface StarKoParams {
  /** World units the fighter climbs over its flight. */
  rise: number;
  /** World units it recedes away from the camera (−Z), shrinking by perspective. */
  recede: number;
  /** Radians of roll added per presentation frame (the visible tumble). */
  spin: number;
  /** Final scale as a fraction of the fighter's normal scale. */
  endScale: number;
  /** Flight length in presentation frames (< the 45-frame KO freeze). */
  total: number;
}
export const STAR_KO: StarKoParams = { rise: 40, recede: 150, spin: 0.55, endScale: 0.14, total: 44 };

export interface StarKoPose { y: number; z: number; scale: number; roll: number }

/** Fly-up pose at `age` presentation frames. Y/scale ease out (a quick lift that
 * settles), the roll accumulates linearly so the tumble reads at every distance. */
export function starKoPose(age: number, baseY: number, baseScale: number, params: StarKoParams = STAR_KO): StarKoPose {
  const t = Math.max(0, Math.min(1, age / params.total));
  const ease = t * (2 - t); // easeOutQuad
  return {
    y: baseY + params.rise * ease,
    z: -params.recede * ease,
    scale: baseScale * (1 - (1 - params.endScale) * ease),
    roll: age * params.spin,
  };
}

/** True once the fly-up has reached its vanishing point (time to twinkle + hide). */
export function starKoDone(age: number, params: StarKoParams = STAR_KO): boolean {
  return age >= params.total;
}
