/** Shadow runs on the shared Sonic m-ex engine (lib/game/sonic.ts), Chaos Control included; these
 * names keep the per-kind dispatch in lib/game/specials.ts uniform. */
export { sonicSpecialName as shadowSpecialName, beginSonicSpecial as beginShadowSpecial,
  stepSonicSpecial as stepShadowSpecial, landSonicSpecial as landShadowSpecial } from './sonic.ts';
export type { SonicRuntime as ShadowRuntime } from './sonic.ts';
