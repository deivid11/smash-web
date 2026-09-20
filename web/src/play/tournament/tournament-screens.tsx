/** Tournament screens: hub, creation wizard, bracket, set (VS / lobby / result)
 * and champion. One viewport each (header · body · footer), like the Rift and
 * battle screens. Presentation only: flow lives in ./controller.ts, the bracket
 * rules in lib/game/tournament/bracket.ts.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import {
  bracketSize, createTournament, DEFAULT_FILL, DEFAULT_RULES, isEliminated, MAX_ENTRANTS, MAX_ENTRANT_NAME, MAX_TOURNAMENT_NAME, MODE_LABELS, MODE_NOTES,
  placement, progress, roundName, rulesSummary, sizeChoices, TOURNAMENT_MODES,
  type BracketMatch, type CpuFill, type Entrant, type TournamentRules, type TournamentState,
} from '../../../../lib/game/tournament/bracket.ts';
import type { SetLobby, TournamentSummary } from '../../../../lib/net/tournament-protocol.ts';
import type { PublicProfile } from '../../../../lib/net/account-protocol.ts';
import { SUPPORTED_STAGES } from '../../../../lib/game/stages.ts';
import type { FighterKind } from '../../../../lib/game/data.ts';
import type { AccountState } from '../../account/account-client.ts';
import { FIGHTERS } from '../battle-select.tsx';
import { useFitColumns } from '../fit-grid.ts';
import type { PlayView } from '../game-session.ts';
import type { Scope, TournamentController, TournamentUi, WizardInput } from './controller.ts';
import { ArenaLights, Confetti, Laurel, ModeEmblem, Trophy, VsBolt } from './tournament-art.tsx';
import './tournament.css';

const fighterName = (kind: string | undefined): string => FIGHTERS.find(entry => entry.kind === kind)?.name ?? kind ?? '';
const SEAT_COLORS = ['#ff5b6e', '#4da3ff', '#ffd24a', '#74e6c6', '#b79bff', '#ff9f4a', '#7ee081', '#ff7ad9'];

export interface TournamentScreensProps {
  controller: TournamentController;
  view: PlayView;
  account: AccountState;
  system?: ReactNode;
  onHome: () => void;
  onSignIn: () => void;
  cue: (sound: 'confirm' | 'back' | 'select') => void;
}

export function useTournament(controller: TournamentController): TournamentUi {
  return useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
}

/** Frame shared by every tournament page. */
function Frame({ name, eyebrow, title, back, aside, system, footer, children, lights = true }: { name: string; eyebrow: ReactNode; title: ReactNode; back: { label: string; onClick: () => void }; aside?: ReactNode; system?: ReactNode; footer?: ReactNode; children: ReactNode; lights?: boolean }) {
  return <section className={`tourney-screen tourney-${name}`} aria-labelledby={`tourney-${name}-title`}>
    {lights && <ArenaLights calm={name !== 'champion' && name !== 'set'} />}
    <header className="tourney-head">
      <button className="battle-back tourney-back" id="tourney-back" onClick={back.onClick}>◀ {back.label}</button>
      <div className="tourney-titles"><p className="tourney-eyebrow">{eyebrow}</p><h2 id={`tourney-${name}-title`}>{title}</h2></div>
      {aside && <div className="tourney-aside">{aside}</div>}
      {system}
    </header>
    <div className="tourney-body">{children}</div>
    {footer && <footer className="tourney-foot">{footer}</footer>}
  </section>;
}

function Avatar({ entrant, portraits, fighter, size = 'md' }: { entrant: Entrant | null; portraits: Record<string, string>; fighter?: string; size?: 'sm' | 'md' | 'xl' }) {
  const kind = fighter ?? entrant?.avatar, src = kind ? portraits[kind] : undefined;
  const style = { '--seat': SEAT_COLORS[(entrant?.id ?? 0) % SEAT_COLORS.length] } as CSSProperties;
  return <span className={`tourney-avatar avatar-${size}${entrant?.kind === 'cpu' ? ' is-cpu' : ''}`} style={style}>
    {src ? <img src={src} alt="" draggable={false} /> : <b aria-hidden="true">{entrant ? entrant.name.slice(0, 1).toUpperCase() : '?'}</b>}
  </span>;
}
const entrantTag = (entrant: Entrant): string => entrant.kind === 'cpu' ? `CPU · LV ${entrant.level} · ${fighterName(entrant.fighter)}` : entrant.username ? `@${entrant.username}` : 'PLAYER';

export function TournamentScreens(props: TournamentScreensProps) {
  const ui = useTournament(props.controller);
  if (ui.screen === 'wizard') return <Wizard {...props} ui={ui} />;
  if (ui.screen === 'bracket' && props.controller.state) return <Bracket {...props} ui={ui} state={props.controller.state} />;
  if (ui.screen === 'set' && props.controller.state) return <SetScreen {...props} ui={ui} state={props.controller.state} />;
  if (ui.screen === 'champion' && props.controller.state) return <Champion {...props} ui={ui} state={props.controller.state} />;
  return <Hub {...props} ui={ui} />;
}
type ScreenProps = TournamentScreensProps & { ui: TournamentUi };

// ——— Hub ———

function Hub({ controller, ui, account, system, onHome, onSignIn, cue }: ScreenProps) {
  const lan = ui.scope === 'lan', signedIn = account.status === 'signed-in';
  useEffect(() => {
    if (!lan || !signedIn) return;
    void controller.refreshList();
    const timer = setInterval(() => void controller.refreshList(), 8000);
    return () => clearInterval(timer);
  }, [controller, lan, signedIn]);
  const tab = (scope: Scope, label: string, note: string) => <button id={`tourney-scope-${scope}`} className="tourney-tab" aria-pressed={ui.scope === scope} onClick={() => { cue('select'); controller.openHub(scope); }}><strong>{label}</strong><small>{note}</small></button>;
  const localCards = ui.locals.map(state => {
    const done = progress(state);
    return <TournamentCard key={state.id} id={state.id} name={state.name} rules={rulesSummary(state.rules)} mode={state.rules.mode} status={state.status} played={done.played} total={done.total} entrants={state.entrants.length} size={state.size} champion={state.champion === null ? null : state.entrants[state.champion]!.name} badge={state.status === 'active' ? 'RESUME' : null} onOpen={() => { cue('confirm'); controller.openLocal(state.id); }} />;
  });
  const lanCard = (entry: TournamentSummary, watch: boolean) => <TournamentCard key={entry.id} id={entry.id} name={entry.name} rules={rulesSummary(entry.rules)} mode={entry.rules.mode} status={entry.status} played={entry.played} total={entry.total} entrants={entry.entrants} size={entry.size} champion={entry.championName} owner={entry.ownerName} badge={entry.myTurn > 0 ? 'YOUR TURN' : entry.live > 0 ? '● LIVE' : watch ? 'WATCH' : null} hot={entry.myTurn > 0} onOpen={() => { cue('confirm'); void controller.openLan(entry.id); }} />;
  const empty = (text: string) => <div className="tourney-empty"><Trophy tone="silver" /><p>{text}</p></div>;
  return <Frame name="hub" eyebrow="BRACKETS · PAUSE ANY TIME · RESUME LATER" title="TOURNAMENTS" back={{ label: 'BACK', onClick: onHome }} system={system}
    aside={<div className="tourney-tabs" role="group" aria-label="Tournament kind">{tab('local', 'LOCAL', 'This device · pass the pad')}{tab('lan', 'LAN / ONLINE', 'Accounts · lobbies · spectators')}</div>}>
    <div className="hub-layout">
      <div className="tourney-hero">
        <Laurel className="hero-laurel" /><Trophy className="hero-cup" />
        <h3>{lan ? 'RUN A LEAGUE NIGHT' : 'CROWN A CHAMPION'}</h3>
        <p>{lan ? 'Pick any accounts — friends or not. Everyone plays their set whenever both are in the lobby. Anyone can spectate.' : 'Name the players, pick the mode and the bracket builds itself. Random CPUs fill the empty seats.'}</p>
        <button id="tourney-new" className="tourney-cta" data-pad-default="" disabled={lan && !signedIn} onClick={() => { cue('confirm'); controller.openWizard(ui.scope); }}>＋ NEW TOURNAMENT</button>
      </div>
      <div className="tourney-lists">
        {!lan && <><h4>ON THIS DEVICE <span>{ui.locals.filter(state => state.status === 'active').length} running</span></h4>
          <div className="tourney-cards">{localCards.length ? localCards : empty('No brackets yet. Start one — it saves itself after every set.')}</div></>}
        {lan && !signedIn && <div className="tourney-empty"><Trophy tone="silver" /><p>{account.status === 'unavailable' ? 'This server has accounts turned off, so LAN tournaments are unavailable.' : 'LAN tournaments use accounts: entrants are usernames, and your sets follow you to any device.'}</p>{account.status !== 'unavailable' && <button className="tourney-cta" id="tourney-signin" onClick={onSignIn}>SIGN IN / REGISTER</button>}</div>}
        {lan && signedIn && <><h4>MY TOURNAMENTS <span>{ui.lanList ? `${ui.lanList.mine.filter(entry => entry.status === 'active').length} running` : 'loading…'}</span></h4>
          <div className="tourney-cards">{ui.lanList?.mine.length ? ui.lanList.mine.map(entry => lanCard(entry, false)) : empty(ui.lanList ? 'You are not in any tournament yet.' : 'Looking for your tournaments…')}</div>
          {!!ui.lanList?.watch.length && <><h4>OPEN TO WATCH <span>{ui.lanList.watch.length}</span></h4><div className="tourney-cards watch">{ui.lanList.watch.map(entry => lanCard(entry, true))}</div></>}</>}
      </div>
    </div>
    {ui.error && <p className="tourney-error" role="alert">{ui.error}</p>}
  </Frame>;
}

function TournamentCard({ id, name, rules, mode, status, played, total, entrants, size, champion, owner, badge, hot, onOpen }: { id: string; name: string; rules: string; mode: TournamentRules['mode']; status: TournamentState['status']; played: number; total: number; entrants: number; size: number; champion: string | null; owner?: string; badge: string | null; hot?: boolean; onOpen: () => void }) {
  return <button className={`tourney-card status-${status}${hot ? ' is-hot' : ''}`} data-tournament={id} onClick={onOpen}>
    <ModeEmblem mode={mode} />
    <span className="tourney-card-main"><strong>{name}</strong><small>{rules} · {entrants} IN A {size}-BRACKET{owner ? ` · by ${owner}` : ''}</small>
      <span className="tourney-progress" aria-label={`${played} of ${total} sets played`}><i style={{ width: `${total ? (played / total) * 100 : 0}%` }} /></span></span>
    <span className="tourney-card-side">{status === 'complete' ? <><Trophy /><em>{champion}</em></> : status === 'cancelled' ? <em>CANCELLED</em> : <><b>{played}/{total}</b>{badge && <em className="tourney-badge">{badge}</em>}</>}</span>
  </button>;
}

// ——— Wizard ———

const STEPS = ['PLAYERS', 'MODE', 'RULES', 'BRACKET'] as const;
const CLOCKS = [60, 120, 180, 240, 300, 480, 600];

function Wizard({ controller, ui, view, account, system, cue }: ScreenProps) {
  const lan = ui.scope === 'lan', me = account.account;
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [count, setCount] = useState(4);
  const [names, setNames] = useState<string[]>(() => Array.from({ length: MAX_ENTRANTS }, (_, index) => `Player ${index + 1}`));
  const [users, setUsers] = useState<PublicProfile[]>(() => (lan && me ? [me] : []));
  const [rules, setRules] = useState<TournamentRules>({ ...DEFAULT_RULES });
  const [fill, setFill] = useState<CpuFill>({ ...DEFAULT_FILL });
  const [size, setSize] = useState<number | undefined>(undefined);
  const [previewSeed, setPreviewSeed] = useState(7);
  const humans = lan ? users.length : count;
  const choices = sizeChoices(humans), chosenSize = fill.enabled ? (size && choices.includes(size) ? size : choices[0]!) : bracketSize(Math.max(2, humans));
  const players = lan ? users.map(user => user.username) : names.slice(0, count).map((entry, index) => entry.trim() || `Player ${index + 1}`);
  const title = name.trim() || (lan ? `${me?.displayName ?? 'My'}'s Cup` : 'Smash Cup');
  const problem = humans < 1 ? 'Add at least one player.' : humans + (fill.enabled ? chosenSize - humans : 0) < 2 ? 'A bracket needs two entrants: add a player or turn the CPU fill on.' : !lan && new Set(players.map(entry => entry.toLowerCase())).size !== players.length ? 'Two players share a name.' : '';
  const preview = useMemo(() => {
    if (problem) return null;
    try { return createTournament({ id: 'preview', name: title, rules, fill, size: chosenSize, seed: previewSeed, humans: lan ? users.map(user => ({ name: user.displayName, username: user.username, avatar: user.avatar })) : players.map(entry => ({ name: entry })), fighters: FIGHTERS.map(entry => entry.kind), now: 0 }); } catch { return null; }
  }, [problem, title, rules, fill, chosenSize, previewSeed, lan, users, players.join('|')]);
  const go = (next: number) => { cue(next > step ? 'confirm' : 'back'); setStep(Math.max(0, Math.min(STEPS.length - 1, next))); };
  const create = () => { cue('confirm'); const input: WizardInput = { scope: ui.scope, name: title.slice(0, MAX_TOURNAMENT_NAME), rules, fill, size: fill.enabled ? chosenSize : undefined, players }; void controller.create(input); };
  return <Frame name="wizard" eyebrow={`NEW ${lan ? 'LAN' : 'LOCAL'} TOURNAMENT · STEP ${step + 1} OF ${STEPS.length}`} title={STEPS[step]} back={{ label: step === 0 ? 'CANCEL' : 'BACK', onClick: () => (step === 0 ? (cue('back'), controller.openHub()) : go(step - 1)) }} system={system}
    aside={<ol className="tourney-steps" aria-label="Wizard steps">{STEPS.map((label, index) => <li key={label} className={index === step ? 'now' : index < step ? 'done' : ''}><button disabled={index > step && !!problem} onClick={() => go(index)}><b>{index < step ? '✓' : index + 1}</b><span>{label}</span></button></li>)}</ol>}
    footer={<><p className="tourney-hint">{problem || ui.error || `${humans} player${humans === 1 ? '' : 's'}${fill.enabled && chosenSize > humans ? ` + ${chosenSize - humans} CPU${chosenSize - humans === 1 ? '' : 's'} (LV ${fill.min}–${fill.max})` : ''} · ${chosenSize}-bracket · ${rulesSummary(rules)}`}</p>
      {step < STEPS.length - 1 ? <button id="tourney-next" className="tourney-cta" data-pad-default="" disabled={!!problem} onClick={() => go(step + 1)}>NEXT ▶</button> : <button id="tourney-create" className="tourney-cta" data-pad-default="" disabled={!!problem || ui.busy} onClick={create}>{ui.busy ? 'CREATING…' : '🏆 CREATE TOURNAMENT'}</button>}</>}>
    {step === 0 && <div className="wizard-players">
      <div className="wizard-panel wizard-name"><label>TOURNAMENT NAME<input id="tourney-name" maxLength={MAX_TOURNAMENT_NAME} value={name} placeholder={title} onChange={event => setName(event.target.value)} /></label>
        {!lan && <div className="wizard-count"><span>PLAYERS</span><div className="tourney-stepper"><button aria-label="Fewer players" disabled={count <= 1} onClick={() => { cue('select'); setCount(count - 1); }}>−</button><strong id="tourney-count">{count}</strong><button aria-label="More players" disabled={count >= MAX_ENTRANTS} onClick={() => { cue('select'); setCount(count + 1); }}>＋</button></div>
          <div className="wizard-quick">{[2, 4, 8, 16, 32].map(value => <button key={value} aria-pressed={count === value} onClick={() => { cue('select'); setCount(value); }}>{value}</button>)}</div></div>}
        <p className="wizard-note">{lan ? 'Add any account by username — they do not need to be your friends. Each player joins their set from their own device, whenever both are around.' : 'Everyone shares this device: the two players of a set take pads 1 and 2. Stop any time — the bracket waits.'}</p>
      </div>
      {lan ? <UserPicker controller={controller} account={account} users={users} setUsers={setUsers} portraits={view.portraits} cue={cue} />
        : <div className="wizard-panel wizard-names" style={{ '--n': count } as CSSProperties}>{names.slice(0, count).map((entry, index) => <label key={index} style={{ '--seat': SEAT_COLORS[index % SEAT_COLORS.length] } as CSSProperties}><b>{index + 1}</b><input maxLength={MAX_ENTRANT_NAME} value={entry} aria-label={`Player ${index + 1} name`} onFocus={event => event.target.select()} onChange={event => setNames(names.map((old, at) => (at === index ? event.target.value : old)))} /></label>)}</div>}
    </div>}
    {step === 1 && <div className="wizard-modes">{TOURNAMENT_MODES.map(mode => <button key={mode} id={`tourney-mode-${mode}`} className={`wizard-mode mode-${mode}`} aria-pressed={rules.mode === mode} data-pad-default={rules.mode === mode ? '' : undefined} onClick={() => { cue('select'); setRules({ ...rules, mode }); }}>
      <ModeEmblem mode={mode} /><strong>{MODE_LABELS[mode]}</strong><span>{MODE_NOTES[mode]}</span><em>{rules.mode === mode ? '✓ SELECTED' : 'SELECT'}</em></button>)}</div>}
    {step === 2 && <div className="wizard-rules">
      <div className="wizard-panel"><h4>SET RULES</h4>
        {rules.mode !== 'hill' && <div className="wizard-row"><span>STOCK LIVES</span><div className="wizard-pips" role="group" aria-label="Stocks">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(value => <button key={value} aria-pressed={rules.stocks === value} onClick={() => { cue('select'); setRules({ ...rules, stocks: value }); }}>{value}</button>)}</div></div>}
        {rules.mode === 'hill' && <div className="wizard-row"><span>HILL ZONES</span><div className="wizard-pips" role="group" aria-label="Hill zones">{([1, 2] as const).map(value => <button key={value} aria-pressed={rules.hillZones === value} onClick={() => { cue('select'); setRules({ ...rules, hillZones: value }); }}>{value === 1 ? 'A ONLY' : 'A + B'}</button>)}</div></div>}
        <div className="wizard-row"><span>TIME</span><div className="wizard-pips" role="group" aria-label="Time">{CLOCKS.map(value => <button key={value} aria-pressed={rules.seconds === value} onClick={() => { cue('select'); setRules({ ...rules, seconds: value }); }}>{value / 60}:00</button>)}</div></div>
        <p className="wizard-note">{MODE_NOTES[rules.mode]} Items are off in tournament sets. A draw replays the set.</p>
      </div>
      <div className="wizard-panel"><h4>RANDOM CPUs</h4>
        <label className="wizard-toggle"><input id="tourney-fill" type="checkbox" checked={fill.enabled} onChange={event => { cue('select'); setFill({ ...fill, enabled: event.target.checked }); }} /><span>Fill the empty bracket seats with random CPUs</span></label>
        <div className={`wizard-row${fill.enabled ? '' : ' is-off'}`}><span>BRACKET SIZE</span><div className="wizard-pips" role="group" aria-label="Bracket size">{choices.map(value => <button key={value} disabled={!fill.enabled} aria-pressed={chosenSize === value} onClick={() => { cue('select'); setSize(value); }}>{value}</button>)}</div></div>
        <div className={`wizard-row${fill.enabled ? '' : ' is-off'}`}><span>CPU LEVEL · {fill.min === fill.max ? `LV ${fill.min}` : `LV ${fill.min} – ${fill.max}`}</span>
          <div className="wizard-range" role="group" aria-label="CPU level range">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => <button key={level} disabled={!fill.enabled} className={level >= fill.min && level <= fill.max ? 'in' : ''} aria-label={`Level ${level}`} onClick={() => { cue('select'); setFill(level < fill.min ? { ...fill, min: level } : level > fill.max ? { ...fill, max: level } : level - fill.min <= fill.max - level ? { ...fill, min: level } : { ...fill, max: level }); }}>{level}</button>)}</div></div>
        <p className="wizard-note">{fill.enabled ? `Tap a level to move the nearest end of the range. ${chosenSize - humans} random CPU${chosenSize - humans === 1 ? '' : 's'} will join; CPU-vs-CPU sets can be watched or simulated.` : 'Without CPUs the top seeds get a bye into round two.'}</p>
      </div>
    </div>}
    {step === 3 && <div className="wizard-preview">{preview ? <BracketTree state={preview} portraits={view.portraits} /> : <p className="tourney-error">{problem}</p>}
      <button className="wizard-shuffle" id="tourney-shuffle" onClick={() => { cue('select'); setPreviewSeed(previewSeed + 1); }}>🎲 The real draw is random — this is a sample</button></div>}
  </Frame>;
}

function UserPicker({ controller, account, users, setUsers, portraits, cue }: { controller: TournamentController; account: AccountState; users: PublicProfile[]; setUsers: (users: PublicProfile[]) => void; portraits: Record<string, string>; cue: ScreenProps['cue'] }) {
  const [query, setQuery] = useState(''), [found, setFound] = useState<PublicProfile[]>([]), [searching, setSearching] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    const text = query.trim().replace(/^@/u, '');
    if (text.length < 2) { setFound([]); return; }
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(() => void controller.api.searchUsers(text).then(result => { if (ticket === latest.current) setFound(result); }).catch(() => { if (ticket === latest.current) setFound([]); }).finally(() => { if (ticket === latest.current) setSearching(false); }), 250);
    return () => clearTimeout(timer);
  }, [query, controller]);
  const has = (id: number) => users.some(user => user.id === id), full = users.length >= MAX_ENTRANTS;
  const add = (user: PublicProfile) => { if (has(user.id) || full) return; cue('select'); setUsers([...users, user]); };
  const friends = (account.friends?.friends ?? []).map(entry => entry.profile).filter(profile => !has(profile.id));
  const row = (user: PublicProfile, action: ReactNode) => <li key={user.id}><span className="tourney-avatar avatar-sm">{portraits[user.avatar] ? <img src={portraits[user.avatar]} alt="" /> : <b>{user.displayName.slice(0, 1)}</b>}</span><span><strong>{user.displayName}</strong><small>@{user.username}</small></span>{action}</li>;
  return <div className="wizard-panel wizard-users">
    <div className="wizard-search"><label>ADD BY USERNAME<input id="tourney-user-search" value={query} maxLength={24} placeholder="type a username…" autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)} /></label>
      <ul className="wizard-found" aria-label="Search results">{found.filter(user => !has(user.id)).map(user => row(user, <button className="secondary" disabled={full} onClick={() => add(user)}>＋ ADD</button>))}
        {query.trim().length >= 2 && !searching && !found.filter(user => !has(user.id)).length && <li className="is-empty">No other account matches “{query.trim()}”.</li>}</ul>
      {!!friends.length && <div className="wizard-friends"><span>FRIENDS</span>{friends.slice(0, 12).map(profile => <button key={profile.id} disabled={full} onClick={() => add(profile)}>＋ {profile.displayName}</button>)}</div>}
    </div>
    <div className="wizard-roster"><h4>ENTRANTS <span>{users.length}/{MAX_ENTRANTS}</span></h4>
      <ul>{users.map(user => row(user, <button className="secondary" aria-label={`Remove ${user.displayName}`} onClick={() => { cue('back'); setUsers(users.filter(entry => entry.id !== user.id)); }}>✕</button>))}
        {!users.length && <li className="is-empty">Nobody yet — you can organize without playing.</li>}</ul>
      {account.account && !has(account.account.id) && <button className="secondary" id="tourney-add-me" onClick={() => add(account.account!)}>＋ ADD ME</button>}
    </div>
  </div>;
}

// ——— Bracket ———

function BracketTree({ state, portraits, lobbies = [], me = null, selected = null, onPick }: { state: TournamentState; portraits: Record<string, string>; lobbies?: readonly SetLobby[]; me?: number | null; selected?: number | null; onPick?: (match: BracketMatch) => void }) {
  const rounds = Array.from({ length: state.rounds }, (_, round) => state.matches.filter(match => match.round === round));
  const side = (match: BracketMatch, id: number | null, fallback: string) => {
    const entrant = id === null ? null : state.entrants[id]!;
    const won = match.winner !== null && match.winner === id, lost = match.winner !== null && id !== null && match.winner !== id;
    return <span className={`bracket-side${won ? ' won' : ''}${lost ? ' lost' : ''}${id !== null && id === me ? ' me' : ''}`}>
      {entrant ? <><Avatar entrant={entrant} portraits={portraits} size="sm" /><b>{entrant.name}</b>{entrant.kind === 'cpu' && <small>LV{entrant.level}</small>}</> : <i>{fallback}</i>}{won && <em aria-hidden="true">▶</em>}</span>;
  };
  return <div className={`bracket-tree size-${state.size}`} style={{ '--rounds': state.rounds + 1 } as CSSProperties}>
    {rounds.map((matches, round) => <div className="bracket-round" key={round}><h5>{roundName(round, state.rounds)}</h5>
      <div className="bracket-column">{matches.map(match => {
        const lobby = lobbies.find(entry => entry.matchId === match.id), live = !!lobby?.room?.live, waiting = !!lobby && (lobby.here.a || lobby.here.b);
        const mine = me !== null && (match.a === me || match.b === me) && match.status === 'ready';
        const body = <>{side(match, match.a, match.status === 'bye' ? 'BYE' : 'TBD')}{side(match, match.b, match.status === 'bye' ? 'BYE' : 'TBD')}
          {live ? <em className="bracket-flag live">● LIVE</em> : mine ? <em className="bracket-flag mine">YOUR SET</em> : waiting ? <em className="bracket-flag wait">IN LOBBY</em> : lobby?.disputed ? <em className="bracket-flag wait">DISPUTED</em> : null}</>;
        const className = `bracket-match status-${match.status}${selected === match.id ? ' selected' : ''}${round % 2 ? ' odd' : ''}`;
        return <div className="bracket-cell" key={match.id}>{onPick && match.status !== 'bye' && match.status !== 'pending'
          ? <button className={className} data-match={match.id} data-pad-default={mine ? '' : undefined} onClick={() => onPick(match)}>{body}</button>
          : <div className={className} data-match={match.id}>{body}</div>}</div>;
      })}</div></div>)}
    <div className="bracket-round bracket-crown"><h5>CHAMPION</h5><div className="bracket-column"><div className="bracket-cell"><div className={`bracket-champion${state.champion !== null ? ' crowned' : ''}`}><Trophy />{state.champion !== null ? <><Avatar entrant={state.entrants[state.champion]!} portraits={portraits} /><b>{state.entrants[state.champion]!.name}</b></> : <i>?</i>}</div></div></div></div>
  </div>;
}

function Bracket({ controller, ui, state, view, system, cue }: ScreenProps & { state: TournamentState }) {
  const lan = ui.scope === 'lan' ? ui.lan : null, done = progress(state), me = lan?.me ?? null;
  const [confirm, setConfirm] = useState(false);
  const ready = state.matches.filter(match => match.status === 'ready');
  const pick = (match: BracketMatch) => { cue('confirm'); if (match.status === 'ready') controller.openSet(match.id); else controller.store.update({ matchId: match.id }); };
  const selected = ui.matchId === null ? null : state.matches.find(match => match.id === ui.matchId) ?? null;
  const canManage = !lan || lan.isOwner;
  return <Frame name="bracket" eyebrow={`${lan ? `LAN · by ${lan.owner.displayName}` : 'LOCAL'} · ${rulesSummary(state.rules)}`} title={state.name} back={{ label: 'TOURNAMENTS', onClick: () => { cue('back'); controller.openHub(); } }} system={system}
    aside={<div className="tourney-meter"><b>{done.played}/{done.total}</b><span>SETS PLAYED</span><span className="tourney-progress"><i style={{ width: `${done.total ? (done.played / done.total) * 100 : 0}%` }} /></span></div>}
    footer={<><p className="tourney-hint">{ui.error || ui.note || (state.status === 'complete' ? 'The bracket is decided.' : state.status === 'cancelled' ? 'This tournament was cancelled.' : lan ? 'Open your set to enter its lobby. When both players are READY the room opens by itself. Live sets can be watched.' : 'Pick any highlighted set to play it. Quit whenever you like — the bracket is saved.')}</p>
      {canManage && (confirm ? <span className="tourney-confirm"><button className="secondary" onClick={() => setConfirm(false)}>KEEP</button><button className="danger" id="tourney-delete-yes" onClick={() => { cue('back'); void controller.remove(); }}>{lan && state.status === 'active' ? 'CANCEL TOURNAMENT' : 'DELETE'}</button></span> : <button className="secondary" id="tourney-delete" onClick={() => setConfirm(true)}>{lan && state.status === 'active' ? 'CANCEL…' : 'DELETE…'}</button>)}
      {state.status === 'complete' && <button className="tourney-cta" data-pad-default="" onClick={() => { cue('confirm'); controller.showChampion(); }}>🏆 CEREMONY</button>}</>}>
    <div className="bracket-layout">
      <BracketTree state={state} portraits={view.portraits} lobbies={lan?.lobbies} me={me} selected={ui.matchId} onPick={pick} />
      <aside className="bracket-side-panel" aria-label="Sets to play">
        <h4>{state.status === 'active' ? 'UP NEXT' : 'FINAL STANDINGS'}</h4>
        {state.status === 'active' ? <ul className="bracket-queue">{ready.map(match => {
          const a = state.entrants[match.a!]!, b = state.entrants[match.b!]!, lobby = lan?.lobbies.find(entry => entry.matchId === match.id);
          const mine = me !== null && (match.a === me || match.b === me), cpus = a.kind === 'cpu' && b.kind === 'cpu';
          return <li key={match.id} className={mine ? 'mine' : ''}><button onClick={() => pick(match)}><small>{roundName(match.round, state.rounds)}</small><strong>{a.name} <i>vs</i> {b.name}</strong>
            <em>{lobby?.room?.live ? '● LIVE — WATCH' : lan ? (mine ? 'ENTER LOBBY ▶' : lobby && (lobby.here.a || lobby.here.b) ? 'PLAYER WAITING' : 'WAITING FOR PLAYERS') : cpus ? 'WATCH OR SIMULATE ▶' : 'PLAY ▶'}</em></button></li>;
        })}{!ready.length && <li className="is-empty">Waiting for results…</li>}</ul>
          : <ul className="bracket-queue standings">{[...state.entrants].sort((x, y) => standing(state, y.id) - standing(state, x.id)).slice(0, 8).map(entrant => <li key={entrant.id}><span><Avatar entrant={entrant} portraits={view.portraits} size="sm" /><strong>{entrant.name}</strong><em>{placement(state, entrant.id)}</em></span></li>)}</ul>}
        {selected && selected.status === 'done' && <div className="bracket-detail"><small>{roundName(selected.round, state.rounds)}</small><strong>{state.entrants[selected.winner!]!.name} advanced</strong><em>{selected.note === 'simulated' ? 'Simulated' : selected.note === 'walkover' ? 'Walkover' : 'Played'}{selected.replays ? ` · ${selected.replays} draw${selected.replays === 1 ? '' : 's'}` : ''}</em>
          {lan?.isOwner && <button className="secondary" onClick={() => void controller.reopenLan(selected.id)}>↺ REOPEN SET</button>}</div>}
      </aside>
    </div>
  </Frame>;
}
/** Deeper run = higher standing. */
function standing(state: TournamentState, entrant: number): number {
  if (state.champion === entrant) return 99;
  return Math.max(-1, ...state.matches.filter(match => match.a === entrant || match.b === entrant).map(match => match.round + (match.winner === entrant ? 0.5 : 0)));
}

// ——— Set: VS screen, LAN lobby, result ———

function SetScreen({ controller, ui, state, view, system, cue }: ScreenProps & { state: TournamentState }) {
  const match = state.matches.find(entry => entry.id === ui.matchId) ?? null;
  const lan = ui.scope === 'lan' ? ui.lan : null;
  const back = { label: 'BRACKET', onClick: () => { cue('back'); controller.showBracket(); } };
  if (!match || match.a === null || match.b === null) return <Frame name="set" eyebrow="SET" title="NOT READY" back={back} system={system}><p className="tourney-error">This set is not ready yet.</p></Frame>;
  const a = state.entrants[match.a]!, b = state.entrants[match.b]!, round = roundName(match.round, state.rounds), random = state.rules.mode === 'random';
  const result = ui.result && ui.result.matchId === match.id ? ui.result : null;
  if (result?.winner) {
    const next = () => { cue('confirm'); if (result.final) controller.showChampion(); else controller.showBracket(); };
    return <Frame name="set" eyebrow={`${state.name} · ${round}`} title={result.final ? 'WE HAVE A CHAMPION' : 'SET COMPLETE'} back={back} system={system}
      footer={<><p className="tourney-hint">{result.note || (result.final ? 'The bracket is decided.' : `${result.winner.name} moves on to ${roundName(match.round + 1, state.rounds)}.`)}</p><button id="tourney-continue" className="tourney-cta" data-pad-default="" onClick={next}>{result.final ? '🏆 CEREMONY ▶' : 'CONTINUE ▶'}</button></>}>
      <Confetti count={result.final ? 60 : 28} />
      <div className="set-result"><div className="set-winner"><Laurel /><Avatar entrant={result.winner} portraits={view.portraits} size="xl" /><p className="set-banner">ADVANCES</p><h3>{result.winner.name}</h3><small>{entrantTag(result.winner)}</small></div>
        {result.loser && <div className="set-loser"><Avatar entrant={result.loser} portraits={view.portraits} /><span><strong>{result.loser.name}</strong><small>{isEliminated(state, result.loser.id) ? `ELIMINATED · ${round}` : ''}</small></span></div>}</div>
    </Frame>;
  }
  const lobby = lan?.lobbies.find(entry => entry.matchId === match.id) ?? null, mySide = controller.mySide(match);
  const humanPick = (side: 'a' | 'b') => !lan && !random && (side === 'a' ? a : b).kind === 'human';
  const shown = (side: 'a' | 'b'): string | undefined => lan ? lobby?.picks?.[side] ?? (side === 'a' ? a : b).fighter : ui.picks[side];
  const cpus = a.kind === 'cpu' && b.kind === 'cpu';
  const panel = (side: 'a' | 'b', entrant: Entrant) => {
    const here = lan ? entrant.kind === 'cpu' || !!lobby?.here[side] : true, ready = lan ? entrant.kind === 'cpu' || !!lobby?.ready[side] : true;
    return <div className={`set-side side-${side}${lan && ready ? ' is-ready' : ''}`} style={{ '--seat': SEAT_COLORS[entrant.id % SEAT_COLORS.length] } as CSSProperties}>
      <Avatar entrant={entrant} portraits={view.portraits} fighter={shown(side)} size="xl" />
      <h3>{entrant.name}{lan && mySide === side ? <em> · YOU</em> : null}</h3>
      <small>{entrant.kind === 'cpu' ? `CPU · LV ${entrant.level}` : !lan ? `PAD ${side === 'a' || a.kind === 'cpu' ? 1 : 2}` : `@${entrant.username}`}{shown(side) ? ` · ${fighterName(shown(side))}` : ''}</small>
      {lan && entrant.kind === 'human' && <p className={`set-presence${here ? ' here' : ''}`}>{ready ? '✔ READY' : here ? '● IN THE LOBBY' : '○ NOT HERE YET'}</p>}
      {humanPick(side) && <FighterPicker portraits={view.portraits} value={ui.picks[side]} onPick={fighter => { cue('select'); controller.setPick(side, fighter); }} label={`${entrant.name} fighter`} />}
      {random && <p className="set-presence here">🎲 RANDOM CHAMP</p>}
      {(lan ? lan.isOwner : true) && !cpus && <button className="secondary set-walkover" onClick={() => { cue('confirm'); if (lan) void controller.reportLan(match.id, entrant.id); else controller.walkoverLocal(side); }}>{lan ? 'ORGANIZER: ADVANCE' : 'WALKOVER ▶'}</button>}
    </div>;
  };
  const live = !!lobby?.room?.live, canPlay = lan ? !!mySide : true;
  return <Frame name="set" eyebrow={`${state.name} · ${rulesSummary(state.rules)}`} title={round} back={back} system={system}
    footer={<><p className="tourney-hint">{ui.error || ui.note || (view.loading || view.progress.startsWith('Preparing') ? view.progress : lan ? (lobby?.disputed ? 'The two sides reported different winners — the organizer decides.' : mySide ? (ui.ready ? 'Waiting for your rival… the room opens as soon as both are READY.' : 'Press READY when you can play now. Your rival sees you in the lobby.') : live ? 'This set is being played right now.' : 'Waiting for both players to enter this lobby.') : cpus ? 'Two CPUs: watch the fight or let their levels decide.' : 'Pick fighters and a stage, then FIGHT. A draw replays the set.')}</p>
      {!lan && cpus && <button className="secondary" id="tourney-simulate" onClick={() => { cue('confirm'); controller.simulateLocal(); }}>⏩ SIMULATE</button>}
      {!lan && <button id="tourney-fight" className="tourney-cta" data-pad-default="" disabled={!view.ready || view.loading} onClick={() => { cue('confirm'); controller.playLocal(); }}>{cpus ? '👁 WATCH' : '⚔ FIGHT'}</button>}
      {lan && live && !mySide && <button id="tourney-watch" className="tourney-cta" data-pad-default="" disabled={ui.busy || !view.ready} onClick={() => { cue('confirm'); void controller.spectate(match.id); }}>👁 SPECTATE</button>}
      {lan && canPlay && <button id="tourney-ready" className={`tourney-cta${ui.ready ? ' is-on' : ''}`} data-pad-default="" disabled={!view.ready || !!ui.playing} onClick={() => { cue('confirm'); controller.setReady(!ui.ready); }}>{ui.playing ? 'OPENING ROOM…' : ui.ready ? '✔ READY — CANCEL' : 'READY'}</button>}</>}>
    <div className="set-versus">{panel('a', a)}<VsBolt />{panel('b', b)}</div>
    {!lan && <StageStrip previews={view.stagePreviews} value={ui.stage} onPick={stage => { cue('select'); controller.setStage(stage); }} />}
  </Frame>;
}

function FighterPicker({ portraits, value, onPick, label }: { portraits: Record<string, string>; value: FighterKind; onPick: (fighter: FighterKind) => void; label: string }) {
  const roster = FIGHTERS.filter(fighter => fighter.kind.startsWith('custom:') || portraits[fighter.kind] !== undefined || Object.keys(portraits).length === 0);
  const [ref, columns] = useFitColumns<HTMLDivElement>(roster.length, 1, 3);
  return <div className="set-picker" ref={ref} role="group" aria-label={label} style={{ '--cols': columns } as CSSProperties}>{roster.map(fighter => <button key={fighter.kind} data-fighter={fighter.kind} aria-label={fighter.name} aria-pressed={value === fighter.kind} title={fighter.name} onClick={() => onPick(fighter.kind as FighterKind)}>{portraits[fighter.kind] ? <img src={portraits[fighter.kind]} alt="" draggable={false} /> : <span>{fighter.mark}</span>}</button>)}</div>;
}

function StageStrip({ previews, value, onPick }: { previews: Record<string, string>; value: TournamentUi['stage']; onPick: (stage: TournamentUi['stage']) => void }) {
  return <div className="set-stages" role="group" aria-label="Stage"><button aria-pressed={value === 'random'} onClick={() => onPick('random')}><span className="set-stage-random">🎲</span><small>RANDOM</small></button>
    {SUPPORTED_STAGES.map(stage => <button key={stage.id} aria-pressed={value === stage.id} title={stage.label} onClick={() => onPick(stage.id)}>{previews[stage.id] ? <img src={previews[stage.id]} alt="" draggable={false} /> : <span className="set-stage-random">▦</span>}<small>{stage.label}</small></button>)}</div>;
}

// ——— Champion ———

function Champion({ controller, ui, state, view, system, cue }: ScreenProps & { state: TournamentState }) {
  const champion = state.champion === null ? null : state.entrants[state.champion]!;
  const final = state.matches.find(match => match.round === state.rounds - 1), semis = state.matches.filter(match => match.round === state.rounds - 2);
  const finalist = final && champion ? state.entrants[final.a === champion.id ? final.b! : final.a!] ?? null : null;
  const third = state.rounds > 1 ? semis.map(match => (match.winner === null ? null : state.entrants[match.a === match.winner ? match.b! : match.a!] ?? null)).filter((entry): entry is Entrant => !!entry) : [];
  const path = champion ? state.matches.filter(match => match.winner === champion.id && match.status === 'done').sort((x, y) => x.round - y.round) : [];
  return <Frame name="champion" eyebrow={`${state.name} · ${rulesSummary(state.rules)}`} title="CHAMPION" back={{ label: 'TOURNAMENTS', onClick: () => { cue('back'); controller.openHub(); } }} system={system}
    footer={<><p className="tourney-hint">{state.entrants.length} entrants · {progress(state).total} sets · {new Date(state.updatedAt).toLocaleDateString()}</p><button className="secondary" id="tourney-view-bracket" onClick={() => { cue('select'); controller.showBracket(); }}>VIEW BRACKET</button><button className="tourney-cta" data-pad-default="" onClick={() => { cue('confirm'); controller.openWizard(ui.scope); }}>＋ NEW TOURNAMENT</button></>}>
    <Confetti count={70} />
    {champion ? <div className="champion-stage">
      <div className="champion-hero"><Laurel /><Trophy className="champion-cup" /><Avatar entrant={champion} portraits={view.portraits} size="xl" /><h3>{champion.name}</h3><small>{entrantTag(champion)}</small></div>
      <div className="champion-podium">
        {finalist && <div className="podium-step second"><Trophy tone="silver" /><Avatar entrant={finalist} portraits={view.portraits} /><strong>{finalist.name}</strong><small>FINALIST</small></div>}
        {third.map(entrant => <div className="podium-step third" key={entrant.id}><Trophy tone="bronze" /><Avatar entrant={entrant} portraits={view.portraits} /><strong>{entrant.name}</strong><small>SEMIFINALIST</small></div>)}
      </div>
      <ol className="champion-path" aria-label="Road to the title">{path.map(match => { const rival = state.entrants[match.a === champion.id ? match.b! : match.a!]!; return <li key={match.id}><small>{roundName(match.round, state.rounds)}</small><span>def. <strong>{rival.name}</strong></span></li>; })}</ol>
    </div> : <p className="tourney-error">No champion yet.</p>}
  </Frame>;
}

/** Ribbon shown over the LAN room / arena while a bracket set is in flight. */
export function TournamentRibbon({ controller }: { controller: TournamentController }) {
  const ui = useTournament(controller);
  if (!ui.playing) return null;
  return <div className="tourney-ribbon" role="status"><Trophy /><span><strong>{ui.playing.tournamentName}</strong><small>{ui.playing.a.name} vs {ui.playing.b.name}{ui.note ? ` · ${ui.note}` : ''}</small></span></div>;
}
