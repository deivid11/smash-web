import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { extname, join, posix, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { transformWithOxc, type Plugin } from 'vite';
import { MAX_CHARACTER_PACKS, PACK_ID, type PackIdentity } from '../lib/custom/identity.ts';
import { root as repositoryRoot } from './shared.ts';

export interface PackManifest { format: 1; id: string; name: string; entry: string; files: string[]; assets: Record<string, string> }
export interface ReadPack { manifest: PackManifest; identity: PackIdentity; files: ReadonlyMap<string, Buffer>; assets: ReadonlyMap<string, { url: string; bytes: Buffer; type: string }> }
const MAX_FILE = 8 * 1024 * 1024, MAX_PACK = 32 * 1024 * 1024;
const MIME: Record<string, string> = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const SOURCE = new Set(['.ts', '.tsx', '.json']);
const pathOK = (name: unknown): name is string => typeof name === 'string' && name.length <= 160 && /^[A-Za-z0-9_./-]+$/u.test(name) && name.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !part.startsWith('.'));
function readBounded(directory: string, name: string): Buffer {
  if (!pathOK(name)) throw new Error('Invalid character pack relative path.');
  let current = directory;
  for (const part of name.split('/')) { current = join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('Character pack symlinks are not allowed.'); }
  const path = realpathSync(current);
  if (!path.startsWith(realpathSync(directory) + sep)) throw new Error('Character pack path escapes its directory.');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Character pack file exceeds its limit or is not a file.');
  return readFileSync(path);
}
/** Hash exactly the canonical manifest plus every declared code/data/asset byte, independent of location/mtime. */
export function readCharacterPack(directory: string): ReadPack {
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Character pack symlinks are not allowed.');
  const raw: unknown = JSON.parse(readBounded(directory, 'pack.json').toString('utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid character pack manifest.');
  const m = raw as PackManifest;
  if (Object.keys(m).sort().join(',') !== 'assets,entry,files,format,id,name' || m.format !== 1 || typeof m.id !== 'string' || !PACK_ID.test(m.id) || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 64 || !pathOK(m.entry) || !m.entry.endsWith('.ts') || !Array.isArray(m.files) || !m.files.length || m.files.length > 128 || !m.files.includes(m.entry) || !m.assets || typeof m.assets !== 'object' || Array.isArray(m.assets) || Object.keys(m.assets).length > 64) throw new Error('Invalid character pack manifest.');
  const files = [...m.files].sort();
  if (new Set(files).size !== files.length || files.some(name => !pathOK(name) || !SOURCE.has(extname(name)))) throw new Error('Invalid or duplicate character pack sources.');
  const assetEntries = Object.entries(m.assets).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (assetEntries.some(([key, name]) => !/^[a-z][a-z0-9-]{0,31}$/u.test(key) || !pathOK(name) || !MIME[extname(name)])) throw new Error('Invalid character pack assets.');
  const manifest: PackManifest = { format: 1, id: m.id, name: m.name, entry: m.entry, files, assets: Object.fromEntries(assetEntries) };
  const buffers = new Map<string, Buffer>(); let size = 0;
  for (const name of [...new Set([...files, ...assetEntries.map(([, name]) => name)])].sort()) {
    const bytes = readBounded(directory, name); size += bytes.length;
    if (size > MAX_PACK) throw new Error('Character pack exceeds 32 MiB.');
    buffers.set(name, bytes);
  }
  const hash = createHash('sha256').update('smash-character-pack-v1\n');
  const frame = (name: string, bytes: Buffer): void => { hash.update(`${Buffer.byteLength(name)}:${bytes.length}:`).update(name).update(bytes); };
  frame('pack.json', Buffer.from(JSON.stringify(manifest)));
  for (const [name, bytes] of buffers) frame(name, bytes);
  const digest = hash.digest('hex');
  const assets = new Map(assetEntries.map(([key, name]) => {
    const bytes = buffers.get(name)!;
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    return [key, { url: `/assets/custom-${m.id}-${key}-${fileHash}${extname(name)}`, bytes, type: MIME[extname(name)]! }] as const;
  }));
  return { manifest, identity: { id: `custom:${m.id}`, hash: digest }, files: new Map(files.map(name => [name, buffers.get(name)!])), assets };
}
export function configuredPacks(root = repositoryRoot, override = process.env.SMASH_CHARACTER_PACKS): ReadPack[] {
  let ids: unknown;
  if (override !== undefined) ids = override === 'none' || override === '' ? [] : override.split(',');
  else {
    const config = join(root, '.local/character-packs.json');
    ids = existsSync(config) ? (JSON.parse(readFileSync(config, 'utf8')) as { packs?: unknown }).packs : [];
  }
  if (!Array.isArray(ids) || ids.length > MAX_CHARACTER_PACKS || ids.some(id => typeof id !== 'string' || !PACK_ID.test(id)) || new Set(ids).size !== ids.length) throw new Error('Invalid local character pack selection.');
  return (ids as string[]).sort().map(id => {
    const pack = readCharacterPack(join(root, 'private/characters', id));
    if (pack.manifest.id !== id) throw new Error('Character pack directory and id disagree.');
    return pack;
  });
}

/** Virtual modules expose declared runtime source only. Never add private/ to Vite's fs allowlist. */
export function characterPacksPlugin(root = repositoryRoot): Plugin {
  const packs = configuredPacks(root), byId = new Map(packs.map(pack => [pack.manifest.id, pack]));
  const prefix = '\0smash-pack:', entry = '\0smash-installed-packs.ts';
  const moduleId = (id: string, path: string) => `${prefix}${id}/${path}${path.endsWith('.json') ? '.js' : ''}`;
  const moduleInfo = (id: string): { pack: ReadPack; name: string } | null => {
    if (!id.startsWith(prefix)) return null;
    const split = id.indexOf('/', prefix.length), pack = byId.get(id.slice(prefix.length, split));
    return pack ? { pack, name: id.slice(split + 1).replace(/\.json\.js$/u, '.json') } : null;
  };
  let building = false;
  return {
    name: 'local-character-packs', enforce: 'pre',
    configResolved(config) { building = config.command === 'build'; },
    resolveId(source, importer) {
      if (source === '#custom-packs') return entry;
      if (source === entry || source.startsWith(prefix)) return source;
      const info = importer ? moduleInfo(importer) : null;
      if (source.startsWith('@smash/')) {
        const name = source.slice(7);
        if (!pathOK(name) || !/^(lib|web\/src)\//u.test(name) || !/\.(ts|tsx)$/u.test(name)) throw new Error('Pack imports must target public runtime code.');
        return resolve(root, name);
      }
      if (!info) return null;
      if (source.startsWith('.')) {
        const name = posix.normalize(posix.join(posix.dirname(info.name), source));
        if (!info.pack.files.has(name)) throw new Error(`Undeclared character pack import: ${source}`);
        return moduleId(info.pack.manifest.id, name);
      }
      if (source === 'three' || source.startsWith('three/') || source === '@noble/hashes/sha2.js' || source === '@noble/hashes/utils.js') return null;
      throw new Error(`Unsupported character pack import: ${source}`);
    },
    load(id) {
      if (id === entry) {
        const imports = packs.map((pack, index) => `import make${index} from ${JSON.stringify(moduleId(pack.manifest.id, pack.manifest.entry))};`).join('\n');
        const entries = packs.map((pack, index) => `{identity:${JSON.stringify(pack.identity)},character:make${index}(${JSON.stringify({ kind: pack.identity.id, assets: Object.fromEntries([...pack.assets].map(([key, asset]) => [key, asset.url])) })})}`);
        return `${imports}\nexport default [${entries.join(',')}];`;
      }
      const info = moduleInfo(id);
      if (!info) return null;
      const bytes = info.pack.files.get(info.name);
      if (!bytes) throw new Error('Undeclared character pack module.');
      return info.name.endsWith('.json') ? `export default ${bytes.toString('utf8')};` : bytes.toString('utf8');
    },
    async transform(code, id) {
      const info = moduleInfo(id);
      // Vite skips its normal TS transform for null-prefixed virtual ids in dev/SSR.
      // Apply the same compiler explicitly; never serve raw TypeScript to a browser.
      if (info && /\.tsx?$/u.test(info.name)) return transformWithOxc(code, `character-pack/${info.pack.manifest.id}/${info.name}`);
      return null;
    },
    buildStart() {
      if (!building) return;
      for (const pack of packs) for (const asset of pack.assets.values()) this.emitFile({ type: 'asset', fileName: asset.url.slice(1), source: asset.bytes });
    },
    configureServer(server) {
      const assets = new Map(packs.flatMap(pack => [...pack.assets.values()].map(asset => [asset.url, asset] as const)));
      server.middlewares.use((req, res, next) => {
        const asset = assets.get((req.url ?? '').split('?')[0]!);
        if (!asset) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
        res.setHeader('Content-Type', asset.type); res.setHeader('Content-Length', asset.bytes.length);
        res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.end(req.method === 'HEAD' ? undefined : asset.bytes);
      });
    },
  };
}
