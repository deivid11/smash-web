/** Data hooks for the public PLAYERS screens (web/src/account/players-screens.tsx). */
import { useEffect, useState } from 'react';
import type { PlayerProfileResponse, PlayersResponse } from '../../../lib/net/account-protocol.ts';
import type { AccountClient } from './account-client.ts';
import { errorText } from './account-ui.tsx';

export interface Remote<T> { data: T | null; error: string }

/** Loads `load()` whenever `key` changes, after `delayMs`. A superseded or unmounted
 * request never lands; the previous data stays on screen until the next arrives. */
function useRemote<T>(key: string, load: () => Promise<T>, delayMs = 0): Remote<T> {
  const [state, setState] = useState<Remote<T>>({ data: null, error: '' });
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      load().then((data) => { if (live) setState({ data, error: '' }); }, (error: unknown) => { if (live) setState((current) => ({ ...current, error: errorText(error) })); });
    }, delayMs);
    return () => { live = false; clearTimeout(timer); };
    // `key` names everything `load` reads.
  }, [key]);
  return state;
}

export const DIRECTORY_PAGE = 100;

/** The directory (first page), filtered by a name prefix; typing waits a beat before asking. */
export function usePlayers(client: AccountClient, query: string): Remote<PlayersResponse> {
  const text = query.trim();
  return useRemote(`players:${text}`, () => client.players(text, 0, DIRECTORY_PAGE), text ? 250 : 0);
}

/** One public profile page. Mount it keyed by username so a new player starts empty. */
export function usePlayer(client: AccountClient, username: string): Remote<PlayerProfileResponse> {
  return useRemote(`player:${username}`, () => client.player(username));
}
