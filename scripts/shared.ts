import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const upstream = fileURLToPath(new URL('../third_party/melee/', import.meta.url));

export function run(program: string, args: string[], cwd = root): void {
  console.log(`> ${program} ${args.join(' ')}`);
  const result = spawnSync(program, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed (${result.status ?? result.signal}).`);
}

export function capture(program: string, args: string[], cwd = root): string {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${program} failed.`);
  return result.stdout.trim();
}
