import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root, upstream, run } from './shared.ts';
import { extractCFunction } from './extract-c.ts';

export function buildGameplay(emcc: string, compiler: string, commit: string): void {
  const directory = join(root, '.local/gameplay-build');
  const output = join(root, 'web/public/wasm');
  mkdirSync(directory, { recursive: true }); mkdirSync(output, { recursive: true });
  const definitions: Array<[string, string[]]> = [
    ['src/melee/ft/ftcommon.c', [
      'ftCommon_ApplyFrictionGround', 'ftCommon_8007C98C', 'ftCommon_ApplyGroundMovement',
      'ftCommon_8007CD6C', 'ftCommon_ApplyFrictionAir', 'ftCommon_8007D174', 'ftCommon_8007D28C',
      'ftCommon_Fall', 'ftCommon_FallFast', 'ftCommon_CalcHitlag', 'ftCommon_Ascend', 'ftCommon_8007D2E8', 'ftCommon_8007D3A8',
      'ftCommon_8007D140', 'ftCommon_8007D344',
    ]],
    ['src/melee/ft/inlines.h', ['getAccelAndTarget']],
    ['src/melee/ft/ft_084E.c', ['ft_80085134', 'ft_80085154', 'ft_80084F3C']],
    ['src/melee/ft/kinds/ftCommon/ftCo_Run.c', ['ftCo_Run_Phys']],
    ['src/melee/ft/kinds/ftCommon/ftCo_Dash.c', ['ftCo_Dash_Phys']],
    ['src/melee/ft/kinds/ftCommon/ftCo_TurnRun.c', ['ftCo_TurnRun_Phys']],
    ['src/melee/ft/ftwalkcommon.c', ['getWalkAccel', 'ftWalkCommon_GetWalkType', 'ftWalkCommon_800E0060']],
    ['src/melee/ft/ft_0DF0.c', ['ftCo_800DEEB8']],
    ['src/melee/ft/kinds/ftCommon/ftCo_Jump.c', ['ftCo_800CB110']],
    ['src/melee/ft/ftcoll.c', ['ftColl_GetDamageCount', 'ftColl_80079AB0', 'ftColl_8007AC68']],
    ['src/melee/ft/kinds/ftCommon/ftCo_Damage.c', ['ftCo_Damage_CalcAngle', 'ftCo_ScaleBy154']],
  ];
  const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const chunks: string[] = ['#include "bridge.h"'];
  const sources: Array<{ file: string; name: string; sha256: string }> = [];
  const collision = readFileSync(join(upstream, 'src/melee/ft/ftcoll.c'), 'utf8');
  const macroStart = collision.indexOf('#define KNOCKBACK(');
  const macroEnd = collision.indexOf('\n\n', macroStart);
  if (macroStart < 0 || macroEnd < 0) throw new Error('Missing pinned knockback macro.');
  const macro = collision.slice(macroStart, macroEnd);
  chunks.push(macro);
  sources.push({ file: 'src/melee/ft/ftcoll.c', name: 'KNOCKBACK', sha256: digest(macro) });
  for (const [file, names] of definitions) {
    const content = readFileSync(join(upstream, file), 'utf8');
    for (const name of names) {
      const code = extractCFunction(content, name);
      chunks.push(code); sources.push({ file, name, sha256: digest(code) });
    }
  }
  const generated = join(directory, 'original-functions.c');
  writeFileSync(generated, `${chunks.join('\n\n')}\n`);
  const binary = join(output, 'melee-gameplay.wasm');
  run(emcc, [
    generated, join(root, 'engine/gameplay/core.c'), join(upstream, 'src/sysdolphin/baselib/random.c'),
    '-I', join(root, 'engine/gameplay'), '-I', join(root, 'engine/compat'), '-I', join(upstream, 'src'),
    '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    '-Wno-unused-variable', '-Wno-unused-but-set-variable', '-Wno-unused-parameter',
    '-fno-fast-math', '-ffp-contract=off', '--no-entry', '-sSTANDALONE_WASM=1',
    '-sFILESYSTEM=0', '-sINITIAL_MEMORY=131072', '-sSTACK_SIZE=16384',
    '-sEXPORTED_FUNCTIONS=["_core_common_ptr","_core_common_size","_core_attrs_ptr","_core_attrs_size","_core_seed","_core_set_velocity","_core_velocity","_core_ground","_core_dash","_core_turn_run","_core_stationary_ground","_core_walk","_core_walk_type","_core_smash_damage","_core_air","_core_jump","_core_air_jump","_core_hit","_core_decay","_core_result","_core_custom_air","_core_ascend","_core_drift","_core_controlled_drift","_core_motion","_HSD_Rand"]',
    '-o', binary,
  ]);
  writeFileSync(join(output, 'gameplay.build.json'), `${JSON.stringify({
    scope: 'Selected original movement, jump, hitlag, knockback and RNG routines with a private adapter ABI. Not the complete Melee engine.',
    upstreamCommit: commit, compiler, functions: sources,
    wrapperSha256: digest(readFileSync(join(root, 'engine/gameplay/core.c'))),
    bridgeSha256: digest(readFileSync(join(root, 'engine/gameplay/bridge.h'))),
    wasmSha256: digest(readFileSync(binary)), wasmBytes: readFileSync(binary).length,
  }, null, 2)}\n`);
  console.log(`Built gameplay bridge from ${sources.length - 1} original functions plus RNG: ${readFileSync(binary).length} bytes.`);
}
