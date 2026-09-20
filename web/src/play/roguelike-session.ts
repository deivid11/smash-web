/** Roguelike web controller: drives the existing `GameSession` in
 * `web/src/play/game-session.ts` through a generated descent map using its
 * public API (`setSeat`, `setRules`, `reset`, `match`, `publishHud`,
 * `eventTaps`). Online play is untouched (runs keep `mode` at `solo` and never
 * attach an `onlineStep`). Fights resolve by reading the finished `LocalMatch`
 * in `lib/game/match.ts` (`winner` at dense slot 0 = the human).
 *
 * Presentation extras live here too: combat popups and boss phase-two are
 * derived from confirmed match events through `session.eventTaps`, so the
 * simulation never learns about the HUD.
 */
import { applyFloorToMatch, floorSetupFor, type FloorSetup } from '../../../lib/game/roguelike/apply.ts';
import { ACE_ENEMY_FALLBACKS, generateRun, type FloorPlan, type GeneratedRun, type MapNode, type RogueDifficulty, type RogueHeat, type RogueRunLength } from '../../../lib/game/roguelike/generator.ts';
import { applyConsumable, consumableById, type ConsumableId } from '../../../lib/game/roguelike/consumables.ts';
import { championRecord, loadMeta, metaBonuses, recordRunInMeta, relicSlots, saveMeta, type BlessingId, type RogueMeta, type RunReport } from '../../../lib/game/roguelike/meta.ts';
import { aspectById, championPerks, masteryRank, relicLevel, type AspectId, type RelicId } from '../../../lib/game/roguelike/unlocks.ts';
import { treasureStocks, type TreasureId } from '../../../lib/game/roguelike/bosses.ts';
import {
  availableLanes, buyHeal, buyPom, buyRemoval, buyShopCard, buyShopPocket, chooseEventOption, chooseNode, createRun,
  currentFloor, currentNode, leaveEvent, leaveShop, pickBlessing, pickOffer, recordBest, removeConsumable, rerollOffers,
  pickSpoil, rerollShop, resolveFloor, restHeal, restTemper, runBuild, skipOffer, toFight, COINS_PER_KO,
  type FloorOutcome, type RogueBest, type RogueRun,
} from '../../../lib/game/roguelike/run-state.ts';
import { randomSeedLabel } from '../../../lib/game/roguelike/seed.ts';
import { planForRun, saveSuspendedRun, type SuspendedRun } from '../../../lib/game/roguelike/suspend.ts';
import type { BoonState } from '../../../lib/game/roguelike/boons.ts';
import type { FighterKind } from '../../../lib/game/data.ts';
import type { LocalMatch, MatchEvent } from '../../../lib/game/match.ts';
import { Store } from './store.ts';
import { fxText, rogueLocale } from './roguelike-text.ts';
import type { EndedRun } from '../account/game-report.ts';
import type { GameSession } from './game-session.ts';

export interface RogueSettings {
  fighter: FighterKind;
  seedLabel: string;
  length: RogueRunLength;
  difficulty: RogueDifficulty;
  heat: RogueHeat;
  /** Equipped relics (validated against unlocks and slots). */
  relics?: RelicId[];
  /** The champion's aspect (validated against mastery rank). */
  aspect?: AspectId;
}

export function newRandomSeedLabel(): string {
  return randomSeedLabel();
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** Browser-test hook, only with ?rogueDebug in the URL: lets specs inspect and grant builds. */
const rogueDebug = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('rogueDebug');

export type PopupTone = 'crit' | 'chain' | 'doom' | 'defy' | 'thorns' | 'clap' | 'jolt' | 'heal' | 'pocket' | 'coins' | 'enrage';
export interface RoguePopup {
  id: number;
  /** World position (projected by the HUD each frame it renders). */
  x: number;
  y: number;
  text: string;
  tone: PopupTone;
  born: number;
}
export interface RogueFxView {
  popups: RoguePopup[];
  /** Short banner (boss enrage, last stand) with its expiry time. */
  banner: { text: string; tone: PopupTone; until: number } | null;
  /** Dense slots of enraged bosses. */
  enraged: number[];
  /** Coins earned from KOs this fight (live counter). */
  koCoins: number;
}

const POPUP_LIFE = 1100;
const MAX_POPUPS = 24;
let popupSerial = 0;

interface LiveFight {
  setup: FloorSetup;
  floor: FloorPlan;
  /** Last Stands handed to the player at start (per-floor + run-wide). */
  standsGiven: number;
  /** Phoenix Feathers used mid-fight (added stands, consumed first). */
  feathers: number;
  bossSlots: number[];
}

const runFinishedListeners = new Set<(run: EndedRun) => void>();
/** Every finished descent (victory, defeat or abandon); the account client records it as a game. */
export function onRunFinished(listener: (run: EndedRun) => void): () => void { runFinishedListeners.add(listener); return () => runFinishedListeners.delete(listener); }

export class RogueController {
  plan: GeneratedRun;
  run: RogueRun;
  meta: RogueMeta;
  lastOutcome: FloorOutcome | null = null;
  floorError = '';
  best: RogueBest | null = null;
  shardsEarned: number | null = null;
  /** End-of-run meta report: keys, mastery, relic levels, new unlocks. */
  report: RunReport | null = null;
  readonly fx = new Store<RogueFxView>({ popups: [], banner: null, enraged: [], koCoins: 0 });
  private fight: LiveFight | null = null;
  private detach: (() => void) | null = null;

  /** Continue a descent saved by `saveSuspendedRun` (null when its map no longer generates). */
  static resume(saved: SuspendedRun): RogueController | null {
    const plan = planForRun(saved.run);
    if (!plan) return null;
    return new RogueController({ fighter: plan.playerFighter, seedLabel: plan.seedLabel, length: plan.length, difficulty: plan.difficulty, heat: plan.heat }, { plan, run: saved.run });
  }

  constructor(settings: RogueSettings, restore?: { plan: GeneratedRun; run: RogueRun }) {
    if (restore) {
      this.plan = restore.plan;
      this.meta = loadMeta();
      this.run = restore.run;
      if (rogueDebug()) (globalThis as { smashRogueDebug?: unknown }).smashRogueDebug = { controller: this, session: null };
      return;
    }
    const seedLabel = settings.seedLabel.trim() || randomSeedLabel();
    this.plan = generateRun(seedLabel, {
      length: settings.length,
      difficulty: settings.difficulty,
      playerFighter: settings.fighter,
      heat: settings.heat,
    });
    // Permanent unlocks: only unlocked relics fit, up to the satchel's slots;
    // the aspect must be unlocked for this champion's mastery rank.
    let meta = loadMeta();
    const relics = [...new Set(settings.relics ?? meta.loadout)].filter((id) => meta.unlocked.includes(id)).slice(0, relicSlots(meta));
    const record = championRecord(meta, settings.fighter);
    const rank = masteryRank(record.xp);
    const wanted = settings.aspect ?? record.aspect;
    const aspect = aspectById(wanted).rank <= rank ? wanted : 'vanguard';
    const perks = championPerks(rank);
    meta = { ...meta, loadout: relics, champions: { ...meta.champions, [settings.fighter]: { ...record, aspect } } };
    saveMeta(meta);
    this.meta = meta;
    this.run = createRun(this.plan, metaBonuses(meta), {
      relics: relics.map((id) => ({ id, level: relicLevel(meta.relicXp[id] ?? 0) })),
      aspect: { id: aspect, level: perks.aspectLevel },
      championRank: rank,
      perks: { rerolls: perks.rerolls, coins: perks.coins, lives: perks.lives },
    });
    saveSuspendedRun(this.run);
    if (rogueDebug()) (globalThis as { smashRogueDebug?: unknown }).smashRogueDebug = { controller: this, session: null };
  }

  get node(): MapNode | null {
    return currentNode(this.plan, this.run);
  }
  get floor(): FloorPlan {
    return currentFloor(this.plan, this.run);
  }
  get build(): BoonState {
    return runBuild(this.run);
  }
  get lanes(): number[] {
    return this.run.phase === 'map' ? availableLanes(this.plan, this.run) : [];
  }
  get active(): boolean {
    return this.run.phase !== 'victory' && this.run.phase !== 'gameover';
  }
  get inFight(): boolean {
    return this.run.phase === 'fight';
  }
  /** Fielded foes of the live fight (after ACE fallbacks), in dense seat order. */
  get foes(): FloorSetup['foes'] {
    return this.fight?.setup.foes ?? [];
  }
  /** Affixes in force for the current combat room (floor gifts + event curses). */
  get affixes(): FloorSetup['affixes'] {
    if (this.fight) return this.fight.setup.affixes;
    const floor = this.node?.floor;
    if (!floor) return [];
    return [...new Set([...floor.affixes, ...this.run.pending.flatMap((entry) => entry.affixes)])];
  }

  private step(next: RogueRun): void {
    this.run = next;
    this.floorError = '';
    // Save & quit: every settled step is resumable; a finished run clears the save.
    saveSuspendedRun(next);
    if (!this.active && this.shardsEarned === null) this.finish();
  }
  private finish(): void {
    this.best = recordBest(this.run);
    const run = this.run;
    const report = recordRunInMeta(loadMeta(), {
      fighter: run.playerFighter, cleared: run.cleared, bossesDown: run.bossesDown, elitesDown: run.elitesDown,
      fightsWon: run.fightsWon, eventsVisited: run.eventsVisited, coinsSpent: run.coinsSpent,
      victory: run.phase === 'victory', heat: run.heat, boonIds: run.boons.map((boon) => boon.id), relics: run.relics.map((relic) => relic.id),
    });
    saveMeta(report.meta);
    this.meta = report.meta;
    this.report = report;
    this.shardsEarned = report.earned;
    const ended: EndedRun = { fighter: run.playerFighter, victory: run.phase === 'victory', cleared: run.cleared, length: run.length, bossesDown: run.bossesDown, fightsWon: run.fightsWon, heat: run.heat, score: run.score, seconds: 0 };
    for (const listener of runFinishedListeners) { try { listener(ended); } catch (error) { console.warn('Run-finished listener failed:', error); } }
  }

  pickBlessing(id: BlessingId): void { this.step(pickBlessing(this.run, this.plan, id)); }
  chooseNode(lane: number): void { this.step(chooseNode(this.run, this.plan, lane)); }
  pickOffer(index: number): void { this.step(pickOffer(this.run, this.plan, index)); }
  skipOffer(): void { this.step(skipOffer(this.run, this.plan)); }
  reroll(): void { this.step(rerollOffers(this.run, this.plan)); }
  restHeal(): void { this.step(restHeal(this.run, this.plan)); }
  restTemper(): void { this.step(restTemper(this.run, this.plan)); }
  eventOption(id: string): void { this.step(chooseEventOption(this.run, this.plan, id)); }
  leaveEvent(): void { this.step(leaveEvent(this.run, this.plan)); }
  pickSpoil(id: TreasureId): void { this.step(pickSpoil(this.run, this.plan, id)); }
  buyShopCard(index: number): void { this.step(buyShopCard(this.run, index)); }
  buyShopPocket(index: number): void { this.step(buyShopPocket(this.run, index)); }
  buyHeal(): void { this.step(buyHeal(this.run)); }
  buyPom(): void { this.step(buyPom(this.run, this.plan)); }
  buyRemoval(): void { this.step(buyRemoval(this.run)); }
  rerollShop(): void { this.step(rerollShop(this.run, this.plan)); }
  leaveShop(): void { this.step(leaveShop(this.run, this.plan)); }
  /** Abandon counts as a loss for the Mirror (shards for progress so far). */
  abandon(): void {
    if (!this.active) return;
    this.step({ ...this.run, phase: 'gameover', lives: 0 });
  }

  /** Configure seats/rules from the plan and start the floor's match.
   * Returns false and records `floorError` when assets are not ready yet.
   * When the session defers the start to download a fighter/stage, the floor
   * is applied to the real match the moment it begins (never to the old one). */
  startFloor(session: GameSession): boolean {
    const view = session.ui.getSnapshot();
    if (!view.ready || view.loading || !!view.error || session.online) {
      this.floorError = view.error || 'Original assets are still loading. Wait for READY, then fight.';
      return false;
    }
    const floor = this.floor;
    // ACE extension fighters (Giga Bowser, ACE rivals) only exist when the source carries their files.
    const files = session.source?.info.files ?? [];
    const available = (kind: string): boolean => (kind !== 'Gk' && !(kind in ACE_ENEMY_FALLBACKS)) || files.some((file) => file.path === `Pl${kind}.dat`);
    const setup = floorSetupFor(floor, this.build, this.run.playerFighter, { pending: this.run.pending, defiances: this.run.defiances, available, bonusStocks: treasureStocks(this.run.treasures) });
    try {
      const current = session.ui.getSnapshot().setup;
      for (const seat of setup.seats) {
        const existing = current.seats[seat.slot];
        if (!existing || existing.fighter !== seat.fighter || existing.control !== seat.control || existing.level !== seat.level) {
          session.setSeat(seat.slot, { fighter: seat.fighter, control: seat.control, level: seat.level });
        }
      }
      const rules = session.ui.getSnapshot().setup;
      if (rules.stage !== setup.stage || rules.stocks !== setup.stocks || rules.seconds !== setup.seconds || rules.hill || rules.teams) {
        session.setRules({ stage: setup.stage, stocks: setup.stocks, seconds: setup.seconds, hill: null, teams: false });
      }
      this.release();
      this.run = toFight(this.run);
      this.fightMatch = null;
      const before = session.match;
      session.reset(true);
      if (!session.match || session.match === before || !session.ui.getSnapshot().active) {
        // Deferred start: wait for the fresh match instead of touching the old one.
        this.preparing = true;
        const unsubscribe = session.ui.subscribe(() => {
          const next = session.match;
          if (!session.ui.getSnapshot().active || !next || next === before) return;
          unsubscribe();
          this.stopWaiting = null;
          this.preparing = false;
          this.beginFight(session, next, setup, floor);
        });
        this.stopWaiting = unsubscribe;
        this.floorError = '';
        this.lastOutcome = null;
        return true;
      }
      this.beginFight(session, session.match, setup, floor);
      this.floorError = '';
      this.lastOutcome = null;
      return true;
    } catch (error) {
      if (this.run.phase === 'fight') this.run = { ...this.run, phase: 'intro' };
      this.floorError = errorText(error);
      return false;
    }
  }

  /** The deferred-start banner: true while the session downloads floor assets. */
  preparing = false;
  private fightMatch: LocalMatch | null = null;
  private stopWaiting: (() => void) | null = null;
  private stopWatching: (() => void) | null = null;

  private beginFight(session: GameSession, match: LocalMatch, setup: FloorSetup, floor: FloorPlan): void {
    this.stopWatching?.();
    applyFloorToMatch(match, setup, floor);
    session.publishHud();
    // Solo start() unlocks the in-game SFX bus and the stage track; the
    // rogue floor entry must do the same or fights stay music-only.
    void session.audio.unlock();
    const stage = match.content.stageId ?? setup.stage;
    // Stage tracks decode on demand (MenuAudio no longer prepares every track at boot).
    if (session.menu) void session.menu.setMusic(stage);
    this.fightMatch = match;
    this.fight = {
      setup, floor,
      standsGiven: setup.playerMods.lastStand,
      feathers: 0,
      bossSlots: floor.kind === 'boss' ? match.fighters.map((_, slot) => slot).filter((slot) => slot > 0) : [],
    };
    this.fx.set({ popups: [], banner: null, enraged: [], koCoins: 0 });
    this.attach(session);
    // Rematch from the pause menu restarts the same floor: re-bind its rules.
    this.stopWatching = session.ui.subscribe(() => {
      const next = session.match;
      if (this.run.phase !== 'fight' || !next || next === this.fightMatch || !session.ui.getSnapshot().active) return;
      this.beginFight(session, next, setup, floor);
    });
  }

  /** Read a finished match once. Returns null unless the run is mid-fight. */
  resolveMatch(session: GameSession): FloorOutcome | null {
    if (this.run.phase !== 'fight') return null;
    const match = session.match;
    // Only the match this floor actually started can settle it (a deferred
    // start leaves the previous, already-ended match in place for a while).
    if (!match || match !== this.fightMatch) return null;
    let outcome: FloorOutcome = 'lose';
    if (match) {
      if (match.winner === 0) outcome = 'win';
      else if (match.winner === null) outcome = (match.fighters[0]?.stocks ?? 0) > 0 ? 'draw' : 'lose';
    }
    const player = match?.fighters[0];
    const fight = this.fight;
    const remaining = player?.rogue.lastStand ?? 0;
    const used = fight ? Math.max(0, fight.standsGiven + fight.feathers - remaining) : 0;
    const defiancesUsed = fight ? Math.max(0, Math.min(this.run.defiances, used - fight.feathers - fight.setup.floorStands)) : 0;
    this.lastOutcome = outcome;
    this.step(resolveFloor(this.run, this.plan, outcome, {
      flawless: outcome === 'win' && (player?.falls ?? 1) === 0,
      kos: player?.kos ?? 0,
      defiancesUsed,
    }));
    this.release();
    return outcome;
  }

  /** Real-time pocket use: plain-number relief, no engine calls. */
  useConsumable(session: GameSession, id: ConsumableId): void {
    if (this.run.phase !== 'fight') throw new Error('Consumables work mid-fight.');
    const match = session.match;
    if (!match || match.fighters.length < 1 || match.phase !== 'playing') throw new Error('No live match.');
    const def = consumableById(id);
    const player = match.fighters[0]!;
    if (player.state === 'ko') throw new Error('Wait for your respawn.');
    applyConsumable({ player, foes: match.fighters.slice(1), stockCap: this.floor.playerStocks + this.build.bonusStocks + treasureStocks(this.run.treasures) }, id);
    if (id === 'feather' && this.fight) this.fight.feathers++;
    this.run = removeConsumable(this.run, id);
    this.popup(player.x, player.y + 18, `${def.icon} ${id === 'draught' ? '−60%' : id === 'smoke' ? '+25%' : id === 'star' ? '+1 ●' : id === 'feather' ? '✝' : '+12%'}`, id === 'draught' || id === 'star' || id === 'feather' ? 'heal' : 'pocket');
    session.publishHud();
    this.floorError = '';
  }

  /** Stop listening to match events (fight over, run left, app unmounted). */
  release(): void {
    this.detach?.();
    this.detach = null;
    this.stopWaiting?.();
    this.stopWaiting = null;
    this.stopWatching?.();
    this.stopWatching = null;
    this.preparing = false;
    this.fight = null;
    this.fightMatch = null;
  }

  private attach(session: GameSession): void {
    this.detach?.();
    const tap = (events: readonly MatchEvent[], match: LocalMatch): void => this.onEvents(events, match);
    session.eventTaps.add(tap);
    if (rogueDebug()) (globalThis as { smashRogueDebug?: unknown }).smashRogueDebug = { controller: this, session };
    this.detach = () => { session.eventTaps.delete(tap); };
  }

  private popup(x: number, y: number, text: string, tone: PopupTone): void {
    const now = performance.now();
    const view = this.fx.getSnapshot();
    const popups = [...view.popups.filter((entry) => now - entry.born < POPUP_LIFE), { id: ++popupSerial, x, y, text, tone, born: now }].slice(-MAX_POPUPS);
    this.fx.set({ ...view, popups });
  }
  private banner(text: string, tone: PopupTone, ms = 1600): void {
    this.fx.set({ ...this.fx.getSnapshot(), banner: { text, tone, until: performance.now() + ms } });
  }

  private onEvents(events: readonly MatchEvent[], match: LocalMatch): void {
    const fight = this.fight;
    if (!fight || this.run.phase !== 'fight') return;
    const locale = rogueLocale.getSnapshot();
    for (const event of events) {
      if (event.type === 'rogue') {
        const amount = Math.round(event.damage ?? 0);
        switch (event.rogue) {
          case 'crit': this.popup(event.x, event.y + 14, `${fxText('crit', locale)} ${amount}%`, 'crit'); break;
          case 'chain': this.popup(event.x, event.y + 10, `⚡${amount}%`, 'chain'); break;
          case 'doom': this.popup(event.x, event.y + 12, `☄️ ${amount}%`, 'doom'); break;
          case 'thorns': this.popup(event.x, event.y + 10, `🌵${amount}%`, 'thorns'); break;
          case 'clap': this.popup(event.x, event.y + 10, `🌩${amount}%`, 'clap'); break;
          case 'jolt': this.popup(event.x, event.y + 16, `🔋 ${fxText('jolt', locale)}`, 'jolt'); break;
          case 'defy':
            this.popup(event.x, event.y, `✝ ${fxText('lastStand', locale)}`, 'defy');
            this.banner(`✝ ${fxText(event.player === 0 ? 'standKept' : 'rivalDefies', locale)}`, 'defy');
            break;
        }
      } else if (event.type === 'ko' && event.player > 0) {
        const victim = match.fighters[event.player];
        const player = match.fighters[0];
        // KO coins are paid when the floor is cleared (Golden Idol doubles them).
        const koCoins = Math.round((player?.kos ?? 0) * (COINS_PER_KO + this.build.coinsPerKo) * (this.run.coinMul ?? 1));
        const before = this.fx.getSnapshot();
        if (player && koCoins > before.koCoins) {
          this.fx.set({ ...before, koCoins });
          this.popup(player.x, player.y + 26, `KO 🪙 ${fxText('koCoins', locale, String(koCoins - before.koCoins))}`, 'coins');
        }
        // Boss phase two: the last stock enrages (Hades bosses change form).
        if (fight.bossSlots.includes(event.player) && victim && victim.stocks === 1 && !this.fx.getSnapshot().enraged.includes(event.player)) {
          victim.rogue = {
            ...victim.rogue,
            damageDealtMul: victim.rogue.damageDealtMul * 1.2,
            speedMul: Math.min(1.45, victim.rogue.speedMul * 1.1),
            knockbackTakenMul: victim.rogue.knockbackTakenMul * 0.85,
          };
          const view = this.fx.getSnapshot();
          this.fx.set({ ...view, enraged: [...view.enraged, event.player] });
          this.banner(`⚠ ${fxText('enraged', locale, victim.content.profile.name.toUpperCase())}`, 'enrage', 2200);
        }
      }
    }
  }
}
