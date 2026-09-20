import { memo, useEffect, useState } from 'react';
import { androidUpdater, parseAppUpdateState, type AppUpdateState, type SmashUpdateJs } from '../android-bridge.ts';

/** Live update state from the Android shell: refreshed on its `smash-update-state` event
 * and by a light poll (older shells never fire the event). Null outside the APK. */
export function useAppUpdate(): { updater: SmashUpdateJs; state: AppUpdateState } | null {
  const [updater] = useState(() => androidUpdater());
  const [state, setState] = useState<AppUpdateState | null>(() => (updater ? parseAppUpdateState(updater) : null));
  useEffect(() => {
    if (!updater) return;
    const refresh = () => setState(parseAppUpdateState(updater));
    window.addEventListener('smash-update-state', refresh);
    const timer = window.setInterval(refresh, 2000);
    return () => { window.removeEventListener('smash-update-state', refresh); window.clearInterval(timer); };
  }, [updater]);
  return updater && state ? { updater, state } : null;
}

/** Button label + whether an update is waiting for the player. */
export function updateAction(state: AppUpdateState): { label: string; detail: string; busy: boolean; highlight: boolean } {
  switch (state.phase) {
    case 'checking': return { label: 'Checking…', detail: '', busy: true, highlight: false };
    case 'downloading': {
      const percent = state.total > 0 ? Math.min(99, Math.floor((state.done / state.total) * 100)) : 0;
      return { label: `Downloading ${percent}%`, detail: '', busy: true, highlight: false };
    }
    case 'ready': return { label: 'Update ready · Reload', detail: state.ready ? `Game ${state.ready}` : '', busy: false, highlight: true };
    case 'app-update': return { label: 'Install app update', detail: state.appUpdate ? `App ${state.appUpdate}` : '', busy: false, highlight: true };
    case 'up-to-date': return { label: 'Up to date · Check again', detail: '', busy: false, highlight: false };
    case 'error': return { label: 'Retry update', detail: state.message, busy: false, highlight: false };
    default: return { label: 'Check for updates', detail: '', busy: false, highlight: false };
  }
}

/** Installed app/game versions and one update button (APK only; renders nothing on the web). */
export const AppUpdateControl = memo(function AppUpdateControl({ variant }: { variant: 'home' | 'options' }) {
  const live = useAppUpdate();
  if (!live) return null;
  const { updater, state } = live;
  const action = updateAction(state);
  const run = () => {
    try {
      if (state.interactive && updater.apply) updater.apply();
      else updater.check();
    } catch { /* the shell reports its own failures */ }
  };
  return <div className={`app-update app-update-${variant}${action.highlight ? ' has-update' : ''}`} id={variant === 'home' ? 'home-app-update' : 'options-app-update'}>
    <span className="app-update-version"><span>App {state.app || '—'}</span>{state.game && <span>Game {state.game}</span>}</span>
    <button type="button" id={variant === 'home' ? 'home-update-button' : 'check-app-update'} className="app-update-button" disabled={action.busy} onClick={run}>{action.label}</button>
    {action.detail && <small className="app-update-detail" role="status">{action.detail}</small>}
  </div>;
});
