import { useState } from 'react';
import type { DiscGate } from './game-session.ts';

/** Client-disc mode boot screen: the player selects their own original ISO and, depending on
 * the host policy, the ACE 2.0 extension ISO. Files are read in this browser only. */
export function DiscGateOverlay({ gate, onStart }: { gate: DiscGate; onStart: (vanilla: File, ace: File | null) => void }) {
  const [vanilla, setVanilla] = useState<File | null>(null);
  const [ace, setAce] = useState<File | null>(null);
  const needsAce = gate.ace === 'required';
  const ready = !!vanilla && (!needsAce || !!ace) && !gate.verifying;
  const pick = (set: (file: File | null) => void) => (event: React.ChangeEvent<HTMLInputElement>) => set(event.target.files?.[0] ?? null);
  return <div className="loading-overlay disc-gate" role="dialog" aria-modal="true" aria-labelledby="disc-gate-title">
    <span className="loading-brand" aria-hidden="true">SMASH<span>WEB</span></span>
    <p className="loading-title" id="disc-gate-title">SELECT YOUR OWN GAME DISC</p>
    <label className="disc-slot">
      <span className="disc-slot-name">ORIGINAL · USA v1.02 <em>required</em></span>
      <input id="disc-vanilla" type="file" accept=".iso,.gcm" disabled={gate.verifying} onChange={pick(setVanilla)} />
    </label>
    {gate.ace !== 'off' && <label className="disc-slot">
      <span className="disc-slot-name">ACE 2.0 EXTENSION <em>{needsAce ? 'required' : 'optional · skip it to play the original roster'}</em></span>
      <input id="disc-ace" type="file" accept=".iso,.gcm" disabled={gate.verifying} onChange={pick(setAce)} />
    </label>}
    <button id="disc-start" className="primary" disabled={!ready} onClick={() => { if (vanilla) onStart(vanilla, gate.ace === 'off' ? null : ace); }}>
      {gate.verifying ? 'VERIFYING…' : ace && gate.ace !== 'off' ? 'PLAY ORIGINAL + ACE' : 'PLAY ORIGINAL'}
    </button>
    {gate.error && <p className="disc-gate-error" role="alert">{gate.error}</p>}
    <p className="loading-detail">This host does not supply game data. Your disc is verified and read inside this browser; nothing is uploaded. Online rooms only match players who loaded the same discs.</p>
  </div>;
}
