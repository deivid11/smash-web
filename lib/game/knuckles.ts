/** Knuckles runs on the shared Sonic m-ex engine (lib/game/sonic.ts); these names keep the
 * per-kind dispatch in lib/game/specials.ts uniform. */
export { sonicSpecialName as knucklesSpecialName, beginSonicSpecial as beginKnucklesSpecial,
  stepSonicSpecial as stepKnucklesSpecial, landSonicSpecial as landKnucklesSpecial } from './sonic.ts';
export type { SonicRuntime as KnucklesRuntime } from './sonic.ts';
