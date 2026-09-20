import { describe, expect, it } from 'vitest';
import { stackLabels } from '../../web/src/play/label-layout.ts';

describe('crowded head-label stacking', () => {
  it('keeps separated labels in place', () => {
    expect(stackLabels([{ x: 100, y: 200, visible: true }, { x: 300, y: 200, visible: true }], 64, 48)).toEqual([0, 0]);
  });
  it('lifts overlapping labels into rows and keeps the local player unmoved', () => {
    const lifts = stackLabels([
      { x: 100, y: 200, visible: true },
      { x: 110, y: 205, visible: true, priority: true },
      { x: 120, y: 198, visible: true },
    ], 64, 48);
    expect(lifts[1]).toBe(0);
    expect(new Set(lifts)).toEqual(new Set([0, 48, 96]));
  });
  it('caps the stack height and ignores hidden labels', () => {
    const crowd = Array.from({ length: 6 }, (_, index) => ({ x: 200 + index, y: 200, visible: true }));
    expect(Math.max(...stackLabels(crowd, 64, 48, 3))).toBe(96);
    expect(stackLabels([{ x: 100, y: 200, visible: false }, { x: 100, y: 200, visible: true }], 64, 48)).toEqual([0, 0]);
  });
});
