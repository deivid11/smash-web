import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { DiscReader } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { MAX_ASSET_RESPONSE_BYTES, applyLook, type SourceManifest } from '../../lib/hsd/source-protocol.ts';
import { ANIMELEE_LOOK, lookModelPatch } from '../../lib/hsd/looks.ts';
import { loadGameContent, loadGameStage, loadRosterQueue, selectGameStage, type GameContent } from '../../lib/game/load.ts';
import { SUPPORTED_STAGES, type StageId } from '../../lib/game/stages.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import { rosterPlayers } from '../../lib/game/roster.ts';
import { LocalMatch, neutralInput } from '../../lib/game/match.ts';
import { openIsoSource, type IsoSource } from '../../server/iso-source.ts';
import { GameRigs } from '../../web/src/render/game-rig.ts';

// A look must be cosmetic: with and without it, peers keep one room fingerprint, so every
// simulation-visible value has to match. Needs the clean disc and the Animelee disc.
const iso = process.env.MELEE_DISC_PATH, lookIso = process.env.MELEE_LOOK_DISC_PATH;
const KINDS = ['Fx', 'Mr', 'Kb', 'Ss', 'Pk', 'Lk', 'Cl', 'Fe', 'Mt', 'Ca', 'Dk', 'Pr', 'Ns', 'Kp', 'Pe', 'Fc', 'Dr', 'Gn', 'Pc', 'Ms', 'Lg', 'Ys', 'Pp', 'Zd', 'Sk', 'Gw'] as const;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** The session a browser gets: offsets resolved through the (look-applied) manifest, bytes via the server source. */
function sourceSession(source: IsoSource, manifest: SourceManifest, look: string | null = null): HsdAssetSession {
  const reader: DiscReader = {
    size: manifest.discSize,
    async read(offset, length) {
      const file = manifest.files.find((entry) => offset >= entry.offset && offset - entry.offset <= entry.size && length <= entry.size - (offset - entry.offset))!;
      const out = new Uint8Array(length);
      for (let done = 0; done < length; done += MAX_ASSET_RESPONSE_BYTES) {
        out.set(await source.read(file.asset ?? file.path, offset - file.offset + done, Math.min(MAX_ASSET_RESPONSE_BYTES, length - done)), done);
      }
      return out;
    },
  };
  return new HsdAssetSession(reader, manifest, look === null ? undefined : lookModelPatch(look));
}
/** Simulation-visible leaves: parsed tables verbatim; any HSD model reduced to its skeleton. */
function leaves(value: unknown, prefix: string, out: Map<string, string>, depth = 0): void {
  if (depth > 9 || value === null || typeof value !== 'object') { out.set(prefix, JSON.stringify(value) ?? 'undefined'); return; }
  if (typeof (value as { then?: unknown }).then === 'function') return;
  if (ArrayBuffer.isView(value)) { out.set(prefix, sha256(new Uint8Array((value as Uint8Array).buffer, (value as Uint8Array).byteOffset, (value as Uint8Array).byteLength))); return; }
  if (value instanceof Map) { for (const [key, entry] of value) leaves(entry, `${prefix}.${String(key)}`, out, depth + 1); return; }
  if (value instanceof Set) { out.set(prefix, JSON.stringify([...value])); return; }
  if (Array.isArray((value as { roots?: unknown }).roots)) {
    const roots = (value as { roots: { joints: { rotation: number[]; scale: number[]; translation: number[]; parent: number; flags: number }[] }[] }).roots;
    // Poses read transforms, parents and CLASSICAL_SCALE (flag 0x8); other flags only steer drawing/skinning.
    out.set(`${prefix}.skeleton`, JSON.stringify(roots.map((root) => root.joints.map((joint) => [joint.rotation, joint.scale, joint.translation, joint.parent, joint.flags & 8]))));
    return;
  }
  // Raw archives, animation clips (unchanged AJ files), render geometry/materials and file-offset ids.
  const skip = new Set(['archive', 'clips', 'images', 'image', 'geometry', 'textures', 'material', 'materials', 'sound', 'physics', 'parts', 'id', 'animationPointer', 'materialAnimationPointer', 'stats', 'name']);
  for (const [key, entry] of Object.entries(value)) if (!skip.has(key)) leaves(entry, `${prefix}.${key}`, out, depth + 1);
}

describe.skipIf(!iso || !lookIso)('Animelee look over the original disc', () => {
  let source: IsoSource, manifest: SourceManifest, original: HsdAssetSession, looked: HsdAssetSession, wasm: ArrayBuffer;
  let a: GameContent, b: GameContent;
  beforeAll(async () => {
    source = await openIsoSource(iso!, undefined, lookIso!);
    manifest = source.manifest;
    original = sourceSession(source, manifest);
    looked = sourceSession(source, applyLook(manifest, 'animelee'), 'animelee');
    wasm = new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer;
    a = await loadGameContent(original, wasm.slice(0), undefined, 'final'); await loadRosterQueue(original, a, [...KINDS]);
    b = await loadGameContent(looked, wasm.slice(0), undefined, 'final'); await loadRosterQueue(looked, b, [...KINDS]);
  }, 300000);
  afterAll(async () => { await source?.close(); });

  it('offers exactly the pinned files and serves the Animelee bytes for them', async () => {
    const look = manifest.looks?.find((entry) => entry.id === 'animelee');
    expect(look?.files.map((file) => file.path).sort()).toEqual(Object.keys(ANIMELEE_LOOK.files).sort());
    for (const file of look!.files) expect(file.sha256).toBe(ANIMELEE_LOOK.files[file.path]![1]);
    expect(sha256(await looked.bytes('PlLkNr.dat'))).toBe(ANIMELEE_LOOK.files['PlLkNr.dat']![1]);
    expect(sha256(await original.bytes('PlLkNr.dat'))).toBe(ANIMELEE_LOOK.files['PlLkNr.dat']![0]);
  });

  it('keeps every pinned costume skeleton bit-identical, CLASSICAL_SCALE included', async () => {
    const costumes = Object.keys(ANIMELEE_LOOK.files).filter((path) => /^Pl..(Nr|Bu|Re|Gr|Wh|Bk|Ye|Or|La|Aq|Pi|Gy|Br|Lg)\.dat$/u.test(path));
    expect(costumes.length).toBeGreaterThan(100);
    for (const path of costumes) {
      const x = new Map<string, string>(), y = new Map<string, string>();
      leaves(await original.model(path), path, x); leaves(await looked.model(path), path, y);
      expect(y.get(`${path}.skeleton`), path).toBe(x.get(`${path}.skeleton`));
    }
  }, 120000);

  it('parses identical simulation data: only render-model skeletons of articles, hats and the stage model differ', async () => {
    const x = new Map<string, string>(), y = new Map<string, string>();
    const stages = async (session: HsdAssetSession) => Object.fromEntries(await Promise.all(SUPPORTED_STAGES.map(async ({ id }) => {
      const { stageModel: _model, stadiumModels: _models, ...data } = await loadGameStage(session, id); return [id, data] as const;
    })));
    leaves(a, 'core', x); leaves(await stages(original), 'stages', x);
    leaves(b, 'core', y); leaves(await stages(looked), 'stages', y);
    expect(y.size).toBe(x.size);
    const differing = [...x.keys()].filter((key) => x.get(key) !== y.get(key));
    const render = /^core\.(stageModel|.*\.(specials\.articles|sourceArticles|hookshot)\..*|.*\.copies\.[A-Za-z]+\.hat)\.skeleton$|^core\.(stageModel|.*\.(accessory|projectile|boomerang|lateBoomerang|returning|explosion|toad|toadHit|spore|launcher|hat))(\.model)?\.skeleton$/u;
    expect(differing.filter((key) => !render.test(key))).toEqual([]);
    // Nothing the simulation reads changes; the render layer does (or the look would be a no-op).
    expect(differing.length).toBeGreaterThan(0);
  }, 180000);

  it.each([
    ['battlefield', ['Lk', 'Pe'], 'final', ['Ns', 'Fx']],
    ['yoshi-story', ['Kb', 'Cl'], 'dream-land', ['Ys', 'Fc']],
    ['fountain-of-dreams', ['Dr', 'Ss'], 'battlefield', ['Pp', 'Mr']],
  ] as const)('replays CPU matches on %s with identical state hashes', async (first, firstKinds, second, secondKinds) => {
    const run = async (content: GameContent, session: HsdAssetSession, stage: StageId, kinds: readonly FighterKind[]) => {
      const staged = rosterPlayers(await selectGameStage(content, session, stage), kinds);
      const rig = new GameRigs(staged);
      try {
        const match = new LocalMatch(staged, rig, { opponent: 'human', countdown: 0, seed: 11, controllers: kinds.map(() => 'cpu' as const), seatIds: kinds.map((_, slot) => slot), cpuLevels: kinds.map(() => 9 as const) });
        match.start();
        const hashes: string[] = [];
        for (let frame = 0; frame < 900; frame++) { match.step(kinds.map(() => neutralInput())); if (frame % 30 === 29) hashes.push(match.stateHash()); }
        return hashes;
      } finally { rig.dispose(); }
    };
    for (const [stage, kinds] of [[first, firstKinds], [second, secondKinds]] as const) {
      expect(await run(b, looked, stage as StageId, kinds), `${stage} ${kinds.join('/')}`).toEqual(await run(a, original, stage as StageId, kinds));
    }
  }, 240000);
});
