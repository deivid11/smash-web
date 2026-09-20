/**
 * Live dev workflow: rebuild `dist/` on every source change and serve it through
 * the real Melee server (the only server that injects the `smash-source` meta and
 * serves `/api/source` + `/api/assets/` from the ISO). Save a file → Vite rebuilds
 * in ~0.5s → reload the browser to see the change. This mirrors production exactly,
 * unlike `vite dev`, which cannot serve the game's asset protocol.
 *
 * Run: `npm run dev:live` (override the port with SMASH_PORT).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = (name: string) => fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));

const children: ChildProcess[] = [];
let shuttingDown = false;

function run(label: string, command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[dev:live] ${label} exited (${signal ?? code}); shutting down.`);
    shutdown(typeof code === 'number' ? code : 1);
  });
  return child;
}

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  // Give children a beat to exit cleanly, then force the process down.
  setTimeout(() => process.exit(code), 500).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => shutdown(0));

// Rollup/Vite empties the out dir once at startup, then writes incrementally on
// each rebuild, so the server never sees a half-empty dist after the first build.
run('vite build --watch', bin('vite'), ['build', '--watch']);
run('serve', bin('tsx'), ['scripts/serve.ts']);
