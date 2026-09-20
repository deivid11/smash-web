/** Tournament flow for both scopes. LOCAL brackets live on this device and their
 * sets run as ordinary local matches; LAN brackets live on the server and their
 * sets run in ordinary LAN rooms that this controller opens / joins for the two
 * players once both pressed READY in the set lobby (spectators watch the same
 * room). The controller outlives the screens: the arena and the LAN room unmount
 * them, and the set in flight must still be settled when the match ends.
 */
import {
  countReplay, reportWinner, simulateMatch, SeededRng,
  type BracketMatch, type CpuFill, type Entrant, type TournamentRules, type TournamentState,
} from '../../../../lib/game/tournament/bracket.ts';
import { CHECKIN_INTERVAL_MS, type SetLobby, type Side, type TournamentListResponse, type TournamentView } from '../../../../lib/net/tournament-protocol.ts';
import type { RoomFighter, RoomRules } from '../../../../lib/net/protocol.ts';
import { ROSTER_CHOICES } from '../../../../lib/game/roster.ts';
import { MENU_FIGHTER_ORDER } from '../../../../lib/game/roster.ts';
import { SUPPORTED_STAGES, type StageId } from '../../../../lib/game/stages.ts';
import type { FighterKind } from '../../../../lib/game/data.ts';
import { clampCpuLevel } from '../../../../lib/game/cpu.ts';
import type { AccountClient } from '../../account/account-client.ts';
import type { GameSession } from '../game-session.ts';
import type { OnlineSession } from '../online-session.ts';
import { Store } from '../store.ts';
import { deleteLocalTournament, loadLocalTournaments, newLocalTournament, saveLocalTournament } from './local-store.ts';
import { TournamentClient } from './tournament-client.ts';

export type Scope = 'local' | 'lan';
export type TournamentScreen = 'hub' | 'wizard' | 'bracket' | 'set' | 'champion';
export interface WizardInput { scope: Scope; name: string; rules: TournamentRules; fill: CpuFill; size?: number; /** Local: player names. LAN: account usernames. */ players: string[] }
/** The set being played right now (arena or LAN room on screen). */
export interface PlayingSet { scope: Scope; tournamentId: string; tournamentName: string; matchId: number; a: Entrant; b: Entrant; /** LAN: which side opened the room (room slot 0) and which side this browser plays. */ hostSide?: Side; mySide?: Side; sawActive: boolean }
export interface SetResult { tournamentId: string; matchId: number; winner: Entrant | null; loser: Entrant | null; final: boolean; note: string }
export interface TournamentUi {
  screen: TournamentScreen; scope: Scope;
  locals: TournamentState[]; local: TournamentState | null;
  lanList: TournamentListResponse | null; lan: TournamentView | null;
  matchId: number | null;
  /** Local VS screen picks. */
  picks: { a: FighterKind; b: FighterKind }; stage: StageId | 'random';
  /** LAN set lobby: my READY flag. */
  ready: boolean;
  playing: PlayingSet | null;
  result: SetResult | null;
  busy: boolean; error: string; note: string;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const asFighter = (kind: string | undefined, fallback: FighterKind): FighterKind => (MENU_FIGHTER_ORDER.find(entry => entry === kind) ?? fallback);
const randomFighter = (): FighterKind => MENU_FIGHTER_ORDER[(Math.random() * MENU_FIGHTER_ORDER.length) | 0]!;

export class TournamentController {
  readonly store: Store<TournamentUi>;
  readonly api: TournamentClient;
  private poll: ReturnType<typeof setInterval> | null = null;
  private offRoom: (() => void) | null = null;
  private hosting = false;
  private reported = '';
  /** A room this controller put on screen (set or spectate): when it goes away, the bracket comes back. */
  private sawRoom = false;
  private watching = false;
  private settling = false;
  private disposed = false;

  constructor(private readonly session: GameSession, private readonly online: OnlineSession, private readonly account: AccountClient, private readonly joinRoom: (code: string) => void) {
    this.api = new TournamentClient(account);
    this.store = new Store<TournamentUi>({ screen: 'hub', scope: 'local', locals: loadLocalTournaments(), local: null, lanList: null, lan: null, matchId: null, picks: { a: 'Fx', b: 'Mr' }, stage: 'random', ready: false, playing: null, result: null, busy: false, error: '', note: '' });
    this.offRoom = online.client.subscribe(() => this.roomChanged());
  }
  get ui(): TournamentUi { return this.store.getSnapshot(); }
  dispose(): void { this.disposed = true; this.stopPolling(); this.offRoom?.(); this.offRoom = null; this.store.clear(); }

  private async run<T>(action: () => Promise<T>): Promise<T | undefined> {
    this.store.update({ busy: true, error: '' });
    try { return await action(); }
    catch (error) { if (!this.disposed) this.store.update({ error: errorText(error) }); return undefined; }
    finally { if (!this.disposed) this.store.update({ busy: false }); }
  }

  // ——— Hub ———
  openHub(scope: Scope = this.ui.scope): void {
    this.stopPolling();
    this.store.update({ screen: 'hub', scope, locals: loadLocalTournaments(), local: null, lan: null, matchId: null, ready: false, result: null, error: '', note: '' });
    if (scope === 'lan') void this.refreshList();
  }
  async refreshList(): Promise<void> {
    if (!this.account.signedIn) { this.store.update({ lanList: null }); return; }
    try { this.store.update({ lanList: await this.api.list(), error: '' }); }
    catch (error) { this.store.update({ error: errorText(error) }); }
  }
  openWizard(scope: Scope): void { this.stopPolling(); this.store.update({ screen: 'wizard', scope, error: '', note: '' }); }
  async create(input: WizardInput): Promise<void> {
    await this.run(async () => {
      if (input.scope === 'local') {
        const local = newLocalTournament({ name: input.name, rules: input.rules, fill: input.fill, size: input.size, players: input.players });
        this.store.update({ scope: 'local', local, locals: loadLocalTournaments(), screen: 'bracket' });
      } else {
        const lan = await this.api.create({ name: input.name, rules: input.rules, fill: input.fill, size: input.size, usernames: input.players });
        this.store.update({ scope: 'lan', lan, screen: 'bracket' }); this.startPolling();
      }
    });
  }
  openLocal(id: string): void {
    const local = loadLocalTournaments().find(entry => entry.id === id) ?? null;
    if (local) this.store.update({ scope: 'local', local, screen: local.status === 'complete' ? 'champion' : 'bracket', matchId: null, result: null, error: '' });
  }
  async openLan(id: string): Promise<void> {
    await this.run(async () => {
      const lan = await this.api.get(id);
      this.store.update({ scope: 'lan', lan, screen: lan.state.status === 'complete' ? 'champion' : 'bracket', matchId: null, result: null, ready: false });
      this.startPolling();
    });
  }
  showBracket(): void { this.store.update({ screen: 'bracket', matchId: null, ready: false, result: null, error: '' }); }
  showChampion(): void { this.store.update({ screen: 'champion', matchId: null, result: null }); }
  async remove(): Promise<void> {
    const { scope, local, lan } = this.ui;
    if (scope === 'local' && local) { deleteLocalTournament(local.id); this.openHub('local'); return; }
    if (scope === 'lan' && lan) await this.run(async () => { if (lan.state.status === 'active') await this.api.cancel(lan.state.id); else await this.api.remove(lan.state.id); this.openHub('lan'); });
  }

  // ——— Shared helpers ———
  get state(): TournamentState | null { return this.ui.scope === 'local' ? this.ui.local : this.ui.lan?.state ?? null; }
  match(id: number | null = this.ui.matchId): BracketMatch | null { return this.state?.matches.find(entry => entry.id === id) ?? null; }
  lobby(id: number | null = this.ui.matchId): SetLobby | null { return this.ui.lan?.lobbies.find(entry => entry.matchId === id) ?? null; }
  mySide(match: BracketMatch | null = this.match()): Side | null {
    const me = this.ui.lan?.me ?? null;
    if (me === null || !match) return null;
    return match.a === me ? 'a' : match.b === me ? 'b' : null;
  }

  // ——— Set screen ———
  openSet(matchId: number): void {
    const state = this.state, match = state?.matches.find(entry => entry.id === matchId);
    if (!state || !match || match.status !== 'ready') return;
    const a = state.entrants[match.a!]!, b = state.entrants[match.b!]!;
    const random = state.rules.mode === 'random';
    this.store.update({
      screen: 'set', matchId, ready: false, result: null, error: '', note: '',
      picks: { a: random ? randomFighter() : asFighter(a.fighter, this.ui.picks.a), b: random ? randomFighter() : asFighter(b.fighter, this.ui.picks.b) },
      stage: state.rules.mode === 'hill' ? 'temple' : 'random',
    });
    if (this.ui.scope === 'lan') void this.beat();
  }
  setPick(side: Side, fighter: FighterKind): void {
    const state = this.state, match = this.match();
    if (!state || !match || state.rules.mode === 'random' || state.entrants[side === 'a' ? match.a! : match.b!]!.kind === 'cpu') return;
    this.store.update({ picks: { ...this.ui.picks, [side]: fighter } });
    this.session.ensureFighters([fighter]);
  }
  setStage(stage: StageId | 'random'): void { this.store.update({ stage }); if (stage !== 'random') this.session.ensureStage(stage); }

  // ——— Local play ———
  playLocal(): void {
    const state = this.ui.local, match = this.match();
    if (!state || !match || match.status !== 'ready') return;
    const a = state.entrants[match.a!]!, b = state.entrants[match.b!]!, { picks } = this.ui;
    const stage = this.ui.stage === 'random' ? SUPPORTED_STAGES[(Math.random() * SUPPORTED_STAGES.length) | 0]!.id : this.ui.stage;
    const side = (entrant: Entrant, fighter: FighterKind) => ({ fighter, control: entrant.kind === 'cpu' ? 'cpu' as const : 'human' as const, level: clampCpuLevel(entrant.level) });
    this.store.update({ playing: { scope: 'local', tournamentId: state.id, tournamentName: state.name, matchId: match.id, a, b, sawActive: false }, note: '' });
    this.session.startTournamentSet({ sides: [side(a, picks.a), side(b, picks.b)], stage, stocks: state.rules.stocks, seconds: state.rules.seconds, hill: state.rules.mode === 'hill' ? { zones: state.rules.hillZones } : null });
  }
  simulateLocal(): void {
    const state = this.ui.local, match = this.match();
    if (!state || !match) return;
    try {
      const winner = simulateMatch(state, match.id, Date.now());
      saveLocalTournament(state);
      this.finishLocal(state, match.id, winner, 'Simulated by CPU level.');
    } catch (error) { this.store.update({ error: errorText(error) }); }
  }
  /** Walkover: the named side advances without playing (a player who is not around). */
  walkoverLocal(side: Side): void {
    const state = this.ui.local, match = this.match();
    if (!state || !match) return;
    try {
      const winner = side === 'a' ? match.a! : match.b!;
      reportWinner(state, match.id, winner, Date.now(), 'walkover'); saveLocalTournament(state);
      this.finishLocal(state, match.id, winner, 'Walkover.');
    } catch (error) { this.store.update({ error: errorText(error) }); }
  }
  private finishLocal(state: TournamentState, matchId: number, winner: number, note: string): void {
    const match = state.matches.find(entry => entry.id === matchId)!;
    const loser = match.a === winner ? match.b! : match.a!;
    this.store.update({ local: { ...state }, locals: loadLocalTournaments(), playing: null, screen: 'set', matchId, result: { tournamentId: state.id, matchId, winner: state.entrants[winner]!, loser: state.entrants[loser]!, final: state.status === 'complete', note } });
  }
  /** PlayApp calls this on every view change while a local set is in flight. Returns true when the set just ended. */
  trackLocal(active: boolean, ended: boolean): boolean {
    const playing = this.ui.playing;
    if (!playing || playing.scope !== 'local') return false;
    if (active && !playing.sawActive) { this.store.update({ playing: { ...playing, sawActive: true } }); return false; }
    if (!playing.sawActive || !ended) return false;
    const state = loadLocalTournaments().find(entry => entry.id === playing.tournamentId), dense = this.session.match?.winner ?? null;
    if (!state) { this.store.update({ playing: null }); return true; }
    if (dense === null || dense > 1) {
      countReplay(state, playing.matchId, Date.now()); saveLocalTournament(state);
      this.store.update({ local: state, playing: null, screen: 'set', matchId: playing.matchId, result: null, note: 'DRAW — nobody advances. Play the set again.' });
      return true;
    }
    const winner = dense === 0 ? playing.a.id : playing.b.id;
    try { reportWinner(state, playing.matchId, winner, Date.now()); saveLocalTournament(state); this.finishLocal(state, playing.matchId, winner, ''); }
    catch (error) { this.store.update({ playing: null, error: errorText(error), local: state, screen: 'bracket' }); }
    return true;
  }
  /** The players quit the set from the pause menu: nothing is recorded. */
  abandonLocal(): void { if (this.ui.playing?.scope === 'local') this.store.update({ playing: null, note: 'Set abandoned — it is still waiting in the bracket.' }); }

  // ——— LAN: polling + set lobby ———
  private startPolling(): void {
    if (this.poll) return;
    this.poll = setInterval(() => void this.beat(), CHECKIN_INTERVAL_MS);
  }
  private stopPolling(): void { if (this.poll) clearInterval(this.poll); this.poll = null; }
  /** One heartbeat: check in to the open set lobby (or the set being played), else just refresh the view. */
  private async beat(): Promise<void> {
    const { lan, screen, matchId, playing, ready } = this.ui;
    if (!lan || this.disposed) return;
    try {
      const inSet = playing?.scope === 'lan' ? playing.matchId : screen === 'set' ? matchId : null;
      const match = inSet === null ? null : lan.state.matches.find(entry => entry.id === inSet) ?? null;
      let next: TournamentView;
      if (match && match.status === 'ready' && this.mySide(match)) {
        const room = this.online.client.getSnapshot().room, hostSide = this.hostSide(match);
        const mine = playing?.scope === 'lan' && this.mySide(match) === hostSide && room ? { room: room.code, live: room.phase === 'playing' } : {};
        next = await this.api.checkin(lan.state.id, match.id, { ready: ready || !!playing, ...mine });
      } else next = await this.api.get(lan.state.id);
      if (this.disposed || this.ui.lan?.state.id !== next.state.id) return;
      this.store.update({ lan: next, error: '' });
      this.afterBeat(next);
    } catch (error) { if (!this.disposed) this.store.update({ error: errorText(error) }); }
  }
  private hostSide(match: BracketMatch): Side { return this.ui.lan!.state.entrants[match.a!]!.kind === 'human' ? 'a' : 'b'; }
  setReady(ready: boolean): void { this.store.update({ ready }); void this.beat(); }
  private afterBeat(view: TournamentView): void {
    const { screen, matchId, playing, ready } = this.ui;
    if (view.state.status === 'complete' && screen === 'bracket' && !playing) { this.store.update({ screen: 'champion' }); return; }
    if (screen !== 'set' || playing || matchId === null) return;
    const match = view.state.matches.find(entry => entry.id === matchId), lobby = view.lobbies.find(entry => entry.matchId === matchId), side = this.mySide(match ?? null);
    if (!match || match.status !== 'ready') {
      // Settled elsewhere (organizer walkover, the other side's report).
      if (match?.status === 'done' && !this.ui.result) this.showResult(view, match, 'Settled.');
      return;
    }
    if (!lobby || !side || !ready) return;
    const a = view.state.entrants[match.a!]!, b = view.state.entrants[match.b!]!;
    const otherReady = side === 'a' ? (b.kind === 'cpu' || lobby.ready.b) : (a.kind === 'cpu' || lobby.ready.a);
    if (!otherReady) return;
    const hostSide = this.hostSide(match);
    if (side === hostSide) { if (!this.hosting) void this.host(view, match, lobby, side); }
    else if (lobby.room) {
      this.store.update({ playing: { scope: 'lan', tournamentId: view.state.id, tournamentName: view.state.name, matchId, a, b, hostSide, mySide: side, sawActive: false } });
      this.joinRoom(lobby.room.code);
    }
  }
  private roomRules(state: TournamentState): RoomRules {
    const base: RoomRules = { stage: state.rules.mode === 'hill' ? 'temple' : 'battlefield', stocks: state.rules.stocks, timeSeconds: state.rules.seconds };
    return state.rules.mode === 'hill' ? { ...base, hill: state.rules.hillZones } as RoomRules : base;
  }
  /** Host side: open the LAN room under the bracket's rules, seat the CPU rival if there is one, publish the code. */
  private async host(view: TournamentView, match: BracketMatch, lobby: SetLobby, side: Side): Promise<void> {
    this.hosting = true;
    try {
      const a = view.state.entrants[match.a!]!, b = view.state.entrants[match.b!]!, me = side === 'a' ? a : b, rival = side === 'a' ? b : a;
      if (this.online.client.getSnapshot().room) this.online.leave();
      this.store.update({ playing: { scope: 'lan', tournamentId: view.state.id, tournamentName: view.state.name, matchId: match.id, a, b, hostSide: side, mySide: side, sawActive: false } });
      this.session.chooseMode('lan');
      await this.online.connect();
      if (!this.online.client.create({ name: me.name, fingerprint: this.session.fingerprint, rules: this.roomRules(view.state) })) throw new Error('The room connection is not ready.');
      const room = await this.waitForRoom();
      const pick = (kind: string | undefined): RoomFighter | undefined => ROSTER_CHOICES.find(entry => entry === kind);
      const mine = pick(lobby.picks?.[side]);
      if (mine) this.online.client.choose(mine);
      if (rival.kind === 'cpu') this.online.client.setCpu(1, pick(lobby.picks?.[side === 'a' ? 'b' : 'a']) ?? pick(rival.fighter) ?? 'Mr', clampCpuLevel(rival.level));
      await this.api.checkin(view.state.id, match.id, { ready: true, room: room, live: false });
    } catch (error) {
      this.store.update({ playing: null, ready: false, error: errorText(error) });
      if (this.online.client.getSnapshot().room) this.online.leave();
      this.session.tournamentMenu();
    } finally { this.hosting = false; }
  }
  private waitForRoom(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { off(); reject(new Error('The LAN relay did not open a room in time.')); }, 8000);
      const check = (): void => {
        const snapshot = this.online.client.getSnapshot();
        if (snapshot.room) { clearTimeout(timeout); off(); resolve(snapshot.room.code); }
        else if (snapshot.error) { clearTimeout(timeout); off(); reject(new Error(snapshot.error.message)); }
      };
      const off = this.online.client.subscribe(check);
      check();
    });
  }
  /** Guest side, once in the room: take the rolled champion in RANDOM CHAMP sets. */
  private roomChanged(): void {
    const playing = this.ui.playing, snapshot = this.online.client.getSnapshot();
    if (this.disposed) return;
    if (snapshot.room && (this.watching || playing?.scope === 'lan')) this.sawRoom = true;
    else if (!snapshot.room && this.sawRoom && !this.settling && !this.hosting) {
      this.sawRoom = false;
      // The room dissolved under a spectator: nobody else stops the watched simulation.
      if (this.watching) { this.watching = false; this.online.leave(); this.session.tournamentMenu(); this.store.update({ screen: 'bracket' }); this.startPolling(); return; }
      this.leftRoom(); return;
    }
    if (!playing || playing.scope !== 'lan') return;
    const lobby = this.lobby(playing.matchId), room = snapshot.room;
    if (room && room.phase === 'lobby' && lobby?.picks && playing.mySide && snapshot.slot !== null) {
      const wanted = ROSTER_CHOICES.find(entry => entry === lobby.picks![playing.mySide!]), me = room.players.find(player => player.slot === snapshot.slot);
      if (wanted && me && me.fighter !== wanted) this.online.client.choose(wanted);
    }
    if (room?.phase === 'playing' && !playing.sawActive) this.store.update({ playing: { ...playing, sawActive: true } });
    const end = snapshot.lastEnd;
    if (end?.code === 'MATCH_COMPLETE' && playing.sawActive && this.reported !== end.matchId) { this.reported = end.matchId; void this.settleLan(playing); }
  }
  /** Both browsers verified the same final state: report who won, then leave the room for the bracket. */
  private async settleLan(playing: PlayingSet): Promise<void> {
    const match = this.session.match, dense = match?.winner ?? null, lan = this.ui.lan;
    if (!lan || !match) return;
    const regulation = match.fighters.length === 2;
    if (!regulation || dense === null) {
      this.store.update({ playing: { ...playing, sawActive: false }, note: regulation ? 'DRAW — return to the lobby and play the set again.' : 'Only a 1-v-1 counts for the bracket: remove the extra seats and play again.' });
      return;
    }
    const seat = match.fighters[dense]!.seatId ?? dense;
    const winnerSide: Side = seat === 0 ? playing.hostSide! : playing.hostSide === 'a' ? 'b' : 'a';
    const winner = winnerSide === 'a' ? playing.a : playing.b;
    this.settling = true;
    await new Promise(resolve => setTimeout(resolve, 3500));
    if (this.disposed) return;
    let view: TournamentView | undefined;
    try { view = await this.api.report(lan.state.id, playing.matchId, winner.id); } catch (error) { this.store.update({ error: errorText(error) }); }
    this.online.leave(); this.settling = false; this.sawRoom = false;
    this.session.tournamentMenu();
    this.store.update({ playing: null, ready: false, scope: 'lan', ...(view ? { lan: view } : {}) });
    const settled = (view ?? lan).state.matches.find(entry => entry.id === playing.matchId);
    if (view && settled?.status === 'done') this.showResult(view, settled, '');
    else this.store.update({ screen: 'set', matchId: playing.matchId, result: { tournamentId: lan.state.id, matchId: playing.matchId, winner, loser: winnerSide === 'a' ? playing.b : playing.a, final: false, note: 'Result sent — waiting for the other side to confirm.' } });
    this.startPolling();
  }
  private showResult(view: TournamentView, match: BracketMatch, note: string): void {
    const winner = view.state.entrants[match.winner!]!, loser = view.state.entrants[match.a === match.winner ? match.b! : match.a!]!;
    this.store.update({ screen: 'set', matchId: match.id, ready: false, result: { tournamentId: view.state.id, matchId: match.id, winner, loser, final: view.state.status === 'complete', note } });
  }
  /** Player pressed "Leave room" (or the room died) mid-set: back to the set lobby, nothing recorded. */
  leftRoom(): void {
    const playing = this.ui.playing;
    if (!playing || playing.scope !== 'lan' || this.hosting) return;
    this.store.update({ playing: null, ready: false, screen: 'set', matchId: playing.matchId });
    this.session.tournamentMenu();
  }
  /** Organizer tools + reports without a room (walkover / dispute). */
  async reportLan(matchId: number, winner: number): Promise<void> {
    const lan = this.ui.lan; if (!lan) return;
    await this.run(async () => {
      const view = await this.api.report(lan.state.id, matchId, winner);
      this.store.update({ lan: view });
      const match = view.state.matches.find(entry => entry.id === matchId);
      if (match?.status === 'done') this.showResult(view, match, 'Settled by the organizer.');
    });
  }
  async reopenLan(matchId: number): Promise<void> {
    const lan = this.ui.lan; if (!lan) return;
    await this.run(async () => { this.store.update({ lan: await this.api.reopen(lan.state.id, matchId) }); });
  }
  /** Spectate a live set: join its room read-only. */
  async spectate(matchId: number): Promise<void> {
    const lobby = this.lobby(matchId), lan = this.ui.lan;
    if (!lobby?.room || !lan) return;
    await this.run(async () => {
      this.watching = true;
      this.session.chooseMode('lan');
      await this.online.spectate(lobby.room!.code);
    });
  }
  /** Seed for cosmetic rolls (slot-machine reveal) that must not change between renders. */
  rollSeed(matchId: number): SeededRng { return new SeededRng(((this.state?.seed ?? 1) ^ Math.imul(matchId + 7, 0x85ebca6b)) >>> 0); }
}
