/** PLAYERS: the public directory of every registered account and any player's
 * profile page (all-game totals, recent games, Rift record, fighters). No
 * sign-in needed. Data comes from web/src/account/use-players.ts; the address
 * bar follows along through web/src/account/players-route.ts.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  MAX_DISPLAY_NAME,
  type GameMode, type GameRecord, type GameStats, type PlayerSummary, type PublicProfile, type RiftLifetime,
} from '../../../lib/net/account-protocol.ts';
import { SUPPORTED_STAGES } from '../../../lib/game/stages.ts';
import type { AccountClient } from './account-client.ts';
import { Avatar, Frame, Pager, fighterLabel, usePaged, when, type Cue, type Images } from './account-ui.tsx';
import { usePlayer, usePlayers } from './use-players.ts';

const MODE_TEXT: Record<GameMode, string> = { local: 'LOCAL', lan: 'LAN', tournament: 'TOURNEY', rift: 'RIFT' };
const RESULT_TEXT = { win: 'W', loss: 'L', draw: 'D' } as const;
const stageLabel = (id: string): string => (id === 'rift' ? 'Rift Descent' : SUPPORTED_STAGES.find((stage) => stage.id === id)?.label ?? id);
const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;
const winRate = (wins: number, games: number): string => (games ? `${Math.round((wins / games) * 100)}%` : '—');
function playTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600), minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
const fighterTag = (kind: string) => ({ avatar: kind, displayName: fighterLabel(kind) });
export const playerUrl = (username: string): string => `${location.origin}/players/${username}`;

interface ScreenProps {
  client: AccountClient;
  portraits: Images;
  /** Account tabs, when signed in. */
  tabs?: ReactNode;
  system?: ReactNode;
  cue?: Cue;
}

// ——— Directory ———

export function PlayersScreen({ client, portraits, tabs, system, cue, onOpen, onClose }: ScreenProps & { onOpen: (username: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const { data: list, error } = usePlayers(client, query);
  const players = list?.players ?? [];
  const paged = usePaged(players);
  const open = (username: string): void => { cue?.('confirm'); onOpen(username); };
  const total = list ? `${list.total} registered${list.total > players.length ? ` · first ${players.length}, search to narrow` : ''}` : 'Loading…';
  return <Frame name="players" eyebrow="SMASH WEB ID" title="PLAYERS" onBack={onClose} tabs={tabs} system={system}>
    <section className="account-panel account-list-panel account-players" aria-label="Registered players">
      <h3>
        ALL PLAYERS <small id="players-total">{total}</small>
        <input id="players-search" className="account-players-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a name…" maxLength={MAX_DISPLAY_NAME} autoCapitalize="none" spellCheck={false} aria-label="Search players" />
        <Pager id="players-page" page={paged.page} pages={paged.pages} onPage={paged.setPage} />
      </h3>
      {error && <p className="account-error" role="alert">{error}</p>}
      {list && players.length === 0 && <p className="account-empty">{query.trim() ? 'No player matches that name.' : 'Nobody has made an account yet.'}</p>}
      <ul className="account-rows" ref={paged.listRef}>{paged.visible.map((entry) => <PlayerRow key={entry.profile.id} entry={entry} portraits={portraits} onOpen={open} />)}</ul>
    </section>
  </Frame>;
}

function PlayerRow({ entry, portraits, onOpen }: { entry: PlayerSummary; portraits: Images; onOpen: (username: string) => void }) {
  const { profile, games, wins, lastPlayedAt } = entry;
  const record = games ? `${plural(games, 'game')} · ${winRate(wins, games)} won · played ${when(lastPlayedAt)}` : `joined ${new Date(profile.createdAt).toLocaleDateString()}`;
  const rift = profile.rift && profile.rift.runs > 0 ? ` · Rift best ${profile.rift.bestScore}` : '';
  return <li className="account-row account-player-row" data-player={profile.username}>
    <Avatar profile={profile} portraits={portraits} />
    <span className="account-row-text">
      <strong>{profile.displayName}{profile.title && <em> · {profile.title}</em>}</strong>
      <small>@{profile.username} · {record}{rift}</small>
    </span>
    <span className="account-row-actions"><button id={`player-open-${profile.username}`} className="battle-next" type="button" onClick={() => onOpen(profile.username)}>VIEW ▶</button></span>
  </li>;
}

// ——— Profile page ———

/** Mount keyed by `username`: switching players starts from a clean page. */
export function PlayerProfileScreen({ client, portraits, tabs, system, cue, username, onBack }: ScreenProps & { username: string; onBack: () => void }) {
  const { data, error } = usePlayer(client, username);
  const copy = useCopyLink(playerUrl(username));
  const back = (): void => { cue?.('back'); onBack(); };
  return <Frame name="player" eyebrow={`@${username}`} title={data ? data.profile.displayName.toUpperCase() : 'PLAYER'} onBack={back} backLabel="PLAYERS" tabs={tabs} system={system}
    footer={<>
      <p className="account-foot-note" role="status">{copy.message}</p>
      <button id="player-copy-link" className="secondary" type="button" onClick={copy.copy}>🔗 Copy link</button>
    </>}>
    {error && <div className="account-panel account-unavailable"><p className="account-error" role="alert">{error}</p></div>}
    {!error && !data && <div className="account-panel account-unavailable"><p className="account-empty">Loading @{username}…</p></div>}
    {data && <div className="account-player">
      <div className="account-player-side">
        <ProfileCard profile={data.profile} lastPlayedAt={data.stats.lastPlayedAt} portraits={portraits} />
        <AllGamesPanel stats={data.stats} />
      </div>
      <RecordPanel recent={data.recent} rift={data.rift} stats={data.stats} portraits={portraits} />
    </div>}
  </Frame>;
}

/** Copies a link; the confirmation fades after a few seconds (the link itself shows when copying is blocked). */
function useCopyLink(url: string): { message: string; copy: () => void } {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  const copy = (): void => {
    if (!navigator.clipboard) { setMessage(url); return; }
    navigator.clipboard.writeText(url).then(() => setMessage('Link copied.'), () => setMessage(url));
  };
  return { message, copy };
}

function ProfileCard({ profile, lastPlayedAt, portraits }: { profile: PublicProfile; lastPlayedAt: number | null; portraits: Images }) {
  return <article className="account-card">
    <Avatar profile={profile} portraits={portraits} className="big" />
    <div className="account-card-text">
      <strong id="player-name">{profile.displayName}</strong>
      <small>@{profile.username}</small>
      {profile.title && <em>{profile.title}</em>}
      <span className="account-card-meta">{fighterLabel(profile.avatar).toUpperCase()} · since {new Date(profile.createdAt).toLocaleDateString()}{lastPlayedAt ? ` · last played ${when(lastPlayedAt)}` : ''}</span>
    </div>
  </article>;
}

/** A grid of big numbers; `id` values keep the browser tests' hooks. */
function StatGrid({ items }: { items: ReadonlyArray<{ label: string; value: ReactNode; id?: string }> }) {
  return <dl>{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd id={item.id}>{item.value}</dd></div>)}</dl>;
}

function AllGamesPanel({ stats }: { stats: GameStats }) {
  return <section className="account-panel account-stats" aria-label="All games">
    <h3>ALL GAMES</h3>
    <StatGrid items={[
      { label: 'Games', value: stats.games, id: 'player-games' },
      { label: 'W · L · D', value: `${stats.wins}·${stats.losses}·${stats.draws}` },
      { label: 'Win rate', value: winRate(stats.wins, stats.games) },
      { label: 'KOs', value: stats.kos },
      { label: 'Falls', value: stats.falls },
      { label: 'Played', value: playTime(stats.seconds) },
    ]} />
  </section>;
}

type RecordTab = 'recent' | 'rift' | 'fighters';
const RECORD_TABS: ReadonlyArray<{ id: RecordTab; label: string }> = [{ id: 'recent', label: 'RECENT' }, { id: 'rift', label: 'RIFT' }, { id: 'fighters', label: 'FIGHTERS' }];

function RecordPanel({ recent, rift, stats, portraits }: { recent: GameRecord[]; rift: RiftLifetime | null; stats: GameStats; portraits: Images }) {
  const [tab, setTab] = useState<RecordTab>('recent');
  const paged = usePaged(recent);
  return <section className="account-panel account-list-panel account-player-main" aria-label="Player record">
    <h3>
      <span className="account-segment account-player-tabs" role="tablist" aria-label="Record">
        {RECORD_TABS.map((entry) => <button key={entry.id} id={`player-tab-${entry.id}`} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)}>{entry.label}</button>)}
      </span>
      {tab === 'recent' && <Pager id="recent-page" page={paged.page} pages={paged.pages} onPage={paged.setPage} />}
    </h3>
    {tab === 'recent' && <>
      {recent.length === 0 && <p className="account-empty">No games recorded yet. Games count once this player finishes a battle or a Rift run while signed in.</p>}
      <ul className="account-rows" ref={paged.listRef}>{paged.visible.map((game) => <GameRow key={game.id} game={game} portraits={portraits} />)}</ul>
    </>}
    {tab === 'rift' && <RiftRecord rift={rift} />}
    {tab === 'fighters' && <FighterRecord stats={stats} portraits={portraits} />}
  </section>;
}

function GameRow({ game, portraits }: { game: GameRecord; portraits: Images }) {
  const run = game.mode === 'rift' ? game.rift : null;
  const versus = game.opponents.map((opponent) => `${opponent.cpu ? 'CPU' : opponent.name} (${fighterLabel(opponent.fighter)})`).join(', ');
  const title = run ? `${fighterLabel(game.fighter)} · floor ${run.cleared}/${run.length} · score ${run.score}` : `${fighterLabel(game.fighter)}${versus ? ` vs ${versus}` : ''}`;
  const detail = run
    ? `${plural(run.fightsWon, 'fight')} won · ${plural(run.bossesDown, 'boss', 'bosses')} · heat ${run.heat}`
    : `${stageLabel(game.stage)} · ${game.kos} KO · ${plural(game.falls, 'fall')} · ${game.damage}% dealt`;
  return <li className={`account-row account-game is-${game.result}`} data-game={game.id}>
    <b className="account-game-result" aria-label={game.result}>{RESULT_TEXT[game.result]}</b>
    <Avatar profile={fighterTag(game.fighter)} portraits={portraits} />
    <span className="account-row-text">
      <strong>{title}</strong>
      <small>{MODE_TEXT[game.mode]} · {detail} · {when(game.playedAt)}</small>
    </span>
  </li>;
}

function RiftRecord({ rift }: { rift: RiftLifetime | null }) {
  if (!rift) return <p className="account-empty">No Rift Descent progress in the cloud yet.</p>;
  const champions = rift.champions.map((champion) => `${fighterLabel(champion.fighter)} ${champion.wins}/${champion.runs}`).join(' · ');
  return <div className="account-player-rift account-stats">
    <StatGrid items={[
      { label: 'Runs', value: rift.runs, id: 'player-rift-runs' },
      { label: 'Wins', value: rift.wins },
      { label: 'Best score', value: rift.bestScore },
      { label: 'Deepest floor', value: rift.bestCleared },
      { label: 'Bosses', value: rift.bossesDown },
      { label: 'Elites', value: rift.elitesDown },
      { label: 'Best heat win', value: rift.bestHeatWin >= 0 ? rift.bestHeatWin : '—' },
      { label: 'Events', value: rift.eventsVisited },
      { label: '💠 Shards', value: rift.shards },
      { label: '🗝 Keys', value: rift.keys },
      { label: 'Duo runs', value: rift.duoRuns },
      { label: 'Best with', value: rift.bestFighter ? fighterLabel(rift.bestFighter) : '—' },
    ]} />
    <p className="account-player-champions">{champions ? `CHAMPIONS · ${champions}` : 'No champion has finished a run yet.'}</p>
  </div>;
}

function FighterRecord({ stats, portraits }: { stats: GameStats; portraits: Images }) {
  return <div className="account-player-fighters">
    <ul className="account-player-modes">{(Object.keys(MODE_TEXT) as GameMode[]).map((mode) => <li key={mode}>
      <b>{MODE_TEXT[mode]}</b><span>{plural(stats.byMode[mode].games, 'game')} · {winRate(stats.byMode[mode].wins, stats.byMode[mode].games)} won</span>
    </li>)}</ul>
    {stats.fighters.length === 0 && <p className="account-empty">No fighter played yet.</p>}
    <ul className="account-player-mains">{stats.fighters.map((entry) => <li key={entry.fighter}>
      <Avatar profile={fighterTag(entry.fighter)} portraits={portraits} />
      <span><strong>{fighterLabel(entry.fighter)}</strong><small>{plural(entry.games, 'game')} · {plural(entry.wins, 'win')} · {winRate(entry.wins, entry.games)}</small></span>
    </li>)}</ul>
  </div>;
}
