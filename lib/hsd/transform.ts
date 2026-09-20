import { Matrix4 } from 'three';
import type { V3 } from './model.ts';

/** HSD Euler transform, including its Maya scale compensation convention. */
export function jointMatrix(out: Matrix4, scale: V3, rotation: V3, translation: V3, parentScale: V3): void {
  const [sx, sy, sz] = scale, [rx, ry, rz] = rotation;
  const x = Math.sin(rx), X = Math.cos(rx), y = Math.sin(ry), Y = Math.cos(ry), z = Math.sin(rz), Z = Math.cos(rz);
  out.set(
    sx * Y * Z, sy * (x * Z * y - X * z), sz * (X * Z * y + x * z), translation[0],
    sx * z * Y, sy * (x * z * y + X * Z), sz * (X * z * y - x * Z), translation[1],
    sx * -y, sy * x * Y, sz * Y * X, translation[2],
    0, 0, 0, 1,
  );
  const m = out.elements;
  const ratio = (a: number, b: number) => Math.abs(b) < 1e-12 ? 1 : a / b;
  m[1] *= ratio(parentScale[0], parentScale[1]); m[2] *= ratio(parentScale[0], parentScale[2]);
  m[4] *= ratio(parentScale[1], parentScale[0]); m[6] *= ratio(parentScale[1], parentScale[2]);
  m[8] *= ratio(parentScale[2], parentScale[0]); m[9] *= ratio(parentScale[2], parentScale[1]);
}
