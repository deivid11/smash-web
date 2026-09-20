import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { GameContent } from '../../lib/game/load.ts';
import type { PlayerInput } from '../../lib/game/match.ts';
import { ControllerHub } from '../../web/src/input/controller-hub.ts';
import {
  cleanMapping,
  controllerProfile,
  emptyMapping,
  mappedInput,
  mappingError,
  standardMapping,
} from '../../lib/input/gamepad-profiles.ts';
import { CSTICK_THRESHOLD, cStickActive, cStickEdge, smashEdge, smashHeld } from '../../lib/game/smash-stick.ts';
import { neutralInput } from '../../lib/game/match.ts';
import { normalizeInput } from '../../lib/game/rollback.ts';

function pad(id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)', axes = 4, buttons = 17) {
  return {
    index: 0, id, mapping: 'standard', connected: true,
    buttons: Array.from({ length: buttons }, () => ({ pressed: false, value: 0 })),
    axes: Array.from({ length: axes }, () => 0),
  };
}

describe('smash-stick helpers', () => {
  it('gates deflection past the threshold and tolerates missing fields', () => {
    expect(CSTICK_THRESHOLD).toBe(0.5);
    expect(cStickActive({ cX: 1, cY: 0 })).toBe(true);
    expect(cStickActive({ cX: 0.5, cY: 0 })).toBe(false);
    expect(cStickActive({ cX: 0, cY: -0.9 })).toBe(true);
    expect(cStickActive({})).toBe(false);
    expect(cStickEdge({ cX: 1 }, {})).toBe(true);
    expect(cStickEdge({ cX: 1 }, { cX: 1 })).toBe(false);
    expect(cStickEdge({}, {})).toBe(false);
    expect(smashHeld({ strong: true })).toBe(true);
    expect(smashHeld({ strong: false, cX: 0.9 })).toBe(true);
    expect(smashHeld({ strong: false })).toBe(false);
    expect(smashEdge({ strong: true }, { strong: false })).toBe(true);
    expect(smashEdge({ strong: true }, { strong: true })).toBe(false);
    expect(smashEdge({ strong: false, cX: 1 }, { strong: false })).toBe(true);
  });
});

describe('smash-stick controller mapping', () => {
  it('reports the right stick without disturbing the left stick', () => {
    const p = pad();
    p.axes = [0.2, 0, 1, 0];
    const input = mappedInput(p, standardMapping());
    expect(input.cX).toBeCloseTo(1);
    expect(input.cY).toBe(0);
    expect(input.x).toBeCloseTo(0.2);
    expect(input.strong).toBe(false);
  });
  it('applies the shared deadzone to the right stick and inverts vertical up', () => {
    const p = pad();
    p.axes = [0, 0, 0.1, -0.1];
    expect(mappedInput(p, standardMapping())).toMatchObject({ cX: 0, cY: 0 });
    p.axes = [0, 0, 0, -0.9];
    expect(mappedInput(p, standardMapping()).cY).toBeCloseTo(0.9);
  });
  it('keeps two-axis standard pads working with the smash-stick unbound', () => {
    const profile = controllerProfile(pad('Xbox Wireless Controller', 2));
    expect(profile.mapping).not.toBeNull();
    expect(profile.mapping!.axes.cx).toBeNull();
    expect(profile.mapping!.axes.cy).toBeNull();
    expect(mappedInput(pad('Xbox Wireless Controller', 2), profile.mapping!)).toMatchObject({ cX: 0, cY: 0 });
  });
  it('validates smash-stick axes and accepts profiles saved before it existed', () => {
    const dup = standardMapping();
    dup.axes.cx = { index: 0, sign: 1, center: 0 };
    expect(mappingError(dup, pad())).toContain('different axis');
    const far = standardMapping();
    far.axes.cy = { index: 9, sign: 1, center: 0 };
    expect(mappingError(far, pad())).toContain('Invalid CY axis');
    const legacy = JSON.parse(JSON.stringify({ ...standardMapping(), axes: { x: { index: 0, sign: 1, center: 0 }, y: { index: 1, sign: -1, center: 0 } } }));
    expect(mappingError(legacy, pad())).toBeNull();
    expect(cleanMapping(legacy)).toMatchObject({ axes: { cx: null, cy: null } });
    expect(mappingError(emptyMapping(), pad())).toContain('Bind');
  });
  it('fills a missing smash-stick from the standard layout without dropping saved buttons', () => {
    const legacy = cleanMapping(
      JSON.parse(JSON.stringify({ ...standardMapping(), axes: { x: { index: 0, sign: 1, center: 0 }, y: { index: 1, sign: -1, center: 0 } } })),
    );
    const storage = { value: JSON.stringify({ version: 1, profiles: [{ key: 'xbox:standard:17:4', mapping: legacy }] }) };
    const hub = new ControllerHub({
      getGamepads: () => [pad()], now: () => 0,
      storage: { getItem: () => storage.value, setItem: (_k, v) => { storage.value = v; } },
    });
    try {
      hub.detect();
      const device = hub.getSnapshot().devices[0]!;
      expect(device.calibrated).toBe(true);
      expect(device.mapping!.axes.cx).toEqual({ index: 2, sign: 1, center: 0 });
      expect(device.mapping!.axes.cy).toEqual({ index: 3, sign: -1, center: 0 });
      expect(device.mapping!.buttons.jump).toEqual([2, 3]);
    } finally {
      hub.dispose();
    }
  });
  it('requires a centered smash-stick before gameplay arms and ignores it in menus', () => {
    const p = pad();
    p.axes = [0, 0, 0.9, 0];
    const hub = new ControllerHub({ getGamepads: () => [p], now: () => 0 });
    try {
      hub.detect();
      hub.setEnabled(true);
      hub.scan(1);
      expect(hub.inputs(false)[0]).toMatchObject({ strong: false });
      p.axes = [0, 0, 0, 0];
      hub.scan(2);
      p.axes = [0, 0, 0.9, 0];
      hub.scan(3);
      const input = hub.inputs(false)[0]!;
      expect(input.cX).toBeCloseTo(0.9);
      expect(hub.menuState()).toMatchObject({ connected: true, left: false, right: false, confirm: false, back: false });
    } finally {
      hub.dispose();
    }
  });
});

describe('smash-stick netcode inputs', () => {
  it('passes the vector through normalization and equality', () => {
    expect(normalizeInput({ ...neutralInput(), cX: 0.8 })).toMatchObject({ cX: 0.8, cY: 0 });
    expect(() => normalizeInput({ ...neutralInput(), cX: 2 })).toThrow('smash-stick');
    expect(() => normalizeInput({ ...neutralInput(), cY: NaN })).toThrow('smash-stick');
  });
});

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('original-ISO flick and smash-stick attacks', async () => {
  const { readFile } = await import('node:fs/promises');
  const { openDisc } = await import('../../scripts/node-disc.ts');
  const { verifyMeleeDisc } = await import('../../lib/disc.ts');
  const { HsdAssetSession } = await import('../../lib/hsd/session.ts');
  const { loadGameContent } = await import('../../lib/game/load.ts');
  const matchMod = await import('../../lib/game/match.ts');
  const rigMod = await import('../../web/src/render/game-rig.ts');
  const { LocalMatch, neutralInput: neutral } = matchMod;
  const { GameRigs } = rigMod;

  let content: GameContent, game: InstanceType<typeof matchMod.LocalMatch>, rig: InstanceType<typeof rigMod.GameRigs>;
  const make = () => {
    rig?.dispose();
    rig = new GameRigs(content);
    game = new LocalMatch(content, rig, { opponent: 'human', countdown: 0 });
    game.start();
    game.fighters.forEach((f: InstanceType<typeof matchMod.LocalMatch>['fighters'][number], i: number) => {
      f.x = (i === 0 ? -1 : 1) * 40; f.y = 0; f.grounded = true; f.floor = 1; rig.sample(f);
    });
  };
  const step = (a: Partial<PlayerInput> = {}, b: Partial<PlayerInput> = {}) =>
    game.step([{ ...neutral(), ...a }, { ...neutral(), ...b }]);
  const ticks = (n: number, a: Partial<PlayerInput> = {}) => { for (let i = 0; i < n; i++) step(a); };
  const f = () => game.fighters[0]!;
  const air = () => { f().grounded = false; f().floor = null; f().state = 'fall'; f().animation = 'Fall'; f().y = 100; };

  beforeAll(async () => {
    const disc = await openDisc(iso!);
    try {
      content = await loadGameContent(
        new HsdAssetSession(disc, await verifyMeleeDisc(disc)),
        new Uint8Array(await readFile(new URL('../../web/public/wasm/melee-gameplay.wasm', import.meta.url))).buffer,
      );
    } finally {
      await disc.close();
    }
  }, 30000);
  beforeEach(() => make());
  afterEach(() => rig?.dispose());

  it('fires a side smash from a C-stick flick and charges while held', () => {
    step({ cX: 1 });
    expect(f().state).toBe('attack');
    expect(f().attackName).toBe(f().content.moves.strong);
    expect(f().smash).not.toBeNull();
    ticks(10, { cX: 1 });
    expect(f().smash?.phase).toBe('charging');
    step();
    expect(f().smash?.phase).toBe('released');
  });
  it('up-smashes from a C-stick flick without tap-jumping', () => {
    step({ cY: 1 });
    expect(f().state).toBe('attack');
    expect(f().attackName).toBe(f().content.moves.upSmash);
  });
  it('down-smashes from crouch on a C-stick flick while a held crouch tilts', () => {
    step({ y: -1 });
    expect(f().state).toBe('crouch');
    step({ y: -1, cY: -1 });
    expect(f().attackName).toBe(f().content.moves.downSmash);
    make();
    ticks(8, { y: -1 });
    expect(f().state).toBe('crouch');
    step({ y: -1, attack: true });
    expect(f().attackName).toBe(f().content.moves.downTilt);
  });
  it('smashes on a fast left-stick tap with attack, like the original', () => {
    step({ x: 1, attack: true });
    expect(f().attackName).toBe(f().content.moves.strong);
    expect(f().smash).not.toBeNull();
    make();
    step({ y: 1, attack: true });
    expect(f().attackName).toBe(f().content.moves.upSmash);
  });
  it('keeps tilts for held directions, jabs for neutral, and dash attacks for runs', () => {
    ticks(15, { x: 1, walk: true });
    step({ x: 1, walk: true, attack: true });
    expect(f().attackName).toBe(f().content.moves.sideTilt ?? 'Attack11');
    make();
    step({ attack: true });
    expect(f().attackName).toBe('Attack11');
    make();
    ticks(10, { x: 1 });
    expect(f().state).toBe('run');
    step({ x: 1, attack: true });
    expect(f().attackName).toBe(f().content.moves.dash);
  });
  it('fires a directional aerial from the smash-stick without touching drift', () => {
    air();
    const x = f().x;
    step({ cX: 1 });
    expect(f().attackName).toBe(f().content.moves.forwardAir);
    expect(f().x).toBeCloseTo(x, 1);
  });
});
