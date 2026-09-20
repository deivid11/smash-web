import { describe, expect, it } from 'vitest';
import { generateRun, isBossRow, nodeAt, type GeneratedRun } from '../../lib/game/roguelike/generator.ts';
import {
  advance, availableLanes, buyHeal, buyPom, buyRemoval, buyShopCard, buyShopPocket, chooseEventOption, chooseNode, createRun,
  currentFloor, eventOptionAvailable, leaveEvent, leaveShop, pickBlessing, pickOffer, removeConsumable, rerollOffers, rerollShop,
  pickSpoil, resolveFloor, restHeal, restTemper, runBuild, runPrice, scoreForFloor, skipOffer, toFight, BASE_LIVES, MAX_LIVES,
  COINS_FLAWLESS, COINS_PER_CLEAR, COINS_PER_KO,
  type RogueRun,
} from '../../lib/game/roguelike/run-state.ts';
import { boonById, shopPrice, BOON_POOL } from '../../lib/game/roguelike/boons.ts';
import { metaBonuses, emptyMeta } from '../../lib/game/roguelike/meta.ts';

const win = { flawless: false, kos: 1, defiancesUsed: 0 };

/** One simple step inside a room (fights always win, events leave or take the safe option). */
function stepRoom(run: RogueRun, plan: GeneratedRun): RogueRun {
  switch (run.phase) {
    case 'intro': return toFight(run);
    case 'fight': return resolveFloor(run, plan, 'win', win);
    case 'reward': return pickOffer(run, plan, 0);
    case 'event': {
      if (run.event!.outcome !== null) return leaveEvent(run, plan);
      const safe = eventOptionAvailable(run, 'leave') ? 'leave' : run.event!.id === 'hat' ? 'sell' : 'shelter';
      return chooseEventOption(run, plan, safe);
    }
    case 'rest': return restHeal(run, plan);
    case 'spoils': return pickSpoil(run, plan, run.spoils[0]!);
    case 'shop': return leaveShop(run, plan);
    default: return run;
  }
}
/** Drive any room to completion (antechamber shops included). */
function clearRoom(run: RogueRun, plan: GeneratedRun): RogueRun {
  let next = run;
  for (let guard = 0; guard < 20; guard++) {
    next = stepRoom(next, plan);
    if (next.phase === 'map' || next.phase === 'victory' || next.phase === 'gameover') return next;
  }
  throw new Error(`Room did not finish (phase ${next.phase}).`);
}

describe('run lifecycle (blessing → map → rooms → boss → victory)', () => {
  it('starts with a blessing choice and meta bonuses', () => {
    const plan = generateRun('RIFT-START');
    const run = createRun(plan);
    expect(run.phase).toBe('blessing');
    expect(run.lives).toBe(BASE_LIVES);
    expect(run.blessings).toHaveLength(3);
    const meta = emptyMeta();
    meta.ranks.resilience = 1; meta.ranks.greed = 2; meta.ranks.authority = 1; meta.ranks.skin = 2;
    const boosted = createRun(plan, metaBonuses(meta));
    expect(boosted.lives).toBe(BASE_LIVES + 1);
    expect(boosted.maxLives).toBe(MAX_LIVES + 1);
    expect(boosted.coins).toBe(100);
    expect(boosted.rerolls).toBe(1);
    expect(runBuild(boosted).player.damageTakenMul).toBeCloseTo(0.9, 6);
    expect(() => chooseNode(run, plan, 0)).toThrow();
    expect(() => pickBlessing(run, plan, 'nope' as never)).toThrow();
    for (const id of run.blessings) {
      const blessed = pickBlessing(run, plan, id);
      expect(blessed.phase).toBe('map');
      expect(blessed.blessing).toBe(id);
    }
  });

  it('walks the full 50-floor descent to victory along a legal path', () => {
    const plan = generateRun('RIFT-FULL', { playerFighter: 'Kb' });
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    let previousScore = -1;
    let bosses = 0;
    while (run.phase !== 'victory') {
      expect(run.phase).toBe('map');
      const lanes = availableLanes(plan, run);
      expect(lanes.length).toBeGreaterThan(0);
      const combat = lanes.find((lane) => nodeAt(plan, run.row, lane).floor) ?? lanes[0]!;
      const wasBoss = nodeAt(plan, run.row, combat).kind === 'boss';
      run = chooseNode(run, plan, combat);
      run = clearRoom(run, plan);
      if (wasBoss) bosses++;
      expect(run.score).toBeGreaterThanOrEqual(previousScore);
      previousScore = run.score;
      if (run.phase === 'map' && isBossRow(run.row, plan.length)) expect(availableLanes(plan, run)).toEqual([1]);
    }
    expect(run.cleared).toBe(plan.length);
    expect(run.path).toHaveLength(plan.length);
    expect(run.bossesDown).toBe(bosses);
    expect(run.boons.length).toBeGreaterThan(0);
  });

  it('opens the antechamber shop before every boss row', () => {
    const plan = generateRun('RIFT-ANTE');
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    for (let row = 0; row < 8; row++) run = clearRoom(chooseNode(run, plan, availableLanes(plan, run)[0]!), plan);
    run = chooseNode(run, plan, availableLanes(plan, run)[0]!);
    for (let guard = 0; guard < 10 && run.phase !== 'shop'; guard++) run = stepRoom(run, plan);
    expect(run.phase).toBe('shop');
    expect(run.shop!.antechamber).toBe(true);
    expect(run.row).toBe(9);
    run = leaveShop(run, plan);
    expect(run.phase).toBe('map');
    expect(availableLanes(plan, run)).toEqual([1]);
    expect(nodeAt(plan, 9, 1).kind).toBe('boss');
  });

  it('retries lost floors, replays draws, and ends at zero lives', () => {
    const plan = generateRun('RIFT-LOSS');
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    run = toFight(chooseNode(run, plan, 0));
    const lives = run.lives;
    run = resolveFloor(run, plan, 'lose');
    expect(run.phase).toBe('intro');
    expect(run.lives).toBe(lives - 1);
    run = resolveFloor(toFight(run), plan, 'draw');
    expect(run.phase).toBe('intro');
    expect(run.lives).toBe(lives - 1);
    for (let life = run.lives; life > 1; life--) run = resolveFloor(toFight(run), plan, 'lose');
    run = resolveFloor(toFight(run), plan, 'lose');
    expect(run.phase).toBe('gameover');
    expect(run.lives).toBe(0);
  });

  it('pays clears, KOs and flawless floors, then opens the door reward', () => {
    const plan = generateRun('RIFT-PAY');
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    const lane = availableLanes(plan, run)[0]!;
    const node = nodeAt(plan, 0, lane);
    run = toFight(chooseNode(run, plan, lane));
    const coins = run.coins;
    const done = resolveFloor(run, plan, 'win', { flawless: true, kos: 2, defiancesUsed: 0 });
    expect(done.kos).toBe(2);
    expect(done.flawless).toBe(1);
    expect(done.score).toBe(scoreForFloor(plan, currentFloor(plan, run), runBuild(run)));
    expect(done.coins).toBeGreaterThanOrEqual(coins + COINS_PER_CLEAR + 2 * COINS_PER_KO + COINS_FLAWLESS);
    expect(done.consumables.length + (done.toast?.startsWith('overflow') ? 1 : 0)).toBeGreaterThanOrEqual(1);
    if (node.reward === 'boon' || node.reward === 'pom') {
      expect(done.phase).toBe('reward');
      expect(done.offers.length).toBeGreaterThan(0);
      if (node.reward === 'boon') for (const card of done.offers) expect(card.type === 'boon' && boonById(card.id).patron === node.patron || boonById(card.id).duo).toBeTruthy();
    } else {
      expect(done.phase).toBe('map');
    }
  });

  it('rerolls boon offers with the same rules and skips for coins', () => {
    const plan = generateRun('RIFT-REROLL');
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    const lane = [0, 1, 2].find((entry) => nodeAt(plan, 0, entry).reward === 'boon');
    expect(lane, 'seed RIFT-REROLL needs a boon door on row 0').toBeDefined();
    run = resolveFloor(toFight(chooseNode(run, plan, lane!)), plan, 'win', win);
    expect(run.phase).toBe('reward');
    expect(() => rerollOffers({ ...run, rerolls: 0 }, plan)).toThrow();
    const rerolled = rerollOffers({ ...run, rerolls: 2 }, plan);
    expect(rerolled.rerolls).toBe(1);
    expect(rerolled.offerKey).not.toBe(run.offerKey);
    for (const card of rerolled.offers) expect(boonById(card.id).patron === nodeAt(plan, 0, lane!).patron || !!boonById(card.id).duo).toBe(true);
    const skipped = skipOffer(run, plan);
    expect(skipped.phase).toBe('map');
    expect(skipped.coins).toBe(run.coins + 20);
    expect(skipped.boons).toEqual(run.boons);
  });

  it('runs a shop: cards, pockets, heal, pom, purge, reroll, leave', () => {
    const plan = generateRun('RIFT-SHOP');
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    run = { ...run, row: 1, path: [0], phase: 'map', coins: 2000, lives: 1, boons: [{ id: 'ember-fury', rarity: 'common', level: 1 }] };
    // Force a shop room: rewrite the node kind on a copy of the plan.
    const shopPlan: GeneratedRun = { ...plan, map: plan.map.map((nodes, row) => nodes.map((node) => (row === 1 ? { ...node, kind: 'shop', floor: null, reward: null, patron: null, event: null } : node))) };
    run = chooseNode(run, shopPlan, availableLanes(shopPlan, run)[0]!);
    expect(run.phase).toBe('shop');
    expect(run.shop!.antechamber).toBe(false);
    expect(run.shop!.cards).toHaveLength(3);
    const card = run.shop!.cards[0]!;
    let next = buyShopCard(run, 0);
    expect(next.coins).toBe(run.coins - shopPrice(card));
    expect(next.shop!.cards[0]).toBeNull();
    expect(() => buyShopCard(next, 0)).toThrow();
    next = buyShopPocket(next, 0);
    expect(next.consumables).toHaveLength(1);
    next = buyHeal(next);
    expect(next.lives).toBe(2);
    expect(() => buyHeal(next)).toThrow();
    next = buyPom(next, shopPlan);
    expect(next.phase).toBe('reward');
    expect(next.offerSource).toBe('shop-pom');
    next = pickOffer(next, shopPlan, 0);
    expect(next.phase).toBe('shop');
    expect(() => buyPom(next, shopPlan)).toThrow();
    next = buyRemoval(next);
    const refund = skipOffer(next, shopPlan);
    expect(refund.phase).toBe('shop');
    expect(refund.shop!.removed).toBe(false);
    next = rerollShop(refund, shopPlan);
    expect(next.shop!.rerolled).toBe(true);
    expect(() => rerollShop(next, shopPlan)).toThrow();
    expect(() => buyShopCard({ ...next, coins: 0 }, 1)).toThrow();
    next = leaveShop(next, shopPlan);
    expect(next.phase).toBe('map');
    expect(next.row).toBe(2);
    expect(removeConsumable(next, next.consumables[0]!).consumables).toHaveLength(0);
  });

  it('rests for a life or tempers a boon', () => {
    const plan = generateRun('RIFT-REST');
    const restPlan: GeneratedRun = { ...plan, map: plan.map.map((nodes, row) => nodes.map((node) => (row === 2 ? { ...node, kind: 'rest', floor: null, reward: null, patron: null, event: null } : node))) };
    let run = pickBlessing(createRun(restPlan), restPlan, createRun(restPlan).blessings[0]!);
    run = { ...run, row: 2, path: [0, 0], phase: 'map', lives: 1, boons: [] };
    run = chooseNode(run, restPlan, availableLanes(restPlan, run)[0]!);
    expect(run.phase).toBe('rest');
    expect(() => restTemper(run, restPlan)).toThrow();
    const healed = restHeal(run, restPlan);
    expect(healed.lives).toBe(2);
    const full = restHeal({ ...run, lives: run.maxLives }, restPlan);
    expect(full.maxLives).toBe(run.maxLives + 1);
    const tempered = restTemper({ ...run, boons: [{ id: 'hunt-aim', rarity: 'rare', level: 2 }] }, restPlan);
    expect(tempered.phase).toBe('reward');
    const upgraded = pickOffer(tempered, restPlan, 0);
    expect(upgraded.boons[0]!.level).toBe(3);
    expect(upgraded.phase).toBe('map');
    expect(upgraded.row).toBe(3);
  });

  it('settles events with costs, pending curses and offers', () => {
    const plan = generateRun('RIFT-EVENTS');
    const eventPlan = (id: string): GeneratedRun => ({ ...plan, map: plan.map.map((nodes, row) => nodes.map((node) => (row === 1 ? { ...node, kind: 'event', floor: null, reward: null, patron: null, event: id as never } : node))) });
    const enter = (id: string, patch: Partial<RogueRun> = {}): [RogueRun, GeneratedRun] => {
      const p = eventPlan(id);
      let run = pickBlessing(createRun(p), p, createRun(p).blessings[0]!);
      run = { ...run, row: 1, path: [0], phase: 'map', ...patch };
      return [chooseNode(run, p, availableLanes(p, run)[0]!), p];
    };
    // Golden Trophy: coins now, a cursed next fight.
    let [run, p] = enter('trophy', { coins: 0 });
    run = chooseEventOption(run, p, 'take');
    expect(run.coins).toBe(160);
    expect(run.pending).toHaveLength(1);
    expect(run.pending[0]).toMatchObject({ levelShift: 1, affixes: ['enraged'], fights: 1 });
    expect(() => chooseEventOption(run, p, 'take')).toThrow();
    run = leaveEvent(run, p);
    expect(run.phase).toBe('map');
    // Well of Charon: can't afford → unavailable.
    [run, p] = enter('charon-well', { coins: 10, lives: 1 });
    expect(eventOptionAvailable(run, 'toss')).toBe(false);
    expect(eventOptionAvailable(run, 'dive')).toBe(false);
    expect(() => chooseEventOption(run, p, 'toss')).toThrow();
    // Blood Altar: max life for an epic offer.
    [run, p] = enter('blood-altar', { maxLives: 5, lives: 5 });
    run = chooseEventOption(run, p, 'offer');
    expect(run.maxLives).toBe(4);
    expect(run.lives).toBe(4);
    expect(run.phase).toBe('reward');
    expect(run.offers.every((card) => card.type === 'boon' && (card.rarity === 'epic' || card.rarity === 'legendary'))).toBe(true);
    run = pickOffer(run, p, 0);
    expect(run.phase).toBe('map');
    // Sparring: purge pays 60.
    [run, p] = enter('sparring', { coins: 0, boons: [{ id: 'chaos-glass', rarity: 'common', level: 1 }] });
    run = chooseEventOption(run, p, 'meditate');
    run = pickOffer(run, p, 0);
    expect(run.boons).toHaveLength(0);
    expect(run.coins).toBe(60);
    // Echo: the next fight gets a mirror and an upgraded reward.
    [run, p] = enter('echo');
    run = chooseEventOption(run, p, 'face');
    expect(run.pending[0]).toMatchObject({ mirror: true, rewardBump: true, scoreBonus: 200 });
    // Pending curses tick down on wins.
    run = leaveEvent(run, p);
    const lane = availableLanes(p, run).find((entry) => nodeAt(p, run.row, entry).floor);
    if (lane !== undefined) {
      run = resolveFloor(toFight(chooseNode(run, p, lane)), p, 'win', win);
      expect(run.pending).toHaveLength(0);
    }
    // Chaos Gate: pacts only.
    [run, p] = enter('chaos-gate');
    run = chooseEventOption(run, p, 'enter');
    expect(run.offers.every((card) => boonById(card.id).patron === 'chaos')).toBe(true);
    expect(advance({ ...run, phase: 'event' }, p).row).toBe(2);
  });

  it('attaches relics, aspects and champion perks to a run', () => {
    const plan = generateRun('RIFT-LOADOUT');
    const plain = createRun(plan);
    const run = createRun(plan, undefined, {
      relics: [{ id: 'lucky-coin', level: 2 }, { id: 'ledger', level: 3 }, { id: 'harpy-feather', level: 3 }, { id: 'phoenix-heart', level: 2 }, { id: 'chaos-shard', level: 3 }, { id: 'wanderer-map', level: 1 }, { id: 'compass', level: 2 }],
      aspect: { id: 'bastion', level: 2 },
      championRank: 7,
      perks: { rerolls: 1, coins: 40, lives: 1 },
    });
    expect(run.coins).toBe(plain.coins + 110 + 40);
    expect(run.priceMul).toBeCloseTo(0.7, 6);
    expect(run.pockets).toBe(plain.pockets + 1);
    expect(run.consumables).toEqual(['feather', 'feather']);
    expect(run.defiances).toBe(1);
    expect(run.lives).toBe(plain.lives + 2);
    expect(run.rerolls).toBe(plain.rerolls + 1 + 1 + 1);
    expect(run.luck).toBeCloseTo(0.1, 6);
    expect(run.boons).toHaveLength(1);
    expect(boonById(run.boons[0]!.id).patron).toBe('chaos');
    expect(run.boons[0]!.rarity).toBe('epic');
    expect(run.phase).toBe('blessing');
    expect(run.championRank).toBe(7);
    const build = runBuild({ ...run, boons: [] });
    expect(build.player.damageTakenMul).toBeCloseTo(0.86, 6);
    expect(build.player.speedMul).toBeCloseTo(0.96, 6);
    expect(runPrice(run, 100)).toBe(70);
  });

  it('raises shop prices by 25% per act and restocks exhausted boon shelves with poms', () => {
    expect([0, 9, 10, 25, 39, 49].map((row) => runPrice({ priceMul: 1, row }, 100))).toEqual([100, 100, 125, 150, 175, 200]);
    const plan = generateRun('RIFT-LATE-SHOP');
    const shopPlan: GeneratedRun = { ...plan, map: plan.map.map((nodes, row) => nodes.map((node) => (row === 1 ? { ...node, kind: 'shop', floor: null, reward: null, patron: null, event: null } : node))) };
    let run = pickBlessing(createRun(shopPlan), shopPlan, createRun(shopPlan).blessings[0]!);
    run = clearRoom(chooseNode(run, shopPlan, availableLanes(shopPlan, run)[0]!), shopPlan);
    // Every boon already owned: the three boon shelves can only restock as poms.
    run = { ...run, boons: BOON_POOL.map((boon) => ({ id: boon.id, rarity: 'common' as const, level: 1 })) };
    run = chooseNode(run, shopPlan, availableLanes(shopPlan, run)[0]!);
    expect(run.phase).toBe('shop');
    expect(run.shop!.cards).toHaveLength(3);
    expect(run.shop!.cards.every((card) => card?.type === 'pom')).toBe(true);
  });

  it('tracks fights, elites, events and coins spent for the meta layer', () => {
    const plan = generateRun('RIFT-STATS');
    const shopPlan: GeneratedRun = { ...plan, map: plan.map.map((nodes, row) => nodes.map((node) => (row === 1 ? { ...node, kind: 'shop', floor: null, reward: null, patron: null, event: null } : row === 2 ? { ...node, kind: 'event', floor: null, reward: null, patron: null, event: 'hat' } : node))) };
    let run = pickBlessing(createRun(shopPlan), shopPlan, createRun(shopPlan).blessings[0]!);
    run = { ...run, priceMul: 0.5, coins: 500 };
    run = resolveFloor(toFight(chooseNode(run, shopPlan, 0)), shopPlan, 'win', win);
    expect(run.fightsWon).toBe(1);
    run = clearRoom(run, shopPlan);
    run = chooseNode(run, shopPlan, availableLanes(shopPlan, run)[0]!);
    const coins = run.coins;
    run = buyHeal({ ...run, lives: 1 });
    expect(coins - run.coins).toBe(60);
    expect(run.coinsSpent).toBe(60);
    run = leaveShop(run, shopPlan);
    run = chooseNode(run, shopPlan, availableLanes(shopPlan, run)[0]!);
    expect(run.eventsVisited).toBe(1);
  });

  it('pays boss spoils: bounty, full heal, a treasure, then an EPIC boon', () => {
    const plan = generateRun('RIFT-SPOILS');
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    run = { ...run, row: 9, path: [0, 0, 0, 0, 0, 0, 0, 0, 0], phase: 'map', lives: 1, coins: 0, boons: [{ id: 'ember-fury', rarity: 'common', level: 1 }] };
    run = toFight(chooseNode(run, plan, 1));
    const won = resolveFloor(run, plan, 'win', win);
    expect(won.phase).toBe('spoils');
    expect(won.spoils).toHaveLength(3);
    expect(won.lives).toBe(won.maxLives);
    expect(won.maxLives).toBe(run.maxLives + 1);
    expect(won.coins).toBeGreaterThanOrEqual(75);
    expect(won.bossesDown).toBe(1);
    expect(() => pickSpoil(won, plan, 'nope' as never)).toThrow();
    const blessed = pickSpoil({ ...won, spoils: ['patron-blessing', 'titan-heart', 'golden-idol'] }, plan, 'patron-blessing');
    expect(blessed.treasures).toEqual(['patron-blessing']);
    expect(blessed.boons[0]!.level).toBe(2);
    expect(blessed.phase).toBe('reward');
    expect(blessed.offers.every((card) => card.type === 'boon' && (card.rarity === 'epic' || card.rarity === 'legendary'))).toBe(true);
    const hearty = pickSpoil({ ...won, spoils: ['titan-heart'] }, plan, 'titan-heart');
    expect(hearty.maxLives).toBe(won.maxLives + 2);
    expect(hearty.lives).toBe(hearty.maxLives);
    const idol = pickSpoil({ ...won, spoils: ['golden-idol'] }, plan, 'golden-idol');
    expect(idol.coinMul).toBe(1.5);
    expect(runPrice(idol, 100)).toBe(75);
    const edge = pickSpoil({ ...won, spoils: ['executioner-edge'] }, plan, 'executioner-edge');
    expect(runBuild(edge).player.damageDealtMul).toBeCloseTo(1.1 * 1.3, 6);
    const next = pickOffer(blessed, plan, 0);
    expect(next.phase).toBe('map');
    expect(next.row).toBe(10);
  });

  it('consumes run-wide defiances used in a fight', () => {
    const plan = generateRun('RIFT-DEFY');
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    run = toFight(chooseNode({ ...run, defiances: 2 }, plan, 0));
    const lost = resolveFloor(run, plan, 'lose', { flawless: false, kos: 0, defiancesUsed: 1 });
    expect(lost.defiances).toBe(1);
  });

  it('takes Hearty Stew lives back on removal and never crashes Chaos Seed next to a Chaos Shard', () => {
    const plan = generateRun('RIFT-STEW');
    let run = pickBlessing(createRun(plan), plan, createRun(plan).blessings[0]!);
    run = { ...run, coins: 999, shop: { cards: [{ type: 'boon', id: 'rift-heart', rarity: 'common' }, null, null], pockets: [null, null], rerolled: false, healed: false, removed: false, pomBought: false, antechamber: false }, phase: 'shop' };
    const before = { lives: run.lives, maxLives: run.maxLives };
    run = buyShopCard(run, 0);
    expect(run.lives).toBe(before.lives + 1);
    expect(run.maxLives).toBe(before.maxLives + 1);
    run = buyRemoval(run);
    run = pickOffer(run, plan, run.offers.findIndex((card) => card.id === 'rift-heart'));
    expect(run.lives).toBe(before.lives);
    expect(run.maxLives).toBe(before.maxLives);
    for (let seed = 0; seed < 160; seed++) {
      const seeded = generateRun(`RIFT-SEED-${seed}`);
      const fresh = createRun(seeded, undefined, { relics: [{ id: 'chaos-shard', level: 2 }], aspect: null, championRank: 1, perks: { rerolls: 0, coins: 0, lives: 0 } });
      expect(() => pickBlessing({ ...fresh, blessings: ['chaos-seed'] }, seeded, 'chaos-seed')).not.toThrow();
    }
  });
});
