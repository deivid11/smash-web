import { describe, expect, it, vi } from 'vitest';
import type { GameContent } from '../../lib/game/load.ts';
import type { MatchEvent, MatchFighter, PoseProvider } from '../../lib/game/match.ts';
import type { ArticleData } from '../../lib/game/special-data.ts';
import type { CustomShotIntent } from '../../lib/game/specials.ts';
import type { V3 } from '../../lib/hsd/model.ts';

vi.mock('../../lib/custom/registry.ts', () => ({ requireCustomCharacter: () => { throw new Error('unused'); }, customCharacter: () => undefined }));
const { ProjectileWorld } = await import('../../lib/game/projectiles.ts');

/** A custom-pack straight shot: the pack's own article plus per-shot tuning, independent of any
 * original article. These checks use a synthetic world, not disc data. */
const hit = { id: 0, group: 0, bone: 0, damage: 1, radius: 1, offset: [0, 0, 0] as V3, angle: 0, growth: 0, weightSet: 0, base: 0, grounded: true, airborne: true };
const article = { model: {}, hit, speed: 1, angle: 0, lifetime: 60, gravity: 0, terminal: 1, bounce: 0, minSpeed: 0, scale: 1, sound: 0, rayScale: 1, deceleration: 0 } as unknown as ArticleData;
const fighter = (slot: number, kind: string, x: number, custom = true): MatchFighter => ({
  slot, x, y: 0, facing: 1, state: 'idle', grounded: true, invulnerable: 0, special: null, animation: 'Wait1', animationFrame: 0, animationEpoch: 0, link: { boomerang: null, bomb: null, passiveReady: false }, combat: { shield: 0 },
  content: { timelines: new Map(), profile: { kind, hurts: [{ bone: 0, a: [0, 2, 0], b: [0, 10, 0], radius: 2, grabbable: true }], shieldBone: 0, attributes: { modelScale: 1, shieldSize: 10 } },
    specials: { parameters: { kind: custom ? 'custom' : 'Mr' }, articles: { projectile: article, accessory: article } } },
} as unknown as MatchFighter);
const poses: PoseProvider = { sample: () => {}, point: (f, _bone, offset) => [f.x + offset[2] * f.facing, f.y + offset[1], offset[0]] };
const world = (fighters: MatchFighter[]) => new ProjectileWorld({
  stage: { floors: [{ a: [-100, 0], b: [100, 0], oneWay: false }], blast: { left: -250, right: 250, top: 200, bottom: -150 } },
  roster: new Map(fighters.map((f) => [f.content.profile.kind, f.content])), combat: { shield: { minimumScale: 0.15, maximum: 60, sizeScale: 1 } }, physics: {},
} as unknown as GameContent);
const tune = (over: Partial<CustomShotIntent> = {}): CustomShotIntent => ({ speed: 1.5, angle: 0, life: 40, hits: 1, rehit: 5, style: 7,
  hit: { damage: 6, angle: 45, growth: 60, base: 30, weightSet: 0, radius: 2, element: 0, soundKind: 1, soundSeverity: 1 }, ...over });

describe('custom-shot projectiles', () => {
  it('spawns the pack article at the requested point with per-shot tuning', () => {
    const owner = fighter(0, 'custom:test.shooter', 0), w = world([owner]);
    const item = w.spawn(owner, 'custom-shot', poses, false, 0, { player: 0, kind: 'custom-shot', at: [5, 12], custom: tune() });
    expect([item.x, item.y, item.vx, item.vy, item.life]).toEqual([5, 12, 1.5, 0, 40]);
    expect(item.hit.damage).toBe(6); expect(item.hit.radius).toBe(2); expect(item.data).toBe(article);
    expect(item.custom).toMatchObject({ hits: 1, rehit: 5, timer: 0, style: 7 });
    owner.facing = -1; expect(w.spawn(owner, 'custom-shot', poses, false, 0, { player: 0, kind: 'custom-shot', at: [0, 0], custom: tune() }).vx).toBe(-1.5);
  });
  it('refuses original fighters and missing tuning', () => {
    const native = fighter(0, 'Mr', 0, false), w = world([native]);
    expect(() => w.spawn(native, 'custom-shot', poses, false, 0, { player: 0, kind: 'custom-shot', custom: tune() })).toThrow();
    const owner = fighter(0, 'custom:test.shooter', 0);
    expect(() => world([owner]).spawn(owner, 'custom-shot', poses, false, 0, { player: 0, kind: 'custom-shot' })).toThrow();
  });
  it('re-arms a multi-contact shot on the same victim and applies the final override last', () => {
    const owner = fighter(0, 'custom:test.shooter', 0), victim = fighter(1, 'Mr', 6, false), w = world([owner, victim]);
    w.spawn(owner, 'custom-shot', poses, false, 0, { player: 0, kind: 'custom-shot', at: [2, 6], custom: tune({ speed: 0.05, hits: 3, rehit: 4, final: { damage: 9, angle: 50, growth: 90, base: 40, weightSet: 0, element: 1 } }) });
    const contacts: Array<{ frame: number; damage: number; element?: number }> = [], events: MatchEvent[] = [];
    for (let frame = 0; frame < 20; frame++) for (const impact of w.step([owner, victim], poses, events)) contacts.push({ frame, damage: impact.hit.damage, element: impact.hit.element });
    expect(contacts.map((c) => c.damage)).toEqual([6, 6, 9]);
    expect(contacts[2]!.element).toBe(1);
    expect(contacts[1]!.frame - contacts[0]!.frame).toBe(4);
    expect(w.items).toHaveLength(0);
  });
  it('snapshots a re-arming shot through its owner article and resimulates identically', () => {
    const owner = fighter(0, 'custom:test.shooter', 0), victim = fighter(1, 'Mr', 30, false), w = world([owner, victim]);
    w.spawn(owner, 'custom-shot', poses, false, 0, { player: 0, kind: 'custom-shot', at: [2, 6], custom: tune({ hits: 2, rehit: 3 }) });
    for (let i = 0; i < 5; i++) w.step([owner, victim], poses, []);
    const saved = w.captureState();
    expect(saved.items[0]!.article).toBe('custom:test.shooter'); expect(saved.items[0]!.custom).toMatchObject({ hits: 2, style: 7 });
    const run = () => { const hits: number[] = []; for (let i = 0; i < 30; i++) for (const impact of w.step([owner, victim], poses, [])) hits.push(impact.hit.damage); return { hits, left: w.items.length }; };
    const first = run(); w.restoreState(saved); const again = run();
    expect(again).toEqual(first); expect(first.hits).toEqual([6, 6]); expect(first.left).toBe(0);
  });
});
