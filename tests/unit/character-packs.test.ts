import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readCharacterPack, configuredPacks } from '../../scripts/character-packs.ts';
import { root } from '../../scripts/shared.ts';
import { CUSTOM_PACKS, CUSTOM_PACK_IDENTITIES, CUSTOM_FIGHTERS, validateRegistry, addCustomCharacters } from '../../lib/custom/registry.ts';
import { isCustomFighter, validPackIdentities, MAX_CHARACTER_PACKS } from '../../lib/custom/identity.ts';
import { FIGHTERS } from '../../web/src/play/battle-select.tsx';
import { ROSTER_CHOICES } from '../../lib/game/roster.ts';
import makeExample from '../../examples/characters/training-dummy/runtime/index.ts';
import type { FighterKind } from '../../lib/game/data.ts';
import type { FighterContent } from '../../lib/game/load.ts';

const temporary: string[] = [];
function fixture() {
  mkdirSync(join(root, '.local'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local/pack-test-')); temporary.push(dir);
  const manifest = { format: 1, id: 'example.dummy', name: 'Example', entry: 'runtime/index.ts', files: ['runtime/index.ts', 'runtime/data.json'], assets: { portrait: 'portrait.png' } };
  mkdirSync(join(dir, 'runtime'));
  const save = () => writeFileSync(join(dir, 'pack.json'), JSON.stringify(manifest));
  save(); writeFileSync(join(dir, 'runtime/index.ts'), 'export default () => ({apiVersion: 1});');
  writeFileSync(join(dir, 'runtime/data.json'), '{"speed":1}'); writeFileSync(join(dir, 'portrait.png'), new Uint8Array([1, 2, 3]));
  return { dir, manifest, save };
}
afterEach(() => { vi.unstubAllEnvs(); for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('local pack manifests and byte identities', () => {
  it('hashes source, data, assets and canonical metadata independently of location and ordering', () => {
    const a = fixture(), b = fixture(), baseline = readCharacterPack(a.dir);
    b.manifest.files.reverse(); b.save();
    expect(readCharacterPack(b.dir).identity).toEqual(baseline.identity);
    for (const file of ['runtime/index.ts', 'runtime/data.json', 'portrait.png']) {
      const c = fixture(); writeFileSync(join(c.dir, file), 'changed bytes');
      expect(readCharacterPack(c.dir).identity.hash).not.toBe(baseline.identity.hash);
    }
    b.manifest.name = 'Changed metadata'; b.save();
    expect(readCharacterPack(b.dir).identity.hash).not.toBe(baseline.identity.hash);
    expect(baseline.assets.get('portrait')?.url).toMatch(/^\/assets\/custom-example\.dummy-portrait-[a-f0-9]{64}\.png$/u);
    expect(JSON.stringify(baseline.identity)).not.toContain(a.dir);
  });
  it('ignores undeclared reference material but rejects missing declared files', () => {
    const f = fixture(), before = readCharacterPack(f.dir).identity;
    writeFileSync(join(f.dir, 'private-reference.txt'), 'not runtime content');
    expect(readCharacterPack(f.dir).identity).toEqual(before);
    rmSync(join(f.dir, 'runtime/data.json'));
    expect(() => readCharacterPack(f.dir)).toThrow();
  });
  it.each(['../outside.ts', '/absolute.ts', 'runtime/../outside.ts', '.env', 'runtime//bad.ts'])('rejects unsafe manifest path %s', path => {
    const f = fixture(); f.manifest.files.push(path); f.save();
    expect(() => readCharacterPack(f.dir)).toThrow();
  });
  it('rejects duplicate sources, oversized resources, and symlink escapes', () => {
    const a = fixture(); a.manifest.files.push(a.manifest.entry); a.save(); expect(() => readCharacterPack(a.dir)).toThrow();
    const b = fixture(); writeFileSync(join(b.dir, 'portrait.png'), Buffer.alloc(8 * 1024 * 1024 + 1)); expect(() => readCharacterPack(b.dir)).toThrow();
    const c = fixture(); rmSync(join(c.dir, 'runtime/data.json')); symlinkSync(join(root, 'package.json'), join(c.dir, 'runtime/data.json')); expect(() => readCharacterPack(c.dir)).toThrow(/symlink/u);
  });
  it('is explicit opt-in and public mode overrides local configuration', () => {
    vi.stubEnv('SMASH_CHARACTER_PACKS', undefined);
    const f = fixture();
    expect(configuredPacks(f.dir)).toEqual([]);
    mkdirSync(join(f.dir, '.local')); writeFileSync(join(f.dir, '.local/character-packs.json'), JSON.stringify({ packs: ['example.missing'] }));
    expect(configuredPacks(f.dir, 'none')).toEqual([]);
    expect(() => configuredPacks(f.dir)).toThrow();
    expect(() => configuredPacks(f.dir, '../private')).toThrow();
    expect(() => configuredPacks(f.dir, 'example.dummy,example.dummy')).toThrow();
  });
  it('bounds, canonicalizes and namespaces advertised pack identities', () => {
    const a = { id: 'custom:example.alpha', hash: 'a'.repeat(64) }, b = { id: 'custom:example.beta', hash: 'b'.repeat(64) };
    expect(validPackIdentities([a, b])).toBe(true);
    for (const entries of [[b, a], [a, a], [{ ...a, hash: 'bad' }], [{ ...a, url: '/upload' }], Array(MAX_CHARACTER_PACKS + 1).fill(a)]) expect(validPackIdentities(entries)).toBe(false);
    for (const value of ['Fx', 'custom:../secret', 'custom:Foo.bar', 'custom:example', null]) expect(isCustomFighter(value)).toBe(false);
  });
});

describe('installed registry and neutral authoring example', () => {
  it('loads exactly the opted-in manifest hashes and appends custom cards once', () => {
    expect(CUSTOM_PACK_IDENTITIES).toEqual(configuredPacks().map(pack => pack.identity));
    expect(FIGHTERS.filter(fighter => isCustomFighter(fighter.kind)).map(fighter => fighter.kind)).toEqual(CUSTOM_FIGHTERS);
    for (const kind of CUSTOM_FIGHTERS) expect(ROSTER_CHOICES.filter(entry => entry === kind)).toHaveLength(1);
    const roster = new Map<FighterKind, FighterContent>(); addCustomCharacters(roster);
    expect([...roster.keys()]).toEqual(CUSTOM_FIGHTERS);
    for (const pack of CUSTOM_PACKS) expect(roster.get(pack.kind)?.profile.name).toBe(pack.name);
  });
  it('offers an authored example without a private pack or extracted model', async () => {
    const character = makeExample({ kind: 'custom:example.training-dummy', assets: {} });
    const fighter = character.create();
    expect(fighter.profile.kind).toBe(character.kind); expect(fighter.custom).toBe(character.kind);
    expect(fighter.profile.words.byteLength).toBe(0x9c); expect(fighter.clips.has('Wait1')).toBe(true);
    expect(fighter.specials.parameters.kind).toBe('custom'); expect(fighter.model.stats.meshes).toBe(0);
    const visual = await character.prepareVisual!(); visual.dispose();
    const entry = { identity: { id: character.kind, hash: 'a'.repeat(64) }, character };
    expect(validateRegistry([entry])).toHaveLength(1);
    expect(validateRegistry([{ ...entry, character: { ...character, landed() {}, aerialAttack: () => null, specials: { ...character.specials, allowed: () => true } } }])).toHaveLength(1);
    for (const key of ['landed', 'aerialAttack'] as const) expect(() => validateRegistry([{ ...entry, character: { ...character, [key]: 7 } as unknown as typeof character }])).toThrow('Invalid custom gameplay hook');
    expect(() => validateRegistry([{ ...entry, character: { ...character, specials: { ...character.specials, allowed: 7 } } as unknown as typeof character }])).toThrow('Invalid custom gameplay hook');
    expect(() => validateRegistry([entry, entry])).toThrow();
    expect(() => validateRegistry([{ ...entry, character: { ...character, kind: 'custom:other.character' } }])).toThrow();
  });
});
