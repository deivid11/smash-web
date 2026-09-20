import { test, expect } from '@playwright/test';

test('rumble mapping pulses pads and phone vibration without touching simulation', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const path = '/src/play-rumble.ts', { PlayRumble } = await import(path);
    const played: Array<{ type: string; params: Record<string, number> }> = [];
    const vibrated: Array<number | number[]> = [];
    const rumble = new PlayRumble({
      pads: () => [
        { vibrationActuator: { playEffect: (type: string, params: Record<string, number>) => { played.push({ type, params }); return Promise.resolve(true); } } },
      ],
      vibrate: (pattern: number | number[]) => { vibrated.push(pattern); return true; },
    });
    rumble.events([
      { type: 'hit', player: 0, x: 0, y: 0, damage: 18, knockback: 110 },
      { type: 'hit', player: 1, x: 5, y: 0, damage: 4 },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const coalesced = played.length;
    rumble.events([{ type: 'shield-break', player: 0, x: 0, y: 0 }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      coalesced,
      total: played.length,
      breakDuration: played[1]?.params.duration ?? 0,
      vibrated: vibrated.length,
      defaultLevel: rumble.getLevel(),
    };
  });
  // Same-frame double hit coalesces to one pad pulse + one phone buzz.
  expect(result.coalesced).toBe(1);
  expect(result.total).toBe(2);
  expect(result.breakDuration).toBe(500);
  expect(result.vibrated).toBe(2);
  expect(result.defaultLevel).toBe('full');
});

test('rumble off gate silences pads and phone', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const path = '/src/play-rumble.ts', { PlayRumble } = await import(path);
    const nonzero: unknown[] = [];
    const rumble = new PlayRumble({
      pads: () => [{ vibrationActuator: { playEffect: (_type: string, params: Record<string, number>) => { if ((params.strongMagnitude ?? 0) > 0 || (params.weakMagnitude ?? 0) > 0) nonzero.push(params); return Promise.resolve(true); } } }],
      vibrate: () => true,
    });
    rumble.setLevel('off');
    rumble.events([{ type: 'hit', player: 0, x: 0, y: 0, damage: 20, knockback: 120 }]);
    rumble.pulse({ strong: 1, weak: 1, durationMs: 200 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // setLevel('off') emits one zero-magnitude motor cancel; nothing may buzz.
    return { nonzero: nonzero.length, level: rumble.getLevel() };
  });
  expect(result).toEqual({ nonzero: 0, level: 'off' });
});
