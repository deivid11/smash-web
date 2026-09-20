/** Shared pieces of the account screens (web/src/account/account-screens.tsx and
 * web/src/account/players-screens.tsx): the page frame, the tab strip, paged
 * lists, fighter avatars and small text helpers.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { PublicProfile } from '../../../lib/net/account-protocol.ts';
import { FIGHTERS } from '../play/battle-select.tsx';
import type { AccountClient, AccountState } from './account-client.ts';
import './account.css';

export type AccountScreenName = 'signin' | 'profile' | 'friends' | 'players';
export type Images = Readonly<Record<string, string>>;
export type Cue = (sound: 'confirm' | 'back' | 'select') => void;

export function useAccount(client: AccountClient): AccountState {
  return useSyncExternalStore(client.store.subscribe, client.store.getSnapshot);
}

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
export const fighterLabel = (kind: string): string => FIGHTERS.find((entry) => entry.kind === kind)?.name ?? kind;

export function when(timestamp: number | null): string {
  if (!timestamp) return 'never';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function Avatar({ profile, portraits, className = '' }: { profile: Pick<PublicProfile, 'avatar' | 'displayName'>; portraits: Images; className?: string }) {
  const src = portraits[profile.avatar];
  return <span className={`account-avatar ${className}`} aria-hidden="true">{src ? <img src={src} alt="" draggable={false} /> : <b>{profile.displayName.slice(0, 1).toUpperCase()}</b>}</span>;
}

/** Fits as many fixed-height rows as the list box holds; the rest page. */
export function usePaged<T>(items: readonly T[]) {
  const listRef = useRef<HTMLUListElement>(null);
  const [perPage, setPerPage] = useState(4);
  const [page, setPage] = useState(0);
  const hasRows = items.length > 0;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = (): void => {
      const row = list.querySelector<HTMLElement>(':scope > li');
      const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
      const rowHeight = row?.getBoundingClientRect().height || 48;
      setPerPage(Math.max(1, Math.floor((list.clientHeight + gap) / (rowHeight + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasRows]);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(page, pages - 1);
  return { listRef, visible: items.slice(current * perPage, (current + 1) * perPage), page: current, pages, setPage };
}

export function Pager({ id, page, pages, onPage }: { id: string; page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <span className="account-pager">
    <button id={`${id}-prev`} type="button" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>◀</button>
    <em>{page + 1}/{pages}</em>
    <button id={`${id}-next`} type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>▶</button>
  </span>;
}

/** One account page: back button, titles, optional tabs, body and footer. Escape goes back. */
export function Frame({ name, eyebrow, title, onBack, backLabel = 'BACK', tabs, system, children, footer }: {
  name: string; eyebrow: string; title: string; onBack: () => void; backLabel?: string; tabs?: ReactNode; system?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  // Callers pass inline handlers: read the latest through a ref so the key listener binds once.
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      back.current();
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
  return <section className={`account-screen account-screen-${name}`} aria-labelledby={`account-${name}-title`}>
    <header className="account-head">
      <button className="battle-back" id="account-back" type="button" onClick={onBack}>◀ {backLabel}</button>
      <div className="account-titles"><p className="account-eyebrow">{eyebrow}</p><h2 id={`account-${name}-title`}>{title}</h2></div>
      {tabs && <nav className="account-tabs" aria-label="Account">{tabs}</nav>}
      {system}
    </header>
    <div className="account-body">{children}</div>
    {footer && <footer className="account-foot">{footer}</footer>}
  </section>;
}

export function Tabs({ screen, state, onScreen }: { screen: AccountScreenName; state: AccountState; onScreen: (screen: AccountScreenName) => void }) {
  const alerts = (state.presence?.incoming ?? 0) + (state.presence?.invites.length ?? 0);
  return <>
    <button id="account-tab-profile" type="button" className="account-tab" aria-pressed={screen === 'profile'} onClick={() => onScreen('profile')}>PROFILE</button>
    <button id="account-tab-friends" type="button" className="account-tab" aria-pressed={screen === 'friends'} onClick={() => onScreen('friends')}>FRIENDS{alerts > 0 && <b className="account-badge">{alerts}</b>}</button>
    <button id="account-tab-players" type="button" className="account-tab" aria-pressed={screen === 'players'} onClick={() => onScreen('players')}>PLAYERS</button>
  </>;
}
