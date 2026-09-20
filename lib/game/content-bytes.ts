/** Memory census of loaded game content: how many bytes each category uses, and how many
 * it pins. A typed array can be a view into a much larger buffer (the browser downloads
 * whole asset files and answers ranged reads from that copy), so a few kilobytes of
 * animation stream can keep a multi-megabyte file alive. `used` counts view bytes;
 * `pinned` counts each distinct underlying buffer once. Diagnostics only: nothing here
 * runs during a match (see window.smashMemorySnapshot and docs/PERF_TELEMETRY.md). */
import type { GameContent } from './load.ts';

export interface ByteCategory { used: number; pinned: number; views: number; buffers: number }
export type ByteCensus = Record<string, ByteCategory> & { total: ByteCategory };

interface Counter { category: ByteCategory; buffers: Set<ArrayBufferLike> }

class Census {
  private readonly counters = new Map<string, Counter>();
  /** Buffers already charged to any category, so shared storage is counted once overall. */
  private readonly charged = new Set<ArrayBufferLike>();
  private readonly seen = new WeakSet<object>();

  add(category: string, view: ArrayBufferView | null | undefined): void {
    if (!view || typeof view.byteLength !== 'number') return;
    let counter = this.counters.get(category);
    if (!counter) { counter = { category: { used: 0, pinned: 0, views: 0, buffers: 0 }, buffers: new Set() }; this.counters.set(category, counter); }
    counter.category.used += view.byteLength;
    counter.category.views++;
    const buffer = view.buffer;
    if (!counter.buffers.has(buffer)) {
      counter.buffers.add(buffer);
      counter.category.buffers++;
      if (!this.charged.has(buffer)) { this.charged.add(buffer); counter.category.pinned += buffer.byteLength; }
    }
  }
  /** Counts an image whose RGBA is not resident (source bytes only). */
  undecoded(category: string, image: { width: number; height: number } | null | undefined): void {
    if (!image) return;
    let counter = this.counters.get(`${category}.undecoded`);
    if (!counter) { counter = { category: { used: 0, pinned: 0, views: 0, buffers: 0 }, buffers: new Set() }; this.counters.set(`${category}.undecoded`, counter); }
    counter.category.views++;
    // What it would cost if decoded, for comparison with the resident total.
    counter.category.used += image.width * image.height * 4;
  }
  /** Guards against walking a shared structure (or a cycle) twice. */
  fresh(value: object | null | undefined): boolean {
    if (!value || this.seen.has(value)) return false;
    this.seen.add(value);
    return true;
  }
  result(): ByteCensus {
    const total: ByteCategory = { used: 0, pinned: 0, views: 0, buffers: 0 };
    const out = {} as ByteCensus;
    for (const [name, counter] of [...this.counters].sort((a, b) => b[1].category.pinned - a[1].category.pinned)) {
      out[name] = counter.category;
      total.used += counter.category.used; total.pinned += counter.category.pinned;
      total.views += counter.category.views; total.buffers += counter.category.buffers;
    }
    out.total = total;
    return out;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function walkModel(census: Census, model: any, prefix: string): void {
  if (!census.fresh(model)) return;
  for (const root of model?.roots ?? []) {
    for (const part of root.parts ?? []) {
      const geometry = part.geometry;
      if (census.fresh(geometry)) {
        for (const view of [geometry?.positions, geometry?.normals, geometry?.colors, geometry?.matrices, geometry?.indices]) census.add(`${prefix}.geometry`, view);
        for (const uv of geometry?.uvs?.values() ?? []) census.add(`${prefix}.geometry`, uv);
      }
      for (const texture of part.material?.textures ?? []) {
        if (!census.fresh(texture.image)) continue;
        // Reading `pixels` would decode; only count images that already hold RGBA.
        if (texture.image?.decoded) census.add(`${prefix}.texturePixels`, texture.image.pixels);
        else census.undecoded(`${prefix}.texturePixels`, texture.image);
        // Source bytes are views into the asset archive, so they pin whole files.
        census.add(`${prefix}.textureSource`, texture.image?.source);
      }
    }
  }
}

function walkClips(census: Census, clips: Iterable<any> | undefined, prefix: string): void {
  for (const clip of clips ?? []) {
    if (!census.fresh(clip)) continue;
    for (const joint of clip.joints ?? []) {
      // `tracks` may materialize lazily; reading it is safe (no keyframe decode).
      for (const track of joint.tracks ?? []) {
        const stream = (track as { stream?: ArrayBufferView | null }).stream;
        if (stream) census.add(`${prefix}.animationStreams`, stream);
      }
    }
  }
}

/** Byte census of everything a loaded GameContent (plus any extra per-stage copies) keeps alive. */
export function contentByteCensus(content: GameContent | null | undefined, stages: Iterable<GameContent> = []): ByteCensus {
  const census = new Census();
  const seenFighters = new Set<unknown>();
  const walkContent = (value: any, stagePrefix: string): void => {
    if (!value) return;
    walkModel(census, value.stageModel, stagePrefix);
    for (const fighter of value.roster?.values() ?? []) {
      if (seenFighters.has(fighter)) continue;
      seenFighters.add(fighter);
      walkModel(census, fighter.model, 'fighter');
      walkModel(census, fighter.partnerModel, 'fighter');
      walkClips(census, fighter.clips?.values(), 'fighter');
    }
    for (const fighter of value.fighters ?? []) {
      if (seenFighters.has(fighter)) continue;
      seenFighters.add(fighter);
      walkModel(census, fighter.model, 'fighter');
      walkClips(census, fighter.clips?.values(), 'fighter');
    }
    walkClips(census, value.stageAnimations?.values?.(), stagePrefix);
    // Voice/SFX banks keep their raw ADPCM bytes for on-demand decoding, plus a PCM cache.
    if (census.fresh(value.sound)) {
      for (const bank of value.sound?.banks ?? []) if (census.fresh(bank)) census.add('audio.soundBanks', bank.bytes);
      for (const pcm of value.sound?.cache?.values?.() ?? []) for (const channel of pcm?.channels ?? []) census.add('audio.decodedPcm', channel);
    }
    for (const item of value.items?.kinds?.values() ?? []) walkModel(census, item.model, 'items');
    for (const model of value.commonEffects?.models?.values?.() ?? []) walkModel(census, model, 'effects');
  };
  walkContent(content, 'stage');
  for (const stage of stages) walkContent(stage, 'stage');
  return census.result();
}
