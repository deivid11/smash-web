/** Browser side of accounts: session token, profile, friends, presence heartbeat
 * and the Rift Descent cloud save. One instance lives for the page (see
 * `accountClient()`), React reads it through `store` (web/src/play/store.ts).
 * Progress always stays playable offline in localStorage; the cloud copy is a
 * mirror kept in step by revision numbers (server/accounts.ts `putSave`).
 */
import {
  ACCOUNT_API, FRIENDS_API, GAMES_API, PLAYERS_API, PRESENCE_API, PRESENCE_INTERVAL_MS, SAVES_API,
  type AccountView, type Activity, type AuthResponse, type CloudSave, type FriendsResponse, type GameReport, type PlayerProfileResponse, type PlayersResponse,
  type PresenceResponse, type ProfilePatch, type RoomInvite,
} from '../../../lib/net/account-protocol.ts';
import { onRogueSaved } from '../../../lib/game/roguelike/meta.ts';
import { hasNativeBridge } from '../android-bridge.ts';
import { Store } from '../play/store.ts';
import { loadLink, parseRiftData, planSync, readLocalRift, riftProgress, saveLink, writeLocalRift, type RiftCloudData, type RiftProgress } from './cloud-save.ts';

const TOKEN_KEY = 'smash-account-token';
const CACHE_KEY = 'smash-account-cache';
const PUSH_DELAY_MS = 1500;
const FRIENDS_POLL_MS = 8000;
/** Finished games waiting for the server (offline, or it was down), tagged with their account. */
const PENDING_GAMES_KEY = 'smash-pending-games';
const MAX_PENDING_GAMES = 50;
interface PendingGame { userId: number; report: GameReport }

export type AuthStatus = 'checking' | 'signed-out' | 'signed-in' | 'unavailable';
export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';
export interface SyncView {
  state: SyncState;
  syncedAt: number | null;
  message: string;
  /** Both this browser and the cloud hold different progress: the player chooses. */
  conflict: { local: RiftProgress; cloud: RiftProgress; cloudRevision: number } | null;
}
export interface AccountState {
  status: AuthStatus;
  account: AccountView | null;
  /** Home badge + invite toasts, refreshed by every heartbeat. */
  presence: PresenceResponse | null;
  friends: FriendsResponse | null;
  sync: SyncView;
  /** Bumps whenever cloud progress replaced local progress, so open screens reload. */
  epoch: number;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown = null) { super(message); }
}

function storageGet(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}
function storageSet(key: string, value: string | null): void {
  try { if (value === null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value); } catch { /* private mode */ }
}
/** Accounts live on the game server: a server-served page or the Android shell (whose /api goes to the hosted server). */
export function accountsAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('meta[name="smash-source"]')?.getAttribute('content') === 'server' || hasNativeBridge();
}

export class AccountClient {
  readonly store: Store<AccountState>;
  private token: string | null = storageGet(TOKEN_KEY);
  private activity: { activity: Activity; room: string | null } = { activity: 'menu', room: null };
  private sentActivity = '';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private activityTimer: ReturnType<typeof setTimeout> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private friendsTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private friendWatchers = 0;
  private syncing: Promise<void> | null = null;
  private resyncAfter = false;
  private readonly offSaved: () => void;
  private readonly onVisible = (): void => { if (document.visibilityState === 'visible') void this.beat(); };

  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {
    let cached: AccountView | null = null;
    try { cached = JSON.parse(storageGet(CACHE_KEY) ?? 'null') as AccountView | null; } catch { cached = null; }
    this.store = new Store<AccountState>({
      status: this.token ? 'checking' : 'signed-out', account: this.token ? cached : null, presence: null, friends: null,
      sync: { state: 'idle', syncedAt: loadLink()?.syncedAt || null, message: '', conflict: null }, epoch: 0,
    });
    this.offSaved = onRogueSaved(() => this.localChanged());
  }

  get state(): AccountState { return this.store.getSnapshot(); }
  get signedIn(): boolean { return this.state.status === 'signed-in' && !!this.state.account; }
  /** Bearer token for the sockets that ride on this session (party chat); null when signed out. */
  get sessionToken(): string | null { return this.signedIn ? this.token : null; }
  /** Signed request for the other same-origin APIs that ride on this session (tournaments). */
  request<T>(method: string, path: string, body?: unknown): Promise<T> { return this.api<T>(method, path, body); }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await this.fetcher(path, {
        method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'The game server is unreachable. Your progress stays saved on this device.');
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      if (response.status === 401 && this.token && !path.endsWith('/login') && !path.endsWith('/register')) this.dropSession();
      throw new ApiError(response.status, payload?.error ?? `Request failed (${response.status}).`, payload);
    }
    return payload as T;
  }

  /** Validates a stored session on boot. */
  async start(): Promise<void> {
    if (!accountsAvailable()) { this.store.update({ status: 'unavailable' }); return; }
    if (!this.token) { this.store.update({ status: 'signed-out' }); return; }
    try {
      const { account } = await this.api<{ account: AccountView }>('GET', ACCOUNT_API);
      this.signedInAs(account);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) { this.store.update({ status: 'unavailable' }); return; }
      if (error instanceof ApiError && error.status === 0 && this.state.account) {
        // Offline with a known session: keep the profile, retry on the next heartbeat.
        this.store.update({ status: 'signed-in', sync: { ...this.state.sync, state: 'offline', message: error.message } });
        this.startLoops();
        return;
      }
      if (!this.token) { this.store.update({ status: 'signed-out' }); return; }
      // Unreachable server and nothing cached yet: try again shortly.
      this.retryTimer = setTimeout(() => void this.start(), 15_000);
    }
  }

  dispose(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopLoops();
    this.offSaved();
  }

  private signedInAs(account: AccountView): void {
    storageSet(CACHE_KEY, JSON.stringify(account));
    this.store.update({ status: 'signed-in', account });
    this.sentActivity = '';
    this.startLoops();
    void this.sync();
    void this.flushGames();
  }
  private dropSession(): void {
    this.token = null;
    storageSet(TOKEN_KEY, null);
    storageSet(CACHE_KEY, null);
    this.stopLoops();
    this.store.update({ status: 'signed-out', account: null, presence: null, friends: null, sync: { state: 'idle', syncedAt: null, message: '', conflict: null } });
  }
  private startLoops(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => void this.beat(), PRESENCE_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisible);
    void this.beat();
    if (this.friendWatchers > 0) this.pollFriends();
  }
  private stopLoops(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.friendsTimer) clearInterval(this.friendsTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.heartbeatTimer = this.friendsTimer = this.pushTimer = this.activityTimer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
  }

  // ——— Auth + profile ———

  async register(username: string, password: string, displayName: string): Promise<void> {
    const result = await this.api<AuthResponse>('POST', `${ACCOUNT_API}/register`, { username: username.trim(), password, displayName: displayName.trim() });
    this.token = result.token; storageSet(TOKEN_KEY, result.token);
    this.signedInAs(result.account);
  }
  async login(username: string, password: string): Promise<void> {
    const result = await this.api<AuthResponse>('POST', `${ACCOUNT_API}/login`, { username: username.trim(), password });
    this.token = result.token; storageSet(TOKEN_KEY, result.token);
    this.signedInAs(result.account);
  }
  /** Signs out this browser. Local progress stays on the device. */
  async logout(): Promise<void> {
    await this.pushNow().catch(() => undefined);
    await this.api('POST', `${ACCOUNT_API}/logout`, {}).catch(() => undefined);
    this.dropSession();
  }
  async refreshAccount(): Promise<void> {
    const { account } = await this.api<{ account: AccountView }>('GET', ACCOUNT_API);
    storageSet(CACHE_KEY, JSON.stringify(account));
    this.store.update({ account });
  }
  async updateProfile(patch: ProfilePatch): Promise<void> {
    const { account } = await this.api<{ account: AccountView }>('PATCH', `${ACCOUNT_API}/profile`, patch);
    storageSet(CACHE_KEY, JSON.stringify(account));
    this.store.update({ account });
  }
  async changePassword(current: string, next: string): Promise<void> {
    await this.api('POST', `${ACCOUNT_API}/password`, { current, next });
  }
  async deleteAccount(password: string): Promise<void> {
    await this.api('DELETE', ACCOUNT_API, { password });
    saveLink(null);
    this.dropSession();
  }

  // ——— Presence + friends ———

  /** What this player is doing; sent right away when it changes, then with every heartbeat. */
  setActivity(activity: Activity, room: string | null): void {
    this.activity = { activity, room };
    if (!this.signedIn || `${activity}:${room}` === this.sentActivity) return;
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => { this.activityTimer = null; void this.beat(); }, 400);
  }
  private async beat(): Promise<void> {
    if (!this.token) return;
    try {
      const presence = await this.api<PresenceResponse>('POST', PRESENCE_API, this.activity);
      this.sentActivity = `${this.activity.activity}:${this.activity.room}`;
      this.store.update({ presence });
      // Back online after a failed sync: try again.
      if (this.state.sync.state === 'offline') void this.sync();
      void this.flushGames();
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) this.store.update({ sync: { ...this.state.sync, state: 'offline', message: error.message } });
    }
  }
  /** Friends screens poll while mounted; returns the unsubscribe. */
  watchFriends(): () => void {
    this.friendWatchers++;
    if (this.friendWatchers === 1 && this.signedIn) this.pollFriends();
    return () => {
      this.friendWatchers = Math.max(0, this.friendWatchers - 1);
      if (this.friendWatchers === 0 && this.friendsTimer) { clearInterval(this.friendsTimer); this.friendsTimer = null; }
    };
  }
  private pollFriends(): void {
    if (this.friendsTimer) clearInterval(this.friendsTimer);
    void this.refreshFriends().catch(() => undefined);
    this.friendsTimer = setInterval(() => void this.refreshFriends().catch(() => undefined), FRIENDS_POLL_MS);
  }
  private applyFriends(friends: FriendsResponse): void {
    this.store.update({
      friends,
      presence: { incoming: friends.incoming.length, onlineFriends: friends.friends.filter((entry) => entry.online).length, invites: friends.invites },
    });
  }
  async refreshFriends(): Promise<void> { this.applyFriends(await this.api<FriendsResponse>('GET', FRIENDS_API)); }
  async requestFriend(username: string): Promise<void> {
    this.applyFriends(await this.api<FriendsResponse>('POST', `${FRIENDS_API}/requests`, { username: username.trim() }));
    await this.refreshAccount().catch(() => undefined);
  }
  async respondFriend(userId: number, accept: boolean): Promise<void> {
    this.applyFriends(await this.api<FriendsResponse>('POST', `${FRIENDS_API}/respond`, { userId, accept }));
    await this.refreshAccount().catch(() => undefined);
  }
  async removeFriend(userId: number): Promise<void> {
    this.applyFriends(await this.api<FriendsResponse>('POST', `${FRIENDS_API}/remove`, { userId }));
    await this.refreshAccount().catch(() => undefined);
  }
  async invite(userId: number, room: string): Promise<void> { await this.api('POST', `${FRIENDS_API}/invite`, { userId, room }); }
  async dismissInvite(invite: RoomInvite): Promise<void> {
    const presence = this.state.presence;
    if (presence) this.store.update({ presence: { ...presence, invites: presence.invites.filter((entry) => entry.id !== invite.id) } });
    await this.api('POST', `${FRIENDS_API}/invites/dismiss`, { id: invite.id }).catch(() => undefined);
  }

  // ——— Game history + public profiles ———

  /** Records a finished game for the signed-in player (nothing when signed out). Survives being offline. */
  reportGame(report: GameReport): void {
    const account = this.state.account;
    if (this.state.status !== 'signed-in' || !account) return;
    const pending = this.pendingGames();
    pending.push({ userId: account.id, report });
    storageSet(PENDING_GAMES_KEY, JSON.stringify(pending.slice(-MAX_PENDING_GAMES)));
    void this.flushGames();
  }
  private pendingGames(): PendingGame[] {
    try { const value = JSON.parse(storageGet(PENDING_GAMES_KEY) ?? '[]') as unknown; return Array.isArray(value) ? value as PendingGame[] : []; } catch { return []; }
  }
  private flushingGames = false;
  private async flushGames(): Promise<void> {
    const account = this.state.account;
    if (this.flushingGames || !account || !this.token) return;
    this.flushingGames = true;
    try {
      for (const entry of this.pendingGames()) {
        // Another account's games wait until that account signs in here again.
        if (entry.userId !== account.id) continue;
        try { await this.api('POST', GAMES_API, entry.report); }
        catch (error) {
          // Offline, busy or rate limited: keep it for the next heartbeat. Anything else is a bad report.
          if (error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)) break;
        }
        storageSet(PENDING_GAMES_KEY, JSON.stringify(this.pendingGames().filter((other) => other.report.clientId !== entry.report.clientId)));
      }
    } finally { this.flushingGames = false; }
  }
  /** The public player directory (no session needed). */
  players(query = '', offset = 0, limit = 50): Promise<PlayersResponse> {
    return this.api<PlayersResponse>('GET', `${PLAYERS_API}?${new URLSearchParams({ q: query.trim(), offset: String(offset), limit: String(limit) })}`);
  }
  /** Anyone's public profile page. */
  player(username: string): Promise<PlayerProfileResponse> {
    return this.api<PlayerProfileResponse>('GET', `${PLAYERS_API}/${encodeURIComponent(username)}`);
  }

  // ——— Rift Descent cloud save ———

  private setSync(patch: Partial<SyncView>): void { this.store.update({ sync: { ...this.state.sync, ...patch } }); }

  private localChanged(): void {
    const account = this.state.account;
    const link = loadLink();
    if (!account || this.state.status !== 'signed-in' || link?.userId !== account.id) return;
    if (!link.dirty) saveLink({ ...link, dirty: true });
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => { this.pushTimer = null; void this.sync(); }, PUSH_DELAY_MS);
  }
  private async pushNow(): Promise<void> {
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; await this.sync(); }
  }

  /** Reconciles local progress with the cloud copy (single flight; a request during a run queues one more pass). */
  sync(): Promise<void> {
    if (this.syncing) { this.resyncAfter = true; return this.syncing; }
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
      if (this.resyncAfter) { this.resyncAfter = false; void this.sync(); }
    });
    return this.syncing;
  }
  private async runSync(): Promise<void> {
    const account = this.state.account;
    if (!account || !this.token) return;
    this.setSync({ state: 'syncing', message: '' });
    try {
      const { save } = await this.api<{ save: CloudSave | null }>('GET', `${SAVES_API}/rift`);
      const cloud = save ? { data: parseRiftData(save.data) ?? { format: 1 as const, meta: null, best: null, run: null, fighter: null }, revision: save.revision } : null;
      const local = readLocalRift();
      const link = loadLink();
      const plan = planSync(link, account.id, local, cloud);
      if (plan === 'conflict' && cloud) {
        this.setSync({ state: 'conflict', message: 'This device and your cloud save both have Rift progress.', conflict: { local: riftProgress(local), cloud: riftProgress(cloud.data), cloudRevision: cloud.revision } });
        return;
      }
      if (plan === 'pull' && cloud) this.adopt(account.id, cloud.data, cloud.revision);
      else if (plan === 'push') await this.push(account.id, local, cloud?.revision ?? 0);
      else saveLink({ userId: account.id, revision: cloud?.revision ?? 0, dirty: false, syncedAt: Date.now() });
      this.setSync({ state: 'synced', syncedAt: Date.now(), message: '', conflict: null });
      void this.refreshAccount().catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Another device saved in between: reconcile again against the new revision.
        this.resyncAfter = true;
        this.setSync({ state: 'syncing' });
        return;
      }
      this.setSync({ state: error instanceof ApiError && error.status === 0 ? 'offline' : 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  private async push(userId: number, data: RiftCloudData, baseRevision: number): Promise<void> {
    const { revision } = await this.api<{ revision: number }>('PUT', `${SAVES_API}/rift`, { data, baseRevision });
    // Local writes that landed during the request keep the link dirty.
    const unchanged = JSON.stringify(readLocalRift()) === JSON.stringify(data);
    saveLink({ userId, revision, dirty: !unchanged, syncedAt: Date.now() });
    if (!unchanged) this.resyncAfter = true;
  }
  private adopt(userId: number, data: RiftCloudData, revision: number): void {
    writeLocalRift(data);
    saveLink({ userId, revision, dirty: false, syncedAt: Date.now() });
    this.store.update({ epoch: this.state.epoch + 1 });
  }

  /** Conflict answer: take the cloud copy, or overwrite it with this device's progress. */
  async resolveConflict(keep: 'cloud' | 'device'): Promise<void> {
    const account = this.state.account, conflict = this.state.sync.conflict;
    if (!account || !conflict) return;
    this.setSync({ state: 'syncing', conflict: null });
    try {
      if (keep === 'cloud') {
        const { save } = await this.api<{ save: CloudSave | null }>('GET', `${SAVES_API}/rift`);
        if (save) this.adopt(account.id, parseRiftData(save.data) ?? readLocalRift(), save.revision);
      } else {
        await this.push(account.id, readLocalRift(), conflict.cloudRevision);
      }
      this.setSync({ state: 'synced', syncedAt: Date.now(), message: '' });
      void this.refreshAccount().catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) { void this.sync(); return; }
      this.setSync({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

let shared: AccountClient | null = null;
/** The page-wide account client (started on first use). */
export function accountClient(): AccountClient {
  if (!shared) { shared = new AccountClient(); void shared.start(); }
  return shared;
}
