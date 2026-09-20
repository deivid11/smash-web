import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuAudio, MENU_SOUND_IDS } from '../../web/src/menu-audio.ts';
import type { HsdAssetSession } from '../../lib/hsd/session.ts';
import type { PcmSound, SoundCue } from '../../lib/game/audio.ts';

class Node {
  connect = vi.fn(); disconnect = vi.fn();
  gain = { value: 1, setTargetAtTime: vi.fn() };
}
class Source extends Node {
  buffer?: { duration: number }; loop = false; loopStart = 0; loopEnd = 0;
  playbackRate = { value: 1 }; start = vi.fn(); stop = vi.fn(); onended?: () => void;
}
class Context {
  static instances: Context[] = [];
  state = 'suspended'; currentTime = 0; destination = new Node(); sources: Source[] = []; gains: Node[] = [];
  constructor() { Context.instances.push(this); }
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createGain() { const gain = new Node(); this.gains.push(gain); return gain; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  createBuffer(channels: number, samples: number, rate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(samples));
    return { duration: samples / rate, getChannelData: (channel: number) => data[channel] };
  }
}
function fixture() {
  vi.stubGlobal('AudioContext', Context);
  const bytes = vi.fn(), errors = vi.fn(), audio = new MenuAudio({ bytes } as unknown as HsdAssetSession, errors);
  const pcm = (): PcmSound => ({ rate: 32000, channels: [new Int16Array([1000, -1000, 500, 0])], loop: true, loopStart: 2 });
  const internals = audio as unknown as { tracks: Map<string, { pcm: PcmSound }>; sounds: Map<number, { pcm: PcmSound }>; cues: Map<string, SoundCue[]> };
  for (const id of ['menu', 'battlefield', 'final']) internals.tracks.set(id, { pcm: pcm() });
  internals.sounds.set(1, { pcm: pcm() });
  for (const id of Object.keys(MENU_SOUND_IDS)) internals.cues.set(id, [{ sample: 1, gain: 1, delay: 0, pitch: 1 }]);
  return { audio, bytes, errors };
}
afterEach(() => { vi.unstubAllGlobals(); Context.instances = []; });
describe('MenuAudio gesture lifecycle and controls', () => {
  it('uses original IDs, distinguishing narrator from silent CSS placeholders', () => {
    expect(MENU_SOUND_IDS).toEqual({ select: 174, confirm: 173, back: 172, fox: 510005, mario: 510021, kirby: 0x7c83f, samus: 0x7c84e, pikachu: 0x7c84d, roy: 0x7c83c, link: 0x7c842, falcon: 0x7c830, donkey: 0x7c831, mewtwo: 0x7c848, younglink: 0x7c843, jigglypuff: 0x7c83d, ness: 0x7c84a, bowser: 0x7c840, peach: 0x7c84b, falco: 0x7c834, drmario: 0x7c832, ganon: 0x7c836, pichu: 0x7c84c, marth: 0x7c846, luigi: 0x7c844, iceclimbers: 0x7c83b, zelda: 0x7c851, sheik: 0x7c850, gamewatch: 0x7c83a, yoshi: 0x7c84f });
  });
  it('does not create context until unlock, then uses exact sample loop times without network', async () => {
    const { audio, bytes } = fixture();
    await audio.setMusic('menu'); audio.play('select'); expect(Context.instances).toHaveLength(0);
    await audio.unlock(); const context = Context.instances[0]!;
    expect(context.sources).toHaveLength(1); expect(context.sources[0]!.loopStart).toBe(2 / 32000);
    expect(context.sources[0]!.loopEnd).toBe(4 / 32000);
    await audio.setMusic('menu'); expect(context.sources).toHaveLength(1);
    await audio.setMusic('final'); expect(context.sources[0]!.stop).toHaveBeenCalled();
    expect(bytes).not.toHaveBeenCalled(); audio.dispose();
  });
  it('applies independent mute and clamped volumes and bounds SFX voices', async () => {
    const { audio } = fixture(); audio.musicMuted = true; audio.musicVolume = 2; audio.sfxVolume = -1;
    await audio.unlock(); const context = Context.instances[0]!;
    expect(context.gains[0]!.gain.value).toBe(0); expect(context.gains[1]!.gain.value).toBe(0);
    audio.musicMuted = false; audio.sfxVolume = 0.6;
    expect(context.gains[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.01);
    expect(context.gains[1]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.6, 0, 0.01);
    // General volume scales both buses on top of their own levels.
    audio.masterVolume = 0.5;
    expect(context.gains[0]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 0, 0.01);
    expect(context.gains[1]!.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.3, 0, 0.01);
    audio.masterVolume = 1;
    audio.sfxMuted = true; audio.play('fox'); expect(context.sources).toHaveLength(0);
    audio.sfxMuted = false;
    for (let i = 0; i < 20; i++) audio.play('select');
    expect(context.sources.filter(source => source.stop.mock.calls.length === 0)).toHaveLength(8);
    audio.dispose(); expect(context.sources.every(source => source.stop.mock.calls.length > 0)).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1); audio.dispose(); await audio.unlock(); audio.play('fox');
    expect(context.close).toHaveBeenCalledTimes(1); expect(Context.instances).toHaveLength(1);
  });
  it('reports asset failures instead of generating substitute audio', async () => {
    const { audio, bytes, errors } = fixture(); bytes.mockRejectedValue(new Error('Asset unavailable'));
    await expect(audio.prepare()).rejects.toThrow('Asset unavailable');
    expect(errors).toHaveBeenCalledWith('Asset unavailable'); expect(Context.instances).toHaveLength(0); audio.dispose();
  });
  it('discards pending preparation on dispose and never resurrects playback', async () => {
    let reject!: (error: Error) => void;
    const { audio, bytes, errors } = fixture(); bytes.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const pending = audio.prepare(); audio.dispose(); reject(new Error('Cancelled transport'));
    await expect(pending).rejects.toThrow(); expect(errors).not.toHaveBeenCalled();
    expect(audio.stats.prepared).toEqual([]); expect(Context.instances).toHaveLength(0);
  });
});
