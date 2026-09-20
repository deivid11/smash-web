/** Build identity of this game code.
 *
 * `__GAME_VERSION__` is package.json's `version` and `__GAME_BUILT__` the build date,
 * both inlined by the bundler (`gameDefine` in vite.config.ts, mirrored in
 * vitest.config.ts). The fallbacks keep any host that loads these modules without the
 * defines — a bare tsx/node script — from throwing on an undefined global. */
export const GAME_VERSION: string = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : '0.0.0';
export const GAME_BUILT: string = typeof __GAME_BUILT__ === 'string' ? __GAME_BUILT__ : '';
/** `v0.2.0 · built 2026-09-19` — the corner label on the main menu. */
export const versionLabel = (): string => `v${GAME_VERSION}${GAME_BUILT ? ` · built ${GAME_BUILT}` : ''}`;
