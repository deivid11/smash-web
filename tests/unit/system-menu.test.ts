import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SystemMenu, describePads } from '../../web/src/play/system-menu.tsx';
import { ModeSelect } from '../../web/src/play/mode-select.tsx';
import { StageSelect } from '../../web/src/play/selection-scenes.tsx';
import type { GameSession } from '../../web/src/play/game-session.ts';
import type { ControllerSnapshot } from '../../web/src/input/controller-hub.ts';

const session = { input: null } as unknown as GameSession;
const props = { session, ready: true, onOptions: vi.fn(), onControllers: vi.fn() };

describe('menu settings entry points (replacing the bottom system bar)', () => {
  it('renders a labelled settings section on home and icon buttons in scene headers', () => {
    const home = renderToStaticMarkup(createElement(ModeSelect, { onSolo: vi.fn(), onLan: vi.fn(), ready: true, system: createElement(SystemMenu, { ...props, variant: 'home' }) }));
    expect(home).toContain('class="system-menu system-menu-home"');
    expect(home).toContain('id="open-options"'); expect(home).toContain('aria-label="OPTIONS"'); expect(home).toContain('id="controller-settings"');
    expect(home).not.toContain('menu-system-bar');
    const stage = renderToStaticMarkup(createElement(StageSelect, { stage: 'battlefield', previews: {}, onStage: vi.fn(), onBack: vi.fn(), onStart: vi.fn(), system: createElement(SystemMenu, { ...props, variant: 'header' }) }));
    expect(stage).toMatch(/<header class="battle-select-heading">.*class="system-menu system-menu-header".*<\/header>/s);
    expect(stage).toContain('aria-label="Controllers"');
    // Scene headers show one settings cog; Options / Controllers / Fullscreen wait inside its closed menu.
    const header = renderToStaticMarkup(createElement(SystemMenu, { ...props, variant: 'header', fullscreenButton: createElement('button', { id: 'fullscreen-toggle' }) }));
    expect(header.match(/class="system-icon/gu)).toHaveLength(1);
    expect(header).toMatch(/id="system-menu-toggle"[^>]*aria-expanded="false"/);
    expect(header).toMatch(/<div class="system-menu-popover"[^>]*hidden="">.*id="open-options".*id="controller-settings".*id="fullscreen-toggle".*<\/div>/s);
  });
  it('disables Controllers until the game is ready and summarizes connected pads', () => {
    expect(renderToStaticMarkup(createElement(SystemMenu, { ...props, ready: false, variant: 'header' }))).toMatch(/id="controller-settings"[^>]*disabled/);
    const snapshot = { devices: [{ connected: true, mapping: {}, standard: true, slot: 0, profile: 'PlayStation' }, { connected: true, mapping: null, standard: true, slot: 1, profile: 'Xbox' }] } as unknown as ControllerSnapshot;
    expect(describePads(snapshot)).toBe('PLAYSTATION · P1 +1');
    expect(describePads({ devices: [] } as unknown as ControllerSnapshot)).toContain('NO CONTROLLER');
  });
});
