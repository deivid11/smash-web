import type { HsdAssetSession } from '../../lib/hsd/session.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import { GameSoundLibrary, SemTable, SsmBank, type PcmSound, type SoundCue } from '../../lib/game/audio.ts';
import { decodeHps, MUSIC_TRACKS, type MusicId } from '../../lib/game/music.ts';

export type MenuSound = 'select' | 'confirm' | 'back' | 'fox' | 'mario' | 'kirby' | 'samus' | 'pikachu' | 'roy' | 'link' | 'falcon' | 'donkey' | 'mewtwo' | 'younglink' | 'jigglypuff' | 'ness' | 'bowser' | 'peach' | 'falco' | 'drmario' | 'ganon' | 'pichu' | 'marth' | 'luigi' | 'iceclimbers' | 'zelda' | 'sheik' | 'gamewatch' | 'yoshi';
/** `gm_80168C5C` announcer table keyed by CKIND (`mncharsel.c` passes `char_kind`):
 * Falcon 0/DK 1/Fox 2/G&W 3/Kirby 4/Bowser 5/Link 6/Luigi 7/Mario 8/Marth 9/
 * Mewtwo 10/Ness 11/Peach 12/Pikachu 13/ICs 14/Puff 15/Samus 16/Yoshi 17/
 * Zelda 18/Sheik 19/Falco 20/YLink 21/DrMario 22/Roy 23/Pichu 24/Ganon 25.
 * NOTE: Kirby is `0x7C83F` — `0x7C83A` is Game & Watch's call (CKIND 3), not Kirby's.
 * Durations corroborate: 83A is a 20899-sample long call, 83F a 7846-sample short one like Fox. */
export const MENU_SOUND_IDS: Readonly<Record<MenuSound, number>> = {
  select: 0xae, confirm: 0xad, back: 0xac, fox: 0x7c835, mario: 0x7c845, kirby: 0x7c83f, samus: 0x7c84e, pikachu: 0x7c84d, roy: 0x7c83c, link: 0x7c842, falcon: 0x7c830, donkey: 0x7c831, mewtwo: 0x7c848, younglink: 0x7c843, jigglypuff: 0x7c83d, ness: 0x7c84a, bowser: 0x7c840, peach: 0x7c84b,
  falco: 0x7c834, drmario: 0x7c832, ganon: 0x7c836, pichu: 0x7c84c, marth: 0x7c846,
  luigi: 0x7c844,
  iceclimbers: 0x7c83b,
  zelda: 0x7c851,
  sheik: 0x7c850,
  gamewatch: 0x7c83a,
  yoshi: 0x7c84f,
};
/** Fighters with their own CSS name call: only the original Melee cast is in nr_name.ssm.
 * Everyone else (custom and ACE fighters) is a bonus character and plays the generic confirm. */
export const ANNOUNCER_CUES: Readonly<Partial<Record<FighterKind, MenuSound>>> = {
  Fx: 'fox', Mr: 'mario', Kb: 'kirby', Ss: 'samus', Pk: 'pikachu', Fe: 'roy', Lk: 'link', Ca: 'falcon', Dk: 'donkey', Mt: 'mewtwo', Cl: 'younglink', Pr: 'jigglypuff', Ns: 'ness',
  Kp: 'bowser', Pe: 'peach', Fc: 'falco', Dr: 'drmario', Gn: 'ganon', Pc: 'pichu', Ms: 'marth', Lg: 'luigi', Pp: 'iceclimbers', Zd: 'zelda', Sk: 'sheik', Gw: 'gamewatch', Ys: 'yoshi',
};
export function isBonusFighter(kind: FighterKind): boolean { return ANNOUNCER_CUES[kind] === undefined; }
interface SoundBuffer { pcm?: PcmSound; buffer?: AudioBuffer }

/** Original local HPS/SSM playback, not a complete GameCube AX mixer.
 * Call unlock synchronously from a trusted gesture. prepare() works before a
 * gesture; await it before starting a match to avoid any in-match asset reads.
 * Cancellation discards pending reads (the session transport owns actual I/O).
 */
/** Decoded music kept in memory: the menu track plus the three most recent stage tracks. */
export const MAX_DECODED_TRACKS = 4;

export class MenuAudio {
  private context?: AudioContext;
  private musicGain?: GainNode;
  private sfxGain?: GainNode;
  private tracks = new Map<MusicId, SoundBuffer>();
  private sounds = new Map<number, SoundBuffer>();
  private cues = new Map<MenuSound, SoundCue[]>();
  private voices = new Set<AudioBufferSourceNode>();
  private musicSource?: AudioBufferSourceNode;
  private activeMusic: MusicId | null = null;
  private desiredMusic: MusicId | null = null;
  private preparing?: Promise<void>;
  private abort = new AbortController();
  private disposed = false;
  private revision = 0;
  private levels = { masterVolume: 1, musicVolume: 0.35, sfxVolume: 0.8, musicMuted: false, sfxMuted: false };
  readonly stats = { played: 0, unavailable: 0, lastError: '', music: null as MusicId | null, prepared: [] as MusicId[], sfxReady: false };

  constructor(private readonly session: HsdAssetSession, private readonly onError: (message: string) => void = () => {}) {}
  /** General volume: scales menu music and menu SFX on top of their own levels. */
  get masterVolume(): number { return this.levels.masterVolume; }
  set masterVolume(value: number) { this.levels.masterVolume = this.level(value); this.applyLevels(); }
  get musicVolume(): number { return this.levels.musicVolume; }
  set musicVolume(value: number) { this.levels.musicVolume = this.level(value); this.applyLevels(); }
  get sfxVolume(): number { return this.levels.sfxVolume; }
  set sfxVolume(value: number) { this.levels.sfxVolume = this.level(value); this.applyLevels(); }
  get musicMuted(): boolean { return this.levels.musicMuted; }
  set musicMuted(value: boolean) { this.levels.musicMuted = !!value; this.applyLevels(); }
  get sfxMuted(): boolean { return this.levels.sfxMuted; }
  set sfxMuted(value: boolean) { this.levels.sfxMuted = !!value; this.applyLevels(); }
  private level(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
  private applyLevels(): void {
    const now = this.context?.currentTime ?? 0;
    this.musicGain?.gain.setTargetAtTime(this.musicMuted ? 0 : this.musicVolume * this.masterVolume, now, 0.01);
    this.sfxGain?.gain.setTargetAtTime(this.sfxMuted ? 0 : this.sfxVolume * this.masterVolume, now, 0.01);
  }
  private error(error: unknown): void {
    if (this.disposed) return;
    this.stats.lastError = error instanceof Error ? error.message : String(error);
    this.onError(this.stats.lastError);
  }
  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.musicGain = this.context.createGain(); this.sfxGain = this.context.createGain();
        this.musicGain.connect(this.context.destination); this.sfxGain.connect(this.context.destination);
        // Set immediately too: never leak a full-volume first sample before mute ramps.
        this.musicGain.gain.value = this.musicMuted ? 0 : this.musicVolume * this.masterVolume;
        this.sfxGain.gain.value = this.sfxMuted ? 0 : this.sfxVolume * this.masterVolume;
      }
      await this.context.resume();
      if (!this.disposed) this.startMusic();
    } catch (error) { this.error(error); }
  }
  /** Menu SFX + the requested tracks (default: only the menu track), serialized decode.
   * Stage tracks load on demand ({@link warm} / {@link setMusic}): preparing every
   * stage track at boot meant ~70 MB of downloads and ~280 MB of decoded PCM before
   * the menu appeared, which stalled or crashed phones at the 40% loading step.
   * At most {@link MAX_DECODED_TRACKS} decoded tracks are kept (least recently used out). */
  async prepare(tracks: readonly MusicId[] = ['menu']): Promise<void> {
    if (this.disposed) return;
    if (tracks.some(id => !Object.hasOwn(MUSIC_TRACKS, id))) throw new Error('Unsupported original music track.');
    while (this.preparing) await this.preparing;
    if (this.disposed) return;
    const task = this.prepareAssets(tracks);
    this.preparing = task;
    try { await task; } catch (error) { this.error(error); throw error; }
    finally { if (this.preparing === task) this.preparing = undefined; }
  }
  private async prepareAssets(tracks: readonly MusicId[]): Promise<void> {
    if (!this.stats.sfxReady) {
      const sem = new SemTable(await this.session.bytes('audio/us/smash2.sem'));
      this.abort.signal.throwIfAborted();
      const banks = [];
      for (const asset of ['audio/us/main.ssm', 'audio/us/nr_name.ssm']) {
        banks.push(new SsmBank(await this.session.bytes(asset))); this.abort.signal.throwIfAborted();
      }
      const library = new GameSoundLibrary(sem, banks);
      const sounds = new Map<number, SoundBuffer>(), cueMap = new Map<MenuSound, SoundCue[]>();
      let samples = 0;
      for (const name of Object.keys(MENU_SOUND_IDS) as MenuSound[]) {
        const cues = library.cues(MENU_SOUND_IDS[name]);
        if (!cues.length || !cues.some(cue => cue.gain > 0)) throw new Error(`Original ${name} sound is unavailable.`);
        for (const cue of cues) if (!sounds.has(cue.sample)) {
          const pcm = library.sample(cue.sample);
          if (!pcm) throw new Error('Original menu sample is missing.');
          samples += pcm.channels.reduce((n, channel) => n + channel.length, 0);
          if (samples > 1_000_000) throw new Error('Menu samples exceed the playback budget.');
          sounds.set(cue.sample, { pcm });
        }
        cueMap.set(name, cues);
      }
      this.sounds = sounds; this.cues = cueMap;
      this.stats.sfxReady = true;
    }
    for (const id of new Set(tracks)) if (!this.tracks.has(id)) {
      const bytes = await this.session.bytes(MUSIC_TRACKS[id]);
      this.abort.signal.throwIfAborted();
      const pcm = decodeHps(bytes, this.abort.signal);
      this.tracks.set(id, { pcm }); this.stats.prepared.push(id);
      this.evictTracks(id);
      // Allow controls/disposal to run between bounded synchronous decodes.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.abort.signal.throwIfAborted();
    }
    this.startMusic();
  }
  /** Starts preparing one track in the background (stage picked, floor entered) so
   * {@link setMusic} rarely decodes at match start. Failures report once via onError. */
  warm(id: string): void {
    if (this.disposed || !Object.hasOwn(MUSIC_TRACKS, id) || this.tracks.has(id as MusicId)) return;
    void this.prepare([id as MusicId]).catch(() => { /* prepare already reported it */ });
  }
  /** Drops least recently prepared tracks beyond the cap, never the menu, playing or wanted one. */
  private evictTracks(keep: MusicId): void {
    for (const id of [...this.tracks.keys()]) {
      if (this.tracks.size <= MAX_DECODED_TRACKS) break;
      if (id === keep || id === 'menu' || id === this.activeMusic || id === this.desiredMusic) continue;
      this.tracks.delete(id);
      this.stats.prepared = this.stats.prepared.filter(prepared => prepared !== id);
    }
  }
  private buffer(sound: SoundBuffer): AudioBuffer {
    if (sound.buffer) return sound.buffer;
    const pcm = sound.pcm!;
    const buffer = this.context!.createBuffer(pcm.channels.length, pcm.channels[0]!.length, pcm.rate);
    pcm.channels.forEach((channel, index) => {
      const output = buffer.getChannelData(index);
      for (let i = 0; i < channel.length; i++) output[i] = channel[i]! / 32768;
    });
    sound.buffer = buffer;
    // Keep only tiny loop metadata, not both Int16 PCM and Float32 AudioBuffer.
    sound.pcm = { ...pcm, channels: [] };
    return buffer;
  }
  async setMusic(id: MusicId | null): Promise<void> {
    if (this.disposed) return;
    if (id !== null && !Object.hasOwn(MUSIC_TRACKS, id)) throw new Error('Unsupported original music track.');
    const revision = ++this.revision;
    this.desiredMusic = id;
    if (id !== this.activeMusic) this.stopMusic();
    if (id === null) return;
    try {
      if (!this.tracks.has(id)) await this.prepare([id]);
      if (!this.disposed && revision === this.revision) this.startMusic();
    } catch (error) { /* prepare reports once; audio failure must not prevent play. */ }
  }
  private startMusic(): void {
    const id = this.desiredMusic, sound = id ? this.tracks.get(id) : undefined;
    if (!id || !sound || this.disposed || !this.context || this.context.state !== 'running' || this.activeMusic === id) return;
    this.stopMusic();
    const buffer = this.buffer(sound), source = this.context.createBufferSource();
    source.buffer = buffer; source.loop = sound.pcm!.loop;
    source.loopStart = sound.pcm!.loopStart / sound.pcm!.rate; source.loopEnd = buffer.duration;
    source.connect(this.musicGain!); source.start();
    this.musicSource = source; this.activeMusic = id; this.stats.music = id;
  }
  play(name: MenuSound): void {
    if (this.disposed || this.sfxMuted || !this.context || this.context.state !== 'running') return;
    const cues = this.cues.get(name);
    if (!cues) { this.stats.unavailable++; return; }
    try {
      for (const cue of cues) {
        while (this.voices.size >= 8) this.stopVoice(this.voices.values().next().value!);
        const sound = this.sounds.get(cue.sample)!;
        const source = this.context.createBufferSource(), gain = this.context.createGain();
        source.buffer = this.buffer(sound); source.playbackRate.value = Math.max(0.125, Math.min(8, cue.pitch));
        gain.gain.value = this.level(cue.gain); source.connect(gain); gain.connect(this.sfxGain!);
        source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); };
        this.voices.add(source); source.start(this.context.currentTime + Math.max(0, Math.min(3, cue.delay)));
        this.stats.played++;
      }
    } catch (error) { this.stats.unavailable++; this.error(error); }
  }
  private stopVoice(source: AudioBufferSourceNode): void {
    this.voices.delete(source); try { source.stop(); } catch {} source.onended?.(new Event('ended'));
  }
  private stopMusic(): void {
    if (this.musicSource) { try { this.musicSource.stop(); } catch {} this.musicSource.disconnect(); }
    this.musicSource = undefined; this.activeMusic = null; this.stats.music = null;
  }
  stopAll(): void { this.revision++; this.desiredMusic = null; this.stopMusic(); for (const voice of [...this.voices]) this.stopVoice(voice); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort(); this.stopAll();
    this.tracks.clear(); this.sounds.clear(); this.cues.clear(); this.stats.prepared = []; this.stats.sfxReady = false;
    this.musicGain?.disconnect(); this.sfxGain?.disconnect(); void this.context?.close().catch(() => {});
  }
}
