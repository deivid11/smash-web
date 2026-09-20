import { describe, expect, it } from 'vitest';
import { starKoPose, starKoDone, STAR_KO } from '../../web/src/render/star-ko.ts';
import { isTopBlastKO } from '../../lib/game/ko-effect.ts';

const blast = { left: -200, right: 200, bottom: -120, top: 180 };

describe('Star KO classification', () => {
  it('is a star only when the fighter exits the top within the side bounds', () => {
    expect(isTopBlastKO(0, 181, blast)).toBe(true);          // straight up
    expect(isTopBlastKO(-199, 190, blast)).toBe(true);        // up, still inside sides
    expect(isTopBlastKO(0, 179, blast)).toBe(false);          // not past the top line
    expect(isTopBlastKO(201, 190, blast)).toBe(false);        // corner: side KO wins
    expect(isTopBlastKO(0, -130, blast)).toBe(false);         // bottom KO
    expect(isTopBlastKO(NaN, 190, blast)).toBe(false);        // guards NaN
  });
});

describe('Star KO fly-up trajectory', () => {
  it('starts exactly on the KO position and unrotated', () => {
    const pose = starKoPose(0, 180, 1);
    expect(pose.y).toBeCloseTo(180, 6);
    expect(pose.z).toBeCloseTo(0, 6);
    expect(pose.scale).toBeCloseTo(1, 6);
    expect(pose.roll).toBe(0);
  });

  it('rises, recedes and shrinks to the distant point by the end', () => {
    const end = starKoPose(STAR_KO.total, 180, 1);
    expect(end.y).toBeCloseTo(180 + STAR_KO.rise, 5);
    expect(end.z).toBeCloseTo(-STAR_KO.recede, 5);
    expect(end.scale).toBeCloseTo(STAR_KO.endScale, 5);
    expect(end.roll).toBeGreaterThan(Math.PI * 4); // multiple visible spins
  });

  it('moves monotonically up, back and smaller across the flight', () => {
    let prev = starKoPose(0, 0, 1);
    for (let age = 4; age <= STAR_KO.total; age += 4) {
      const pose = starKoPose(age, 0, 1);
      expect(pose.y).toBeGreaterThan(prev.y);
      expect(pose.z).toBeLessThan(prev.z);
      expect(pose.scale).toBeLessThan(prev.scale);
      expect(pose.roll).toBeGreaterThan(prev.roll);
      prev = pose;
    }
    expect(starKoDone(STAR_KO.total)).toBe(true);
    expect(starKoDone(STAR_KO.total - 1)).toBe(false);
  });

  it('scales the fly-up from the fighter own base scale', () => {
    expect(starKoPose(0, 0, 0.7).scale).toBeCloseTo(0.7, 6);
    expect(starKoPose(STAR_KO.total, 0, 0.7).scale).toBeCloseTo(0.7 * STAR_KO.endScale, 6);
  });
});
