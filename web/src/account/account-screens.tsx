/** Account screens: SIGN IN / CREATE ACCOUNT, PROFILE (avatar, Rift stats,
 * cloud save, security) and FRIENDS (requests, invites, online friends with
 * one-tap LAN room join/invite), plus the router that also opens the public
 * PLAYERS screens (web/src/account/players-screens.tsx). Each is a single
 * viewport page like the home and Rift menus: long lists page instead of
 * scrolling. Shared pieces live in web/src/account/account-ui.tsx; state and
 * network calls in web/src/account/account-client.ts.
 */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MAX_DISPLAY_NAME, MAX_PASSWORD, MAX_TITLE, MIN_PASSWORD, type Activity, type FriendEntry, type PublicProfile, type RoomInvite } from '../../../lib/net/account-protocol.ts';
import { FIGHTERS } from '../play/battle-select.tsx';
import type { AccountClient, AccountState } from './account-client.ts';
import { Avatar, Frame, Pager, Tabs, errorText, fighterLabel, useAccount, usePaged, when, type AccountScreenName, type Cue, type Images } from './account-ui.tsx';
import { PlayerProfileScreen, PlayersScreen } from './players-screens.tsx';

export { useAccount, type AccountScreenName } from './account-ui.tsx';

export interface AccountScreensProps {
  client: AccountClient;
  screen: AccountScreenName;
  onScreen: (screen: AccountScreenName) => void;
  onClose: () => void;
  portraits: Images;
  /** LAN room this browser is in (enables Invite buttons). */
  myRoom: string | null;
  /** Leave for the LAN screen and join a room code. */
  onJoinRoom: (code: string) => void;
  canJoin: boolean;
  system?: ReactNode;
  cue?: Cue;
  /** PLAYERS: the username whose public profile is open (null: the directory). */
  viewedPlayer?: string | null;
  onViewPlayer?: (username: string | null) => void;
}

export function AccountScreens(props: AccountScreensProps) {
  const state = useAccount(props.client);
  const { screen } = props;
  if (state.status === 'unavailable') {
    return <Frame name="unavailable" eyebrow="SMASH WEB ID" title="ACCOUNTS" onBack={props.onClose} system={props.system}>
      <div className="account-panel account-unavailable"><p>Accounts, cloud saves and friends live on the game server.</p><p>This build is not connected to one, so progress stays on this device.</p></div>
    </Frame>;
  }
  // Public: anyone may browse players and profiles, signed in or not.
  if (screen === 'players') {
    const shared = { client: props.client, portraits: props.portraits, system: props.system, cue: props.cue, tabs: state.status === 'signed-in' && state.account ? <Tabs screen="players" state={state} onScreen={props.onScreen} /> : undefined };
    return props.viewedPlayer
      ? <PlayerProfileScreen key={props.viewedPlayer} {...shared} username={props.viewedPlayer} onBack={() => props.onViewPlayer?.(null)} />
      : <PlayersScreen {...shared} onOpen={(username) => props.onViewPlayer?.(username)} onClose={props.onClose} />;
  }
  if (state.status !== 'signed-in' || !state.account || screen === 'signin') {
    return <SignInScreen {...props} state={state} onDone={() => props.onScreen(screen === 'signin' ? 'profile' : screen)} />;
  }
  return screen === 'friends' ? <FriendsScreen {...props} state={state} /> : <ProfileScreen {...props} state={state} />;
}

// ——— Sign in / create account ———

function SignInScreen({ client, state, onClose, onDone, onScreen, system, cue }: AccountScreensProps & { state: AccountState; onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (state.status === 'signed-in' && state.account) onDone(); }, [state.status, state.account]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (mode === 'register' && password !== confirm) { setError('The passwords do not match.'); cue?.('back'); return; }
    setBusy(true);
    try {
      if (mode === 'register') await client.register(username, password, displayName || username);
      else await client.login(username, password);
      cue?.('confirm');
    } catch (caught) { setError(errorText(caught)); cue?.('back'); }
    finally { setBusy(false); }
  };
  const checking = state.status === 'checking';
  return <Frame name="signin" eyebrow="SMASH WEB ID" title={mode === 'register' ? 'CREATE ACCOUNT' : 'SIGN IN'} onBack={onClose} system={system}>
    <div className="account-signin">
      <aside className="account-pitch">
        <p className="account-mark" aria-hidden="true">SMASH<span>ID</span></p>
        <ul>
          <li><b aria-hidden="true">☁</b><span><strong>CLOUD SAVES</strong><small>Rift Descent progress, unlocks and your saved run follow you to any device.</small></span></li>
          <li><b aria-hidden="true">👤</b><span><strong>PROFILE</strong><small>Pick a fighter avatar and show off your Rift record.</small></span></li>
          <li><b aria-hidden="true">👥</b><span><strong>FRIENDS</strong><small>See who is online and jump into their LAN rooms in one tap.</small></span></li>
        </ul>
        <p className="account-note">No account needed to play: progress on this device always stays playable offline.</p>
        <button id="account-browse-players" className="secondary" type="button" onClick={() => onScreen('players')}>👥 Browse players ▶</button>
      </aside>
      <form className="account-panel account-form" onSubmit={(event) => void submit(event)} aria-busy={busy || checking}>
        <div className="account-segment" role="tablist" aria-label="Account action">
          <button id="account-mode-login" type="button" role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(''); }}>SIGN IN</button>
          <button id="account-mode-register" type="button" role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(''); }}>CREATE ACCOUNT</button>
        </div>
        <label>USERNAME<input id="account-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} placeholder="letters, numbers, _" required /></label>
        {mode === 'register' && <label>DISPLAY NAME<input id="account-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={MAX_DISPLAY_NAME} placeholder={username || 'Shown to friends'} /></label>}
        <div className="account-form-row">
          <label>PASSWORD<input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? MIN_PASSWORD : undefined} maxLength={MAX_PASSWORD} required /></label>
          {mode === 'register' && <label>CONFIRM<input id="account-password-confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" maxLength={MAX_PASSWORD} required /></label>}
        </div>
        <p className="account-error" role="alert">{error || (checking ? 'Checking your saved session…' : '')}</p>
        <button id="account-submit" className="battle-next" type="submit" disabled={busy || checking}>{busy ? 'ONE MOMENT…' : mode === 'register' ? 'CREATE ACCOUNT ▶' : 'SIGN IN ▶'}</button>
      </form>
    </div>
  </Frame>;
}

// ——— Profile ———

type ProfileView = 'overview' | 'edit' | 'password' | 'delete';


function ProfileScreen(props: AccountScreensProps & { state: AccountState }) {
  const { client, state, onClose, onScreen, portraits, system, cue } = props;
  const account = state.account!;
  const [view, setView] = useState<ProfileView>('overview');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const act = async (fn: () => Promise<void>, done = ''): Promise<boolean> => {
    setBusy(true); setMessage('');
    try { await fn(); cue?.('confirm'); if (done) setMessage(done); return true; }
    catch (error) { setMessage(errorText(error)); cue?.('back'); return false; }
    finally { setBusy(false); }
  };
  const rift = account.rift;
  const sync = state.sync;
  const syncText = sync.state === 'syncing' ? 'Syncing…' : sync.state === 'conflict' ? 'Choose which progress to keep' : sync.state === 'offline' ? 'Offline — will sync when the server is back' : sync.state === 'error' ? sync.message : `Synced ${when(sync.syncedAt)}`;
  return <Frame name="profile" eyebrow={`@${account.username}`} title="PROFILE" onBack={view === 'overview' ? onClose : () => { setView('overview'); setMessage(''); }} backLabel={view === 'overview' ? 'BACK' : 'PROFILE'} tabs={<Tabs screen="profile" state={state} onScreen={onScreen} />} system={system}
    footer={view === 'overview' ? <>
      <p className="account-foot-note" role="status">{message}</p>
      <button id="account-public" className="secondary" type="button" onClick={() => { onScreen('players'); props.onViewPlayer?.(account.username); }}>👁 Public profile</button>
      <button id="account-edit" className="secondary" type="button" onClick={() => setView('edit')}>✎ Edit profile</button>
      <button id="account-password-open" className="secondary" type="button" onClick={() => setView('password')}>🔑 Password</button>
      <button id="account-signout" className="secondary" type="button" disabled={busy} onClick={() => void act(() => client.logout())}>⏻&nbsp;Sign out</button>
      <button id="account-delete-open" className="secondary account-danger" type="button" onClick={() => setView('delete')}>Delete account</button>
    </> : undefined}>
    <div className="account-profile">
      <article className="account-card">
        <Avatar profile={account} portraits={portraits} className="big" />
        <div className="account-card-text">
          <strong id="account-profile-name">{account.displayName}</strong>
          <small>@{account.username}</small>
          {account.title && <em>{account.title}</em>}
          <span className="account-card-meta">{fighterLabel(account.avatar).toUpperCase()} · {account.friends} friend{account.friends === 1 ? '' : 's'} · since {new Date(account.createdAt).toLocaleDateString()}</span>
        </div>
      </article>
      {view === 'overview' && <div className="account-overview">
        <section className="account-panel account-stats" aria-label="Rift Descent record">
          <h3>RIFT DESCENT</h3>
          <dl>
            <div><dt>Runs</dt><dd id="account-rift-runs">{rift?.runs ?? 0}</dd></div>
            <div><dt>Wins</dt><dd>{rift?.wins ?? 0}</dd></div>
            <div><dt>Best score</dt><dd>{rift?.bestScore ?? 0}</dd></div>
            <div><dt>Deepest floor</dt><dd>{rift?.bestCleared ?? 0}</dd></div>
            <div><dt>💠 Shards</dt><dd id="account-rift-shards">{rift?.shards ?? 0}</dd></div>
            <div><dt>🗝 Keys</dt><dd>{rift?.keys ?? 0}</dd></div>
          </dl>
        </section>
        <section className={`account-panel account-cloud is-${sync.state}`} aria-label="Cloud save">
          <h3>☁ CLOUD SAVE</h3>
          <p id="account-sync-status" role="status">{syncText}</p>
          {sync.conflict ? <div className="account-conflict">
            <ConflictSide id="account-keep-device" label="THIS DEVICE" progress={sync.conflict.local} onKeep={() => void client.resolveConflict('device')} />
            <ConflictSide id="account-keep-cloud" label="CLOUD" progress={sync.conflict.cloud} onKeep={() => void client.resolveConflict('cloud')} />
          </div> : <>
            <p className="account-cloud-lede">Rift unlocks, the Mirror, champion mastery, your best run and the saved descent sync automatically while you are signed in.</p>
            <button id="account-sync-now" className="secondary" type="button" disabled={sync.state === 'syncing'} onClick={() => void client.sync()}>↻ Sync now</button>
          </>}
        </section>
      </div>}
      {view === 'edit' && <ProfileEditor account={account} portraits={portraits} busy={busy} message={message} onSave={(patch) => void act(() => client.updateProfile(patch)).then((ok) => { if (ok) setView('overview'); })} />}
      {view === 'password' && <PasswordForm busy={busy} message={message} onSubmit={(current, next) => void act(() => client.changePassword(current, next), 'Password changed. Other devices were signed out.').then((ok) => { if (ok) setView('overview'); })} />}
      {view === 'delete' && <DeleteForm busy={busy} message={message} username={account.username} onSubmit={(password) => void act(() => client.deleteAccount(password)).then((ok) => { if (ok) onClose(); })} />}
    </div>
  </Frame>;
}

function ConflictSide({ id, label, progress, onKeep }: { id: string; label: string; progress: { runs: number; wins: number; shards: number; keys: number; bestScore: number; runFloor: number | null; runFighter: string | null }; onKeep: () => void }) {
  return <div className="account-conflict-side">
    <strong>{label}</strong>
    <small>{progress.runs} runs · {progress.wins} wins · 💠 {progress.shards} · 🗝 {progress.keys}</small>
    <small>Best {progress.bestScore}{progress.runFloor !== null ? ` · saved run floor ${progress.runFloor}${progress.runFighter ? ` (${fighterLabel(progress.runFighter)})` : ''}` : ''}</small>
    <button id={id} className="battle-next" type="button" onClick={onKeep}>KEEP {label}</button>
  </div>;
}

function ProfileEditor({ account, portraits, busy, message, onSave }: { account: PublicProfile; portraits: Images; busy: boolean; message: string; onSave: (patch: { displayName: string; title: string; avatar: string }) => void }) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [title, setTitle] = useState(account.title);
  const [avatar, setAvatar] = useState(account.avatar);
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(10);
  // Fighters this server can show (their portraits are rendered), plus the current pick.
  const withArt = FIGHTERS.filter((fighter) => portraits[fighter.kind] || fighter.kind === account.avatar);
  const choices = withArt.length >= 4 ? withArt : FIGHTERS;
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const count = choices.length;
    const measure = (): void => {
      const { width, height } = grid.getBoundingClientRect();
      let best = 1, bestSize = 0;
      for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const size = Math.min((width - 4 * (cols - 1)) / cols, (height - 4 * (rows - 1)) / rows);
        if (size > bestSize) { bestSize = size; best = cols; }
      }
      setColumns(best);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [choices.length]);
  return <form className="account-panel account-editor" onSubmit={(event) => { event.preventDefault(); onSave({ displayName, title, avatar }); }}>
    <div className="account-form-row">
      <label>DISPLAY NAME<input id="profile-display-name" value={displayName} maxLength={MAX_DISPLAY_NAME} onChange={(event) => setDisplayName(event.target.value)} required /></label>
      <label>TITLE<input id="profile-title" value={title} maxLength={MAX_TITLE} placeholder="Rift Walker, Fox main…" onChange={(event) => setTitle(event.target.value)} /></label>
      <button id="profile-save" className="battle-next" type="submit" disabled={busy}>SAVE ▶</button>
    </div>
    <p className="account-editor-label">AVATAR · <b>{fighterLabel(avatar).toUpperCase()}</b>{message && <span className="account-error" role="alert"> · {message}</span>}</p>
    <div className="account-avatar-grid" ref={gridRef} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="radiogroup" aria-label="Avatar fighter">
      {choices.map((fighter) => <button key={fighter.kind} id={`avatar-${fighter.kind}`} type="button" role="radio" aria-checked={avatar === fighter.kind} title={fighter.name} className="account-avatar-choice" onClick={() => setAvatar(fighter.kind)}>
        {portraits[fighter.kind] ? <img src={portraits[fighter.kind]} alt="" draggable={false} /> : <b>{fighter.mark}</b>}
      </button>)}
    </div>
  </form>;
}

function PasswordForm({ busy, message, onSubmit }: { busy: boolean; message: string; onSubmit: (current: string, next: string) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && next !== confirm;
  return <form className="account-panel account-small-form" onSubmit={(event) => { event.preventDefault(); if (!mismatch) onSubmit(current, next); }}>
    <h3>CHANGE PASSWORD</h3>
    <label>CURRENT PASSWORD<input id="password-current" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required /></label>
    <div className="account-form-row">
      <label>NEW PASSWORD<input id="password-next" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={MAX_PASSWORD} value={next} onChange={(event) => setNext(event.target.value)} required /></label>
      <label>CONFIRM<input id="password-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>
    </div>
    <p className="account-error" role="alert">{mismatch ? 'The new passwords do not match.' : message}</p>
    <button id="password-submit" className="battle-next" type="submit" disabled={busy || mismatch}>CHANGE PASSWORD ▶</button>
  </form>;
}

function DeleteForm({ busy, message, username, onSubmit }: { busy: boolean; message: string; username: string; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  return <form className="account-panel account-small-form account-delete" onSubmit={(event) => { event.preventDefault(); onSubmit(password); }}>
    <h3>DELETE ACCOUNT</h3>
    <p>This removes your profile, friends and cloud save from the server for good. Progress on this device stays playable.</p>
    <div className="account-form-row">
      <label>TYPE @{username}<input id="delete-username" value={typed} autoCapitalize="none" spellCheck={false} onChange={(event) => setTyped(event.target.value)} required /></label>
      <label>PASSWORD<input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
    </div>
    <p className="account-error" role="alert">{message}</p>
    <button id="delete-submit" className="secondary account-danger" type="submit" disabled={busy || typed.replace(/^@/u, '').toLowerCase() !== username.toLowerCase()}>DELETE FOREVER</button>
  </form>;
}

// ——— Friends ———

const ACTIVITY_TEXT: Record<Activity, string> = { menu: 'In the menus', local: 'In a local battle', lan: 'In LAN battle', rift: 'Descending the Rift' };

function friendStatus(entry: FriendEntry): string {
  if (!entry.online) return 'Offline';
  if (entry.room) return entry.room.joinable ? `In LAN room ${entry.room.code} · ${entry.room.players}/${entry.room.maxPlayers}` : `In a LAN match · room ${entry.room.code}`;
  return entry.activity ? ACTIVITY_TEXT[entry.activity] : 'Online';
}

function FriendsScreen(props: AccountScreensProps & { state: AccountState }) {
  const { client, state, onClose, onScreen, portraits, system, myRoom, onJoinRoom, canJoin, cue } = props;
  const account = state.account!;
  const friends = state.friends;
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  useEffect(() => client.watchFriends(), [client]);
  const act = async (fn: () => Promise<void>, done = ''): Promise<void> => {
    setBusy(true); setNotice('');
    try { await fn(); cue?.('confirm'); setNotice(done); }
    catch (error) { setNotice(errorText(error)); cue?.('back'); }
    finally { setBusy(false); }
  };
  const inbox: Array<{ key: string; node: ReactNode }> = [
    ...(friends?.invites ?? []).map((invite) => ({ key: `i${invite.id}`, node: <InviteRow invite={invite} portraits={portraits} canJoin={canJoin} onJoin={() => onJoinRoom(invite.room.code)} onDismiss={() => void client.dismissInvite(invite)} /> })),
    ...(friends?.incoming ?? []).map((request) => ({ key: `r${request.profile.id}`, node: <>
      <Avatar profile={request.profile} portraits={portraits} />
      <span className="account-row-text"><strong>{request.profile.displayName}</strong><small>@{request.profile.username} wants to be friends</small></span>
      <span className="account-row-actions">
        <button id={`friend-accept-${request.profile.username}`} className="battle-next" type="button" disabled={busy} onClick={() => void act(() => client.respondFriend(request.profile.id, true), `You and ${request.profile.displayName} are friends now.`)}>✓</button>
        <button id={`friend-decline-${request.profile.username}`} className="secondary" type="button" aria-label="Decline" disabled={busy} onClick={() => void act(() => client.respondFriend(request.profile.id, false))}>✕</button>
      </span>
    </> })),
    ...(friends?.outgoing ?? []).map((request) => ({ key: `o${request.profile.id}`, node: <>
      <Avatar profile={request.profile} portraits={portraits} />
      <span className="account-row-text"><strong>{request.profile.displayName}</strong><small>@{request.profile.username} · request sent</small></span>
      <span className="account-row-actions"><button id={`friend-cancel-${request.profile.username}`} className="secondary" type="button" disabled={busy} onClick={() => void act(() => client.removeFriend(request.profile.id))}>Cancel</button></span>
    </> })),
  ];
  const inboxPage = usePaged(inbox);
  const list = friends?.friends ?? [];
  const friendPage = usePaged(list);
  const online = list.filter((entry) => entry.online).length;
  return <Frame name="friends" eyebrow={myRoom ? `YOU ARE IN LAN ROOM ${myRoom}` : `@${account.username}`} title="FRIENDS" onBack={onClose} tabs={<Tabs screen="friends" state={state} onScreen={onScreen} />} system={system}>
    <div className="account-friends">
      <div className="account-friends-side">
        <form className="account-panel account-add" onSubmit={(event) => { event.preventDefault(); const name = username; void act(() => client.requestFriend(name), `Friend request sent to @${name.trim()}.`).then(() => setUsername('')); }}>
          <label>ADD A FRIEND BY USERNAME<span className="account-add-row"><input id="friend-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="their_username" autoCapitalize="none" spellCheck={false} maxLength={20} required /><button id="friend-send" className="battle-next" type="submit" disabled={busy || !username.trim()}>SEND</button></span></label>
          <small>Share yours: <b id="account-own-username">@{account.username}</b></small>
          <p className="account-notice" role="status">{notice}</p>
        </form>
        <section className="account-panel account-list-panel" aria-label="Requests and invites">
          <h3>INBOX{(friends?.incoming.length ?? 0) + (friends?.invites.length ?? 0) > 0 && <b className="account-badge">{(friends?.incoming.length ?? 0) + (friends?.invites.length ?? 0)}</b>}<Pager id="inbox-page" page={inboxPage.page} pages={inboxPage.pages} onPage={inboxPage.setPage} /></h3>
          {inbox.length === 0 && <p className="account-empty">No invites or requests right now.</p>}
          <ul className="account-rows" ref={inboxPage.listRef}>{inboxPage.visible.map((entry) => <li key={entry.key} className="account-row">{entry.node}</li>)}</ul>
        </section>
      </div>
      <section className="account-panel account-list-panel account-friend-list" aria-label="Friends">
        <h3>FRIENDS <small>{online} online · {list.length} total</small><Pager id="friends-page" page={friendPage.page} pages={friendPage.pages} onPage={friendPage.setPage} /></h3>
        {friends === null && <p className="account-empty">Loading friends…</p>}
        {friends !== null && list.length === 0 && <p className="account-empty">Add friends by username. When they are online you will see their LAN rooms here and can join or invite them with one tap.</p>}
        <ul className="account-rows" ref={friendPage.listRef}>{friendPage.visible.map((entry) => {
          const joinable = !!entry.room?.joinable && entry.room.code !== myRoom;
          const invitable = !!myRoom && entry.online && entry.room?.code !== myRoom;
          return <li key={entry.profile.id} className={`account-row${entry.online ? ' is-online' : ''}`} data-friend={entry.profile.username}>
            <Avatar profile={entry.profile} portraits={portraits} />
            <span className="account-row-text">
              <strong><i className="account-dot" aria-hidden="true" />{entry.profile.displayName}{entry.profile.title && <em> · {entry.profile.title}</em>}</strong>
              <small>@{entry.profile.username} · {friendStatus(entry)}{entry.profile.rift && entry.profile.rift.runs > 0 ? ` · Rift best ${entry.profile.rift.bestScore}` : ''}</small>
            </span>
            <span className="account-row-actions">
              {joinable && <button id={`friend-join-${entry.profile.username}`} className="battle-next" type="button" disabled={!canJoin} onClick={() => onJoinRoom(entry.room!.code)}>JOIN</button>}
              {invitable && <button id={`friend-invite-${entry.profile.username}`} className="battle-next" type="button" disabled={busy} onClick={() => void act(() => client.invite(entry.profile.id, myRoom), `Invite sent to ${entry.profile.displayName}.`)}>INVITE</button>}
              {confirmRemove === entry.profile.id
                ? <button id={`friend-remove-confirm-${entry.profile.username}`} className="secondary account-danger" type="button" disabled={busy} onClick={() => { setConfirmRemove(null); void act(() => client.removeFriend(entry.profile.id)); }}>Remove?</button>
                : <button id={`friend-remove-${entry.profile.username}`} className="secondary" type="button" aria-label={`Remove ${entry.profile.displayName}`} onClick={() => setConfirmRemove(entry.profile.id)}>✕</button>}
            </span>
          </li>;
        })}</ul>
      </section>
    </div>
  </Frame>;
}

function InviteRow({ invite, portraits, canJoin, onJoin, onDismiss }: { invite: RoomInvite; portraits: Images; canJoin: boolean; onJoin: () => void; onDismiss: () => void }) {
  return <>
    <Avatar profile={invite.from} portraits={portraits} />
    <span className="account-row-text"><strong>🎮 {invite.from.displayName}</strong><small>invites you to LAN room {invite.room.code} · {invite.room.players}/{invite.room.maxPlayers}</small></span>
    <span className="account-row-actions">
      <button id={`invite-join-${invite.room.code}`} className="battle-next" type="button" disabled={!canJoin} onClick={onJoin}>JOIN</button>
      <button id={`invite-dismiss-${invite.room.code}`} className="secondary" type="button" aria-label="Dismiss invite" onClick={onDismiss}>✕</button>
    </span>
  </>;
}

// ——— Home entry, invite toast, LAN strip ———

/** Home settings row entry: SIGN IN, or your avatar + name with a badge for requests and invites. */
export function AccountEntry({ client, portraits, onOpen }: { client: AccountClient; portraits: Images; onOpen: () => void }) {
  const state = useAccount(client);
  if (state.status === 'unavailable') return null;
  const account = state.status === 'signed-in' ? state.account : null;
  const alerts = (state.presence?.incoming ?? 0) + (state.presence?.invites.length ?? 0);
  return <button id="account-open" type="button" className="system-entry account-entry" onClick={onOpen} title={account ? `Profile, cloud save and friends for @${account.username}` : 'Sign in for cloud saves, a profile and friends'}>
    {account ? <Avatar profile={account} portraits={portraits} className="system-glyph" /> : <span className="system-glyph" aria-hidden="true">👤</span>}
    <span className="account-entry-name">{account ? account.displayName : 'Sign in'}</span>
    {account && state.presence && state.presence.onlineFriends > 0 && <small className="system-status">{state.presence.onlineFriends} online</small>}
    {alerts > 0 && <b className="account-badge" aria-label={`${alerts} new`}>{alerts}</b>}
  </button>;
}

/** Newest room invite, shown on menu screens outside the invited room. */
export function InviteToast({ client, portraits, myRoom, canJoin, onJoin }: { client: AccountClient; portraits: Images; myRoom: string | null; canJoin: boolean; onJoin: (code: string) => void }) {
  const state = useAccount(client);
  const invite = state.status === 'signed-in' ? state.presence?.invites.filter((entry) => entry.room.code !== myRoom).at(-1) : undefined;
  if (!invite) return null;
  return <div className="account-toast" role="status" aria-live="polite">
    <Avatar profile={invite.from} portraits={portraits} />
    <span className="account-row-text"><strong>{invite.from.displayName}</strong><small>invites you to LAN room {invite.room.code} · {invite.room.players}/{invite.room.maxPlayers}</small></span>
    <button id="invite-toast-join" className="battle-next" type="button" disabled={!canJoin} onClick={() => { onJoin(invite.room.code); void client.dismissInvite(invite); }}>JOIN</button>
    <button id="invite-toast-dismiss" className="secondary" type="button" aria-label="Dismiss invite" onClick={() => void client.dismissInvite(invite)}>✕</button>
  </div>;
}

/** LAN screen strip: online friends with joinable rooms (no room yet) or Invite buttons (inside a room). */
export function LanFriendsStrip({ client, portraits, myRoom, canJoin, onJoin, onOpenFriends }: { client: AccountClient; portraits: Images; myRoom: string | null; canJoin: boolean; onJoin: (code: string) => void; onOpenFriends: () => void }) {
  const state = useAccount(client);
  const signedIn = state.status === 'signed-in' && !!state.account;
  useEffect(() => (signedIn ? client.watchFriends() : undefined), [client, signedIn]);
  const [sent, setSent] = useState<Record<number, string>>({});
  if (state.status === 'unavailable') return null;
  if (!signedIn) {
    return <div className="lan-friends" aria-label="Friends"><span className="lan-friends-label">👥 FRIENDS</span><span className="lan-friends-empty">Sign in to see friends online and invite them to your room.</span><button id="lan-friends-open" className="secondary" type="button" onClick={onOpenFriends}>Sign in</button></div>;
  }
  const online = (state.friends?.friends ?? []).filter((entry) => entry.online);
  const shown = online.slice(0, 4);
  return <div className="lan-friends" aria-label="Friends online">
    <span className="lan-friends-label">👥 {online.length} ONLINE</span>
    {shown.length === 0 && <span className="lan-friends-empty">No friends online right now.</span>}
    {shown.map((entry) => {
      const joinable = !myRoom && !!entry.room?.joinable;
      const invitable = !!myRoom && entry.room?.code !== myRoom;
      return <span key={entry.profile.id} className="lan-friend" data-friend={entry.profile.username}>
        <Avatar profile={entry.profile} portraits={portraits} />
        <span className="lan-friend-text"><strong>{entry.profile.displayName}</strong><small>{entry.room?.code === myRoom && myRoom ? 'In your room' : friendStatus(entry)}</small></span>
        {joinable && <button id={`lan-join-${entry.profile.username}`} className="battle-next" type="button" disabled={!canJoin} onClick={() => onJoin(entry.room!.code)}>JOIN</button>}
        {invitable && <button id={`lan-invite-${entry.profile.username}`} className="battle-next" type="button" disabled={sent[entry.profile.id] === myRoom} onClick={() => void client.invite(entry.profile.id, myRoom!).then(() => setSent((value) => ({ ...value, [entry.profile.id]: myRoom! }))).catch(() => undefined)}>{sent[entry.profile.id] === myRoom ? 'SENT' : 'INVITE'}</button>}
      </span>;
    })}
    <button id="lan-friends-open" className="secondary" type="button" onClick={onOpenFriends}>All friends ▶</button>
  </div>;
}
