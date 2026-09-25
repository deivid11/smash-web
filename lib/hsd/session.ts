import { readExact, type DiscInfo, type DiscReader, type DiscEntry } from '../disc.ts';
import { HsdArchive } from './archive.ts';
import { loadModel, type HsdModel } from './model.ts';
import { fighterActions, loadFigatree, type AnimationClip, type FighterAction } from './animation.ts';
import { fighterAjFile, fighterDatFile, type OriginalFighterKind } from '../game/data.ts';
import { LoadCache } from './load-cache.ts';

export class HsdAssetSession {
  private models = new LoadCache<string,HsdModel>(4);
  private actions = new LoadCache<string,FighterAction[]>(32);
  private archives = new LoadCache<string,HsdArchive>(32);
  private clips = new LoadCache<string,AnimationClip>(256);
  /** `patchModel` adjusts a freshly parsed model before it is cached (a look's simulation-neutral joint flags). */
  constructor(private readonly reader: DiscReader, readonly info: Pick<DiscInfo, 'files'>, private readonly patchModel?: (name: string, model: HsdModel) => void) {}
  private entry(name: string): DiscEntry {
    const entry = this.info.files.find((file) => file.path === name);
    if (!entry) throw new Error(`Your disc does not contain ${name}.`);
    return entry;
  }
  private read(entry: DiscEntry, start = 0, length = entry.size): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || length > 64 * 1024 * 1024 || start > entry.size || length > entry.size - start) {
      throw new Error('Asset read exceeds its filesystem entry or memory budget.');
    }
    return readExact(this.reader, entry.offset + start, length);
  }
  /** Starts whole-file reads without parsing, so the transport (whole-file coalescing plus the
   * persistent cache) downloads ahead of a sequential parse; the later real reads are served
   * from it. Only files up to `maxBytes` (the transport's whole-file limit) are worth warming.
   * Unknown names and failures are ignored here: the real read reports them. */
  prefetch(names: readonly string[], maxBytes: number): void {
    for (const name of names) {
      const entry = this.info.files.find((file) => file.path === name);
      if (entry && entry.size > 0 && entry.size <= maxBytes) void this.read(entry).catch(() => undefined);
    }
  }
  async model(name: string): Promise<HsdModel> {
    return this.models.get(name,async()=>{const model=loadModel(new HsdArchive(await this.read(this.entry(name))));this.patchModel?.(name,model);return model;});
  }
  async bytes(name: string): Promise<Uint8Array> { return this.read(this.entry(name)); }
  async archive(name: string): Promise<HsdArchive> { return this.archives.get(name,async()=>new HsdArchive(await this.bytes(name))); }
  /** A fighter's data file, through the bounded archive cache. It used to be held in an
   * unbounded map, which kept every loaded fighter's whole `Pl*.dat` resident for the
   * session; parsed content copies what it needs, and the two callers (profile parsing and
   * the action table) are async load paths that can re-read after an eviction. */
  async fighterData(fighter: OriginalFighterKind): Promise<HsdArchive> {
    return this.archive(fighterDatFile(fighter));
  }
  async actionTable(fighter: OriginalFighterKind): Promise<FighterAction[]> {
    return this.actions.get(fighter,async()=>fighterActions(await this.fighterData(fighter)));
  }
  /** Loads an animation by figatree name, or by an explicit action-table entry when a
   * fighter reuses one figatree name for several motion states (Kirby's stone/inhale). */
  async clip(fighter: OriginalFighterKind, action: string | FighterAction): Promise<AnimationClip> {
    const actions = await this.actionTable(fighter);
    const selected = typeof action === 'string' ? actions.find((candidate) => candidate.name === action) : actions.includes(action) ? action : undefined;
    if (!selected) throw new Error(`The original ${fighter} animation ${typeof action === 'string' ? action : action.name} was not found.`);
    const key=`${fighter}:${selected.offset}:${selected.size}`;
    const clip=await this.clips.get(key,async()=>loadFigatree(await this.read(this.entry(fighterAjFile(fighter)),selected.offset,selected.size)));
    if (clip.name !== selected.symbol) throw new Error('Fighter animation symbol does not match its action table.');
    return clip;
  }
}
