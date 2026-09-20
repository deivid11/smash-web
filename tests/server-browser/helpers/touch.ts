import type { Page } from '@playwright/test';
const STICK_POINTER = 91, TRAVEL = 60;
/** Holds the floating touch stick toward (x, y) in unit-circle terms (y up) with a synthetic touch pointer. */
export async function holdStick(page: Page, x: number, y: number): Promise<void> {
  const zone = page.locator('#touch-stick'), box = (await zone.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await zone.dispatchEvent('pointerdown', { pointerId: STICK_POINTER, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: cy, bubbles: true });
  await zone.dispatchEvent('pointermove', { pointerId: STICK_POINTER, pointerType: 'touch', isPrimary: true, clientX: cx + x * TRAVEL, clientY: cy - y * TRAVEL, bubbles: true });
}
export async function releaseStick(page: Page): Promise<void> {
  const zone = page.locator('#touch-stick'), box = (await zone.boundingBox())!;
  await zone.dispatchEvent('pointerup', { pointerId: STICK_POINTER, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true });
}
