import { useEffect, useState, useSyncExternalStore } from 'react';
import { KEY_ACTIONS, KEY_ACTION_LABELS, bindable, keyLabel, type KeyAction } from '../input/keyboard-map.ts';
import type { PlayInput } from '../play-input.ts';
import './keyboard-panel.css';

/** Options → Keyboard: the current keys of the two keyboard players, each one rebindable.
 * Open by default when no controller is connected (that is when people need it). */
export function KeyboardPanel({ input, open, players }: { input: PlayInput; open: boolean; players: 1 | 2 }) {
  const store = input.keyboard;
  const map = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [capture, setCapture] = useState<{ player: 0 | 1; action: KeyAction } | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!capture) return;
    input.rebinding = true;
    // Capture phase + stopImmediatePropagation: the dialog, the menus and the game never see this key.
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') { setNote('Cancelled.'); setCapture(null); return; }
      if (!bindable(event.code)) { setNote(`${keyLabel(event.code) || 'That key'} is reserved. Press another key, or Esc to cancel.`); return; }
      const owner = ([0, 1] as const).flatMap((player) => KEY_ACTIONS.filter((action) => map[player][action].includes(event.code) && !(player === capture.player && action === capture.action)).map((action) => `P${player + 1} ${KEY_ACTION_LABELS[action]}`))[0];
      store.bind(capture.player, capture.action, event.code);
      setNote(owner ? `${keyLabel(event.code)} now does P${capture.player + 1} ${KEY_ACTION_LABELS[capture.action]}; it was taken from ${owner}, which needs a new key.` : `P${capture.player + 1} ${KEY_ACTION_LABELS[capture.action]} is now ${keyLabel(event.code)}.`);
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); input.rebinding = false; };
  }, [capture, input, map, store]);
  const columns = players === 2 ? [0, 1] as const : [0] as const;
  return <details className="keyboard-panel" open={open || capture !== null}>
    <summary>KEYBOARD{store.customized ? ' · CUSTOM' : ''}</summary>
    <p className="keyboard-panel__hint">Click a key to change it, then press the new key (Esc cancels). Keys are saved in this browser.{players === 2 ? ' The second layout is for a second person sharing this keyboard.' : ''}</p>
    <table className="keyboard-panel__table">
      <thead><tr><th scope="col">Action</th>{columns.map((player) => <th scope="col" key={player}>{player === 0 ? 'Player 1 keys' : 'Player 2 keys'}</th>)}</tr></thead>
      <tbody>{KEY_ACTIONS.map((action) => <tr key={action}>
        <th scope="row">{KEY_ACTION_LABELS[action]}</th>
        {columns.map((player) => {
          const listening = capture?.player === player && capture.action === action, keys = map[player][action];
          return <td key={player}><button type="button" className={`keyboard-panel__key${listening ? ' is-listening' : ''}${keys.length ? '' : ' is-unbound'}`} data-key-player={player + 1} data-key-action={action}
            aria-label={`${player === 0 ? 'Player 1' : 'Player 2'} ${KEY_ACTION_LABELS[action]}: ${listening ? 'press a key' : keys.map(keyLabel).join(' or ') || 'not set'}. Click to change.`}
            onClick={() => { setNote(''); setCapture(listening ? null : { player, action }); }}>{listening ? 'Press a key…' : keys.map(keyLabel).join(' / ') || 'Not set'}</button></td>;
        })}
      </tr>)}</tbody>
    </table>
    <div className="keyboard-panel__footer">
      <button type="button" className="secondary" id="keyboard-reset" disabled={!store.customized} onClick={() => { store.reset(); setCapture(null); setNote('Default keys restored.'); }}>Restore default keys</button>
      <p role="status" className="keyboard-panel__note">{note}</p>
    </div>
  </details>;
}
