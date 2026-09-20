/** Address bar ↔ PLAYERS screens. The game server answers /play, /players and
 * /players/<username> with play.html (server/http.ts); this keeps the path in
 * step with what is open and follows the browser's back/forward buttons.
 * Older #players / #player=<name> links still open the same screens.
 */
import { useEffect, useRef } from 'react';
import { hasNativeBridge } from '../android-bridge.ts';

/** What the address asks for: the directory (`username` null) or one profile; null for the game. */
export interface PlayersLink { username: string | null }

export function readPlayersLink(): PlayersLink | null {
  const { pathname, hash } = window.location;
  const profile = /^\/players\/([A-Za-z0-9_]{3,20})$/u.exec(pathname)?.[1] ?? /^#player=([A-Za-z0-9_]{3,20})$/u.exec(hash)?.[1];
  if (profile) return { username: profile };
  return pathname === '/players' || hash === '#players' ? { username: null } : null;
}

/** Clean URLs only where the game server routes them; the Android shell keeps its own page URL. */
function routedUrls(): boolean {
  return document.querySelector('meta[name="smash-source"]')?.getAttribute('content') === 'server' && !hasNativeBridge();
}

/** `open` is null while the game (or another account screen) shows. Entering or moving
 * within the directory adds a history step; the first render only renames the page. */
export function usePlayersRoute(open: PlayersLink | null, onNavigate: (link: PlayersLink | null) => void): void {
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const first = useRef(true);
  const path = open ? open.username ? `/players/${open.username}` : '/players' : '/play';
  useEffect(() => {
    const initial = first.current;
    first.current = false;
    if (!routedUrls() || (window.location.pathname === path && !window.location.hash)) return;
    const step = !initial && (window.location.pathname.startsWith('/players') || path.startsWith('/players')) ? 'pushState' : 'replaceState';
    try { history[step](null, '', `${path}${window.location.search}`); } catch { /* sandboxed frame */ }
  }, [path]);
  useEffect(() => {
    const popped = (): void => navigate.current(readPlayersLink());
    window.addEventListener('popstate', popped);
    return () => window.removeEventListener('popstate', popped);
  }, []);
}
