import { test, expect } from '@playwright/test';

test('renders the original aux-B stereo echo and the ReverbStd tail at the context rate', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(async () => {
    const path = '/src/audio-mix.ts', { createAuxBuses } = await import(path);
    const render = async (bus: 'delay' | 'reverb') => {
      const context = new OfflineAudioContext(2, 48000, 48000), aux = createAuxBuses(context, context.destination);
      const impulse = context.createBuffer(2, 1, 48000); impulse.getChannelData(0)[0] = 1; impulse.getChannelData(1)[0] = 1;
      const source = context.createBufferSource(); source.buffer = impulse; source.connect(aux[bus]); source.start();
      const out = await context.startRendering();
      return [Array.from(out.getChannelData(0)), Array.from(out.getChannelData(1))];
    };
    const [left, right] = await render('delay'), [tail] = await render('reverb');
    const peaks = (samples: number[]) => samples.map((v, i) => [i, v] as const).filter(([, v]) => Math.abs(v) > 1e-4).map(([i, v]) => [i, Math.round(v * 1e6) / 1e6]);
    const energy = (from: number, to: number) => tail!.slice(from, to).reduce((sum, v) => sum + v * v, 0);
    return { left: peaks(left!).slice(0, 3), right: peaks(right!).slice(0, 2), firstReverb: tail!.findIndex((v) => Math.abs(v) > 1e-4), early: energy(9600, 14400), late: energy(40000, 44800) };
  });
  // 5 ms aux-return frame + 255/305 ms rings at 48 kHz; output 44/128, feedback 30/128.
  const out = Math.round(44 / 128 * 1e6) / 1e6, second = Math.round(44 / 128 * 30 / 128 * 1e6) / 1e6;
  expect(result.left).toEqual([[12480, out], [24720, second], [36960, expect.any(Number)]]);
  expect(result.right).toEqual([[14880, out], [29520, second]]);
  // (160 + 63 + 1789) samples at 32 kHz = 62.9 ms, allowing the 16-tap resampler's pre-ring.
  expect(Math.abs(result.firstReverb - 3018)).toBeLessThanOrEqual(24);
  expect(10 * Math.log10(result.early / result.late)).toBeGreaterThan(15);
});

test('routes match voices through dry, reverb and stage echo sends', async ({ page }) => {
  await page.goto('/index.html'); await page.mouse.click(1, 1);
  const result = await page.evaluate(async () => {
    const path = '/src/play-audio.ts', { PlayAudio } = await import(path), audio = new PlayAudio();
    const pcm = { rate: 32000, channels: [Int16Array.from({ length: 3200 }, (_, i) => Math.round(Math.sin(i * 0.2) * 16000))], loop: false, loopStart: 0 };
    audio.configure({ cues: () => [{ sample: 1, gain: 0.8, pitch: 1, delay: 0, auxA: 0.1 }], sample: () => pcm });
    await audio.unlock();
    const gains = (stageId: string, channel?: number) => {
      audio.event({ type: 'sound', sound: 1, player: 0, x: 0, y: 0, channel }, { fighters: [{}], phase: 'playing', content: { stageId } });
      return [...audio.voices].at(-1).sends.map((send: GainNode) => Math.round(send.gain.value * 1e4) / 1e4);
    };
    const levels = { final: gains('final'), corneria: gains('corneria'), crowd: gains('corneria', 6) };
    const error = audio.stats.lastError; audio.dispose(); return { ...levels, error };
  });
  const expected = (send: number) => { const b = 255 * send / 65535; return [0.9 * Math.sqrt(1 - b), Math.sqrt(0.1), Math.sqrt(b) * Math.sqrt(0.9)].map((v) => Math.round(v * 1e4) / 1e4); };
  expect(result).toEqual({ final: expected(0x38), corneria: expected(0x01), crowd: expected(0x20), error: '' });
});
