import type { GameSoundLibrary } from '../../lib/game/audio.ts';
import type { LocalMatch, MatchEvent } from '../../lib/game/match.ts';
import type { StageId } from '../../lib/game/stages.ts';
import { AX_SFX_CHANNEL, auxBSend, auxMix } from '../../lib/game/ax-aux.ts';
import { createAuxBuses, createSoundMix } from './audio-mix.ts';

interface Voice { source: AudioBufferSourceNode; gain: GainNode; owner: number; scope?: number; loop: boolean; pan: StereoPannerNode; sends: GainNode[] }
/** Direct-sample fallback trim. SEM-scripted voices carry authored cue gains
 * (typically 0.4-0.8 on voice samples peaking ~0.7); unspec'd extension-disc
 * samples peak at 1.0, so without this stage they hit the mixer ~2x hotter
 * than any vanilla voice and clip the mono compensation. Measured against
 * the ISO banks; vanilla cue paths never pass through here. */
export const DIRECT_SAMPLE_TRIM = 0.5;
/** Gain-node level for one direct SSM sample: trim, caller volume, then the
 * shared mono compensation (StereoPanner equal-power center loudness). */
export function directSampleLevel(channels: number, volume = 127): number {
  return DIRECT_SAMPLE_TRIM * Math.min(1, Math.max(0, volume / 127)) * (channels === 1 ? Math.SQRT2 : 1);
}
/** Original SSM samples with a bounded browser mixer, not a full AX hardware port. */
export class PlayAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  /** General volume after the limiter, so the headroom protection behaves the same at any level. */
  private output: GainNode | undefined;
  private volume = 1;
  /** Original aux-A reverb / aux-B delay inputs; absent if the browser cannot build them. */
  private aux: { reverb: GainNode; delay: GainNode } | undefined;
  /** Stage of the match whose events are playing: picks the aux-B (echo) send. */
  private stage: StageId | undefined;
  private library: GameSoundLibrary | undefined;
  private buffers = new Map<number, AudioBuffer>();
  private voices = new Set<Voice>();
  private releasing = new Set<Voice>();
  enabled = true;
  readonly stats = { played: 0, unavailable: 0, lastError: '', recentIds: [] as number[] };
  configure(library: GameSoundLibrary): void { this.library = library; }
  get masterVolume(): number { return this.volume; }
  set masterVolume(value: number) {
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    if (this.context && this.output) this.output.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.01);
  }
  async unlock(): Promise<void> {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.output = this.context.createGain(); this.output.gain.value = this.volume; this.output.connect(this.context.destination);
        this.master = createSoundMix(this.context, this.output).input;
        try { this.aux = createAuxBuses(this.context, this.master); } catch (error) { this.stats.lastError = String(error); }
      }
      await this.context.resume();
    } catch (error) { this.stats.lastError = String(error); }
  }
  /** AXDriver voice mix: dry to the main mix, aux A (the cue's SEM reverb send) and aux B
   * (the channel's stage echo send, x27 = 0xFF) to the original effect buses. */
  private route(panner: StereoPannerNode, auxA: number, channel: number): GainNode[] {
    if (!this.aux) { panner.connect(this.master!); return []; }
    const mix = auxMix(auxA, auxBSend(channel, this.stage) * 255 / 65535), sends: GainNode[] = [];
    for (const [level, target] of [[mix.main, this.master!], [mix.auxA, this.aux.reverb], [mix.auxB, this.aux.delay]] as const) {
      if (level <= 0) continue;
      const send = this.context!.createGain(); send.gain.value = level;
      panner.connect(send); send.connect(target); sends.push(send);
    }
    return sends;
  }
  private playSample(id: number, pcm: import('../../lib/game/audio.ts').PcmSound, owner: number, volume = 127, pan = 64, channel = AX_SFX_CHANNEL): void {
    try {
      let buffer = this.buffers.get(id);
      if (!buffer) {
        buffer = this.context!.createBuffer(pcm.channels.length, pcm.channels[0]!.length, pcm.rate);
        pcm.channels.forEach((samples, channel) => { const target = buffer!.getChannelData(channel); for (let i = 0; i < samples.length; i++) target[i] = samples[i]! / 32768; });
        if (this.buffers.size >= 96) this.buffers.delete(this.buffers.keys().next().value!);
        this.buffers.set(id, buffer);
      }
      while (this.voices.size >= 24) this.stop(this.voices.values().next().value!);
      const source = this.context!.createBufferSource(), gain = this.context!.createGain(), panner = this.context!.createStereoPanner();
      const start = this.context!.currentTime;
      source.buffer = buffer; source.playbackRate.value = 1; source.loop = false;
      const level = directSampleLevel(pcm.channels.length, volume);
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(level, start + 0.001);
      const end = start + buffer.duration;
      gain.gain.setValueAtTime(level, Math.max(start + 0.001, end - 0.003));
      gain.gain.linearRampToValueAtTime(0, Math.max(start + 0.001, end));
      panner.pan.value = Math.max(-1, Math.min(1, (pan - 64) / 64));
      source.connect(gain); gain.connect(panner);
      const voice: Voice = { source, gain, owner, scope: undefined, loop: false, pan: panner, sends: this.route(panner, 0, channel) }; this.voices.add(voice);
      source.onended = () => this.clean(voice);
      source.start(start);
      this.stats.played++; this.stats.recentIds.push(id); if (this.stats.recentIds.length > 16) this.stats.recentIds.shift();
    } catch (error) { this.stats.lastError = String(error); this.stats.unavailable++; }
  }
  private play(id: number, owner: number, volume = 127, scope?: number, pan = 64, channel = AX_SFX_CHANNEL): void {
    if (!this.enabled || !this.context || this.context.state !== 'running' || !this.library || !this.master) return;
    const cues = this.library.cues(id);
    // ACE extension voices use direct SSM sample ids (their SEM banks carry no
    // scripts in the 2.0 ISO); fall back to the raw sample, trimmed to vanilla
    // voice staging (see DIRECT_SAMPLE_TRIM), so mapped voice lines stay
    // audible without clipping the mix.
    if (!cues.length) {
      const direct = this.library.sample(id);
      if (direct?.channels[0]?.length) {
        this.playSample(id, direct, owner, volume, pan, channel);
        return;
      }
      if (id !== 540000) this.stats.unavailable++; return;
    }
    try {
      for (const cue of cues) {
        const pcm = this.library.sample(cue.sample); if (!pcm || !pcm.channels[0]?.length) continue;
        let buffer = this.buffers.get(cue.sample);
        if (!buffer) {
          buffer = this.context.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.rate);
          pcm.channels.forEach((samples, channel) => { const target = buffer!.getChannelData(channel); for (let i = 0; i < samples.length; i++) target[i] = samples[i]! / 32768; });
          if (this.buffers.size >= 96) this.buffers.delete(this.buffers.keys().next().value!);
          this.buffers.set(cue.sample, buffer);
        }
        while (this.voices.size >= 24) this.stop(this.voices.values().next().value!);
        const source = this.context.createBufferSource(), gain = this.context.createGain(), panner = this.context.createStereoPanner();
        const start = this.context.currentTime + Math.min(3, cue.delay);
        source.buffer = buffer; source.playbackRate.value = Math.max(0.125, Math.min(8, cue.pitch));
        source.loop = pcm.loop && scope !== undefined; source.loopStart = pcm.loopStart / pcm.rate; source.loopEnd = buffer.duration;
        // StereoPanner uses equal-power mono gains. Preserve the previous
        // center loudness instead of silently making mono SFX 3 dB quieter.
        const level = Math.min(1, Math.max(0, cue.gain * volume / 127)) * (pcm.channels.length === 1 ? Math.SQRT2 : 1);
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(level, start + 0.001);
        if (!source.loop) {
          const end = start + buffer.duration / source.playbackRate.value;
          gain.gain.setValueAtTime(level, Math.max(start + 0.001, end - 0.003));
          gain.gain.linearRampToValueAtTime(0, Math.max(start + 0.001, end));
        }
        panner.pan.value = Math.max(-1, Math.min(1, (pan - 64) / 64));
        source.connect(gain); gain.connect(panner);
        const voice: Voice = { source, gain, owner, scope, loop: source.loop, pan: panner, sends: this.route(panner, cue.auxA ?? 0, channel) }; this.voices.add(voice);
        source.onended = () => this.clean(voice);
        source.start(start);
        this.stats.played++;
      }
      this.stats.recentIds.push(id); if (this.stats.recentIds.length > 16) this.stats.recentIds.shift();
    } catch (error) { this.stats.lastError = String(error); this.stats.unavailable++; }
  }
  event(event: MatchEvent, match: LocalMatch): void {
    const fighter = match.fighters[event.player];
    this.stage = match.content?.stageId;
    if (event.type === 'sound' && event.sound !== undefined) {
      if (event.channel === undefined) this.play(event.sound, event.player, event.volume ?? 127, event.scope, event.pan ?? 64);
      else this.playOnChannel(event.channel, event.sound, event.player, event.volume ?? 127, event.pan ?? 64);
    }
    else if (fighter && event.type === 'jump') this.play(event.sound ?? (fighter.jumpsUsed >= 2 ? fighter.content.specials.sounds.airJump : fighter.content.specials.sounds.jump), event.player);
    else if (fighter && event.type === 'ko') this.play(fighter.content.specials.sounds.ko, event.player);
    else if (event.type === 'bounce') this.play(180025, event.player); // original Mario fireball bounce callback
  }
  /** Voices started on an original single-voice AX channel (crowd chant 5, reaction 6). */
  private channels = new WeakMap<Voice, number>();
  /** lbAudioAx_800240B4/8002411C: a new sound on the channel cuts the previous one, and the
   * "no sound" id (540000) only silences it. */
  private playOnChannel(channel: number, id: number, owner: number, volume: number, pan: number): void {
    if (this.context) for (const voice of [...this.voices]) if (this.channels.get(voice) === channel) this.stop(voice);
    const before = new Set(this.voices);
    this.play(id, owner, volume, undefined, pan, channel);
    for (const voice of this.voices) if (!before.has(voice)) this.channels.set(voice, channel);
  }
  /** Online callers supply confirmed post-frame metadata, never speculative match state. */
  syncScopes(scopes: readonly (number | null)[], ended: boolean): void {
    for (const voice of this.voices) if (voice.loop && (ended || scopes[voice.owner] !== voice.scope)) this.stop(voice);
  }
  /** Local play can synchronize directly against its current, non-predicted match. */
  sync(match: LocalMatch): void {
    this.syncScopes(match.fighters.map(fighter => fighter.special?.serial ?? null), match.phase === 'ended');
  }
  pause(): void { if (this.context?.state === 'running') void this.context.suspend().catch(() => {}); }
  private clean(voice: Voice): void {
    this.voices.delete(voice); this.releasing.delete(voice);
    voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect(); for (const send of voice.sends) send.disconnect();
  }
  private stop(voice: Voice): void {
    this.voices.delete(voice);
    // Do not cut a loop/voice at an arbitrary non-zero PCM sample. Keep the
    // release tails bounded separately, so stealing voices cannot leak nodes.
    while (this.releasing.size >= 8) {
      const oldest = this.releasing.values().next().value!;
      try { oldest.source.stop(); } catch {} this.clean(oldest);
    }
    const now = this.context!.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now); voice.gain.gain.linearRampToValueAtTime(0, now + 0.005);
    try { voice.source.stop(now + 0.005); } catch {}
    this.releasing.add(voice);
  }
  stopAll(): void { for (const voice of this.voices) this.stop(voice); }
  dispose(): void {
    this.stopAll(); for (const voice of [...this.releasing]) this.clean(voice);
    this.buffers.clear(); void this.context?.close().catch(() => {});
  }
}
