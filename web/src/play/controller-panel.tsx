import { useEffect, useState, useSyncExternalStore } from 'react';
import { ACTIONS, ACTION_LABELS, mappingError, type ControllerAction } from '../../../lib/input/gamepad-profiles.ts';
import type { ControllerDeviceView, ControllerHub, LocalControllerCount } from '../input/controller-hub.ts';
import './controller-panel.css';

export interface ControllerPanelProps { hub: ControllerHub; online: boolean; localCount: LocalControllerCount; spectating?: boolean; slotLabels?: readonly string[] }

/** Only this subtree subscribes to the 10Hz diagnostic snapshot, not the game UI. */
export function ControllerPanel({hub, online, localCount, spectating = false, slotLabels}: ControllerPanelProps) {
  const view = useSyncExternalStore(hub.subscribe, hub.getSnapshot, hub.getSnapshot);
  const menuOnly = spectating && !online, count = online || menuOnly ? 1 : localCount;
  useEffect(() => { hub.setLocalPlayerCount(count); }, [hub, count]);
  return <section className="controller-panel" aria-labelledby="controller-panel-title">
    <header className="controller-panel__heading"><div><h3 id="controller-panel-title">CONTROLLERS</h3></div>
      <button type="button" onClick={() => hub.detect()}>Connect / detect</button></header>
    <p className={`controller-panel__status controller-panel__status--${view.status}`} role="status">{view.message}</p>
    {online && <p>Online: only one local controller slot.</p>}
    {!view.secureContext && <p className="controller-panel__warning">Gamepad detection may be blocked on this connection. Keyboard and touch still work.</p>}
    {!view.devices.length && <p className="controller-panel__empty">No controllers detected.</p>}
    <div className="controller-panel__devices">{view.devices.map(device => <DeviceCard key={device.key} hub={hub} device={device} count={count} spectating={menuOnly} slotLabels={slotLabels} />)}</div>
    {view.storageNotice && <p className="controller-panel__warning" role="status">{view.storageNotice}</p>}
  </section>;
}
function DeviceCard({hub, device, count, spectating, slotLabels}: {hub: ControllerHub; device: ControllerDeviceView; count: LocalControllerCount; spectating: boolean; slotLabels?: readonly string[]}) {
  const [error, setError] = useState('');
  const act = (action: () => void) => { try { action(); setError(''); } catch (error) { setError(error instanceof Error ? error.message : 'Controller action failed.'); } };
  const calibration = device.calibration;
  const validation = calibration ? mappingError(calibration.mapping, {axes: device.axes, buttons: device.buttons}) : null;
  const label = (index: number) => device.buttons[index]?.label ?? `Button ${index}`;
  return <article className="controller-panel__device" aria-label={`Controller ${device.index + 1}`} data-controller-index={device.index}>
    <div className="controller-panel__device-heading"><div><h4>{device.profile}{device.standard ? ' · browser-standard layout' : ' · raw layout'}</h4><p className="controller-panel__device-id">{device.name}</p></div>
      <span className={`controller-panel__badge ${device.connected ? 'is-connected' : ''}`}>{device.connected ? 'Browser connected' : 'Disconnected · slot reserved'}</span></div>
    <div className="controller-panel__assignment"><span>Browser index {device.index}</span>
      <label>{spectating ? 'Menu control assignment' : 'Human control assignment'}<select aria-label={`${spectating ? 'Menu' : 'Human'} control assignment for controller ${device.index + 1}`} value={device.slot === null ? '' : String(device.slot)} disabled={!device.connected} onChange={event => act(() => hub.assign(device.key, event.target.value === '' ? null : Number(event.target.value)))}>
        <option value="">Unassigned</option>{Array.from({length: count}, (_, slot) => <option key={slot} value={slot}>{spectating ? 'Menu control' : `Local human ${slot + 1}`}{spectating ? ' · menu only' : slotLabels?.[slot] ? ` · ${slotLabels[slot]!.slice(0, 160)}` : count === 1 ? ' · YOU' : ''}</option>)}
        {device.slot !== null && device.slot >= count && <option value={device.slot}>Human control {device.slot + 1} · inactive in this mode</option>}
      </select></label>
      {!device.connected && <button type="button" onClick={() => act(() => hub.forget(device.key))}>Forget reservation</button>}
    </div>
    {device.connected && <>
      {!device.usable && <p className="controller-panel__warning">Not sending gameplay input. Confirm the layout or calibrate it.</p>}
      {device.usable && <p className="controller-panel__ready">{device.calibrated ? 'Custom mapping enabled.' : device.guessed ? 'Auto-mapped by best guess (raw layout) — if buttons feel wrong, use Remap / calibrate.' : 'Auto-mapped: standard layout.'} {device.slot === null ? 'Assign it to play.' : device.slot >= count ? 'Inactive in this mode.' : spectating ? 'Menu-only.' : 'Release buttons and center the stick to activate.'}</p>}
      <div className="controller-panel__actions">
        {!device.usable && device.standard && <button type="button" onClick={() => act(() => hub.confirmStandard(device.key))}>Confirm browser-standard layout</button>}
        {!calibration && <button type="button" onClick={() => act(() => hub.beginCalibration(device.key))}>{device.usable ? 'Remap / calibrate' : 'Calibrate raw buttons'}</button>}
        {!calibration && device.saved && <button type="button" onClick={() => act(() => hub.applySaved(device.key))}>Use saved profile · verify first</button>}
        {!calibration && device.usable && <button type="button" onClick={() => act(() => hub.resetMapping(device.key))}>Reset mapping</button>}
      </div>
      <details className="controller-panel__tester" open={!!calibration}><summary>Live controller test · {device.buttons.length} buttons / {device.axes.length} axes</summary>
        <div className="controller-panel__buttons">{device.buttons.map(button => <span key={button.index} className={`controller-panel__button ${button.pressed ? 'is-pressed' : ''}`} data-button-index={button.index} data-pressed={button.pressed}>{button.label}{button.value > 0 && <small>{Math.round(button.value * 100)}%</small>}</span>)}</div>
        <div className="controller-panel__axes">{device.axes.map((axis, index) => <label key={index}>Axis {index}<meter min={-1} max={1} low={-0.15} high={0.15} optimum={0} value={axis} /><output aria-label={`Controller ${device.index + 1} axis ${index}`}>{axis.toFixed(2)}</output></label>)}</div>
      </details>
      {calibration ? <fieldset className="controller-panel__calibration"><legend>Remap controller · input disabled until saved or cancelled</legend>
        <p>Center every stick, then Listen + move RIGHT or UP per axis. Bind every action; Walk is optional.</p>
        <p className="controller-panel__capture" role="status">{calibration.message}</p>
        {([['x', 'Left stick · horizontal · right', 'axis-x'], ['y', 'Left stick · vertical · up', 'axis-y'], ['cx', 'Right smash-stick · horizontal · right · optional', 'axis-cx'], ['cy', 'Right smash-stick · vertical · up · optional', 'axis-cy']] as const).map(([axis, title, action]) => <div className="controller-panel__binding" key={axis}><strong>{title}</strong>
          <span>{calibration.mapping.axes[axis] ? `Axis ${calibration.mapping.axes[axis]!.index}, sign ${calibration.mapping.axes[axis]!.sign > 0 ? '+' : '−'}` : axis === 'cx' || axis === 'cy' ? 'Unbound · C-stick flicks do nothing' : 'Unbound · use D-pad or capture an axis'}</span>
          <button type="button" disabled={!device.axes.length} aria-pressed={calibration.listening === action} onClick={() => act(() => hub.listen(device.key, action))}>{calibration.listening === action ? 'Listening…' : 'Listen'}</button>
          <button type="button" aria-label={`Clear ${axis} axis`} onClick={() => act(() => hub.clearBinding(device.key, action))}>Clear</button></div>)}
        {ACTIONS.map(action => <div className="controller-panel__binding" key={action}><strong>{ACTION_LABELS[action]}{action === 'walk' ? ' · optional' : ''}</strong><span>{calibration.mapping.buttons[action].map(label).join(' / ') || 'Unbound'}</span>
          <button type="button" aria-label={`Listen for ${ACTION_LABELS[action]}`} aria-pressed={calibration.listening === action} onClick={() => act(() => hub.listen(device.key, action))}>{calibration.listening === action ? 'Listening…' : 'Listen'}</button>
          <button type="button" aria-label={`Clear ${ACTION_LABELS[action]}`} onClick={() => act(() => hub.clearBinding(device.key, action as ControllerAction))}>Clear</button></div>)}
        <label className="controller-panel__deadzone">Stick deadzone · {Math.round(calibration.mapping.deadzone * 100)}%<input type="range" min="0.05" max="0.4" step="0.01" value={calibration.mapping.deadzone} onChange={event => act(() => hub.setDeadzone(device.key, Number(event.target.value)))} /></label>
        {validation && <p className="controller-panel__warning">{validation}</p>}
        <div className="controller-panel__actions"><button type="button" disabled={!!validation} onClick={() => act(() => hub.saveCalibration(device.key))}>Save & enable mapping</button><button type="button" onClick={() => act(() => hub.cancelCalibration(device.key))}>Cancel calibration</button></div>
      </fieldset> : device.mapping && <details className="controller-panel__bindings"><summary>Current gameplay mapping</summary><dl>{ACTIONS.map(action => <div key={action}><dt>{ACTION_LABELS[action]}</dt><dd>{device.mapping!.buttons[action].map(label).join(' / ') || (action === 'walk' ? 'Optional / keyboard' : 'Stick axis / not bound')}</dd></div>)}<div><dt>Smash-stick horizontal</dt><dd>{device.mapping!.axes.cx !== null && device.mapping!.axes.cx !== undefined ? `Axis ${device.mapping!.axes.cx!.index}` : 'Unbound'}</dd></div><div><dt>Smash-stick vertical</dt><dd>{device.mapping!.axes.cy !== null && device.mapping!.axes.cy !== undefined ? `Axis ${device.mapping!.axes.cy!.index}` : 'Unbound'}</dd></div></dl></details>}
    </>}
    {error && <p className="controller-panel__warning" role="alert">{error}</p>}
  </article>;
}
