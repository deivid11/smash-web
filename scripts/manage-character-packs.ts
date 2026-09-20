import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { configuredPacks, readCharacterPack } from './character-packs.ts';
import { root, run } from './shared.ts';
import { PACK_ID } from '../lib/custom/identity.ts';

const [command = 'list', ...args] = process.argv.slice(2);
const config = join(root, '.local/character-packs.json');
function save(ids: string[]): void {
  // Validate every selected pack before replacing the local configuration.
  configuredPacks(root, ids.length ? ids.join(',') : 'none');
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, `${JSON.stringify({ packs: [...ids].sort() }, null, 2)}\n`);
  console.log('Saved local pack selection. Restart dev and rebuild the staged frontend; do not hot-mix relays.');
}
if (command === 'list' || command === 'check') {
  const packs = configuredPacks();
  for (const pack of packs) console.log(`${pack.identity.id}  ${pack.identity.hash}`);
  if (!packs.length) console.log('No local character packs enabled.');
  if (command === 'check' && packs.length) {
    mkdirSync(dirname(config), { recursive: true });
    const check = join(root, '.local/character-packs.tsconfig.json');
    writeFileSync(check, JSON.stringify({ extends: '../tsconfig.json', include: packs.flatMap(pack => pack.manifest.files.filter(file => /\.tsx?$/u.test(file)).map(file => `../private/characters/${pack.manifest.id}/${file}`)) }, null, 2));
    run('npm', ['exec', 'tsc', '--', '--noEmit', '--project', check]);
  }
} else if (command === 'disable') {
  if (args.length) throw new Error('Use packs disable with no arguments to disable all packs.');
  save([]);
} else if (command === 'enable') {
  if (!args.length || args.some(id => !PACK_ID.test(id))) throw new Error('Usage: npm run packs -- enable namespace.character [namespace.other]');
  save(args);
} else if (command === 'install') {
  if (args.length !== 1) throw new Error('Usage: npm run packs -- install <trusted local pack directory>');
  const source = resolve(root, args[0]!), pack = readCharacterPack(source);
  const dest = join(root, 'private/characters', pack.manifest.id);
  if (existsSync(dest)) throw new Error('That pack already exists. Back it up and replace it explicitly.');
  // Copy only the validated runtime manifest/files/assets, never references, archives or arbitrary trees.
  const paths = ['pack.json', ...pack.manifest.files, ...Object.values(pack.manifest.assets)];
  for (const file of new Set(paths)) {
    const target = join(dest, file); mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file === 'pack.json' ? `${JSON.stringify(pack.manifest, null, 2)}\n` : pack.files.get(file) ?? readFileSync(join(source, file)));
  }
  console.log(`Installed ${pack.manifest.id}. Review its code, then opt in with: npm run packs -- enable ${pack.manifest.id}`);
} else throw new Error('Usage: npm run packs -- list | check | enable <ids...> | disable | install <directory>');
