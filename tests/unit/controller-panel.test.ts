import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ControllerHub } from '../../web/src/input/controller-hub.ts';
import { ControllerPanel } from '../../web/src/play/controller-panel.tsx';

function hubWithEightPads() {
  const hub = new ControllerHub({ secureContext: false, platform: 'Linux', getGamepads: () => Array.from({ length: 8 }, (_, index) => ({
    index: index * 3, id: 'Xbox Wireless Controller', mapping: 'standard', connected: true,
    axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  })) });
  hub.setLocalPlayerCount(8); hub.detect(); return hub;
}

describe('controller panel local-human capacity and exhibition explanation', () => {
  it('offers eight human ordinals with optional actual-seat labels without changing assignment values', () => {
    const hub = hubWithEightPads();
    try {
      const html = renderToStaticMarkup(createElement(ControllerPanel, { hub, online: false, localCount: 8, slotLabels: ['P3 / Fox', 'P5 / Mario'] }));
      expect(html.match(/class="controller-panel__device"/g)).toHaveLength(8);
      expect(html.match(/>Local human 8<\/option>/g)).toHaveLength(8);
      expect(html).toContain('value="0"'); expect(html).toContain('Local human 1 · P3 / Fox'); expect(html).toContain('Local human 2 · P5 / Mario');
      expect(html).toContain('Gamepad detection may be blocked');
      expect(html).not.toContain('first two humans'); expect(html).not.toContain('eight physical gamepads');
      expect(html).not.toContain('Pairing happens');
    } finally { hub.dispose(); }
  });
  it('renders one active online source even before the effect deactivates old local reservations', () => {
    const hub = hubWithEightPads();
    try {
      const html = renderToStaticMarkup(createElement(ControllerPanel, { hub, online: true, localCount: 8 }));
      expect(html).toContain('Online: only one local controller slot.');
      expect(html).not.toContain('>Local human 2'); expect(html).toContain('Human control 8 · inactive in this mode');
      expect(html).not.toContain('CPU exhibition');
    } finally { hub.dispose(); }
  });
  it('keeps exhibition controls menu-only and calibration actions without verbose notices', () => {
    const hub = hubWithEightPads();
    try {
      const html = renderToStaticMarkup(createElement(ControllerPanel, { hub, online: false, localCount: 1, spectating: true }));
      expect(html).toContain('Menu control · menu only'); expect(html).toContain('Menu-only.');
      expect(html).not.toContain('CPU exhibition'); expect(html).not.toContain('No device IDs');
      expect(html).not.toContain('Release buttons and center the stick');
      expect(html).toContain('Remap / calibrate');
    } finally { hub.dispose(); }
  });
  it('escapes optional seat labels as text rather than accepting HTML', () => {
    const hub = hubWithEightPads();
    try {
      const html = renderToStaticMarkup(createElement(ControllerPanel, { hub, online: false, localCount: 1, slotLabels: ['<img src=x onerror=alert(1)>'] }));
      expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
    } finally { hub.dispose(); }
  });
});
