import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BattleSelect } from '../../web/src/play/battle-select.tsx';
import { ModeSelect } from '../../web/src/play/mode-select.tsx';
import { RouletteSetup } from '../../web/src/play/roulette-setup.tsx';
import { MENU_FIGHTER_ORDER, ROSTER_CHOICES, nextMenuFighter, pickRandomKind } from '../../lib/game/roster.ts';
import { FIGHTERS } from '../../web/src/play/battle-select.tsx';
import { GameSession } from '../../web/src/play/game-session.ts';
import { LocalMatch } from '../../lib/game/match.ts';
import { defaultSeats } from '../../lib/game/setup.ts';
import { createLinkState } from '../../lib/game/link.ts';

describe('debug P fighter cycler', () => {
  it('cycles in character-select menu order with the same fighter set', () => {
    expect([...MENU_FIGHTER_ORDER].sort()).toEqual([...ROSTER_CHOICES].sort());
    expect([...MENU_FIGHTER_ORDER].sort()).toEqual([...FIGHTERS.map(entry => entry.kind)].sort());
    expect(MENU_FIGHTER_ORDER[0]).toBe('Fx');
    expect(MENU_FIGHTER_ORDER.length).toBe(FIGHTERS.length);
    // Built-in adjacency stays independent of installed custom packs.
    expect(nextMenuFighter('Mr')).toBe('Kb');
    expect(nextMenuFighter('Lz')).toBe('Wf');
    expect(nextMenuFighter('WfU')).toBe('Fc');
    // Wraps around the end of the roster.
    expect(nextMenuFighter(MENU_FIGHTER_ORDER.at(-1)!)).toBe('Fx');
  });

  function sessionStub() {
    const view: Record<string, any> = {
      active: true, scene: 'arena', mode: 'solo', activeSeat: 1,
      setup: { seats: defaultSeats(), stage: 'battlefield' },
    };
    const ui = { getSnapshot: () => view, update: vi.fn((patch: Record<string, any>) => Object.assign(view, patch)) };
    const match = {
      phase: 'playing',
      fighters: [
        { seatId: 0, content: { profile: { kind: 'Fx', name: 'Fox' } }, state: 'idle' },
        { seatId: 1, content: { profile: { kind: 'Mr', name: 'Mario' } }, state: 'idle' },
      ],
      debugSwapFighter: vi.fn(),
    };
    const fake = {
      content: { roster: new Map([['Mr', { profile: { name: 'Mario' } }]]) },
      renderer: { swapFighterRig: vi.fn() },
      input: {},
      match,
      online: false,
      ui,
      ensureFighters: vi.fn(),
      unloadableKinds: (_kinds: readonly string[]) => [] as string[],
      setSwapBanner: GameSession.prototype['setSwapBanner'],
      swapP1ToKind: GameSession.prototype['swapP1ToKind'],
      cue: vi.fn(),
      publishHud: vi.fn(),
      focus: vi.fn(),
      pendingSwap: null,
      banner: '',
      bannerUntil: 0,
    };
    return { view, ui, match, fake };
  }

  it('always hot-swaps P1 (seat 0), never P2, with no restart', () => {
    const { view, match, fake } = sessionStub();
    // Even with the P2 panel last-touched, P cycles the seat-0 match slot.
    const next = GameSession.prototype.cycleDebugFighter.call(fake);
    expect(next).toBe('Mr');
    expect(match.debugSwapFighter).toHaveBeenCalledWith(0, 'Mr');
    expect(fake.renderer.swapFighterRig).toHaveBeenCalledTimes(1);
    expect(fake.ensureFighters).toHaveBeenCalledWith(['Mr']);
    // The draft follows P1 and the run continues: no reset/restart call.
    expect(view.setup.seats[0]?.fighter).toBe('Mr');
    expect(view.setup.seats[0]?.costume).toBe(0);
    expect(view.setup.seats[1]?.fighter).toBe('Mr');
    expect(view.activeSeat).toBe(0);
    expect((fake as any).reset).toBeUndefined();
    expect(view.progress).toContain('No restart');
  });

  it('skips fighters whose assets failed to load instead of wedging', () => {
    const { match, fake } = sessionStub();
    // Mario (next after Fox) is unloadable: P jumps straight to Kirby.
    fake.unloadableKinds = (kinds: readonly string[]) => kinds.filter(kind => kind === 'Mr');
    (fake.content.roster as Map<string, unknown>).set('Kb', { profile: { name: 'Kirby' } });
    const next = GameSession.prototype.cycleDebugFighter.call(fake);
    expect(next).toBe('Kb');
    expect(match.debugSwapFighter).toHaveBeenCalledWith(0, 'Kb');
    expect(fake.ensureFighters).toHaveBeenCalledWith(['Kb']);
  });

  it('surfaces swap failures as a banner instead of wedging', () => {
    const { match, fake } = sessionStub();
    match.debugSwapFighter.mockImplementationOnce(() => { throw new Error('poison model'); });
    const next = GameSession.prototype.cycleDebugFighter.call(fake);
    expect(next).toBeNull();
    expect(fake.banner).toBe('SWAP FAILED');
    expect(fake.renderer.swapFighterRig).not.toHaveBeenCalled();
  });

  it('defers the swap while the fighter downloads, then completes it', () => {
    const { view, match, fake } = sessionStub();
    (fake.content.roster as Map<string, unknown>).delete('Mr');
    const next = GameSession.prototype.cycleDebugFighter.call(fake);
    expect(next).toBe('Mr');
    expect(match.debugSwapFighter).not.toHaveBeenCalled();
    expect(fake.pendingSwap).toMatchObject({ slot: 0, kind: 'Mr' });
    expect(view.progress).toContain('preparing');
    // The draft already moved on, so the fighter arrives and the swap lands.
    (fake.content.roster as Map<string, unknown>).set('Mr', { profile: { name: 'Mario' } });
    GameSession.prototype['tryPendingSwap'].call(fake);
    expect(match.debugSwapFighter).toHaveBeenCalledWith(0, 'Mr');
    expect(fake.renderer.swapFighterRig).toHaveBeenCalledTimes(1);
    expect(fake.pendingSwap).toBeNull();
  });

  it('ignores online matches, menus, ended matches and P2-only slots', () => {
    const { view, fake } = sessionStub();
    expect(GameSession.prototype.cycleDebugFighter.call({ ...fake, online: true })).toBeNull();
    expect(GameSession.prototype.cycleDebugFighter.call({ ...fake, ui: { getSnapshot: () => ({ ...view, active: false }), update: vi.fn() } })).toBeNull();
    expect(GameSession.prototype.cycleDebugFighter.call({ ...fake, ui: { getSnapshot: () => ({ ...view, scene: 'characters' }), update: vi.fn() } })).toBeNull();
    expect(GameSession.prototype.cycleDebugFighter.call({ ...fake, match: { ...fake.match, phase: 'ended' } })).toBeNull();
    expect(fake.match.debugSwapFighter).not.toHaveBeenCalled();
  });

  // Real sim swap against a stubbed match host: position/percent/stocks carry,
  // transient fighter state resets, grab links break, KO re-places at spawn.
  function stubFighter(slot: number, kind: string, patch: Record<string, any> = {}) {
    return {
      slot, seatId: slot, content: { profile: { kind }, specials: { parameters: { kind } } },
      x: 10, y: 20, velocity: { x: 3, y: 4 }, knockback: { x: 0, y: 0 },
      grounded: true, floor: 1, facing: 1, state: 'attack', stateFrame: 5,
      animation: 'Attack', animationFrame: 2, animationRate: 1, animationEpoch: 0,
      combat: { partner: null, shield: 60, ledge: null }, attackName: 'Jab', attackSerial: 1,
      percent: 42, stocks: 2, jumpsUsed: 1, hitlag: 2, hitstun: 5, invulnerable: 0,
      shortHop: false, fastFall: true, downWindow: 0, ignoreFloor: null, ignoreTicks: 0,
      landingFrames: 0, previous: {}, victims: new Set(['old']),
      roySideBoostUsed: true, special: { direction: 'side' }, specialSerial: 1, specialLandingLag: 5, specialMobility: 0.5,
      capeBoostUsed: true, tornadoUsed: true, popoHoverUsed: true, jab: {}, smash: {},
      airJumpTurn: 1, hammerBoostUsed: true, copyAbility: 'Kb' as string | null,
      samusCharge: 50, samusSideTicks: 3, sheikNeedles: 4,
      gwOil: 1, gwOilDamage: 10, gwJudge1: 1, gwJudge2: 2, gwChefA: 1, gwChefB: 2,
      dkPunchCharge: 3, sonicCharge: 2, glideUsed: true,
      bsonic: { neutralUsed: true, sideUsed: true, upUsed: true },
      envContact: { wall: 1, ceiling: false }, mewtwoCharge: 5, mewtwoBoostUsed: true, koopaBreath: 10,
      lizardonFuel: { speed: 1, size: 1 }, peachTurnip: 3, peachFloat: { available: false, timer: 9 }, peachLastSmash: 2,
      link: { ...createLinkState(), bomb: { id: 7 } }, heldItem: 9, itemStatus: { kind: 'metal', timer: 100 },
      bury: null, ice: { timer: 5, spin: 1, angle: 2 }, hitstunInput: { jumpAt: 3, meteorLock: 4, jumpAge: 5, upSpecialAge: 6 },
      nana: { active: true }, rogue: {}, poison: null, hex: null, infected: false,
      kos: 1, falls: 2, damageDealt: 100, lastHitBy: 1,
      ...patch,
    };
  }
  function matchHost(fighters: any[], rosterKinds: Record<string, any>) {
    const roster = new Map(Object.entries(rosterKinds).map(([kind, extra]) => [kind, { profile: { kind }, specials: { parameters: { kind } }, ...(extra as object) }]));
    return {
      fighters,
      content: {
        roster,
        physics: { configureSlot: vi.fn() },
        stage: { blast: { top: 200 } },
        combat: { shield: { maximum: 60 } },
      },
      events: [] as any[],
      spawnPoints: [[0, 100], [50, 100]],
      change: LocalMatch.prototype['change'],
      spawn: LocalMatch.prototype['spawn'],
    };
  }

  it('swaps in place: keeps position/percent/stocks, resets transient state', () => {
    const fx = stubFighter(0, 'Fx');
    const mr = stubFighter(1, 'Mr', { state: 'idle', combat: { partner: null, shield: 60, ledge: null } });
    const host = matchHost([fx, mr], { Fx: {}, Mr: {} });
    LocalMatch.prototype.debugSwapFighter.call(host, 0, 'Mr');
    expect(fx.content.profile.kind).toBe('Mr');
    expect(host.content.physics.configureSlot).toHaveBeenCalledWith(0, { kind: 'Mr' });
    // The run continues: position, percent, stocks, stats and velocity carry.
    expect([fx.x, fx.y]).toEqual([10, 20]);
    expect(fx.percent).toBe(42); expect(fx.stocks).toBe(2);
    expect(fx.kos).toBe(1); expect(fx.damageDealt).toBe(100);
    expect(fx.velocity).toEqual({ x: 3, y: 4 });
    // Fresh body: idle on the ground, neutral transient slate.
    expect(fx.state).toBe('idle'); expect(fx.animation).toBe('Wait1');
    expect(fx.special).toBeNull(); expect(fx.attackName).toBeNull();
    expect(fx.hitstun).toBe(0); expect(fx.hitlag).toBe(0);
    expect(fx.copyAbility).toBeNull(); expect(fx.samusCharge).toBe(0);
    expect(fx.victims.size).toBe(0); expect(fx.combat.partner).toBeNull();
    expect(fx.ice).toBeNull(); expect(fx.nana).toBeNull();
    // The other fighter is untouched.
    expect(mr.content.profile.kind).toBe('Mr'); expect(mr.state).toBe('idle');
    expect(host.events.at(-1)).toMatchObject({ type: 'transform', player: 0, kind: 'Mr' });
  });

  it('releases grab links on both sides of the swap', () => {
    const fx = stubFighter(0, 'Fx', { state: 'holding', combat: { partner: 1, shield: 60, ledge: null } });
    const victim = stubFighter(1, 'Pk', { state: 'captured', combat: { partner: 0, shield: 60, ledge: null }, grounded: true });
    const host = matchHost([fx, victim], { Fx: {}, Mr: {} });
    LocalMatch.prototype.debugSwapFighter.call(host, 0, 'Mr');
    expect(victim.combat.partner).toBeNull();
    expect(victim.state).toBe('idle');
    expect(fx.combat.partner).toBeNull();
  });

  it('re-places a KOed swap at spawn with fresh percent and protection', () => {
    const fx = stubFighter(0, 'Fx', { state: 'ko', stateFrame: 40, x: 500, y: -300, percent: 120, stocks: 2 });
    const host = matchHost([fx, stubFighter(1, 'Mr', { state: 'idle' })], { Fx: {}, Mr: {} });
    LocalMatch.prototype.debugSwapFighter.call(host, 0, 'Mr');
    expect([fx.x, fx.y]).toEqual([0, 140]);
    expect(fx.percent).toBe(0); expect(fx.stocks).toBe(2);
    expect(fx.state).toBe('respawn'); expect(fx.invulnerable).toBe(150);
    expect(host.events.at(-1)?.type).toBe('transform');
  });

  it('picks uniformly from the pool minus the excluded kind', () => {
    expect(pickRandomKind([], 'Fx')).toBeNull();
    expect(pickRandomKind(['Fx'], 'Fx')).toBeNull();
    expect(pickRandomKind(['Fx'], 'Mr')).toBe('Fx');
    expect(pickRandomKind(['Fx', 'Mr'], null)).toMatch(/^(Fx|Mr)$/);
    // Never returns the excluded kind over many rolls.
    for (let roll = 0; roll < 50; roll++) expect(pickRandomKind(MENU_FIGHTER_ORDER, 'Kp')).not.toBe('Kp');
  });

  it('rolls P1 to a random loaded fighter, never P2', () => {
    const { view, match, fake } = sessionStub();
    const next = GameSession.prototype.randomDebugFighter.call(fake);
    // Only Mario is resident besides Fox, so the roll is forced.
    expect(next).toBe('Mr');
    expect(match.debugSwapFighter).toHaveBeenCalledWith(0, 'Mr');
    expect(fake.renderer.swapFighterRig).toHaveBeenCalledTimes(1);
    expect(view.setup.seats[0]?.fighter).toBe('Mr');
    expect(view.setup.seats[1]?.fighter).toBe('Mr');
    expect(view.progress).toContain('random');
  });

  it('rejects bad roulette intervals and arms the timer on toggle', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (key: string) => store[key] ?? null, setItem: (key: string, value: string) => { store[key] = value; } });
    try {
      const { fake } = sessionStub();
      const session = { ...fake, match: { ...fake.match, frame: 600 }, ui: fake.ui, online: false, rouletteSeconds: 30, focus: vi.fn() };
      expect(() => GameSession.prototype.setRouletteSeconds.call(session, 7)).toThrow();
      GameSession.prototype.setRouletteSeconds.call(session, 10);
      expect(session.rouletteSeconds).toBe(10);
      expect(store['smash-roulette-seconds']).toBe('10');
      GameSession.prototype.setRoulette.call(session, true);
      expect(store['smash-roulette']).toBe('1');
      expect((session as any).rouletteNext).toBe(600 + 10 * 60);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rotates every fighter on the roulette tick with no restart', () => {
    const { view, fake } = sessionStub();
    const match = {
      phase: 'playing',
      frame: 1800,
      fighters: [
        { slot: 0, seatId: 0, content: { profile: { kind: 'Fx', name: 'Fox' } } },
        { slot: 1, seatId: 1, content: { profile: { kind: 'Fx', name: 'Fox' } } },
      ],
      debugSwapFighter: vi.fn(),
    };
    const session = {
      ...fake, match,
      content: { roster: new Map([['Fx', { profile: { name: 'Fox' } }], ['Mr', { profile: { name: 'Mario' } }]]) },
      ui: { getSnapshot: () => ({ ...view, roulette: true }), update: vi.fn((patch: Record<string, any>) => Object.assign(view, patch)) },
      rouletteSeconds: 30,
      rouletteNext: 0,
      disposed: false,
      cue: vi.fn(),
      publishHud: vi.fn(),
      pendingSwap: null as null,
    };
    GameSession.prototype['fireRoulette'].call(session);
    expect(match.debugSwapFighter).toHaveBeenCalledTimes(2);
    expect(match.debugSwapFighter).toHaveBeenCalledWith(0, 'Mr');
    expect(match.debugSwapFighter).toHaveBeenCalledWith(1, 'Mr');
    expect((session as any).rouletteNext).toBe(1800 + 30 * 60);
    expect(view.progress).toContain('No restart');
  });

  it('opens a players-only roulette setup, armed but not started', () => {
    const view: Record<string, any> = {
      ready: true, loading: false, error: '',
      setup: { seats: defaultSeats(), stage: 'battlefield', hill: null, zombies: false, teams: false },
      mode: null, scene: 'home', paused: false,
    };
    const ui = { getSnapshot: () => view, update: vi.fn((patch: Record<string, any>) => Object.assign(view, patch)) };
    const fake = {
      online: false, ui,
      reset: vi.fn(), start: vi.fn(), ensureFighters: vi.fn(), ensureStage: vi.fn(),
      setRoulette: vi.fn(GameSession.prototype.setRoulette), cue: vi.fn(), focus: vi.fn(),
    };
    GameSession.prototype.chooseRoulette.call(fake);
    expect(fake.setRoulette).toHaveBeenCalledWith(true);
    expect(fake.start).not.toHaveBeenCalled();
    expect(view.scene).toBe('roulette');
    expect(view.mode).toBe('solo');
    // Fighters untouched: they roll on START.
    expect(view.setup.seats[0]?.fighter).toBe('Fx');
  });

  it('rolls the roulette lineup on START and refuses lone seats', () => {
    const view: Record<string, any> = {
      ready: true, loading: false, error: '',
      setup: { seats: defaultSeats(), stage: 'battlefield', hill: null, zombies: false, teams: false },
      mode: 'solo', scene: 'roulette', paused: false,
    };
    const ui = { getSnapshot: () => view, update: vi.fn((patch: Record<string, any>) => Object.assign(view, patch)) };
    const fake = {
      online: false, ui,
      reset: vi.fn(), start: vi.fn(), ensureFighters: vi.fn(), ensureStage: vi.fn(),
      setRoulette: vi.fn(),
      rollRouletteLineup: GameSession.prototype['rollRouletteLineup'],
    };
    GameSession.prototype.startRoulette.call(fake);
    expect(fake.start).toHaveBeenCalledTimes(1);
    // Every active seat got a menu fighter, default skin.
    for (const seat of view.setup.seats.filter((seat: any) => seat.control !== 'off')) {
      expect(MENU_FIGHTER_ORDER).toContain(seat.fighter);
      expect(seat.costume).toBe(0);
    }
    expect(fake.ensureFighters).toHaveBeenCalledTimes(1);
    expect(fake.ensureStage).toHaveBeenCalledTimes(1);
    // Lone seat: no launch.
    const solo = { ...view, setup: { ...view.setup, seats: defaultSeats().map(seat => ({ ...seat, control: seat.slot === 0 ? 'human' : 'off' })) } };
    const uiSolo = { getSnapshot: () => solo, update: vi.fn((patch: Record<string, any>) => Object.assign(solo, patch)) };
    const start = vi.fn();
    GameSession.prototype.startRoulette.call({ ...fake, ui: uiSolo, start });
    expect(start).not.toHaveBeenCalled();
  });

  it('offers roulette chaos on the main screen', () => {
    const plain = renderToStaticMarkup(createElement(ModeSelect, { onSolo: vi.fn(), onLan: vi.fn(), ready: true }));
    expect(plain).not.toContain('id="mode-roulette"');
    const html = renderToStaticMarkup(createElement(ModeSelect, { onSolo: vi.fn(), onLan: vi.fn(), onRoulette: vi.fn(), rouletteSeconds: 30, ready: true }));
    expect(html).toContain('id="mode-roulette"');
    expect(html).toContain('ROULETTE CHAOS');
    expect(html).toContain('every 30 s');
  });

  it('re-rolls the lineup on rematch and play-again while chaos is on', () => {
    const view: Record<string, any> = {
      ready: true, loading: false, error: '', paused: false, active: true, ended: true,
      roulette: true, mode: 'solo', scene: 'arena',
      setup: { seats: defaultSeats(), stage: 'battlefield', hill: null, zombies: false, teams: false },
    };
    const ui = { getSnapshot: () => view, update: vi.fn((patch: Record<string, any>) => Object.assign(view, patch)) };
    const fake = {
      online: false, ui, match: null,
      reset: vi.fn(), ensureFighters: vi.fn(), ensureStage: vi.fn(),
      rollRouletteLineup: GameSession.prototype['rollRouletteLineup'],
      audio: { unlock: vi.fn() }, menu: null, pause: vi.fn(), cue: vi.fn(),
    };
    GameSession.prototype.start.call(fake);
    expect(fake.reset).toHaveBeenCalledWith(true);
    for (const seat of view.setup.seats.filter((seat: any) => seat.control !== 'off')) {
      expect(MENU_FIGHTER_ORDER).toContain(seat.fighter);
    }
    // Chaos off: the draft survives untouched.
    const calm = { ...view, roulette: false, ended: true, setup: { ...view.setup, seats: defaultSeats() } };
    const uiCalm = { getSnapshot: () => calm, update: vi.fn((patch: Record<string, any>) => Object.assign(calm, patch)) };
    GameSession.prototype.start.call({ ...fake, ui: uiCalm });
    expect(calm.setup.seats[0]?.fighter).toBe('Fx');
  });

  it('shows eight player slots with a guarded NEXT on roulette setup', () => {
    const setupProps = (patch: Record<string, unknown> = {}) => ({
      seats: defaultSeats(), onControl: vi.fn(), onLevel: vi.fn(), ready: true,
      stocks: 3, seconds: 180, items: -1, onStocks: vi.fn(), onSeconds: vi.fn(), onItems: vi.fn(),
      rouletteSeconds: 30, onRouletteSeconds: vi.fn(),
      onBack: vi.fn(), onNext: vi.fn(), ...patch,
    });
    const html = renderToStaticMarkup(createElement(RouletteSetup, setupProps()));
    expect(html).toContain('id="go-stage"');
    expect(html).not.toContain('id="start-roulette"');
    expect(html.match(/data-seat-id="\d"/gu)).toHaveLength(8);
    expect(html).toContain('id="roulette-kind-0"');
    expect(html).toContain('HUMAN · WASD');
    expect(html).toContain('id="roulette-stocks"');
    expect(html).toContain('id="roulette-interval"');
    expect(html.match(/<button[^>]*id="go-stage"[^>]*>/)?.[0]).not.toContain('disabled');
    const lone = renderToStaticMarkup(createElement(RouletteSetup, setupProps({
      seats: defaultSeats().map(seat => ({ ...seat, control: seat.slot === 0 ? 'human' : 'off' })),
    })));
    expect(lone.match(/<button[^>]*id="go-stage"[^>]*>/)?.[0]).toContain('disabled');
  });

  it('shows a RANDOM button on character select', () => {
    const selectProps = (patch: Record<string, unknown> = {}) => ({
      seats: defaultSeats(), activeSeat: 0, onActiveSeat: vi.fn(), onFighter: vi.fn(), onControl: vi.fn(),
      canEdit: () => true, mode: 'local' as const, portraits: {}, stocks: 3, seconds: 180, ready: true, ...patch,
    });
    const html = renderToStaticMarkup(createElement(BattleSelect, selectProps()));
    expect(html).toContain('id="random-fighter"');
    const locked = renderToStaticMarkup(createElement(BattleSelect, selectProps({ canEdit: () => false })));
    expect(locked.match(/<button[^>]*id="random-fighter"[^>]*>/)?.[0]).toContain('disabled');
  });

  it('is a no-op for the same kind and throws for unknown slots/targets', () => {
    const fx = stubFighter(0, 'Fx', { state: 'idle' });
    const host = matchHost([fx], { Fx: {} });
    LocalMatch.prototype.debugSwapFighter.call(host, 0, 'Fx');
    expect(fx.state).toBe('idle');
    expect(() => LocalMatch.prototype.debugSwapFighter.call(host, 9, 'Mr')).toThrow();
    expect(() => LocalMatch.prototype.debugSwapFighter.call(host, 0, 'Mr')).toThrow();
  });
});
