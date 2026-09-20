import { test, expect } from '@playwright/test';

test('keeps headroom when 24 coherent voices would overload the old gain-only mix', async ({ page }) => {
  await page.goto('/index.html');
  const peaks = await page.evaluate(async () => {
    const path = '/src/audio-mix.ts', { createSoundMix } = await import(path);
    const render = async (protectedMix: boolean) => {
      const context = new OfflineAudioContext(2, 24000, 48000);
      const input = protectedMix ? createSoundMix(context).input : context.createGain();
      if (!protectedMix) { input.gain.value = 0.35; input.connect(context.destination); }
      const buffer = context.createBuffer(1, 24000, 48000), samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = 0.8 * Math.sin(i * 2 * Math.PI * 440 / 48000);
      for (let i = 0; i < 24; i++) { const source = context.createBufferSource(); source.buffer = buffer; source.connect(input); source.start(); }
      const result = (await context.startRendering()).getChannelData(0);
      let peak = 0; for (const value of result) peak = Math.max(peak, Math.abs(value)); return peak;
    };
    return { old: await render(false), protected: await render(true) };
  });
  console.log('Offline 24-voice stress peaks:', peaks);
  expect(peaks.old).toBeGreaterThan(6); expect(peaks.protected).toBeLessThan(1); expect(peaks.protected).toBeGreaterThan(0.1);
});

test('bounds active voices and release tails, honors pan, and cleans up scoped loops', async ({ page }) => {
  await page.goto('/index.html'); await page.mouse.click(1, 1);
  const result = await page.evaluate(async () => {
    const path = '/src/play-audio.ts', { PlayAudio } = await import(path), audio = new PlayAudio();
    const pcm = { rate: 16000, channels: [Int16Array.from({length:16000}, (_,i) => Math.round(Math.sin(i*0.2)*16000))], loop: true, loopStart: 0 };
    audio.configure({ cues: () => [{ sample: 1, gain: 0.8, pitch: 1, delay: 0 }], sample: () => pcm });
    await audio.unlock();
    const match = { fighters: [{ special: { serial: 1 } }], phase: 'playing' };
    for (let i = 0; i < 40; i++) audio.event({ type: 'sound', sound: 1, player: 0, x: 0, y: 0, volume: 127, pan: 0, scope: 1 }, match);
    const active = audio.voices.size, releasing = audio.releasing.size, pan = [...audio.voices][0]?.pan.pan.value;
    audio.sync({ ...match, phase: 'ended' }); await new Promise(r => setTimeout(r, 80));
    const remaining = audio.voices.size + audio.releasing.size;
    const error = audio.stats.lastError; audio.dispose(); return { active, releasing, pan, remaining, error };
  });
  expect(result).toEqual({ active: 24, releasing: expect.any(Number), pan: -1, remaining: 0, error: '' });
  expect(result.releasing).toBeLessThanOrEqual(8);
});
