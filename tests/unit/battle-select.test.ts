import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultSeats } from '../../lib/game/setup.ts';
import { BattleSelect, FIGHTERS, type BattleSelectProps } from '../../web/src/play/battle-select.tsx';
import { ModeSelect } from '../../web/src/play/mode-select.tsx';
import { StageSelect } from '../../web/src/play/selection-scenes.tsx';

function props(patch: Partial<BattleSelectProps> = {}): BattleSelectProps {
  return { seats: defaultSeats(), activeSeat: 0, onActiveSeat: vi.fn(), onFighter: vi.fn(), onControl: vi.fn(), canEdit: () => true, mode: 'local', portraits: {}, stocks: 3, seconds: 180, onRules: vi.fn(), ready: true, onNext: vi.fn(), onBack: vi.fn(), ...patch };
}
function button(html: string, id: string): string {
  return html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`, 'u'))?.[0] ?? '';
}

describe('battle selection presentation contracts', () => {
  it('shows only implemented fighters and eight separate configurable player panels', () => {
    const html = renderToStaticMarkup(createElement(BattleSelect, props()));
    // Zelda/Sheik share one paired card (two start-form halves plus the slot
    // container), so data-fighter markers outnumber FIGHTERS entries by one.
    expect(html.match(/data-fighter=/gu)).toHaveLength(FIGHTERS.length + 1);
    expect(html.match(/data-fighter="Zd-Sk"/gu)).toHaveLength(1);
    expect(html.match(/data-fighter="Zd"/gu)).toHaveLength(1);
    expect(html.match(/data-fighter="Sk"/gu)).toHaveLength(1);
    expect(html.match(/class="player-seat(?: |")/gu)).toHaveLength(8);
    for (let slot = 0; slot < 8; slot++) {
      expect(html).toContain(`id="seat-kind-${slot}"`); expect(html).toContain(`id="select-seat-${slot}"`);
    }
    expect(button(html, 'go-stage')).not.toContain('disabled');
    expect(html).not.toContain('id="start-match"');
    expect(html).toContain('id="back-to-mode"');
  });

  it('allows editing an incomplete setup but blocks proceeding with fewer than two active seats', () => {
    const html = renderToStaticMarkup(createElement(BattleSelect, props({ seats: defaultSeats().map(seat => ({ ...seat, control: seat.slot === 0 ? 'human' : 'off' })) })));
    expect(button(html, 'select-seat-0')).not.toContain('disabled');
    expect(button(html, 'select-seat-7')).not.toContain('disabled');
    expect(button(html, 'go-stage')).toContain('disabled');
  });

  it('allows all-CPU watch matches with a selectable level per CPU seat', () => {
    const onLevel = vi.fn();
    const html = renderToStaticMarkup(createElement(BattleSelect, props({ onLevel, seats: defaultSeats().map(seat => ({ ...seat, control: 'cpu', level: seat.slot === 2 ? 9 : 5 })) })));
    expect(html.match(/CPU LV 5 · SKILLED/gu)).toHaveLength(7); expect(html).toContain('CPU LV 9 · ELITE');
    for (let slot = 0; slot < 8; slot++) expect(html.match(new RegExp(`<select[^>]*id="seat-level-${slot}"[^>]*>`, 'u'))?.[0]).not.toContain('disabled');
    expect(html.match(/<option value="9" selected="">LV 9<\/option>/gu)).toHaveLength(1);
    expect(button(html, 'go-stage')).not.toContain('disabled');
    expect(html).not.toContain('HUMAN · WASD'); expect(html).not.toContain('TRAINING CPU');
  });

  it('hides the level control for human and off seats and disables it without a level callback', () => {
    const html = renderToStaticMarkup(createElement(BattleSelect, props({ seats: defaultSeats() })));
    expect(html).not.toContain('id="seat-level-0"'); expect(html).toContain('id="seat-level-1"'); expect(html).not.toContain('id="seat-level-2"');
    expect(html.match(/<select[^>]*id="seat-level-1"[^>]*>/u)?.[0]).toContain('disabled');
  });

  it('labels local keyboard sources by human order rather than physical seat number', () => {
    const html = renderToStaticMarkup(createElement(BattleSelect, props({ seats: defaultSeats().map(seat => ({ ...seat, control: seat.slot === 3 || seat.slot === 7 ? 'human' : 'cpu' })) })));
    const panels = html.split('<article');
    expect(panels.find(panel => panel.includes('data-seat-id="3"'))).toContain('HUMAN · WASD');
    expect(panels.find(panel => panel.includes('data-seat-id="7"'))).toContain('HUMAN · ARROWS');
  });

  it('keeps LAN controls locked when a guest may only choose their own fighter', () => {
    const html = renderToStaticMarkup(createElement(BattleSelect, props({ mode: 'lan', activeSeat: 1, seats: defaultSeats().map(seat => ({ ...seat, control: seat.slot < 2 ? 'human' : 'off' })), canEdit: (slot, field) => slot === 1 && field === 'fighter', onRules: undefined })));
    expect(button(html, 'select-seat-0')).toContain('disabled');
    expect(button(html, 'select-seat-1')).not.toContain('disabled');
    expect(html.match(/<select[^>]*id="seat-kind-1"[^>]*>/u)?.[0]).toContain('disabled');
    expect(html.match(/<select[^>]*id="setup-stocks"[^>]*>/u)?.[0]).toContain('disabled');
  });

  it('places the start action only on stage selection, with a real character-select back action', () => {
    const mode = renderToStaticMarkup(createElement(ModeSelect, { onSolo: vi.fn(), onLan: vi.fn(), ready: true }));
    expect(mode).toContain('id="mode-solo"'); expect(mode).toContain('id="mode-lan"'); expect(mode).not.toContain('id="start-match"');
    const hillMode = renderToStaticMarkup(createElement(ModeSelect, { onSolo: vi.fn(), onLan: vi.fn(), onHill: vi.fn(), ready: true }));
    expect(hillMode).toContain('id="mode-hill"');
    expect(mode).not.toContain('id="mode-hill"');
    const loading = renderToStaticMarkup(createElement(ModeSelect, { onSolo: vi.fn(), onLan: vi.fn(), ready: false, error: '' }));
    expect(loading).toContain('Loading original assets'); expect(loading).not.toContain('mode-boot-error');
    const failed = renderToStaticMarkup(createElement(ModeSelect, { onSolo: vi.fn(), onLan: vi.fn(), ready: false, error: 'Offline asset missing (PlFxAJ.dat bytes 0-5076).', onRetry: vi.fn() }));
    expect(failed).toContain('id="mode-boot-error"'); expect(failed).toContain('Offline asset missing (PlFxAJ.dat bytes 0-5076).');
    expect(failed).toContain('id="mode-boot-retry"'); expect(failed).not.toContain('Loading original assets');
    const stage = renderToStaticMarkup(createElement(StageSelect, { stage: 'battlefield', previews: {}, onStage: vi.fn(), onBack: vi.fn(), onStart: vi.fn(), canStart: false }));
    expect(stage).toContain('id="back-to-characters"'); expect(button(stage, 'start-match')).toContain('disabled');
  });

  it('offers king of the hill rules with zones and infinite lives instead of stocks', () => {
    const stock = renderToStaticMarkup(createElement(BattleSelect, props()));
    expect(stock).toContain('id="setup-match-type"'); expect(stock).toContain('id="setup-stocks"');
    expect(stock).toContain('id="setup-teams"'); expect(stock).not.toContain('id="setup-hill-zones"');
    expect(stock).not.toContain('∞ LIVES');
    const hill = renderToStaticMarkup(createElement(BattleSelect, props({ hill: { zones: 2 }, teams: true })));
    expect(hill).toContain('id="setup-hill-zones"'); expect(hill).toContain('id="setup-teams"');
    expect(hill).toContain('id="setup-hill-lives"'); expect(hill).toContain('∞ LIVES');
    expect(hill).not.toContain('id="setup-stocks"'); expect(hill).toContain('KOTH');
    const single = renderToStaticMarkup(createElement(BattleSelect, props({ hill: { zones: 1 } })));
    expect(single).toContain('A ONLY');
  });

  it('offers zombies rules with survivor stocks and locked teams', () => {
    const zombies = renderToStaticMarkup(createElement(BattleSelect, props({ zombies: true })));
    expect(zombies).toContain('id="setup-match-type"'); expect(zombies).toContain('ZOMBIES');
    expect(zombies).toContain('id="setup-stocks"'); expect(zombies).toContain('3-stock ZOMBIES');
    expect(zombies.match(/<select[^>]*id="setup-teams"[^>]*>/u)?.[0]).toContain('disabled');
    expect(zombies).toContain('joins the horde');
    const stock = renderToStaticMarkup(createElement(BattleSelect, props()));
    expect(stock).toContain('3-stock battle'); expect(stock).not.toContain('3-stock ZOMBIES'); expect(stock).not.toContain('joins the horde');
  });

  it('offers RED VS BLUE teams for normal stock battles', () => {
    const ffa = renderToStaticMarkup(createElement(BattleSelect, props()));
    expect(ffa).toContain('FREE-FOR-ALL'); expect(ffa).not.toContain('setup-hill-lives');
    const teams = renderToStaticMarkup(createElement(BattleSelect, props({ teams: true })));
    expect(teams).toContain('id="setup-teams"'); expect(teams).toContain('3-stock TEAMS');
    expect(teams).toContain('id="setup-stocks"'); expect(teams).not.toContain('id="setup-hill-zones"');
  });

  it('keeps LAN rooms on stock free-for-all rules with no mode controls', () => {
    const html = renderToStaticMarkup(createElement(BattleSelect, props({ mode: 'lan', hill: null })));
    expect(html).not.toContain('id="setup-match-type"'); expect(html).not.toContain('id="setup-teams"'); expect(html).not.toContain('id="setup-hill-zones"');
    expect(html).toContain('id="setup-stocks"');
  });

  it('presents Zelda and Sheik as one slot with two starting forms', () => {
    const html = renderToStaticMarkup(createElement(BattleSelect, props()));
    // One paired card, labelled as a single fighter with a Transform.
    expect(html).toContain('ZELDA ⇄ SHEIK');
    expect(html).toContain('ONE FIGHTER · DOWN-B SWAPS');
    expect(html).toContain('one fighter, two starting forms');
    // Both halves stay individually pickable starting forms.
    expect(html).toContain('Zelda starting form');
    expect(html).toContain('Sheik starting form');
    // A Sheik seat reads as the Zelda slot with its Transform target.
    const sheik = renderToStaticMarkup(createElement(BattleSelect, props({ seats: defaultSeats().map(seat => ({ ...seat, fighter: seat.slot === 0 ? 'Sk' as const : seat.fighter })) })));
    expect(sheik).toContain('DOWN-B ⇄ ZELDA');
    const zelda = renderToStaticMarkup(createElement(BattleSelect, props({ seats: defaultSeats().map(seat => ({ ...seat, fighter: seat.slot === 0 ? 'Zd' as const : seat.fighter })) })));
    expect(zelda).toContain('DOWN-B ⇄ SHEIK');
  });

  it('labels the Ice Climbers duo instead of a solo Popo', () => {
    const html = renderToStaticMarkup(createElement(BattleSelect, props()));
    expect(html).toContain('Ice Climbers duo (prototype Nana partner)');
    expect(html).not.toContain('solo Popo prototype');
  });
});
