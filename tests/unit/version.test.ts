import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ModeSelect } from '../../web/src/play/mode-select.tsx';
import { GAME_VERSION, GAME_BUILT, versionLabel } from '../../web/src/version.ts';

const packaged = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

describe('game version stamp', () => {
  it('takes the version from package.json, with a dated label', () => {
    // One source of truth: a release bumps package.json and the menu follows.
    expect(GAME_VERSION).toBe(packaged);
    expect(GAME_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(GAME_BUILT).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(versionLabel()).toBe(`v${packaged} · built ${GAME_BUILT}`);
  });
  it('shows it in the main menu corner, and nowhere that would cover the modes', () => {
    const home = renderToStaticMarkup(createElement(ModeSelect, { onSolo: vi.fn(), onLan: vi.fn(), ready: true }));
    expect(home).toContain(`id="game-version"`);
    expect(home).toContain(`>v${packaged}<`);
    expect(home).toContain(`title="${versionLabel()}"`);
    // Last element of the menu section: the corner stamp never precedes the mode list.
    expect(home.indexOf('id="game-version"')).toBeGreaterThan(home.indexOf('id="mode-solo"'));
  });
});
