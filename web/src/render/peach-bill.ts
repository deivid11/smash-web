import type { PeachBillRuntime } from '../../../lib/game/peach-bill.ts';
import type { ModelInstance } from './model-instance.ts';

/** Peach Bill presentation from authoritative match state (grcastle.c castle2).
 * Bills rest parked hidden (map roots 18/19/20); the live missile shows one root
 * positioned by object offset with a prototype menacing scale. Presentation only:
 * collision/hits never read these overrides. See lib/game/peach-bill.ts. */
export const PEACH_BILL_ROOTS = [18, 19, 20] as const;
export const PEACH_BILL_SCALE = 4;

export function parkPeachBills(stage: ModelInstance): void {
  for (const root of PEACH_BILL_ROOTS) stage.setObjectState(root, { visible: false });
}

export function applyPeachBillRuntime(stage: ModelInstance, rt: PeachBillRuntime | null, scale: number): void {
  if (!rt || rt.state !== 1) {
    for (const root of PEACH_BILL_ROOTS) stage.setObjectState(root, { visible: false });
    return;
  }
  const live = PEACH_BILL_ROOTS[rt.slot] ?? PEACH_BILL_ROOTS[0]!;
  for (const root of PEACH_BILL_ROOTS) {
    if (root === live) {
      stage.setObjectState(root, {
        offset: [rt.x / scale, rt.y / scale, 0],
        rotationY: rt.vx < 0 ? Math.PI : 0,
        scale: PEACH_BILL_SCALE,
        visible: true,
      });
    } else {
      stage.setObjectState(root, { visible: false });
    }
  }
}
