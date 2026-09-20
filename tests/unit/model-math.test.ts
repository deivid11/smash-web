import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gxCullSide, jointMatrix } from '../../web/src/render/model-instance.ts';

describe('HSD renderer coordinate conventions', () => {
  it('maps clockwise GX front faces to Three.js without losing exterior surfaces', () => {
    expect(gxCullSide(0x8000)).toBe(THREE.BackSide);
    expect(gxCullSide(0x4000)).toBe(THREE.FrontSide);
    expect(gxCullSide(0)).toBe(THREE.DoubleSide);
  });
  it('preserves translation and standard XYZ-axis rotation application order', () => {
    const actual = new THREE.Matrix4();
    jointMatrix(actual, [2, 3, 4], [0.2, 0.4, 0.6], [1, 5, 9], [1, 1, 1]);
    const expected = new THREE.Matrix4().compose(new THREE.Vector3(1, 5, 9), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.4, 0.6, 'ZYX')), new THREE.Vector3(2, 3, 4));
    for (let i = 0; i < 16; i++) expect(actual.elements[i]).toBeCloseTo(expected.elements[i]!, 12);
  });
  it('handles zero scale without introducing NaN during compensation', () => {
    const matrix = new THREE.Matrix4();
    jointMatrix(matrix, [0, 0, 0], [0.1, 0.2, 0.3], [0, 0, 0], [0, 0, 0]);
    expect(matrix.elements.every(Number.isFinite)).toBe(true);
  });
});
